/**
 * Boundary capture — records standing user constraints ("don't push",
 * "wait for review", "no deploys") so Stage 2 respects in-session intent.
 * High-precision: only sentences matching constraint patterns are captured.
 */

const ACTION =
  "push|deploy|deployment|commit|merge|delete|remove|modify|run|install|send|change|touch|write|force|overwrite|drop|reset|rebase|publish|release|migrate"

/** Sentence-level patterns that signal a standing constraint. */
const BOUNDARY_PATTERNS: readonly RegExp[] = Object.freeze([
  new RegExp(`\\b(?:do\\s+not|don'?t|never|please\\s+(?:do\\s+not|don'?t))\\s+(?:\\w+\\s+){0,3}?(?:${ACTION})\\b`, "i"),
  new RegExp(`\\bno\\s+(?:${ACTION})(?:s|ing|ments?)?\\b`, "i"),
  /\b(?:wait|hold\s+off|hold\s+on)\b[^.!?]*\b(?:before|until|review|approv|confirm)/i,
  /\b(?:before|without)\s+(?:my|your|explicit|getting)\s+(?:approval|permission|confirmation|sign[-\s]?off|review)\b/i,
])

const MAX_BOUNDARIES = 12
const MAX_SENTENCE_LEN = 200

/**
 * Scan a user message and append any newly-stated constraints to `target`
 * (deduped, bounded — oldest dropped first). Mutates `target` in place.
 */
export function captureBoundaries(target: string[], message: string): void {
  for (const raw of splitSentences(message)) {
    const sentence = raw.replace(/\s+/g, " ").trim()
    if (!sentence || sentence.length > MAX_SENTENCE_LEN) continue
    if (!BOUNDARY_PATTERNS.some((p) => p.test(sentence))) continue
    if (target.includes(sentence)) continue
    target.push(sentence)
    if (target.length > MAX_BOUNDARIES) target.shift()
  }
}

/** Render captured boundaries for the Stage 2 prompt, or "" when there are none. */
export function formatBoundaries(boundaries: readonly string[]): string {
  if (boundaries.length === 0) return ""
  return ["User's standing instructions this session (respect these):", ...boundaries.map((b) => `- ${b}`)].join("\n")
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?\n])\s+|\n+/)
}
