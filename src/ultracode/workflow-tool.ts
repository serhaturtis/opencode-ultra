/**
 * Workflow tool — validate → execute (background) → resume.
 *
 * The workflow is supplied as a JSON/JS `definition` string (the IR is too
 * heterogeneous for a flat tool schema) and parsed structurally — no code
 * execution. Each job owns its live progress, budget, and resume journal.
 */
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import { tool } from "@opencode-ai/plugin"
import { type ISdkClient } from "../sdk-client.js"
import {
  type BudgetReport,
  type CompiledConfig,
  type Metrics,
  type NarrationSink,
  type UltraState,
  type ValidationResult,
  type WorkflowControl,
  type WorkflowDef,
  type WorkflowJob,
  type WorkflowProgress,
} from "../contracts.js"
import { parse } from "./parser.js"
import { WorkflowValidator } from "./validator.js"
import { WorkflowExecutor } from "./executor.js"
import { Budget } from "./budget.js"
import { FileJournal } from "./journal.js"
import { renderProgress } from "./workflow-manager.js"
import { WorktreeManager } from "./worktree.js"
import { completeJob } from "../state.js"
import { errMsg } from "../util.js"
import { WorkflowLimitError, WorkflowNotFoundError, WorkflowParseError } from "../errors.js"

export function createWorkflowTool(
  sdk: ISdkClient,
  state: UltraState,
  getConfig: () => CompiledConfig,
  projectDir: string,
  worktrees: WorktreeManager,
  metrics: Metrics,
) {
  return tool({
    description: `Orchestrate multi-stage, multi-agent workflows.

STEPS:
1. workflow({ action: "execute", definition }) — validate + start in the background, one call. This is the normal path.
   To preview cost without running: workflow({ action: "validate", definition }) returns the estimate only.
2. workflow({ action: "resume", workflowId }) — re-run a previous workflow, skipping journaled stages.
   (workflowId comes from a started run / the workflow-manager list — validate does not start one.)

AFTER execute: STOP. Tell the user it's running and end your turn. The result is delivered to you
automatically as a new message when the workflow finishes — you do NOT wait for it or check on it.
Do NOT call workflow-manager to poll; while a workflow runs it returns nothing useful.

definition is JSON: { "title": "...", "stages": [ ... ] }. Stage kinds:
- fanout:   { kind, name, agents: [{ name, task, agent: "general"|"explore", schema? }], maxConcurrent?, isolate? }
  Use \"explore\" for finder/data-gathering agents (read-only, fast, no sub-workflow risk).
  Use \"general\" for reasoning, verification, and synthesis tasks.
- pipeline: { kind, name, over: ["a","b"], steps: [{ name, task, agent }] }   // per-item, no barrier; tasks see {{item}}, {{step.X}}
- verify:   { kind, name, source: "<stage>", task, agent, voters, refuteThreshold?, lenses? }  // task sees {{finding}}
- loop:     { kind, name, body: <fanout>, maxIterations, dedupeKey }            // repeats until no new findings

Cross-stage results: {{stage.<name>}} or {{stage.<name>.<agent>}}.
Declare a schema ({ fields: { findings: { type:"array", items:{ fields:{...} } } } }) to get validated
structured output; verify/loop consume the flattened findings.`,

    args: {
      action: tool.schema.string(),
      workflowId: tool.schema.string().optional(),
      definition: tool.schema.string().optional(),
    },

    execute: async (args, ctx) => {
      const config = getConfig()
      switch (args.action) {
        case "validate": return handleValidate(args, sdk, ctx, config)
        case "execute": return handleExecute(args, sdk, ctx, state, config, projectDir, worktrees, metrics)
        case "resume": return handleResume(args, sdk, ctx, state, config, projectDir, worktrees, metrics)
        default: throw new Error(`Unknown action '${args.action}'. Use 'validate', 'execute', or 'resume'.`)
      }
    },
  })
}

// ── parse + statically validate (no side effects) ─────────────────────────────

type ValidateResult = { result: ValidationResult; def: WorkflowDef } | { invalid: ToolOutput }

/** Single source of truth for parsing + statically validating a definition. Pure — registers nothing. */
function parseAndValidate(
  definition: string,
  sdk: ISdkClient,
  ctx: { sessionID: string },
  config: CompiledConfig,
): ValidateResult {
  let parsed
  try {
    parsed = parse(definition)
  } catch (err) {
    if (err instanceof WorkflowParseError) return { invalid: output("Workflow validation: INVALID", err.message) }
    throw err
  }
  const validator = new WorkflowValidator(config.ultracode)
  const { result: partial, def } = validator.validate(parsed)
  if (!partial.valid || !def) return { invalid: output("Workflow validation: INVALID", formatValidation(partial)) }
  // The id is a job-level concern (the tool layer), not a validation concern.
  const result: ValidationResult = { ...partial, id: randomUUID().slice(0, 8) }
  return { result, def }
}

// ── validate (pure dry run: preview + cost, no execution, no state) ────────────

function handleValidate(
  args: { definition?: string },
  sdk: ISdkClient,
  ctx: { sessionID: string },
  config: CompiledConfig,
): ToolOutput {
  if (!args.definition) throw new Error("'definition' is required for the validate action")
  const checked = parseAndValidate(args.definition, sdk, ctx, config)
  if ("invalid" in checked) return checked.invalid
  return { title: "Workflow validation: VALID", output: formatValidation(checked.result), metadata: {} }
}

// ── execute: validate + start a definition in the background (one call) ────────

function handleExecute(
  args: { definition?: string },
  sdk: ISdkClient,
  ctx: ToolCtx,
  state: UltraState,
  config: CompiledConfig,
  projectDir: string,
  worktrees: WorktreeManager,
  metrics: Metrics,
): ToolOutput {
  if (!args.definition) throw new Error("'definition' is required for the execute action.")
  const checked = parseAndValidate(args.definition, sdk, ctx, config)
  if ("invalid" in checked) return checked.invalid

  enforceConcurrency(state, config)
  const job = makeJob(checked.result.id, checked.def, sdk, ctx.sessionID, state, config, projectDir, worktrees, metrics)
  state.workflows.jobs.set(job.id, job)
  void job.execute() // runs in the background; notifies the session on completion
  return startedOutput(job)
}

async function handleResume(
  args: { workflowId?: string },
  sdk: ISdkClient,
  ctx: ToolCtx,
  state: UltraState,
  config: CompiledConfig,
  projectDir: string,
  worktrees: WorktreeManager,
  metrics: Metrics,
): Promise<ToolOutput> {
  if (!args.workflowId) throw new Error("'workflowId' is required for the resume action")

  // Resume an in-memory job, or reconstruct one from its on-disk journal.
  let job = state.workflows.jobs.get(args.workflowId)
  if (!job) {
    const journalDir = path.join(projectDir, config.ultracode.journalDir)
    const stored = await FileJournal.read(journalDir, args.workflowId)
    if (!stored) throw new WorkflowNotFoundError(args.workflowId)
    job = makeJob(args.workflowId, stored.def, sdk, ctx.sessionID, state, config, projectDir, worktrees, metrics)
    state.workflows.jobs.set(job.id, job)
  }
  if (job.status === "running") throw new Error(`Workflow ${args.workflowId} is already running`)
  enforceConcurrency(state, config)

  job.status = "pending"
  void job.execute() // runs in the background; notifies the session on completion
  return startedOutput(job)
}

function enforceConcurrency(state: UltraState, config: CompiledConfig): void {
  const max = config.ultracode.workflowRuntime.maxConcurrentWorkflows
  // Count running AND pending (not just running) — a pending job is about to flip
  // to running, so counting it prevents the check-then-act race where two execute
  // calls both pass the gate before either sets status to "running".
  const active = [...state.workflows.jobs.values()].filter((j) => j.status === "running" || j.status === "pending").length
  if (active >= max) throw new WorkflowLimitError(max, active)
}

// ── Job factory ──────────────────────────────────────────────────────────────

function makeJob(
  id: string,
  def: WorkflowDef,
  sdk: ISdkClient,
  parentSessionId: string,
  state: UltraState,
  config: CompiledConfig,
  projectDir: string,
  worktrees: WorktreeManager,
  metrics: Metrics,
): WorkflowJob {
  const narration: NarrationSink = makeNarrationSink(sdk, parentSessionId)
  const executor = new WorkflowExecutor(sdk, parentSessionId, config.ultracode, narration)

  const progress: WorkflowProgress = { stageIndex: 0, totalStages: def.stages.length, agents: [] }
  const control: WorkflowControl = {
    shouldStop: () => job.status === "cancelled",
    isPaused: () => job.status === "paused",
    now: () => Date.now(),
  }
  const job: WorkflowJob = {
    id,
    title: def.title || def.stages.map((s) => s.name).join(" → "),
    def,
    parentSessionId,
    status: "pending",
    progress,
    result: undefined,
    budget: undefined,
    execute: async () => {
      job.status = "running"
      const rt = config.ultracode.workflowRuntime
      const budget = job.budget ? restoreBudget(rt, job.budget) : new Budget(rt.maxCostUsd, rt.maxTotalAgents, rt.agentCostCapUsd)
      try {
        const journal = await FileJournal.open(path.join(projectDir, config.ultracode.journalDir), id, def, (l, m) => sdk.log(l, m), rt.maxJournalFiles)
        const { summary } = await executor.execute(def, { control, progress, budget, metrics, journal, worktrees })
        job.result = summary
        job.budget = budget.report()
        if ((job.status as string) !== "cancelled") job.status = "completed"
      } catch (err) {
        job.status = "error"
        job.result = `Workflow failed: ${errMsg(err)}`
      } finally {
        completeJob(state, job)
        // Push the result back into the session so the model is re-engaged with it
        // automatically — no polling. One wake, at completion.
        await notifyCompletion(sdk, parentSessionId, job)
      }
    },
    pause() { if (job.status === "running") job.status = "paused" },
    resume() { if (job.status === "paused") job.status = "running" },
    stop() { job.status = "cancelled" },
    statusReport: () => `Workflow ${job.id}: ${job.title} — ${job.status} (${progress.stageIndex + 1}/${progress.totalStages})`,
    summarizedOutput: () => job.result ?? renderProgress(job),
  }
  return job
}

// ── Formatting ───────────────────────────────────────────────────────────────

interface ToolOutput { title: string; output: string; metadata: Record<string, unknown> }

/** The slice of the tool context the handlers use. */
type ToolCtx = { sessionID: string }

function output(title: string, body: string): ToolOutput {
  return { title, output: body, metadata: {} }
}

/**
 * Returned the instant a workflow starts. The contract is deliberately terminal:
 * the model's job for this turn is done, results arrive automatically as a new
 * message, and polling is pointless (the manager returns nothing useful mid-run).
 */
function startedOutput(job: WorkflowJob): ToolOutput {
  return {
    title: `Workflow ${job.id} started (${job.def.stages.length} stages)`,
    output:
      `Started in the background as ${job.id}. STOP HERE: tell the user it's running, then end your turn.\n` +
      `The result will be delivered to you automatically as a new message when it finishes — you do NOT ` +
      `need to wait for it or check on it. Do NOT call workflow-manager to poll; while it runs that returns ` +
      `nothing useful. (The user can run /workflows for a live view.)`,
    metadata: { workflowId: job.id, background: true },
  }
}

/** Fire-and-forget narration: detach required (executor blocks the parent session). Drops logged. */
function makeNarrationSink(sdk: ISdkClient, parentSessionId: string): NarrationSink {
  return {
    inject(message) {
      void sdk.promptSession(parentSessionId, {
        parts: [{ type: "text", synthetic: true, text: message }],
        noReply: true,
      }).catch((err) => {
        sdk.log("warn", `workflow narration dropped: ${errMsg(err)}`)
      })
    },
  }
}

/** Restore budget from a prior run's report so a resumed workflow respects cumulative spend. */
function restoreBudget(rt: CompiledConfig["ultracode"]["workflowRuntime"], report: BudgetReport): Budget {
  const b = new Budget(rt.maxCostUsd, rt.maxTotalAgents, rt.agentCostCapUsd)
  // Replay the prior spend so the cap accounts for what was already consumed.
  b.record(report.spentUsd, report.spentTokens)
  return b
}

/** Re-engage the parent session on completion. Drops logged. */
async function notifyCompletion(sdk: ISdkClient, parentSessionId: string, job: WorkflowJob): Promise<void> {
  const verb = job.status === "cancelled" ? "was stopped" : job.status === "error" ? "failed" : "completed"
  try {
    await sdk.promptSession(parentSessionId, {
      parts: [{ type: "text", text: `[ultracode] Workflow ${job.id} "${job.title}" ${verb}.\n\n${job.result ?? ""}` }],
      noReply: false,
    })
  } catch (err) {
    sdk.log("warn", `workflow ${job.id} completion notification dropped: ${errMsg(err)}`)
  }
}

function formatValidation(result: Omit<ValidationResult, "id">): string {
  const lines = [`Stages: ${result.stages} | Agents: ${result.agents} | Max concurrent: ${result.maxConcurrent}`, ""]
  for (const error of result.errors) lines.push(`  ISSUE: ${error}`)
  if (result.errors.length > 0) lines.push("")
  if (result.valid) {
    lines.push(`Estimated: ${result.estimate.estimatedTime}, ${result.estimate.estimatedTokens.toLocaleString()} tokens (${result.estimate.estimatedCost})`)
    lines.push("", 'STATUS: VALIDATED — run it with workflow({ action: "execute", definition }) (the same definition).')
  } else {
    lines.push("STATUS: INVALID — fix the issues above and retry.")
  }
  return lines.join("\n")
}
