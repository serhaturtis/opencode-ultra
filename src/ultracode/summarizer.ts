/**
 * Result summarizer — turns the full WorkflowResults into the compact, structured
 * text that re-enters the conversation. Raw agent output and intermediate
 * findings stay in the engine; only this summary (plus per-stage progress and
 * the budget line) is surfaced.
 */
import { type BudgetReport, type StageResult, type UltracodeConfig, type WorkflowDef, type WorkflowResults } from "../contracts.js"

export function summarize(
  def: WorkflowDef,
  results: WorkflowResults,
  config: UltracodeConfig,
  budget: BudgetReport,
): string {
  const lines: string[] = [`<workflow-result title="${def.title}" stages="${def.stages.length}">`]

  for (const stage of def.stages) {
    const result = results[stage.name]
    lines.push(result ? summarizeStage(result, config) : `## ${stage.name} (${stage.kind}) — not run\n`)
  }

  lines.push(budgetLine(budget))
  lines.push("</workflow-result>")
  return lines.join("\n")
}

function summarizeStage(result: StageResult, config: UltracodeConfig): string {
  const ok = result.agents.filter((a) => a.status === "completed")
  const failed = result.agents.filter((a) => a.status === "error")
  const max = config.summarization.agentResultMaxChars

  let text = `## ${result.stage} (${result.kind}) — ${ok.length}/${result.agents.length} ok`
  text += failed.length ? `, ${failed.length} failed\n` : "\n"

  if (result.findings.length > 0) {
    const findings = config.summarization.deduplicate ? dedupeFindings(result.findings) : result.findings
    text += `\n${findings.length} finding(s):\n`
    for (const f of findings) text += `- ${oneLine(JSON.stringify(f), 300)}\n`
  } else {
    for (const a of ok) text += `\n### ${a.name}\n${(a.text || "(no output)").slice(0, max)}\n`
  }

  if (failed.length > 0) {
    text += `\n### Errors\n`
    for (const a of failed) text += `- **${a.name}**: ${(a.error ?? "unknown").slice(0, 500)}\n`
  }
  return text
}

function dedupeFindings(findings: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const f of findings) {
    // Order-independent key: different agents emit the same finding with arbitrary
    // field order, so a raw JSON.stringify would miss duplicates.
    const key = JSON.stringify(sortKeysDeep(f))
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

/** Recursively sort object keys (arrays keep order) so equal objects stringify identically. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = sortKeysDeep((value as Record<string, unknown>)[k])
    }
    return sorted
  }
  return value
}

function budgetLine(budget: BudgetReport): string {
  const limit = budget.limitUsd > 0 ? ` / $${budget.limitUsd.toFixed(2)} limit` : ""
  const dropped = budget.droppedAgents > 0 ? ` — ${budget.droppedAgents} agent(s) DROPPED (budget exhausted)` : ""
  return `\n<budget spent="$${budget.spentUsd.toFixed(4)}${limit}" tokens="${budget.spentTokens}"${dropped ? ` note="${dropped.trim()}"` : ""} />`
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
