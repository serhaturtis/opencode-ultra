import { describe, it, expect } from "vitest"
import { parseAndValidate, describeSchema, SchemaError } from "../../src/ultracode/schema"
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
