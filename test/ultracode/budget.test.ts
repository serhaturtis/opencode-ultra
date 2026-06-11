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
})
