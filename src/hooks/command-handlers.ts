import type { HookInput, HookOutput, Part } from "./types.js"
import type { PluginContext } from "./context.js"
import { activate, deactivate } from "../auto-mode/fallback.js"
import { formatWorkflowList } from "../ultracode/workflow-manager.js"

export async function onCommand(
  ctx: PluginContext,
  input: HookInput<"command.execute.before">,
  output: HookOutput<"command.execute.before">,
): Promise<void> {
  const cmd = input.command
  const sessionID = input.sessionID
  const arg = (input.arguments ?? "").trim().toLowerCase()
  let message: string | undefined
  if (cmd === "auto") message = await handleAuto(ctx, sessionID, arg)
  else if (cmd === "ultracode") message = handleUltracode(ctx, sessionID, arg)
  else if (cmd === "workflows") message = formatWorkflowList(ctx.state)
  if (message === undefined) return
  output.parts.length = 0
  // Plugin creates a minimal text part — the SDK's runtime fills in id/sessionID/messageID.
  output.parts.push({ type: "text", text: message } as Part)
}

// ── /auto ────────────────────────────────────────────────────────────────────

async function handleAuto(ctx: PluginContext, sessionID: string, arg: string): Promise<string> {
  if (!ctx.config.autoMode.enabled) {
    return "Auto mode is disabled by configuration (autoMode.enabled = false). Ask an admin to enable it."
  }
  const session = ctx.state.sessions.get(sessionID)
  const auto = session.autoMode
  switch (arg) {
    case "":
    case "on":
      activate(auto)
      void ctx.classifier.verifyAgent(ctx.config.autoMode)
      return "Auto mode ENABLED for this session. Routine operations proceed without asking; risky actions are classified before execution."
    case "off":
      deactivate(auto)
      return "Auto mode DISABLED for this session. The normal permission prompts are back."
    case "status":
      return [
        `Auto mode: ${auto.active ? (auto.paused ? "PAUSED" : "ACTIVE") : "off"}`,
        `Consecutive denials: ${auto.consecutiveDenials} / ${ctx.config.autoMode.maxConsecutiveDenials}`,
        `Total denials: ${auto.totalDenials} / ${ctx.config.autoMode.maxTotalDenials}`,
        auto.boundaries.length ? `Standing instructions: ${auto.boundaries.length}` : "Standing instructions: none",
      ].join("\n")
    case "defaults":
    case "config":
      return ctx.config.autoMode.systemReminderText
    default:
      return `Unknown /auto argument '${arg}'. Use: on | off | status | defaults | config.`
  }
}

// ── /ultracode ───────────────────────────────────────────────────────────────

function handleUltracode(ctx: PluginContext, sessionID: string, arg: string): string {
  const ultracode = ctx.state.sessions.get(sessionID).ultracode
  switch (arg) {
    case "":
    case "on":
      ultracode.active = true
      return "Ultracode mode ENABLED for this session. The model will proactively orchestrate multi-agent workflows and use maximum reasoning effort."
    case "off":
      ultracode.active = false
      return "Ultracode mode DISABLED for this session."
    case "status":
      return `Ultracode mode: ${ultracode.active ? "ACTIVE" : "off"} (keyword trigger: ${ctx.config.ultracode.keywordTrigger ? "on" : "off"})`
    default:
      return `Unknown /ultracode argument '${arg}'. Use: on | off | status.`
  }
}
