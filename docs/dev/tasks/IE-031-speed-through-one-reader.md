# IE-031 — Speed is read live, through one reader

state: DONE
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — owns `standing.ts`, `combat.ts`, `commands/movement.ts`, `commands/actions.ts`; safe beside IE-030
depends-on: IE-026, IE-029
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

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


## Completion digest

Builder **COMPLETE**, reviewer **PASS at high confidence**, three rounds after
the YELLOW. Branch `worktree-agent-ae256127edaa000a9`, commit `3b5d6c6`,
rebased to `9887829`. Tests **7196 → 7233 on `main`**, 37 new. Gauntlet green;
`COVERAGE.md` **88 → 91** executed features, Barbarian, Monk and Ranger each
+1, byte-clean under the reviewer's own regeneration.

Eight mutations, each failing for its own reason. Three are the ones that
matter: **reverting the reducer's `movement-spent` to the pinned Speed fails the
two fold assertions** — the reviewer's own defect, reproduced as a test;
reverting `dash-taken` fails the Dash, the SRD Exhaustion example and the
sweep; and **shifting the Monk's shared table column fails four cases in two
files, which is what says it is one column** rather than two that agree today.

### It found a wrong number that was already on `main`

`action-economy.test.ts` asserted that a Fighter with Exhaustion 3 who Dashes
has **45** feet — **while its own comment beside the assertion said 30**. The
comment and the book were right. SRD: *"If your Speed of 30 feet is reduced to
15 feet, you can move up to 30 feet this turn if you Dash."* A remainder seeded
at the **un-reduced** 30 and then raised by the **reduced** 15 gives 45, which
is neither number the SRD prints — the seed was the un-reduced Speed, so
Exhaustion reached the *increase* and not the *allowance*. The derivation gives
15 + 15.

That is the whole argument for Fable's decision arriving within an hour of it:
a stored remainder is a derived quantity frozen at its seed, and this one had
been frozen at the wrong number in a shipped test that asserted against its own
comment.

### One rules decision the live allowance forced

Making cost and allowance both read `speedOf` made **mounting free at a Speed
of 0** — "half your Speed" of 0 is 0, so the guard compared 0 against 0 and
passed, where a pinned cost of 15 against an effective 0 used to refuse. Caught
in review round 3, restored under its original `not_enough_movement` code on
SRD's "**During your move**", with the fixture the suite had never had.

## Risk gate

**Inspected**, and more closely than most: this task changes a state
representation, two reducer cases and the public surface, and it is the task
that was already wrong once about whether the fold agreed with the command.

What I verified rather than accepted:

- **Both reducer cases now pass `speedOf`** — `movement-spent` and
  `dash-taken` — with the comment at each saying why a backstop with different
  inputs is a fork rather than a guard. The runtime import of `standing.ts`
  into `events.ts` carries the argument that it opens no catalogue: every input
  `speedOf` reads is log-held, so the fence `upgradeOngoing` stands behind is
  intact.
- **Both frozen logs fold unchanged**, run explicitly rather than inside the
  full suite: `persistence.test.ts`, `persistence-2.test.ts` and
  `scenario.test.ts`, **53 tests, all passing**, with `packages/engine/fixtures`
  showing a zero-line diff. That is criterion 6, and it is the criterion this
  task claimed once on a suite that was green while the fold threw.
- The full suite on `main` at **7233 across 111 files**, `COVERAGE.md`
  regenerating byte-clean.

Classification: **GREEN**.

## Architecture decision

**Recorded in full above under its own heading, answered by Fable as a YELLOW.**
Summary: store the spend, not the remainder; derive the allowance at every read,
in the command and in the fold alike; the reducer keeps its guard and calls the
command's own function with the command's own inputs.

The general rule it produced, which is the part that outlives the task:
***store what happened, derive what is left.*** A working live cap is not
evidence that a live allowance exists, and the test for a brief is whether the
stored number can represent an allowance **larger than its seed**.

## Merge record

Merged to `main` as `9887829`, fast-forward, pushed. Rebased by the foreman
twice; the second conflicted on `COVERAGE.md`, one of the five `merge=binary`
paths, and was resolved by `CONTRIBUTING.md`'s playbook — **take either side,
then regenerate, never hand-merge the numbers**. The regenerated file came back
carrying exactly this branch's own three features, which is the evidence the
resolution was right rather than merely conflict-free.

`main` verified after the merge: typecheck ✓, lint ✓, **7233 tests across 111
files** ✓, both frozen logs and the scenario determinism run explicitly ✓,
`COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief as repaired by the recorded
decision; **2** `COMPLETE`; **3** `PASS` at high confidence; **4** defects
resolved, including the reviewer's own fold defect, now a test; **5** gauntlet
green; **6** conformance; **7** the architecture blocker is answered and
recorded; **8** no deviation taken — the field flip *is* the decision, and the
superseded brief line is struck in place; **9** the primitives are declared and
the two `events.ts` lines are the surface the decision added; **10** five files
outside the original surface, each forced — two by the Monk table, one by the
brief's own non-negotiable, two by a removed field they read; **11** the
`COVERAGE.md` conflict resolved by the playbook; **12** re-verified on `main`;
**13** risk gate inspected, GREEN.

**Wave 3 complete. Unblocks IE-033**, which needed this reader and would have
met Fable's Longstrider objection on its first fixture.
