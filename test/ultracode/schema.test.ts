import { describe, it, expect } from "vitest"
import { parseAndValidate, describeSchema, validateSchema, SchemaError } from "../../src/ultracode/schema"
import type { OutputSchema } from "../../src/contracts"

const findingsSchema: OutputSchema = {
  fields: {
    findings: {
      type: "array", required: true,
      items: { fields: { title: { type: "string", required: true }, severity: { type: "string" } } },
    },
  },
}

describe("parseAndValidate", () => {
  it("accepts matching JSON", () => {
    expect(parseAndValidate('{"findings":[{"title":"x","severity":"high"}]}', findingsSchema))
      .toEqual({ findings: [{ title: "x", severity: "high" }] })
  })

  it("tolerates code fences and surrounding prose", () => {
    expect(parseAndValidate('Here you go:\n```json\n{"findings":[]}\n```', findingsSchema)).toEqual({ findings: [] })
  })

  it("throws on a missing required field", () => {
    expect(() => parseAndValidate('{"findings":[{"severity":"high"}]}', findingsSchema)).toThrow(SchemaError)
  })

  it("throws on a wrong type", () => {
    expect(() => parseAndValidate('{"findings":"nope"}', findingsSchema)).toThrow(SchemaError)
  })

  it("throws on non-object output", () => {
    expect(() => parseAndValidate("not json at all", findingsSchema)).toThrow(SchemaError)
  })
})

describe("describeSchema", () => {
  it("emits the expected shape", () => {
    const desc = describeSchema(findingsSchema)
    expect(desc).toContain("findings")
    expect(desc).toContain("JSON")
  })
})

describe("validateSchema", () => {
  it("accepts a well-formed schema (object + array of objects)", () => {
    expect(validateSchema(findingsSchema, "s")).toEqual([])
  })

  it("accepts an empty fields object", () => {
    expect(validateSchema({ fields: {} }, "s")).toEqual([])
  })

  it("rejects a schema missing a top-level fields object", () => {
    const errors = validateSchema({ findings: [] }, "s")
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain("must have a 'fields' object")
  })

  it("rejects an array field whose items is missing or lacks fields", () => {
    // items present but no fields — the exact shape that crashed Object.entries.
    const noItemFields = { fields: { findings: { type: "array", items: {} } } }
    const e1 = validateSchema(noItemFields, "s")
    expect(e1.some((e) => e.includes("s.fields.findings[]"))).toBe(true)
    expect(e1.some((e) => e.includes("must have a 'fields' object"))).toBe(true)

    // items missing entirely.
    const noItems = { fields: { findings: { type: "array" } } }
    const e2 = validateSchema(noItems, "s")
    expect(e2.length).toBeGreaterThan(0)
    expect(e2[0]).toContain("findings[]")
  })

  it("rejects a field with an unknown type", () => {
    const errors = validateSchema({ fields: { x: { type: "object" } } }, "s")
    expect(errors.some((e) => e.includes("unknown field type 'object'"))).toBe(true)
  })

  it("locates nested errors under a deep path", () => {
    const bad = {
      fields: {
        outer: { type: "array", items: { fields: { inner: { type: "array", items: {} } } } },
      },
    }
    const errors = validateSchema(bad, "root")
    expect(errors[0]).toContain("root.fields.outer[].fields.inner[]")
  })
})

describe("runtime hardening (bypassing validateSchema)", () => {
  it("describeSchema throws SchemaError, not a raw TypeError, on a missing fields", () => {
    expect(() => describeSchema({} as unknown as OutputSchema)).toThrow(SchemaError)
    expect(() => describeSchema({} as unknown as OutputSchema)).toThrow(/missing a 'fields' object/)
  })

  it("parseAndValidate surfaces a SchemaError when the schema's array items lack fields", () => {
    const malformed: OutputSchema = {
      fields: { findings: { type: "array", items: {} as unknown as OutputSchema } },
    }
    // A non-empty array forces recursion into validateObject(item, spec.items),
    // which hits the requireFields guard on the malformed items.
    expect(() => parseAndValidate('{"findings":[{"id":"x"}]}', malformed)).toThrow(SchemaError)
  })
})
