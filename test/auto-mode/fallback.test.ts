import { describe, it, expect } from "vitest"
import { createState } from "../../src/state"
import { compileConfig, DEFAULT_DISABLED_CONFIG } from "../../src/config"
import { activate, deactivate, recordDenial, recordApproval, onCompaction } from "../../src/auto-mode/fallback"
import type { CompiledConfig, WorkflowJob } from "../../src/contracts"

const ENABLED: CompiledConfig = compileConfig({ autoMode: { enabled: true, defaultMode: true } })
const DISABLED = DEFAULT_DISABLED_CONFIG

describe("SessionStore", () => {
  it("get creates state lazily; peek does not", () => {
    const state = createState(() => DISABLED)
    expect(state.sessions.peek("s1")).toBeUndefined()
    const s = state.sessions.get("s1")
    expect(state.sessions.peek("s1")).toBe(s)
    expect(state.sessions.get("s1")).toBe(s) // same instance
  })

  it("new sessions start active only when enabled + defaultMode", () => {
    expect(createState(() => DISABLED).sessions.get("s").autoMode.active).toBe(false)
    expect(createState(() => ENABLED).sessions.get("s").autoMode.active).toBe(true)
  })

  it("isolates state between sessions", () => {
    const state = createState(() => ENABLED)
    const a = state.sessions.get("a").autoMode
    const b = state.sessions.get("b").autoMode
    deactivate(a)
    expect(a.active).toBe(false)
    expect(b.active).toBe(true) // unaffected
  })

  it("remove drops session state", () => {
    const state = createState(() => ENABLED)
    state.sessions.get("a")
    state.sessions.remove("a")
    expect(state.sessions.peek("a")).toBeUndefined()
  })
})

describe("fallback transitions", () => {
  const auto = () => createState(() => ENABLED).sessions.get("s").autoMode

  it("recordDenial increments and pauses at the consecutive threshold", () => {
    const a = auto()
    expect(recordDenial(a, 3, 20)).toBe(false)
    recordDenial(a, 3, 20)
    expect(recordDenial(a, 3, 20)).toBe(true)
    expect(a.paused).toBe(true)
    expect(a.consecutiveDenials).toBe(3)
  })

  it("recordDenial pauses at the total threshold even if consecutive resets", () => {
    const a = auto()
    for (let i = 0; i < 20; i++) { a.consecutiveDenials = 0; recordDenial(a, 3, 20) }
    expect(a.paused).toBe(true)
    expect(a.totalDenials).toBe(20)
  })

  it("recordApproval resets consecutive and resumes if paused", () => {
    const a = auto()
    a.paused = true; a.totalDenials = 25; a.consecutiveDenials = 2
    recordApproval(a)
    expect(a.consecutiveDenials).toBe(0)
    expect(a.paused).toBe(false)
    expect(a.totalDenials).toBe(0)
  })

  it("activate resets counters, cache, and boundaries", () => {
    const a = auto()
    a.consecutiveDenials = 5
    a.boundaries.push("x")
    a.verdicts.record("bash", "c", "id", { verdict: "DENY", reason: "" })
    activate(a)
    expect(a.active).toBe(true)
    expect(a.consecutiveDenials).toBe(0)
    expect(a.boundaries).toHaveLength(0)
    expect(a.verdicts.consumeByCall("id")).toBeUndefined()
  })

  it("onCompaction resets counters/cache/boundaries and unpauses", () => {
    const a = auto()
    a.paused = true; a.totalDenials = 10
    a.boundaries.push("x")
    a.verdicts.record("bash", "c", "id", { verdict: "ALLOW", reason: "" })
    onCompaction(a)
    expect(a.paused).toBe(false)
    expect(a.totalDenials).toBe(0)
    expect(a.boundaries).toHaveLength(0)
    expect(a.verdicts.consumeByCall("id")).toBeUndefined()
  })
})

describe("workflow registry", () => {
  it("shutdown stops and clears jobs", () => {
    const state = createState(() => ENABLED)
    let stopped = false
    const job: WorkflowJob = {
      id: "w1", title: "t", phases: [], status: "running",
      execute: async () => {}, pause() {}, resume() {}, stop() { stopped = true },
      statusReport: () => "", summarizedOutput: () => "",
    }
    state.workflows.jobs.set("w1", job)
    state.workflows.shutdown()
    expect(stopped).toBe(true)
    expect(state.workflows.jobs.size).toBe(0)
  })
})
