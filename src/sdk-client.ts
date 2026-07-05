/**
 * SDK client interface — the single dependency boundary between
 * opencode-ultra modules and the external opencode HTTP API.
 *
 * Every module that talks to opencode depends on this interface,
 * never on the concrete OpencodeClient. This enables:
 *   - RealSdkClient: production adapter wrapping OpencodeClient
 *   - MockSdkClient: test double returning predefined responses
 *   - Any future adapter (different SDK version, direct HTTP, etc.)
 *
 * Permission decisions are NOT made through this interface — they are made by
 * mutating the `permission.ask` hook's output.status. There is no
 * client.permission namespace in the real SDK.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionPromptOptions {
  readonly agent?: string
  readonly system?: string
  /** Model override for this prompt (e.g. route the classifier to a small/cheap model). */
  readonly model?: { readonly providerID: string; readonly modelID: string }
  /** Tool allow/deny overrides for this prompt (e.g. {} to disable all tools). */
  readonly tools?: Record<string, boolean>
  readonly parts: ReadonlyArray<{
    readonly type: string
    readonly text: string
    readonly synthetic?: boolean
  }>
  readonly noReply?: boolean
}

/** The result of one agent turn, including its real resource usage. */
export interface AgentRun {
  readonly text: string
  /** USD cost reported by the assistant message (0 when the provider reports none). */
  readonly cost: number
  /** Total tokens (input + output + reasoning). */
  readonly tokens: number
}

// ── Interface ────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface ISdkClient {
  /**
   * Write a diagnostic to opencode's SERVER log (the `/log` endpoint), NOT to
   * stdout/stderr. The plugin runs in opencode's process; writing to the console
   * leaks raw text into the terminal and corrupts the TUI. Best-effort and
   * non-throwing — logging must never break a hook.
   */
  log(level: LogLevel, message: string): void

  /** Create a child session, optionally rooted at a different working directory. Returns the new session ID. */
  createSession(parentId: string, title: string, directory?: string): Promise<string>

  /** Send a prompt to a session. Returns the model's text response and resource usage. */
  promptSession(sessionId: string, options: SessionPromptOptions): Promise<AgentRun>

  /** Delete a session. Best-effort — errors are swallowed. */
  deleteSession(sessionId: string): Promise<void>

  /** Names of the agents available in this opencode instance. */
  listAgents(): Promise<readonly string[]>
}
