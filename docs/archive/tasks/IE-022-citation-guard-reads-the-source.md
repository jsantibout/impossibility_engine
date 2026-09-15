# IE-022 — The citation guard reads the document it names

state: DONE
lane: conformance
tranche: 5
parallel-safe: YES — `blocked-on.test.ts` and description text in `missing-shapes.ts`; no engine module
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

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

Builder **COMPLETE**, reviewer **PASS at high confidence on round one**, no
defects. Branch `worktree-agent-ab94121653ebabfd6`, commit `147c27d`, rebased
by the foreman to `c0d4ca9`. Tests **6766 → 6786 on `main`**, 8 new. Gauntlet
green, `COVERAGE.md` byte-identical.

**The guard found five real misquotes on `main`**, which is the whole point of
it and is what the old name-presence check could never have seen. They split
into two kinds:

- **Stale numbers quoted from a `PROGRESS.md` that has since been re-derived** —
  "Reads the target's current Hit Points | 3 | vitals | very low" against a row
  that now reads "0 / 4"; "4 printed, far more in play" against "0 / 16"; and
  "An effect that ends another casting | 15 (**unblocked**)" against a row that
  no longer exists in that form at all. This is precisely the stale-source-of-
  truth class the delta audit raised the audit flag over, caught mechanically
  for the first time.
- **Punctuation inside the quotation marks** that the source does not carry —
  a trailing period pulled outside the closing quote, in five places.

One attribution was made explicit rather than left to proximity:
`a-choice-made-at-the-casting` now names `spell-definitions.ts` for Guidance's
own clause, because the guard resolves a run to the **nearest preceding named
source** and that is the rule's stated cost.

Three mutations, each failing as intended: making `containsRun` always answer
yes fails three cases; attributing every run to the union of the alias table's
files fails "fails each spelling when it is attributed to the other file",
which is the assertion that pins **resolution by naming**; restoring the
fabricated quote fails the corpus case naming the shape, the run and the
document.

**The discriminating fixture is the two-spellings pair**, and it is worth
naming: `CLAUDE.md` says "the point **rather than** to each target" and
`spell-definitions.ts` says "the point, **not** to each target". A guard that
checked every known document would pass the first and could not fail the
second, so the pair — and its swapped twin — is what proves the guard resolves
by naming rather than by searching the corpus. Neither document was edited,
which the brief required.

Out-of-scope findings, none acted on: `readdirSync('docs/architecture')` maps
every entry to a file, so a subdirectory added there would make the test throw
rather than fail; `ADJUDICATED` and `TRACKED_ADJUDICATED` notes carry no
repository citation today, so the corpus actually checked is the 98 runs in
`MISSING_SHAPES` and the notes are covered by construction rather than by
evidence; and a quoted run naming no source anywhere before it is unchecked
here and, if it quotes no SRD, by `spell-honesty.test.ts` either.

## Risk gate

**Lightweight.** No architectural deviation, no foundational primitive, no new
runtime special case, no file outside the brief's surface, a reviewer `PASS` at
high confidence on the first round, and a diff confined to one test file and
description text in one script. No runtime code changed at all.

Classification: **GREEN**.

**The builder declined to write `CLAUDE.md` and flagged it rather than
deciding, and it was right to.** My brief's Out of scope said "Editing
`CLAUDE.md` or `PROGRESS.md`" — I meant *do not edit a cited document to make a
quote match*, and it read *do not touch that file at all*. Both readings are
reasonable and the wording was mine. **Third ambiguous or mistaken brief line of
this tranche**, after IE-025's rule 5 and IE-028's criterion 1. The prose is
added by the foreman at integration instead, in a separate commit, so the
reviewed commit stands as reviewed.

## Architecture decision

None. No Fable involvement.

## Merge record

Merged to `main` as `c0d4ca9`, fast-forward, pushed. Rebased by the foreman
over four merges; no conflict, since nothing else touched either file.

`main` verified after the merge: typecheck ✓, lint ✓, **6786 tests across 106
files** ✓, `COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS`,
high, round one; **4** no defects; **5** gauntlet green; **6** conformance —
and the descriptions do not reach the report, so `COVERAGE.md` could not have
moved; **7** no blocker; **8** no deviation; **9** no foundational primitive;
**10** no file outside the surface; **11** clean rebase; **12** re-verified on
`main`; **13** risk gate lightweight, GREEN.
