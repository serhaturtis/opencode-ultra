import type { AgentResult, BudgetReport, Metrics, StageResult, WorkflowDef } from "./contracts.js"
import type { ISdkClient } from "./sdk-client.js"

/** Writes structured JSON metrics to the opencode server log. */
export class LogMetrics implements Metrics {
  constructor(private readonly sdk: ISdkClient) {}

  agentCompleted(a: AgentResult, stage: string): void {
    this.emit("agent.completed", { agent: a.name, stage, cost: a.cost, tokens: a.tokens })
  }
  agentFailed(a: AgentResult, stage: string): void {
    this.emit("agent.failed", { agent: a.name, stage, error: a.error })
  }
  stageCompleted(r: StageResult, durationMs: number): void {
    this.emit("stage.completed", {
      stage: r.stage, kind: r.kind, agents: r.agents.length,
      findings: r.findings.length, durationMs,
    })
  }
  workflowCompleted(def: WorkflowDef, report: BudgetReport, durationMs: number): void {
    this.emit("workflow.completed", {
      title: def.title, stages: def.stages.length,
      spentUsd: report.spentUsd, spentTokens: report.spentTokens,
      droppedAgents: report.droppedAgents, durationMs,
    })
  }
  autoClassification(verdict: string, tool: string, source: "stage1" | "stage2", durationMs: number): void {
    this.emit("auto.classification", { verdict, tool, source, durationMs })
  }
  autoDenied(tool: string, reason: string): void {
    this.emit("auto.denied", { tool, reason })
  }

  private emit(event: string, data: Record<string, unknown>): void {
    this.sdk.log("info", JSON.stringify({ event, ts: Date.now(), ...data }))
  }
}

/** No-op metrics for tests and environments where observability is not wired. */
export const NoopMetrics: Metrics = {
  agentCompleted() {}, agentFailed() {}, stageCompleted() {}, workflowCompleted() {},
  autoClassification() {}, autoDenied() {},
}
