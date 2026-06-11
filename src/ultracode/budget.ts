/**
 * Budget — enforces two runtime caps so a workflow can't run away:
 *  - a USD cost cap (`maxCostUsd`), measured against the real cost each agent
 *    reports, and
 *  - a total agent-count cap (`maxAgents`), the backstop when the cost cap is
 *    unlimited (the default) and a loop/verify stage could otherwise fan out
 *    without bound.
 * When either cap is reached, the engine stops spawning and the skipped agents
 * are counted as dropped (surfaced in the result — never a silent truncation).
 * A limit of 0 means unlimited.
 */
import { type BudgetReport } from "../contracts.js"

export class Budget {
  private spentUsd = 0
  private spentTokens = 0
  private started = 0
  private dropped = 0

  constructor(
    private readonly limitUsd: number,
    private readonly maxAgents = 0,
  ) {}

  /** Whether another agent is allowed to start. */
  canSpend(): boolean {
    if (this.maxAgents > 0 && this.started >= this.maxAgents) return false
    return this.limitUsd <= 0 || this.spentUsd < this.limitUsd
  }

  /** Record that an agent actually started running (counts toward maxAgents). */
  start(): void {
    this.started++
  }

  record(costUsd: number, tokens: number): void {
    this.spentUsd += costUsd
    this.spentTokens += tokens
  }

  /** Note that `n` agents were skipped because a cap was reached. */
  drop(n = 1): void {
    this.dropped += n
  }

  get exhausted(): boolean {
    return (this.maxAgents > 0 && this.started >= this.maxAgents) || (this.limitUsd > 0 && this.spentUsd >= this.limitUsd)
  }

  report(): BudgetReport {
    return {
      spentUsd: Math.round(this.spentUsd * 1e6) / 1e6,
      spentTokens: this.spentTokens,
      limitUsd: this.limitUsd,
      exhausted: this.exhausted,
      droppedAgents: this.dropped,
    }
  }
}
