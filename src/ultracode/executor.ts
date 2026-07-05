/**
 * WorkflowExecutor — the stateful half of the workflow engine.
 * Runs a validated WorkflowDef stage by stage.
 */
import { type ISdkClient } from "../sdk-client.js"
import {
  type AgentResult,
  type AgentRunStatus,
  type AgentSpec,
  type FanoutStage,
  type Finding,
  type LoopStage,
  type Metrics,
  type NarrationSink,
  type OutputSchema,
  type PipelineStage,
  type Stage,
  type StageResult,
  type UltracodeConfig,
  type VerdictData,
  type VerifyStage,
  type WorkflowControl,
  type WorkflowDef,
  type WorkflowProgress,
  type WorkflowResults,
} from "../contracts.js"
import { runBounded, type CooperativeGate } from "./pool.js"
import { runAgent, type RunAgentOptions } from "./agent-runner.js"
import { resolveTemplate, type TemplateContext } from "./templates.js"
import { summarize } from "./summarizer.js"
import { Budget } from "./budget.js"
import { type Journal, chainStageHash } from "./journal.js"
import { type WorktreeManager } from "./worktree.js"
import { errMsg } from "../util.js"

const VERDICT_SCHEMA: OutputSchema = {
  fields: { refuted: { type: "boolean", required: true }, reason: { type: "string" } },
}

export interface ExecuteOptions {
  readonly control: WorkflowControl
  readonly progress: WorkflowProgress
  readonly budget: Budget
  readonly journal?: Journal
  readonly worktrees?: WorktreeManager
  readonly metrics?: Metrics
}

export class WorkflowExecutor {
  constructor(
    private sdk: ISdkClient,
    private parentSessionId: string,
    private config: UltracodeConfig,
    private narration: NarrationSink,
  ) {}

  async execute(def: WorkflowDef, opts: ExecuteOptions): Promise<{ summary: string; results: WorkflowResults }> {
    const metrics = opts.metrics
    const results: WorkflowResults = {}
    const startedAt = opts.control.now?.() ?? null
    const gate: CooperativeGate = {
      shouldStop: opts.control.shouldStop,
      isPaused: opts.control.isPaused,
      hasTimedOut: () => this.timedOut(startedAt, opts.control),
    }

    for (let i = 0; i < def.stages.length; i++) {
      const stage = def.stages[i]!
      opts.progress.stageIndex = i
      await this.waitWhilePaused(opts.control)
      if (opts.control.shouldStop?.()) break
      if (this.timedOut(startedAt, opts.control)) {
        this.narration.inject(`Workflow stopped: exceeded workflowTimeout`)
        break
      }

      const hash = chainStageHash(def.stages, i)
      const cached = opts.journal?.load(i, hash)
      if (cached) {
        this.narration.inject(`Stage '${stage.name}' — restored from journal`)
        results[stage.name] = cached
        continue
      }

      const stageStart = metrics ? Date.now() : 0
      const result = await this.runStage(stage, results, opts, gate)
      results[stage.name] = result

      if (metrics) {
        try {
          metrics.stageCompleted(result, Date.now() - stageStart)
          for (const a of result.agents) {
            if (a.status === "completed") metrics.agentCompleted(a, stage.name)
            else if (a.status === "error") metrics.agentFailed(a, stage.name)
          }
        } catch { /* metrics must never abort workflow execution */ }
      }
      await opts.journal?.save(i, hash, result)
    }

    try { metrics?.workflowCompleted(def, opts.budget.report(), Date.now() - (startedAt ?? Date.now())) } catch {}
    return { summary: summarize(def, results, this.config, opts.budget.report()), results }
  }

  private runStage(stage: Stage, results: WorkflowResults, opts: ExecuteOptions, gate: CooperativeGate): Promise<StageResult> {
    switch (stage.kind) {
      case "fanout": return this.runFanout(stage, results, opts, gate)
      case "pipeline": return this.runPipeline(stage, results, opts, gate)
      case "verify": return this.runVerify(stage, results, opts, gate)
      case "loop": return this.runLoop(stage, results, opts, gate)
    }
  }

  private async runFanout(stage: FanoutStage, results: WorkflowResults, opts: ExecuteOptions, gate: CooperativeGate): Promise<StageResult> {
    this.narration.inject(`Stage '${stage.name}' (fanout) starting: ${stage.agents.length} agents`)
    const ctx = this.context(results)
    const maxC = stage.maxConcurrent ?? this.config.workflowRuntime.maxConcurrent

    const session = stage.isolate ? await this.beginIsolation(stage, opts) : undefined
    try {
      const raw = await runBounded(stage.agents, maxC, (spec, i) =>
        runAgent(spec, resolveTemplate(spec.task, ctx), this.agentOpts(opts, this.track(opts.progress, stage.name, spec.name), session?.dirs[i])),
        gate,
      )
      const agents = compact(raw)
      if (session) await session.integrate(raw, (m) => this.narration.inject(m))

      this.narration.inject(`Stage '${stage.name}' complete: ${okCount(agents)}/${stage.agents.length}`)
      return { stage: stage.name, kind: "fanout", agents, findings: flattenFindings(agents) }
    } catch (err) {
      if (session) {
        try { await session.cleanup((m) => this.narration.inject(m)) }
        catch (cleanupErr) { this.narration.inject(`Stage '${stage.name}' worktree cleanup failed: ${errMsg(cleanupErr)}`) }
      }
      throw err
    }
  }

  private async runPipeline(stage: PipelineStage, results: WorkflowResults, opts: ExecuteOptions, gate: CooperativeGate): Promise<StageResult> {
    this.narration.inject(`Stage '${stage.name}' (pipeline) starting: ${stage.over.length} items × ${stage.steps.length} steps`)
    const maxC = stage.maxConcurrent ?? this.config.workflowRuntime.maxConcurrent

    const raw = await runBounded(stage.over, maxC, async (item) => {
      const tracker = this.track(opts.progress, stage.name, item)
      const stepText = new Map<string, string>()
      let last: AgentResult | undefined
      for (const step of stage.steps) {
        const ctx = this.context(results, { item, step: (n) => stepText.get(n) })
        last = await runAgent(step, resolveTemplate(step.task, ctx), this.agentOpts(opts, tracker))
        stepText.set(step.name, last.text)
        if (last.status === "error") break
      }
      return last ? { ...last, name: item } : undefined
    }, gate)

    const agents = compact(raw)
    this.narration.inject(`Stage '${stage.name}' complete: ${okCount(agents)}/${stage.over.length} items`)
    return { stage: stage.name, kind: "pipeline", agents, findings: flattenFindings(agents) }
  }

  private async runVerify(stage: VerifyStage, results: WorkflowResults, opts: ExecuteOptions, gate: CooperativeGate): Promise<StageResult> {
    const findings = results[stage.source]?.findings ?? []
    const lenses = stage.lenses && stage.lenses.length > 0 ? stage.lenses : new Array<string | undefined>(stage.voters).fill(undefined)
    this.narration.inject(`Stage '${stage.name}' (verify) checking ${findings.length} findings × ${lenses.length} voters`)

    interface Job { readonly fi: number; readonly spec: AgentSpec }
    const jobs: Job[] = findings.flatMap((finding, fi) => {
      const base = resolveTemplate(stage.task, this.context(results, { finding: JSON.stringify(finding) }))
      return lenses.map((lens, k): Job => ({
        fi,
        spec: {
          name: `${stage.name}-f${fi}-v${k}`, agent: stage.agent, schema: VERDICT_SCHEMA,
          task: lens ? `${base}\n\nEvaluate specifically through this lens: ${lens}.` : base,
        },
      }))
    })

    const maxC = this.config.workflowRuntime.maxConcurrent
    const verdicts = await runBounded(jobs, maxC,
      (job) => runAgent(job.spec, job.spec.task, this.agentOpts(opts, this.track(opts.progress, stage.name, job.spec.name)))
        .then((result) => ({ fi: job.fi, result })),
      gate)

    const refutationsByFinding = new Map<number, number>()
    let errorVoters = 0
    const allAgents: AgentResult[] = []
    for (const v of compact(verdicts)) {
      allAgents.push(v.result)
      if (v.result.status === "error") { errorVoters++; continue }
      if ((v.result.data as VerdictData | undefined)?.refuted === true) refutationsByFinding.set(v.fi, (refutationsByFinding.get(v.fi) ?? 0) + 1)
    }
    const survivors = findings.filter((_f, fi) => (refutationsByFinding.get(fi) ?? 0) < stage.refuteThreshold)

    if (errorVoters > 0) this.narration.inject(`Stage '${stage.name}': ${errorVoters} voter(s) errored — findings may have survived with fewer refutations than expected`)
    return { stage: stage.name, kind: "verify", agents: allAgents, findings: survivors }
  }

  private async runLoop(stage: LoopStage, results: WorkflowResults, opts: ExecuteOptions, gate: CooperativeGate): Promise<StageResult> {
    const seen = new Set<string>()
    const accumulated: Finding[] = []
    const allAgents: AgentResult[] = []

    for (let iter = 0; iter < stage.maxIterations; iter++) {
      if (gate.shouldStop?.() || gate.hasTimedOut?.()) break
      this.narration.inject(`Stage '${stage.name}' (loop) iteration ${iter + 1}/${stage.maxIterations}`)
      const body = await this.runFanout({ ...stage.body, name: stage.name }, results, opts, gate)
      allAgents.push(...body.agents)

      let fresh = 0
      for (const f of body.findings) {
        const key = String(f[stage.dedupeKey] ?? JSON.stringify(f))
        if (seen.has(key)) continue
        seen.add(key)
        accumulated.push(f)
        fresh++
      }
      if (fresh === 0) break
    }
    return { stage: stage.name, kind: "loop", agents: allAgents, findings: accumulated }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private agentOpts(opts: ExecuteOptions, onStatus: (s: AgentRunStatus) => void, directory?: string): RunAgentOptions {
    return {
      sdk: this.sdk, parentSessionId: this.parentSessionId, timeoutMs: this.config.workflowRuntime.agentTimeout,
      budget: opts.budget, onStatus, retries: this.config.workflowRuntime.agentRetries,
      ...(directory ? { directory } : {}),
    }
  }

  private context(results: WorkflowResults, extra?: Partial<TemplateContext>): TemplateContext {
    return {
      stage: (name) => { const r = results[name]; return r ? stageSummaryText(r) : undefined },
      stageAgent: (name, agent) => results[name]?.agents.findLast((a) => a.name === agent)?.text,
      ...extra,
    }
  }

  private track(progress: WorkflowProgress, stage: string, name: string): (s: AgentRunStatus) => void {
    let entry = progress.agents.find((a) => a.stage === stage && a.name === name)
    if (!entry) { entry = { stage, name, status: "queued" }; progress.agents.push(entry) }
    else entry.status = "queued"
    return (status) => { entry!.status = status }
  }

  private async beginIsolation(stage: FanoutStage, opts: ExecuteOptions) {
    if (!opts.worktrees) throw new Error(`Stage '${stage.name}': isolate requires worktree support`)
    return opts.worktrees.begin(stage.name, stage.agents.map((a) => a.name))
  }

  private async waitWhilePaused(control: WorkflowControl): Promise<void> {
    while (control.isPaused?.() && !control.shouldStop?.()) { await new Promise((r) => setTimeout(r, 200)) }
  }

  private timedOut(startedAt: number | null, control: WorkflowControl): boolean {
    return startedAt !== null && control.now !== undefined && control.now() - startedAt > this.config.workflowRuntime.workflowTimeout
  }
}

function compact<T>(items: Array<T | undefined>): T[] { return items.filter((x): x is T => x !== undefined) }
function okCount(agents: readonly AgentResult[]): number { return agents.filter((a) => a.status === "completed").length }
function flattenFindings(agents: readonly AgentResult[]): Finding[] {
  const out: Finding[] = []
  for (const a of agents) {
    const findings = a.data?.findings
    if (Array.isArray(findings)) for (const f of findings) if (f && typeof f === "object" && !Array.isArray(f)) out.push(f as Finding)
  }
  return out
}
function stageSummaryText(result: StageResult): string {
  if (result.findings.length > 0) return JSON.stringify(result.findings).slice(0, 4000)
  return result.agents.filter((a) => a.status === "completed").map((a) => `${a.name}: ${a.text}`).join("\n\n").slice(0, 4000)
}
