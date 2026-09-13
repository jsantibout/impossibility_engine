# IE-004 — The honesty guard for executed spells

state: IMPLEMENTING
lane: conformance
batch: 1
parallel-safe: YES — beside IE-003 (no shared source files; `CLAUDE.md` prose and `COVERAGE.md` merge mechanically); CONDITIONAL beside a content task, which edits the same definition region
depends-on: none
worker: qb-builder · .claude/worktrees/agent-a4ac40741e133e8a8 · worktree-agent-a4ac40741e133e8a8
approved: 2026-09-13 — "APPROVE BATCH"
merge-approved: none

## Brief

### Objective

Extend the honesty guard from the 46 tracked spells to the 82 executed ones:
every `unmodelled` clause on an executed definition that names a mechanic the
engine owns must carry a written adjudication — `table`, with the reason, or
the id of the missing shape — and "partial" becomes a consequence of carrying
a debt adjudication rather than a hand-kept list. Fix the two stale notes the
audit found.

### Why now

`docs/architecture/whole-engine-audit-2026-09-13.md`, §3.5: 58 of the 82
executed spells carry `unmodelled` clauses and no guard reads them, so a rule
the engine should own can be filed as fiction with nobody noticing — the exact
failure the tracked guard was built to stop. It also decides what IE-001's
Invisibility and every future partial spell must say, and it changes what a
new definition (IE-002) has to satisfy, so it lands first.

### Current relevant architecture

- `spell-tracking.test.ts:316` `MECHANICAL_MARKERS`: thirteen regexes over
  SRD prose; `:384` `ADJUDICATED`: the per-spell, per-marker map of
  `{ table | shape }` with a note; `:489` `markersIn`; the population scanned
  is `TRACKED` (`:79–83`: `effects.length === 0`, no activation, no area
  trigger) and the text scanned is the spell's whole SRD paragraph.
- `coverage.test.ts:96` (a tracked spell has `unmodelled`), `:105` (some
  executed spell has none), `:126–135` (`PARTIAL_SPELLS` entries have
  `unmodelled` and may also be verified).
- `packages/engine/scripts/coverage.ts:162` `PARTIAL_SPELLS = ['spirit-guardians']`.
- `spell-catalogue.test.ts:353–364` asserts each executed spell's `unmodelled`
  reaches `unverified` at runtime.
- `CLAUDE.md`, "Tracked Is A Claim About The Cost, Not A Half-Finished
  Execution", is the rule this extends: `unmodelled` means fiction the engine
  should never decide, never debt.

### Required behaviour

1. For every executed definition (effects, activation or area trigger), for
   every `unmodelled` clause, scan **the clause's own text** for the
   mechanical markers (the SRD paragraph is the wrong text for an executed
   spell: its effects are executed; only the clauses are claims).
2. A clause that trips a marker needs an adjudication in the map keyed by
   spell and clause index (or clause text): `table` with a reason, or a named
   missing shape from the enumerated set the tracked guard already uses. A
   clause that trips nothing needs none.
3. Derive the partial set: a spell is partial if any of its clauses is
   adjudicated to a shape. Assert `PARTIAL_SPELLS` equals the derived set in
   both directions, so the hand list cannot drift; or replace the hand list
   with the derived one if the script can import the map cleanly (the
   builder decides, and says which).
4. Write the adjudications. Expect roughly 58 spells and 90 clauses; many
   are `table`. Ones the audit already read as debt: Chill Touch's healing
   ban, the "Advantage if you or your allies are fighting the target" clause
   on Charm Person, Charm Monster and the three Dominates, Harm's Hit Point
   maximum reduction, Guiding Bolt's next-attack Advantage, Black Tentacles',
   Grease's and Insect Plague's Difficult Terrain, Blur's Blindsight and
   Truesight exception. Each names its shape; the spell becomes partial.
5. Reword `unmodelled` prose only where a clause is wrong or stale: Arcane
   Lock and Continual Flame say Dispel Magic is not executable.
6. `COVERAGE.md` regenerated; the "Executed" counts may split into executed
   and partial as the script already supports.
7. `CLAUDE.md`'s "Tracked Is A Claim…" section gains a short paragraph: the
   guard now reads executed spells' clauses too, and partial is derived.

### Architecture constraints

- No engine code changes: no new shape, no effect edited, no test that
  exercises casting beyond what exists. This task writes adjudications and a
  guard.
- The enumerated set of missing-shape ids is extended only if a clause needs
  a shape no id names; each new id must be one the audit or `PROGRESS.md`
  already describes.
- An adjudication of `table` must say why the engine should never decide it;
  "not modelled" is not a reason.

### Acceptance criteria

1. The extended guard fails when an executed spell gains an `unmodelled`
   clause tripping a marker with no adjudication (mutation: add such a clause
   to one definition temporarily).
2. The guard fails when the hand list and the derived partial set disagree
   (mutation: remove Spirit Guardians from `PARTIAL_SPELLS`).
3. Every current clause is adjudicated; the report lists the count of
   `table` versus shape adjudications and every spell that became partial.
4. `COVERAGE.md` regenerated; the whole gauntlet passes.

### Tests and conformance

`spell-tracking.test.ts` (or a new `spell-honesty.test.ts` beside it, if the
file grows past reason — say which), `coverage.test.ts`, the coverage script.

### Dependencies

None.

### Likely file surface

`packages/engine/src/spell-tracking.test.ts`, `coverage.test.ts`,
`packages/engine/scripts/coverage.ts`, `spell-definitions.ts` (`unmodelled`
prose only), `COVERAGE.md`, `CLAUDE.md`.

### Out of scope

Building any missing shape; changing how tracked spells are scanned; touching
effects; the executed spells' SRD-paragraph markers (that is the tracked
guard's method, not this one).

### Known risks

- Adjudication is judgment: a clause filed `table` that is really debt is
  exactly the failure this prevents, so the reviewer reads every `table`
  reason.
- Volume: ninety clauses is a long afternoon; the cap is honesty, not speed.

## Completion digest

(none yet)

## Architectural gate

(none yet)

## Merge record

(none yet)
