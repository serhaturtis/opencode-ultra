/**
 * User-message helpers, shared by auto mode (latest message + boundaries) and
 * ultracode (keyword trigger). Operates on the parts of a single message as
 * delivered by the `chat.message` hook (which, unlike messages.transform,
 * carries the sessionID needed for per-session state).
 */

/** Join the text-typed parts of a message into a single string. */
export function textFromParts(
  parts: ReadonlyArray<{ type?: string; text?: string }> | undefined,
): string {
  if (!parts) return ""
  return parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join(" ")
    .trim()
}

/** True when a message starts with the `ultracode:` keyword. */
export function isUltracodeKeyword(text: string): boolean {
  return /^ultracode\s*:/i.test(text.trim())
}
