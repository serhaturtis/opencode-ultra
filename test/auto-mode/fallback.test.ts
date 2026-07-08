import { describe, it, expect } from "vitest"
import { createState } from "../../src/state"
import { compileConfig, DEFAULT_DISABLED_CONFIG } from "../../src/config"
import { activate, deactivate, recordDenial, recordApproval, onCompaction } from "../../src/auto-mode/fallback"
import { TtlVerdictCache } from "../../src/auto-mode/verdict-cache"
import type { CompiledConfig, WorkflowJob } from "../../src/contracts"

const factory = (ttlMs: number) => new TtlVerdictCache(ttlMs)
const ENABLED: CompiledConfig = compileConfig({ autoMode: { enabled: true, defaultMode: true } })
const DISABLED = DEFAULT_DISABLED_CONFIG

describe("SessionStore", () => {
  it("get creates state lazily; peek does not", () => {
    const state = createState(() => DISABLED, undefined, factory)
    expect(state.sessions.peek("s1")).toBeUndefined()
    const s = state.sessions.get("s1")
    expect(state.sessions.peek("s1")).toBe(s)
    expect(state.sessions.get("s1")).toBe(s) // same instance
  })

  it("new sessions start active only when enabled + defaultMode", () => {
    expect(createState(() => DISABLED, undefined, factory).sessions.get("s").autoMode.active).toBe(false)
    expect(createState(() => ENABLED, undefined, factory).sessions.get("s").autoMode.active).toBe(true)
  })

  it("isolates state between sessions", () => {
    const state = createState(() => ENABLED, undefined, factory)
    const a = state.sessions.get("a").autoMode
    const b = state.sessions.get("b").autoMode
    deactivate(a)
    expect(a.active).toBe(false)
    expect(b.active).toBe(true) // unaffected
  })

  it("remove drops session state", () => {
    const state = createState(() => ENABLED, undefined, factory)
    state.sessions.get("a")
    state.sessions.remove("a")
    expect(state.sessions.peek("a")).toBeUndefined()
  })
})

describe("fallback transitions", () => {
  const auto = () => createState(() => ENABLED, undefined, factory).sessions.get("s").autoMode

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

  it("recordApproval resets consecutive and resumes if paused, but keeps the lifetime totalDenials", () => {
    const a = auto()
    a.paused = true; a.totalDenials = 25; a.consecutiveDenials = 2
    recordApproval(a)
    expect(a.consecutiveDenials).toBe(0)
    expect(a.paused).toBe(false)
    // AM-07: totalDenials is a SESSION-LIFETIME circuit breaker, not a per-pause
    // cycle cap. Resetting it on every resume defeated the maxTotalDenials guard.
    expect(a.totalDenials).toBe(25)
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
    const state = createState(() => ENABLED, undefined, factory)
    let stopped = false
    const job: WorkflowJob = {
      id: "w1", title: "t", parentSessionId: "s1", def: { title: "t", stages: [] },
      status: "running", progress: { stageIndex: 0, totalStages: 0, agents: [] },
      execute: async () => {}, pause() {}, resume() {}, stop() { stopped = true },
      statusReport: () => "", summarizedOutput: () => "",
    }
    state.workflows.jobs.set("w1", job)
    state.workflows.shutdown()
    expect(stopped).toBe(true)
    expect(state.workflows.jobs.size).toBe(0)
  })
})
