# IE-044 — Clause-anchored blockers, and a sentence-coverage guard

state: IMPLEMENTING
lane: conformance
tranche: 6
parallel-safe: CONDITIONAL — `scripts/missing-shapes.ts`, `blocked-on.test.ts`, `scripts/coverage.ts`; before IE-036 and IE-045, which both touch what it changes
depends-on: none
worker: qb-builder in .claude/worktrees/agent-a18f14df59a942ff1, branch worktree-agent-a18f14df59a942ff1
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: none

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
