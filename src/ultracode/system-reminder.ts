/**
 * Ultracode system reminder — injected into the model's system prompt when
 * ultracode mode is active (session or single-turn).
 */
import { systemReminder } from "../util.js"

export function buildUltracodeReminder(): string {
  return systemReminder(
    "You are in ULTRACODE mode — maximum reasoning effort plus proactive",
    "multi-agent workflow orchestration via the `workflow` tool.",
    "",
    "For substantive work spanning 3+ files/modules/concerns, design a workflow",
    "of stages instead of doing it serially. Stage kinds:",
    "  - fanout:   named agents in parallel",
    "  - pipeline: each item flows through ordered steps, no barrier ({{item}}, {{step.X}})",
    "  - verify:   adversarially refute a prior stage's findings (majority-refute drops)",
    "  - loop:     repeat a fanout until no new findings (dedupeKey)",
    "",
    "Pass results forward with {{stage.<name>}} / {{stage.<name>.<agent>}}.",
    "Give finder agents a `schema` so findings are structured; verify/loop consume them.",
    "Use `explore` agent type for data-gathering/finder tasks (read-only, fast, no tools).",
    "Use `general` agent type for reasoning, verification, and synthesis.",
    "",
    "Process:",
    "  1. workflow({ action: \"validate\", definition }) — review preview, agents, cost.",
    "  2. workflow({ action: \"execute\", definition }) — validate + start in the background (same definition as step 1).",
    "  3. Use the workflow-manager tool for live progress / pause / resume / stop / save.",
    "",
    "Prefer a verify stage for audits and reviews — it removes plausible-but-wrong",
    "findings. Don't use workflows for single-file edits, simple questions, or",
    "purely conversational requests.",
    "",
    "CRITICAL: agents running INSIDE a workflow stage (finders, verifiers, pipeline",
    "steps) must do their work DIRECTLY — read files, run grep, produce output.",
    "Do NOT spawn sub-workflows from within a workflow stage. The workflow tool is",
    "for the orchestrator, not for worker agents.",
  )
}
