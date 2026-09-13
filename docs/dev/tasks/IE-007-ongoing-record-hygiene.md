# IE-007 — The ongoing record: pin the area, drop the dead fields, close the four debts

state: PROPOSED
lane: mechanism
tranche: none
parallel-safe: NO beside IE-001 or any task in spell resolution or `spells.ts`; YES beside conformance and content
depends-on: IE-005
worker: none
approved: none
merge-approved: none

## Brief

### Objective

Make the fold independent of the spell catalogue by pinning a casting's
`area` and `areaTrigger` on `OngoingSpell` at the cast, exactly as its
numbers already are; derive or drop the record's two dead fields; and close
the four documented ongoing-record debts.

### Why now

`docs/architecture/whole-engine-audit-2026-09-13.md`, §3.2: `events.ts`
calls `definitionFor` at five sites to learn an area and its clauses, so a
replay consults the current catalogue and a transcription fix rewrites
history — the hazard the event-log section of `CLAUDE.md` names. §3.6 and
§3.10: `OngoingSpell.concentration` and `.route` have no reader; `on` does
not shrink on expiry; "until dispelled" spells leave no record; a
`spell-ongoing` for an ended casting is accepted.

### Required behaviour

1. `OngoingSpell` carries `area` and `areaTrigger` (as cast); the reducer's
   `areaDefinitionOf` reads the record; `events.ts` no longer imports
   `definitionFor`. A test folds a log with a definition deliberately changed
   after the cast and asserts the fold is unchanged.
2. `concentration` derived (whoever holds the casting) and removed from the
   record; `route` removed; the event shape versioned so the frozen fixtures
   still fold (absent means what it always meant).
3. `expireEffects` shrinks `on` when an independently timed condition of a
   casting lapses on a creature (through `withoutTarget`).
4. `persists()` records "until dispelled" spells (no duration, no
   Concentration) as ongoing without a timer, so Dispel Magic reaches them;
   Arcane Lock and Continual Flame are the proving spells.
5. The reducer refuses (corrupt log) a `spell-ongoing` for a casting that
   has ended — which needs the fold to remember ended castings, or the id
   check to consult the log; the builder proposes the smaller of the two.
6. `PendingMove.feet` and `OwedAreaEffect.turn` dropped, or given a reader
   with a reason.

### Architecture constraints

- Pinned at the cast, read live for the target — the rule the pinned numbers
  set.
- No new second identity for a casting's area; it is a field on the record.
- Both frozen fixtures fold unchanged.

### Acceptance criteria

1. `events.ts` has no value import of the spell catalogue; the fold of a
   fixture is unchanged when a definition is edited under it.
2. Each of items 3, 4 and 5 has a failing test first.
3. The whole gauntlet passes; both fixtures fold.

### Dependencies

IE-005 (lands in the split layout); sequential with IE-001.

### Likely file surface

`spells.ts`, `events.ts`, the spell-resolution module, `spell-definitions.ts`
(the two definitions' notes), `ongoing-spells.test.ts`, `persistence.test.ts`,
`CLAUDE.md` ("A Casting Is History; What It Left Behind Is State").

### Out of scope

The equipment catalogue read in the fold (named, lower risk); the `cause`
link on events; multiple scenes.

### Known risks

- Event-shape compatibility: the frozen fixtures decide it.

## Completion digest

(none yet)

## Architectural gate

(none yet)

## Merge record

(none yet)
