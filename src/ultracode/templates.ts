/**
 * Template engine for workflow tasks. Supported references:
 *   {{stage.<name>}}          — summarized output of a prior stage
 *   {{stage.<name>.<agent>}}  — a specific agent's output in a prior fanout stage
 *   {{item}}                  — the current item (pipeline stages only)
 *   {{step.<name>}}           — a prior step's output for the current item (pipeline)
 *   {{finding}}               — the current finding as JSON (verify stages only)
 *
 * Resolution failures are injected inline as [TEMPLATE ERROR: …] so the subagent
 * sees them and can report — never silently dropped. `validateTemplates` catches
 * the same problems at validate time, before anything runs.
 */
import { type Stage, type WorkflowDef } from "../contracts.js"

const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g

export interface TemplateContext {
  readonly stage: (name: string) => string | undefined
  readonly stageAgent: (stage: string, agent: string) => string | undefined
  readonly item?: string
  readonly step?: (name: string) => string | undefined
  readonly finding?: string
}

export function resolveTemplate(task: string, ctx: TemplateContext): string {
  return task.replace(TOKEN, (_match, ref: string) => resolveRef(ref, ctx))
}

function resolveRef(ref: string, ctx: TemplateContext): string {
  if (ref === "item") {
    return ctx.item ?? "[TEMPLATE ERROR: {{item}} is only valid inside a pipeline stage]"
  }
  if (ref === "finding") {
    return ctx.finding ?? "[TEMPLATE ERROR: {{finding}} is only valid inside a verify stage]"
  }
  const parts = ref.split(".")
  if (parts[0] === "step" && parts.length === 2) {
    return ctx.step?.(parts[1]!) ?? `[TEMPLATE ERROR: unknown step '${parts[1]}' (or used outside a pipeline)]`
  }
  if (parts[0] === "stage" && parts.length === 2) {
    return ctx.stage(parts[1]!) ?? `[TEMPLATE ERROR: unknown stage '${parts[1]}']`
  }
  if (parts[0] === "stage" && parts.length === 3) {
    return ctx.stageAgent(parts[1]!, parts[2]!) ?? `[TEMPLATE ERROR: unknown agent '${parts[2]}' in stage '${parts[1]}']`
  }
  return `[TEMPLATE ERROR: unrecognized reference {{${ref}}}]`
}

// ── Static validation ─────────────────────────────────────────────────────────

/** Validate every template reference against the stages that precede it. */
export function validateTemplates(def: WorkflowDef): string[] {
  const errors: string[] = []
  const priorStages = new Map<string, ReadonlySet<string>>() // stage name → agent names

  for (const stage of def.stages) {
    for (const { task, where } of stageTasks(stage)) {
      for (const ref of references(task)) {
        checkRef(ref, stage, priorStages, where, errors)
      }
    }
    priorStages.set(stage.name, agentNamesOf(stage))
  }
  return errors
}

interface TaskRef { readonly task: string; readonly where: string }

function stageTasks(stage: Stage): TaskRef[] {
  switch (stage.kind) {
    case "fanout":
      return stage.agents.map((a) => ({ task: a.task, where: `stage '${stage.name}', agent '${a.name}'` }))
    case "pipeline":
      return stage.steps.map((s) => ({ task: s.task, where: `stage '${stage.name}', step '${s.name}'` }))
    case "verify":
      return [{ task: stage.task, where: `stage '${stage.name}' (verify)` }]
    case "loop":
      return stage.body.agents.map((a) => ({ task: a.task, where: `stage '${stage.name}', agent '${a.name}'` }))
  }
}

function agentNamesOf(stage: Stage): ReadonlySet<string> {
  switch (stage.kind) {
    case "fanout": return new Set(stage.agents.map((a) => a.name))
    case "loop": return new Set(stage.body.agents.map((a) => a.name))
    case "pipeline": return new Set(stage.over) // pipeline outputs are named by item
    case "verify": return new Set()
  }
}

function references(task: string): string[] {
  const refs: string[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(TOKEN.source, "g")
  while ((m = re.exec(task)) !== null) refs.push(m[1]!)
  return refs
}

function checkRef(
  ref: string,
  stage: Stage,
  priorStages: Map<string, ReadonlySet<string>>,
  where: string,
  errors: string[],
): void {
  if (ref === "item" || ref.startsWith("step.")) {
    if (stage.kind !== "pipeline") errors.push(`${where}: {{${ref}}} is only valid inside a pipeline stage`)
    else if (ref.startsWith("step.") && !stage.steps.some((s) => s.name === ref.slice(5))) {
      errors.push(`${where}: references unknown step '${ref.slice(5)}'`)
    }
    return
  }
  if (ref === "finding") {
    if (stage.kind !== "verify") errors.push(`${where}: {{finding}} is only valid inside a verify stage`)
    return
  }
  const parts = ref.split(".")
  if (parts[0] !== "stage" || parts.length < 2 || parts.length > 3) {
    errors.push(`${where}: unrecognized reference {{${ref}}}`)
    return
  }
  const agents = priorStages.get(parts[1]!)
  if (!agents) {
    errors.push(`${where}: references unknown or not-yet-run stage '${parts[1]}'. Prior stages: ${[...priorStages.keys()].join(", ") || "(none)"}`)
    return
  }
  if (parts.length === 3 && agents.size > 0 && !agents.has(parts[2]!)) {
    errors.push(`${where}: references unknown agent '${parts[2]}' in stage '${parts[1]}'. Available: ${[...agents].join(", ")}`)
  }
}
