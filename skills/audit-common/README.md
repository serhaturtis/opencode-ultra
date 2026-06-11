# Audit skill suite

Four skills + this shared-assets directory. The **method is fixed here**; the
**facts of each project live in that project's `AUDIT-PROFILE.md`** (template
in this directory). New project = write the profile; every skill then works
unchanged.

| Skill | Use |
|---|---|
| `fresh-audit` | Full fresh-eyes codebase/project audit (scoped sweep + mandatory live execution + verified registry) |
| `verify-closures` | Adversarially re-verify claimed fixes: instance vs class |
| `remediate` | Close an audit registry with execution-verified, evidence-cited fixes |
| `pre-ship-check` | Per-diff seam + gates + execution-proof discipline before shipping |

Shared assets (referenced by all four skills via `../audit-common/`):

- `PROFILE-TEMPLATE.md` — per-project facts file template
- `METHOD.md` — evidence bar, severity rubric, briefing preamble, verification lenses, reporting rules
- `SEAM-CHECKLIST.md` — the integration-seam defect classes + concrete probes
- `findings-schema.json` — the structured-finding contract
- `render_findings.py` — deterministic findings-JSON → report-markdown renderer

## Install

Unpack into your AI agent's user-level skills directory, preserving the layout:

    tar xzf audit-skills-<ver>.tar.gz -C ~/.YOUR_AGENT/skills/

The suite has no dependencies beyond a POSIX shell, git, and Python 3.10+
(renderer only). Nothing here is model-specific or harness-specific: each
SKILL.md is readable as a human checklist, and all parallel fan-out steps
state a sequential fallback.

## Design principles (why these work model-independently)

1. **Auditor ≠ author.** Every instruction forces the agent to treat the
   project's own claims (commit messages, trackers, docs, "this is fine")
   as hypotheses to test. Self-review fails structurally; the briefing
   preamble in METHOD.md is the countermeasure.
2. **Evidence bar.** No finding without file:line + a command actually run +
   observed output. Anything less is marked confidence=low or dropped.
3. **Execution mandate.** You have not audited what you have not run.
   Every audit includes a live phase; every closure cites an execution.
4. **Gates are audited too.** A green gate is a claim about the gate.
5. **Class over instance.** Fixes are verified by enumerating the defect
   class across languages and directories, not by re-reading the diff.
6. **Deterministic output.** Findings are JSON against a schema, rendered to
   reports by a script — the format cannot drift with the model.
7. **No silent caps.** Whatever was NOT verified is enumerated as
   unverified — never silently treated as cleared.
