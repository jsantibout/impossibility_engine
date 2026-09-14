# IE-028 — One enumerator for a creature's sourced grants

state: IMPLEMENTING
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — owns `events.ts` alone; safe beside IE-027 (`spell-resolution.ts` only) and IE-029
depends-on: IE-020
worker: qb-builder · .claude/worktrees/agent-aa6095a1b720ab3be · worktree-agent-aa6095a1b720ab3be
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

Give the four sourced grant families on `CreatureState` one enumerator, so that
a fifth grant cannot be added to three of the five places that walk them.

### Why now

`CreatureState` carries four sourced grant arrays — `bonuses` (`events.ts:254`),
`armorClasses` (`:270`), `rollModifiers` (`:286`) and `grantedDefenses`
(`:308`) — and **five functions enumerate them by hand**: `releaseCasting`
(`:1999`), `releaseOnTarget` (`:2230`), `releaseGrants` (`:2344`),
`expireEffects` (`:3351`) and `holdsNothingOf` (`:3452`). The fourth array
arrived in tranche 4 and had to be threaded through all five.

Two more are queued: IE-033's Speed modifier and IE-035's weapon-attack rider.
Adding a fifth and sixth to a hand-enumerated set is how a grant ends up
released by a dispel and not by a deadline — silently, because each site is
correct on its own terms. This repository has recorded that exact failure
twice: the two lists of pool kinds IE-008 collapsed, and the four readers
`roll-modifiers.ts` replaced.

### Current relevant architecture

- The four arrays and their keys. `rollModifiers` is the one whose identity is
  **not** the bare source: `rollModifierKey` keys on the source *and the rolls
  it reaches*, because Beacon of Hope grants two modifiers from one casting.
  Any enumerator must preserve that.
- `releaseCasting` — the single place an ongoing record is removed, and the one
  door a broken Concentration, a deadline, a dispel and a departing caster all
  converge on.
- `releaseOnTarget` — releases a casting on one creature. `CLAUDE.md` records
  that it "computed the surviving bonuses and never applied them" for as long
  as it existed; that bug is fixed and is the reason this enumerator matters.
- `expireEffects` — reads the four in reverse to shrink `OngoingSpell.on`:
  a casting stops being on a creature when the **last** thing it owned there
  lapses.
- `holdsNothingOf` — the same four asked of one creature and one casting.

### Required behaviour

1. `grantSourcesOf(creature)` — every grant source the creature carries, across
   the four families.
2. `withoutGrants(creature, predicate)` — one removal, applied to all four.
3. The five functions above route through them. **Keys and readers are
   unchanged**, and `rollModifierKey`'s two-part identity is preserved.
4. Iteration order is fixed and deterministic, because condition sets and
   serialised state reach the log.

### Architecture constraints

- **Behaviour-preserving.** Same events, same state, both frozen logs fold.
- Do not collapse the four arrays into one. They are read by different rules
  and `CLAUDE.md` is explicit that a mode is not a bonus: folding them would
  make Blur a negative number.
- Do not touch `commands/spell-resolution.ts` — IE-027 owns it this wave.
- `scheduledDamage` is **not** a grant and does not join the enumerator: a hit
  still owed is the casting's debt, not something it is doing to the creature
  — the same reading that keeps a creature Insect Plague merely damaged out of
  `on`. Say so in the enumerator's docstring.

### Acceptance criteria

1. **The mutation that must redden two suites at once**: drop one family from
   the enumerator and watch the bonuses suite **and** the granted-defences
   suite fail. Report that result in the digest — it is the evidence that this
   is one enumerator rather than two spelled alike, and it is the same evidence
   `defendingModes` was held to.
2. Both frozen logs fold byte-identically; never regenerate either.
3. A Beacon of Hope granting two roll modifiers from one casting still ends
   both, and re-granting the same rolls still replaces rather than stacks.
4. `COVERAGE.md` byte-identical; `npm test`, `npm run typecheck`,
   `npm run lint` green.

### Tests and conformance

Existing suites are the oracle. Add one test that the enumerator sees all four
families — driven so that it fails if a fifth is ever added to the state and
not to the enumerator, if that is expressible without a hand-kept list; if it
is not, say so plainly rather than writing a list.

### Dependencies

**IE-020**, which adds two fields to `PendingCasting` in `events.ts`.

### Likely file surface

`packages/engine/src/events.ts` only, plus tests.

### Out of scope

Adding a fifth grant — IE-033 does that, through this enumerator. Splitting
`events.ts`. Any change to how a grant is keyed.

### Known risks

`expireEffects` reads the four to decide whether a casting still owns anything
on a creature. An enumerator that reports a grant the old code skipped would
keep a finished casting in `on`, which is a wrong answer to Dispel Magic and
is not caught by the frozen logs.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
