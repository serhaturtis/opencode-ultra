---
name: implementation-plan
description: Derive docs/IMPLEMENTATION.md from a solid DESIGN.md and verify it is faithful to and fully covers the design. Builds the plan (modules, files, sequencing, contracts, test strategy, milestones) with a design→implementation coverage map, then loops — flag any design point uncovered or contradicted, present options + a recommendation, WAIT for the user's choices, update — until every design point is covered and the user judges both docs solid. Use after the design is solid, or to check an implementation plan against its design. Counterpart to design-doc.
---

# implementation-plan

Turn a solid `docs/DESIGN.md` into a `docs/IMPLEMENTATION.md` that is **faithful to**
and **fully covers** the design — then prove it, point by point. Same human-in-the-loop
discipline as design-doc: you propose and assess; the user decides and declares solid.

## Non-negotiable discipline
- **Never decide for the user.** Options + recommendation, then STOP for their choices.
- **Give your own verdict** on coverage and fidelity each round; name what's missing.
- **The user declares "solid," not you.**
- **No silent design drift.** If realizing the design reveals the design is wrong or
  incomplete, do NOT quietly change course in the plan — surface it as a *design*
  change and bounce back to the **design-doc** skill (update DESIGN.md + its decision
  log). The two documents must never diverge.

## 1. Precondition
DESIGN.md exists and the user considers it solid. If it has gaps, stop and switch to
design-doc first.

## 2. Build docs/IMPLEMENTATION.md
Describe how each design decision is *realized*: modules & files · sequencing /
milestones · interfaces & contracts · data/storage · test & verification strategy ·
rollout. Include a **Coverage Map**: a table mapping every DESIGN.md decision/section →
its implementation approach. Keep a **temporary** working-notes section (deleted at §5).

## 3. The fidelity loop (repeat until solid)
1. **Coverage check.** Is every design point covered? State your verdict; list points
   that are uncovered, under-specified, or only vaguely addressed.
2. **Fidelity check.** Does the plan silently change or contradict the design? Flag any
   drift; route genuine design changes back to design-doc rather than absorbing them.
3. **Options.** For each gap, 2–4 concrete options + tradeoffs + a recommendation with
   reasoning. **Then stop and ask the user to choose.**
4. **Update.** Apply choices to IMPLEMENTATION.md and refresh the Coverage Map.
5. **Re-assess.** Ask "fully covered and solid, or remaining gaps?" Loop.

## 4. Optional depth (ultracode)
You may fan out review lenses with the `workflow` tool — testability, sequencing /
dependency order, operational risk, rollback — synthesize, and present. The user
still makes every choice.

## 5. Definition of "solid" (exit checklist — inform the user)
- Every design point in the Coverage Map has a concrete implementation approach
- No silent drift from the design (any real change went back through design-doc)
- The test/verification strategy covers the risky parts
- The sequencing is feasible (dependencies are ordered, nothing blocks on itself)

## 6. Finalize (when the user calls it solid)
Delete the temporary working-notes section; keep IMPLEMENTATION.md and its Coverage
Map. DESIGN.md and IMPLEMENTATION.md are now consistent and complete.
