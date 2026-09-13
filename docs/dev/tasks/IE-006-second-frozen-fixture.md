# IE-006 — A second frozen event-log fixture

state: OWNER_APPROVAL_REQUIRED
lane: conformance
batch: 2
parallel-safe: YES — a new fixture, a new scripted scenario and a `.gitattributes` line; no source file changes
depends-on: none
worker: none
approved: none
merge-approved: none

## Brief

### Objective

Freeze a second event log, produced once by a scripted scenario that
exercises the subsystems the first fixture predates — the five reaction
windows, a declared and interrupted casting, the ongoing record and a moved
origin, area triggers, rests, resource pools, death saves, equipment removal,
roll-modifier and armour-class grants — and hold the fold to it under the
same compatibility test, for ever. The first fixture is never regenerated;
neither is this one.

### Why now

`docs/architecture/whole-engine-audit-2026-09-13.md`, §3.5: `golden-log.json`
holds 93 events of 35 types; 56 of the 91 types have no compatibility
fixture, including every event that carries state a fold reconstructs for
the reaction windows, the interruptible casting and the ongoing record. A
schema change to any of them would pass every test.

### Current relevant architecture

`persistence.test.ts`: the fold-equality test over
`packages/engine/fixtures/golden-log.json`, the `KNOWN_EVENT_TYPES` ledger
(91 entries, asserted both ways), and the "two different seeds fold the same
log identically" assertion. `.gitattributes` marks the fixture
`merge=binary`; `CONTRIBUTING.md` rule 1 forbids regenerating it.

### Required behaviour

1. A scripted scenario (a test-side script, like the one that produced the
   first fixture) that drives, through the public API: a weapon attack with a
   damage-rolled window answered by Uncanny Dodge and settled; a save with a
   test-rolled window; a declared casting interrupted by Counterspell and one
   that settles; an ongoing spell with an origin moved along a route; a
   persistent area catching a creature at a boundary and on entry; a Short
   Rest and an interrupted Long Rest; a pool spent and restored; a creature
   dropped to 0, a death save, a stabilisation; an item unequipped and lost;
   a roll-modifier grant and an armour-class grant released by a dispel.
2. Run it once, freeze the output as `golden-log-2.json`, add the
   `.gitattributes` line and the `CONTRIBUTING.md` sentence.
3. The compatibility test folds it and compares byte for byte; a second
   assertion lists the event types it covers and requires the union of both
   fixtures to cover at least 80 of the 91 types, naming the rest.

### Architecture constraints

- No engine change. If the scenario cannot reach a subsystem through the
  public API, that is a finding for the digest, not a reason to add one.
- The scenario is deterministic from a seed and re-running it must produce
  the frozen file — asserted once at freeze time and then never again.

### Acceptance criteria

1. The fixture exists, folds identically, and the coverage assertion holds.
2. `CONTRIBUTING.md` and `.gitattributes` name it.
3. The whole gauntlet passes.

### Dependencies

None.

### Likely file surface

`packages/engine/fixtures/golden-log-2.json`, `persistence.test.ts` (or a
sibling), a scenario script beside the first, `.gitattributes`,
`CONTRIBUTING.md`, `CLAUDE.md` (one sentence under the event-log section).

### Out of scope

Regenerating the first fixture; per-event field schemas (a later task).

### Known risks

- A scenario that silently skips a subsystem covers nothing; the type-coverage
  assertion is the guard.

## Completion digest

(none yet)

## Architectural gate

(none yet)

## Merge record

(none yet)
