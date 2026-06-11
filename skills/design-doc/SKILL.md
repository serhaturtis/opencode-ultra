---
name: design-doc
description: Iteratively create and harden docs/DESIGN.md for a project. Bootstraps an initial design from the user's idea, then loops — surface gaps, ambiguities, and better options (including ones the user can't see), present concrete options with a recommendation + reasoning for each, WAIT for the user's choices, update the doc — repeating until the user judges it solid. Use when starting a new project, fleshing out a design, or pressure-testing an existing DESIGN.md. Hand off to implementation-plan once the design is solid.
---

# design-doc

Drive a project's `docs/DESIGN.md` from a rough idea to a solid design, through a
tight human-in-the-loop iteration. You are the critical design partner: you propose,
you assess honestly, you surface what the user can't see — but **the user decides.**

## Non-negotiable discipline
- **Never decide for the user.** Present options + your recommendation, then STOP and
  wait for their choices. Do not edit the design past a decision until they've chosen.
- **Give your own verdict.** When asked (and proactively each round), say plainly
  whether *you* think the design is solid and *why* — and actively hunt gaps the user
  hasn't spotted. "Looks fine" is a failure; find the unstated assumption.
- **The user declares "solid," not you.** Your job is to inform that call, not make it.

## 1. Bootstrap (only if docs/DESIGN.md doesn't exist)
From the user's idea, write a structured initial `docs/DESIGN.md`:
Problem & goals · Non-goals · Key decisions · Architecture · Data model ·
Interfaces/contracts · Risks & mitigations · Open questions.
Start a **temporary** "Decision log" section at the bottom (see §5).

## 2. The iteration loop (repeat until solid)
1. **Assess.** State your verdict: solid or not, and why. Hunt hidden gaps across
   lenses — unstated assumptions, missing decisions, edge/failure modes, simplicity
   (YAGNI), scale, security, maintainability, internal contradictions.
2. **List.** A numbered list of gaps / ambiguities / "better options we haven't
   considered."
3. **Options.** For EACH item, give 2–4 concrete options with tradeoffs, then a clear
   **recommendation with reasoning** and what you'd need to decide. **Then stop and
   ask the user to choose per item.**
4. **Update.** Apply the user's choices to DESIGN.md. Record each decision in the
   Decision log: the choice, the reasoning, and the alternatives rejected.
5. **Re-assess.** Ask "solid, or remaining gaps?" with your own recommendation. Loop.

## 3. Optional depth (ultracode)
For a thorough gap/option pass, you may fan out lenses with the `workflow` tool
(e.g. a fanout: simplicity, scale, security, failure-modes, maintainability), then
synthesize and present the findings. It's a batch step *within* a round — the user
still makes every choice interactively.

## 4. Definition of "solid" (exit checklist — inform the user)
- Every open question resolved or explicitly deferred (and marked as deferred)
- Every major decision made and recorded with its reasoning
- Risks have mitigations; interfaces/contracts are defined; non-goals are stated
- You can't find a gap the user would be unhappy to discover during implementation

## 5. Finalize (when the user calls it solid)
Fold any decision whose *reasoning* has lasting value into the relevant DESIGN.md
section as a brief note, then **delete the temporary Decision log** — the working
log exists to drive the loop, not to clutter the final document. DESIGN.md ends clean.
Then offer to move on with the **implementation-plan** skill.
