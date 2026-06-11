# AUDIT-PROFILE — <project name>

<!--
Per-project facts consumed by the audit skill suite (fresh-audit,
verify-closures, remediate, pre-ship-check). Keep this file at the repo
root as AUDIT-PROFILE.md. Update it when topology changes — a stale
profile is itself a finding.
-->

## Topology

- **Services:** <name (lang, role, ports)> — one line each
- **Infra deps:** <postgres/redis/queue/object-store... with ports>
- **External deps:** <auth provider, payment, email, LLM APIs...>

## Commands (must be copy-paste runnable)

- **Boot full stack:** `<command>` (expected time; health URL)
- **Tear down (SAFE):** `<command>` — state whether volumes/data survive
- **Test suites:** one line per suite with the exact canonical invocation
- **Lints/gates:** `<how to run all CI gates locally>`
- **Migrations:** `<command>` + the SSoT location for schema

## The user journey (the product's definition of "works")

Numbered steps from "new user, cold" to the product's core value delivered,
with the API endpoints or UI actions for each step. This is what
fresh-audit's live phase drives and what remediate's acceptance re-runs.

1. <signup / login>
2. <activation / onboarding>
3. <core action>
4. <core value delivered>
5. <feedback or approval loop>

## Canonical truth (priority order — higher wins)

1. <e.g. runtime/migrations are SSoT for schema>
2. <spec / API contract files>
3. <requirements docs>

State explicitly which docs are HISTORICAL and must not be read as current.

## Reporting convention

- **Audit reports:** `<dir>/audits/<YYYY-MM-DD>/` — INDEX.md + scope files
- **Project-state doc (read AS CLAIMS, never as facts):** `<path or "none">`
- **Closure convention:** finding IDs in commit subjects; `Executed
  evidence:` line in bodies; registry checkboxes ticked with closing SHA

## Safety rails (live phases MUST obey)

- Containers/processes that belong to OTHER projects on this host: <list>
- Data that must never be destroyed: <volumes, dirs>
- Commands that look safe but aren't: <e.g. `compose down -v`>
- Secrets handling: never print values; check presence with `${VAR:+set}`

## Known waivers

Findings consciously accepted (ID, reason, expiry date). The audit skills
re-surface expired waivers instead of skipping them.
