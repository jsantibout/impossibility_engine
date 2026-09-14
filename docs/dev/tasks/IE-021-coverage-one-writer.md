# IE-021 — `COVERAGE.md` has one writer, so the gauntlet's diff means something

state: DONE
lane: tooling
tranche: 5
parallel-safe: YES — `scripts/coverage.ts` and two test imports; no engine module
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

## Brief

### Objective

Make `npm test` stop rewriting `COVERAGE.md`, so that the gauntlet's
`git diff --exit-code COVERAGE.md` asserts the committed file is **right**
rather than that the suite just ran.

### Why now

**The instrument is measurably broken, and it was proved by experiment rather
than by reading.** `packages/engine/scripts/coverage.ts:626` calls
`writeFileSync('COVERAGE.md', render(coverage), 'utf8')` at module top level;
`packages/engine/src/coverage.test.ts:6` and
`packages/engine/src/spell-honesty.test.ts:4` both import that module for its
data. So running the suite regenerates the file that the gauntlet then diffs.
The delta audit confirmed it by appending a line to the tracked file, running
one test file alone, and reading an empty diff.

Every merge record in tranches 1-4 that says "COVERAGE.md byte-clean" is true
for the wrong reason. Nothing downstream is wrong today — but the check that
would have caught it if something were is not running.

### Current relevant architecture

- `packages/engine/scripts/coverage.ts` — 644 lines. The data
  (`PARTIAL_SPELLS`, `VERIFIED_SPELLS`, `isExecuted`, `EXECUTED_SPELL_IDS`, the
  audit functions) and the renderer live in one module, and line 626 writes at
  import time.
- `package.json`: the `coverage` script runs it with tsx, and is the intended
  entry point.
- The two importers are named above; neither wants the write.
- The repository's precedent for a sweep that reads its own source and is
  driven by a mutation is `packages/engine/src/invariants.test.ts`.

### Required behaviour

1. Move the data and the pure functions into a **side-effect-free** module —
   `packages/engine/scripts/coverage-data.ts` — which the tests import.
2. `coverage.ts` keeps the renderer and the write, and the write happens
   **only** under a main-module guard, the ordinary Node idiom comparing
   `import.meta.url` with the invoked path. The coverage script behaves exactly
   as before.
3. A source sweep asserts that no `writeFileSync` in `packages/engine/scripts/`
   sits outside that guard, **driven by a synthetic source it must catch** —
   the standing rule for every sweep here, so the analysis cannot quietly stop
   seeing anything.
4. The bytes of `COVERAGE.md` do not change. If they do, the move changed a
   number and that is a defect, not a result.

### Architecture constraints

- Do not change what the report says or how it is computed. This is a move.
- The gauntlet is unchanged: the point is that its existing check regains its
  meaning, not that a new check replaces it.
- `scripts/missing-shapes.ts` is IE-022's file this wave — do not restructure
  it. Importing from it is fine.

### Acceptance criteria

1. On a tree where `COVERAGE.md` has been deliberately corrupted, a full
   `npm test` no longer repairs it, so the corruption is visible to
   `git diff --exit-code`. Demonstrate this in the digest, then restore the
   file.
2. The coverage script still regenerates the file byte-identically.
3. The sweep fails against a synthetic unguarded write.
4. `npm test`, `npm run typecheck`, `npm run lint` green.

### Tests and conformance

The sweep belongs beside the repository's other derived sweeps. Assert the
byte-identity of the rendered output before and after the move as part of the
work, not only in the digest.

### Dependencies

None.

### Likely file surface

`packages/engine/scripts/coverage.ts`, a new
`packages/engine/scripts/coverage-data.ts`,
`packages/engine/src/coverage.test.ts`,
`packages/engine/src/spell-honesty.test.ts`, one sweep test.

### Out of scope

Any change to the coverage numbers, the report's prose, or the missing-shape
vocabulary. Any change to the gauntlet's command list.

### Known risks

Two test files import the module; a third may appear through a transitive
import. Grep for every importer rather than assuming the two, and check the
SRD package as well.


## Completion digest

Builder **COMPLETE**, reviewer **PASS at high confidence**, four rounds — the
last of them a re-review after the foreman's rebase, under condition 12.
Branch `worktree-agent-a72e43e4cfed7fd8f`, commit `f855f87`, rebased to
`ff15526`. Tests **7017 → 7033 on `main`**, 16 new in one file.

**The payoff, and the foreman verified it independently on `main` rather than
taking the digest's word.** A line appended to `COVERAGE.md` now **survives a
full `npm test`** and is visible to `git diff --exit-code`; before this, the
same corruption vanished after a single test file ran. Every merge record this
tranche has written says "`COVERAGE.md` byte-clean", and until this merge that
claim was true for the wrong reason.

Seven mutations, each failing for its own reason. Two are the interesting ones:
**dropping the test exclusion turns the sweep red rather than quiet** — the
safe-failure-direction claim verified rather than asserted — and **deleting the
`packages/*/scripts/**/*.test.ts` glob from `vitest.config.ts` fails the
exclusion's stated reason**, so the exclusion is pinned to the fact that
justifies it rather than to an opinion.

`COVERAGE.md` regenerates byte-identically at the same sha1 and is **absent
from the commit entirely**. Both golden-log generators produce output
byte-identical to their pre-guard versions.

Four files outside the brief's *likely* surface, each required by the brief's
own text or falsified by the change: the two golden-log generators, which carry
the same unguarded top-level write and sit inside the directory requirement 3
names; `.github/workflows/ci.yml`, **comment only, no step and no command
changed**, whose stated reason for a *required* step named the import chain this
task removed; and `CONTRIBUTING.md`, whose lane-A ownership row pointed
`VERIFIED_SPELLS` at the renderer it no longer lives in.

Stated limit, not a shortfall: the sweep catches `writeFileSync` by name, bare
or namespaced. `appendFileSync`, a renamed import or `fs.promises.writeFile`
would evade it — that is the population requirement 3 specifies.

## Risk gate

**Inspected**, for the integration failure rather than for the code.

**Condition 12 caught this branch once and that is the record worth keeping.**
IE-021's sweep is defined over every script in `packages/engine/scripts/`, and
**IE-023 landed two *tests* in that directory** while IE-021 was building. After
the rebase, the population assertion failed (6 files against 8) and the
unguarded-write assertion reported `check-queue.test.ts:89` — a test writing
throwaway fixtures so it can drive the real CLI, which is not "a script that
writes at import time" and is not what the guard is about. The rule was right;
its population changed underneath it. Returned, fixed, **and re-reviewed**,
because the review that passed it had seen a different population.

**The tension in the fix was left to the builder and it answered well.** Its
reviewer had praised the hard-coded file list as a vacuity guard; a hand-kept
list of files is also the shape this repository keeps finding wrong. What
replaced it holds both ends:

- `isScript` excludes test files by extension, and **every file the predicate
  excludes is asserted to be a test file** — so the exclusion cannot quietly
  widen;
- `WRITING_SCRIPTS` is a three-name floor asserting those scripts are *in* the
  population **and that each still contains a `writeFileSync(`** — so the floor
  cannot itself go vacuous.

I read the predicate and both assertions, and verified the payoff by corrupting
`COVERAGE.md` on `main`, running the suite, and watching the corruption survive.

Classification: **GREEN**.

**One integration change by the foreman, taken rather than sent back.** The
builder flagged a prose incompleteness in its own `CLAUDE.md` paragraph — it
enumerates two cases for a newly added script and omits the third, that a
*guarded* write fails until the script is named in the floor — and explicitly
declined to spend a fifth round on it, on the grounds that the reviewed sha
should be the sha that merges. That is the right trade and the right framing.
Added as `8ec33c5`, one sentence, no code, committed apart from the merge. The
behaviour was already correct; what was wrong is a two-item enumeration that
reads as complete, which this file records going wrong in IE-008's two lists of
pool kinds.

## Architecture decision

None. No Fable involvement.

## Merge record

Merged to `main` as `ff15526`, fast-forward, pushed. Rebased by the foreman
twice — once over eight merges, where the one conflict was the known mechanical
`CLAUDE.md` collision (IE-029 and IE-021 both appending a new `###` section at
one insertion point; both kept, and the blank line the markers ate restored),
and once more after the return.

`main` verified after the merge: typecheck ✓, lint ✓, **7033 tests across 109
files** ✓, `COVERAGE.md` regenerating byte-identically ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence **on the re-reviewed commit**; **4** defects resolved; **5**
gauntlet green; **6** conformance — and for the first time the gauntlet's
`COVERAGE.md` diff means what it says; **7** no blocker; **8** no deviation;
**9** no foundational primitive; **10** four files outside the likely surface,
each forced by the brief's own text; **11** the `CLAUDE.md` conflict was
mechanical and resolved by the playbook; **12** **failed once, handled, and
re-reviewed** — the record above; **13** risk gate inspected, GREEN.

**Wave 1 is complete.** All four instruments the delta audit called broken are
repaired, and every one of them has fired on a real defect.
