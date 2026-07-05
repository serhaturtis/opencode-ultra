/** Narrows a parsed definition into a typed WorkflowDef; statically checks structure, schemas, templates, limits. */
import {
  AGENT_TYPES,
  type AgentSpec,
  type AgentType,
  type CostEstimate,
  type FanoutStage,
  type LoopStage,
  type PipelineStage,
  type Stage,
  type UltracodeConfig,
  type ValidationResult,
  type VerifyStage,
  type WorkflowDef,
} from "../contracts.js"
import { type ParsedWorkflow } from "./parser.js"
import { validateTemplates } from "./templates.js"
import { validateSchema } from "./schema.js"

const KNOWN_AGENTS: ReadonlySet<AgentType> = new Set<AgentType>(AGENT_TYPES)
const MAX_AGENTS_PER_STAGE = 16

export class WorkflowValidator {
  constructor(private config: UltracodeConfig) {}

  /**
   * Validate a parsed definition. Returns the result and, when valid, the narrowed
   * def built from the SAME pass (the single source of truth — callers must not
   * re-narrow). `id` is generated here: it is the canonical job key and the value
   * the manager displays, so the two MUST stay in sync.
   */
  validate(parsed: ParsedWorkflow): { result: Omit<ValidationResult, "id">; def?: WorkflowDef } {
    const errors: string[] = []
    const def = this.buildDef(parsed, errors)
    if (def && errors.length === 0) errors.push(...validateTemplates(def))

    const totalAgents = def ? countAgents(def) : 0
    const result: Omit<ValidationResult, "id"> = {
      valid: errors.length === 0,
      stages: parsed.stages.length,
      agents: totalAgents,
      maxConcurrent: this.config.workflowRuntime.maxConcurrent,
      estimate: this.estimate(totalAgents),
      errors: Object.freeze(errors),
    }
    return { result, def: def && errors.length === 0 ? def : undefined }
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

    const total = totalAgents(stages)
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
    const agent = narrowAgentType(o.agent, `${at} ('${name}')`, errors)
    if (o.schema !== undefined) errors.push(...validateSchema(o.schema, `${at} ('${name}').schema`))
    return {
      name,
      task: typeof o.task === "string" ? o.task : "",
      agent,
      ...(o.schema ? { schema: o.schema as AgentSpec["schema"] } : {}),
    }
  }

  private narrowFanout(o: Record<string, unknown>, at: string, errors: string[]): FanoutStage {
    const maxConcurrent = narrowMaxConcurrent(o.maxConcurrent, at, errors)
    return {
      kind: "fanout",
      name: at,
      agents: this.narrowAgents(o.agents, at, errors),
      ...(maxConcurrent !== undefined ? { maxConcurrent } : {}),
      ...(o.isolate === true ? { isolate: true } : {}),
    }
  }

  private narrowLoop(o: Record<string, unknown>, at: string, errors: string[]): LoopStage {
    const bodyRaw = o.body && typeof o.body === "object" ? (o.body as Record<string, unknown>) : {}
    const maxIterations = typeof o.maxIterations === "number" && o.maxIterations > 0 ? o.maxIterations : 0
    if (maxIterations === 0) errors.push(`Stage '${at}': loop needs a positive 'maxIterations'`)
    const dedupeKey = typeof o.dedupeKey === "string" ? o.dedupeKey : ""
    if (!dedupeKey) errors.push(`Stage '${at}': loop needs a 'dedupeKey'`)

    const body = this.narrowFanout(bodyRaw, at, errors)
    if (dedupeKey) {
      const findingFields = findingsItemFields(body)
      if (findingFields && findingFields.length > 0 && !findingFields.includes(dedupeKey)) {
        errors.push(
          `Stage '${at}': loop 'dedupeKey' "${dedupeKey}" is not emitted by any body agent's findings schema ` +
          `(available: ${findingFields.join(", ")}).`,
        )
      }
    }

    return { kind: "loop", name: at, body, maxIterations, dedupeKey }
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
    const maxConcurrent = narrowMaxConcurrent(o.maxConcurrent, at, errors)
    return {
      kind: "pipeline",
      name: at,
      over,
      steps,
      ...(maxConcurrent !== undefined ? { maxConcurrent } : {}),
    }
  }

  private narrowVerify(o: Record<string, unknown>, at: string, prior: ReadonlySet<string>, errors: string[]): VerifyStage {
    const source = typeof o.source === "string" ? o.source : ""
    if (!source) errors.push(`Stage '${at}': verify needs a 'source' stage name`)
    else if (!prior.has(source)) errors.push(`Stage '${at}': verify source '${source}' is not a prior stage`)
    if (typeof o.task !== "string" || !o.task) errors.push(`Stage '${at}': verify needs a 'task'`)
    const agent = narrowAgentType(o.agent, `Stage '${at}'`, errors)
    const lenses = Array.isArray(o.lenses) ? o.lenses.filter((x): x is string => typeof x === "string") : undefined
    const explicitVoters = typeof o.voters === "number" && o.voters > 0 ? o.voters : undefined
    if (explicitVoters !== undefined && lenses && lenses.length > 0 && explicitVoters !== lenses.length) {
      errors.push(
        `Stage '${at}': 'voters' (${explicitVoters}) must match 'lenses' length (${lenses.length}) when both are given`,
      )
    }
    const voters = explicitVoters ?? lenses?.length ?? 0
    if (voters === 0) errors.push(`Stage '${at}': verify needs 'voters' > 0 (or a non-empty 'lenses')`)
    // Strict majority: floor(n/2)+1 (1→1, 2→2, 3→2, 4→3).
    const refuteThreshold = typeof o.refuteThreshold === "number" && o.refuteThreshold > 0
      ? o.refuteThreshold
      : Math.floor(voters / 2) + 1
    return {
      kind: "verify", name: at, source, task: typeof o.task === "string" ? o.task : "",
      agent, voters, refuteThreshold, ...(lenses ? { lenses } : {}),
    }
  }

  private estimate(totalAgents: number): CostEstimate {
    const avgTokens = 3000
    const lowUsd = (totalAgents * avgTokens / 1_000_000) * 3
    return {
      agents: totalAgents,
      estimatedTokens: totalAgents * avgTokens,
      estimatedTime: `${Math.ceil(totalAgents / 4)}-${Math.ceil(totalAgents / 2)}m`,
      estimatedCost: `$${lowUsd.toFixed(2)}-$${(lowUsd * 4).toFixed(2)}`,
    }
  }
}

/**
 * Narrow an agent-type value WITHOUT the cast-replaces-validation antipattern:
 * unknown input is checked against the known set and defaults safely while
 * recording a located error. The returned AgentType is always type-correct;
 * invalid input never reaches the executor.
 */
function narrowAgentType(raw: unknown, at: string, errors: string[]): AgentType {
  if (typeof raw === "string" && KNOWN_AGENTS.has(raw as AgentType)) return raw as AgentType
  errors.push(`${at}: unknown agent type '${String(raw)}'. Use 'general' or 'explore'.`)
  return "general"
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Total agent count, with verify stages estimated from their source's count. */
function countAgents(def: WorkflowDef): number {
  return totalAgents(def.stages)
}

/**
 * Sum agent counts across stages, feeding each stage's count forward so a later
 * verify stage can estimate its fanout from its source stage's count. A stage's
 * count may be referenced by a later verify (as its source), hence declaration order.
 */
function totalAgents(stages: readonly Stage[]): number {
  const counts = new Map<string, number>()
  let total = 0
  for (const s of stages) {
    const c = stageAgentCount(s, counts)
    counts.set(s.name, c)
    total += c
  }
  return total
}

function stageAgentCount(stage: Stage, prior: ReadonlyMap<string, number>): number {
  switch (stage.kind) {
    case "fanout": return stage.agents.length
    case "loop": return stage.body.agents.length * stage.maxIterations
    case "pipeline": return stage.over.length * stage.steps.length
    case "verify":
      // Static estimate for the cost preview and the maxTotalAgents gate. The real
      // count is (findings × voters), which is runtime-bound and unknowable here;
      // we assume each source agent emits ~1 finding. The runtime budget still
      // bounds the actual fanout, so this estimate being low only understates the
      // preview — it never lets a verify run exceed its budget.
      return (prior.get(stage.source) ?? 0) * stage.voters
  }
}

/**
 * Validate an optional `maxConcurrent`. Must be a positive integer — pool.ts
 * otherwise silently clamps 0/negative/fractional to 1 lane, masking a typo.
 */
function narrowMaxConcurrent(raw: unknown, at: string, errors: string[]): number | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    errors.push(`Stage '${at}': 'maxConcurrent' must be a positive integer (got ${JSON.stringify(raw)})`)
    return undefined
  }
  return raw
}

/**
 * The union of `findings` item field names declared across a fanout body's agents.
 * Returns undefined when NO body agent declares a findings schema (there is nothing
 * structural to check a dedupeKey against); otherwise the union of item fields.
 */
function findingsItemFields(body: FanoutStage): readonly string[] | undefined {
  let anyFindings = false
  const fields = new Set<string>()
  for (const a of body.agents) {
    const spec = a.schema?.fields?.findings
    if (spec && spec.type === "array") {
      anyFindings = true
      for (const k of Object.keys(spec.items.fields)) fields.add(k)
    }
  }
  return anyFindings ? [...fields] : undefined
}
