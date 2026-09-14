# IE-045 — Delete the shape classifier; derive `PARTIAL_SPELLS`

state: DONE
lane: tooling
tranche: 6
parallel-safe: CONDITIONAL — `scripts/coverage-data.ts`, `scripts/coverage.ts`, `spell-honesty.test.ts`; after IE-044, same script files
depends-on: IE-044
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 6."

## Brief

### Objective

Delete the regex shape classifier and its hand-written blocker column from the
coverage report, and derive `PARTIAL_SPELLS` from the adjudication map.

### Why now

**The report contradicts itself in one file.** `coverage-data.ts:71` `SHAPES`
is thirteen prose regexes filing every parsed spell under "the hardest thing
its text needs", and `coverage.ts` prints it with a hand-written "Blocked on"
column. It files 43 spells under a casting time of a minute or more and says
they are blocked on "a casting-in-progress state machine with a per-turn
obligation"; the derived table two sections down says 54 touched, 12 finished,
and IE-034 built the out-of-combat half. That is the three-documents-three-
answers failure this repository wrote `missing-shapes.ts` to end, arriving
inside one report — and tranche 6 is briefed from that report.

`PARTIAL_SPELLS` was kept by hand only because the adjudication map lived in a
test file. IE-015 moved the map to `scripts/missing-shapes.ts`, so the reason
is gone.

### Current relevant architecture

- `scripts/coverage-data.ts:71` `SHAPES`, `shapeOf`, `:381` the `byShape`
  bucket; `:202` `PARTIAL_SPELLS`; `:342` the `byShape` field on the report
  type.
- `scripts/coverage.ts:187`, `:245` — the two places the table is printed.
- `spell-honesty.test.ts` — asserts `PARTIAL_SPELLS` against the derived set in
  **both** directions. One of those directions becomes a tautology.
- `coverage.test.ts` — asserts nothing about `byShape`; the classifier is
  report-only, which is what makes this a deletion rather than a migration.

### Required behaviour

1. Delete `SHAPES`, `shapeOf`, `byShape` and the "By mechanical shape" table
   with its hand-written blocker column. The derived "What blocks the rest"
   table is the one that stays.
2. Derive `PARTIAL_SPELLS` from `ADJUDICATED`: the spells with any entry whose
   `why` is not `'table'`. Delete the both-directions assertion in
   `spell-honesty.test.ts` that becomes a tautology, and keep the one that
   still says something.
3. `VERIFIED_SPELLS` **stays a hand list.** It is a claim about which tests
   drive which spell, and nothing derivable says that. Say so in a comment
   where the next reader will look for symmetry.

### Architecture constraints

Deletion before derivation before consolidation. Nothing here adds an
abstraction, and nothing here changes what the engine does.

### Acceptance criteria

1. The five top-line counts and the derived blocker table are **unchanged** —
   diffed against `COVERAGE.md` as it stands before the change.
2. `PARTIAL_SPELLS` derived equals the current hand list exactly; if it does
   not, the difference is a finding for the digest, not a list to adjust.
3. `COVERAGE.md` regenerated, and the gauntlet's `git diff --exit-code` is
   clean.
4. `npm run coverage` still writes only when run as an entry point — IE-021's
   guard and its sweep are untouched and still pass.

### Tests and conformance

The gauntlet. `coverage-script.test.ts` must stay green, including its floor
naming the scripts that write.

### Dependencies

IE-044 — both edit `scripts/coverage.ts`, and IE-044 adds the second
`finishes` column this must not fight.

### Out of scope

Any change to the derived table's content or to `missing-shapes.ts`.

### Known risks

None identified. The classifier has no test asserting its output, which is
both why it drifted and why deleting it is safe.

## Completion digest

```
IE-045 — Completion digest
Builder: COMPLETE
Commit: 5eac8a1 (replayed onto main as 606c142)   Branch: worktree-agent-a9c4b2425e6ed09f1
Opus review: PASS — rounds: 2 (round 1 PASS with one non-blocking note, round 2 confirming
  on the final sha), confidence high, no defects
Tests: 7908 / 7908; new tests: 0 — one deleted (the both-directions equality the brief names
  as a tautology) and one existing assertion strengthened with the complement-non-empty guard
  it lacked.
Mutations: inverting the derivation's filter to `why === 'table'` fails two tests
  (spirit-guardians absent, the four all-table spells arriving); emptying the filter fails
  three including the non-vacuity guard.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — the five top-line counts (339 | 45 | 97 | 48 | 75) and every row of the
  derived blocker table are byte-identical across the change.
Architectural deviations: none
Foundational primitives touched: none — no engine source changed; the only file under
  packages/engine/src is a test.
New runtime special cases: none
Files outside the brief's surface: CLAUDE.md, which the change falsifies in three places —
  the both-directions assertion, "the two hand lists" in the coverage-split paragraph, and a
  "fifty-two companions" count that was already wrong by five.
Out-of-scope findings: spell-honesty.test.ts's docstring says `isExecuted` "lives in
  coverage.ts"; it has lived in coverage-data.ts since the IE-021 split. Pre-existing, one
  word, not touched under this brief.
Unresolved concerns: one stated limit rather than a defect — a `.some` → `.every` mutation of
  the derivation changes the published list and is caught by the gauntlet's
  `git diff --exit-code COVERAGE.md` rather than by a unit test, because Spirit Guardians
  carries no `table` clause.
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

**Light, and earned.** No engine source is in the diff — two scripts, one test
file and `CLAUDE.md`. No fold, no command, no determinism surface, neither frozen
log. The one behaviour change outside the report is a console breakdown
`npm run coverage` no longer prints, which the brief requires.

**The oracle for a deletion is byte-identity of the regenerated report**, and it
holds: I regenerated `COVERAGE.md` on `main` after the replay and the five
top-line counts read `339 | 45 | 97 | 48 | 75`, exactly as the digest claims, with
the derived blocker table unmoved.

**The derived list equals the hand list it replaced, entry for entry** — 48 and
48, names byte-identical in the report — which is the outcome the brief asked for
and the one that needed checking rather than assuming. Had it differed, the brief
said the difference was a finding rather than a list to adjust into agreement.

**The stated limit is accepted rather than waved through.** A `.some` → `.every`
mutation is caught by the gauntlet's `COVERAGE.md` diff rather than by a unit
test, because Spirit Guardians carries no `table` clause. That is exactly the
guard this repository already relies on for every other number in that report,
and IE-021 is what made it mean anything — so the reliance is sound rather than
lucky. Worth knowing, which is why it is written here.

Classification: **GREEN**.

## Architecture decision

None. No Fable involvement.

## Merge record

Replayed onto `main` as `606c142` and pushed; a clean replay, no conflict, since
`main` had moved only in `docs/dev/` and `PROGRESS.md` since this branch was cut.

`main` verified **after** the merge: typecheck ✓, lint ✓, **7,908 tests across
117 files** ✓, `COVERAGE.md` regenerated and byte-clean ✓, tree clean.

The count fell by one — 7,909 → 7,908 — and that is the tautology this task was
sent to delete, not a lost assertion. Three survivors remain and one of them is
stronger than it was.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence; **4** no defects outstanding; **5** gauntlet green; **6**
conformance green, with the report's counts byte-identical; **7** no blocker;
**8** no deviation; **9** no foundational primitive touched; **10** one file
outside the surface, `CLAUDE.md`, which this change falsifies in three places and
which a builder is required to correct; **11** integration valid, clean replay;
**12** re-verified on `main`; **13** risk gate light, GREEN.

**Nothing was waiting on this task.** Wave 3 — IE-041, IE-040, IE-047 — all wait
on IE-039, still running.
