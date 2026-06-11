# SEAM CHECKLIST — where self-review structurally fails

Defects cluster at integration seams: the places where the author's mental
model and reality can diverge without any single file looking wrong. Run
every class below; each has a concrete probe shape. "N/A" requires a stated
reason, not silence.

## S1. Env plumbing across process boundaries

Every config value a process **requires at boot or first use** must be
traced to every environment that launches it (dev compose, prod compose,
CI, deploy pipeline, docs/example env files).

Probe: enumerate required config from code (validators, `os.getenv` with
no safe default, fail-fast gates, library defaults like provider="X");
then `grep` each name in every compose/env/deploy file. Report BOTH
directions: required-but-unplumbed (boot crash / wrong-target default)
and plumbed-but-unread (dead config implying a missing feature).
Defaults that alias something real (e.g. `localhost:<port>` that is
another listener in the same container) are the worst class — flag any
network default pointing at localhost.

## S2. Cross-language mirrors

Any contract duplicated across languages (enums, taxonomies, payload
shapes, subject/route constants, validation rules).

Probe: diff the actual value sets side by side — never trust that a lint
"keeps them in sync" without reading what the lint actually compares.
Prefer golden fixtures: capture the real bytes one side emits and assert
the other side parses them.

## S3. Wire shapes (producer vs consumer)

Events, SSE/WebSocket payloads, queue messages: the producer's marshalled
output vs the consumer's parser/guard.

Probe: build or capture ONE real payload from the producer code path and
walk it through the consumer's guard line by line (field names, nesting,
enum representation int-vs-string, timestamp format, event-name string).
Exact string match on channel/event names — `a.b_c` vs `a.b.c` is a
defect, not a nitpick.

## S4. Code vs external reality

Anything the repo asserts about the world outside it: image digests,
registry paths, DNS names, hostnames in pipelines, IAM assumptions,
third-party API behavior, package versions.

Probe: query the external system (registry manifest API, `getent`,
provider docs) — never accept an in-repo constant as proof. Anything
that LOOKS generated-but-was-typed (hex with repeating patterns,
plausible-but-unverified IDs) gets existence-checked.

## S5. Producer/consumer existence (stranded pipelines)

For every event/subject/queue family: at least one live producer AND at
least one bound consumer/stream/handler, or an explicit retirement marker.

Probe: build the full producer list and the full binding/consumer list
from code (not docs), join them, report unmatched rows on both sides.
Comments claiming "no producer exists" are hypotheses — grep proves them.

## S6. Migration/cutover completeness (both directions)

After any rename, table drop, route retirement, or substrate cutover:
(a) nothing live still points at the retired surface (handlers over
dropped tables, FE calls to deleted routes, tests asserting old behavior,
docs instructing operators to use it); (b) everything the cutover promised
to CREATE exists (replacement routes, streams, renderers, lints).

Probe: grep the retired vocabulary exhaustively (snake/camel/Pascal
variants) across code, tests, docs, scripts, CI; classify each hit:
live residue / dangling half-deletion / intentional history.

## S7. Gates-that-gate

For every test suite, lint, healthcheck, and smoke probe that the project
treats as protection: does it actually run, on what, and can it detect
the failure class it claims to?

Probe: read the CI config for what is genuinely executed (services
present? markers/filters excluding tiers? does a non-zero exit
propagate?); run every gate locally and record exit codes; for each
smoke/lint assertion, construct the failure it claims to catch and check
it would actually fire (a "deleted endpoint" probe that passes on 500 is
theater). A gate red without consequence = the gate does not exist.

## S8. Boot-order and failure-mode assumptions

For each external dependency: what happens when it is down/slow at boot
and at runtime — fail-fast (with what supervisor?), bounded retry,
unbounded hang, or silent degradation (worst: serves while a subsystem is
dead). Check restart policies actually exist in each environment; check
health endpoints assert the dependencies they imply; check background
tasks have exception handling (an async task dying silently kills a
subsystem with no log).

## S9. Docs-as-instructions vs code

Runbooks, operator procedures, checklists: every command must be
copy-paste executable against the current system.

Probe: execute (or dry-run) each documented command; check referenced
files/sections/flags exist; checklist gates must name a command or
artifact whose pass/fail an operator can observe — a checkbox with no
verification procedure is descriptive text, and that is a finding.
