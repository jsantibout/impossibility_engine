# IE-010 — Outcome riders, and the two `on` rules made one

state: DONE
lane: mechanism
tranche: 4
parallel-safe: NO beside any task touching the `SpellEffect` union or `commands/spell-resolution.ts`; YES beside `creation.ts`, a new command module, and conformance work
depends-on: IE-001, IE-007
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 4" (tranche 4 authority; 13/13 conditions green)

## Brief

### Objective

Build the outcome-rider vocabulary Fable designed — leaf riders in fixed named
slots on the three kinds that produce an outcome — and, in the same file,
close the correctness bug the fourth audit found beside it: a Range: Self
casting writes `on: [casterId]` and discards `held`, so a spell that blinds
somebody is not recorded as being on them.

### Why now

`docs/architecture/outcome-scoped-child-effects-2026-09-13.md` is the design,
decided at the owner's chartered gate: **APPROVE, narrowed**. The fourth
whole-engine audit (`whole-engine-audit-fourth-2026-09-13.md`, §5) puts it
first in tranche 4 rather than tranche 5, because its sequencing constraint —
after IE-007 — is discharged, and because it owns the file where two other
findings live. One task closes a design decision, a shipped wrong answer, a
zero-user format member and three mis-filed adjudications.

### Current relevant architecture

Read the design record first; it is the specification and this brief does not
repeat it. The pointers that matter:

- `ConditionRider` and the twelve-member `SpellEffect` union at the top of
  `spell-definitions.ts`; `conditionRiderOf` and `riderDurations` in its
  helper region.
- `riderOptions` (`commands/spell-resolution.ts:725`) — the single
  option-builder IE-001 extracted, and the proof that a rider is a leaf:
  nothing in it rolls, targets or branches.
- The three host branches at `:963`, `:1292`, `:1376`, inside `resolveEffects`
  — **914 lines, the largest function in the engine** (audit §3.8).
- `spell-resolution.ts:1631` — the caster branch of the `on` write.
- `commands/turns.ts:488` and `events.ts:2475` (`alsoOn`) for the other half
  of the `on` rule.

### Required behaviour

1. **The vocabulary exactly as the design record specifies** — `conditions`
   (plural, replacing `condition`), `modifiers` (the new `ModifierRider`:
   `bonus | mode`), `delayed` and `plus` unchanged, `repeats` moved into
   `ConditionRider` under a host rule, hosts `attack` / `save-damage` /
   `save`, one `applyRiders` replacing the three inline blocks. The two
   one-consumer transcriptions — `onMiss: 'half'` on `attack` (Acid Arrow) and
   `lasts: { seconds }` (Sunburst) — **are in scope**; the owner did not drop
   them, and each closes a partial spell.
2. **The invariant, enforced in all three places the record names**: the type
   system, a `checkShape` denylist, and a sweep walking every definition's
   `effects` as JSON asserting no nested object below an effect carries a
   `kind` in `EFFECT_KINDS`. A rider never rolls a d20, names no target,
   spends nothing, opens no window.
3. **`on` gets one rule.** The caster branch at `:1631` unions `held` instead
   of discarding it. **Reproduce first**: cast Sunbeam (Range: Self, Line,
   blinding rider), assert a Dispel Magic aimed at the *blinded creature*
   finds the casting — that test fails on `main` today.
4. **`roll-mode.save` is removed** — zero catalogue users, and the `modifiers`
   rider on a `save` host is the same sentence with the roll shared.
5. **Three adjudications are re-filed** in `spell-honesty.test.ts`: Acid Arrow
   to the new `onMiss` (it is a miss branch on the host's damage, not a
   child); Disintegrate away from this shape (an outcome of the spell's own
   damage, one consumer — `table` or a new shape id, with the reason);
   Hypnotic Pattern's "Speed 0" to the Speed shape it actually needs. The
   shape id `outcome-scoped-child-effects` **is renamed `outcome-riders`**,
   because it now names a design that was rejected.

### Architecture constraints

- The design record is binding. A deviation from it is `ARCHITECTURE_BLOCKED`,
  not a judgement call — it was decided at an owner-chartered gate.
- **No `onFail: SpellEffect[]`, no rider that rolls, no predicate, expression
  or callback, ever.**
- Do not change `events.ts`, the reducer, `EffectTarget`, `OngoingSpell`, or
  any existing definition's *meaning*. Both frozen logs must fold unchanged.
- `save` keeps its flat spelling; `conditionRiderOf` is the view.
- Splitting `resolveEffects` is **not** this task. `applyRiders` is the
  reduction the record asks for; the per-kind branches are a consequence for
  later, not a refactor to start now.

### Acceptance criteria

1. A failing test first for item 3, named in the digest.
2. Every rider member has its consumer defined and driven: Hideous Laughter
   and Hypnotic Pattern for `conditions`; Phantasmal Killer for `modifiers`;
   Sunburst for `repeats` on a `save-damage` host and for `lasts: { seconds }`;
   Acid Arrow for `onMiss`.
3. The recursion sweep exists and a mutation that nests an effect inside a
   rider fails it.
4. `PARTIAL_SPELLS` shrinks by the spells the record says are made whole
   (Acid Arrow, Sunburst) and by nothing else; `COVERAGE.md` regenerated.
5. Both frozen logs fold; the whole gauntlet passes.

### Tests and conformance

`spell-schema.test.ts` for the validator and the denylist; the recursion sweep
beside it; new cases in the spell test files for each consumer;
`spell-honesty.test.ts` for the re-filings. The catalogue, oracle and honesty
guards run unchanged and must pass.

### Dependencies

IE-001 (`7592efe`) and IE-007 (`b80e0d5`), both merged.

### Likely file surface

`packages/engine/src/spell-definitions.ts` (types and the five definitions
renamed `condition` → `conditions`), `commands/spell-resolution.ts`,
`spell-schema.ts`, `spell-honesty.test.ts`, `spell-schema.test.ts`, one or two
spell test files, `packages/engine/scripts/coverage.ts`, `COVERAGE.md`,
`CLAUDE.md`.

### Out of scope

Splitting `resolveEffects`; the `settleAreaEffects` record read (IE-013);
condition removal, granted Resistance, Speed, creature-type outcomes (later
tranches); anything in `events.ts`.

### Known risks

- The largest function in the engine is being edited by the task that also
  fixes a correctness bug in it. Do item 3 first, with its reproduction, so
  the bug fix is not entangled with the vocabulary change.
- Five definitions change shape. The catalogue test drives every one.

## Completion digest

```
IE-010 — Completion digest
Approved architectural intent: Build Fable's outcome-rider vocabulary — leaf riders in fixed named slots on the three kinds that produce an outcome, with the branch fixed by the host and the invariant that a rider never rolls a d20, names no target, spends nothing and opens no window — and close the `on` correctness bug in the same file.
Builder: COMPLETE
Worktree: .claude/worktrees/agent-a0cd69c068a23bdac   Branch: worktree-agent-a0cd69c068a23bdac   Commit: c548848   Rebased on main at: not rebased — built on 4b22823, as briefed
Opus review: PASS — rounds: 1
Tests: 5630 passing / 5630 total; new tests: 33 (16 in the new `outcome-riders.test.ts`, 13 in `spell-schema.test.ts`, 3 in `delayed-damage.test.ts`, 1 in `ongoing-spells.test.ts`); mutation run: seven, each failing the test that should catch it — the `checkShape` recursion denylist disabled (3 schema tests fail); the `repeats`-host rule disabled (1); `applyRiders` applying only the first condition rider (3); `onMiss` dealing full damage instead of half (1); only the first modifier rider applied (3); `riderDuration` ignoring `lasts: { seconds }` (5); and the `on` fix reverted to `[casterId]` (the item-3 reproduction).
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — `COVERAGE.md` regenerated and reproduces clean against the commit; `PARTIAL_SPELLS` loses `acid-arrow` and `sunburst` and nothing else, and gains `hideous-laughter` (newly defined, real unmodelled clauses); both frozen logs fold unchanged.
Architectural deviations: one, declared. **The shape id `outcome-scoped-child-effects` is removed rather than renamed to `outcome-riders`.** Brief item 5 says "renamed", but item 5 also re-files Disintegrate off that shape, and building the shape deletes the Acid Arrow, Sunburst and Phantasmal Killer adjudications — leaving zero claimants. `spell-honesty.test.ts`'s own guard ("keeps no shape nothing is blocked on") fails on any unclaimed shape, so the rename was unexecutable as written. Disintegrate is re-filed to a new `an-outcome-of-a-spells-own-damage`, which the brief explicitly permits and which criterion 4 requires, since `table` would have dropped Disintegrate out of `PARTIAL_SPELLS`.
Foundational primitives touched: the `SpellEffect` union and the rider types at the top of `spell-definitions.ts`; `conditionRiderOf` (now returns a list) and `riderDurations`; `resolveEffects`'s three host branches and `riderOptions` in `commands/spell-resolution.ts`; `checkShape`/`checkEffect` in `spell-schema.ts`; `SpellTargetOutcome.condition` → `conditions` in `commands/targeting.ts`; the `OngoingSpell.on` write site (the record type is unchanged — only the caster branch's rule).
New runtime special cases: none. `applyRiders` contains no branch at all, which is what makes "the slot name is the branch" structural rather than validated.
Files outside the brief's surface: two, both consequences of the brief's own changes — `commands/targeting.ts` (`SpellTargetOutcome.condition` → `conditions`, which the design record §F puts in scope) and five test files each a mechanical follow-on.
Out-of-scope findings (not acted on): three.
  1. **`npm test` rewrites a tracked file.** `packages/engine/scripts/coverage.ts` calls `writeFileSync('COVERAGE.md', …)` at module top level, and `coverage.test.ts` and `spell-honesty.test.ts` import it — so running the suite regenerates `COVERAGE.md` as a side effect. Pre-existing; it makes `git diff --exit-code COVERAGE.md` pass for a reason other than the one the gauntlet intends.
  2. **`acid-arrow` is driven end to end by `delayed-damage.test.ts` and is not in `VERIFIED_SPELLS`.** Pre-existing understatement.
  3. **The cross-slot rider order is unpinnable today.** No castable definition carries two slots, and a homebrew one that did would validate and still not be castable, because `definitionFor` reads the catalogue rather than state.
Unresolved concerns: one, an interpretation resolved and flagged — **the design record is internally inconsistent about whether a `save` host may carry more than one condition** (§A/§B/§I against §H's parenthesis). Built the reading under which §A, §B, §I and acceptance criterion 2 are simultaneously true: `save` keeps its flat first rider and gains a `conditions` list for the rest, `conditionRiderOf` returning `[flat, ...conditions]`.
  Also: `spell-schema.ts` is named in this brief's file surface *and* was assigned to IE-013. Expect a conflict at integration.
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

The reviewer's verdict was `PASS` at high confidence, first round, with one
non-blocking note — a test docstring claiming to pin an order no castable
definition can produce. The builder acted on it after the review; that delta
is `d32d785..c548848`, two files, prose and test titles only, and it makes the
claim narrower rather than wider. Inspected and accepted.

## Risk gate

The tranche's largest task, and four things needed deciding rather than
reading.

**1 — The declared deviation is ratified.** Brief item 5 said to *rename*
`outcome-scoped-child-effects` to `outcome-riders`; the same item re-files
Disintegrate off that shape, and building the vocabulary deletes the Acid
Arrow, Sunburst and Phantasmal Killer adjudications — so the renamed shape
would have had **no claimants**, and `spell-honesty.test.ts`'s own guard
refuses a shape nothing is blocked on. **The instruction was unexecutable as
written**, which is the foreman's error and not the builder's. Removing the
shape and re-filing Disintegrate to a new `an-outcome-of-a-spells-own-damage`
is what item 5 permits in its own words ("`table` or a new shape id, with the
reason"), and `table` was ruled out by criterion 4, which requires Disintegrate
to stay partial. The reviewer reached the same reading independently. GREEN.

**2 — The design record's ambiguity is resolved in the builder's favour, and
the record is corrected.** §A, §B and §I put a `conditions` list on a `save`
host; §H's parenthesis says `conditionRiderOf` returns a list "(`save` and
`condition` yield one)". Checked rather than arbitrated: §B's two plural
consumers are **Hideous Laughter and Hypnotic Pattern**, and both are
`save`-hosted spells with no damage (`spells.md:3179`, `:3246`). Under §H's
literal reading the `conditions` member therefore has **zero consumers** — in
the section whose entire job is to justify a member by naming them, and in a
repository that had just spent an audit finding on zero-consumer members.
That reading is self-defeating; the builder's is the only self-consistent one.

This is **not** a silent overturning of a Fable decision and did not need to
go back to Fable: it is an internal contradiction in the record, the builder
declared it rather than resolving it quietly, and only one reading leaves the
design coherent. The record now carries a foreman's correction at §H saying
so, so the next reader does not re-derive it.

**3 — The `spell-schema.ts` collision is the foreman's independence-check
error.** IE-010's brief named that file in its surface and the launch message
assigned it to IE-013. Both edit it. The consequence is a real conflict at
integration rather than a design problem, and the merge order already had
IE-013 first, so IE-010 rebases over it. Recorded as an error in the check,
not in the work.

**4 — One finding outranks the task that produced it.** `coverage.ts` calls
`writeFileSync('COVERAGE.md', …)` at module top level, and two test files
import it — so **`npm test` rewrites a tracked file**, and the gauntlet's
`git diff --exit-code COVERAGE.md` step passes because the suite has just
regenerated it rather than because the committed file was already right. The
check has been weaker than it reads for as long as that import has existed.
Pre-existing, out of this brief's scope, and queued.

Nothing else signalled: no new event type, no reducer or fold change, no
special case, both frozen logs untouched, reviewer PASS at the first round.

GREEN. **Merge held behind IE-013**, per the tranche's stated order and now
also because of finding 3.


## Merge record

Merged to `main` as `35ad5e3`, fast-forward, pushed. Worktree retired.
Executed 86 → **87**, verified 62 → **64**, partial 54 → **53**. 6,085 tests.

**The vocabulary is Fable's, and the invariant is enforced three ways** — the
type system, a `checkShape` denylist, and a sweep walking every definition's
`effects` as JSON refusing an effect `kind` nested below an effect. A rider
never rolls a d20, names a target, spends anything or opens a window.

**`on` has one rule.** A Range: Self casting used to write `on: [casterId]`
and discard `held`, so Sunbeam blinded a creature and a Dispel Magic aimed at
that creature found nothing — while the same rider landed by an area trigger a
round later would have been found. The reproduction was written first and
failed on `main`.

### The integration, which is the part worth reading

This task took **four review passes and two returns**, and none of it was the
builder's fault.

1. **The first PASS was at `c548848`, before IE-013 merged.** Then IE-013
   restructured `spell-schema.ts` — **a file the foreman's brief listed in
   IE-010's surface while the launch message assigned it to IE-013** — and the
   rebase raised seven conflicts, five in that file. Both tasks had rewritten
   `checkConditionRider` in different and both-wanted directions, which is a
   decision about the code rather than about history, so it went back to the
   builder with the rebase paused in its worktree.
2. **The builder found that IE-013's `grant_without_lifetime` and its own
   `rider_outlives_nothing` were the same rule, written independently**, kept
   the broader one, deleted its own, and extended `grantCarried` to see the
   rider vocabulary. It declared that as a combination with a loser rather
   than resolving it silently.
3. **Condition 12 then paid for itself.** The earlier PASS rested on a
   `spell-schema.ts` that no longer existed, so the combination went to a
   re-review — which proved the consolidation sound (*old fires ⟹ new fires*,
   with three more grant kinds caught on top) and found that **the loop
   conversion had dropped a null guard**: `parseSpellDefinition` threw a
   `TypeError` where `main` returned `err('unknown_condition')`. **6,079 tests
   passed over that.** The existing test for that exact input set
   `durationSeconds: 60`, so it drove only the branch that cannot reach the
   bug — while its own docstring carried the sentence the bug broke.
4. **The fix went past the two defects to the rule behind them.** The builder
   found a third unreadable shape neither the reviewer nor the foreman had
   named — a bare-string rider, which reached `String(rider.name)` without
   throwing and emitted a *spurious* second problem — and generalised: four
   unreadable shapes × four carriers × both lifetimes.
5. **The confirmation pass verified rather than read.** It re-ran its own two
   reproductions, temporarily swapped the old module in to check the
   bare-string claim against `408a431`, and **built a discriminating fixture
   for the guard order** — an unreadable first rider must not mask a bad
   readable second — proving `continue` rather than `return null` is doing the
   work.

**A second, unplanned handover fired on the way.** IE-013 exempted
`SpellEffect.onSuccess='end-casting'` as *"built and driven, but no definition
writes it"*; this task's Hideous Laughter **writes it**, and IE-013's zero-user
sweep refused the stale exemption on the rebase — hours after the sweep landed.
The exemption is gone and its pin now asserts both halves: a definition writes
the value, and the engine still resolves it.

The thirteen conditions: 1 inside the brief, one ratified deviation ·
2 COMPLETE · 3 PASS at high, on the confirmation pass · 4 both defects fixed
and re-verified by the reviewer that raised them · 5 gauntlet in the worktree ✓
· 6 `COVERAGE.md` byte-clean; `PARTIAL_SPELLS` loses Acid Arrow and Sunburst
and gains Hideous Laughter, all accounted for · 7 no blocker · 8 one deviation,
ratified: the shape id **removed** rather than renamed, because renaming it
while re-filing its last claimant leaves a shape nothing is blocked on, which
the honesty guard refuses · 9 no event type, reducer or fold change · 10 no
scope expansion · 11 the conflicts were resolved by the builder, not by the
foreman in a rebase · 12 **this is the condition that caught the regression** ·
13 risk gate GREEN.
