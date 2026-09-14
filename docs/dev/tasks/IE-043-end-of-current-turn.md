# IE-043 — The `end-of-current-turn` moment

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `duration.ts`, `spell-definitions.ts` types, `spell-schema.ts`; content-line collision with IE-036 only, the IE-035 ∥ IE-036 precedent
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: none

## Brief

### Objective

A fifth `Duration` member: the end of the turn **in progress**.

### Why now

Three named consumers want it and none can be written without it —
`SPLIT` nothing, and a member with three writers is not speculative:

- SRD Stinking Cloud — "the Poisoned condition until the end of the current
  turn", on a start-of-turn area trigger; the spell otherwise executes;
- Superior Hunter's Defense — CLAUDE.md records "the end of the **current**
  turn" as one of the three things still missing, and names this exact member:
  `endOfNextTurn` said of the creature whose turn it is resolves **two**
  turn-endings away, a round late;
- Steady Aim's half, for the same reason.

### Current relevant architecture

- `duration.ts:72` — the two types, and the rule that turn-anchored durations
  refuse outside combat and refuse for an anchor not in the fight; `:91` the
  `no_turns` refusal.
- The constructors `startOfNextTurn(who)` / `endOfNextTurn(who)`, and the
  asymmetry they exist to keep callers away from: said on the anchor's own
  turn, "the end of your next turn" is two turn-endings away because the turn
  in progress has not ended yet.
- `RiderDuration` — the rider-side vocabulary; `speed-change` is the one
  member that may carry `lasts` today.

### Required behaviour

1. A fifth `Duration` member resolving to the **turn in progress** ending —
   one turn-ending away when said on the anchor's own turn — with its own
   constructor, so no caller writes a count by hand.
2. It refuses outside combat exactly as its siblings do, under the same code.
   (IE-046 later converts that refusal into a context request at the command
   boundary; this task does **not** change the refusal, and IE-046's brief
   names this member explicitly.)
3. `spell-schema.ts` accepts it wherever a `Duration` or a `RiderDuration` is
   accepted, and refuses it where the siblings are refused.
4. **Stinking Cloud's definition is completed** against its own SRD paragraph:
   the start-of-turn area trigger it already needs plus this rider. If any
   other clause of the spell is not expressible, it stays partial with the
   clause adjudicated to an enumerated shape.
5. The class file's note for Superior Hunter's Defense is corrected: the
   deadline exists; the other two pieces (a fifth `ReactionEffect` member, and
   "that damage" across two types) are what remain.

### Architecture constraints

Settled; a deviation is `ARCHITECTURE_BLOCKED`:

- the member is resolved by `resolveDuration`, the single conversion — no
  second path from a relative duration to a `Deadline`;
- it is combat-scoped like every other turn-anchored duration; no conversion
  to seconds anywhere, under any circumstances.

### Acceptance criteria

1. Said on the anchor's own turn, it expires at **that** turn's end — one
   turn-ending away — and a test asserts it against `endOfNextTurn` said in
   the same moment, which must be a full round later.
2. Said on somebody else's turn, it expires at the turn in progress ending,
   which is that other creature's.
3. Refused outside combat, and refused for an anchor not in the Initiative
   order, with the codes asserted by name.
4. Stinking Cloud drives end to end: a creature starting its turn in the cloud
   is Poisoned, and the condition is gone at that turn's end.
5. `COVERAGE.md` regenerated; `missing-shapes.ts` re-read for any entry whose
   only blocker this was.

### Tests and conformance

The gauntlet. `duration.test.ts` gains the member's own cases.
`spell-schema.test.ts`'s zero-user-member sweep must see a writer for it — the
Stinking Cloud definition is that writer, which is why the definition ships in
the same task rather than after it.

### Dependencies

None. It touches neither `events.ts` nor the command layer, which is why it
runs in wave 1.

### Out of scope

Superior Hunter's Defense as a whole (its other two pieces). Steady Aim's
one-shot Advantage, which needs a modifier consumed by the roll it changes.
Anything about turn-anchored durations **outside** combat — that is IE-046.

### Known risks

Low. The one trap is the off-by-a-round the constructors exist to prevent, and
the acceptance criterion that compares the two constructors in one moment is
what catches it.
