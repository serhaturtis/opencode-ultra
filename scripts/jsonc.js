/**
 * jsonc.js — tolerant JSON/JSONC parsing for editing opencode config files.
 *
 * Standalone (no build step, no deps) so the installer can use it directly.
 * Logic is covered by test/scripts/jsonc.test.ts.
 */

/**
 * Parse JSON or JSONC text. Strict JSON is tried first — this handles every
 * comment-free config, including ones with URLs ("https://…") that a naive
 * `//`-stripper would corrupt. Only on failure do we strip comments + trailing
 * commas (string-aware) and retry.
 */
export function parseJsonc(text) {
  try {
    return JSON.parse(text)
  } catch {
    return JSON.parse(stripJsonc(text))
  }
}

/**
 * Remove `//` line comments, `/* *​/` block comments, and trailing commas —
 * never touching content inside string literals (so a `//`, `,]`, or `/*` that
 * appears inside a string value is preserved). Single-pass, string-aware.
 */
export function stripJsonc(text) {
  let out = ""
  let pendingComma = -1 // index in `out` of a comma awaiting a closer

  for (let i = 0; i < text.length; ) {
    const c = text[i]
    const c2 = text[i + 1]

    // String literal — copy verbatim (handling escapes); never interpret inside.
    if (c === '"' || c === "'") {
      pendingComma = -1
      out += c
      i++
      while (i < text.length) {
        out += text[i]
        if (text[i] === "\\") { out += text[i + 1] ?? ""; i += 2; continue }
        if (text[i] === c) { i++; break }
        i++
      }
      continue
    }

    if (c === "/" && c2 === "/") { while (i < text.length && text[i] !== "\n") i++; continue }
    if (c === "/" && c2 === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue }

    if (c === " " || c === "\t" || c === "\r" || c === "\n") { out += c; i++; continue }

    // A comma directly before a closer is a trailing comma — drop it.
    if (c === "}" || c === "]") {
      if (pendingComma >= 0) { out = out.slice(0, pendingComma) + out.slice(pendingComma + 1); pendingComma = -1 }
      out += c; i++; continue
    }
    if (c === ",") { pendingComma = out.length; out += c; i++; continue }

    // Any other significant token means the previous comma was not trailing.
    pendingComma = -1
    out += c
    i++
  }

  return out
}
