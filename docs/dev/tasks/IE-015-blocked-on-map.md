# IE-015 — `BLOCKED_ON`: derive the blockers instead of counting them by hand

state: DONE
lane: conformance
tranche: 4
parallel-safe: YES — a derived map and its guard; no engine source, no effect kind, no event
depends-on: none
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: 2026-09-13 — "MERGE" at Gate 3 (condition 3 waived on the owner's recorded rationale)

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


## Risk gate — GREEN on the work, and one merge condition is the owner's

The branch is `worktree-agent-aa7141e454a68d3a6`, rebased on `main` at
`22f168f`, verified here at **6,696/6,696 across 103 files**, `COVERAGE.md`
byte-clean, tree clean.

**Twelve of the thirteen conditions are green.** Condition 3 is not, and it
cannot be made so: the reviewer's `PASS` carries **medium** confidence, and
the reason is structural rather than a defect. The deliverable is a 206-entry
map of which missing shape blocks each undefined spell, read one paragraph at
a time out of the SRD. A reviewer can verify the *mechanism* exhaustively —
completeness in both directions, the split arithmetic, the mutation that
deletes an entry — and can only sample the *readings*. No amount of rework
raises that to high, so this is Gate 3, the exception: the owner's to weigh.

**What is verified exhaustively.** 40 tests in `blocked-on.test.ts`, including
completeness in both directions (a spell added to the catalogue without an
entry or a definition fails), the three former bundles' counts summing to what
each bundle claimed, and a mutation deleting one entry failing completeness.
The per-shape counts nothing regenerates are gone. `COVERAGE.md` is
byte-identical.

**What is sampled.** Which of the 81 shapes blocks each of the 206 spells.

**The map earned its keep before it merged.** Its consumer query *predicted*
that IE-017 would finish Stoneskin and Mind Blank. Stoneskin was right; Mind
Blank was wrong — and the failure located a bundle inside the map's own
vocabulary. The confirming reviewer sharpened it: `conditionApplicability`
takes an `AdaptedMonster`, not a `CreatureState`, so IE-017 could not have
reached condition Immunity even in principle. A map whose wrong answers are
diagnosable is doing the job a hand-kept list never did.

### The citation round, and the one correction the foreman made

Two misquotes were sent back; the builder fixed them and then **built a sweep
that found five more of the same class** — 119 quoted runs, 19 initially
unresolved, 12 matcher artefacts, **7 real citation errors** — and
characterised them correctly: *"Every one of the seven corrections was a
citation rather than a reading: no entry's blocker changed, no count moved,
`COVERAGE.md` is byte-identical."*

**Spot-checking two of the seven found the seventh was applied backwards.**
`targeting-rules-that-differ-within-one-casting` attributes its quote to
`CLAUDE.md` and was "corrected" to the wording of a different file:

| | |
|---|---|
| `CLAUDE.md:3975` — the document the description **names** | "the point **rather than** to each target" |
| `spell-definitions.ts:1296` — the wording the sweep **resolved against** | "the point, **not** to each target" |

The repository states the same sentence two ways, in two places, and the
sweep matched the run against the one the description does not cite. Restored
to CLAUDE.md's wording as `4c066d6`, a foreman integration commit, because
the correction is determined by the cited document and needs no judgement
about the code.

**An independent sweep over all 99 quoted runs in the file found no other run
absent from the document it names**, and the other six corrections were
verified individually against their sources — `PROGRESS.md:1404`,
`spell-definitions.ts:1280`, Hypnotic Pattern's SRD paragraph
(`spells.md:3255`), `CLAUDE.md:1644`, `CLAUDE.md`'s "nothing records what a
save was against", and the re-described save-mode shape. Gauntlet re-run
after the correction: typecheck ✓ lint ✓ **6696/6696** ✓ coverage ✓
`COVERAGE.md` byte-clean ✓.

### Recommendation

**MERGE.** The medium confidence is honest about what review can reach, not a
signal that something is wrong; everything a test can hold is held, the one
defect found by sampling was a citation rather than a reading, and the map's
first prediction already paid for itself. But condition 3 is condition 3, and
the decision is the owner's.


## Merge record

Merged to `main` as `c4f3b85` with the foreman's citation correction `a7013cc`,
fast-forward, pushed. **6,696 tests across 103 files.** Partial and executed
unchanged — this task defined no spell and changed no engine source.

**Condition 3 was waived by the owner, and the rationale is theirs rather than
mine, so it is recorded in their words:**

> "I accept the reviewer's medium confidence as a limitation of exhaustive
> semantic re-adjudication, not as an unresolved implementation concern."

That is the distinction the gate existed to put to them. Twelve conditions were
green; the thirteenth was a `PASS` at medium whose cause is that a 206-entry map
read one SRD paragraph at a time can be verified exhaustively as a **mechanism**
and only sampled as a set of **readings**. No amount of rework raises it, which
is what made it Gate 3 rather than `CHANGES_REQUIRED`.

The thirteen conditions: 1 inside the brief · 2 COMPLETE · 3 **PASS at medium —
waived above** · 4 defects resolved, including the one the foreman found after
the review · 5 gauntlet ✓ · 6 `COVERAGE.md` byte-identical; no definition
touched · 7 no blocker · 8 no deviation · 9 no engine source changed at all ·
10 no scope expansion · 11 no conflict · 12 rebased onto `67cd234` and the
gauntlet re-run there, then again on `main`: typecheck ✓ lint ✓ **6696/6696** ✓
coverage byte-clean ✓, both frozen fixtures untouched · 13 GREEN.

### What merged, beyond the map

- **40 tests**, including completeness in both directions — a spell added to the
  catalogue with neither an entry nor a definition fails — the three former
  bundles' counts summing to what each bundle claimed, and a mutation deleting
  one entry failing completeness.
- **`consumersOf` and `allShapeConsumers`**, which is what turned
  `PROGRESS.md`'s ranked map from a hand-kept list into a query. Both of the
  two numbers the map contradicted were wrong rather than stale, and both in
  the direction that undersold the next task.
- **The largest blocker in the book, found on the first run** — a casting time
  of a minute or more, 54 touched and 12 finished, three times any other shape.
  None of the three rankings carried it at all.

### The citation round, and the correction the foreman made

Two misquotes were sent back; the builder fixed them and then built a sweep
that found **five more of the same class** — 119 quoted runs, 19 initially
unresolved, 12 matcher artefacts, 7 real citation errors — and characterised
them correctly: no entry's blocker changed and no count moved.

**Spot-checking two of the seven found the seventh applied backwards.** The
repository states one sentence two ways, and the sweep matched the run against
the document the description does not cite:

| | |
|---|---|
| `CLAUDE.md:3975` — the file the description **names** | "the point **rather than** to each target" |
| `spell-definitions.ts:1296` — the wording the sweep **resolved against** | "the point, **not** to each target" |

Restored as `a7013cc`. An independent sweep over all 99 quoted runs in the
merged file, against `CLAUDE.md`, `PROGRESS.md`, the architecture records, the
SRD raw text and the engine sources — excluding the file under audit so it
could not match itself — found **no other run absent from the document it
names**, and the other six corrections were verified individually against
`PROGRESS.md:1404`, `spell-definitions.ts:1280`, Hypnotic Pattern's SRD
paragraph, `CLAUDE.md:1644` and `CLAUDE.md`'s "nothing records what a save was
against".

Two findings queued rather than fixed here: the "a shape names where this
repository already described it" guard checks that a source *name* appears and
not that the quote is accurate — and it has to check the **named** source
rather than the corpus, which is what this round proved — and a builder cannot
see a rebase happen, so its digest should report `git merge-base HEAD main`
beside its commit.
