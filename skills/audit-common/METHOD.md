# METHOD — shared rules for all audit skills

## 1. The briefing preamble (prepend to every auditing sub-agent, or adopt
## yourself when working sequentially)

> You are part of a fresh-eyes audit of <project> at <path>.
> <2-4 lines of topology from AUDIT-PROFILE.md>
> MANDATE: the codebase's authors have been reviewing their own work.
> Your job is to catch what self-review structurally misses. Treat commit
> messages, status trackers, code comments, and any "this is fine /
> pre-existing / known issue" claim as a HYPOTHESIS TO TEST, not a fact
> to repeat.
> EVIDENCE BAR: every finding MUST cite a concrete file path (file:line
> where applicable) AND concrete evidence — a command you actually ran
> with the relevant output excerpt, a grep hit, or a diff hunk. If you
> cannot produce evidence, drop the finding or mark confidence=low and
> say exactly what is missing.
> RULES: read-only — do not modify repo files, do not commit, do not
> touch resources named in the profile's Safety rails. Running read-only
> commands, builds in temp dirs, individual tests, and log inspection is
> fine.

## 2. Severity rubric

| Severity | Meaning |
|---|---|
| `critical` | Data loss, security/tenant-isolation breach, or the release/launch cannot proceed |
| `high` | A core flow is broken, a gate is unverifiable, or a correctness bug sits on a primary path |
| `medium` | Real defect with a workaround |
| `low` | Polish / debt |
| `info` | Observation, clean-bill-of-health record, or classification matrix |

`blocking=true` means: must close before the next release/milestone named in
the audit's charter — not "would be nice". Severity and blocking are
independent axes; argue each separately.

`confidence`: `high` = evidence reproduced/executed; `medium` = strong
static evidence, not executed; `low` = inference — state what would
confirm it.

## 3. Evidence bar (non-negotiable)

A finding's `evidence` field contains: the command(s) actually run and the
relevant output excerpt, OR an exact grep/diff hunk. "The code appears to"
is not evidence. When evidence comes from a live system, capture it
verbatim (HTTP status + body excerpt, log lines, SQL results) — verifiers
and fixers must be able to re-run it.

## 4. Verification lenses (budget-scaled)

- **refute** — try hard to disprove the finding: re-run its evidence,
  re-read the cited code with full context (guards, config, documented
  intent, scope markers). If the behavior is intentional-and-documented,
  refute. When uncertain after honest effort, lean refuted.
- **impact** — assume it is real; stress-test severity and blocking for the
  actual milestone (would a real user hit it? operator workaround?).
- Budget scaling: low/medium findings → refute only, or skip when evidence
  is a deterministic command output; critical/high/blocking → refute +
  impact, independently.
- Cross-confirmation counts: a finding independently produced by 2+
  separate scopes/agents, or reproduced live, needs no further lenses.

## 5. Dedup rule

Merge only TRUE duplicates (same root defect, possibly different symptom
sites). Never merge findings that merely share a file or theme. Keep
`also_reported_by` so cross-confirmation is visible.

## 6. Reporting rules

- Reports live in the profile's audit dir under `<YYYY-MM-DD>/`.
- `INDEX.md` = the deduplicated registry: BLOCKING list + CLEANUP list,
  each item with a `[ ]` checkbox, stable ID, file:line, one-line evidence,
  and pointers into scope files.
- Scope files = full per-finding detail rendered from findings JSON by
  `render_findings.py` (deterministic format; IDs `<PREFIX>-<NN>` ordered
  by severity).
- **Caveats section is mandatory**: enumerate everything NOT verified
  (cut-off agents, skipped lenses, scopes not run). Unverified ≠ cleared.
- **Meta-observation is mandatory**: end with the highest-leverage question
  the project owner is not asking — the thing only an outside view sees.
- No silent caps: if coverage was bounded (top-N, sampling, timebox), say
  what was dropped.

## 7. Closure discipline (consumed by remediate / pre-ship-check)

- A finding closes ONLY against named executed evidence: a test run, a
  transcript, a rehearsal step — never "re-read the code, looks right".
- Closure commits cite finding IDs in the subject and carry an
  `Executed evidence: <command / run / transcript>` line in the body.
- Any closure of the shape "removed dead code / dropped unused stream /
  deleted the handler" gets an adjacent-duplicate sweep: enumerate the
  class the deletion assumed empty, across all languages in the repo.
- Registry checkboxes are ticked with the closing commit SHA beside them.
