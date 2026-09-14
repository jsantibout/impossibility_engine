# IE-045 — Delete the shape classifier; derive `PARTIAL_SPELLS`

state: IMPLEMENTING
lane: tooling
tranche: 6
parallel-safe: CONDITIONAL — `scripts/coverage-data.ts`, `scripts/coverage.ts`, `spell-honesty.test.ts`; after IE-044, same script files
depends-on: IE-044
worker: qb-builder in .claude/worktrees/agent-a9c4b2425e6ed09f1, branch worktree-agent-a9c4b2425e6ed09f1
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: none

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
