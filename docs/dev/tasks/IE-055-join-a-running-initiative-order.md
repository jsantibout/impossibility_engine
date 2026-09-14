# IE-055 — A creature can join a fight already under way

state: DONE
lane: mechanism
tranche: 7
parallel-safe: CONDITIONAL — `events.ts`, one fold domain, `commands/initiative.ts`; not beside IE-050 or IE-053
depends-on: IE-050
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 7."

## Brief

### Objective

A command that puts one creature into a **running** Initiative order, so that
the turn-context request IE-046 raises can actually be satisfied.

### Why now

**IE-046 found a request that cannot be answered cleanly.** Its `not_in_combat`
request — a fight exists and this creature has no place in it — has to name
**two** commands, because neither alone does the job: `rollInitiativeFor`
produces a number, and `beginCombat` replaces the whole order. There is no
command that adds one creature to a fight already under way.

That is the same class of hole IE-040 closed for adding a creature at all: a
fact a tool surface must be able to establish, with no single command that
establishes it. And it is directly downstream of the owner's turn-context
decision — the flow ends "*beginCombat / initiative establishes turn context*",
which works for a fight that has not started and does not work for one that has.

A reinforcement walking in mid-fight is also the most ordinary thing at a table.

### Current relevant architecture

- `commands/initiative.ts` — `rollInitiativeFor`, which produces a number and
  changes no order.
- `beginCombat` — takes the whole order; `combat-started` carries it. A rite
  open when it fires simply enters the obligation (IE-041).
- `Combatant` carries the pinned `speed`, which is why both frozen logs measure
  against the Speed a fight began with.
- `state.combat` — `order`, `turnIndex`, `turnsTaken`, and the turn counts that
  `invariants` asserts are kept in exact step with `order` by every operation
  that changes either. **That agreement is the thing this task must not break.**

### Required behaviour

1. A barrel command that inserts one creature into the running order at a stated
   Initiative number, through `once`, emitting an event of its own. It spends
   nothing — joining a fight is not an action a creature takes on its turn — so
   it is **not** a spender; follow `relocateCreature`'s precedent on whether it
   is nonetheless guarded, and justify the choice in the digest.
2. **The order and the turn counts stay in exact step.** A creature inserted
   mid-round must have a turn count consistent with where the insertion falls
   relative to `turnIndex`, so that it takes its first turn when the order
   reaches it and not before, and so no existing combatant's turn is skipped or
   repeated.
3. Insertion is by Initiative number, with the tie rule the engine already
   applies when a fight begins — read it rather than inventing a second one.
4. Refuses a creature already in the order, an unknown creature, and a fight
   that is not running. Each code asserted by name.
5. `rollInitiativeFor`'s number feeds it; the two together are what
   `not_in_combat`'s request names, and **IE-046's request text is updated to
   name this command** instead of describing two.

### Architecture constraints

- one authoritative order; no second path that changes `combat.order`;
- the order/`turnCounts` agreement is an invariant, not a convention — the
  existing sweep asserts it and must keep passing;
- no change to how a fight begins or ends.

### Acceptance criteria

1. A creature joins mid-fight, takes its first turn when the order reaches it,
   and no other combatant's turn is skipped or repeated — asserted by walking a
   full round before and after.
2. Inserted **before** and **after** the current `turnIndex` are different
   cases and both are driven; the one that is easy to get wrong is the
   insertion that lands earlier in the order than the creature currently
   acting.
3. The order/`turnCounts` agreement holds after the insertion, asserted by the
   existing sweep and by a fold.
4. IE-046's `not_in_combat` request names this command, and a test drives the
   whole loop: refusal → join → the original action resolves.
5. Both frozen logs fold unchanged; the new event type joins
   `persistence-2.test.ts`'s uncovered-by-construction ledger with its reason.
6. Idempotent under one command id; refusal codes asserted by name.

### Tests and conformance

**`docs/design/space-and-areas.md`**'s `## Combat Model` section gains the
command — that document, not `CLAUDE.md`, is authoritative for the combat model,
and `docs/design/time-and-turns.md` is authoritative for the Initiative-order
clock. Read both before implementing. `invariants.test.ts`'s emitted-type and
idempotency sweeps pick the new event and command up.

### Dependencies

IE-050 — it adds a reducer case, which that task moves.

### Out of scope

Surprise, Initiative ties beyond the rule the engine already applies, and
removing a creature from an order (`removeCombatant` exists). Anything about
*when* a fight should start — that is Maestro's, and IE-054's brief says so.

### Known risks

Medium, and all of it in requirement 2. The turn counter and the order are kept
in step by every existing operation, and an insertion is the first operation
that changes the order's *length* mid-round. Get that wrong and a creature acts
twice or never — a wrong number with no symptom until somebody counts turns.

## Completion digest

**Merged `4f23895`**, 13/13 auto-merge conditions, reviewer PASS at high confidence on
the **first** round, **no deviations declared**. `main` green at **8,668 tests
across 126 files**; both frozen logs absent from the diff.

### What it closes

IE-046 raised a `not_in_combat` request — *a fight exists and this creature has
no place in it* — that could not be answered cleanly, because it had to name
**two** commands and neither did the job: `rollInitiativeFor` produces a number,
`beginCombat` replaces the whole order. `joinCombat` is the command that was
missing. `turnContextFor`'s request now names `rollInitiativeFor` then
`joinCombat`, and `turn-context.test.ts` drives the whole loop — refusal, join,
the same casting resolving — with an assertion that the request contains
`joinCombat` and **not** `beginCombat`, which fails on `main`.

### The comparator extraction, verified by the foreman

Requirement 3 said the insertion must read the tie rule the engine already
applies rather than writing a second one. `startCombat`'s inline comparator
became a named `byInitiative`, and the change is exactly behaviour-preserving:

```
before:  (a, b) => b.initiative - a.initiative || b.tiebreak - a.tiebreak || a.index - b.index
after:   (a, b) => byInitiative(a, b) || a.index - b.index
```

with `byInitiative` being precisely the first two terms. The insertion is
`findIndex(c => byInitiative(combatant, c) < 0)` — the first index the joiner
ranks ahead of.

**The test that makes this mean something is the oracle**: `addCombatant` and
`startCombat` are asserted to agree over **21 initiative/tiebreak combinations**.
That is the only test that can catch a second comparator diverging on a tie, and
the builder's mutation — `< 0` to `<= 0` — fails both it and the tie case.

### The owner's boundary, held

Nothing here decides *when* a fight begins. That is the DM's authority, and
IE-054's brief says so. This builds the command; something above the engine
chooses to call it. The initiative number is the caller's, exactly as at
`beginCombat`, with `rollInitiativeFor` the engine path — so no new hole in
**the model never produces a number**.

### Deliberately unguarded, and the reasoning is adjacent to IE-057's live question

`joinCombat` spends nothing and is **not** guarded on unsettled debt, and the
docstring makes the `relocateCreature` comparison **explicitly** rather than
leaving it implied: joining moves nobody and raises no area debt, and
`beginCombat` is unguarded for the same reason.

That is worth noting beside IE-057, which is deciding at this moment whether
`endConcentration` should be guarded on that same precedent. The two are not in
tension — IE-055's reasoning turns on exactly the distinguishing feature, that
`relocateCreature` is guarded because it *raises* area debts — but it is the
second task in this tranche to reason from that precedent, and a third would be
a pattern worth naming in the design document.

### Reported, not acted on

**A creature joining mid-fight cannot use a `moment === 'initiative'` feature**,
because `commands/features.ts:446` gates those on `turnsTaken > 0`. Pre-existing
semantics about the first turn of a fight; the reviewer raised it as a note
rather than a defect, and Surprise and anything about when a fight starts are
out of this brief's scope.

### Outside the brief's surface, each with its reason

`combat.ts` — the pure turn-economy primitive both the reducer and the command
call; putting the insertion anywhere else would be the second path to
`combat.order` the brief forbids. `commands/command.ts` and `turn-context.test.ts`
— requirement 5 and criterion 4. `persistence.test.ts` and `persistence-2.test.ts`
— the event-type list and the uncovered-by-construction ledger, with a reason
that is **true**: neither frozen log could contain a mid-fight join, because no
command existed. `invariants.test.ts` — the idempotency sweep.

**And one correction the task forced**: `refusals.test.ts`'s comment claimed
*"there is no `addCombatant`, so the order… only ever shrinks"*. This task makes
that false, so the comment is corrected **and the sweep widened** to `turnCounts`
and driven over the insertion on both sides of the turn in progress. A stale
comment that had become a false claim, found by the task that falsified it.
