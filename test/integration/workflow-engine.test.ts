import { describe, it, expect, beforeEach } from "vitest"
import { WorkflowEngine } from "../../src/ultracode/engine"
import { Budget } from "../../src/ultracode/budget"
import { createMockSdk } from "../helpers/mock-sdk"
import { DEFAULT_ULTRACODE_CONFIG } from "../../src/config"
import type { WorkflowDef, WorkflowProgress } from "../../src/contracts"
import type { ParsedWorkflow } from "../../src/ultracode/parser"
import type { AgentRun } from "../../src/sdk-client"

const parsed = (stages: unknown[], title = "T"): ParsedWorkflow => ({ title, stages })

function freshProgress(def: WorkflowDef): WorkflowProgress {
  return { stageIndex: 0, totalStages: def.stages.length, agents: [] }
}

describe("WorkflowEngine.validate", () => {
  let engine: WorkflowEngine
  beforeEach(() => { engine = new WorkflowEngine(createMockSdk().sdk, "parent", DEFAULT_ULTRACODE_CONFIG) })

  it("accepts a simple fanout workflow", () => {
    const r = engine.validate(parsed([{ kind: "fanout", name: "a", agents: [{ name: "x", task: "go", agent: "explore" }] }]))
    expect(r.valid).toBe(true)
    expect(r.stages).toBe(1)
    expect(r.agents).toBe(1)
  })

  it("rejects empty / unknown-kind / unknown-agent / duplicate-name", () => {
    expect(engine.validate(parsed([])).valid).toBe(false)
    expect(engine.validate(parsed([{ kind: "nope", name: "a" }])).valid).toBe(false)
    expect(engine.validate(parsed([{ kind: "fanout", name: "a", agents: [{ name: "x", task: "t", agent: "wizard" }] }])).valid).toBe(false)
    expect(engine.validate(parsed([
      { kind: "fanout", name: "dup", agents: [{ name: "x", task: "t", agent: "explore" }] },
      { kind: "fanout", name: "dup", agents: [{ name: "y", task: "t", agent: "explore" }] },
    ])).valid).toBe(false)
  })

  it("rejects a verify stage whose source is not a prior stage", () => {
    const r = engine.validate(parsed([{ kind: "verify", name: "v", source: "ghost", task: "t", agent: "general", voters: 1 }]))
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes("ghost"))).toBe(true)
  })

  it("rejects a template referencing an unknown stage", () => {
    const r = engine.validate(parsed([{ kind: "fanout", name: "a", agents: [{ name: "x", task: "use {{stage.ghost}}", agent: "general" }] }]))
    expect(r.valid).toBe(false)
  })

  it("rejects too many agents in a stage", () => {
    const agents = Array.from({ length: 17 }, (_, i) => ({ name: `a${i}`, task: "t", agent: "explore" }))
    expect(engine.validate(parsed([{ kind: "fanout", name: "a", agents }])).valid).toBe(false)
  })

  it("defaults verify refuteThreshold to a STRICT majority (floor(n/2)+1)", () => {
    const thr = (voters: number) => {
      const def = engine.buildDef(parsed([
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
})

describe("WorkflowEngine.execute", () => {
  let mock: ReturnType<typeof createMockSdk>
  let engine: WorkflowEngine

  beforeEach(() => {
    mock = createMockSdk()
    engine = new WorkflowEngine(mock.sdk, "parent", DEFAULT_ULTRACODE_CONFIG)
  })

  const exec = (def: WorkflowDef, progress = freshProgress(def)) =>
    engine.execute(def, { control: {}, progress, budget: new Budget(0) })

  it("runs a fanout stage, deletes sessions, and tracks per-agent progress", async () => {
    const def: WorkflowDef = { title: "T", stages: [{ kind: "fanout", name: "audit", agents: [
      { name: "a", task: "x", agent: "explore" }, { name: "b", task: "y", agent: "general" },
    ] }] }
    const progress = freshProgress(def)
    const { results } = await engine.execute(def, { control: {}, progress, budget: new Budget(0) })
    expect(results.audit!.agents).toHaveLength(2)
    expect(mock.calls.filter((c) => c.method === "createSession")).toHaveLength(2)
    expect(mock.calls.filter((c) => c.method === "deleteSession")).toHaveLength(2)
    expect(progress.agents.every((a) => a.status === "completed")).toBe(true)
  })

  it("flows pipeline items through steps with templates", async () => {
    const seen: string[] = []
    ;(mock.sdk as any).promptSession = async (_id: string, opts: any): Promise<AgentRun> => {
      if (opts.noReply) return { text: "", cost: 0, tokens: 0 }
      seen.push(opts.parts[0].text)
      return { text: "step-done", cost: 0, tokens: 0 }
    }
    const def: WorkflowDef = { title: "T", stages: [{ kind: "pipeline", name: "p", over: ["fileA"], steps: [
      { name: "review", task: "review {{item}}", agent: "general" },
      { name: "fix", task: "fix using {{step.review}}", agent: "general" },
    ] }] }
    const { results } = await exec(def)
    expect(results.p!.agents[0]!.name).toBe("fileA") // output named by item
    expect(seen.some((t) => t.includes("review fileA"))).toBe(true)
    expect(seen.some((t) => t.includes("fix using step-done"))).toBe(true)
  })

  it("verify drops findings that a majority refutes", async () => {
    ;(mock.sdk as any).promptSession = async (_id: string, opts: any): Promise<AgentRun> => {
      const text = opts.parts?.[0]?.text ?? ""
      if (opts.noReply) return { text: "", cost: 0, tokens: 0 }
      if (text.includes("REFUTE")) return { text: '{"refuted": true, "reason": "not real"}', cost: 0, tokens: 0 }
      return { text: '{"findings":[{"id":"f1","desc":"maybe a bug"}]}', cost: 0, tokens: 0 }
    }
    const def: WorkflowDef = { title: "T", stages: [
      { kind: "fanout", name: "find", agents: [{ name: "finder", task: "find bugs", agent: "explore", schema: { fields: { findings: { type: "array", required: true, items: { fields: { id: { type: "string" } } } } } } }] },
      { kind: "verify", name: "check", source: "find", task: "REFUTE this finding: {{finding}}", agent: "general", voters: 1, refuteThreshold: 1 },
    ] }
    const { results } = await exec(def)
    expect(results.find!.findings).toHaveLength(1)
    expect(results.check!.findings).toHaveLength(0) // refuted → dropped
  })

  it("loop stops when a round produces no new findings", async () => {
    ;(mock.sdk as any).promptSession = async (_id: string, opts: any): Promise<AgentRun> => {
      if (opts.noReply) return { text: "", cost: 0, tokens: 0 }
      return { text: '{"findings":[{"id":"same"}]}', cost: 0, tokens: 0 } // always the same finding
    }
    const def: WorkflowDef = { title: "T", stages: [{
      kind: "loop", name: "sweep", maxIterations: 5, dedupeKey: "id",
      body: { kind: "fanout", name: "round", agents: [{ name: "f", task: "find", agent: "explore", schema: { fields: { findings: { type: "array", required: true, items: { fields: { id: { type: "string" } } } } } } }] },
    }] }
    const { results } = await exec(def)
    expect(results.sweep!.findings).toHaveLength(1) // deduped across iterations
    // iteration 1 finds it, iteration 2 finds nothing new → stops (2 finder runs, not 5)
    expect(mock.calls.filter((c) => c.method === "createSession")).toHaveLength(2)
  })

  it("a later stage referencing a loop agent gets the LAST iteration's output", async () => {
    let consumed = ""
    let gen = 0
    ;(mock.sdk as any).promptSession = async (_id: string, opts: any): Promise<AgentRun> => {
      if (opts.noReply) return { text: "", cost: 0, tokens: 0 }
      const task = opts.parts?.[0]?.text ?? ""
      if (task.startsWith("CONSUME")) { consumed = task; return { text: "ok", cost: 0, tokens: 0 } }
      gen += 1 // unique id per round → loop runs to maxIterations (2), accumulating two 'gen' agents
      return { text: `{"findings":[{"id":"iter${gen}"}]}`, cost: 0, tokens: 0 }
    }
    const schema = { fields: { findings: { type: "array", required: true, items: { fields: { id: { type: "string" } } } } } }
    const def: WorkflowDef = { title: "T", stages: [
      { kind: "loop", name: "sweep", maxIterations: 2, dedupeKey: "id",
        body: { kind: "fanout", name: "round", agents: [{ name: "gen", task: "find", agent: "explore", schema }] } },
      { kind: "fanout", name: "use", agents: [{ name: "c", task: "CONSUME {{stage.sweep.gen}}", agent: "general" }] },
    ] }
    await exec(def)
    expect(consumed).toContain("iter2") // last iteration's output, not the first
    expect(consumed).not.toContain("iter1")
  })

  it("stops spawning when the budget is exhausted (and reports drops)", async () => {
    ;(mock.sdk as any).promptSession = async (_id: string, opts: any): Promise<AgentRun> =>
      opts.noReply ? { text: "", cost: 0, tokens: 0 } : { text: "done", cost: 1, tokens: 10 }
    const def: WorkflowDef = { title: "T", stages: [{ kind: "fanout", name: "a", agents: [
      { name: "x", task: "t", agent: "explore" }, { name: "y", task: "t", agent: "explore" }, { name: "z", task: "t", agent: "explore" },
    ], maxConcurrent: 1 }] }
    const budget = new Budget(1) // first agent ($1) exhausts it
    const progress = freshProgress(def)
    await engine.execute(def, { control: {}, progress, budget })
    expect(budget.report().droppedAgents).toBeGreaterThanOrEqual(1)
  })

  it("does not run when stopped before starting", async () => {
    const def: WorkflowDef = { title: "T", stages: [{ kind: "fanout", name: "a", agents: [{ name: "x", task: "t", agent: "explore" }] }] }
    await engine.execute(def, { control: { shouldStop: () => true }, progress: freshProgress(def), budget: new Budget(0) })
    expect(mock.calls.filter((c) => c.method === "createSession")).toHaveLength(0)
  })
})
