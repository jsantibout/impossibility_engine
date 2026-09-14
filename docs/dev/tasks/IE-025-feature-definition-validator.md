# IE-025 — A feature-definition validator

state: DONE
lane: conformance
tranche: 5
parallel-safe: YES — a new module, its test, and data-only fixes in the twelve class files
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

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

Builder: **COMPLETE**. Reviewer: **PASS**, two rounds, confidence **high**.
Branch `worktree-agent-a75dd26295c405827`, commit `0e016ca`, rebased by the
foreman to `43fe3d0`.

Tests **6742 → 6758 on `main`**, 43 new in one new file
(`feature-schema.test.ts`, 726 lines). Gauntlet green; `COVERAGE.md`
regenerated byte-identical and **no feature's `automation` changed**, which is
the point — the validator found no feature claiming an automation it does not
have.

Six mutations, each failing only the case that pins it: disabling rule 4's
readable-grant branch; dropping `stripComments` from the kind probe; never
reporting `engine_declares_nothing`; loosening the union-arm split (which made
rule 7 fire on real data with a phantom `pact-slots`); disabling the pool
column-length check; and skipping the grant shape check, which reproduced the
reviewer's exact `TypeError`.

Foundational primitives touched: **none.** `progression.ts` unchanged; no
event, reducer, command, roll, condition, duration or state code touched.

Files outside the brief's surface: `packages/engine/src/index.ts` (+5),
exporting the validator beside `spell-schema.js` with the same justification —
a validator reachable only from its own test is a rule nothing enforces, the
failure this repository records fourteen times. `CLAUDE.md` (+107).

**One declared architectural deviation — and it is the brief that was wrong.**
Rule 5 as briefed said a `fixed` spell grant must "exist in the parsed book and
be on that class's list". Four of the engine's fifteen fixed grants are
correctly off-list, so enforcing it literally would have meant deleting correct
SRD content. The builder narrowed the rule to existence in the book and
asserted the counterexamples in the test. See the risk gate.

**Out-of-scope findings, none acted on, all three recorded in `QUEUE.md`:**

1. **A live wrong number in shipped code.** `classLevelFor`
   (`creation.ts:2342`) derives a class from `featureId.split(':')[0]`, which a
   *subclass* id never matches, so it falls back to the starting class's level.
   A Fighter 5 / Bard 3 of the College of Lore is handed a **1d8** Cutting
   Words die where SRD gives a Bard 3 a **d6**, reproduced through
   `planCharacter`. Its docstring at `:2334` is wrong the same way. No pool is
   wrong *yet*, because the two subclass features that size one both use an
   ability modifier.
2. `grantsSubclass` has twelve writers and no reader; removal belongs to
   `progression.ts`'s owner, and the sweep reports it in both directions
   meanwhile.
3. `FeatureGrant` wants a member for "a later feature steps an earlier
   feature's table" — that is what would end the two "Improved X" exemptions.

Unresolved concerns: none.

## Risk gate

**Inspected** — one risk signal: an architectural deviation declared in the
digest. Nothing else; the digest reports no foundational primitive, no new
special case, and a purely additive diff.

**The deviation is the brief's error, not the builder's, and the SRD settles
it.** `packages/srd/raw/classes.md` prints Fiend Spells at Warlock level 3 as
"Burning Hands, Command, Scorching Ray, Suggestion", and the parsed book gives
the class lists as Burning Hands → sorcerer, wizard; Scorching Ray → sorcerer,
wizard; Command → bard, cleric, paladin. **None of the three is on the Warlock
list** — which is the entire point of a subclass's always-prepared table. I
verified both halves directly rather than taking the digest's word: the SRD
line, and the three class lists out of `spells.json`.

So rule 5 as I briefed it asserted a rules fact that is false, and the builder
implemented the required behaviour rather than the mistaken example and pinned
the counterexamples in the test. **That is IE-011's precedent exactly** — the
brief's Paladin 4 / Fighter 1 example was wrong about the Hit Die, the builder
caught it against `classes.md`, and the merge stayed clean. The brief's own
constraint told it to stop and report rather than delete correct SRD content,
and it reported.

Classification: **GREEN**, and the error is mine. `WORKFLOW.md` already says a
brief may not assert a rules fact without quoting the SRD line it came from;
rule 5 quoted none, and this is the second time that rule has earned its keep.

The `index.ts` export was inspected too: five lines, beside `spell-schema.js`,
with the reason in a comment. Inside stated latitude.

## Architecture decision

None. No Fable involvement; GREEN throughout.

## Merge record

Merged to `main` as `43fe3d0`, fast-forward, pushed. Rebased by the foreman
over `687331c` and `d62ce30` before the merge; `CLAUDE.md` was touched by both
IE-020 and this task and the rebase was clean, the two additions being in
different sections.

`main` verified after the merge: `npm run typecheck` ✓, `npm run lint` ✓,
`npm test` **6758 passing across 105 files** ✓, `npm run coverage` with
`git diff --exit-code COVERAGE.md` ✓ byte-clean, working tree clean.

The thirteen conditions: **1** inside the brief, with the one narrowing
verified above as the brief's own error; **2** builder `COMPLETE`; **3**
reviewer `PASS` at high confidence; **4** no defects outstanding; **5**
gauntlet green in the worktree; **6** conformance — `COVERAGE.md` byte-clean,
no `automation` moved; **7** no blocker; **8** no *material* deviation — the
declared one is the brief being wrong about the SRD and the builder being right
about it, with the counterexamples pinned; **9** no foundational primitive
touched at all; **10** two files outside the named surface, both declared with
reasons the brief anticipated; **11** the rebase was clean; **12** the base
moved by two commits and the full gauntlet was re-run on `main` after the
merge; **13** risk gate inspected, GREEN.
