import { describe, it, expect } from "vitest"
import { resolveTemplate, validateTemplates, type TemplateContext } from "../../src/ultracode/templates"
import type { WorkflowDef } from "../../src/contracts"

const ctx = (over: Partial<TemplateContext> = {}): TemplateContext => ({
  stage: () => undefined,
  stageAgent: () => undefined,
  ...over,
})

describe("resolveTemplate", () => {
  it("resolves {{stage.name}} and {{stage.name.agent}}", () => {
    const c = ctx({
      stage: (n) => (n === "audit" ? "AUDIT" : undefined),
      stageAgent: (s, a) => (s === "audit" && a === "finder" ? "FOUND" : undefined),
    })
    expect(resolveTemplate("x {{stage.audit}}", c)).toBe("x AUDIT")
    expect(resolveTemplate("x {{stage.audit.finder}}", c)).toBe("x FOUND")
  })

  it("resolves {{item}} and {{step.x}} in a pipeline context", () => {
    const c = ctx({ item: "file.ts", step: (n) => (n === "review" ? "R" : undefined) })
    expect(resolveTemplate("{{item}}/{{step.review}}", c)).toBe("file.ts/R")
  })

  it("resolves {{finding}}", () => {
    expect(resolveTemplate("{{finding}}", ctx({ finding: '{"x":1}' }))).toBe('{"x":1}')
  })

  it("injects TEMPLATE ERROR markers for unresolved references", () => {
    expect(resolveTemplate("{{stage.nope}}", ctx())).toContain("TEMPLATE ERROR")
    expect(resolveTemplate("{{item}}", ctx())).toContain("TEMPLATE ERROR")
    expect(resolveTemplate("{{bogus}}", ctx())).toContain("TEMPLATE ERROR")
  })
})

describe("validateTemplates", () => {
  it("accepts valid forward references", () => {
    const def: WorkflowDef = { title: "", stages: [
      { kind: "fanout", name: "audit", agents: [{ name: "finder", task: "find", agent: "explore" }] },
      { kind: "fanout", name: "impl", agents: [{ name: "build", task: "use {{stage.audit.finder}}", agent: "general" }] },
    ] }
    expect(validateTemplates(def)).toEqual([])
  })

  it("flags an unknown stage reference", () => {
    const def: WorkflowDef = { title: "", stages: [
      { kind: "fanout", name: "a", agents: [{ name: "x", task: "{{stage.ghost}}", agent: "general" }] },
    ] }
    expect(validateTemplates(def).some((e) => e.includes("ghost"))).toBe(true)
  })

  it("flags {{item}} outside a pipeline", () => {
    const def: WorkflowDef = { title: "", stages: [
      { kind: "fanout", name: "a", agents: [{ name: "x", task: "{{item}}", agent: "general" }] },
    ] }
    expect(validateTemplates(def).some((e) => e.includes("pipeline"))).toBe(true)
  })

  it("validates pipeline step references", () => {
    const ok: WorkflowDef = { title: "", stages: [
      { kind: "pipeline", name: "p", over: ["a"], steps: [
        { name: "one", task: "{{item}}", agent: "general" },
        { name: "two", task: "{{step.one}}", agent: "general" },
      ] },
    ] }
    expect(validateTemplates(ok)).toEqual([])

    const bad: WorkflowDef = { title: "", stages: [
      { kind: "pipeline", name: "p", over: ["a"], steps: [{ name: "one", task: "{{step.ghost}}", agent: "general" }] },
    ] }
    expect(validateTemplates(bad).some((e) => e.includes("ghost"))).toBe(true)
  })

  it("rejects a FORWARD step reference (ENG-TM-04: used to pass, failed at runtime)", () => {
    const def: WorkflowDef = { title: "", stages: [
      { kind: "pipeline", name: "p", over: ["a"], steps: [
        { name: "one", task: "use {{step.two}}", agent: "general" }, // two hasn't run yet
        { name: "two", task: "ok", agent: "general" },
      ] },
    ] }
    const errs = validateTemplates(def)
    expect(errs.some((e) => /step 'two' before it has run/.test(e))).toBe(true)
  })

  it("rejects an agent reference into a verify stage (ENG-TM-08: dynamic voter names)", () => {
    const def: WorkflowDef = { title: "", stages: [
      { kind: "fanout", name: "find", agents: [{ name: "f", task: "find", agent: "explore" }] },
      { kind: "verify", name: "refute", source: "find", task: "{{finding}}", agent: "general", voters: 1 },
      { kind: "fanout", name: "use", agents: [{ name: "u", task: "{{stage.refute.anything}}", agent: "general" }] },
    ] }
    const errs = validateTemplates(def)
    expect(errs.some((e) => /cannot reference an agent in stage 'refute'/.test(e))).toBe(true)
  })

  it("still allows a 2-part {{stage.<verify>}} summary reference", () => {
    const def: WorkflowDef = { title: "", stages: [
      { kind: "fanout", name: "find", agents: [{ name: "f", task: "find", agent: "explore" }] },
      { kind: "verify", name: "refute", source: "find", task: "{{finding}}", agent: "general", voters: 1 },
      { kind: "fanout", name: "use", agents: [{ name: "u", task: "survivors: {{stage.refute}}", agent: "general" }] },
    ] }
    expect(validateTemplates(def)).toEqual([])
  })
})
