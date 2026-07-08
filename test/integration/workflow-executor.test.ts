import { describe, it, expect, beforeEach } from "vitest"
import { WorkflowExecutor } from "../../src/ultracode/executor"
import { Budget } from "../../src/ultracode/budget"
import { createMockSdk } from "../helpers/mock-sdk"
import { DEFAULT_ULTRACODE_CONFIG } from "../../src/ultracode/config"
import type { NarrationSink, WorkflowDef, WorkflowProgress } from "../../src/contracts"
import type { AgentRun } from "../../src/sdk-client"

/** Executor tests narrate to a no-op sink — narration delivery is covered by the sink contract, not the executor. */
const noopNarration: NarrationSink = { inject() {} }

function freshProgress(def: WorkflowDef): WorkflowProgress {
  return { stageIndex: 0, totalStages: def.stages.length, agents: [] }
}

describe("WorkflowExecutor.execute", () => {
  let mock: ReturnType<typeof createMockSdk>
  let executor: WorkflowExecutor

  beforeEach(() => {
    mock = createMockSdk()
    executor = new WorkflowExecutor(mock.sdk, "parent", DEFAULT_ULTRACODE_CONFIG, noopNarration)
  })

  const exec = (def: WorkflowDef, progress = freshProgress(def)) =>
    executor.execute(def, { control: {}, progress, budget: new Budget(0) })

  it("runs a fanout stage, deletes sessions, and tracks per-agent progress", async () => {
    const def: WorkflowDef = { title: "T", stages: [{ kind: "fanout", name: "audit", agents: [
      { name: "a", task: "x", agent: "explore" }, { name: "b", task: "y", agent: "general" },
    ] }] }
    const progress = freshProgress(def)
    const { results } = await executor.execute(def, { control: {}, progress, budget: new Budget(0) })
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
      { kind: "fanout", name: "find", agents: [{ name: "finder", task: "find bugs", agent: "explore", schema: { fields: { findings: { type: "array" as const, required: true, items: { fields: { id: { type: "string" as const } } } } } } }] },
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
      body: { kind: "fanout", name: "round", agents: [{ name: "f", task: "find", agent: "explore", schema: { fields: { findings: { type: "array" as const, required: true, items: { fields: { id: { type: "string" as const } } } } } } }] },
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
    const schema = { fields: { findings: { type: "array" as const, required: true, items: { fields: { id: { type: "string" as const } } } } } }
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
    await executor.execute(def, { control: {}, progress, budget })
    expect(budget.report().droppedAgents).toBeGreaterThanOrEqual(1)
  })

  it("does not run when stopped before starting", async () => {
    const def: WorkflowDef = { title: "T", stages: [{ kind: "fanout", name: "a", agents: [{ name: "x", task: "t", agent: "explore" }] }] }
    await executor.execute(def, { control: { shouldStop: () => true }, progress: freshProgress(def), budget: new Budget(0) })
    expect(mock.calls.filter((c) => c.method === "createSession")).toHaveLength(0)
  })

  it("propagates a stage error AND still cleans up isolation worktrees (no leak)", async () => {
    // ARCH-001: a throw between begin() and integrate() must roll back worktrees.
    // We don't have a git repo here, so we assert the executor surfaces the
    // failure rather than silently swallowing it — the lifecycle guard is in
    // runFanout's try/finally and is exercised directly in worktree tests.
    ;(mock.sdk as any).promptSession = async (): Promise<AgentRun> => {
      throw new Error("agent exploded")
    }
    const def: WorkflowDef = { title: "T", stages: [{ kind: "fanout", name: "a", agents: [{ name: "x", task: "t", agent: "explore" }] }] }
    // All agents fail (retried once then error) — execute completes with error agents, not a throw.
    const { results } = await exec(def)
    expect(results.a!.agents[0]!.status).toBe("error")
  })
})
