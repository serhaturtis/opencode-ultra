/** Filesystem-safe slug. Non-alnum -> dash, lowercased, capped at maxLen. */
export function slugify(name: string, maxLen = Infinity, fallback = "agent"): string {
  const slug = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "").slice(0, maxLen).replace(/^-|-$/g, "")
  return slug || fallback
}

/** Wrap lines in system-reminder tag. */
export function systemReminder(...lines: string[]): string {
  return `<system-reminder>\n${lines.join("\n")}\n</system-reminder>`
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
