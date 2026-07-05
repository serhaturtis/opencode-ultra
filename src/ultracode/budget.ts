/**
 * Per-workflow budget: USD cost cap, agent-count cap, and start-time cost
 * reservation (prevents concurrent-first-wave overshoot of maxCostUsd).
 */
import { type BudgetReport } from "../contracts.js"

export class Budget {
  private spentUsd = 0
  private spentTokens = 0
  private reservedUsd = 0
  private started = 0
  private dropped = 0

  constructor(
    private readonly limitUsd: number,
    private readonly maxAgents = 0,
    private readonly agentCostCapUsd = 0,
  ) {}

  canSpend(): boolean {
    if (this.maxAgents > 0 && this.started >= this.maxAgents) return false
    if (this.limitUsd <= 0) return true
    return this.spentUsd + this.reservedUsd + this.agentCostCapUsd <= this.limitUsd
  }

  /** Count toward maxAgents + reserve the per-agent cost cap. */
  start(): void {
    this.started++
    this.reservedUsd += this.agentCostCapUsd
  }

  /** Spend the agent's real cost + release its reservation. */
  record(costUsd: number, tokens: number): void {
    this.spentUsd += costUsd
    this.spentTokens += tokens
    this.reservedUsd = Math.max(0, this.reservedUsd - this.agentCostCapUsd)
  }

  /** Release a failed agent's reservation without recording spend. */
  release(): void {
    this.reservedUsd = Math.max(0, this.reservedUsd - this.agentCostCapUsd)
  }

  drop(n = 1): void {
    this.dropped += n
  }

  get exhausted(): boolean {
    return (this.maxAgents > 0 && this.started >= this.maxAgents)
      || (this.limitUsd > 0 && this.spentUsd + this.reservedUsd >= this.limitUsd)
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
