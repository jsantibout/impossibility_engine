# IE-008 — Every pool a level grants, granted at advancement

state: DONE
lane: mechanism
tranche: 3
parallel-safe: YES beside a spell-resolution task — it is `creation.ts` and the resource pools, touching no spell, no event type and no fold; NO beside another task in `creation.ts` or resource authority
depends-on: none
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 3"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 3" (tranche 3 authority; 13/13 conditions green)

## Brief

### Objective

Make `advanceCharacter` grant every pool the new level grants, and resize
every pool whose maximum the new level moves — the two kinds it already does
for hit dice and spell slots, applied to the two kinds it silently omits.
Leave what has been spent spent, as the existing path already does.

### Why now

**This is a wrong number in a shipped path, not a missing feature**, and it
is the class of failure this repository calls its worst: it looks like a
rules bug forever after.

`creation.ts:2423` — `poolEvents`, run at creation — declares four kinds of
pool: the Hit Die pool, the spell slot pools, **a feat's free-casting pool**,
and **a feature's own pool, "sized by the class table at the level it is read
at"**. `advanceCharacter` (`creation.ts:2661`, emission at `:2735-2768`)
emits `hit-point-maximum-raised`, one `resource-pool-resized` for the hit
dice, a declare-or-resize for each slot pool, and `character-advanced`. The
last two kinds are not there at all — neither declared when the new level
grants one, nor resized when the new level moves one.

The comment sitting above that block says "Pools that already exist grow;
pools that did not exist are declared." That is true of the two kinds below
it and false of the other two, which is why it reads as complete.

What it costs, in printed SRD numbers:

| Feature | Sized by | A character advanced 3 → 4 has |
|---|---|---|
| Lay On Hands | "five times your Paladin level" | 15 hit points in the pool, not 20 |
| Sorcery Points | the Sorcerer level | 3, not 4 |
| Monk's Focus | the Monk level | 3, not 4 |
| Rage, Channel Divinity, Wild Shape, Second Wind, Bardic Inspiration | a column of the class table | whatever the table printed at the level they were *created* at |

And a pool that arrives later never arrives at all: a Fighter advanced to 9
has Indomitable on the sheet and nothing to spend, so `takeTestReaction`
refuses a Reaction the character is entitled to. That is the symptom IE-006's
builder hit — it created its fighter at level 9 to work around it — and the
worked-around bug is the smaller half of what is actually here.

### Current relevant architecture

- `poolEvents` (`creation.ts:2423`) — the creation-time declarer, and the
  specification this task is matching. Its four loops are hit dice, slot
  pools, `plan.spellcasting.granted[].freeCastPool`, and features whose
  `grants.kind === 'activated'` with a non-null `pool`. Arcane Recovery is
  matched by id there, because its single use is not a column in any table.
- `advanceCharacter` (`creation.ts:2661`), emission at `:2735-2768`. It
  already holds `plan.value` — a full `CharacterPlan` at the new level — and
  `creature.resources.pools`, which is everything the declare-or-resize
  decision needs. **The facts are already in hand; only the loops are
  missing.**
- `resource-pool-declared` and `resource-pool-resized` already exist and are
  already emitted by this function. **No new event type**, and
  `resource-pool-resized` is documented in `CLAUDE.md` as changing a maximum
  and leaving what has been spent spent — which is exactly the required
  semantics for a pool that grows with a level.
- `poolSizeOf` in `progression.ts` — the three SRD sizings (a table column,
  an ability modifier with a floor, a multiple of the class level), each read
  at *that class's* own level. A multiclassed Bard's Inspiration must not
  grow with their Fighter levels; `CLAUDE.md` records that and it is the
  fixture that discriminates.

### Required behaviour

1. `advanceCharacter` emits, for every feature pool the character has at the
   new level: `resource-pool-declared` where `creature.resources.pools` has
   no such key, `resource-pool-resized` where it does and the maximum has
   moved, and **nothing at all** where it has not. The last clause matters —
   a resize to the number already stored is a no-op event, and the log should
   not carry one per level per feature.
2. The same for a feat's free-casting pool, for a feat gained at an Ability
   Score Improvement level.
3. Spent is never touched. A Barbarian who has used two Rages and levels up
   has a larger maximum and the same two spent.
4. A pool whose maximum would *shrink* is out of scope and must not be
   emitted silently: no SRD progression shrinks one, so if the builder finds
   a case it is a finding for the digest.
5. The shared derivation is one function used by both callers, or
   `poolEvents` is refactored so both reach it. Two lists of four pool kinds
   that must agree is the bug this task is fixing, arriving again.

### Architecture constraints

- No new event type, no change to `events.ts`, the reducer or the fold.
- No change to `poolSizeOf` or to any class table. If a size looks wrong,
  that is a separate finding, not this diff.
- Declared, never derived, stays the rule: the engine does not compute a pool
  the class definition did not declare.
- Both frozen logs must fold unchanged. `golden-log-2.json` **contains a real
  advancement** (Nyx 4 → 5), so this task is squarely in its path: if that
  character has a feature pool, the frozen log will now disagree with a fold
  that emits more events than it did. **That is not a reason to regenerate
  the fixture.** The fixture is a log, and folding a log that was written
  without those events must still give the state it always gave; if the
  builder finds it does not, the task stops and reports, because it means the
  change is not backward-compatible and that is an architectural question
  rather than an implementation one.

### Acceptance criteria

1. A failing test first, for each of: a pool that grows with the level
   (Sorcery Points 3 → 4 is the cleanest, being a bare class level), and a
   pool that does not exist until a later level (Fighter 8 → 9, Indomitable,
   ending in a `takeTestReaction` that now succeeds where it previously
   refused).
2. Spent is preserved across the advancement, asserted.
3. A multiclass fixture asserts a pool is sized by *its own class's* level
   and not the character level — the mutation that reads the character level
   must fail it.
4. No redundant `resource-pool-resized` is emitted for a pool whose maximum
   did not move, asserted on the event list.
5. Both frozen logs fold to the state they have always folded to.
6. The whole gauntlet passes; `COVERAGE.md` regenerated.

### Tests and conformance

`creation.test.ts` or the advancement test file beside it; a `class-pools`
assertion if that file already owns the pool population. The class-table
suites run unchanged.

### Dependencies

None. It is `creation.ts` and the resource pools; nothing in this tranche
touches either.

### Likely file surface

`packages/engine/src/creation.ts`, its advancement test file,
`packages/engine/src/class-pools.test.ts` if the population assertion lives
there, `CLAUDE.md` (the progression section, which currently says "Pools grow
rather than being re-declared" and describes only the half that worked).

### Out of scope

Ability Score Improvements taken as score increases; per-class spell
preparation; any change to what a class table prints; the nine unreachable
event types; `restoreResourcesOn`.

### Known risks

- **The frozen fixture crossing this path** is the one real risk, and the
  constraint above says what to do rather than leaving it to judgement.
- A shared derivation refactor is where a behaviour change hides; the guard
  is that creation's emitted events for an unchanged character are identical
  before and after, which is worth asserting directly.

## Completion digest

```
IE-008 — Completion digest
Approved architectural intent: Make `advanceCharacter` grant every pool the new level grants and resize every pool whose maximum the new level moves, through one shared derivation both creation and advancement reach — rather than a second list of pool kinds that has to agree.
Builder: COMPLETE
Worktree: .claude/worktrees/agent-ac397271e5c2f6353   Branch: worktree-agent-ac397271e5c2f6353   Commit: 0f709ab (rebased by the foreman to 601774c)   Rebased on main at: not rebased by the builder, per the tranche-3 launch instruction; built on base 85bdf28
Opus review: PASS — rounds: 1
Tests: 5517 passing / 5517 total; new tests: 9; mutation run: four mutations, each failed the tests that name it — (1) reverting the advancement loop to the old hit-dice-plus-slots list failed five tests; (2) removing the `held.max === pool.max` skip failed both no-redundant-resize tests; (3) sizing Lay On Hands by `totalLevelOf(choices)` instead of the class's own level gave 30 instead of 25 and failed both multiclass tests; (4) reversing the derived pool list failed the ordered-declaration refactor guard. A fifth mutation flipped the shrink sweep's comparison and it reported 57 rising steps, proving that loop runs.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — `COVERAGE.md` regenerated byte-identical; no spell or feature definition touched.
Architectural deviations: none
Foundational primitives touched: `packages/engine/src/creation.ts` — `poolEvents` split into `poolsFor` (the shared derivation) plus a one-line mapper, and the pool-emission block in `advanceCharacter`. Both are named in the brief. One signature simplification not spelled out in the brief: `poolsFor` reads `choices.level` instead of taking a `level` parameter, because both call sites always passed exactly `choices.level` — a parameter a caller could get wrong is the same failure mode the task is fixing. No `events.ts`, no reducer, no fold, no `commands/`, no `poolSizeOf`, no class table.
New runtime special cases: none
Files outside the brief's surface: none — three files, all in the brief's "likely file surface".
Out-of-scope findings (not acted on):
- **`hitDicePools` is a pure function nothing calls.** `packages/engine/src/multiclass.ts:142` implements "Hit Dice pool by die type" correctly, is tested against both SRD worked examples in `multiclass.test.ts:203`, and is reached from no production code. `poolsFor` declares exactly **one** Hit Die pool, from the *starting* class, sized at `choices.level`. So a Paladin 4 / Fighter 1 has `hit-die:d10` max 4 for a level 5 character, and a Cleric/Paladin gets no d8 pool at all. `CLAUDE.md`'s Multiclassing section claims the implemented behaviour. This is pre-existing and byte-identical before and after this diff (the old code emitted `max: level` for the same key), and the brief forbids touching pool sizing — but it is a wrong number in the function I just refactored and is worth queueing. The reviewer independently confirmed it against the built engine.
- The brief's inventory said `poolEvents` declared **four** kinds of pool; `main` actually has **seven** (the `reaction` and `recovery` grants landed after the brief was written). All seven now flow through the shared derivation, which is the brief's requirement 5 rather than an expansion — the reviewer agreed.
Unresolved concerns: none
Reviewer confidence: high
Recommendation: READY FOR MERGE

IE-008 — Independent review
Verdict: PASS
Commit reviewed: 0f709ab3e0164d92b979e6fa0ea71072e3b4275f   Gauntlet re-run: typecheck ✓ lint ✓ test 5517/5517 coverage diff ✓
Brief compliance: met. One derivation (`poolsFor`) reached by both callers; advancement declares a pool the creature lacks, resizes one whose maximum moved, and emits nothing where it did not; spent untouched; level read off `choices`; no new event type, no `events.ts`/reducer/fold change, no change to `poolSizeOf` or any class table; both frozen logs fold unchanged and neither was regenerated. The brief named four pool kinds and main has seven; all seven are covered, which is the brief's rule 5 rather than an expansion.
Tests: nine new in `class-pools.test.ts`. Sorcery Points 3→4 (resized, not re-declared) and Fighter 8→9 Indomitable (declared, and then actually spent through `resolveTest`/`takeTestReaction`) both fail on main — the offer is pool-gated at `commands/reactions.ts:912`, so no pool means no offer. Spent-preserved asserts max 4 with spent 2. Multiclass Paladin 4/Fighter 1 → Paladin 5 pins Lay On Hands at 25, which a character-level mutation would make 30. The no-redundant-resize test bites a mutation removing the `held.max === pool.max` skip, and is non-vacuous because the ordered-declaration test pins the real keys. The ordered-declaration test is the refactor guard the brief's risk note asked for. The shrink sweep runs over every pool-declaring feature in twelve classes with a non-vacuity floor.
Regression risk: none found. Both golden logs untouched; folding a log is unaffected by a command emitting more events. The only behavioural change to an existing path is that advancement no longer emits a no-op `resource-pool-resized` for hit dice and unchanged slot pools — same folded state, fewer events, which is acceptance criterion 4. The idempotency and action-economy sweeps in `invariants.test.ts` pass unchanged; `advanceCharacter`'s id exemption is untouched.
Conformance: PASS — COVERAGE.md regenerated and byte-identical; no spell definition touched.
Scope creep: none. Three files, all in the brief's likely surface. The `fighter` fixture gained a level-7 Champion fighting-style choice, which is needed to build a level 8/9 Fighter at all.
Architectural violations: none. No name-keyed special case, no second source of truth (the point of the change is removing one), nothing stored that should be derived, no guard above a duplicate check.
Hard-coded or test-specific fixes: none.
Accidental coupling: none in `src`. The test file now imports `resolveTest`/`takeTestReaction`/`createRng`/`createRollIssuer`, which is test-only and is what proves the Indomitable pool is spendable.
Foundational primitives touched: `creation.ts` only — `poolEvents` refactored to `poolsFor` and the advancement emission block. The brief names both. No `events.ts`, no reducer, no `commands/`, no resource semantics.
New runtime special cases: none.
Defects for the builder: none
Escalation reason: none
Confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

Two signals, and the diff was read in full because one of them was the
foreman's own error.

**A foundational primitive changed**, which the brief ordered, so the question
was whether the change is the one it ordered. It is. Every hunk in the split
is the same transformation — `events.push({ type, id, pool: {...} })` becomes
`pools.push({...})` — with the event shape rebuilt once in a one-line mapper.
Nothing about a pool's key, label, maximum, recovery or short-rest rule is
touched anywhere in the diff. The advancement loop replaces the two-kind list
with the shared derivation and adds the `held.max === pool.max` skip. GREEN.

**The brief undercounted, and the builder caught it.** It said `poolEvents`
declared four kinds of pool; `main` has seven — the `pool`, `reaction` and
`recovery` grants are three more loops below the four the brief named, and the
foreman read only as far as the fourth when writing it. That is a defect in
the brief rather than in the work, and it is worth recording plainly: had the
builder implemented the brief's four literally, three kinds of pool would
still be frozen at the creation level and the task would have reported success.
It implemented requirement 5 instead — *one derivation, both callers* — which
is what makes the count irrelevant, and is the reason that requirement was
written the way it was. The reviewer independently agreed it is compliance
rather than expansion.

The one undeclared-in-the-brief signature change, `poolsFor` reading
`choices.level` rather than taking a `level` parameter, is the same argument
one level down: both call sites passed exactly `choices.level`, and a
parameter a caller can get wrong is the failure mode this task exists to
remove. Declared in the digest, GREEN.

**A new bug, found in the function this task refactored**, is recorded rather
than fixed: `hitDicePools` in `multiclass.ts:142` is correct, tested against
both SRD worked examples, and called from no production code, while
`poolsFor` declares one Hit Die pool from the starting class. That is the
eleventh instance in this repository of a pure function nothing calls, and it
is a wrong number rather than a missing feature. It is **pre-existing and
byte-identical across this diff**, the brief forbids touching pool sizing, and
no task joins an approved roster — so it goes to `LATER` with its evidence, as
the rule requires.

Merging under tranche 3 authority.

## Merge record

Merged to `main` as `601774c`, fast-forward, pushed. Worktree retired and
branch deleted. Rebased by the foreman over `69e1df2`, the launch bookkeeping,
which is `docs/dev/` only — conflict-free.

The thirteen conditions, asserted by name:

1. **Inside the brief** — yes; three files, all on its named surface, and the
   seven-versus-four question is answered above.
2. **Builder COMPLETE** — yes.
3. **Independent reviewer PASS, confidence high** — yes, at the first round.
4. **Defects resolved** — none were raised.
5. **Gauntlet in the worktree** — typecheck ✓ lint ✓ test 5517/5517 ✓
   coverage ✓ `git diff --exit-code COVERAGE.md` ✓.
6. **Conformance** — `COVERAGE.md` regenerated byte-identical; no spell or
   feature definition touched.
7. **No unresolved architecture blocker** — none; Fable was not needed, and
   the frozen-fixture risk the brief named did not materialise.
8. **No material deviation** — none declared; the one signature simplification
   is inside the brief's own requirement 5.
9. **No unexpected authority-boundary or foundational-state change** — none.
   No new event type, no `events.ts`, no reducer, no fold. The one behavioural
   change to an existing path is that advancement no longer emits a no-op
   resize, which is acceptance criterion 4 and folds to the same state.
10. **No meaningful scope expansion** — none; no file outside the surface.
11. **No non-mechanical merge conflict** — none; the rebase crossed a
    docs-only commit.
12. **Integration did not invalidate the review** — full gauntlet re-run on
    `main` after the fast-forward: typecheck ✓ lint ✓ test 5517/5517 ✓
    coverage byte-clean ✓, both frozen fixtures untouched.
13. **Risk gate** — GREEN, above.

Verified on `main` at `601774c` and pushed to `origin/main`.
