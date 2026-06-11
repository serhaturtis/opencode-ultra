/**
 * tool.execute.before — resolves a verdict (cache → Stage 1 → Stage 2),
 * records it, updates counters, and throws on DENY so the tool never runs.
 * The task tool is always classified at delegation, even when base permission is "allow".
 */
import {
  type AutoModeState,
  type CompiledConfig,
  type FinalVerdict,
  type Stage2Classification,
} from "../contracts.js"
import { classify, extractActionString, isToolAlwaysSafe } from "../auto-mode/stage1.js"
import { ClassifierSession } from "../auto-mode/stage2.js"
import { recordApproval, recordDenial } from "../auto-mode/fallback.js"
import { ToolDeniedError } from "../errors.js"

export async function handleToolExecuteBefore(
  input: { tool: string; sessionID: string; callID: string },
  output: { args: unknown },
  config: CompiledConfig,
  autoMode: AutoModeState,
  classifier: ClassifierSession,
): Promise<void> {
  const { tool, callID } = input

  // Always-safe tools never reach a permission prompt and need no verdict.
  if (isToolAlwaysSafe(tool)) return

  const params = extractActionString(tool, output.args)
  const verdict = await resolveVerdict(tool, params, output.args, config, autoMode, classifier)

  if (verdict.verdict === "DEFER") {
    // Stage 2 couldn't decide (classifier unavailable/unparseable). Auto mode steps
    // aside — no throw, no cache, no counter — so opencode's normal permission flow
    // handles it. Stage 1 has already blocked the catastrophic set, so this never
    // exposes a definitely-dangerous action; it just avoids blocking routine work.
    return
  }

  autoMode.verdicts.record(tool, params, callID, { verdict: verdict.verdict, reason: verdict.reason })
  applyCounters(autoMode, config, verdict.verdict)

  if (verdict.verdict === "DENY") {
    const label = tool === "task" ? "subagent delegation" : tool
    // Audit trail: every denial is logged with its reason.
    console.warn(`[opencode-ultra] auto-mode DENY ${label}: ${verdict.reason}`)
    throw new ToolDeniedError(`Auto mode blocked ${label}: ${verdict.reason}`, tool, callID)
  }
}

/** Cache → Stage 1 → Stage 2. Returns ALLOW/DENY, or DEFER when Stage 2 can't decide. */
async function resolveVerdict(
  tool: string,
  params: string,
  args: unknown,
  config: CompiledConfig,
  autoMode: AutoModeState,
  classifier: ClassifierSession,
): Promise<Stage2Classification> {
  const cached = autoMode.verdicts.lookup(tool, params)
  if (cached) return cached

  const stage1 = classify(tool, args, config.autoMode.stage1Rules)
  if (stage1 === "ALLOW") return { verdict: "ALLOW", reason: "Stage 1: recognized as safe" }
  if (stage1 === "DENY") return { verdict: "DENY", reason: "Stage 1: caught by a safety rule" }

  return classifier.classify(
    { tool, params, userMessage: autoMode.lastUserMessage, boundaries: autoMode.boundaries },
    config.autoMode,
  )
}

/** The single denial/approval counting point. */
function applyCounters(autoMode: AutoModeState, config: CompiledConfig, verdict: FinalVerdict): void {
  if (verdict === "DENY") {
    recordDenial(autoMode, config.autoMode.maxConsecutiveDenials, config.autoMode.maxTotalDenials)
  } else {
    recordApproval(autoMode)
  }
}
