# IE-031 — Speed is read live, through one reader

state: IMPLEMENTING
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — owns `standing.ts`, `combat.ts`, `commands/movement.ts`, `commands/actions.ts`; safe beside IE-030
depends-on: IE-026, IE-029
worker: qb-builder · .claude/worktrees/agent-ae256127edaa000a9 · worktree-agent-ae256127edaa000a9
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

> **SUPERSEDED on 2026-09-14 by a recorded YELLOW decision — see "Architecture
> decision" below, which is authority and not commentary.** Struck in place
> rather than deleted: a brief that quietly changes shape is worse than one
> that shows its history, and a reviewer reads this section long before that
> one. This is the paragraph that caused the escalation.

~~So **do not rewrite `movementRemaining` into `movementSpent`.** That was
offered as the mechanism for a live allowance, and the live allowance already
exists by a different and working route. Flip the field only if the derivation
genuinely requires it, and if you conclude it does, say why in the digest
before doing it.~~

**The correction was wrong in kind, and the rule that replaces it is: store
what happened, derive what is left.** A stored remainder is a derived quantity
frozen at the moment it was seeded, and it is sound only while every later
change to the allowance moves in the direction a cap can express — downwards.
The live cap I verified was real and proved nothing: **a working live cap is
not evidence that a live allowance exists.** The test for the next brief is
whether the stored number can represent an allowance *larger than its seed*.
Here it could not, so the flip is required after all and the digest's argument
for it — `ARCHITECTURE_BLOCKED` plus an independent `ESCALATE` — is exactly
the argument the Out-of-scope line asked for.

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
class files' notes, `invariants.test.ts` — **and two reducer cases in
`events.ts`**, added on 2026-09-14 by the recorded decision below.

Those two lines are where this task's correctness lives, and Fable ruled the
task **stays inside the approved brief**: the objective is unchanged, and the
same change simply has to reach its second caller. `events.ts` is IE-030's
primitive, so this is **sequenced after IE-030 merges** — the foreman's call,
not a new task and not a widening.

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

## Architecture decision

**YELLOW, escalated by the builder as `ARCHITECTURE_BLOCKED` and independently
by its reviewer as `ESCALATE`, both at high confidence. Answered: a *fourth*
option — the delta audit's original, which the foreman's brief correction had
overridden.**

> **Question.** When the fold applies `movement-spent`, must it re-derive the
> allowance, and what should the turn budget store so a feature grant can raise
> it?

**Decision. Store the spend, not the remainder.** `TurnBudget` carries
`movementSpent` and `movementGained`, and the allowance is derived at every
read as `max(0, speedOf + gained − spent)` — **by the command and by the fold
alike**. The reducer keeps its guard and calls the command's own function with
the command's own inputs: `spendMovement` and `dash` both take the live
`speedOf`. No event shape changes. `movedSoFar` and the `min(remaining, …)`
clamp are **deleted, not re-based**.

**Because — and the first half is the general rule.** *Derived beats stored.* A
stored remainder is a derived quantity frozen at its seed, sound only while
every later change to the allowance moves in the direction a cap can express.
A grant raises it, and nothing but the seed can raise.

And the fold's backstop **is honest only when it is the command's own check
with the command's own inputs.** `events.ts:4360` already passes
`sheet.attacksPerAction` and `:4371` already passes conditions; `:4388` calls
the same function with *different* inputs and therefore measures against a
number the command never used. **That is a fork — the Dodge-versus-Fire-Bolt
shape this file already records — and it is why a green suite folded a corrupt
log.** The guard is the right shape; the inputs were wrong.

**It may call `speedOf` on the fold path**, and that was the load-bearing check:
every input is log-held — the pinned combatant speed, `sheet.standing` carried
by `character-created`, `equipped`, conditions. No catalogue opens, so the
fence `upgradeOngoing` stands behind is intact, and a future correction to the
Monk table changes future sheets rather than historical folds.

**The three options on the table were all refused, each for a principled
reason.** Option 1 keeps a stored number whose name lies — seeded at 30 and
driven to −5, `movedSoFar` becoming `spent − dash` by accident of algebra.
Option 2 keeps the remainder and moves its basis, which is the drift the brief's
own risk note warned about, and still cannot express a Longstrider cast on the
mover's own turn before they move — **which IE-033 meets on its first fixture**.
Option 3 deletes a live corrupt-log guard to make arithmetic pass.

**On the foreman's correction**, quoted because the next brief needs the rule
rather than the incident: it was *wrong in kind*, not merely wrong for grants
that raise. **A working live cap is not evidence that a live allowance exists**,
and the test is whether the stored number can represent an allowance larger than
its seed.

**Inside the approved brief: YES.** The Out-of-scope line reserved the field
flip "unless the digest argues for it first", and an `ARCHITECTURE_BLOCKED`
plus an independent `ESCALATE` is that argument; criteria 2, 3 and 6 are
unmeetable without it. The surface gains two reducer lines in `events.ts`,
which the **foreman sequences** — after IE-030 merges, since that is its
primitive — rather than a new task.

**Two debts this accepts, both to be written down rather than solved:**

1. **A Dash's gained movement survives a later Speed of 0 this turn.** Today's
   arithmetic already allows it and the new formula preserves the reading
   exactly; SRD's "Speed is 0 and can't increase" against banked extra movement
   is an open reading and the engine has not decided it. The sentence goes in
   the code.
2. **The single-reader sweep must add `events.ts` to its population** once the
   fold calls `speedOf`, or it cannot assert what its name claims. The
   reviewer's first "lesser" defect is **load-bearing** now rather than
   cosmetic — the sweep reads `EVENT_TYPE_SOURCE`, which excludes the very file
   the defect was in.

Second-order findings, for the queue rather than this task: `Combatant.speed`
on `combat-started` duplicates `sheet.baseSpeed` and, after this, is read only
as `speedOf`'s base — two sources for one number; the `has-speed` circularity
guard sweeps `allClasses()` only, missing subclass features, species traits and
feats; and `speedOf` falls back to `sheet.baseSpeed` outside combat and the
pinned speed inside it, two bases for one reader, harmless today and worth one
sentence in its docstring.

Fable's confidence: **high**.
