# IE-004 — The honesty guard for executed spells

state: DONE
lane: conformance
tranche: 1
parallel-safe: YES — beside IE-003 (no shared source files; `CLAUDE.md` prose and `COVERAGE.md` merge mechanically); CONDITIONAL beside a content task, which edits the same definition region
depends-on: none
worker: none
approved: 2026-09-13 — "APPROVE BATCH"
merge-approved: 2026-09-13 — "MERGE BOTH"

## Brief

### Objective

Extend the honesty guard from the 46 tracked spells to the 82 executed ones:
every `unmodelled` clause on an executed definition that names a mechanic the
engine owns must carry a written adjudication — `table`, with the reason, or
the id of the missing shape — and "partial" becomes a consequence of carrying
a debt adjudication rather than a hand-kept list. Fix the two stale notes the
audit found.

### Why now

`docs/architecture/whole-engine-audit-2026-09-13.md`, §3.5: 58 of the 82
executed spells carry `unmodelled` clauses and no guard reads them, so a rule
the engine should own can be filed as fiction with nobody noticing — the exact
failure the tracked guard was built to stop. It also decides what IE-001's
Invisibility and every future partial spell must say, and it changes what a
new definition (IE-002) has to satisfy, so it lands first.

### Current relevant architecture

- `spell-tracking.test.ts:316` `MECHANICAL_MARKERS`: thirteen regexes over
  SRD prose; `:384` `ADJUDICATED`: the per-spell, per-marker map of
  `{ table | shape }` with a note; `:489` `markersIn`; the population scanned
  is `TRACKED` (`:79–83`: `effects.length === 0`, no activation, no area
  trigger) and the text scanned is the spell's whole SRD paragraph.
- `coverage.test.ts:96` (a tracked spell has `unmodelled`), `:105` (some
  executed spell has none), `:126–135` (`PARTIAL_SPELLS` entries have
  `unmodelled` and may also be verified).
- `packages/engine/scripts/coverage.ts:162` `PARTIAL_SPELLS = ['spirit-guardians']`.
- `spell-catalogue.test.ts:353–364` asserts each executed spell's `unmodelled`
  reaches `unverified` at runtime.
- `CLAUDE.md`, "Tracked Is A Claim About The Cost, Not A Half-Finished
  Execution", is the rule this extends: `unmodelled` means fiction the engine
  should never decide, never debt.

### Required behaviour

1. For every executed definition (effects, activation or area trigger), for
   every `unmodelled` clause, scan **the clause's own text** for the
   mechanical markers (the SRD paragraph is the wrong text for an executed
   spell: its effects are executed; only the clauses are claims).
2. A clause that trips a marker needs an adjudication in the map keyed by
   spell and clause index (or clause text): `table` with a reason, or a named
   missing shape from the enumerated set the tracked guard already uses. A
   clause that trips nothing needs none.
3. Derive the partial set: a spell is partial if any of its clauses is
   adjudicated to a shape. Assert `PARTIAL_SPELLS` equals the derived set in
   both directions, so the hand list cannot drift; or replace the hand list
   with the derived one if the script can import the map cleanly (the
   builder decides, and says which).
4. Write the adjudications. Expect roughly 58 spells and 90 clauses; many
   are `table`. Ones the audit already read as debt: Chill Touch's healing
   ban, the "Advantage if you or your allies are fighting the target" clause
   on Charm Person, Charm Monster and the three Dominates, Harm's Hit Point
   maximum reduction, Guiding Bolt's next-attack Advantage, Black Tentacles',
   Grease's and Insect Plague's Difficult Terrain, Blur's Blindsight and
   Truesight exception. Each names its shape; the spell becomes partial.
5. Reword `unmodelled` prose only where a clause is wrong or stale: Arcane
   Lock and Continual Flame say Dispel Magic is not executable.
6. `COVERAGE.md` regenerated; the "Executed" counts may split into executed
   and partial as the script already supports.
7. `CLAUDE.md`'s "Tracked Is A Claim…" section gains a short paragraph: the
   guard now reads executed spells' clauses too, and partial is derived.

### Architecture constraints

- No engine code changes: no new shape, no effect edited, no test that
  exercises casting beyond what exists. This task writes adjudications and a
  guard.
- The enumerated set of missing-shape ids is extended only if a clause needs
  a shape no id names; each new id must be one the audit or `PROGRESS.md`
  already describes.
- An adjudication of `table` must say why the engine should never decide it;
  "not modelled" is not a reason.

### Acceptance criteria

1. The extended guard fails when an executed spell gains an `unmodelled`
   clause tripping a marker with no adjudication (mutation: add such a clause
   to one definition temporarily).
2. The guard fails when the hand list and the derived partial set disagree
   (mutation: remove Spirit Guardians from `PARTIAL_SPELLS`).
3. Every current clause is adjudicated; the report lists the count of
   `table` versus shape adjudications and every spell that became partial.
4. `COVERAGE.md` regenerated; the whole gauntlet passes.

### Tests and conformance

`spell-tracking.test.ts` (or a new `spell-honesty.test.ts` beside it, if the
file grows past reason — say which), `coverage.test.ts`, the coverage script.

### Dependencies

None.

### Likely file surface

`packages/engine/src/spell-tracking.test.ts`, `coverage.test.ts`,
`packages/engine/scripts/coverage.ts`, `spell-definitions.ts` (`unmodelled`
prose only), `COVERAGE.md`, `CLAUDE.md`.

### Out of scope

Building any missing shape; changing how tracked spells are scanned; touching
effects; the executed spells' SRD-paragraph markers (that is the tracked
guard's method, not this one).

### Known risks

- Adjudication is judgment: a clause filed `table` that is really debt is
  exactly the failure this prevents, so the reviewer reads every `table`
  reason.
- Volume: ninety clauses is a long afternoon; the cap is honesty, not speed.

## Completion digest

Arrived 2026-09-13, from the builder's last message. Sent back once (see the
architectural gate); the re-issued digest is appended below it when it arrives.

```
IE-004 — Completion digest
Approved architectural intent: Extend the honesty guard from the 46 tracked spells to the 82 executed ones — every `unmodelled` clause naming a mechanic the engine owns carries a written adjudication (`table` with a reason, or a named missing shape) — and make "partial" a consequence of carrying a debt adjudication rather than a hand-kept list.
Builder: COMPLETE
Worktree: C:\Users\justi\Code\QuestBarrel\ImpossibilityEngine\.claude\worktrees\agent-a4ac40741e133e8a8   Branch: worktree-agent-a4ac40741e133e8a8   Commit: 66b1d9f1e5ef59591752697eb06b0b27939c8f62   Rebased on main at: 3a8ab66271ff26218af02d9ac772ac497fdb329a
Opus review: PASS — rounds: 3
Tests: 5342 passing / 5342 total; new tests: 96 (one per executed spell plus 14 invariants), net +97 over the 5245 baseline; mutation run: four, each failing the guard and only the guard — (1) an unadjudicated "the target has Resistance to Bludgeoning damage while it is restrained" added to Black Tentacles, caught by name; (2) Spirit Guardians removed from `PARTIAL_SPELLS`, caught by the derived-set equality; (3) Black Tentacles' Difficult Terrain adjudication downgraded from its shape to `table`, which moves the derived set and is caught — a debt cannot be relabelled fiction without the published list changing; (4) Chill Touch's SRD quotation loosened by three words, caught by the quotation oracle.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS. Verified counts: 82 executed definitions, 58 carrying clauses, 103 clauses, 84 tripping a marker across 55 spells; 84 adjudications — 5 `table`, 79 shape over 27 enumerated shapes; 53 partial (55 adjudicated spells minus Cone of Cold and Moonbeam, whose clauses are all table). COVERAGE.md: Executed 82, of which partial 53, Verified 58.
Architectural deviations: three, each declared. (1) The guard lives in a new `spell-honesty.test.ts` with its own 27-shape `MISSING_SHAPES`, not in the tracked guard's three-id list — that list is documented as tracked-only, and merging them would let one population's "no unclaimed shape" guard pass on the other's claim; `speed-and-movement-modes` is deliberately the same string for the same gap. (2) `PARTIAL_SPELLS` stays a written list asserted against the derived set both ways rather than being replaced by it: `npm run coverage` runs outside vitest, so importing the suite would invert the dependency, and the brief's own mutation presumes the list exists. (3) `coverage.test.ts`'s "keeps partial and verified apart" is inverted to "lets a spell be driven end to end and still carry a debt" — they are two axes once partial is derived, and Web is the discriminating case.
Foundational primitives touched: none. `spell-definitions.ts` changed two `unmodelled` string literals only, not the type declarations at its head.
New runtime special cases: none. No engine code changed.
Files outside the brief's surface: none.
Out-of-scope findings (not acted on): (a) `spell-tracking.test.ts:83` still restates the executed predicate as its complement — out of scope ("changing how tracked spells are scanned"), and it currently has all three arms. (b) `coverage.ts` carries an orphaned docstring above `PARTIAL_SPELLS` that documents `VERIFIED_SPELLS`. (c) The marker set has no word for *object*, so Dispel Magic's "one creature, object, or magical effect" clause goes unadjudicated — a real engine limitation inside the guard's stated floor. (d) The audit's §3.5 pointer to Continual Flame is wrong: its clauses make no Dispel Magic claim, so only Arcane Lock was stale. (e) Builder sessions share one scratchpad path — the IE-003 builder overwrote a file of mine mid-task; unique filenames are the workaround.
Unresolved concerns: none.
Reviewer confidence: high
Recommendation: READY FOR ARCHITECTURAL GATE

IE-004 — Independent review
Verdict: PASS
Commit reviewed: 66b1d9f1e5ef59591752697eb06b0b27939c8f62   Gauntlet re-run: typecheck ✓ lint ✓ test 5342/5342 coverage diff ✓
Brief compliance: met. (1) clauses are scanned, not the SRD paragraph; (2) every marker-tripping clause carries a keyed adjudication — `table` with a reason or one of 27 enumerated shapes; (3) the hand list was kept and asserted against the derived set in both directions, and the builder says why (the report script runs outside vitest, so importing the suite would invert the dependency); (4) 84 adjudications over 55 spells, every audit-named debt shape-adjudicated; (5) Arcane Lock reworded, Continual Flame correctly untouched because its clause never made the stale claim, Sunbeam reworded as equally stale; (6) COVERAGE.md regenerated and clean against the script; (7) CLAUDE.md gains the section and corrects the PARTIAL_SPELLS paragraph.
Tests: `spell-honesty.test.ts` (96 tests: one per executed spell plus 14 invariants). The per-spell case asserts exactly one adjudication per mechanical clause and reads `SPELL_DEFINITIONS` live, so a new unadjudicated clause bites; the reverse case asserts each entry matches exactly one still-mechanical clause, so a stale or reworded clause bites; substring collision is caught from the other side. `PARTIAL_SPELLS` is asserted equal to the derived set, so removing Spirit Guardians fails. Fixtures discriminate: the map is keyed by clause phrase rather than index, the partial derivation is proved non-vacuous against the two table-only spells, `both` is asserted to contain `web` by name, and the marker list is pinned with the audit's own six sentences plus the "leaves the fiction alone" direction. `note.length > 60` is the one weak assertion and is honest about being a floor. Population comes from the single exported `isExecuted`, not a hand list.
Regression risk: none. No engine behaviour changed — the only non-test, non-doc edit is two `unmodelled` strings. golden-log.json, docs/dev, PROGRESS.md and packages/srd/raw are untouched; replay, the idempotency sweep and the invariants sweep are unaffected.
Conformance: PASS. COVERAGE.md regenerated and byte-clean; Executed stays 82 with partial reported as a second axis rather than subtracted; the three clause-carrying spells left unadjudicated are honest fiction or the acknowledged marker floor; every `unmodelled` claim I read is fiction or a named shape, and every shape cites CLAUDE.md, PROGRESS.md, the audit or a definition's own clause — asserted, not promised.
Scope creep: none material. `spirit-guardians` added to VERIFIED_SPELLS (headline Verified 57 → 58) and Sunbeam's clause reworded are both outside the brief's letter; each is a consequence of the change and is honest — see deviations above.
Architectural violations: none. No spell-name special case reaches the runtime; nothing stored that should be derived — partial went the other way, from a hand list to a derived consequence.
Hard-coded or test-specific fixes: none.
Accidental coupling: `spell-honesty.test.ts` imports `EXECUTED_SPELL_IDS` and `PARTIAL_SPELLS` from `scripts/coverage.ts`; `coverage.test.ts` already imported that module, and centralising `isExecuted` removes two drifting copies. The remaining copy in `spell-tracking.test.ts:83` is pre-existing and out of scope.
Foundational primitives touched: none. `spell-definitions.ts` changed only two `unmodelled` string literals, not the type declarations at its head.
New runtime special cases: none.
Defects for the builder: none
Escalation reason: none
Confidence: high
Recommendation: READY FOR ARCHITECTURAL GATE
```

Re-issued 2026-09-13, after the rework the gate returned:

```
IE-004 — Completion digest
Approved architectural intent: Extend the honesty guard from the 46 tracked spells to the 82 executed ones — every `unmodelled` clause naming a mechanic the engine owns carries a written adjudication (`table` with a reason, or a named missing shape) — and make "partial" a consequence of carrying a debt adjudication rather than a hand-kept list.
Builder: COMPLETE
Worktree: C:\Users\justi\Code\QuestBarrel\ImpossibilityEngine\.claude\worktrees\agent-a4ac40741e133e8a8   Branch: worktree-agent-a4ac40741e133e8a8   Commit: 20f4dcf9f8431aa2fc716f12c4df5d94f763cc4b   Rebased on main at: 31423b48f115db1c1d7a1a70aa7523e296c6ae8b
Opus review: PASS — rounds: 5 (DEFECTS, DEFECTS, PASS, DEFECTS after the gate returned the CLAUDE.md paragraph, PASS)
Tests: 5343 passing / 5343 total; new tests: 97 in `spell-honesty.test.ts` (82 per-spell cases plus 15 rules); mutation run: five, each failing the guard and only the guard — (1) an unadjudicated "the target has Resistance to Bludgeoning damage while it is restrained" added to Black Tentacles; (2) Spirit Guardians removed from `PARTIAL_SPELLS`; (3) Black Tentacles' Difficult Terrain adjudication downgraded from its shape to `table`, which moves the derived set and is caught — a debt cannot be relabelled fiction without the published list changing; (4) Chill Touch's SRD quotation loosened by three words, caught by the quotation oracle naming the spell; (5) the new Darkness pin aimed at a spell that does compile, which fails naming the consequence.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS. Verified counts: 82 executed definitions, 58 carrying clauses, 103 clauses, 84 tripping a marker across 55 spells; 84 adjudications — 5 `table`, 79 shape over 27 declared shapes, all 27 claimed; 53 partial. COVERAGE.md: Executed 82, of which partial 53, Verified 58.
Architectural deviations: the three already accepted at the gate — the separate 27-shape enumeration for the executed bucket, the hand list asserted against the derived set in both directions, and partial/verified as two axes with Spirit Guardians in `VERIFIED_SPELLS`. No new ones.
Foundational primitives touched: none. `spell-definitions.ts` changed two `unmodelled` string literals only.
New runtime special cases: none. No engine code changed.
Files outside the brief's surface: none. `docs/dev/QUEUE.md` and the two task files showed as modified in the worktree after main advanced; they were restored from main, not committed.
Out-of-scope findings (not acted on): (a) `spell-tracking.test.ts:83` still restates the executed predicate as its complement — out of scope, and it currently has all three arms. (b) `coverage.ts` carries an orphaned docstring above `PARTIAL_SPELLS` that documents `VERIFIED_SPELLS`. (c) The marker set has no word for *object*, so Dispel Magic's "one creature, object, or magical effect" clause — a casting on nobody being reachable by no dispel — goes unadjudicated inside the guard's stated floor. (d) The audit's §3.5 pointer to Continual Flame is wrong: only Arcane Lock carried the stale Dispel Magic claim. (e) Builder sessions share one scratchpad path; the IE-003 builder overwrote a file of mine mid-task.
Unresolved concerns: none.
Reviewer confidence: high
Recommendation: READY FOR ARCHITECTURAL GATE

IE-004 — Independent review
Verdict: PASS
Commit reviewed: 20f4dcf9f8431aa2fc716f12c4df5d94f763cc4b   Gauntlet re-run: typecheck ✓ lint ✓ test 5343/5343 coverage diff ✓
Brief compliance: met, and the gate's returned defect is discharged. (1) the clause is the scanned text, not the SRD paragraph; (2) every marker-tripping clause carries one adjudication keyed by clause phrase — `table` with a reason, or one of 27 enumerated shapes; (3) `PARTIAL_SPELLS` kept and asserted equal to the derived set both ways, with the reason the brief anticipated; (4) 84 adjudications over 55 spells, every audit-named debt shape-adjudicated; (5) Arcane Lock reworded, Continual Flame correctly untouched (its clause never made the stale claim), Sunbeam reworded as equally stale; (6) COVERAGE.md regenerated, Executed 82 with partial 53 as a second axis; (7) CLAUDE.md gains the new section and the contradicting paragraph in "Coverage needed a third word" is rewritten.
Tests: `spell-honesty.test.ts`, 96 tests. Per-spell: exactly one adjudication per mechanical clause, read live off `SPELL_DEFINITIONS`, so a new unadjudicated clause bites; reverse: each entry matches exactly one still-mechanical clause, so a reworded or stale clause bites, and substring collisions fail from both sides. `PARTIAL_SPELLS` equality bites on removing Spirit Guardians and on downgrading a shape to `table` (Black Tentacles carries exactly one entry, so that mutation moves the derived set). The SRD-quotation oracle holds quotes against that spell's own paragraph and caught four wrong quotations during review. Fixtures discriminate: keyed by phrase not index, non-vacuity proved against the two table-only spells, `both` asserted to contain `web` by name, markers pinned with the audit's own six sentences plus the "leaves the fiction alone" direction. Population comes from the single exported `isExecuted`, which removed a copy that had lost the `areaTrigger` arm.
Regression risk: none. No engine behaviour changed; the only non-test, non-doc edit is two `unmodelled` string literals. golden-log.json, docs/dev, PROGRESS.md and packages/srd/raw untouched; replay, the idempotency sweep and the invariants sweep unaffected; `spell-tracking.test.ts` not touched, as the brief required.
Conformance: PASS. COVERAGE.md byte-clean against the script. Every `unmodelled` claim I read is either fiction the engine should never decide or a named shape citing CLAUDE.md, PROGRESS.md, the audit or the definition's own clause — three citations verified verbatim by hand.
Scope creep: none material. `spirit-guardians` added to VERIFIED_SPELLS (57 → 58) and Sunbeam's clause reworded are consequences of the change and honest; both were declared and accepted at the gate. The rework added one test beyond the paragraph the gate asked for (spell-honesty.test.ts:937) — inside the brief's surface, and it makes a `table` claim checkable rather than trusted.
Architectural violations: none. No spell-name special case reaches the runtime; partial moved from a stored hand list to a derived consequence, which is the right direction.
Hard-coded or test-specific fixes: none.
Accidental coupling: `spell-honesty.test.ts` imports `EXECUTED_SPELL_IDS` and `PARTIAL_SPELLS` from `scripts/coverage.ts`; `coverage.test.ts` already imported that module, and centralising `isExecuted` removed two drifting copies. The third copy in `spell-tracking.test.ts:83` is pre-existing and out of scope.
Foundational primitives touched: none. `spell-definitions.ts` changed two `unmodelled` string literals only, not the type declarations at its head.
New runtime special cases: none.
Defects for the builder: none
Escalation reason: none
Confidence: high
Recommendation: READY FOR ARCHITECTURAL GATE
```

## Architectural gate

2026-09-13 — **inspected, not lightweight.** Two risk signals: the digest
declares three architectural deviations, and the review took three rounds.

Read: `git diff main...worktree-agent-a4ac40741e133e8a8` in full for
`scripts/coverage.ts`, `coverage.test.ts`, `spell-definitions.ts`,
`COVERAGE.md` and `CLAUDE.md`; and in `spell-honesty.test.ts` the marker set,
the 27-shape enumeration with its sources, all five `table` adjudications,
eight shape adjudications (Blur, Chill Touch, Guidance, Guiding Bolt, Harm,
Mage Armor, Shield, Web) and every invariant test.

- **Deviation 1 — a separate 27-shape enumeration, not the tracked guard's
  list: accepted.** The tracked guard asserts "no shape sits unclaimed" over
  its own population, so one shared list would fail that for whichever bucket
  stopped needing a shape first. Every id says where the repository already
  described the gap, a test holds that, and the one id both guards need is
  deliberately the same string. Two shape vocabularies is a thing for the
  next whole-engine audit to weigh, not a defect now.
- **Deviation 2 — the hand list asserted against the derived set both ways:
  not a deviation.** It is the brief's first option, taken for the reason the
  brief anticipated: the report generator runs outside vitest and cannot
  import the suite.
- **Deviation 3 — partial and verified as two axes, Spirit Guardians added to
  `VERIFIED_SPELLS`: accepted.** Fifty-three partial spells cannot be
  described by one state without misreporting either the tests or the debts;
  Web is the discriminating case and the test names it.
- The five `table` reasons are genuine fiction (a corpse's appearance, water
  the world does not hold, a form the engine never held, a Darkness casting
  that does not exist, whether anyone lights the webs). The spot-checked
  shapes fit their clauses. The sourcing check and the SRD-quotation oracle
  are assertions; the oracle caught four wrong quotations during review,
  which is what the three rounds were.

**Found: one defect, documentation only.** `CLAUDE.md`, "Coverage needed a
third word" (branch line 2671), still opens "`verified` claims a spell is
complete and driven ... Spirit Guardians is neither", one paragraph above
this commit's own edit saying partial is derived and Spirit Guardians has
fifty-two companions, and beside a new section saying the two are different
axes. The second-highest source of truth contradicts itself inside one
section. **Sent back as `CHANGES_REQUIRED`** for that paragraph: fold into the
one commit, gauntlet re-run, one reviewer round, fresh digest.

Follow-ups for the architect, from the digest's out-of-scope findings: the
audit's §3.5 pointer to Continual Flame was wrong (only Arcane Lock was
stale; Sunbeam was, and is fixed here); builders share one scratchpad path,
so `qb-builder.md` should tell them to use unique filenames; the marker set
has no word for *object*, a stated floor.

**Re-issued digest, 2026-09-13 — lightweight PASS.** The returned paragraph
is rewritten and no sentence in the branch's `CLAUDE.md` reads verified as
complete any more (checked by grep at the gate, since it was the gate's own
finding); the reviewer passed the rework; no new deviation, no primitive, no
special case. The rework added one test inside the surface that makes a
`table` claim checkable rather than trusted, which is the guard's own
direction. Proceeding to the owner merge gate.

**Merge order.** Both batch-1 branches are now at Gate 3 and both sit one or
two docs-only bookkeeping commits behind `main`, because every gate record
moves it. Drift consisting solely of commits under `docs/dev/` — files a
builder is forbidden to touch — cannot conflict with a builder's branch, so
the architect rebases it at merge time and runs the whole gauntlet on `main`
before pushing; any other drift, or any conflict, goes back to the builder
as the procedure says. This one, with the smaller surface and no engine code,
is recommended first; IE-003 then rebases over disjoint `CLAUDE.md` hunks.

## Merge record

2026-09-13 — **merged.** Owner: "MERGE BOTH". Order: first of the two, the
smaller surface. `main` had moved by three docs-only bookkeeping commits
(`docs/dev/` only, which a builder may not touch), so the rebase in the
builder's worktree could not conflict and did not. Fast-forward
`cefe64d..0536a2b`. Whole gauntlet on `main`: typecheck ✓ lint ✓ tests
5343/5343 ✓ coverage report byte-identical ✓. Pushed to `origin/main`;
worktree and branch retired. Commit `0536a2b`.
