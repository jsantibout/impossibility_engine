# IE-012 — Scene commands: let something above the engine start an encounter

state: AWAITING_FOREMAN_REVIEW
lane: mechanism
tranche: 4
parallel-safe: YES — a new command module wrapping pure functions that already exist; touches no spell, no effect kind, no existing command
depends-on: none
worker: qb-builder · C:/Users/justi/Code/QuestBarrel/ImpossibilityEngine/.claude/worktrees/agent-aab26f5019e2fbd13 · worktree-agent-aab26f5019e2fbd13
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: none

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
