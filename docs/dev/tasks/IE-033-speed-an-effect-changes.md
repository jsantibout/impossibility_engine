# IE-033 — A Speed an effect changes

state: IMPLEMENTING
lane: mechanism
tranche: 5
parallel-safe: NO — a union task touching `events.ts`, `spell-resolution.ts` and `standing.ts`; runs alone
depends-on: IE-031, IE-032
worker: qb-builder · .claude/worktrees/agent-a5cb96033d87e4449 · worktree-agent-a5cb96033d87e4449
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

A fifth sourced grant: a Speed an effect changes, read by IE-031's `speedOf`
and ended through the door every other grant already leaves by.

### Why now

`speed-and-movement-modes` blocks 16 spells and **finishes none** — which is
exactly why it needs splitting rather than building whole. The modifier half is
a rule the engine owns and does not have; the modes half (Fly, Spider Climb,
Gaseous Form) is a vocabulary with no reader, which the audit refused twice.
This builds the first and retires its id, leaving `movement-modes` as the
honest remainder.

It is also **the first production writer of `EffectTarget.grants`** — verified
on `main`: `duration.ts:170` declares the member, `:399` reads it in the
reducer, and the only constructions of it anywhere are four in
`granted-defenses.test.ts`. IE-017 built the member for Superior Hunter's
Defense and no runtime path creates one. Ray of Frost does.

### Current relevant architecture

- `packages/engine/src/duration.ts:170` — the `grants` `EffectTarget` member;
  `:399` its reducer case.
- IE-031's `speedOf` in `standing.ts` — the one reader.
- IE-028's `grantSourcesOf` / `withoutGrants` — the enumerator the fifth family
  joins.
- `checkGrantLifetimes` in `spell-schema.ts` — the rule that a casting-owned
  grant must have something that ends it.
- `ModifierRider` — which carries no `lasts` today, because nothing ended a
  grant before its casting did. `EffectTarget.grants` is what changed that.

### Required behaviour

1. A fifth sourced grant on `CreatureState`:
   `{ source, change: add(feet) | halve | zero }`, event
   `speed-modifier-granted`, ended through the existing door. `speedOf` reads
   it in IE-031's decided order.
2. A standalone `speed` effect kind. SRD Longstrider: "The target's Speed
   increases by 10 feet until the spell ends."
3. A `ModifierRider` kind `speed` that **may carry `lasts`**. SRD Ray of Frost:
   "On a hit, it takes 1d8 Cold damage, and its Speed is reduced by 10 feet
   until the start of your next turn." A cantrip is Instantaneous, so the
   casting cannot own the rider — this is what `EffectTarget.grants` exists for,
   and `checkGrantLifetimes` must read it.
4. Hypnotic Pattern's Speed 0 rides its Charmed save. SRD: "While Charmed, the
   creature has the Incapacitated condition and a Speed of 0."

### Architecture constraints

- **The shape id splits.** The modifier the engine now owns retires;
  `movement-modes` keeps Fly, Spider Climb, Gaseous Form and the rest as the
  gap the audit refused to build. Record the split in `SPLIT_BUNDLES` with its
  `[spellId, clause, wentTo]` triples, so the arithmetic is checked — IE-015's
  instrument, and the reason a bundle cannot quietly lose a clause.
- A rider is a **leaf**: it rolls no d20, names no target, spends nothing,
  opens no window. A Speed change qualifies; that is why it may be a rider.
- `halve` and `zero` are **presence, not count** — the reading Resistance and
  Advantage already take, and the order IE-031 fixed.
- Do not add a movement mode. Do not add a `Duration` member.

### Acceptance criteria

1. Longstrider moves from tracked to executed, and its +10 reaches the
   allowance, the Dash and the mounting cost through `speedOf`.
2. Ray of Frost's reduction expires at the start of the caster's next turn,
   with the casting long over — driven end to end, and it is the **first**
   production exercise of the `grants` timer.
3. Hypnotic Pattern's Speed 0 lands on a failed save and lifts with the
   condition; the spell leaves `PARTIAL_SPELLS` on this clause.
4. Two halving effects halve once; a zero beats an add.
5. `checkGrantLifetimes` refuses a `speed` rider on an Instantaneous definition
   that says neither `lasts` nor `outlivesCasting`.
6. The split bundle's arithmetic passes; `npm run coverage` run and committed.
7. Both frozen logs fold unchanged.

### Tests and conformance

`blocked-on.test.ts` checks the split in both directions. Slow stays undefined
on its other clauses and must still be blocked — a shape that empties is
**removed**, not renamed, and if this one empties, remove it.

### Dependencies

**IE-031** (the reader) and **IE-032** (the previous union wave).

### Likely file surface

`events.ts`, `spell-definitions.ts`, `spell-schema.ts`,
`commands/spell-resolution.ts`, `standing.ts`, `duration.ts`,
`scripts/missing-shapes.ts`, `COVERAGE.md`.

### Out of scope

Movement modes. Slow's other clauses. Freedom of Movement, which is condition
immunity and a different shape.

### Known risks

`EffectTarget.grants` has never been exercised by a runtime path. If its
reducer case turns out to assume something only the test fixtures provide, that
is a finding worth reporting rather than working around.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
