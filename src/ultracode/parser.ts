/**
 * Workflow parser — extracts a `{ title, stages }` definition from JSON or JS
 * source text. No code execution; the JS path structurally rewrites a relaxed
 * object/array literal into strict JSON. Deep structural validation lives in the
 * engine; the parser only produces a normalized shape (or throws).
 */
import { WorkflowParseError } from "../errors.js"

export interface ParsedWorkflow {
  readonly title: string
  readonly stages: readonly unknown[]
}

export function parse(source: string): ParsedWorkflow {
  const trimmed = source.trim()
  if (!trimmed) throw new WorkflowParseError("Empty workflow definition", [])

  const value = tryJson(trimmed) ?? tryJsLiteral(trimmed)
  if (value === undefined) {
    throw new WorkflowParseError(
      'Could not parse a workflow. Provide JSON ({"title": "...", "stages": [...]}) or JS (export const workflow = {...}).',
      [],
    )
  }
  return normalize(value)
}

function normalize(value: unknown): ParsedWorkflow {
  if (Array.isArray(value)) return { title: "", stages: value }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>
    if (Array.isArray(obj.stages)) {
      return { title: typeof obj.title === "string" ? obj.title : "", stages: obj.stages }
    }
  }
  throw new WorkflowParseError("Workflow must be an object with a 'stages' array (or a bare stages array).", [])
}

// ── JSON / JS literal extraction ──────────────────────────────────────────────

function tryJson(source: string): unknown | undefined {
  try {
    return JSON.parse(source)
  } catch {
    return undefined
  }
}

function tryJsLiteral(source: string): unknown | undefined {
  const assigned = source.match(/=\s*([[{][\s\S]*[\]}])\s*;?\s*$/)
  const literal = assigned?.[1] ?? (/^[[{]/.test(source) ? source.replace(/;?\s*$/, "") : undefined)
  if (!literal) return undefined
  try {
    return JSON.parse(sanitizeJs(literal))
  } catch {
    return undefined
  }
}

// ── Relaxed-JS → JSON sanitizer (string-aware) ────────────────────────────────

const PLACEHOLDER = "\u0000" // NUL — cannot appear in source, cannot collide with a number
const PLACEHOLDER_RE = /\u0000(\d+)\u0000/g
const STRING_LITERAL_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g

function sanitizeJs(js: string): string {
  // 1. Protect string literals behind placeholders so their contents
  //    (apostrophes, colons, braces) survive the structural rewrites.
  const literals: string[] = []
  const skeleton = js.replace(STRING_LITERAL_RE, (lit) => {
    literals.push(lit[0] === "'" ? singleToDoubleQuoted(lit) : lit)
    return `${PLACEHOLDER}${literals.length - 1}${PLACEHOLDER}`
  })

  // 2. With strings removed, structural rewrites are safe.
  const structured = skeleton
    .replace(/([{,]\s*)([A-Za-z_]\w*)(\s*:)/g, '$1"$2"$3') // quote bare keys
    .replace(/,(\s*[}\]])/g, "$1") // drop trailing commas

  // 3. Restore the (JSON-quoted) string literals.
  return structured.replace(PLACEHOLDER_RE, (_m, i) => literals[Number(i)]!)
}

function singleToDoubleQuoted(lit: string): string {
  const inner = lit.slice(1, -1)
  let out = ""
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === "\\") {
      const next = inner[i + 1] ?? ""
      out += next === "'" ? "'" : "\\" + next
      i++
    } else if (ch === '"') {
      out += '\\"'
    } else {
      out += ch
    }
  }
  return '"' + out + '"'
}
