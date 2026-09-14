# IE-043 — The `end-of-current-turn` moment

state: DONE
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `duration.ts`, `spell-definitions.ts` types, `spell-schema.ts`; content-line collision with IE-036 only, the IE-035 ∥ IE-036 precedent
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 6."

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

## Completion digest

```
IE-043 — Completion digest
Builder: COMPLETE
Commit: e2ae380 (replayed onto main as e0639e4)   Branch: worktree-agent-a7c6e1fab8a892436
Opus review: PASS — rounds: 1, confidence high, no defects
Tests: 7850 passing / 7850 (baseline 7812); new tests: 12 hand-written plus parameterised sweeps
Mutations: `turns.ended + 1` → `+ 2` (the off-by-a-round the member exists to prevent) — 5 fail
  across 2 files; `riderDuration`'s new moment → `endOfNextTurn(casterId)` — 2 fail; restoring the
  sweep's whole-literal-union requirement — 3 fail. The reviewer independently ran a fourth:
  adding an `onEntry` clause Stinking Cloud does not print — 4 fail against the parsed book.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — Stinking Cloud transcribed field for field from spells.md:5192-5203 and held
  against that paragraph by the existing trigger-prose guard.
Architectural deviations: none
Foundational primitives touched: the `Duration` union and `resolveDuration`; the `RiderDuration`
  declaration and its reader. Both named by the brief.
New runtime special cases: one defensive branch — `resolveDuration` returns the existing
  `not_in_combat` where a combat holds no turn in progress. Unreachable through any command,
  a value rather than a throw, and adding no code to the refusal sweep's population.
Files outside the brief's surface: `rogue.ts` and `spell-schema.test.ts`, both compelled — see
  the risk gate.
Out-of-scope findings: `riderDurations`, the pre-flight that refuses a turn-anchored rider before
  a slot is spent, walks `definition.effects` only and not `areaTrigger.effects`. Pre-existing and
  currently unreachable, because a `start-of-turn` debt is raised only by `turn-advanced`, which
  requires combat. It becomes reachable the day an area trigger carries an entry clause with a
  turn-anchored rider, since an entry fires outside combat.
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

**Inspected**, because the digest carried three signals: a foundational primitive,
a new runtime special case, and two files outside the brief's surface. I read the
whole runtime diff — `duration.ts`, `spell-schema.ts`, `rogue.ts`, `ranger.ts` —
and the sweep repair.

**The member takes no anchor, and my brief's wording presupposed one.** It said
"one turn-ending away when said on the anchor's own turn"; the builder built
`end-of-current-turn` with no `of` field and argued it in the type's own
docstring: "the current turn" is a moment in the order rather than a fact about a
creature, and Superior Hunter's Defense is a Reaction taken on somebody *else's*
turn, so an `of` naming a creature would be a field no reader could honestly use.
That is right, and both acceptance criteria are satisfied more naturally without
it — criterion 2 asks precisely for the somebody-else's-turn case. **Recorded as a
foreman brief imprecision the builder corrected, not as a deviation**: the
approved architecture was a fifth member resolved by `resolveDuration`,
combat-scoped, with no conversion to seconds, and all three hold.

**The defensive branch is acceptable.** It returns the *existing* `not_in_combat`
rather than a new code, so `refusal-sweep.test.ts`'s population is unchanged; it
is a value rather than a throw, which is this engine's rule; and the reviewer
independently traced that `turnCounts` is kept in step with `order`, so no command
reaches it.

**Both files outside the surface are compelled rather than chosen.** `rogue.ts`
and `ranger.ts` carry notes whose claims are **tested**, and both claimed this
moment was a `Duration` member with no consumer — a sentence this diff makes
false. And the `spell-schema.test.ts` repair was required by the brief's own
acceptance criterion that the zero-user-member sweep must see the new member:
measured first, `RiderDuration` contributed **nothing at all** to that sweep,
because the guard required the whole right-hand side to be string literals and
that union has an object arm. The type the sweep's own docstring names as its
example was the one type it could not see — the `animals.md` failure arriving
inside a guard, which this repository has now recorded several times. The repair
surfaced three members and all three already had writers, which is why the suite
is green rather than newly red.

Classification: **GREEN**.

## Architecture decision

None. No Fable involvement.

## Merge record

Replayed onto `main` as `e0639e4` and pushed. The branch was one commit on
`da144c7`; `main` had moved only in `docs/dev/`, so the replay was content-clean
and equivalent to the rebase the workflow asks for.

`main` verified **after** the merge: typecheck ✓, lint ✓, **7,850 tests across
116 files** ✓, both frozen logs and the scenario determinism explicitly ✓ (53
tests), `COVERAGE.md` regenerated and byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence; **4** no defects to resolve; **5** gauntlet green; **6**
conformance green, Stinking Cloud held against its own paragraph; **7** no
blocker; **8** no deviation — the anchorless member is my brief's imprecision,
recorded above; **9** the primitives are the brief's own; **10** two files
outside the surface, each compelled by a tested claim or by an acceptance
criterion; **11** integration valid, replay clean; **12** re-verified on `main`;
**13** risk gate inspected, GREEN.

**Wave 1's first merge. Nothing was waiting on this task** — wave 2 waits on
IE-038 and IE-044, both still running.
