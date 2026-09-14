# IE-044 — Clause-anchored blockers, and a sentence-coverage guard

state: DONE
lane: conformance
tranche: 6
parallel-safe: CONDITIONAL — `scripts/missing-shapes.ts`, `blocked-on.test.ts`, `scripts/coverage.ts`; before IE-036 and IE-045, which both touch what it changes
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 6."

## Brief

### Objective

Give the **undefined** population the clause-anchored entry type the executed
population already has, add a sentence-coverage guard over the SRD paragraph,
and report two `finishes` numbers instead of one.

### Why now

Every wrong prediction this repository has made about what a shape would finish
came from the same place. Five of them — Mind Blank, Protection from Energy,
Enthrall, Magic Weapon, True Strike — plus two blockers found only by reading
(Hex's third sentence, Mislead's double) were **all omissions in the undefined
map**, never a wrong entry, always a missing one. A `BLOCKED_ON` entry is a
bare list of shape ids anchored to nothing, so an entry naming one blocker for
a spell with three passes every guard. A tranche is planned from `unblocks`
counts; this is the instrument that makes those counts honest, and it lands
before the cycle that is briefed from them.

The repository already has the right primitive: `Adjudication.clause` — a
phrase that must match **exactly one** clause of a text, asserted in both
directions, so a reworded clause has to be read again. This points it at the
text an undefined spell has: its SRD paragraph.

### Current relevant architecture

- `scripts/missing-shapes.ts` — `ADJUDICATED` (executed, `{clause, why, note}`),
  `TRACKED_ADJUDICATED` (one adjudication per **marker kind** per spell),
  `BLOCKED_ON` (a list of shape ids), `consumersOf`, `coverageGaps`.
- `blocked-on.test.ts` — the guards, including "no shape sits unclaimed",
  which asks all three maps.
- `spell-honesty.test.ts` — the `PROSE` technique: a quoted run held against
  the spell's own paragraph out of `spells.json`, after normalising emphasis,
  smart quotes and wrapping. Its 24 markers are the wider and better set.
- `scripts/coverage.ts` — the "What blocks the rest" table.

### Required behaviour

1. `BLOCKED_ON` entries become lists of `{ clause, why, note }`, where
   `clause` is a distinctive phrase from that spell's **parsed SRD
   paragraph**, and `why` is a shape id, `'table'`, or `'expressible'` (the
   tracked map's third value under the name that fits a spell with no
   definition). The guard asserts each phrase occurs **exactly once** in that
   paragraph, both directions.
2. A **sentence-coverage** guard: split the paragraph into sentences; for every
   sentence that trips a marker (the honesty guard's 24), require at least one
   adjudication whose phrase lies inside it. That is the four-state claim per
   sentence — modelled, table-owned, deliberately unsupported, or blocked on a
   named shape — derived from the book rather than from a list.
3. `consumersOf` reports **two** `finishes` numbers: finishes among entries
   that are sentence-complete, and finishes among the rest. `COVERAGE.md`
   prints both. The difference is the finding, exactly as `blocks` against
   `unblocks` was.
4. `TRACKED_ADJUDICATED` takes the same entry type, which removes its
   one-per-marker-kind limit for free.
5. **Backfill is family by family, not all at once.** This task backfills
   `a-condition-immunity-a-spell-grants`' ten (IE-042 is briefed from them).
   `a-long-casting-time`'s twelve leave the map with IE-036 and need no
   backfill. Every other entry is grandfathered as **not sentence-complete**,
   which is what the second `finishes` number is for — the shape every
   exemption list here already takes.
6. The **workflow rule** the instrument exists to serve: no shape is briefed
   from an `unblocks` list whose spells are not sentence-complete. The foreman
   records it in `docs/dev/WORKFLOW.md`; the builder does not edit `docs/dev/`.

### Architecture constraints

Settled; a deviation is `ARCHITECTURE_BLOCKED`:

- **no new hand list.** The instrument is the existing entry type pointed at
  the existing text;
- the sentence split is a test-time read over prose the repository already
  parses. Representing SRD clause boundaries in the parser was considered and
  refused: it would be a data model with one consumer.

### Acceptance criteria

1. Every guard is driven over a **synthetic** entry it must catch — a phrase
   that appears twice, a phrase that appears in no paragraph, and a marker
   sentence with no adjudication — and over one it must pass, because a sweep
   satisfied by reporting everything is not a sweep.
2. The ten condition-immunity claimants are sentence-complete and their entries
   quote real phrases.
3. `COVERAGE.md` regenerated and byte-clean, showing both `finishes` numbers.
4. `coverageGaps` still reports an undefined spell with no entry at all, and
   its synthetic case still passes.
5. No count of anything is written into prose; the report is the number.

### Tests and conformance

`blocked-on.test.ts` and the gauntlet. No engine code is touched.

### Dependencies

None, and it must merge **before** IE-036 (which removes twelve entries) and
before IE-045 (which edits `scripts/coverage.ts` alongside it).

### Out of scope

Backfilling the other ~180 entries. The executed map's opt-in `covers` ratchet
— recorded by the audit as step 4 and deliberately deferred with the backlog.

### Known risks

Low, and entirely in the sentence splitter: prose splitting is approximate and
must fail **loud** rather than silently under-reporting. Where it cannot split
a paragraph it must say so rather than returning one sentence.

## Completion digest

```
IE-044 — Completion digest
Builder: COMPLETE
Commit: a89665f (replayed onto main as 5605992)   Branch: worktree-agent-a18f14df59a942ff1
Opus review: PASS — rounds: 3, confidence high, no defects
Tests: 7847 / 7847 on the branch; new: 35 (blocked-on 32 → 92, spell-tracking +2).
  On main after the replay: 7909 across 117 files.
Mutations: five, each reverted — a splitter returning the paragraph whole fails four tests
  including the length bound that is the only thing able to see it; sentenceGaps reporting
  nothing fails its synthetic marker sentence; sentenceGaps reporting everything fails fifteen;
  unanchoredPhrases reporting nothing fails both synthetics; a tracked clause moved to a
  sentence that does not trip its marker fails the tracked anchoring guard alone.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS
Architectural deviations: none. No new hand list; no shape id invented (83 before, 83 after,
  identical sets); the sentence split is a test-time read over already-parsed prose.
Foundational primitives touched: none — no runtime module under packages/engine/src is in
  the diff.
New runtime special cases: none.
Files outside the brief's surface: spell-honesty.test.ts — CLAUSE_MARKERS and markersIn moved
  out of it into missing-shapes.ts, because requirement 2 says the guard uses "the honesty
  guard's 24" and `npm run coverage` runs outside vitest, so copying them would have been a
  second source of truth. spell-tracking.test.ts — requirement 4 re-types TRACKED_ADJUDICATED
  and that file owns every assertion over it.
Out-of-scope findings: the coverage guard is per *sentence*, so where two clauses sit in one
  sentence the second may be deleted silently — Mind Blank's two halves are both in its first
  sentence, and that pair is pinned by the hand-written BACKFILLED list rather than by the
  derived guard. A per-clause ratchet is the executed map's deferred `covers` work.
Reviewer confidence: high
Recommendation: READY FOR MERGE — with one mechanical rebase action named by the reviewer.
```

## Risk gate

**Light, as the digest earns.** No runtime module under `packages/engine/src` is
in the diff, no fold, no command, no determinism surface, and neither frozen log
is touched. The two files outside the brief's surface are both compelled by
requirements 2 and 4, and the first is the *right* resolution of the two on
offer: moving one marker list rather than copying it, because `npm run coverage`
runs outside vitest and a copy would have been the second source of truth this
repository keeps naming.

**The reviewer's integration action was carried out and turned out to be
already done.** It asked me to delete a stale `BLOCKED_ON` entry for Stinking
Cloud, superseded by IE-043's `ADJUDICATED` entry, warning that a text merge
would keep both and redden `coverageGaps().stale`. The three-way merge resolved
it correctly — IE-043 deleted the line and IE-044 had not moved it — and I
confirmed by grep that the spell is named exactly once in the file, in
`ADJUDICATED`. The check the reviewer relied on is derived and loud, and it is
green.

**`COVERAGE.md` was the only conflict**, which is what `.gitattributes` says it
should be: `merge=binary`, regenerated rather than merged. Regenerated, and
byte-clean on a second run.

Classification: **GREEN**.

## Architecture decision

None. No Fable involvement.

## Merge record

Replayed onto `main` as `5605992` and pushed.

`main` verified **after** the merge: typecheck ✓, lint ✓, **7,909 tests across
117 files** ✓, `COVERAGE.md` regenerated and byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief — all six requirements walked by the
reviewer; **2** `COMPLETE`; **3** `PASS` at high confidence after three rounds;
**4** no defects outstanding; **5** gauntlet green; **6** conformance green;
**7** no blocker; **8** no deviation; **9** no foundational primitive touched at
all; **10** two files outside the surface, both compelled; **11** integration
valid — one conflict, regenerated, and the reviewer's named action verified
already resolved; **12** re-verified on `main`; **13** risk gate light, GREEN.

## What the instrument said on its first day

It immediately reported something uncomfortable and true, which is the whole
point of building it: **`a-long-casting-time` finishes 12 spells and every one of
them is *unread*.** Those twelve are IE-036's roster, and IE-036's brief quotes
that very `unblocks` list as its justification.

That is not a reason to hold IE-036 — its brief already requires each of the
twelve to be read against its own SRD paragraph, which is the reading the column
is asking for. It is a reason to say so in the brief before it launches, so the
builder meets the case deliberately rather than discovering it: a paragraph that
yields a *second* blocker is a spell that does not get a definition, and what it
gets instead is a clause-anchored entry in the shape this task just built. A
note to that effect was added to IE-036 at launch.
