/** Hook input/output types derived from the SDK's Hooks interface. */
import type { Hooks } from "@opencode-ai/plugin"
import type { Part } from "@opencode-ai/sdk"

export type { Part }

export type HookName =
  | "chat.message" | "chat.params" | "chat.headers"
  | "permission.ask" | "command.execute.before"
  | "tool.execute.before" | "tool.execute.after" | "shell.env"
  | "experimental.chat.messages.transform" | "experimental.chat.system.transform"
  | "experimental.provider.small_model" | "experimental.session.compacting"
  | "experimental.compaction.autocontinue" | "experimental.text.complete"
  | "tool.definition" | "event" | "dispose"

export type HookInput<K extends HookName> = Parameters<NonNullable<Hooks[K]>>[0]

export type HookOutput<K extends HookName> =
  Parameters<NonNullable<Hooks[K]>> extends [any, infer O] ? O : undefined
