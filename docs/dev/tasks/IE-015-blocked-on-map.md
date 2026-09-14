# IE-015 — `BLOCKED_ON`: derive the blockers instead of counting them by hand

state: IMPLEMENTING
lane: conformance
tranche: 4
parallel-safe: YES — a derived map and its guard; no engine source, no effect kind, no event
depends-on: none
worker: qb-builder · C:/Users/justi/Code/QuestBarrel/ImpossibilityEngine/.claude/worktrees/agent-aa7141e454a68d3a6 · worktree-agent-aa7141e454a68d3a6
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: none

## Brief

### Objective

Give the **undefined** spell population the same derived treatment the executed
one already has: a `BLOCKED_ON` map from spell id to the `MISSING_SHAPES`
entries that block it, asserted complete over every undefined spell, so that a
shape's consumer count becomes a query rather than a prose estimate.

### Why now

**This is the fix for the fourth audit's fourth finding, and it matters because
the failure has already happened three times.** The repository carries three
rankings of the same family — `PROGRESS.md`'s map says a granted Resistance is
17 open spells, the leverage audit says 4, the SRD text supports 2 whole and 1
partial — and **none of them was derived**. Two of the leverage audit's four
remaining candidates did not survive Fable's re-derivation, and the one it
re-derived first was overstated roughly twofold.

`PARTIAL_SPELLS` stopped being a hand list when IE-004 made it a consequence of
the adjudication map. The undefined population's blockers — which IE-002 wrote
out spell by spell, in prose — are the missing half of that same derivation.

**It is in this tranche and not a later one because every ranking written after
it would otherwise rest on manual counting again.** Tranche 4's own order does
not depend on it: Fable re-derived those tasks against the SRD text. The
*next* tranche's would.

### Current relevant architecture

- `MISSING_SHAPES` and `ADJUDICATED` in `spell-honesty.test.ts` — 27 shapes,
  88 executed-bucket adjudications, and the "no shape sits unclaimed" assertion
  at `:909` that is the guard to mirror.
- `spell-tracking.test.ts`'s own adjudications (14) and its two private shape
  ids (`jumping`, `teleportation`).
- `PARTIAL_SPELLS` in `packages/engine/scripts/coverage.ts`, derived.
- IE-002's spell-by-spell findings on
  `docs/dev/tasks/IE-002-pour-spells-into-existing-shapes.md` and in
  `CLAUDE.md`'s drained-shapes bullet — the prose this task replaces with data.

### Required behaviour

1. `BLOCKED_ON: Record<spellId, readonly ShapeId[]>` over **every parsed spell
   with no definition**, sharing the `MISSING_SHAPES` vocabulary. A spell
   blocked on nothing the engine owns — genuinely the table's — is recorded as
   such rather than omitted.
2. **Asserted complete in both directions**: every undefined spell has an
   entry, and every id in an entry is a known shape. The same shape of guard
   the honesty map already carries.
3. **The three bundle ids are split.** The audit found
   `outcome-scoped-child-effects`, `a-mode-on-the-save-a-spell-forces` and
   `a-repeat-save-beyond-the-turn-hook` are bundles — the last is four
   mechanisms with consumer counts of one to three each, not a shape with
   eight. Split them, re-file the affected adjudications, and say which moved.
   IE-010 renames the first to `outcome-riders` and re-files three entries;
   this task rebases over it and must not undo that.
4. **A consumer count becomes a query.** One function answers "how many spells
   does shape X block, and which", over both populations, and the coverage
   report can print it.
5. `PROGRESS.md`'s ranked map and the leverage audit are **re-pointed at the
   derivation** rather than corrected in place: a number in prose that nothing
   regenerates is the class of claim this task exists to end. The leverage
   audit is a historical record and keeps its figures with a note that they
   were superseded; `PROGRESS.md`'s live map points at the query. **The builder
   reports what `PROGRESS.md` needs and does not edit it** — that file is the
   foreman's.

### Architecture constraints

- No engine source change. This is a map, a guard and a query.
- Do not invent a blocker. Where IE-002's prose and the SRD text disagree, the
  SRD text wins and the disagreement is reported.
- Do not re-adjudicate fiction-versus-debt. The audit checked that line in
  every entry and found it right; what is wrong is *which shape*.

### Acceptance criteria

1. The map covers every undefined spell, asserted both ways, and the assertion
   fails if a spell is added to the catalogue without an entry or a definition.
2. A mutation deleting one entry fails the completeness assertion.
3. The query returns, for each of the three former bundle ids, counts that sum
   to what the bundle claimed — the evidence the split preserved the facts.
4. No per-shape count that nothing regenerates is left in the files this task
   touches.
5. The whole gauntlet passes.

### Dependencies

None to start. **Merges after IE-010**, which renames a shape id and re-files
three adjudications; the foreman rebases.

### Likely file surface

A new map beside `spell-honesty.test.ts` or under `packages/engine/scripts/`,
`spell-honesty.test.ts`, `spell-tracking.test.ts`, `coverage.ts`,
`COVERAGE.md`, `CLAUDE.md`.

### Out of scope

Defining any spell; re-adjudicating the executed population's
fiction-versus-debt line; the feature population, which has no equivalent map
and no evidence yet that it needs one; `PROGRESS.md`, which is the foreman's.

### Known risks

- Two hundred-odd spells read one at a time is the bulk of this task, and
  IE-002 proved that a shape-level estimate and a paragraph-level audit give
  different answers. Read the paragraph.
