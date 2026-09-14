# IE-025 — A feature-definition validator

state: IMPLEMENTING
lane: conformance
tranche: 5
parallel-safe: YES — a new module, its test, and data-only fixes in the twelve class files
depends-on: none
worker: qb-builder · .claude/worktrees/agent-a75dd26295c405827 · worktree-agent-a75dd26295c405827
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

`checkFeatureDefinition` over every class, subclass and species feature the
engine declares — the structural guard that would have caught nine features
claiming to be executed on the strength of a note.

### Why now

Named by the third whole-engine audit and unchanged since; it has waited two
audits without costing anything, and this is the first tranche with room. The
failure it exists to catch is on the record: **nine features declared
`automation: 'engine'` with a note saying "declared as a pool", and none of
them declared a pool.** A Bard had a Hit Die, three slot pools and nowhere to
spend an inspiration from. `class-pools.test.ts` closed that one instance —
"a note that claims a pool must be a feature that declares one" — and the
class of failure is wider than the instance.

A definition format with no validator is the failure this repository keeps
finding elsewhere. `spell-schema.ts` is the precedent and the shape to copy.

### Current relevant architecture

- `packages/engine/src/progression.ts:111` — a feature's `grants?: FeatureGrant`;
  `:139` the `FeatureGrant` union, with `{ kind: 'expertise' }` at :145 and
  `{ kind: 'spells'; fixed?: string[] }` at :157.
- The twelve class files are flat in `packages/engine/src/` —
  `barbarian.ts`, `bard.ts`, `cleric.ts`, `druid.ts`, `fighter.ts`, and the
  rest — each with its subclass and a level 1–20 table.
- 236 `automation:` declarations across the engine's non-test sources.
- `packages/engine/src/spell-schema.ts` — the precedent:
  `checkSpellDefinition` returns **every** problem with a path on each, and
  `parseSpellDefinition` takes `unknown` and is the `Result` half.
- `packages/engine/src/class-pools.test.ts` — the note-claims-a-pool guard and
  the sweep asserting no pool column falls.
- The readers a grant must be one of: `standing.ts`, `creation.ts`,
  `commands/features.ts`.

### Required behaviour

`checkFeatureDefinition` reports every problem, each with a path, for:

1. **Unique, namespaced ids.** Two features may not share one.
2. **A level the class table reaches.** A feature granted at a level the class
   does not have is unreachable.
3. **A `manual` feature carries a non-hollow note.** The rule `CLAUDE.md`
   already states: "an unexplained 'not automated' is not a useful thing to
   read at three in the morning". A note that says nothing is a licence — the
   same floor `spell-honesty.test.ts` applies to an adjudication.
4. **An `engine` feature's grant is one the engine reads.** Derived from the
   readers in `standing.ts`, `creation.ts` and `commands/features.ts` — **not
   from a list**, because a list is the hand-kept claim this repository has
   now had falsified four times. A feature claiming `engine` whose grant
   nothing reads is the nine-features failure, structurally.
5. **`fixed` spell grants exist in the parsed book and are on that class's
   list.**
6. **Pool sizing names a real column** of that class's table, or an ability
   modifier with a floor, or a multiple of the class level — the three shapes
   `poolSizeOf` already implements.
7. **A zero-user sweep over `FeatureGrant` members**, with written exemptions,
   in the shape IE-013 built for the spell format: the members are read out of
   the declarations and the users out of the class files, so a member added to
   the type and not to a list is a case that cannot arise. **Report names,
   never a count.**

### Architecture constraints

- **Data fixes only in the class files.** If a rule catches a real feature,
  correct the *data*, and if correcting it would change what the engine
  executes, stop and report it — that is a finding for the foreman, not a
  fix inside this task.
- Every SRD number a fix relies on is quoted from `classes.md` in the commit,
  as every definition in the catalogue already is. Recall is not evidence.
- An exemption must name the fact that would end it, and must say something.
- No change to `progression.ts`'s types. A member that turns out to have zero
  users is *reported*, not removed: removing it is the union owner's.

### Acceptance criteria

1. Every one of the seven rules is driven by a synthetic feature that fails it
   **and** one that passes, so the rule is exercised in both directions.
2. The whole population validates, or every exception is a data fix with its
   `classes.md` line quoted, or a reported finding.
3. The zero-user sweep names any `FeatureGrant` member no class writes.
4. `npm test`, `npm run typecheck`, `npm run lint` green; `npm run coverage`
   run and committed if any feature's `automation` changed.

### Tests and conformance

A new `feature-schema.test.ts`. `class-pools.test.ts` keeps its own guards —
do not fold them in; two instruments asking different questions is the point.

### Dependencies

None.

### Likely file surface

A new `packages/engine/src/feature-schema.ts` and its test; the twelve class
files for data fixes only.

### Out of scope

Executing any feature that is currently `manual`. Changing `FeatureGrant`.
`spell-schema.ts`, which is IE-024's this wave.

### Known risks

Rule 4 is the one with teeth and the one that can over-fire: derive the
readable grant kinds from the readers rather than from a list, and if the
derivation cannot see a reader, report that as a limit of the instrument in
the test's prose rather than exempting the feature.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
