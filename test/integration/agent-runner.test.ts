import { describe, it, expect } from "vitest"
import { runAgent, type RunAgentOptions } from "../../src/ultracode/agent-runner"
import { Budget } from "../../src/ultracode/budget"
import { createMockSdk } from "../helpers/mock-sdk"
import type { AgentSpec, OutputSchema } from "../../src/contracts"
import type { AgentRun } from "../../src/sdk-client"

const spec = (over: Partial<AgentSpec> = {}): AgentSpec => ({ name: "x", task: "t", agent: "explore", ...over })
const opts = (mock: ReturnType<typeof createMockSdk>, over: Partial<RunAgentOptions> = {}): RunAgentOptions => ({
  sdk: mock.sdk, parentSessionId: "p", timeoutMs: 1000, budget: new Budget(0), onStatus: () => {}, retries: 0, ...over,
})
const findingsSchema: OutputSchema = { fields: { findings: { type: "array", required: true, items: { fields: {} } } } }
const run = (r: AgentRun) => async () => r

describe("runAgent", () => {
  it("runs an agent, records usage, and cleans up the session", async () => {
    const mock = createMockSdk()
    ;(mock.sdk as any).promptSession = run({ text: "done", cost: 0.01, tokens: 50 })
    const budget = new Budget(0)
    const result = await runAgent(spec(), "t", opts(mock, { budget }))
    expect(result.status).toBe("completed")
    expect(result.text).toBe("done")
    expect(result.cost).toBe(0.01)
    expect(mock.calls.some((c) => c.method === "deleteSession")).toBe(true)
    expect(budget.report().spentTokens).toBe(50)
  })

  it("validates structured output and errors on mismatch", async () => {
    const mock = createMockSdk()
    ;(mock.sdk as any).promptSession = run({ text: '{"findings":[]}', cost: 0, tokens: 0 })
    const good = await runAgent(spec({ schema: findingsSchema }), "t", opts(mock))
    expect(good.status).toBe("completed")
    expect(good.data).toEqual({ findings: [] })

    ;(mock.sdk as any).promptSession = run({ text: "not json", cost: 0, tokens: 0 })
    const bad = await runAgent(spec({ schema: findingsSchema }), "t", opts(mock))
    expect(bad.status).toBe("error")
    expect(bad.error).toMatch(/schema/)
  })

  it("skips and counts a drop when the budget is exhausted", async () => {
    const mock = createMockSdk()
    const budget = new Budget(1)
    budget.record(2, 0)
    const result = await runAgent(spec(), "t", opts(mock, { budget }))
    expect(result.status).toBe("error")
    expect(result.error).toMatch(/budget/)
    expect(budget.report().droppedAgents).toBe(1)
    expect(mock.calls.some((c) => c.method === "createSession")).toBe(false) // never spawned
  })

  it("times out a slow agent (and still deletes the session)", async () => {
    const mock = createMockSdk()
    ;(mock.sdk as any).promptSession = async () => { await new Promise((r) => setTimeout(r, 1000)); return { text: "x", cost: 0, tokens: 0 } }
    const result = await runAgent(spec(), "t", opts(mock, { timeoutMs: 20 }))
    expect(result.status).toBe("error")
    expect(result.error).toMatch(/timed out/)
    expect(mock.calls.some((c) => c.method === "deleteSession")).toBe(true)
  })

  it("retries a transient prompt error, then succeeds", async () => {
    const mock = createMockSdk()
    let calls = 0
    ;(mock.sdk as any).promptSession = async () => {
      calls++
      if (calls === 1) throw new Error("rate limit")
      return { text: "recovered", cost: 0, tokens: 0 }
    }
    const result = await runAgent(spec(), "t", opts(mock, { retries: 1 }))
    expect(result.status).toBe("completed")
    expect(result.text).toBe("recovered")
    expect(calls).toBe(2)
  })

  it("does NOT retry a schema-validation failure (deterministic)", async () => {
    const mock = createMockSdk()
    let calls = 0
    ;(mock.sdk as any).promptSession = async () => { calls++; return { text: "not json", cost: 0, tokens: 0 } }
    const result = await runAgent(spec({ schema: findingsSchema }), "t", opts(mock, { retries: 3 }))
    expect(result.status).toBe("error")
    expect(calls).toBe(1) // tried once, no retry
  })

  it("counts a single drop and one start regardless of retries", async () => {
    const mock = createMockSdk()
    ;(mock.sdk as any).promptSession = run({ text: "ok", cost: 0, tokens: 0 })
    const budget = new Budget(0, 1)
    await runAgent(spec(), "t", opts(mock, { budget, retries: 2 }))
    expect(budget.canSpend()).toBe(false) // one start consumed the single-agent budget
  })

  it("retries when createSession throws (transient), then succeeds", async () => {
    const mock = createMockSdk()
    let creates = 0
    const origCreate = mock.sdk.createSession
    mock.sdk.createSession = async (pid, title, dir) => {
      creates++
      if (creates === 1) throw new Error("network blip")
      return origCreate(pid, title, dir)
    }
    ;(mock.sdk as any).promptSession = run({ text: "ok", cost: 0, tokens: 0 })
    const result = await runAgent(spec(), "t", opts(mock, { retries: 1 }))
    expect(result.status).toBe("completed")
    expect(creates).toBe(2)
  })

  it("passes the worktree directory through to createSession", async () => {
    const mock = createMockSdk()
    ;(mock.sdk as any).promptSession = run({ text: "ok", cost: 0, tokens: 0 })
    await runAgent(spec(), "t", opts(mock, { directory: "/tmp/wt" }))
    const create = mock.calls.find((c) => c.method === "createSession")
    expect(create?.args[2]).toBe("/tmp/wt")
  })
})
