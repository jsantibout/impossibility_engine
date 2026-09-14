# IE-055 — A creature can join a fight already under way

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 7
parallel-safe: CONDITIONAL — `events.ts`, one fold domain, `commands/initiative.ts`; not beside IE-050 or IE-053
depends-on: IE-050
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: none

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

CLAUDE.md's combat section gains the command. `invariants.test.ts`'s
emitted-type and idempotency sweeps pick the new event and command up.

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
