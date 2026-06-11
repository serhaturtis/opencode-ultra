---
name: verify-closures
description: Adversarially re-verify claimed fixes/closures — given commits, PR(s), or audit-registry items marked closed, prove each closure real on current state, then hunt the same defect class in adjacent files and languages. Use when the user asks to verify fixes landed, re-check closed findings, review a remediation commit, or when an audit/tracker claims something is resolved. The instance being fixed is the cheap part; the class surviving is the expensive part.
---

# verify-closures

Read `../audit-common/METHOD.md` first (briefing preamble, evidence bar,
rubric). Stance: the closure author believed they fixed it — that belief
is the hypothesis under test. History shows closures are typically
code-correct in the named file and structurally incomplete one directory
over.

## Step 1 — Enumerate the claims

From the input (commit SHAs, PR, or registry items): extract one entry per
distinct closure claim — `{id, claim (one sentence), files, the original
defect's evidence if available}`. Commit bodies often bundle several;
split them. If a claim is vague ("hardened X"), record what it would have
to mean concretely to be checkable.

## Step 2 — Verify each instance on CURRENT state

Per claim, in order:

1. **Read the current code**, not the diff — later commits may have
   partially reverted or extended it.
2. **Re-run the original evidence** (the failing command, the repro, the
   probe). The defect being gone must be demonstrated, not inferred from
   the fix's presence. If the original evidence is unavailable,
   reconstruct the cheapest probe that would have failed before.
3. **Check the fix's own blast radius**: did it introduce a new defect
   (tightened check now rejecting valid input, deleted thing still
   referenced, changed wire shape breaking an unchanged consumer)?

## Step 3 — Generalize the class (the high-value step)

For each verified instance, derive the defect CLASS and enumerate it
exhaustively across the repo — all languages, all sibling files:

- env var added → re-derive the FULL required-config set for every
  process and re-check every environment (seam S1);
- stream/queue binding fixed → cross-check ALL subject/topic families
  producers↔bindings both directions (S5);
- lock/idempotency added to one loop → enumerate ALL periodic/startup
  loops and check each;
- validation added for one field/secret → list every sibling
  field/secret and check coverage;
- a guard/lint added → construct the failure it claims to catch and
  confirm it fires (S7); a guard that cannot fire is theater;
- dead code deleted on a "no callers/producers" claim → prove the claim
  with grep, both directions, snake/camel/Pascal variants.

Class instances found are NEW findings (full evidence bar, schema in
`../audit-common/findings-schema.json`).

## Step 4 — Verdicts

One per claim:

| Verdict | Meaning |
|---|---|
| `closed` | Instance demonstrably fixed, no class instances found |
| `partial` | Instance fixed; named aspects of the original finding remain |
| `refuted` | The closure does not actually fix the defect (evidence re-fails) |
| `class-survives` | Instance fixed; same class live elsewhere (list instances) |
| `unverifiable` | State exactly what is missing to verify — NEVER silently pass |

Output: a verdict table (claim, verdict, evidence one-liner) + new
findings rendered per METHOD reporting rules if part of a larger audit.
Closure claims you could not check are listed as unverified — unverified
is not cleared.
