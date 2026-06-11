/**
 * Structured-output schema — a minimal, dependency-free, fail-fast validator for
 * the JSON that schema-bearing agents must emit. Not a full JSON Schema engine;
 * it covers exactly the shapes workflows need (objects, primitives, arrays of
 * objects) and rejects everything else loudly.
 */
import { type OutputSchema, type OutputFieldSpec } from "../contracts.js"

export class SchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SchemaError"
  }
}

/** The instruction appended to an agent's task so it returns matching JSON. */
export function describeSchema(schema: OutputSchema): string {
  return [
    "",
    "Respond with ONLY a single JSON object — no prose, no markdown fences — matching this shape:",
    JSON.stringify(shapeOf(schema), null, 2),
    "Every array field must be present (use [] if empty).",
  ].join("\n")
}

function shapeOf(schema: OutputSchema): Record<string, unknown> {
  const shape: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(schema.fields)) {
    shape[key] = spec.type === "array" ? [shapeOf(spec.items)] : spec.type
  }
  return shape
}

/** Parse agent text as JSON and validate it; throws SchemaError on any mismatch. */
export function parseAndValidate(text: string, schema: OutputSchema): Record<string, unknown> {
  const obj = extractJsonObject(text)
  validateObject(obj, schema, "$")
  return obj
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fenced?.[1]?.trim(), trimmed, sliceBraces(trimmed)].filter(Boolean) as string[]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // try the next candidate
    }
  }
  throw new SchemaError(`agent output is not a JSON object: "${trimmed.slice(0, 120)}"`)
}

function sliceBraces(text: string): string | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  return start >= 0 && end > start ? text.slice(start, end + 1) : undefined
}

function validateObject(obj: Record<string, unknown>, schema: OutputSchema, path: string): void {
  for (const [key, spec] of Object.entries(schema.fields)) {
    const value = obj[key]
    if (value === undefined || value === null) {
      if (spec.required) throw new SchemaError(`missing required field ${path}.${key}`)
      continue
    }
    validateField(value, spec, `${path}.${key}`)
  }
}

function validateField(value: unknown, spec: OutputFieldSpec, path: string): void {
  if (spec.type === "array") {
    if (!Array.isArray(value)) throw new SchemaError(`${path} must be an array`)
    value.forEach((item, i) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new SchemaError(`${path}[${i}] must be an object`)
      }
      validateObject(item as Record<string, unknown>, spec.items, `${path}[${i}]`)
    })
    return
  }
  if (typeof value !== spec.type) throw new SchemaError(`${path} must be a ${spec.type}`)
}
