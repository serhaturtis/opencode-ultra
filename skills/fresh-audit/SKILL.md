---
name: fresh-audit
description: Run a fresh-eyes audit of a codebase/project — scoped static sweep + mandatory live execution (boot, user journey, dependency-failure probes, gates check) producing an evidence-backed, deduplicated findings registry with tracking checkboxes. Use when the user asks to audit a codebase/project/release-readiness, to find what self-review missed, or to verify a project is actually shippable. Not for reviewing a single diff (use pre-ship-check) or re-checking claimed fixes (use verify-closures).
---

# fresh-audit

Read `../audit-common/METHOD.md` and `../audit-common/SEAM-CHECKLIST.md`
before starting. They are the contract: briefing preamble, evidence bar,
severity rubric, verification lenses, reporting rules.

**Stance:** you are the outside reviewer. Every claim the project makes
about itself — commit messages, trackers, docs, comments, "known issue"
framings — is a hypothesis to test. The defects that matter live where the
author's mental model and reality diverge; that is why the seam checklist
and the live phase are mandatory, not optional depth.

## Phase 0 — Profile and charter

1. Read `AUDIT-PROFILE.md` at the repo root. If absent, scout the repo
   (README, compose/CI files, package manifests) and DRAFT one from
   `../audit-common/PROFILE-TEMPLATE.md`; confirm boot/test commands with
   the user before any live phase.
2. Fix the **charter** with the user if not given: the milestone findings
   are judged against (release? pilot? handoff?) — this defines
   `blocking` — plus scope-menu selection and any waivers in force.
3. Pick the report directory per the profile convention:
   `<audit-dir>/<YYYY-MM-DD>/`.

## Phase 1 — Ground truth (before any opinions)

Run, capture, and keep verbatim:

- Every test suite (profile commands), to completion — background long
  ones. Exact failure lists, not summaries. Note which suites CI actually
  runs (read the CI config; look for missing services, marker filters,
  ignored exit codes).
- Every lint/gate locally; record exit codes.
- Current running state of the system (containers, processes) and any
  error accumulation in live state (queues, dead-letter tables, logs).
- `git log` for the recent self-shipped work (last days/weeks) and
  `git tag -l`; note what has provably executed vs only merged.

Discrepancies between this ground truth and the project's own claims are
findings already — record them now.

## Phase 2 — Scoped static sweep

Default scope menu (drop only with stated reason; add project-specific
scopes from the charter):

1. **user-journey (static prep)** — map the profile's journey to exact
   endpoints/actions; produce the executable plan for Phase 3; anything
   broken-by-inspection is a finding.
2. **deploy-path** — pipelines, prod config, release flow. Central
   question: has this ever been exercised end-to-end, and can it succeed
   as written? Walk every step like an interpreter; check S4 (external
   reality) hard.
3. **residue / cutover completeness** — S6 both directions for any recent
   rename/retirement/migration.
4. **boot-invariants** — S8 per dependency, with file:line classification
   (fail-fast / bounded retry / hang / silent degradation).
5. **gates-that-gate** — S7 over the whole gate inventory.
6. **test-triage** — one verdict per failing test: stale-test vs code-bug
   vs environment; introduced-by (git log/bisect); does CI run it;
   blocking?
7. **recent-work re-review** — the last N self-shipped/self-reviewed
   commits, full diffs, fresh eyes. If prior fixes claimed closures,
   spawn `verify-closures` thinking: instance vs class.
8. **invariant drift** — every documented architecture invariant gets a
   concrete probe.
9. **seams** — any S-classes from `SEAM-CHECKLIST.md` not owned above.

Each scope gets the METHOD briefing preamble + the profile + the findings
schema (`../audit-common/findings-schema.json`). **If sub-agent
orchestration is available, run scopes in parallel; otherwise run them
sequentially in the order above** — the method is identical.

## Phase 3 — Live execution (mandatory; you have not audited what you
## have not run)

Obey the profile's Safety rails throughout. Restore all state when done.

1. **Cold boot** via the profile command. A failed boot IS the scope-1
   finding — capture the failing step + logs; one non-invasive
   remediation attempt max.
2. **Drive the journey as a genuinely new user** (fresh account/tenant —
   not the seeded demo), step by step over the real API/UI, capturing
   every request/response. Where it breaks, stalls, or silently does
   nothing: finding, with the transcript. Then run the same journey on
   the seeded/happy path for contrast.
3. **Watch the system while you drive it**: error-level logs, queue/
   outbox state, background-task exceptions. Silent failures during a
   "successful" journey are the highest-value catches.
4. **Dependency-failure probes**: stop each infra dependency; restart the
   service; observe (fail-fast? supervisor restores? silent degradation?
   health endpoint honest?); restore between probes. Skip probes the
   profile forbids; record them as not-executed in Caveats.

## Phase 4 — Dedup, verify, report

1. Dedup per METHOD §5; verify per METHOD §4 (budget-scaled lenses;
   live-reproduced findings need none).
2. Render scope reports via
   `python3 ../audit-common/render_findings.py <findings.json> <report-dir>`.
3. Author `INDEX.md`: charter, method note, headline verdicts (3 max),
   **BLOCKING list** and **CLEANUP list** (deduplicated, checkboxed,
   file:line + one-line evidence each, pointers into scope files),
   **Caveats** (everything not verified — mandatory), and the
   **meta-observation**: the highest-leverage question the owner is not
   asking. Findings are committed only if the user asks.

## You are not done if…

- any scope produced zero findings AND zero "verified clean" records;
- the journey was code-read but not driven;
- a "green" claim (CI, lint, tracker status) was repeated without
  checking what actually ran;
- the Caveats section is empty (it never is, honestly);
- every finding came from reading — none from executing.
