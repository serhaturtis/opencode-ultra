import { describe, it, expect } from "vitest"
import { parse } from "../../src/ultracode/parser"
import { WorkflowParseError } from "../../src/errors"

describe("parser: parse", () => {
  it("parses a JSON workflow object", () => {
    const source = JSON.stringify({
      title: "Audit",
      stages: [{ kind: "fanout", name: "a", agents: [{ name: "x", task: "find", agent: "explore" }] }],
    })
    const result = parse(source)
    expect(result.title).toBe("Audit")
    expect(result.stages).toHaveLength(1)
  })

  it("accepts a bare stages array (no title)", () => {
    const source = JSON.stringify([{ kind: "fanout", name: "a", agents: [] }])
    const result = parse(source)
    expect(result.title).toBe("")
    expect(result.stages).toHaveLength(1)
  })

  it("parses `export const workflow = {...}` JS", () => {
    const source = `export const workflow = {
      title: "Build",
      stages: [{
        kind: "fanout",
        name: "audit",
        agents: [{ name: "finder", task: "Search", agent: "explore" }],
      }],
    }`
    const result = parse(source)
    expect(result.title).toBe("Build")
    expect((result.stages[0] as any).name).toBe("audit")
  })

  it("preserves apostrophes inside single-quoted JS strings", () => {
    const source = `export const workflow = {
      title: 'flow',
      stages: [{ kind: 'fanout', name: 'audit', agents: [{ name: 'finder', task: 'Find what doesn\\'t have tests', agent: 'explore' }] }],
    }`
    const result = parse(source)
    expect((result.stages[0] as any).agents[0].task).toBe("Find what doesn't have tests")
  })

  it("does not corrupt numeric values when sanitizing JS", () => {
    const source = `export const workflow = {
      stages: [{ kind: 'fanout', name: 'impl', maxConcurrent: 8, agents: [{ name: 'a', task: 'x', agent: 'general' }] }],
    }`
    const result = parse(source)
    expect((result.stages[0] as any).maxConcurrent).toBe(8)
  })

  it("throws on empty / whitespace input", () => {
    expect(() => parse("")).toThrow(WorkflowParseError)
    expect(() => parse("   \n ")).toThrow(WorkflowParseError)
  })

  it("throws when there is no stages array", () => {
    expect(() => parse(JSON.stringify({ foo: "bar" }))).toThrow(WorkflowParseError)
    expect(() => parse("const x = 1;")).toThrow(WorkflowParseError)
  })
})
