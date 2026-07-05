/** Structured-output validator: objects, primitives, arrays of objects. */
import { type OutputSchema, type OutputFieldSpec } from "../contracts.js"

export class SchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SchemaError"
  }
}

const SCALAR_TYPES: ReadonlySet<string> = new Set(["string", "number", "boolean"])

/**
 * Structural validation of an OutputSchema — the contract validate() must
 * enforce BEFORE execute() ever builds a prompt. Returns a list of located
 * errors (empty = valid). Catches exactly the shapes that would otherwise
 * crash shapeOf()/validateObject() with an opaque Object.entries(null) crash
 * at fanout prompt-build time:
 *   - schema missing a top-level `fields` object
 *   - an array field whose `items` is missing or lacks its own `fields`
 *   - a field spec with an unknown / missing `type`
 */
export function validateSchema(schema: unknown, path: string): string[] {
  const errors: string[] = []
  walkSchema(schema, path, errors)
  return errors
}

function walkSchema(schema: unknown, path: string, errors: string[]): void {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    errors.push(`${path}: schema must be an object`)
    return
  }
  const s = schema as Record<string, unknown>
  if (typeof s.fields !== "object" || s.fields === null || Array.isArray(s.fields)) {
    errors.push(`${path}: schema must have a 'fields' object`)
    return
  }
  const fields = s.fields as Record<string, unknown>
  for (const [key, spec] of Object.entries(fields)) {
    const at = `${path}.fields.${key}`
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
      errors.push(`${at}: field spec must be an object`)
      continue
    }
    const f = spec as Record<string, unknown>
    if (typeof f.type !== "string") {
      errors.push(`${at}: missing or invalid 'type'`)
      continue
    }
    if (!SCALAR_TYPES.has(f.type) && f.type !== "array") {
      errors.push(`${at}: unknown field type '${f.type}'. Use string | number | boolean | array.`)
      continue
    }
    if (f.type === "array") walkSchema(f.items, `${at}[]`, errors)
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
  const fields = requireFields(schema, "describeSchema")
  const shape: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(fields)) {
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

/**
 * Defensive accessor for schema.fields. validateSchema() catches a missing
 * `fields` at validate() time, but anything that bypasses it (a programmatically
 * built workflow, an internal schema) must still fail loudly with an actionable
 * SchemaError instead of an opaque Object.entries(undefined) TypeError.
 */
function requireFields(schema: OutputSchema, where: string): Record<string, OutputFieldSpec> {
  if (!schema || typeof schema.fields !== "object" || schema.fields === null) {
    throw new SchemaError(`schema is missing a 'fields' object (in ${where})`)
  }
  return schema.fields
}

function validateObject(obj: Record<string, unknown>, schema: OutputSchema, path: string): void {
  const fields = requireFields(schema, `validateObject at ${path}`)
  for (const [key, spec] of Object.entries(fields)) {
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
