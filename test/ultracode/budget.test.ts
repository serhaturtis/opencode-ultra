import { describe, it, expect } from "vitest"
import { Budget } from "../../src/ultracode/budget"

describe("Budget", () => {
  it("is unlimited when the limit is 0", () => {
    const b = new Budget(0)
    b.record(100, 100)
    expect(b.canSpend()).toBe(true)
    expect(b.exhausted).toBe(false)
  })

  it("stops spending once the limit is reached", () => {
    const b = new Budget(1)
    expect(b.canSpend()).toBe(true)
    b.record(1.5, 10)
    expect(b.canSpend()).toBe(false)
    expect(b.exhausted).toBe(true)
  })

  it("records dropped agents and totals in the report", () => {
    const b = new Budget(1)
    b.record(2, 100)
    b.drop()
    b.drop()
    const report = b.report()
    expect(report.droppedAgents).toBe(2)
    expect(report.spentTokens).toBe(100)
    expect(report.limitUsd).toBe(1)
    expect(report.exhausted).toBe(true)
  })

  it("enforces a maximum agent count independent of cost", () => {
    const b = new Budget(0, 2) // unlimited cost, max 2 agents
    expect(b.canSpend()).toBe(true)
    b.start()
    expect(b.canSpend()).toBe(true)
    b.start()
    expect(b.canSpend()).toBe(false) // 2 started → cap reached
    expect(b.exhausted).toBe(true)
  })

  it("reserves per-agent cost at start so a concurrent first wave can't overshoot (ENG-BG-02)", () => {
    // limit $3, per-agent cap $1. Without reservation, many agents could start
    // while spent is still 0; with reservation, starting one reserves $1.
    const b = new Budget(3, 0, 1)
    expect(b.canSpend()).toBe(true) // 0 + 0 + 1 ≤ 3
    b.start()                       // reserved 1
    expect(b.canSpend()).toBe(true) // 0 + 1 + 1 ≤ 3
    b.start()                       // reserved 2
    expect(b.canSpend()).toBe(true) // 0 + 2 + 1 = 3 ≤ 3
    b.start()                       // reserved 3
    expect(b.canSpend()).toBe(false) // 0 + 3 + 1 = 4 > 3 → first wave bounded
    // As agents finish and record their real (lower) cost, reservations release
    // and slack is reclaimed, allowing further starts.
    b.record(0.5, 10)               // spend 0.5, release 1 → reserved 2
    b.record(0.5, 10)               // spend 1.0, release 1 → reserved 1
    expect(b.canSpend()).toBe(true) // 1.0 + 1 + 1 = 3 ≤ 3
    expect(b.report().spentUsd).toBe(1)
  })

  it("release() settles a failed agent without recording spend", () => {
    const b = new Budget(1, 0, 0.5)
    b.start() // reserved 0.5
    expect(b.canSpend()).toBe(true) // 0 + 0.5 + 0.5 ≤ 1
    b.start() // reserved 1.0
    expect(b.canSpend()).toBe(false) // 0 + 1 + 0.5 > 1
    b.release() // the failed agent's reservation is returned
    expect(b.canSpend()).toBe(true) // slack reclaimed
    expect(b.report().spentUsd).toBe(0) // no spend recorded for a failed agent
  })
})
