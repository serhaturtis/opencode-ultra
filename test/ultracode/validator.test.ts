import { describe, it, expect, beforeEach } from "vitest"
import { WorkflowValidator } from "../../src/ultracode/validator"
import { DEFAULT_ULTRACODE_CONFIG } from "../../src/ultracode/config"
import type { ParsedWorkflow } from "../../src/ultracode/parser"

const parsed = (stages: unknown[], title = "T"): ParsedWorkflow => ({ title, stages })

describe("WorkflowValidator.validate", () => {
  let validator: WorkflowValidator
  beforeEach(() => { validator = new WorkflowValidator(DEFAULT_ULTRACODE_CONFIG) })

  it("accepts a simple fanout workflow", () => {
    const r = validator.validate(parsed([{ kind: "fanout", name: "a", agents: [{ name: "x", task: "go", agent: "explore" }] }]))
    expect(r.result.valid).toBe(true)
    expect(r.def).toBeDefined()
    expect(r.result.stages).toBe(1)
    expect(r.result.agents).toBe(1)
  })

  it("returns no def when invalid (single-narrow contract: callers never re-derive)", () => {
    const r = validator.validate(parsed([{ kind: "nope", name: "a" }]))
    expect(r.result.valid).toBe(false)
    expect(r.def).toBeUndefined()
  })

  it("rejects empty / unknown-kind / unknown-agent / duplicate-name", () => {
    expect(validator.validate(parsed([])).result.valid).toBe(false)
    expect(validator.validate(parsed([{ kind: "nope", name: "a" }])).result.valid).toBe(false)
    expect(validator.validate(parsed([{ kind: "fanout", name: "a", agents: [{ name: "x", task: "t", agent: "wizard" }] }])).result.valid).toBe(false)
    expect(validator.validate(parsed([
      { kind: "fanout", name: "dup", agents: [{ name: "x", task: "t", agent: "explore" }] },
      { kind: "fanout", name: "dup", agents: [{ name: "y", task: "t", agent: "explore" }] },
    ])).result.valid).toBe(false)
  })

  it("rejects a verify stage whose source is not a prior stage", () => {
    const r = validator.validate(parsed([{ kind: "verify", name: "v", source: "ghost", task: "t", agent: "general", voters: 1 }]))
    expect(r.result.valid).toBe(false)
    expect(r.result.errors.some((e) => e.includes("ghost"))).toBe(true)
  })

  it("rejects a template referencing an unknown stage", () => {
    const r = validator.validate(parsed([{ kind: "fanout", name: "a", agents: [{ name: "x", task: "use {{stage.ghost}}", agent: "general" }] }]))
    expect(r.result.valid).toBe(false)
  })

  it("rejects a malformed structured-output schema before execute (the Object.entries(null) crash)", () => {
    // The exact regression: a fanout finder schema whose array `items` lacks
    // `fields` previously passed validate() and crashed execute() at fanout
    // prompt-build with an opaque "Object.entries requires ... not be null".
    const noItemFields = validator.validate(parsed([
      { kind: "fanout", name: "verify_findings", agents: [{ name: "f1", task: "find", agent: "general", schema: { fields: { findings: { type: "array", items: { finding_id: { type: "string" } } } } } }] },
      { kind: "verify", name: "adversarial_refute", source: "verify_findings", task: "refute {{finding}}", agent: "general", voters: 1, refuteThreshold: 1 },
    ]))
    expect(noItemFields.result.valid).toBe(false)
    expect(noItemFields.result.errors.some((e) => e.includes("schema") && e.includes("findings[]"))).toBe(true)

    // Missing top-level `fields` wrapper (a common authoring mistake).
    const noFields = validator.validate(parsed([
      { kind: "fanout", name: "f", agents: [{ name: "f1", task: "find", agent: "general", schema: { findings: { type: "array" } } }] },
    ]))
    expect(noFields.result.valid).toBe(false)
    expect(noFields.result.errors.some((e) => e.includes("must have a 'fields' object"))).toBe(true)

    // A well-formed schema still validates (no false positives).
    const ok = validator.validate(parsed([
      { kind: "fanout", name: "f", agents: [{ name: "f1", task: "find", agent: "general", schema: { fields: { findings: { type: "array", items: { fields: { id: { type: "string" } } } } } } }] },
    ]))
    expect(ok.result.valid).toBe(true)
  })

  it("rejects too many agents in a stage", () => {
    const agents = Array.from({ length: 17 }, (_, i) => ({ name: `a${i}`, task: "t", agent: "explore" }))
    expect(validator.validate(parsed([{ kind: "fanout", name: "a", agents }])).result.valid).toBe(false)
  })

  it("defaults verify refuteThreshold to a STRICT majority (floor(n/2)+1)", () => {
    const thr = (voters: number) => {
      const def = validator.buildDef(parsed([
        { kind: "fanout", name: "f", agents: [{ name: "a", task: "t", agent: "explore" }] },
        { kind: "verify", name: "v", source: "f", task: "t", agent: "general", voters },
      ]), [])!
      return (def.stages[1] as { refuteThreshold: number }).refuteThreshold
    }
    expect(thr(1)).toBe(1) // 1/1
    expect(thr(2)).toBe(2) // not 1 — a single dissenter must not drop on a tie
    expect(thr(3)).toBe(2) // 2/3
    expect(thr(4)).toBe(3) // not 2
  })

  it("narrows invalid agent types to a type-safe default rather than casting through them", () => {
    // CONTRACTS-04: an unknown agent type used to be `as AgentType`-cast through
    // to the executor. It now records an error AND yields a type-safe value, so
    // an invalid def (which validate rejects) can never carry a non-AgentType.
    const r = validator.validate(parsed([{ kind: "fanout", name: "a", agents: [{ name: "x", task: "t", agent: "wizard" }] }]))
    expect(r.result.valid).toBe(false)
    expect(r.result.errors.some((e) => e.includes("unknown agent type 'wizard'"))).toBe(true)
  })

  it("rejects an invalid maxConcurrent (ENG-VD-09: 0/negative/fractional silently clamped to 1)", () => {
    const expectInvalid = (mc: unknown) =>
      validator.validate(parsed([{ kind: "fanout", name: "a", agents: [{ name: "x", task: "t", agent: "explore" }], maxConcurrent: mc }])).result.valid
    expect(expectInvalid(0)).toBe(false)
    expect(expectInvalid(-1)).toBe(false)
    expect(expectInvalid(2.5)).toBe(false)
    expect(expectInvalid("2")).toBe(false)
    // positive integer + omitted are both valid
    expect(expectInvalid(1)).toBe(true)
    expect(expectInvalid(undefined)).toBe(true)
  })

  it("rejects a verify with mismatched voters and lenses.length (ENG-VF-06)", () => {
    const r = validator.validate(parsed([
      { kind: "fanout", name: "f", agents: [{ name: "a", task: "t", agent: "explore" }] },
      { kind: "verify", name: "v", source: "f", task: "t", agent: "general", voters: 3, lenses: ["l1", "l2"] },
    ]))
    expect(r.result.valid).toBe(false)
    expect(r.result.errors.some((e) => e.includes("must match 'lenses' length"))).toBe(true)
  })

  it("validates loop.dedupeKey against the body findings schema (ARCH-008)", () => {
    const body = (schema: unknown) => ({
      kind: "loop", name: "sweep", maxIterations: 3, dedupeKey: "id",
      body: { kind: "fanout", name: "round", agents: [{ name: "f", task: "find", agent: "explore", schema }] },
    })
    const goodSchema = { fields: { findings: { type: "array", items: { fields: { id: { type: "string" }, severity: { type: "string" } } } } } }
    expect(validator.validate(parsed([body(goodSchema)])).result.valid).toBe(true)

    const typo = validator.validate(parsed([body(goodSchema)])) // baseline: dedupeKey "id" is valid
    expect(typo.result.valid).toBe(true)

    // dedupeKey "finding_id" is NOT a field the body emits → typo, rejected.
    const bad: unknown = { ...body(goodSchema), dedupeKey: "finding_id" }
    const r = validator.validate(parsed([bad]))
    expect(r.result.valid).toBe(false)
    expect(r.result.errors.some((e) => e.includes("finding_id") && e.includes("not emitted"))).toBe(true)
  })

  it("estimates verify agent count from the source stage (ARCH-007)", () => {
    // 2 finder agents + verify × 3 voters over a 2-agent source = 2 + 6 = 8.
    const r = validator.validate(parsed([
      { kind: "fanout", name: "f", agents: [{ name: "a", task: "t", agent: "explore" }, { name: "b", task: "t", agent: "explore" }] },
      { kind: "verify", name: "v", source: "f", task: "t", agent: "general", voters: 3 },
    ]))
    expect(r.result.valid).toBe(true)
    expect(r.result.agents).toBe(2 + 2 * 3)
  })
})
