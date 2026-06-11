import { describe, it, expect } from "vitest"
import { summarize } from "../../src/ultracode/summarizer"
import { DEFAULT_ULTRACODE_CONFIG } from "../../src/config"
import type { BudgetReport, WorkflowDef, WorkflowResults } from "../../src/contracts"

const def: WorkflowDef = { title: "My Flow", stages: [{ kind: "fanout", name: "audit", agents: [{ name: "a", task: "x", agent: "explore" }] }] }
const budget: BudgetReport = { spentUsd: 0.12, spentTokens: 1000, limitUsd: 0, exhausted: false, droppedAgents: 0 }

describe("summarize", () => {
  it("renders stage results, the title, and the budget line", () => {
    const results: WorkflowResults = {
      audit: { stage: "audit", kind: "fanout", agents: [{ name: "a", status: "completed", text: "found stuff", cost: 0, tokens: 0 }], findings: [] },
    }
    const out = summarize(def, results, DEFAULT_ULTRACODE_CONFIG, budget)
    expect(out).toContain("My Flow")
    expect(out).toContain("audit")
    expect(out).toContain("found stuff")
    expect(out).toContain("$0.1200")
  })

  it("lists findings and flags dropped agents from the budget", () => {
    const results: WorkflowResults = {
      audit: { stage: "audit", kind: "fanout", agents: [], findings: [{ title: "bug A" }] },
    }
    const out = summarize(def, results, DEFAULT_ULTRACODE_CONFIG, { ...budget, droppedAgents: 3, limitUsd: 1 })
    expect(out).toContain("finding")
    expect(out).toContain("bug A")
    expect(out).toContain("DROPPED")
  })

  it("dedupes identical findings when configured", () => {
    const results: WorkflowResults = {
      audit: { stage: "audit", kind: "fanout", agents: [], findings: [{ title: "dup" }, { title: "dup" }] },
    }
    const out = summarize(def, results, DEFAULT_ULTRACODE_CONFIG, budget)
    expect(out).toContain("1 finding(s)")
  })

  it("dedupes findings regardless of field order (different agents, arbitrary key order)", () => {
    const results: WorkflowResults = {
      audit: {
        stage: "audit", kind: "fanout", agents: [],
        // Same finding, fields in different orders — must collapse to one.
        findings: [{ id: "1", desc: "x" }, { desc: "x", id: "1" }],
      },
    }
    const out = summarize(def, results, DEFAULT_ULTRACODE_CONFIG, budget)
    expect(out).toContain("1 finding(s)")
  })
})
