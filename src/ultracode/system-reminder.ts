/**
 * Ultracode system reminder — injected into the model's system prompt when
 * ultracode mode is active (session or single-turn).
 */
export function buildUltracodeReminder(): string {
  return [
    "<system-reminder>",
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
    "",
    "Process:",
    "  1. workflow({ action: \"validate\", definition }) — review preview, agents, cost.",
    "  2. workflow({ action: \"execute\", workflowId }) — runs in the background.",
    "  3. Use the workflow-manager tool for live progress / pause / resume / stop / save.",
    "",
    "Prefer a verify stage for audits and reviews — it removes plausible-but-wrong",
    "findings. Don't use workflows for single-file edits, simple questions, or",
    "purely conversational requests.",
    "</system-reminder>",
  ].join("\n")
}
