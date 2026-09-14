# IE-012 — Scene commands: let something above the engine start an encounter

state: DONE
lane: mechanism
tranche: 4
parallel-safe: YES — a new command module wrapping pure functions that already exist; touches no spell, no effect kind, no existing command
depends-on: none
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 4" (tranche 4 authority; 13/13 conditions green)

## Brief

### Objective

Give the scene-setup family the commands it has never had, so that a caller
above the engine can set a scene, place a creature, add a landmark, declare
cover and sight, start combat, advance the clock and declare an NPC's
spellcasting — through the same `once`-guarded command path everything else
uses.

### Why now

**Nothing above the engine can start an encounter.** IE-009 derived that 17 of
91 declared event types are emitted by no command, and its reviewer reproduced
the derivation independently. Eight of those seventeen are one family:
`scene-set`, `landmark-added`, `creature-placed`, `sight-declared`,
`cover-declared`, `combat-started`, `time-advanced`, `spellcasting-declared`.

`placeCreature` (`positioning.ts:479`), `addLandmark` (`:98`), `declareCover`
(`:908`), `declareSight` (`:1303`) and `startCombat` (`combat.ts:220`) exist,
are correct, and return `Result<State>` — they are called **only by the
reducer**, to fold an event nobody writes. `scene-set`, `time-advanced` and
`spellcasting-declared` have no producer outside tests at all.

The foreman deferred this as M2's tool-surface work, wanting that surface's
shape first. **The fourth whole-engine audit disagreed with that boundary and
the foreman accepts the correction**: a tool surface calls commands and never
folds events itself, so these are engine commands whatever M2 turns out to
look like. They go through `once` like every other command, and the anti-cheat
parity test cannot assert anything about starting a fight until they exist.

This is the twelfth and largest recorded instance of the repository's most
persistent finding — a rule implemented and reachable from nothing. It is
GREEN because the shape is entirely settled: validate, emit, fold through the
pure function that is already there.

### Current relevant architecture

- The five pure functions above, each `(state, …) => Result<State>`, each
  already exercising the validation a command would need — read each one's
  refusals and reuse them rather than inventing a second set.
- `once` (`idempotency.ts:130`) — every command goes through it, and the guard
  must sit **inside** the callback. This file records nine prior instances of
  getting that wrong; IE-007 was the first caught by a test written before it
  could happen.
- The derived sweeps in `invariants.test.ts`: the action-economy closure and
  the return-type/idempotency classifier both read a module list. A new module
  under `commands/` **must be added to both**, or every command in it is
  invisible to the sweeps — the exact silent failure IE-005's brief warned
  about.
- `commands.ts` is an enumerating barrel, not a star re-export: a new command
  is published by naming it there.

### Required behaviour

1. A new `packages/engine/src/commands/scene.ts` with one command per event in
   the family, each taking a `CommandIdentity`, each going through `once`, each
   emitting the event the reducer already knows how to fold.
2. **The validation is the pure function's**, not a second copy. Where
   `placeCreature` already refuses a creature that has a position, the command
   surfaces that refusal; it does not re-derive it.
3. `mayAct` is **not** applied. None of these is an action in the turn economy
   — they are facts a DM declares — and the action-economy sweep's allowlist
   gains them with that sentence as the reason, in the shape the existing ten
   entries use.
4. Both `invariants.test.ts` sweeps enumerate the new module, and the samples
   that prove each sweep would still catch an unguarded addition must still
   bite.
5. A retry of any of them under one command id is a no-op emitting nothing.

### Architecture constraints

- No change to `events.ts`, the reducer, or any of the five pure functions'
  behaviour. This task adds a command layer over them and nothing else.
- No new event type. All eight already exist and are already folded.
- Both frozen logs must fold unchanged — they hand-write these events today,
  and that must keep working, because a log is a log however it was written.
- Where a fact is durable and re-declaring it differently would contradict the
  log (a creature's position, a scene), the existing function's refusal is the
  rule; do not invent a new one.

### Acceptance criteria

1. Each command has a test that emits its event and folds it, and a retry test
   under one id that emits nothing.
2. A scenario test drives an encounter **from nothing** through commands
   only — scene, landmarks, creatures placed, cover and sight declared, combat
   started — with no hand-written event anywhere in it. That test is the point
   of the task: it is the thing that is impossible today.
3. Both `invariants.test.ts` sweeps see the new module, proven by their own
   count assertions, and both allowlists come out with the eight additions and
   their stated reason.
4. Both frozen logs fold unchanged.
5. The whole gauntlet passes; `COVERAGE.md` regenerated.

### Tests and conformance

A new `scene-commands.test.ts`; `invariants.test.ts` for the two sweeps; the
persistence suites unchanged and passing.

### Dependencies

None.

### Likely file surface

`packages/engine/src/commands/scene.ts` (new), `commands.ts` (the barrel),
`invariants.test.ts`, a new test file, `CLAUDE.md` (the event-log section
records that seventeen types had no command; it must now record eight fewer,
and say which remain and why).

### Out of scope

The nine remaining unemitted types — `creature-side-declared`, `mounted`,
`dismounted`, `free-interaction-used`, `initiative-swapped`, `stabilised`,
`creature-died`, `items-lost`, `bonus-removed`. They are a second family with
their own evidence; name them in the digest as still unreachable.
The tool surface itself, which is M2.

### Known risks

- Eight commands is eight chances to put a guard above the duplicate check.
  `once` makes it structurally hard; the sweep proves it.
- A command that merely wraps a pure function can drift from it. The brief's
  answer is that the refusals must be the function's own, surfaced rather than
  restated.


## Merge record

Merged to `main` as `6d3cb92`, fast-forward, pushed. Worktree retired.

**A tool surface can now start an encounter.** The scenario that proves it
builds three characters, a declared spellcasting, an hour on the clock, a
taproom, two landmarks, three placements — one anchored on another creature —
two sight declarations, a cover declaration, three rolled Initiatives and a
started fight, **every event produced by an exported command**. The test reads
that claim off its own source and the confirming reviewer re-executed the scan
independently rather than trusting it.

**Two deviations, both ratified by the foreman, and both were foreman errors.**

1. The brief's architecture constraint said "No change to `events.ts`" while
   its requirement 5 demanded that a retry emit nothing — which needs a
   `CommandStamp`, which must be **declared** on the member or it is invisible
   to every reader of the type. `CLAUDE.md` records that trap twice, and the
   builder's mutation proved it: deleting the declaration left
   `npm run typecheck` completely silent. Eight optional declarations, no new
   event type, no reducer change. Verified as declarations-only by the foreman
   and again by the confirming reviewer.
2. The brief's requirement 3 said to put the eight on the action-economy
   allowlist; `invariants.test.ts` asserts every name on that list **is** a
   derived spender, and these spend nothing, so the instruction was
   unexecutable and the decision would have lived nowhere.
   `DECLARED_NOT_ACTED` is the same shape — derived from the module, one
   written sentence each, asserted both ways — and is checked **behaviourally**
   by running all eight against the very world the spender sweep refuses every
   spender in.

**The confidence rating was earned, not asked for.** The task's own reviewer
returned `PASS` with no defects and no escalation at **medium**, explaining
that the two deviations were ratification questions for the foreman. Rather
than send the owner two decisions that were the foreman's, both were ruled and
a bounded reviewer was asked to rate the work with the questions closed —
**told explicitly that medium remained a legitimate answer and would send the
task to the owner.** It verified both rulings against the code, re-derived
`CLAUDE.md`'s 91/82/9, read the *reducer* to confirm a command cannot emit an
event the fold throws on, and returned `PASS` at **high**.

The thirteen conditions: 1 inside the brief (six files, all on its surface,
plus `events.ts` by ratified deviation) · 2 COMPLETE · 3 **PASS at high**, at
the confidence pass · 4 no defects · 5 gauntlet in the worktree ✓ · 6
`COVERAGE.md` byte-clean, no definition touched · 7 no blocker · 8 two
deviations, both ratified above · 9 the `GameEvent` union gained eight
optional declarations and nothing else; the reducer, the five pure functions
and persistence are untouched · 10 no scope expansion · 11 no conflict ·
12 gauntlet re-run on `main`: typecheck ✓ lint ✓ **5697/5697** ✓ coverage
byte-clean ✓, both fixtures untouched · 13 risk gate GREEN.

**Wave 2 opened on this merge.** IE-016 launched immediately, with IE-012's
pattern and the two rulings carried into its brief — including the finding
that `DECLARED_NOT_ACTED` and the stamp test are scoped to `commands/scene.ts`
by a hard-coded path, so the next family's module must be added to both or it
is invisible to the sweeps that exist to prevent exactly that.
