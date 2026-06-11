/**
 * WorkflowEngine — validates and executes the declarative stage IR.
 *
 * validate(): narrows the parsed input into a typed WorkflowDef, statically
 * checks structure + templates + limits, and estimates cost.
 *
 * execute(): runs stages sequentially, each producing a StageResult (results
 * flow forward via templates). Cooperative control (pause/stop/timeout), a USD
 * budget, live per-agent progress, optional worktree isolation, and an optional
 * resume journal are all threaded through. Returns the summarized output.
 */
import { type ISdkClient } from "../sdk-client.js"
import {
  type AgentResult,
  type AgentRunStatus,
  type AgentSpec,
  type AgentType,
  type FanoutStage,
  type Finding,
  type LoopStage,
  type OutputSchema,
  type PipelineStage,
  type Stage,
  type StageResult,
  type UltracodeConfig,
  type ValidationResult,
  type VerifyStage,
  type WorkflowControl,
  type WorkflowDef,
  type WorkflowProgress,
  type WorkflowResults,
} from "../contracts.js"
import { type ParsedWorkflow } from "./parser.js"
import { runBounded } from "./pool.js"
import { runAgent, type RunAgentOptions } from "./agent-runner.js"
import { resolveTemplate, validateTemplates, type TemplateContext } from "./templates.js"
import { summarize } from "./summarizer.js"
import { Budget } from "./budget.js"
import { type Journal, stageHash } from "./journal.js"
import { type WorktreeManager } from "./worktree.js"

const KNOWN_AGENTS: ReadonlySet<AgentType> = new Set<AgentType>(["general", "explore"])
const MAX_AGENTS_PER_STAGE = 16

/** The verdict every verify voter must emit. */
const VERDICT_SCHEMA: OutputSchema = {
  fields: { refuted: { type: "boolean", required: true }, reason: { type: "string" } },
}

export interface ExecuteOptions {
  readonly control: WorkflowControl
  readonly progress: WorkflowProgress
  readonly budget: Budget
  readonly journal?: Journal
  readonly worktrees?: WorktreeManager
}

export class WorkflowEngine {
  constructor(
    private readonly sdk: ISdkClient,
    private readonly parentSessionId: string,
    private readonly config: UltracodeConfig,
  ) {}

  // ── Validation ────────────────────────────────────────────────────────────

  validate(parsed: ParsedWorkflow): ValidationResult {
    const errors: string[] = []
    const def = this.buildDef(parsed, errors)
    if (def && errors.length === 0) errors.push(...validateTemplates(def))

    const totalAgents = def ? countAgents(def) : 0
    return {
      // Short, human-typeable id. It is the canonical job key AND what the
      // manager displays — the two MUST match so a copied id resolves.
      id: crypto.randomUUID().slice(0, 8),
      valid: errors.length === 0,
      stages: parsed.stages.length,
      agents: totalAgents,
      maxConcurrent: this.config.workflowRuntime.maxConcurrent,
      estimate: this.estimate(totalAgents),
      errors: Object.freeze(errors),
    }
  }

  /** Narrow the parsed input into a typed WorkflowDef, accumulating structural errors. */
  buildDef(parsed: ParsedWorkflow, errors: string[]): WorkflowDef | undefined {
    if (parsed.stages.length === 0) {
      errors.push("Workflow must define at least one stage")
      return undefined
    }
    const names = new Set<string>()
    const priorStageNames = new Set<string>()
    const stages: Stage[] = []

    parsed.stages.forEach((raw, i) => {
      const stage = this.narrowStage(raw, i, priorStageNames, errors)
      if (!stage) return
      if (names.has(stage.name)) errors.push(`Stage ${i}: duplicate name '${stage.name}'`)
      names.add(stage.name)
      priorStageNames.add(stage.name)
      stages.push(stage)
    })

    const total = stages.reduce((n, s) => n + stageAgentCount(s), 0)
    if (total > this.config.workflowRuntime.maxTotalAgents) {
      errors.push(`Total agents ${total} exceeds the limit of ${this.config.workflowRuntime.maxTotalAgents}`)
    }
    return errors.length === 0 ? { title: parsed.title, stages } : undefined
  }

  private narrowStage(raw: unknown, i: number, prior: ReadonlySet<string>, errors: string[]): Stage | undefined {
    if (typeof raw !== "object" || raw === null) {
      errors.push(`Stage ${i}: must be an object`)
      return undefined
    }
    const o = raw as Record<string, unknown>
    const name = typeof o.name === "string" ? o.name : ""
    if (!name) errors.push(`Stage ${i}: missing 'name'`)
    const at = name || `#${i}`

    switch (o.kind) {
      case "fanout": return this.narrowFanout(o, at, errors)
      case "loop": return this.narrowLoop(o, at, errors)
      case "pipeline": return this.narrowPipeline(o, at, errors)
      case "verify": return this.narrowVerify(o, at, prior, errors)
      default:
        errors.push(`Stage '${at}': unknown kind '${String(o.kind)}'. Use fanout | pipeline | verify | loop.`)
        return undefined
    }
  }

  private narrowAgents(raw: unknown, at: string, errors: string[]): AgentSpec[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      errors.push(`Stage '${at}': must have a non-empty 'agents' array`)
      return []
    }
    if (raw.length > MAX_AGENTS_PER_STAGE) {
      errors.push(`Stage '${at}': max ${MAX_AGENTS_PER_STAGE} agents, got ${raw.length}`)
    }
    const names = new Set<string>()
    return raw.map((a, j) => this.narrowAgentSpec(a, `${at}.agent[${j}]`, names, errors)).filter(Boolean) as AgentSpec[]
  }

  private narrowAgentSpec(raw: unknown, at: string, names: Set<string>, errors: string[]): AgentSpec | undefined {
    if (typeof raw !== "object" || raw === null) { errors.push(`${at}: must be an object`); return undefined }
    const o = raw as Record<string, unknown>
    const name = typeof o.name === "string" ? o.name : ""
    if (!name) errors.push(`${at}: missing 'name'`)
    if (name && names.has(name)) errors.push(`${at}: duplicate agent name '${name}'`)
    names.add(name)
    if (typeof o.task !== "string" || !o.task) errors.push(`${at} ('${name}'): missing 'task'`)
    if (!KNOWN_AGENTS.has(o.agent as AgentType)) {
      errors.push(`${at} ('${name}'): unknown agent type '${String(o.agent)}'. Use 'general' or 'explore'.`)
    }
    return {
      name,
      task: typeof o.task === "string" ? o.task : "",
      agent: o.agent as AgentType,
      ...(o.schema ? { schema: o.schema as OutputSchema } : {}),
    }
  }

  private narrowFanout(o: Record<string, unknown>, at: string, errors: string[]): FanoutStage {
    return {
      kind: "fanout",
      name: at,
      agents: this.narrowAgents(o.agents, at, errors),
      ...(typeof o.maxConcurrent === "number" ? { maxConcurrent: o.maxConcurrent } : {}),
      ...(o.isolate === true ? { isolate: true } : {}),
    }
  }

  private narrowLoop(o: Record<string, unknown>, at: string, errors: string[]): LoopStage {
    const body = o.body && typeof o.body === "object" ? (o.body as Record<string, unknown>) : {}
    const maxIterations = typeof o.maxIterations === "number" && o.maxIterations > 0 ? o.maxIterations : 0
    if (maxIterations === 0) errors.push(`Stage '${at}': loop needs a positive 'maxIterations'`)
    if (typeof o.dedupeKey !== "string" || !o.dedupeKey) errors.push(`Stage '${at}': loop needs a 'dedupeKey'`)
    return {
      kind: "loop",
      name: at,
      body: this.narrowFanout(body, at, errors),
      maxIterations,
      dedupeKey: typeof o.dedupeKey === "string" ? o.dedupeKey : "",
    }
  }

  private narrowPipeline(o: Record<string, unknown>, at: string, errors: string[]): PipelineStage {
    const over = Array.isArray(o.over) ? o.over.filter((x): x is string => typeof x === "string") : []
    if (over.length === 0) errors.push(`Stage '${at}': pipeline needs a non-empty 'over' array of strings`)
    const steps = this.narrowAgents(o.steps, at, errors)
    if (steps.length === 0 && Array.isArray(o.steps)) {
      // narrowAgents already reported; nothing extra
    } else if (!Array.isArray(o.steps)) {
      errors.push(`Stage '${at}': pipeline needs a 'steps' array`)
    }
    return {
      kind: "pipeline",
      name: at,
      over,
      steps,
      ...(typeof o.maxConcurrent === "number" ? { maxConcurrent: o.maxConcurrent } : {}),
    }
  }

  private narrowVerify(o: Record<string, unknown>, at: string, prior: ReadonlySet<string>, errors: string[]): VerifyStage {
    const source = typeof o.source === "string" ? o.source : ""
    if (!source) errors.push(`Stage '${at}': verify needs a 'source' stage name`)
    else if (!prior.has(source)) errors.push(`Stage '${at}': verify source '${source}' is not a prior stage`)
    if (typeof o.task !== "string" || !o.task) errors.push(`Stage '${at}': verify needs a 'task'`)
    if (!KNOWN_AGENTS.has(o.agent as AgentType)) errors.push(`Stage '${at}': unknown agent type '${String(o.agent)}'`)
    const lenses = Array.isArray(o.lenses) ? o.lenses.filter((x): x is string => typeof x === "string") : undefined
    const voters = typeof o.voters === "number" && o.voters > 0 ? o.voters : (lenses?.length ?? 0)
    if (voters === 0) errors.push(`Stage '${at}': verify needs 'voters' > 0 (or a non-empty 'lenses')`)
    // Strict majority: drop only when MORE than half the voters refute. ceil(n/2)
    // would drop on a tie for even voter counts (2→1, 4→2); floor(n/2)+1 is correct
    // (1→1, 2→2, 3→2, 4→3).
    const refuteThreshold = typeof o.refuteThreshold === "number" && o.refuteThreshold > 0
      ? o.refuteThreshold
      : Math.floor(voters / 2) + 1
    return {
      kind: "verify", name: at, source, task: typeof o.task === "string" ? o.task : "",
      agent: o.agent as AgentType, voters, refuteThreshold, ...(lenses ? { lenses } : {}),
    }
  }

  private estimate(totalAgents: number) {
    const avgTokens = 3000
    const lowUsd = (totalAgents * avgTokens / 1_000_000) * 3
    return {
      agents: totalAgents,
      estimatedTokens: totalAgents * avgTokens,
      estimatedTime: `${Math.ceil(totalAgents / 4)}-${Math.ceil(totalAgents / 2)}m`,
      estimatedCost: `$${lowUsd.toFixed(2)}-$${(lowUsd * 4).toFixed(2)}`,
    }
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  async execute(def: WorkflowDef, opts: ExecuteOptions): Promise<{ summary: string; results: WorkflowResults }> {
    const results: WorkflowResults = {}
    const startedAt = opts.control.now?.() ?? null

    for (let i = 0; i < def.stages.length; i++) {
      const stage = def.stages[i]!
      opts.progress.stageIndex = i
      await this.waitWhilePaused(opts.control)
      if (opts.control.shouldStop?.()) break
      if (this.timedOut(startedAt, opts.control)) {
        await this.inject(`Workflow stopped: exceeded workflowTimeout`)
        break
      }

      const hash = stageHash(stage)
      const cached = opts.journal?.load(i, hash)
      if (cached) {
        await this.inject(`Stage '${stage.name}' — restored from journal`)
        results[stage.name] = cached
        continue
      }

      const result = await this.runStage(stage, results, opts)
      results[stage.name] = result
      await opts.journal?.save(i, hash, result)
    }

    return { summary: summarize(def, results, this.config, opts.budget.report()), results }
  }

  private runStage(stage: Stage, results: WorkflowResults, opts: ExecuteOptions): Promise<StageResult> {
    switch (stage.kind) {
      case "fanout": return this.runFanout(stage, results, opts)
      case "pipeline": return this.runPipeline(stage, results, opts)
      case "verify": return this.runVerify(stage, results, opts)
      case "loop": return this.runLoop(stage, results, opts)
    }
  }

  private async runFanout(stage: FanoutStage, results: WorkflowResults, opts: ExecuteOptions): Promise<StageResult> {
    await this.inject(`Stage '${stage.name}' (fanout) starting: ${stage.agents.length} agents`)
    const ctx = this.context(results)
    const maxC = stage.maxConcurrent ?? this.config.workflowRuntime.maxConcurrent

    const session = stage.isolate ? await this.beginIsolation(stage, opts) : undefined
    const raw = await runBounded(
      stage.agents,
      maxC,
      (spec, i) => runAgent(spec, resolveTemplate(spec.task, ctx), this.agentOpts(opts, this.track(opts.progress, stage.name, spec.name), session?.dirs[i])),
      opts.control.shouldStop,
    )
    const agents = compact(raw)
    // integrate must get the UNCOMPACTED array: dirs/branches are indexed by the
    // original agent position, so a hole (undefined = stopped agent) must stay aligned.
    if (session) await session.integrate(raw, (m) => this.inject(m))

    await this.inject(`Stage '${stage.name}' complete: ${okCount(agents)}/${stage.agents.length}`)
    return { stage: stage.name, kind: "fanout", agents, findings: flattenFindings(agents) }
  }

  private async runPipeline(stage: PipelineStage, results: WorkflowResults, opts: ExecuteOptions): Promise<StageResult> {
    await this.inject(`Stage '${stage.name}' (pipeline) starting: ${stage.over.length} items × ${stage.steps.length} steps`)
    const maxC = stage.maxConcurrent ?? this.config.workflowRuntime.maxConcurrent

    const raw = await runBounded(stage.over, maxC, async (item) => {
      const tracker = this.track(opts.progress, stage.name, item)
      const stepText = new Map<string, string>()
      let last: AgentResult | undefined
      for (const step of stage.steps) {
        const ctx = this.context(results, { item, step: (n) => stepText.get(n) })
        last = await runAgent(step, resolveTemplate(step.task, ctx), this.agentOpts(opts, tracker))
        stepText.set(step.name, last.text)
        if (last.status === "error") break // stop this item's chain on failure
      }
      return last ? { ...last, name: item } : undefined
    }, opts.control.shouldStop)

    const agents = compact(raw)
    await this.inject(`Stage '${stage.name}' complete: ${okCount(agents)}/${stage.over.length} items`)
    return { stage: stage.name, kind: "pipeline", agents, findings: flattenFindings(agents) }
  }

  private async runVerify(stage: VerifyStage, results: WorkflowResults, opts: ExecuteOptions): Promise<StageResult> {
    const findings = results[stage.source]?.findings ?? []
    const lenses = stage.lenses && stage.lenses.length > 0 ? stage.lenses : new Array<string | undefined>(stage.voters).fill(undefined)
    await this.inject(`Stage '${stage.name}' (verify) checking ${findings.length} findings × ${lenses.length} voters`)

    // Flatten (finding × voter) into ONE bounded run so peak concurrency stays
    // within maxConcurrent (a nested run would multiply it by the voter count).
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
      opts.control.shouldStop)

    const refutationsByFinding = new Map<number, number>()
    const allAgents: AgentResult[] = []
    for (const v of compact(verdicts)) {
      allAgents.push(v.result)
      if (v.result.data?.refuted === true) refutationsByFinding.set(v.fi, (refutationsByFinding.get(v.fi) ?? 0) + 1)
    }
    const survivors = findings.filter((_f, fi) => (refutationsByFinding.get(fi) ?? 0) < stage.refuteThreshold)

    await this.inject(`Stage '${stage.name}' complete: ${survivors.length}/${findings.length} findings survived`)
    return { stage: stage.name, kind: "verify", agents: allAgents, findings: survivors }
  }

  private async runLoop(stage: LoopStage, results: WorkflowResults, opts: ExecuteOptions): Promise<StageResult> {
    const seen = new Set<string>()
    const accumulated: Finding[] = []
    const allAgents: AgentResult[] = []

    for (let iter = 0; iter < stage.maxIterations; iter++) {
      if (opts.control.shouldStop?.()) break
      await this.inject(`Stage '${stage.name}' (loop) iteration ${iter + 1}/${stage.maxIterations}`)
      // Stable body name so per-agent progress upserts in place across iterations.
      const body = await this.runFanout({ ...stage.body, name: stage.name }, results, opts)
      allAgents.push(...body.agents)

      let fresh = 0
      for (const f of body.findings) {
        const key = String(f[stage.dedupeKey] ?? JSON.stringify(f))
        if (seen.has(key)) continue
        seen.add(key)
        accumulated.push(f)
        fresh++
      }
      if (fresh === 0) break // dry — nothing new this round
    }
    return { stage: stage.name, kind: "loop", agents: allAgents, findings: accumulated }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private agentOpts(opts: ExecuteOptions, onStatus: (s: AgentRunStatus) => void, directory?: string): RunAgentOptions {
    return {
      sdk: this.sdk,
      parentSessionId: this.parentSessionId,
      timeoutMs: this.config.workflowRuntime.agentTimeout,
      budget: opts.budget,
      onStatus,
      retries: this.config.workflowRuntime.agentRetries,
      ...(directory ? { directory } : {}),
    }
  }

  private context(results: WorkflowResults, extra?: Partial<TemplateContext>): TemplateContext {
    return {
      stage: (name) => { const r = results[name]; return r ? stageSummaryText(r) : undefined },
      // findLast, not find: a loop stage accumulates every iteration's agents under
      // the same name — a reference must resolve to the LAST (final) iteration.
      stageAgent: (name, agent) => results[name]?.agents.findLast((a) => a.name === agent)?.text,
      ...extra,
    }
  }

  private track(progress: WorkflowProgress, stage: string, name: string): (s: AgentRunStatus) => void {
    // Upsert: reuse an existing (stage, name) entry so loop iterations update in
    // place rather than growing the list without bound.
    let entry = progress.agents.find((a) => a.stage === stage && a.name === name)
    if (!entry) {
      entry = { stage, name, status: "queued" }
      progress.agents.push(entry)
    } else {
      entry.status = "queued"
    }
    return (status) => { entry!.status = status }
  }

  private async beginIsolation(stage: FanoutStage, opts: ExecuteOptions) {
    if (!opts.worktrees) throw new Error(`Stage '${stage.name}': isolate requires worktree support`)
    return opts.worktrees.begin(stage.name, stage.agents.map((a) => a.name))
  }

  private async waitWhilePaused(control: WorkflowControl): Promise<void> {
    while (control.isPaused?.() && !control.shouldStop?.()) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  private timedOut(startedAt: number | null, control: WorkflowControl): boolean {
    return startedAt !== null && control.now !== undefined &&
      control.now() - startedAt > this.config.workflowRuntime.workflowTimeout
  }

  private inject(message: string): Promise<void> {
    // Fire-and-forget. execute() blocks the parent session (the model awaits the
    // tool), so AWAITING a prompt to that same session here would deadlock. Fire
    // the narration detached and return immediately; the engine never waits on it.
    // Best-effort: a busy or gone session just drops the message.
    void this.sdk.promptSession(this.parentSessionId, {
      parts: [{ type: "text", synthetic: true, text: message }],
      noReply: true,
    }).catch(() => { /* parent session busy or gone */ })
    return Promise.resolve()
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function compact<T>(items: Array<T | undefined>): T[] {
  return items.filter((x): x is T => x !== undefined)
}

function okCount(agents: readonly AgentResult[]): number {
  return agents.filter((a) => a.status === "completed").length
}

function flattenFindings(agents: readonly AgentResult[]): Finding[] {
  const out: Finding[] = []
  for (const a of agents) {
    const findings = a.data?.findings
    if (Array.isArray(findings)) {
      for (const f of findings) if (f && typeof f === "object" && !Array.isArray(f)) out.push(f as Finding)
    }
  }
  return out
}

function stageSummaryText(result: StageResult): string {
  if (result.findings.length > 0) return JSON.stringify(result.findings).slice(0, 4000)
  return result.agents.filter((a) => a.status === "completed").map((a) => `${a.name}: ${a.text}`).join("\n\n").slice(0, 4000)
}

function countAgents(def: WorkflowDef): number {
  return def.stages.reduce((n, s) => n + stageAgentCount(s), 0)
}

function stageAgentCount(stage: Stage): number {
  switch (stage.kind) {
    case "fanout": return stage.agents.length
    case "loop": return stage.body.agents.length * stage.maxIterations
    case "pipeline": return stage.over.length * stage.steps.length
    case "verify": return 0 // unknown until the source produces findings
  }
}
