# IE-001 — A condition applied with no saving throw

state: DONE
lane: mechanism
tranche: 3
parallel-safe: CONDITIONAL — YES beside a mechanism task outside spell resolution (IE-008 is `creation.ts`) and beside conformance; NO beside IE-007 or anything else in `commands/spell-resolution.ts` or the `SpellEffect` union
depends-on: IE-004, IE-005
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 3"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 3" (tranche 3 authority; 13/13 conditions green)

## Re-brief note (2026-09-13, after tranche 2)

**Both dependencies are merged and the audit note's three conditions are
now met.** What changed in the repository, checked rather than assumed:

- **The three rider blocks are all in one module.** `applySpellEffect` is
  `commands/casting.ts:711`; its three call sites are
  `commands/spell-resolution.ts:927`, `:1251` and `:1327` — the `attack`,
  `save-damage` and `save` riders. The shared `ConditionRider` type and its
  option-building helper therefore land in one 1,628-line module rather than
  across a 10,000-line file, which is what the audit note was waiting for.
- **The honesty guard is on `main`** (`0536a2b`), and `PARTIAL_SPELLS` is
  derived from shape adjudications rather than kept by hand — so
  Invisibility's early-end clause must be adjudicated to a named missing
  shape, and the acceptance criterion that says it lands in `PARTIAL_SPELLS`
  is now checkable rather than asserted.
- **The demand is measured.** IE-002 read all 211 undefined SRD spells one at
  a time and named this shape as the blocker for Invisibility and Greater
  Invisibility (`de45194`, and `CLAUDE.md`'s drained-shapes bullet). The
  brief's own "eighteen spells naming a condition with no saving throw" is
  the older, looser estimate made by prose scan; **IE-002's list is the
  better evidence and the builder should read it first.** Expect fewer than
  eighteen and say which, with the clause that blocks each.

One pointer in the brief below is stale and is corrected here rather than
rewritten in place: where it says the resolution branch is
`commands.ts:9370-9430`, read `commands/spell-resolution.ts` around the third
`applySpellEffect` call site (`:1327`).

## Audit note (2026-09-13)

Presented at Gate 1 before the third whole-engine audit and withdrawn by it
(`docs/architecture/whole-engine-audit-2026-09-13.md`, §3.1 and §4). Three
findings change the brief below, and it is to be re-briefed on those terms
before it is presented again:

- **One `ConditionRider`, not a fourth spelling.** The union already spells a
  condition rider three ways — on `attack`, on `save-damage`, and on `save` —
  with three near-identical resolution blocks (`commands.ts:8999`, `:9323`,
  `:9399`). The new kind is the fourth consumer of one shared rider type
  `{ name, lasts?, check?, outlivesCasting? }` and one option-building
  helper, and the three existing riders adopt it in the same task. The
  outcome-scoped child vocabulary stays deferred; this is one rider.
- **After the honesty guard (IE-004).** Invisibility's early-end clause is a
  debt adjudication, and partial is derived from it; the brief's claim about
  `PARTIAL_SPELLS` is checkable only once that guard exists.
- **After the split (IE-005).** It lands in the spell-resolution module,
  not in a 10,000-line file another task may be in.

The brief as it stood follows, for the record.

## Brief

### Objective

Add the one `SpellEffect` kind the engine has been ranking as the cheapest
missing shape: a condition a spell imposes **with no saving throw**. Resolve
it through the same `applySpellEffect` call that every failed `save` already
ends at, validate it in `spell-schema.ts`, count it in `coverage.ts`, and
prove it with Greater Invisibility end to end. Then define every parsed SRD
spell whose only mechanical clause is this one, and name — in the report, not
in code — each candidate that turns out to need something else.

### Why now

`PROGRESS.md` ranks it first on the recalculated map ("unchanged, and still
the cheapest thing on the list": nine spells, very low risk). The definitions
pass deferred outcome-scoped child effects until "the next two families"
produced the evidence for that vocabulary, and named this family as one of the
two (`docs/architecture/spell-definitions-as-validated-data-2026-09-13.md`,
§5). Building it as a plain member is therefore both the plan and the
evidence-gathering step, and it lands Invisibility and Greater Invisibility,
whose mechanical consequences `conditions.ts` already computes.

### Current relevant architecture

- The union: `packages/engine/src/spell-definitions.ts:192` (`SpellEffect`).
  The nearest member is `save` (`:398-455`): `ability`, `condition`,
  optional `repeats`, `lasts` (a `RiderDuration`, `:87`), `check`
  (`SpellCheck`, `:116`) and `outlivesCasting`. Read its docstrings; they are
  the transcription rules this kind inherits.
- Resolution: `packages/engine/src/commands.ts` around `:9370-9430`, the
  `effect.kind === 'save'` branch of `resolveEffects`. On a failed save it
  calls `applySpellEffect(current, target, effect.condition, casterId, {
  casting, unowned?, check?, duration?, repeatSave? })`, pushes the events,
  folds them into `current`, adds the target to `held` unless
  `outlivesCasting`, and pushes an outcome. **That call is the whole of the
  new kind's resolution**, minus the roll and minus `roll-recorded`.
- Validation: `packages/engine/src/spell-schema.ts:231` (`case 'save'` →
  `checkCondition`), and the `checkShape` set near `:848` that restates the
  union's members — the place a new member is added or the whole catalogue
  fails to parse.
- Coverage: `packages/engine/scripts/coverage.ts:104` declares the shape ids
  (`save-condition` is the neighbour); `COVERAGE.md` is generated from it.
  `VERIFIED_SPELLS` and `PARTIAL_SPELLS` live in the same script.
- Guards that will fire: `spell-catalogue.test.ts` drives every registered
  definition automatically; `spell-tracking.test.ts` scans a tracked spell's
  SRD prose for markers and demands a written adjudication; `coverage.test.ts`
  holds every definition's name, level, school, casting time and
  Concentration against the parsed book; the range and duration oracle holds
  the rest.
- Targeting: `targets.count` already scales with the slot ("the target count
  from the slot" — `CLAUDE.md`, "Spells The Engine Executes"), which
  Invisibility's upcast needs and nothing new does.

### Required behaviour

A new member of `SpellEffect`:

```ts
| {
    readonly kind: 'condition';
    readonly condition: ConditionName;
    readonly lasts?: RiderDuration;
    readonly check?: SpellCheck;
    readonly outlivesCasting?: true;
  }
```

Semantics, each transcribed from the `save` member's docstrings rather than
invented: the condition is applied to every resolved target with the casting
link (`Name#cast:N`), for the casting's duration unless `lasts` says
otherwise; `check` is the escape check the target may attempt against the
pinned save DC; `outlivesCasting` records it under the bare spell name and
keeps the target out of `on`. No die is thrown and no `roll-recorded` is
written, because nothing was rolled. The outcome for the target reports the
condition and `affected: true` with no `save`. Under an `area`, the same
per-target loop applies; under `targets`, the caller's ids.

**No `repeats`.** No candidate spell repeats a save it never made; a field
with no user is a guess.

Proving spells, each with its SRD line quoted in the definition:

- **Greater Invisibility** (level 4, Illusion, Action, Touch, Concentration
  up to 1 minute): "A creature you touch has the Invisible condition until
  the spell ends." Verified end to end: cast, the target carries
  `Invisible` linked to the casting, an attack against it gets the
  `conditions.ts` consequence, Concentration ending lifts it.
- **Invisibility** (level 2, Illusion, Action, Touch, Concentration up to 1
  hour): "A creature you touch has the Invisible condition until the spell
  ends. The spell ends early immediately after the target makes an attack
  roll, deals damage, or casts a spell." Upcast: "You can target one
  additional creature for each spell slot level above 2." The early-end clause
  is a trigger the engine does not have (nothing ends a casting when its
  target acts), so this is **`PARTIAL_SPELLS`** with that clause in
  `unmodelled`, stated as debt, not as fiction.

Then every other parsed spell with no definition whose *only* mechanical
clause is a condition applied with no save at an Action or Bonus Action
casting time. A scan of the parsed book turns up eighteen spells naming a
condition with no saving throw in their prose; most are blocked elsewhere
(long casting times, summons, a second location, an end trigger). The builder
reads each against its own paragraph and either defines it — if it fits with
nothing left over that the tracking guard would call debt — or lists it in
the report with the exact clause that blocks it. Candidates worth reading
first: Silence, Sequester, Mind Blank, Heroism, Freedom of Movement, Mirror
Image, Shining Smite, Mislead. Several of those will turn out to be immunities,
summons or riders rather than this shape; saying so is the deliverable.

### Architecture constraints

- No outcome-scoped child vocabulary. That decision is recorded and deferred;
  this task is its evidence, not its implementation.
- Do not change the `save` member, `applySpellEffect`, `conditions.ts`, the
  `GameEvent` union, or the reducer. If the new kind cannot be resolved with
  the existing `applySpellEffect` options, that is `ARCHITECTURE_BLOCKED`.
- No new event type. A condition applied is already an event.
- No end trigger for Invisibility. Name it in `unmodelled`; do not build it.
- The validator gains a `case 'condition'` that checks the condition name and,
  where `check` is present, whatever `save` already checks for it. The
  `checkShape` set gains the member. Every existing definition must still
  parse unchanged.
- `coverage.ts` gains the shape id `condition` with a label; `COVERAGE.md` is
  regenerated and committed.

### Acceptance criteria

1. `parseSpellDefinition` accepts the new kind and refuses one with an unknown
   condition name, with a path on the problem.
2. Greater Invisibility is in `VERIFIED_SPELLS`, driven by a test that casts
   it, asserts the linked `Invisible` instance on the target, asserts an
   attack against the target reads the condition, and asserts the condition
   lifts when the casting ends.
3. Invisibility is in `PARTIAL_SPELLS` with the early-end clause in
   `unmodelled`; its upcast target count is asserted at level 3.
4. Every other candidate is either defined and driven by the catalogue test,
   or named in the report with its blocking clause.
5. A mutation that removes the `applySpellEffect` call from the new branch
   fails the Greater Invisibility test; say so in the report.
6. `CLAUDE.md` gains a short paragraph under "Spells The Engine Executes":
   the shape is the `save` shape minus the roll, and why `repeats` is absent.
7. The whole gauntlet passes; `golden-log.json` is untouched.

### Tests and conformance

New tests beside the existing spell tests (`spell-effects.test.ts` or a new
`condition-effects.test.ts`); `spell-schema.test.ts` for the validator;
`coverage.test.ts` if the shape table is asserted there. The catalogue,
tracking, coverage and oracle guards run unchanged and must pass.

### Dependencies

IE-004 (`0536a2b`) and IE-005 (`4f829e9`), both merged. Nothing in tranche 3
blocks it; it is sequential with IE-007, which shares the module.

### Likely file surface

`packages/engine/src/spell-definitions.ts` (the union at the top; new
definitions and registry lines below), `spell-schema.ts`,
`packages/engine/src/commands/spell-resolution.ts` (the `resolveEffects`
branch and the three existing rider blocks at `:927`, `:1251`, `:1327`),
`packages/engine/src/commands/casting.ts` **only if** the shared rider helper
belongs beside `applySpellEffect` — say which and why,
`packages/engine/scripts/coverage.ts`, `spell-schema.test.ts`, one new or
existing spell test file, `spell-tracking.test.ts` only if a tracked spell
moves, `CLAUDE.md`, `COVERAGE.md`.

### Out of scope

Silence's "casting a spell with a Verbal component is impossible there";
Invisibility's early end; Sequester's end-on-damage; anything needing a
summons, a second location, a long casting time or a Bonus Action trigger;
outcome-scoped child effects; any change to how `conditions.ts` reads
`Invisible`.

### Known risks

- Wrong numbers nothing checks: every duration, range and target count is
  quoted from the SRD line, and the oracle checks two of the three.
- The tracking guard: a spell moved from tracked to executed may still carry
  prose markers needing adjudication.
- The registry conflict with a content task at integration is mechanical
  (both lines, id order); `COVERAGE.md` is regenerated.


## Completion digest

```
IE-001 — Completion digest
Approved architectural intent: Add the one `SpellEffect` kind for a condition a spell imposes with no saving throw — the `save` shape minus the roll — resolved through the existing `applySpellEffect` call, and make it the fourth consumer of one shared `ConditionRider` and one option-building helper rather than a fourth spelling, with the three existing riders adopting it in the same task.
Builder: COMPLETE
Worktree: .claude/worktrees/agent-ae9f51fae889d510b   Branch: worktree-agent-ae9f51fae889d510b   Commit: 1e25dcc (rebased by the foreman to 7592efe)   Rebased on main at: not rebased by the builder, per the tranche-3 launch instruction; built on base 85bdf28
Opus review: PASS — rounds: 2
Tests: 5549 passing / 5549 total (baseline 5508); new tests: 6 hand-written in `condition-effects.test.ts` plus 6 in `spell-schema.test.ts` (a four-kind parameterised path table, an untyped-loader case, a missing-rider case), and the parameterised catalogue/schema/oracle/honesty sweeps pick both definitions up automatically; mutation run: two, each reverted — (a) removing the `applySpellEffect` call from the new `condition` branch failed three of the six new tests (the linked-instance assertion found no `Greater Invisibility#cast:N`, and the attack-mode sweep read `normal` where it must read `disadvantage`), (b) dropping `unowned` from the shared `riderOptions` failed four Grease tests, which is the evidence the rewritten `save` rider still resolves what it did before the three blocks were merged into one.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — COVERAGE.md regenerated and byte-clean on re-run; executed 84 → 86, verified 60 → 62, partial 53 → 54. Both spells' printed range and duration oracled against the book; every number quoted from `packages/srd/raw/spells.md:2904` and `:3411`. `golden-log.json`, `golden-log-2.json`, `PROGRESS.md`, `docs/dev/` and `packages/srd/raw/` untouched.
Architectural deviations: one, declared. **The new kind nests its rider (`{ kind: 'condition', condition: ConditionRider }`) rather than spelling it flat as the brief body's code block shows.** The re-brief/audit note supersedes the body and asks for "one shared rider type `{ name, lasts?, check?, outlivesCasting? }`"; the flat spelling would have been the fourth spelling the same note forbids. Relatedly, `save` **keeps** its flat layout because the brief's architecture constraints say not to change that member — `conditionRiderOf` is the view that lets it share the type and the helper without its stored shape moving. I read the two instructions as compatible on those terms; if the foreman reads "the three existing riders adopt it" as requiring `save`'s shape to change too, that is a larger diff (≈30 definitions, the schema and `riderDurations`) and was deliberately not taken.
Foundational primitives touched: the `SpellEffect` union and the type declarations at the top of `spell-definitions.ts` (new exported `ConditionRider`, new `condition` member, `attack.condition` and `save-damage.condition` retyped to the shared rider, new exported `conditionRiderOf`, `riderDurations` rewritten through it); `resolveEffects` in `commands/spell-resolution.ts` (three rider blocks rewritten through one `riderOptions`, one new branch); `spell-schema.ts`'s `checkEffect` and the `EFFECT_KINDS` set. Not touched: `applySpellEffect`, `commands/casting.ts`, `conditions.ts`, `events.ts`, the reducer.
New runtime special cases: none. One more branch in a chain the `never` binding still closes exhaustively; both spells are pure declarative data.
Files outside the brief's surface: one. `packages/engine/src/spell-honesty.test.ts` — acceptance criterion 3 requires Invisibility in `PARTIAL_SPELLS`, and that list is *derived* from this map since IE-004, so the single adjudication entry is the only way to satisfy the criterion. The brief's surface list predates the derivation.
Out-of-scope findings (not acted on): (a) **`ConditionRider` makes `check` and `outlivesCasting` reachable on the `attack` and `save-damage` riders, where no registered definition uses them.** That widening is what the audit note asked for, and the helper's branches are exercised through Grease and Black Tentacles on the `save` path — but the two new combinations have no user and no test today. (b) `spell-catalogue.test.ts:127-132` still hand-enumerates `save`/`attack`/`save-damage` to decide whether a definition needs a fight to be cast in, where `riderDurations` is now generalised; a future `condition` effect with a turn-anchored `lasts` would fail loudly there rather than silently, and that file was outside the brief. (c) `spell-tracking.test.ts:500` still lists `greater-invisibility` under "Spells this batch deliberately refused" — stale prose on an assertion that remains true. (d) `needsCasterSheet` returns `true` for the new kind, which throws nothing and needs no sheet; conservative and unreachable today, so I did not loosen it without a user. (e) The validator never checks a `SpellCheck`'s own fields, for any kind — pre-existing, and inventing a rule here was not measured.
Unresolved concerns: none.
Reviewer confidence: high
Recommendation: READY FOR MERGE

IE-001 — Independent review
Verdict: PASS
Commit reviewed: 1e25dcc2a63b6079da4e38ce57ebb0254945cb3d   Gauntlet re-run: typecheck ✓ lint ✓ test 5549/5549 coverage diff ✓
Brief compliance: met. (1) validator accepts the kind and refuses an unknown condition with a path, for all four rider sites; (2) Greater Invisibility is in VERIFIED_SPELLS and driven end to end — cast, linked instance `Greater Invisibility#cast:N`, attack against it reads Disadvantage, endConcentration lifts it; (3) Invisibility is in PARTIAL_SPELLS by derivation from its adjudicated clause, with the upcast asserted at slot level 3 and refused at 2; (4) the remaining 27 candidates are named in CLAUDE.md by blocking clause, and the two the brief's prose scan missed (Silence, Mislead) are called out with why; (5) mutation named and it bites; (6) CLAUDE.md gains the section, including why `repeats` is absent; (7) gauntlet green, golden logs untouched. `commands/casting.ts` was correctly left alone — `riderOptions` sits with its four callers and says so.
Tests: `condition-effects.test.ts` (6 cases) pins no-roll resolution (no `roll-recorded`, no `rolls-issued`, generator unmoved), the exact casting link, the `conditions.ts` consequence via a normal→disadvantage→normal attack-mode sweep, the upcast count with the slot unspent on refusal, both definitions' numbers, and the partial/verified split. `spell-schema.test.ts` adds a four-kind table asserting the *path* each problem reports — which is what proves one rule rather than four spelled alike — plus an untyped-loader case and a missing-rider case that must report rather than throw. Fixtures discriminate: sight from the goblin is deliberately undeclared so the Invisible rule is what moves the mode, and the upcast is pinned from both sides.
Regression risk: none. `golden-log.json` and `golden-log-2.json` untouched; no event type, reducer case or command added, so no replay surface changed. The `attack` and `save-damage` branches change only by gaining a guard on a field no registered definition sets, so their emitted events are byte-identical. Idempotency and invariants sweeps need no entry — nothing new is a command.
Conformance: PASS. COVERAGE.md regenerated and byte-identical to a fresh run; 84→86 executed, 53→54 partial, 60→62 verified. The new shape row is placed below `heal`, with the reason written down: filing Power Word Heal here would have made "Restores Hit Points" read 3/3 while a level 9 spell in it is unexecuted. The one false positive (Mirror Image) is named in the blocker column rather than hidden. Invisibility's `unmodelled` clause is adjudicated to an existing named shape and its SRD quote matches the spell's own paragraph.
Scope creep: none. `spell-honesty.test.ts` is not on the brief's file list but is required by acceptance criterion 3 — PARTIAL_SPELLS is derived from that map — and the edit is one adjudication entry.
Architectural violations: none. No spell-name special case; both spells are pure data. The rider is one type with one option-builder and one schema reader; `save` keeps its flat layout behind `conditionRiderOf`, so there is one vocabulary and no second source of truth. No outcome-scoped child vocabulary. No guard above a duplicate check (none added).
Hard-coded or test-specific fixes: none. The condition, duration and target count all come from the definitions; the test file asserts no number it also supplies.
Accidental coupling: none new. `spell-schema.ts` now imports `conditionRiderOf` from `spell-definitions.ts`, which it already imported types from, and the direction is unchanged.
Foundational primitives touched: the `SpellEffect` union and the type declarations at the top of `spell-definitions.ts` (new `ConditionRider`, new `condition` member, three riders retyped); `resolveEffects` in `commands/spell-resolution.ts` (three existing rider blocks rewritten through one helper, one new branch); `spell-schema.ts`'s `checkEffect` and the `checkShape` set. All four named by the brief. Not touched: `events.ts`, the reducer, `applySpellEffect`, `conditions.ts`, `commands/casting.ts`.
New runtime special cases: none. One new exhaustive branch in a chain the `never` binding still closes.
Defects for the builder: none
Escalation reason: none
Confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

A foundational primitive changed — the `SpellEffect` union — which the brief
ordered, and one deviation was declared and put to the foreman as a question.
The diff was read.

**The deviation is not arguable, and the ruling is the foreman's to make
rather than defer.** The brief says both *"the three existing riders adopt
it"* and, in its architecture constraints, *"Do not change the `save`
member"*. `save` is the only one of the three that **is** the rider rather
than has one — the other two carry a `condition` field and were genuinely
retyped. So there is exactly one reading that satisfies both sentences, and
the builder found it: two riders adopt the type outright, and `save` shares
it through `conditionRiderOf` without its stored layout moving. One type, one
option-builder, one schema reader, no second source of truth — which is what
the instruction was for. GREEN.

The alternative — moving `save`'s stored shape — is about thirty definitions,
the schema and `riderDurations`, and it buys uniformity of *storage* where
uniformity of *vocabulary* is already achieved. It is recorded in `LATER` as
a question rather than taken silently.

**What the unification found is worth more than the spells.** The docstring
records it: an escape check reached the `save-damage` rider and the `save`
kind and not `attack`, and `outlivesCasting` reached only `save`. Those
differences were **accidents of the order the spells were written in, not
rules** — three near-identical blocks that had each drifted to a different
idea of which fields it read. That is the leverage audit's thesis
demonstrated on its first family, and it is the kind of divergence no
spell-by-spell test could surface, because each block was correct on its own
terms. The mutation that drops `unowned` from the shared helper failing four
*Grease* tests is the evidence the merge preserved behaviour.

**One cost of sharing the type is declared and real:** `check` and
`outlivesCasting` are now reachable on the `attack` and `save-damage` riders,
where no registered definition uses them and no test covers those two
combinations. That is the price of one vocabulary rather than three, the
audit note asked for it, and the honest record is that two combinations are
expressible and unexercised. Recorded rather than papered over.

**The brief's file surface was stale, for the second time this tranche.** It
did not name `spell-honesty.test.ts`, and acceptance criterion 3 — Invisibility
in `PARTIAL_SPELLS` — is unsatisfiable without it, because IE-004 made that
list *derived* from the adjudication map. The brief predates the derivation.
Same class of error as IE-008's four-versus-seven pool kinds: an inventory
written from a reading of the code at the time, overtaken by the work.

Merging under tranche 3 authority.

## Merge record

Merged to `main` as `7592efe`, fast-forward, pushed. Worktree retired and
branch deleted. Rebased by the foreman over four commits — IE-008, its
bookkeeping, the leverage audit, and IE-009's routing — all conflict-free.

The thirteen conditions, asserted by name:

1. **Inside the brief** — yes. One file outside the surface, required by an
   acceptance criterion the surface list predates.
2. **Builder COMPLETE** — yes.
3. **Independent reviewer PASS, confidence high** — yes, at round two.
4. **Defects resolved** — yes; none outstanding, no unresolved concerns.
5. **Gauntlet in the worktree** — typecheck ✓ lint ✓ test 5549/5549 ✓
   coverage ✓ `git diff --exit-code COVERAGE.md` ✓.
6. **Conformance** — `COVERAGE.md` regenerated byte-clean; executed 84 → 86,
   verified 60 → 62, partial 53 → 54; Invisibility's clause adjudicated to an
   existing named shape with its quote held against its own paragraph.
7. **No unresolved architecture blocker** — none; Fable was not needed.
8. **No material deviation** — one declared, ruled above as the only reading
   that satisfies both of the brief's sentences.
9. **No unexpected authority-boundary or foundational-state change** — the
   union changed, which the brief ordered; no event type, no reducer case, no
   command, so no replay surface moved.
10. **No meaningful scope expansion** — one file, required by criterion 3.
11. **No non-mechanical merge conflict** — none across four commits.
12. **Integration did not invalidate the review** — full gauntlet re-run on
    `main` after the fast-forward: typecheck ✓ lint ✓ **test 5558/5558** ✓
    coverage byte-clean ✓, both frozen fixtures untouched. The count is nine
    above the reviewed 5549 because the base gained IE-008's tests in the
    rebase.
13. **Risk gate** — GREEN, above.

Verified on `main` at `7592efe` and pushed to `origin/main`.
