/**
 * Auto mode system reminder — builds the prompt text injected
 * into the model's system context when auto mode is active.
 */
import { type AutoModeConfig } from "../contracts.js"
import { systemReminder } from "../util.js"

/**
 * Build the auto mode system reminder from compiled config.
 * Injected via experimental.chat.system.transform.
 */
export function buildReminder(config: AutoModeConfig): string {
  const lines = [
    "You are in AUTO MODE. You may proceed with routine operations without asking the user.",
    "",
  ]

  if (config.softDeny.length > 0) {
    lines.push("ASK — use the question tool before doing any of these:")
    for (const rule of config.softDeny) lines.push(`- ${rule}`)
    lines.push("")
  }

  if (config.hardDeny.length > 0) {
    lines.push("NEVER — these actions are unconditionally blocked:")
    for (const rule of config.hardDeny) lines.push(`- ${rule}`)
    lines.push("")
  }

  lines.push(
    "Do not stop to ask clarifying questions about the task itself.",
    "Proceed with your best understanding. Only stop for safety concerns.",
    "If a tool call is blocked, the system will tell you why.",
  )

  return systemReminder(...lines)
}

/**
 * Build the paused reminder — shown when auto mode has been suspended
 * due to repeated safety denials.
 */
export function buildPausedReminder(): string {
  return systemReminder(
    "Auto mode PAUSED after repeated safety denials.",
    "You MUST use the question tool to ask the user before any shell,",
    "network, or external filesystem operation.",
    "Explain to the user what you were trying to do and what needs approval.",
    "Auto mode will resume when the user approves an action.",
  )
}
