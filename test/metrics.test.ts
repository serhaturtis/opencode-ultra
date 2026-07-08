import { describe, it, expect } from "vitest"
import { LogMetrics } from "../src/metrics"
import type { AgentResult, StageResult, WorkflowDef, BudgetReport } from "../src/contracts"

describe("LogMetrics", () => {
  it("emits structured JSON events via sdk.log", () => {
    const logs: Array<[string, string]> = []
    const sdk = { log(level: string, message: string) { logs.push([level, message]) } }
    const m = new LogMetrics(sdk as any)

    const agent: AgentResult = { name: "a", status: "completed", text: "ok", cost: 0.001, tokens: 100 }
    m.agentCompleted(agent, "stage1")
    m.agentFailed({ ...agent, status: "error", error: "boom" }, "stage1")

    const stage: StageResult = { stage: "s", kind: "fanout", agents: [], findings: [] }
    m.stageCompleted(stage, 500)

    const def: WorkflowDef = { title: "t", stages: [] }
    const report: BudgetReport = { spentUsd: 1, spentTokens: 1000, limitUsd: 5, exhausted: false, droppedAgents: 0 }
    m.workflowCompleted(def, report, 1000)

    m.autoClassification("ALLOW", "bash", "stage1", 10)
    m.autoDenied("bash", "rm -rf is dangerous")

    expect(logs.length).toBe(6)
    for (const [level, msg] of logs) {
      expect(level).toBe("info")
      const parsed = JSON.parse(msg)
      expect(parsed.event).toBeDefined()
      expect(parsed.ts).toBeGreaterThan(0)
    }
    expect(JSON.parse(logs[0]![1]!).event).toBe("agent.completed")
    expect(JSON.parse(logs[5]![1]!).event).toBe("auto.denied")
  })
})
