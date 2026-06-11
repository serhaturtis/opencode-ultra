/**
 * permission.ask hook — enforces the verdict that tool.execute.before already
 * computed and cached by callID for this session.
 *
 * Counting (denials/approvals) happens in tool.execute.before, so this handler
 * only translates the cached verdict into output.status. Reading the verdict
 * consumes it, keeping the cache small.
 */
import { type AutoModeState } from "../contracts.js"

export interface PermissionAskInput {
  readonly callID?: string
}

export interface PermissionAskOutput {
  status: "ask" | "deny" | "allow"
}

export function handlePermissionAsk(
  input: PermissionAskInput,
  output: PermissionAskOutput,
  autoMode: AutoModeState,
): void {
  const callId = input.callID
  if (!callId) return // not a tool-originated permission (e.g. plan/question) — leave to the user

  const cached = autoMode.verdicts.consumeByCall(callId)
  if (!cached) return // no classification ran — fall through to the normal prompt

  output.status = cached.verdict === "ALLOW" ? "allow" : "deny"
}
