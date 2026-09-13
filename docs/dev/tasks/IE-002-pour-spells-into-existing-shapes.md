# IE-002 — Pour twelve spells into the shapes that already execute

state: OWNER_APPROVAL_REQUIRED
lane: content
batch: 2
parallel-safe: CONDITIONAL — YES beside one mechanism task provided it uses no kind that task adds; NO beside another content task, which would edit the same registry and list
depends-on: IE-004
worker: none
approved: none
merge-approved: none

## Audit note (2026-09-13)

Presented at Gate 1 before the third whole-engine audit and re-scheduled by it
(`docs/architecture/whole-engine-audit-2026-09-13.md`, §4): the honesty
guard (IE-004) changes what a new executed definition must satisfy — every
`unmodelled` clause that trips a mechanical marker needs an adjudication, and
a debt adjudication makes the spell partial — so twelve definitions poured
before it lands are rework. The task itself is unchanged and follows IE-004,
in batch 2 beside the split.

## Brief

### Objective

Define up to twelve more SRD spells using only the effect kinds that execute
today — `attack`, `save-damage`, `save`, `heal`, `buff`, `temp-hp`,
`roll-mode`, `armor-class`, `dispel` — each transcribed from its SRD paragraph
with the lines quoted, registered in id order, driven by the existing catalogue
and oracle guards, and added to `VERIFIED_SPELLS` where an end-to-end test
exists. Regenerate `COVERAGE.md`.

### Why now

`PROGRESS.md`, "Next actions" item 2: "Keep pouring spells into the five
working shapes… roughly 90 parsed spells fit one of them and need only a
definition with its SRD quote. `spell-catalogue.test.ts` drives every
definition automatically, so the test cost of each new one is zero. This is
the cheapest coverage there is." It is lane A in `CONTRIBUTING.md`, which
"never waits on the mechanism lane" — the point of running it beside a
mechanism task.

### Current relevant architecture

- Definitions and the registry: `packages/engine/src/spell-definitions.ts`,
  everything below the type declarations. The registry test reads the source
  and compares declared spells against registered ones, so a dropped line is
  caught.
- The kinds and their docstrings: the `SpellEffect` union at `:192`. Each
  docstring states the transcription rule for its fields (e.g. `onSuccess` is
  stated, never defaulted; `plus` shares one save; `DiceScaling` carries the
  flat addend and the per-slot notation).
- Guards: `spell-catalogue.test.ts` (every definition cast), `coverage.test.ts`
  (name, level, school, casting time, Concentration against the parsed book),
  the range and duration oracle (`scripts/spell-oracle.ts`),
  `spell-tracking.test.ts` (prose markers demand adjudication — extended to
  executed spells' `unmodelled` clauses by IE-004), `spell-schema.test.ts`
  (validator).
- The measurement: `packages/engine/scripts/coverage.ts`, `VERIFIED_SPELLS`.

### Required behaviour

Selection rule: a parsed spell with no definition whose **entire** mechanical
content is expressed by one existing kind (plus `area`, `targets` or
`targetsWithin`, scaling, and the existing rider fields) with no clause the
honesty guard would call debt. Prefer lower levels and commonly cast spells.
Twelve is a cap, not a target: fewer, with a reason each, is a correct
result.

The honesty guard is on `main` now (`spell-honesty.test.ts`, IE-004,
`0536a2b`). For every executed definition it scans each `unmodelled` clause
for the mechanical markers, demands exactly one adjudication per tripping
clause in `ADJUDICATED` — keyed by a phrase of the clause, `table` with a
reason or a named missing shape — and derives `PARTIAL_SPELLS` from the shape
adjudications, asserting the published list equal to the derived set in both
directions. For this task that means: a new spell's `unmodelled` clauses are
either marker-free or adjudicated `table` with a reason the reviewer reads; a
clause that would need a shape adjudication disqualifies the spell, so
`PARTIAL_SPELLS` does not grow here; and any note that quotes the SRD is held
against that spell's own paragraph.

For each spell: the definition with SRD quotes for every number (dice, save
ability, damage type, scaling, range, duration, target count); the registry
line in id order; and where the spell's numbers are not already pinned by a
catalogue-level assertion, one test that casts it and asserts the number the
SRD prints (the Fire Bolt 2d10 lesson: a fixture-supplied number is the one
nothing checks).

### Architecture constraints

- Content lane only: no change to any type declaration, the command layer,
  `events.ts`, `spell-schema.ts`, `conditions.ts` or any test that is not a
  spell test. A spell that needs a new kind or field is left out and named in
  the report.
- Do not use any effect kind that does not exist on `main` at the moment the
  worktree was created.
- No `unmodelled` claim that is really debt: if a clause is a rule the engine
  should own, the spell does not qualify for this task.

### Acceptance criteria

1. Up to twelve new definitions, each quoting its SRD lines, all registered
   in id order, all parsing through `parseSpellDefinition`.
2. Every one driven by the catalogue test; those with an end-to-end test in
   `VERIFIED_SPELLS`.
3. `COVERAGE.md` regenerated and committed; the executed count rises by the
   number defined.
4. The report lists each spell with the kind used and the SRD line for its
   dice or condition, and lists each candidate rejected with the clause that
   disqualified it.
5. A mutation that changes one new definition's dice fails a test; say which.
6. The whole gauntlet passes; `golden-log.json` untouched.

### Tests and conformance

`spell-catalogue.test.ts` (automatic), `coverage.test.ts` (automatic), the
oracle (automatic), the honesty guard (automatic once IE-004 lands), and one
assertion per spell whose numbers are not otherwise pinned, in the existing
spell test files.

### Dependencies

IE-004.

### Likely file surface

`packages/engine/src/spell-definitions.ts` (definitions and registry only),
`packages/engine/scripts/coverage.ts` (`VERIFIED_SPELLS`),
`spell-honesty.test.ts` (`table` adjudications only), one or two spell
test files, `COVERAGE.md`. Not `CLAUDE.md`, unless a transcription rule worth
recording was learned.

### Out of scope

Any new effect kind or field; any spell needing a shape from the ranked map;
tracked-only spells (that is a different adjudication task); changes to the
oracle or the guards.

### Known risks

- Quietly wrong numbers: every number quoted; one mutation per task proves
  the pinning works.
- Selection creep: a spell that "almost" fits gets a rider it should not; the
  rule is that the whole paragraph fits or the spell is left out.
- Merge with a concurrent mechanism task: both may append registry lines and
  regenerate `COVERAGE.md`; the playbook resolves both mechanically.

## Completion digest

(none yet)

## Architectural gate

(none yet)

## Merge record

(none yet)
