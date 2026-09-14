# IE-022 — The citation guard reads the document it names

state: IMPLEMENTING
lane: conformance
tranche: 5
parallel-safe: YES — `blocked-on.test.ts` and description text in `missing-shapes.ts`; no engine module
depends-on: none
worker: qb-builder · .claude/worktrees/agent-ab94121653ebabfd6 · worktree-agent-ab94121653ebabfd6
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

Where a missing-shape description or an adjudication note quotes this
repository, hold the quote against **the file it names**, not against the
presence of the file's name.

### Why now

**Two misquotes of `CLAUDE.md` shipped past this guard inside tranche 4** and
were caught by a reviewer reading rather than by a test. The guard at
`packages/engine/src/blocked-on.test.ts:153` builds a list of four source
names — claude.md, progress.md, the audit, spell-definitions.ts — and asserts
that a description mentions at least one of them. It is a substring test for a
*source name*. A description may therefore name `CLAUDE.md` and then quote a
sentence `CLAUDE.md` does not contain.

**The repository already has the analogous guard on the other axis**:
`spell-honesty.test.ts` holds an `unmodelled` note's SRD quote against that
spell's own paragraph, added after four notes were found quoting sentences the
book does not print. This is that guard, pointed at the repository's own prose.

### Current relevant architecture

- `packages/engine/src/blocked-on.test.ts:153` — the guard as it stands, with
  its two companions ("writes a real sentence", a length floor).
- `packages/engine/scripts/missing-shapes.ts:85` — `MISSING_SHAPES`, the
  descriptions; `:392` `ADJUDICATED`; `:1024` `TRACKED_ADJUDICATED`.
- `spell-honesty.test.ts` — the precedent, including how it normalises
  emphasis and whitespace before comparing.

### Required behaviour

1. A small alias table resolves a named source to a tracked file: `CLAUDE.md`,
   `PROGRESS.md`, the audit records under `docs/architecture/`, and
   `packages/engine/src/spell-definitions.ts`.
2. For every **quoted run** in a description or a note that names a source,
   normalise emphasis, smart quotes and whitespace on both sides and assert the
   run appears in **that** file.
3. Driven by a **synthetic misquote** it must catch. A guard nobody has seen
   fire is a guard nobody has tested — this tranche's own lesson, and the
   reason the audit flag it describes had never once fired.
4. **The repository states one sentence two ways and the guard must not pick
   for it.** `CLAUDE.md` reads "the point **rather than** to each target";
   `spell-definitions.ts:1296` reads "the point, **not** to each target". Both
   are correct in their own file. Resolve this by *naming* — a note citing
   `CLAUDE.md` is checked against `CLAUDE.md` — and **edit neither file**.

### Architecture constraints

- Report every failure with the shape or spell, the run, and the file it was
  checked against. A guard that reports only a failure teaches nobody.
- A run too short to be a citation is noise. Choose a minimum length, state it
  in the test's prose, and say what it costs — a stated floor is this
  repository's idiom for a marker set.
- Do not widen the alias table to "any file in the repository". The point is
  that a citation names a document somebody reviewed.
- Fix any misquote the new guard finds **in the description**, never by editing
  the cited document to match. If a quote is right and the document is wrong,
  stop and report it: that is a finding, not a fix.

### Acceptance criteria

1. The guard fails on a synthetic description quoting a sentence `CLAUDE.md`
   does not contain, and passes once that quote is corrected.
2. Every existing description and note passes, or the ones that do not are
   corrected in the description and listed in the digest.
3. The two spellings of the Mass Cure Wounds sentence both pass, each against
   the file it names, with neither file edited.
4. `npm test`, `npm run typecheck`, `npm run lint` green; run
   `npm run coverage` and commit it if any description text changed.

### Tests and conformance

All in `blocked-on.test.ts`, beside the guard it replaces. Keep the two
companion assertions.

### Dependencies

None. Touches `missing-shapes.ts` description text only — no structural
change, so it does not collide with IE-021's move.

### Likely file surface

`packages/engine/src/blocked-on.test.ts`,
`packages/engine/scripts/missing-shapes.ts` (description text only).

### Out of scope

A sweep holding `CLAUDE.md`'s counts against `COVERAGE.md`, which is a
different instrument and is not in this tranche. Editing `CLAUDE.md` or
`PROGRESS.md`.

### Known risks

Normalisation is where this kind of guard either over-fires or under-fires.
Prefer under-firing with a stated floor over a clever matcher whose behaviour
nobody can predict.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
