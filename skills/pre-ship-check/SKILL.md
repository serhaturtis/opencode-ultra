---
name: pre-ship-check
description: Per-change shipping discipline — before a commit/PR/slice ships, run the seam checklist against the diff, verify the gates that should cover it actually do, and produce the "Executed evidence" ship-note proving the change ran for real. Use when the user asks to check work before shipping/committing a feature or slice, or wants the standing pre-ship pass. Lightweight standing counterpart to fresh-audit: catching seam defects per-diff is what makes big audits rare.
---

# pre-ship-check

Scope: the current diff (working tree, branch, or named commits) — not the
whole codebase. Read `../audit-common/SEAM-CHECKLIST.md`; you will apply
it diff-locally. Target cost: minutes, not hours — depth scales with the
diff's blast radius.

## 1. Blast-radius map (2 minutes)

From the diff, list: new/changed config values; new/changed wire shapes
(events, payloads, routes, enums); anything deleted or renamed; new
background loops/tasks; contracts mirrored in another language; claims the
commit message makes ("fixed", "green", "no callers").

Each list item routes to a check below. Empty lists are stated, not
skipped.

## 2. Seam pass (diff-local)

- **New config (S1):** every new required value traced into EVERY
  launch environment (dev, prod, CI, deploy, example env files). A
  localhost-ish default that aliases another listener = reject.
- **Wire shapes (S2/S3):** for each producer/consumer or cross-language
  mirror touched, verify with one REAL payload or value-set diff — not
  by reading both sides and nodding. New event/subject names: exact-string
  grep on the consumer side.
- **Deletions/renames (S6):** grep the retired vocabulary (all case
  variants) across code, tests, docs, scripts, CI. "No callers" claims
  are proven, not trusted. Check the inverse: everything the change
  promises to create exists.
- **External reality (S4):** any digest, version, registry path, hostname,
  or third-party behavior the diff asserts gets existence-checked against
  the external system. Never commit a plausible-looking identifier you
  did not query for.
- **New loops/tasks (S8):** exception handling, supervision, multi-replica
  safety (lock/idempotency), bounded retries — each named in one line.

## 3. Gates check (S7)

Identify which tests/lints SHOULD catch this change breaking, then verify
they exist, CI actually runs them (no missing service, marker filter, or
swallowed exit code), and at least one fails when you sabotage the change
for a moment (cheap mutation check — revert the sabotage). If no gate
covers the change's core behavior, write one or explicitly record the gap
in the ship-note.

## 4. Execution proof

Name the command/transcript that exercised this change **live** — the
real app, real boot, real request, not only unit tests. If you cannot
name it, run it now: boot per AUDIT-PROFILE.md, drive the touched path,
capture the output. For changes whose live path is unreachable (prod-only
code), say so explicitly and state the compensating verification — that
line is what turns into a staging-rehearsal item instead of a silent gap.

## 5. Ship-note

Emit a short note (paste into the commit/PR body):

    Pre-ship check: <date>
    Blast radius: <one line>
    Seams checked: S1 <result> · S3 <result> · S6 <result> ... (n/a with reason)
    Gates: <which gates cover this; mutation check result; gaps>
    Executed evidence: <command(s) + outcome>
    Known gaps: <anything shipped unverified, stated plainly>

Honesty rule: a stated gap is acceptable; a silent one is not. If the
check finds a defect, fix it or file it — never ship it unstated.
