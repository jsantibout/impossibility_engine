# IE-021 — `COVERAGE.md` has one writer, so the gauntlet's diff means something

state: CHANGES_REQUIRED
lane: tooling
tranche: 5
parallel-safe: YES — `scripts/coverage.ts` and two test imports; no engine module
depends-on: none
worker: qb-builder · .claude/worktrees/agent-a72e43e4cfed7fd8f · worktree-agent-a72e43e4cfed7fd8f
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

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

## Risk gate

## Architecture decision

## Merge record
