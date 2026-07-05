import type { HookInput, HookOutput } from "./types.js"
import type { PluginContext } from "./context.js"
import { textFromParts, isUltracodeKeyword } from "../ultracode/keyword.js"
import { captureBoundaries } from "../auto-mode/boundaries.js"
import { buildPausedReminder } from "../auto-mode/system-reminder.js"
import { buildUltracodeReminder } from "../ultracode/system-reminder.js"
import { setMaxThinkingEffort } from "./chat-params.js"

export function onChatMessage(
  ctx: PluginContext,
  input: HookInput<"chat.message">,
  output: HookOutput<"chat.message">,
): void {
  const session = ctx.state.sessions.get(input.sessionID)
  const text = textFromParts(output.parts)
  session.autoMode.lastUserMessage = text
  session.autoMode.verdicts.clear()
  captureBoundaries(session.autoMode.boundaries, text)
  session.ultracode.singleTurn = ctx.config.ultracode.keywordTrigger && isUltracodeKeyword(text)
}

export function onSystemTransform(
  ctx: PluginContext,
  input: HookInput<"experimental.chat.system.transform">,
  output: HookOutput<"experimental.chat.system.transform">,
): void {
  const sessionID = input.sessionID
  if (!sessionID) return
  const session = ctx.state.sessions.get(sessionID)
  const reminders: string[] = []

  if (session.autoMode.active) {
    reminders.push(session.autoMode.paused ? buildPausedReminder() : ctx.config.autoMode.systemReminderText)
  }
  if (session.ultracode.active || session.ultracode.singleTurn) {
    reminders.push(buildUltracodeReminder())
  }
  if (reminders.length > 0) output.system.push(reminders.join("\n"))
}

export function onChatParams(
  ctx: PluginContext,
  input: HookInput<"chat.params">,
  output: HookOutput<"chat.params">,
): void {
  const session = ctx.state.sessions.get(input.sessionID)
  if (!session.ultracode.active && !session.ultracode.singleTurn) return
  setMaxThinkingEffort(input.model, output)
}
