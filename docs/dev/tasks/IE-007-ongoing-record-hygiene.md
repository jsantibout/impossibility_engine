# IE-007 — The ongoing record: pin the area, drop the dead fields, close the four debts

state: CHANGES_REQUIRED
lane: mechanism
tranche: 3
parallel-safe: NO beside IE-001 — both are in `commands/spell-resolution.ts` and the fold; YES beside IE-008 (`creation.ts`) and IE-009 (tests and prose)
depends-on: IE-005, IE-001
worker: qb-builder · C:/Users/justi/Code/QuestBarrel/ImpossibilityEngine/.claude/worktrees/agent-a595388509ad143a3 · worktree-agent-a595388509ad143a3
approved: 2026-09-13 — "APPROVE TRANCHE 3"
merge-approved: none

## Re-brief note (2026-09-13, after tranche 2)

Re-checked against `main` at `ceb11e6`. Every claim below still holds:
`events.ts` still imports `definitionFor` (`:103`) and still calls it through
`areaDefinitionOf` at **five** sites (`:2479`, `:2635`, `:2768`, `:2852`,
`:2936`), so the fold still consults the live catalogue; `route` is still
written by `commands/casting.ts` at `:530`, `:553` and `:596` and still read
by nobody on the record.

**Two things changed that the brief must now carry.**

- **The `resolveCast` `mayAct` guard rides here, not with IE-001.** The
  queue has said since IE-003 that it rides with "the next mechanism task in
  the command layer", and named IE-001. The split settles it differently:
  `resolveCast` is `commands/casting.ts:1051`, which IE-001 does not touch
  and this task does. It is one guard plus the allowlist entry in
  `invariants.test.ts:1249`, whose text already calls itself "**a named debt
  rather than a settled exemption**".
- **There is now a second frozen log**, and it is the one with teeth here:
  `golden-log-2.json` carries five ongoing castings, two origins and eight
  timers. Item 2's event-shape change is exactly what it exists to catch.

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
7. **`resolveCast` is guarded by `mayAct`**, and its entry in
   `UNGUARDED_ON_PURPOSE` (`invariants.test.ts:1249`) is removed rather than
   reworded — the sweep asserts the allowlist in both directions, so a stale
   exemption fails it. The refusal must come **after** the duplicate check,
   which this file records eight prior instances of getting wrong, and
   `once` now makes structurally hard: put the guard inside the callback.

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

IE-005 (`4f829e9`, merged — it lands in the split layout). **Sequential
after IE-001**, which shares `commands/spell-resolution.ts` and the
`SpellEffect` union; this task rebases over it.

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
