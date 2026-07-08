import type { HookInput, HookOutput } from "./types.js"
import type { PluginContext } from "./context.js"
import {
  type AutoModeState,
  type Classifier,
  type CompiledConfig,
  type FinalVerdict,
  type Metrics,
  type Stage2Classification,
} from "../contracts.js"
import { type ISdkClient } from "../sdk-client.js"
import { classify, extractActionString, isToolAlwaysSafe } from "../auto-mode/stage1.js"
import { recordApproval, recordDenial } from "../auto-mode/fallback.js"
import { ToolDeniedError } from "../errors.js"
import { INJECTION_WARNING, isUntrustedSource, looksLikeInjection } from "../auto-mode/probe.js"

// ── tool.execute.before ──────────────────────────────────────────────────────

export async function onToolBefore(
  ctx: PluginContext,
  input: HookInput<"tool.execute.before">,
  output: HookOutput<"tool.execute.before">,
): Promise<void> {
  const auto = ctx.state.sessions.get(input.sessionID).autoMode
  if (!auto.active || auto.paused) return

  const { tool, callID } = input
  if (isToolAlwaysSafe(tool)) return

  const stage2Params = extractActionString(tool, output.args)
  // Cache key is path-only for write tools — truncating content produced
  // cache-key collisions where distinct writes inherited prior verdicts.
  const cacheKey = extractCacheKey(tool, output.args)
  const verdict = await resolveVerdict(tool, cacheKey, stage2Params, output.args, ctx.config, auto, ctx.classifier, ctx.sdk, ctx.metrics)

  if (verdict.verdict === "DEFER") return

  auto.verdicts.record(tool, cacheKey, callID, { verdict: verdict.verdict, reason: verdict.reason })
  applyCounters(auto, ctx.config, verdict.verdict)

  if (verdict.verdict === "DENY") {
    const label = tool === "task" ? "subagent delegation" : tool
    ctx.sdk.log("warn", `auto-mode DENY ${label}: ${verdict.reason}`)
    ctx.metrics.autoDenied(tool, verdict.reason)
    throw new ToolDeniedError(`Auto mode blocked ${label}: ${verdict.reason}`, tool, callID)
  }
}

// ── tool.execute.after ───────────────────────────────────────────────────────

export async function onToolAfter(
  ctx: PluginContext,
  input: HookInput<"tool.execute.after">,
  output: HookOutput<"tool.execute.after">,
): Promise<void> {
  const auto = ctx.state.sessions.get(input.sessionID).autoMode
  if (!auto.active) return

  if (!isUntrustedSource(input.tool, input.args, ctx.directory)) return
  if (!looksLikeInjection(output.output)) return
  if (!(await ctx.classifier.detectInjection(output.output, ctx.config.autoMode))) return

  output.output = INJECTION_WARNING + output.output
  if (output.metadata) output.metadata.injectionDetected = true
}

// ── permission.ask ───────────────────────────────────────────────────────────

export function onPermissionAsk(
  ctx: PluginContext,
  input: HookInput<"permission.ask">,
  output: HookOutput<"permission.ask">,
): void {
  const auto = ctx.state.sessions.peek(input.sessionID)?.autoMode
  if (!auto || !auto.active || auto.paused) return

  const callId = input.callID
  if (!callId) return

  const cached = auto.verdicts.consumeByCall(callId)
  if (!cached) return

  output.status = cached.verdict === "ALLOW" ? "allow" : "deny"
}

// ── Shared resolution ────────────────────────────────────────────────────────

async function resolveVerdict(
  tool: string,
  cacheKey: string,
  stage2Params: string,
  args: unknown,
  config: CompiledConfig,
  auto: AutoModeState,
  classifier: Classifier,
  sdk: ISdkClient,
  metrics: Metrics,
): Promise<Stage2Classification> {
  const cached = auto.verdicts.lookup(tool, cacheKey)
  if (cached) return cached

  const t0 = Date.now()
  const stage1 = classify(tool, args, config.autoMode.stage1Rules)
  if (stage1 !== "FLAGGED") {
    metrics.autoClassification(stage1, tool, "stage1", Date.now() - t0)
    const reason = stage1 === "ALLOW" ? "Stage 1: recognized as safe" : "Stage 1: caught by a safety rule"
    return { verdict: stage1, reason }
  }

  const result = await classifier.classify(
    { tool, params: stage2Params, userMessage: auto.lastUserMessage, boundaries: auto.boundaries },
    config.autoMode,
  )
  metrics.autoClassification(result.verdict, tool, "stage2", Date.now() - t0)
  return result
}

function applyCounters(auto: AutoModeState, config: CompiledConfig, verdict: FinalVerdict): void {
  if (verdict === "DENY") {
    recordDenial(auto, config.autoMode.maxConsecutiveDenials, config.autoMode.maxTotalDenials)
  } else {
    recordApproval(auto)
  }
}

/** Cache key — path-only for writes so distinct writes to the same file share a verdict. */
function extractCacheKey(tool: string, args: unknown): string {
  if (typeof args !== "object" || args === null) return ""
  switch (tool) {
    case "write": case "edit": case "apply_patch":
      return `${tool}:${typeof (args as Record<string,unknown>).filePath === "string" ? (args as Record<string,unknown>).filePath : ""}`
    default:
      return extractActionString(tool, args)
  }
}
