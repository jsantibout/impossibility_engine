# IE-001 — A condition applied with no saving throw

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 3
parallel-safe: CONDITIONAL — YES beside a mechanism task outside spell resolution (IE-008 is `creation.ts`) and beside conformance; NO beside IE-007 or anything else in `commands/spell-resolution.ts` or the `SpellEffect` union
depends-on: IE-004, IE-005
worker: none
approved: none
merge-approved: none

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

(none yet)

## Architectural gate

(none yet)

## Merge record

(none yet)
