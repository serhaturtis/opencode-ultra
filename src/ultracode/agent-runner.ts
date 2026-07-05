/**
 * runAgent — execute one agent turn end to end: budget/count gate → (optional
 * worktree) session → prompt (timeout, with retries for transient errors) →
 * schema validation → AgentResult, always cleaning up the session.
 *
 * A failed agent becomes an error result (it never aborts its siblings), but the
 * error is never masked: the message is carried through. Retries cover prompt
 * errors (network / rate-limit); schema-validation failures are deterministic
 * and are NOT retried.
 */
import { type ISdkClient } from "../sdk-client.js"
import { type AgentResult, type AgentRunStatus, type AgentSpec } from "../contracts.js"
import { withTimeout } from "./pool.js"
import { Budget } from "./budget.js"
import { describeSchema, parseAndValidate } from "./schema.js"
import { errMsg } from "../util.js"

export interface RunAgentOptions {
  readonly sdk: ISdkClient
  readonly parentSessionId: string
  readonly timeoutMs: number
  readonly budget: Budget
  readonly onStatus: (status: AgentRunStatus) => void
  /** Retries for a prompt that throws (transient errors). 0 = no retry. */
  readonly retries: number
  /** When set, the agent runs in this directory (an isolated worktree). */
  readonly directory?: string
}

export async function runAgent(spec: AgentSpec, task: string, opts: RunAgentOptions): Promise<AgentResult> {
  if (!opts.budget.canSpend()) {
    opts.budget.drop()
    opts.onStatus("error")
    return fail(spec.name, "skipped: workflow budget / agent-limit reached")
  }

  opts.budget.start()
  opts.onStatus("running")
  const prompt = spec.schema ? `${task}\n${describeSchema(spec.schema)}` : task

  let lastError = "agent did not run"
  const maxAttempts = Math.max(0, opts.retries) + 1
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let subId: string
    try {
      subId = await opts.sdk.createSession(opts.parentSessionId, `wf:${spec.name}`, opts.directory)
    } catch (err) {
      lastError = errMsg(err)
      continue // transient — retry session creation
    }
    try {
      const run = await withTimeout(
        opts.sdk.promptSession(subId, { agent: spec.agent, parts: [{ type: "text", text: prompt }] }),
        opts.timeoutMs,
        `agent '${spec.name}'`,
      )
      opts.budget.record(run.cost, run.tokens)

      // Schema validation is deterministic — succeed or fail here, never retry.
      if (spec.schema) {
        try {
          const data = parseAndValidate(run.text, spec.schema)
          opts.onStatus("completed")
          return { name: spec.name, status: "completed", text: run.text, data, cost: run.cost, tokens: run.tokens }
        } catch (err) {
          opts.onStatus("error")
          return { name: spec.name, status: "error", text: run.text, error: `schema validation failed: ${errMsg(err)}`, cost: run.cost, tokens: run.tokens }
        }
      }

      opts.onStatus("completed")
      return { name: spec.name, status: "completed", text: run.text, cost: run.cost, tokens: run.tokens }
    } catch (err) {
      lastError = errMsg(err) // prompt threw — retry
    } finally {
      await opts.sdk.deleteSession(subId)
    }
  }

  opts.onStatus("error")
  // All retries exhausted without a recorded cost: release the cost reservation
  // this agent's start() claimed, so reservedUsd doesn't permanently over-count
  // a failed agent's projected spend. started is intentionally NOT decremented —
  // maxAgents caps total starts (successful or not) as a hard ceiling.
  opts.budget.release()
  return fail(spec.name, lastError)
}

function fail(name: string, error: string): AgentResult {
  return { name, status: "error", text: "", error, cost: 0, tokens: 0 }
}
