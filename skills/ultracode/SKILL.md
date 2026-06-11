---
name: ultracode
description: How to design and run ultracode multi-agent workflows with the workflow tool — the stage IR (fanout/pipeline/verify/loop), structured-output findings, cross-stage templates, and budget/worktree-isolation controls. Consult when building a workflow definition or deciding whether a task (3+ files, audit, migration, multi-perspective verification) warrants one.
---

# Ultracode Workflow Design

## When to Use Workflows
- Tasks spanning 3+ files, modules, or subsystems
- Large-scale refactors, audits, or migrations
- Multi-step work where independent perspectives or verification raise confidence

## The Stage IR

A workflow is `{ "title": "...", "stages": [ ... ] }`. Stages run sequentially;
results flow forward via templates. Four stage kinds:

- **fanout** — run named agents in parallel (one barrier).
  `{ "kind": "fanout", "name": "audit", "agents": [{ "name": "routes", "task": "...", "agent": "explore" }] }`
- **pipeline** — flow each item through ordered steps with NO barrier between
  steps (item B starts while item A is mid-chain). Steps see `{{item}}` and
  `{{step.<name>}}`.
  `{ "kind": "pipeline", "name": "fix", "over": ["a.ts","b.ts"], "steps": [{ "name": "review", "task": "review {{item}}", "agent": "general" }, { "name": "patch", "task": "apply {{step.review}}", "agent": "general" }] }`
- **verify** — adversarially check a prior stage's findings; a finding is dropped
  when `refuteThreshold` voters refute it. The task sees `{{finding}}`. Use
  `lenses` for distinct perspectives.
  `{ "kind": "verify", "name": "check", "source": "audit", "task": "Try to REFUTE: {{finding}}", "agent": "general", "voters": 3, "refuteThreshold": 2 }`
- **loop** — repeat a fanout body until a round adds no new findings.
  `{ "kind": "loop", "name": "sweep", "body": { ...fanout... }, "maxIterations": 4, "dedupeKey": "id" }`

## Structured output + findings
Give an agent a `schema` to force validated JSON. A `findings` array becomes the
stage's findings, which `verify` and `loop` consume:
`"schema": { "fields": { "findings": { "type": "array", "items": { "fields": { "id": {"type":"string"}, "desc": {"type":"string"} } } } } }`

## Cross-stage results
`{{stage.<name>}}` (summarized) or `{{stage.<name>.<agent>}}` (one agent).

## Process
1. `workflow({ action: "execute", definition })` — validate + run in the background,
   one call. It returns immediately; the final result is posted back automatically
   on completion (do NOT poll). To preview cost without running, use
   `workflow({ action: "validate", definition })`.
2. Check progress / control via the `workflow-manager` tool; `workflow({ action:
   "resume", workflowId })` re-runs a previous workflow, skipping journaled stages.

## Guidance
- One focused subtask per agent ("add auth to src/routes/users.ts", not "all files").
- Max 16 agents per stage; a USD budget can cap total spend (agents beyond it are
  reported as dropped, never silently skipped).
- For parallel file edits that might collide, set `"isolate": true` on the fanout
  (each agent runs in its own git worktree; no uncommitted tracked changes required, conflicts surfaced).
- Prefer a verify stage for audits/reviews — adversarial refutation removes
  plausible-but-wrong findings.
