# IE-002 — Pour twelve spells into the shapes that already execute

state: DONE
lane: content
tranche: 2
parallel-safe: CONDITIONAL — YES beside one mechanism task provided it uses no kind that task adds; NO beside another content task, which would edit the same registry and list
depends-on: IE-004
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 2"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 2" (tranche 2 authority; 13/13 conditions green)

## Audit note (2026-09-13)

Presented at Gate 1 before the third whole-engine audit and re-scheduled by it
(`docs/architecture/whole-engine-audit-2026-09-13.md`, §4): the honesty
guard (IE-004) changes what a new executed definition must satisfy — every
`unmodelled` clause that trips a mechanical marker needs an adjudication, and
a debt adjudication makes the spell partial — so twelve definitions poured
before it lands are rework. The task itself is unchanged and follows IE-004,
in tranche 2 beside the split.

## Brief

### Objective

Define up to twelve more SRD spells using only the effect kinds that execute
today — `attack`, `save-damage`, `save`, `heal`, `buff`, `temp-hp`,
`roll-mode`, `armor-class`, `dispel` — each transcribed from its SRD paragraph
with the lines quoted, registered in id order, driven by the existing catalogue
and oracle guards, and added to `VERIFIED_SPELLS` where an end-to-end test
exists. Regenerate `COVERAGE.md`.

### Why now

`PROGRESS.md`, "Next actions" item 2: "Keep pouring spells into the five
working shapes… roughly 90 parsed spells fit one of them and need only a
definition with its SRD quote. `spell-catalogue.test.ts` drives every
definition automatically, so the test cost of each new one is zero. This is
the cheapest coverage there is." It is lane A in `CONTRIBUTING.md`, which
"never waits on the mechanism lane" — the point of running it beside a
mechanism task.

### Current relevant architecture

- Definitions and the registry: `packages/engine/src/spell-definitions.ts`,
  everything below the type declarations. The registry test reads the source
  and compares declared spells against registered ones, so a dropped line is
  caught.
- The kinds and their docstrings: the `SpellEffect` union at `:192`. Each
  docstring states the transcription rule for its fields (e.g. `onSuccess` is
  stated, never defaulted; `plus` shares one save; `DiceScaling` carries the
  flat addend and the per-slot notation).
- Guards: `spell-catalogue.test.ts` (every definition cast), `coverage.test.ts`
  (name, level, school, casting time, Concentration against the parsed book),
  the range and duration oracle (`scripts/spell-oracle.ts`),
  `spell-tracking.test.ts` (prose markers demand adjudication — extended to
  executed spells' `unmodelled` clauses by IE-004), `spell-schema.test.ts`
  (validator).
- The measurement: `packages/engine/scripts/coverage.ts`, `VERIFIED_SPELLS`.

### Required behaviour

Selection rule: a parsed spell with no definition whose **entire** mechanical
content is expressed by one existing kind (plus `area`, `targets` or
`targetsWithin`, scaling, and the existing rider fields) with no clause the
honesty guard would call debt. Prefer lower levels and commonly cast spells.
Twelve is a cap, not a target: fewer, with a reason each, is a correct
result.

The honesty guard is on `main` now (`spell-honesty.test.ts`, IE-004,
`0536a2b`). For every executed definition it scans each `unmodelled` clause
for the mechanical markers, demands exactly one adjudication per tripping
clause in `ADJUDICATED` — keyed by a phrase of the clause, `table` with a
reason or a named missing shape — and derives `PARTIAL_SPELLS` from the shape
adjudications, asserting the published list equal to the derived set in both
directions. For this task that means: a new spell's `unmodelled` clauses are
either marker-free or adjudicated `table` with a reason the reviewer reads; a
clause that would need a shape adjudication disqualifies the spell, so
`PARTIAL_SPELLS` does not grow here; and any note that quotes the SRD is held
against that spell's own paragraph.

For each spell: the definition with SRD quotes for every number (dice, save
ability, damage type, scaling, range, duration, target count); the registry
line in id order; and where the spell's numbers are not already pinned by a
catalogue-level assertion, one test that casts it and asserts the number the
SRD prints (the Fire Bolt 2d10 lesson: a fixture-supplied number is the one
nothing checks).

### Architecture constraints

- Content lane only: no change to any type declaration, the command layer,
  `events.ts`, `spell-schema.ts`, `conditions.ts` or any test that is not a
  spell test. A spell that needs a new kind or field is left out and named in
  the report.
- Do not use any effect kind that does not exist on `main` at the moment the
  worktree was created.
- No `unmodelled` claim that is really debt: if a clause is a rule the engine
  should own, the spell does not qualify for this task.

### Acceptance criteria

1. Up to twelve new definitions, each quoting its SRD lines, all registered
   in id order, all parsing through `parseSpellDefinition`.
2. Every one driven by the catalogue test; those with an end-to-end test in
   `VERIFIED_SPELLS`.
3. `COVERAGE.md` regenerated and committed; the executed count rises by the
   number defined.
4. The report lists each spell with the kind used and the SRD line for its
   dice or condition, and lists each candidate rejected with the clause that
   disqualified it.
5. A mutation that changes one new definition's dice fails a test; say which.
6. The whole gauntlet passes; `golden-log.json` untouched.

### Tests and conformance

`spell-catalogue.test.ts` (automatic), `coverage.test.ts` (automatic), the
oracle (automatic), the honesty guard (automatic once IE-004 lands), and one
assertion per spell whose numbers are not otherwise pinned, in the existing
spell test files.

### Dependencies

IE-004.

### Likely file surface

`packages/engine/src/spell-definitions.ts` (definitions and registry only),
`packages/engine/scripts/coverage.ts` (`VERIFIED_SPELLS`),
`spell-honesty.test.ts` (`table` adjudications only), one or two spell
test files, `COVERAGE.md`. Not `CLAUDE.md`, unless a transcription rule worth
recording was learned.

### Out of scope

Any new effect kind or field; any spell needing a shape from the ranked map;
tracked-only spells (that is a different adjudication task); changes to the
oracle or the guards.

### Known risks

- Quietly wrong numbers: every number quoted; one mutation per task proves
  the pinning works.
- Selection creep: a spell that "almost" fits gets a rider it should not; the
  rule is that the whole paragraph fits or the spell is left out.
- Merge with a concurrent mechanism task: both may append registry lines and
  regenerate `COVERAGE.md`; the playbook resolves both mechanically.

## Completion digest

```
IE-002 — Completion digest
Approved architectural intent: Define up to twelve more SRD spells using only the effect kinds that execute today, each transcribed from its SRD paragraph with the lines quoted, registered in id order, driven by the existing catalogue and oracle guards, with no `unmodelled` clause that is really debt — so `PARTIAL_SPELLS` does not grow.
Builder: COMPLETE
Worktree: .claude/worktrees/agent-a26f07bde8b746dd6   Branch: worktree-agent-a26f07bde8b746dd6   Commit: 7f740fe (rebased by the foreman to de45194)   Rebased on main at: NOT REBASED by the builder — `git rebase main` was refused by the permission classifier (Git Destructive). The branch was on 65cf51a; main was 83e1365, whose diff from 65cf51a is docs/dev/QUEUE.md and three task files only, none of them in this diff. The foreman ran the rebase.
Opus review: PASS — rounds: 2
Tests: 5453 passing / 5453 total (baseline 5409); new tests: 13 hand-written (7 Arcane Sword in spell-origins.test.ts, 6 Produce Flame in ongoing-spells.test.ts) plus 30 from the parameterised catalogue, oracle, schema and honesty sweeps that drive every definition automatically; mutation run: four, each reverted — (a) Arcane Sword `4d12` → `3d12` failed "deals 4d12 plus the caster's spellcasting modifier", because no seed then clears 3d12's ceiling of 40; (b) Arcane Sword `addSpellcastingModifier: true` → `false` failed "adds the caster's own spellcasting modifier, and nobody else's", 0 against the printed 4; (c) Produce Flame `cantripUpgradesAt: [5, 11, 17]` → `[11, 17]` failed "reads the Cantrip Upgrade off the caster's level", because the level 9 wizard stops exceeding one die's maximum of 8; (d) Produce Flame `activation.range` 60 feet → 5 failed "throws the fire sixty feet and no further", refusing a target the spell reaches. Before the fix, the honesty guard itself failed for the right reason — no adjudication for Arcane Sword's sight clause.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — COVERAGE.md regenerated and byte-clean on re-run; executed 82 → 84, verified 58 → 60, partial unchanged at 53; both spells' printed range and duration oracled against the book; `golden-log.json`, `PROGRESS.md`, `docs/dev/` and `packages/srd/raw/` untouched.
Architectural deviations: none.
Foundational primitives touched: none. Every hunk in `spell-definitions.ts` is below the `SpellDefinition` type declarations; `commands.ts`, `events.ts`, `spell-schema.ts` and `conditions.ts` are untouched, and only the `attack` effect kind is used — with `origin` and `activation`, both of which exist and execute on `main` at 65cf51a (Spiritual Weapon, Flame Blade).
New runtime special cases: none — both spells are pure declarative data.
Files outside the brief's surface: `CLAUDE.md`. The brief permits it "unless a transcription rule worth recording was learned", and three were: "you make" is not "you can" (`TargetRule.optional`); a spell printing no *Using a Higher-Level Spell Slot* line does not scale; and Range: Self against `activation.range`. It also corrects a claim this task falsified — "**One** is executable by this primitive today" in "A Casting Can Hold A Point" — updates 82 → 84, and records the drained-shapes finding under Known Pending Work.
Out-of-scope findings (not acted on): **The result is two spells, not twelve, and that is the headline.** A spell-by-spell pass over all 211 undefined SRD spells found exactly two the existing kinds fully express. `PROGRESS.md` "Next actions" item 2 — "roughly 90 parsed spells fit one of them… this is the cheapest coverage there is" — is no longer true and is the foreman's file to reconcile against the new CLAUDE.md bullet. The next spell coverage is bought by a mechanism, not by transcription, and the named blockers with their spells are: several attack rolls from one casting (Scorching Ray), damage with neither an attack roll nor a save (Magic Missile), outcome-scoped child effects (Ice Knife, Hideous Laughter, Sleet Storm, Faerie Fire), a damage type chosen at the casting (Chromatic Orb, Sorcerous Burst, Dragon's Breath, Protection from Energy), a condition applied with no saving throw (Invisibility, Greater Invisibility), condition removal (Lesser Restoration, Heal, Protection from Poison), a Resistance a spell grants (Stoneskin, Protection from Energy), a standing rider on every weapon attack (Divine Favor, Hex, Hunter's Mark), a multi-template area or a wall (Fire Storm, Meteor Swarm, every Wall), a Hit Point maximum a spell moves (Aid), a repeating Temporary Hit Point payout (Heroism), and Difficult Terrain an area creates (Entangle, Spike Growth). Separately, `CLAUDE.md`'s "All 125 definitions" sentences were already stale before this branch (130 now) and were left alone as outside this surface.
Unresolved concerns: one, non-blocking and named by the reviewer after the PASS. Produce Flame's die **size** is pinned more weakly than its **count**: a mutation of `1d8` → `1d6` would keep the level 4 caster under the cap of 8 while still letting the level 9 caster clear it, so that test would survive. Asserting that the novice's best actually reaches 8 would close it. I did not make the change, because it arrived with the PASS and amending the reviewed commit afterwards would invalidate the verdict it earned. The number itself is correct — the reviewer and I each checked `1d8` against `packages/srd/raw/spells.md:4377` independently — so this is the strength of a future guard, not a wrong value today.
Reviewer confidence: high
Recommendation: READY FOR MERGE

IE-002 — Independent review
Verdict: PASS
Commit reviewed: 7f740fe   Gauntlet re-run: typecheck ✓ lint ✓ test 5453/5453 coverage diff ✓
Brief compliance: met. Two definitions rather than twelve, which the brief explicitly permits ("fewer, with a reason each, is a correct result"); both use only the `attack` effect kind, and the `origin`/`activation` fields they also use already exist and execute on `main` (Spiritual Weapon, Flame Blade), so no new kind or field was introduced. Registered in id order (ARCANE_SWORD after ARCANE_LOCK, PRODUCE_FLAME after PRESTIDIGITATION); both added to VERIFIED_SPELLS in order; COVERAGE.md regenerated and byte-clean on re-run (82→84 executed, 58→60 verified, partial unchanged at 53). Acceptance criteria 4 and 5 land in the builder's report, which is not on disk — the rejection categories and their blocking mechanics are recorded in the CLAUDE.md "Known Pending Work" bullet; the foreman should confirm the digest names the mutation (4d12→3d12 is the one that bites, deterministically).
Tests: seven new cases in spell-origins.test.ts (Arcane Sword: point placement and reach, 4d12 bounded so 3d12 fails, spellcasting modifier via two casters four apart on one seed, level-7-vs-level-9 identical dice, `no_targets` where Spiritual Weapon's `optional` would allow it, 30-foot move and `origin_too_far` at 35, `wrong_target_count` on an empty activation) and six in ongoing-spells.test.ts (Produce Flame: a cast that harms nobody, the Magic action and ranged attack, 60 reached / 65 refused, the Cantrip Upgrade read off the caster, `replacesPriorCasting`, and `takes_no_target` because Range is Self). Every number quoted from the SRD paragraph and verified by me against packages/srd/raw/spells.md. Fixtures discriminate: the 60/65 pair is the 600-foot-hall lesson applied, and the two-caster fixture is the only shape that can see `addSpellcastingModifier`. Named mutations bite. Weaker pin noted above on Produce Flame's die size (1d8→1d6 survives); not a wrong number, since I checked the book.
Regression risk: none. golden-log.json, PROGRESS.md, docs/dev and packages/srd/raw are all untouched (empty diff). No fold, reducer or command change, so replay determinism is unaffected; the persistence and scenario suites pass unchanged. Shared helpers in spell-origins.test.ts were widened (an optional sheet override, slot pools to level 9, two PREPARED entries) and the whole file still passes.
Conformance: PASS. COVERAGE.md regenerated and matches a fresh `npm run coverage`; the oracle checks both new spells' range and duration against the book; the honesty guard's derived PARTIAL_SPELLS is unchanged, so no debt was parked; the one new adjudication is `table` with a reason that holds against the code.
Scope creep: none. CLAUDE.md is the only file outside the named surface and the brief permits it "unless a transcription rule worth recording was learned" — two were ("you make" is not "you can"; a spell printing no higher-level line), plus the drained-shapes finding, which is the evidence for delivering two rather than twelve.
Architectural violations: none. Pure declarative data below the type declarations; no spell-name special case; no second source of truth; nothing stored that is derived.
Hard-coded or test-specific fixes: none.
Accidental coupling: none. No new imports in either direction.
Foundational primitives touched: none. spell-definitions.ts is +158/-0, entirely below the `SpellDefinition` interface at :779; commands.ts, events.ts and the effect union are untouched.
New runtime special cases: none.
Defects for the builder: none
Escalation reason: none
Confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

Two signals, neither architectural, and the diff was inspected for both.

**A file outside the named surface.** `CLAUDE.md`, +64/-6, read in full. Two
hunks are the transcription rules the brief's own latitude anticipated
("unless a transcription rule worth recording was learned"); three correct
claims *this task falsified* — "**One** is executable by this primitive
today", the count of 82, and two rows of "The family that works and the family
that does not"; one records the drained-shapes finding. A file whose job is to
say how the code actually works cannot be left asserting something the same
commit made false, so correcting it is inside the latitude rather than beside
it. GREEN.

**A conclusion that reorders the roadmap.** Two spells rather than twelve, and
the claim underneath it — that all 211 undefined spells were read one at a
time — is the kind of claim a digest cannot prove. What it can do is be
specific, and it is: every rejection is named with the mechanic that blocks
it, and eleven of the twelve mechanics named are ones this repository has
already written down, in the ranked map, in the deliberately deferred
child-effect vocabulary, and in IE-001. A survey that had invented its
blockers would not land on that list. It changes no code and no architecture;
what it changes is `PROGRESS.md`'s "Next actions" item 2, which is the
foreman's file and is reconciled in this merge. GREEN.

Not signals: no deviation, no foundational primitive, no new abstraction, no
special case, reviewer confidence high, builder and reviewer in agreement. The
diff is +158/-0 of declarative data below the type declarations.

Merging under tranche 2 authority.

## Merge record

Merged to `main` as `de45194`, fast-forward, pushed. Worktree retired and
branch deleted.

The builder could not rebase — `git rebase main` was refused by the permission
classifier — so the foreman ran it. `main` had moved from `65cf51a` to
`83e1365`, whose whole diff is `docs/dev/`, which this branch does not touch;
the rebase was conflict-free and the commit became `de45194`.

The thirteen conditions, asserted by name:

1. **Inside the brief** — yes. Two definitions rather than twelve is what the
   brief itself calls a correct result, and the one file outside the surface is
   the one the brief conditionally permits.
2. **Builder COMPLETE** — yes.
3. **Independent reviewer PASS, confidence high** — yes, at round two.
4. **Defects resolved** — yes; none outstanding. The reviewer's post-PASS note
   on Produce Flame's die size is a strength-of-guard observation rather than a
   defect, and is queued in `LATER`.
5. **Gauntlet in the worktree** — typecheck ✓ lint ✓ test 5453/5453 ✓ coverage
   ✓ `git diff --exit-code COVERAGE.md` ✓.
6. **Conformance** — `COVERAGE.md` regenerated and byte-clean; the oracle
   checks both spells' printed range and duration; `PARTIAL_SPELLS` unchanged
   at 53, so no debt was parked as fiction; the one new adjudication is `table`
   with a reason.
7. **No unresolved architecture blocker** — nothing was `ARCHITECTURE_BLOCKED`
   and Fable was not needed.
8. **No material deviation** — none declared, none found.
9. **No unexpected authority-boundary or foundational-state change** — none.
   `commands.ts`, `events.ts`, the fold and `spell-schema.ts` are untouched.
10. **No meaningful scope expansion** — `CLAUDE.md` only, anticipated by the
    brief and inspected above.
11. **No non-mechanical merge conflict** — none at all; the branch and `main`
    were disjoint.
12. **Integration did not invalidate the review** — the rebase crossed a
    docs-only commit, and the full gauntlet was re-run on `main` after the
    fast-forward: typecheck ✓ lint ✓ test 5453/5453 ✓ coverage byte-clean ✓.
13. **Risk gate** — GREEN, above.

Verified on `main` at `de45194` and pushed to `origin/main`.
