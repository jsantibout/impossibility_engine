# IE-031 — Speed is read live, through one reader

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — owns `standing.ts`, `combat.ts`, `commands/movement.ts`, `commands/actions.ts`; safe beside IE-030
depends-on: IE-026, IE-029
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

One reader, `speedOf(state, id)`, is the only place the command layer asks what
a creature's Speed is — so that a feature, a condition and (after IE-033) a
spell all reach the same number.

### Why now

Every allowance in the game is measured against Speed, and there are **three
spellings of it on `main`**, none of which can see a feature grant. This is the
foundation IE-033's Speed modifier stands on, and it is the shape
`roll-modifiers.ts` already applied to modes and `defensesOf` to defences: one
gatherer, several inputs.

**The premise as the audit stated it is partly stale, and the brief is
corrected accordingly.** The audit said "the budget records what has been spent
and the allowance is read live at every spend", implying neither is true today.
Verified on `main`, both halves are *already* true for **conditions**:

- `combat.ts:527` — `spendMovement` computes
  `movedSoFar = combatant.speed - remaining` and caps at
  `min(remaining, effectiveSpeed - movedSoFar)`, with `effectiveSpeed` from
  `conditionSpeed(conditions, combatant.speed)`. Its comment already states the
  rule: "a creature that has walked 20 feet and is then Grappled has 0 left,
  not a fresh allowance".
- `combat.ts:472` — `dash` reads the same way, quoting the SRD line for it.
- `commands/actions.ts:527` — a third spelling,
  `conditionSpeed(creature.conditions, declared)`, where `declared` is
  `combat.order.find(...)?.speed ?? creature.sheet.baseSpeed`.

So **do not rewrite `movementRemaining` into `movementSpent`.** That was
offered as the mechanism for a live allowance, and the live allowance already
exists by a different and working route. Flip the field only if the derivation
genuinely requires it, and if you conclude it does, say why in the digest
before doing it.

What is genuinely missing is: one reader; the base being the pinned
`combatant.speed` rather than something derived; and **feature grants, which no
site can see at all**.

### Current relevant architecture

- `packages/engine/src/conditions.ts` — `conditionSpeed`, which already
  applies the condition rules and Exhaustion.
- `packages/engine/src/combat.ts:203` — `fullBudget(speed)`; `:235`, `:247`,
  `:283` seed budgets from `combatant.speed`, pinned at `startCombat`.
- `packages/engine/src/commands/movement.ts:481` — `mountingCost(combatant.speed)`.
- `packages/engine/src/standing.ts` — where `standingDefenses` derives a
  feature's grant from the world on every read. `speedOf` belongs beside it and
  is derived the same way.

### Required behaviour

The order, **decided by the architect and GREEN — a deviation is
`ARCHITECTURE_BLOCKED`**, because the SRD prints no order:

> base, plus flat changes (features, and Exhaustion's −5 per level), then
> **halved once** if any halving effect applies (presence, not count — the
> reading Resistance and Advantage already take), then **0** if any zeroing
> effect applies, never below 0.

The SRD lines behind it:

- Exhaustion: "Your Speed is reduced by a number of feet equal to 5 times your
  Exhaustion level."
- Grappled: "Your Speed is 0 **and can't increase**." Restrained prints the
  identical sentence. That clause is why zero is applied last and wins.
- Dash: "The increase equals your Speed **after applying any modifiers**. With
  a Speed of 30 feet, for example, you can move up to 60 feet on your turn if
  you Dash. If your Speed of 30 feet is reduced to 15 feet, you can move up to
  30 feet this turn if you Dash."

Feature grants derived like `standingDefenses`: Fast Movement (+10 while
unarmoured), Unarmored Movement (the Monk table), Roving (+10). Each quoted
from `classes.md` in the commit.

`dash` adds `speedOf`; mounting costs half of `speedOf`; the three reading
sites route through it.

### Architecture constraints

- **Steady Aim stays `manual`.** "Until the end of the current turn" is a
  `Duration` member with no other consumer, and this repository does not add a
  member ahead of its primitive. Its note says so.
- Movement **modes** — Fly, Climb, Swim — are refused outright: no rule reads
  them, so it would be a vocabulary with no reader. The audit refused them
  twice; this does not reopen it.
- Do not change what `conditionSpeed` computes. Fold it into `speedOf` as one
  input.
- No spell or effect grants a Speed change yet. **IE-033 adds that**, through
  this reader. Leave the seam and do not build the grant.

### Acceptance criteria

1. `speedOf` is the only Speed reader in the command layer, asserted by a
   sweep in `invariants.test.ts` over `commands/`, `combat.ts` and
   `standing.ts` — driven over a synthetic second reader it must catch.
2. A Monk's Unarmored Movement raises the allowance, the Dash and the mounting
   cost, from one change.
3. A creature that has moved 20 of 30 feet and is then Grappled has 0 left,
   not a fresh allowance — the existing rule, still true.
4. Exhaustion 2 with Fast Movement composes as base + 10 − 10.
5. A halving effect and a second halving effect halve **once**.
6. Both frozen logs fold unchanged; `scenario.test.ts`'s determinism holds.
7. `COVERAGE.md` unchanged unless a class note changed; `npm test`,
   `npm run typecheck`, `npm run lint` green.

### Tests and conformance

The multiclass fixture is the discriminating one for a per-class table: a Monk
2 / Fighter 3 reads the Monk table at Monk level. A single-class fixture cannot
tell the two numbers apart — the lesson `poolSizeOf` already carries.

### Dependencies

**IE-026** then **IE-029**, both of which edit `commands/movement.ts` and
`commands/actions.ts` before this.

### Likely file surface

`standing.ts`, `combat.ts`, `commands/movement.ts`, `commands/actions.ts`, the
class files' notes, `invariants.test.ts`.

### Out of scope

Any spell-granted Speed change (IE-033). Movement modes. Steady Aim. The
`movementRemaining` field, unless the digest argues for it first.

### Known risks

`fullBudget` seeds from the pinned speed at three sites. If `speedOf` becomes
the seed as well as the cap, a feature gained mid-fight changes the budget's
basis and `movedSoFar` arithmetic silently shifts. Prefer changing the **cap**
and leaving the seed, and state which you did.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
