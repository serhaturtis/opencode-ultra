---
name: remediate
description: Close an audit findings registry with execution-verified fixes — batch findings by verification target, fix root causes, prove each closure with a named execution, commit with finding IDs + "Executed evidence:" lines, tick registry checkboxes. Use when the user asks to fix audit findings, work through a findings registry/INDEX, or remediate review results. Counterpart to fresh-audit; the discipline exists because inspection-only closures reproduce the same defect class within days.
---

# remediate

Read `../audit-common/METHOD.md` §7 (closure discipline) first. Prime
directive: **nothing closes by inspection.** Every closure is proven by a
named execution — a test run, a transcript, a rehearsal step — and the
commit says which.

## Step 1 — Intake

1. Load the registry (audit INDEX or findings list). Confirm the
   milestone/charter so blocking still means what it meant.
2. **Extract the policy decisions hiding in the findings** (anything with
   two defensible fixes: contract direction, retire-vs-rebuild, policy
   contradictions). Put them to the user as an explicit decision list
   BEFORE coding. Record the answers where the project records decisions.
3. Note findings needing things only the user can provide (credentials,
   hosts, legal sign-off) — schedule around them, never fake them.

## Step 2 — Batch by verification target

Group findings by **what execution will prove them closed** — never by
file, author, or severity. Typical targets, cheapest first:

1. CI truth (suites/lints that should be green — fix the gates first so
   later batches land against gates that actually gate)
2. local cold-boot of the production configuration
3. the product's user journey, driven end-to-end (per AUDIT-PROFILE.md)
4. pipeline/staging rehearsal (tag → deploy → smoke on a real target)
5. induced-fault checks (alert actually pages, supervisor actually
   restarts)

Within a batch, order by dependency. Expect each execution to surface new
findings — they join the registry with IDs; they do not derail the batch.

## Step 3 — Fix discipline

- Root cause, not symptom; fail fast over silent degradation; no
  workarounds that paper over the finding (if a workaround is genuinely
  the right scope, say so explicitly in the commit and leave the finding
  open at reduced severity).
- Fix the CLASS the finding exemplifies when cheap (see verify-closures
  Step 3 for class shapes); otherwise file the class sweep as its own
  registry item — never silently fix one instance of a known-multiple.
- Where the defect crossed a seam, add the guard that makes the class
  unshippable again (lint, golden fixture, boot check) — and prove the
  guard fires by constructing the failure once.
- Small mechanical carry-fixes encountered en route are allowed with an
  explicit `Carry-fix:` note; anything larger becomes a new registry item.
- **Red CI halts the batch.** Nothing lands on red.

## Step 4 — Close with evidence

Per batch:

1. Run the batch's named execution; capture output.
2. Commit: finding IDs in the subject; body carries
   `Executed evidence: <command / run / transcript path>` per finding.
3. Tick the registry checkboxes `[x]` with the closing SHA beside them.
4. Deletion-shaped closures get the adjacent-duplicate sweep (METHOD §7)
   before the batch is called done.
5. If verification infrastructure exists (a reviewer, a fresh agent, the
   verify-closures skill), the highest-risk closures of the batch get an
   independent pass — the fixer's own confidence is not evidence.

## Step 5 — Acceptance

The effort is done when the audit's acceptance executions (journey
transcript, rehearsal, suite runs) pass **twice in a row**, and the
registry contains only: ticked items with SHAs, explicitly waived items
(with owner + expiry), and explicitly deferred items. No item may end the
effort silently un-statused.
