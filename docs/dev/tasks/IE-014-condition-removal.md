# IE-014 — A spell that takes a condition away

state: DONE
lane: mechanism
tranche: 4
parallel-safe: NO beside another union task — it adds a `SpellEffect` member and edits `resolveEffects`; YES beside conformance, tooling and the scene work
depends-on: IE-010
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 4" (tranche 4 authority; 13/13 conditions green)

## Brief

### Objective

Add the `SpellEffect` member for a spell that **removes** a condition, by
extracting the removal `useHealingTouch` already performs rather than writing a
second one.

### Why now

Wave 2's union task. The fourth whole-engine audit (§4) split the leverage
audit's C5 in two and kept this half: **the arithmetic exists and is already
reached.** `useHealingTouch` (`commands/features.ts:152`) removes a named
condition wholesale for Lay On Hands, and `removeConditionInstance`
(`conditions.ts:188`) is the operation beneath it. No spell can reach either.

The audit dropped C5's other half — healing an effect modifies (Chill Touch,
Beacon of Hope) — at two consumers. It is a standing effect read by
`healCreature`, a different primitive, and it is **not in this task**.

### Current relevant architecture

- `removeConditionInstance` (`conditions.ts:188`) and the instance ids
  (`condition:source`) that make removal exact rather than by name.
- `useHealingTouch` (`commands/features.ts:152`) — the existing caller, and the
  code to extract. SRD Lay On Hands: five points buy the lifting and heal
  nothing, and the SRD removes *the condition*, not a cause of it, so a
  creature poisoned twice over is not half-cured. That reading is already
  implemented; preserve it exactly.
- `conditionApplicability` (`monster.ts:266`) — three answers, not a boolean.
  Removal has no such question, but read it before assuming symmetry.
- The `SpellEffect` union and `resolveEffects` in
  `commands/spell-resolution.ts`, **as IE-010 leaves them**.

### Required behaviour

1. A `SpellEffect` member that removes one or more named conditions from each
   resolved target. It removes the condition the SRD names — every instance of
   it — not one instance and not a cause.
2. **One implementation.** `useHealingTouch` and the new member call the same
   extracted function. A second removal path is the failure this task exists to
   avoid.
3. Proving spells, each with its SRD line quoted: **Lesser Restoration**
   ("end one condition on it: Blinded, Deafened, Paralyzed, or Poisoned") —
   whole. **Protection from Poison**'s first sentence — its remaining clauses
   are `unmodelled` and adjudicated.
4. **Heal is a stretch goal and may be deferred within the task.** It needs
   flat-only healing, because `DiceScaling.dice` is required and Heal restores
   a flat 70; that is a one-line format question, and if it turns out to be
   more the builder reports rather than widening.
5. Removing a condition a creature does not have is not an error — it is a
   spell that found nothing to cure.

### Architecture constraints

- No new event type. Condition removal already has its event in the reducer's
  vocabulary; use what is there.
- Do not change `conditions.ts`, the implication closure, or the meaning of any
  existing condition source.
- Do not touch healing's modifiers. That is the dropped half of C5.
- Both frozen logs fold unchanged.

### Acceptance criteria

1. A failing test first for Lesser Restoration end to end: apply Poisoned from
   a source, cast, assert the instance is gone and that an unrelated condition
   on the same creature is untouched.
2. A creature carrying the same condition from two sources is fully cured, and
   a test says so with the SRD line.
3. A mutation replacing the extracted call with a fresh removal fails a
   `useHealingTouch` test — the evidence there is one implementation.
4. `COVERAGE.md` regenerated; the executed count rises by what landed.
5. The whole gauntlet passes; both frozen logs fold.

### Dependencies

**IE-010**, which restructures the rider vocabulary and `resolveEffects`. This
task rebases over it; the foreman runs the rebase.

### Likely file surface

`packages/engine/src/spell-definitions.ts` (the union and the definitions),
`commands/spell-resolution.ts`, `commands/features.ts` (the extraction),
`spell-schema.ts`, a spell test file, `packages/engine/scripts/coverage.ts`,
`COVERAGE.md`, `CLAUDE.md`.

### Out of scope

Healing an effect modifies; raising the dead; a Hit Point maximum an effect
moves; Greater Restoration's other clauses.

### Known risks

- The extraction is where a behaviour change hides. `useHealingTouch`'s tests
  are the guard and none of them may be edited.


## Merge record

Merged to `main` as `fb79ca2`, fast-forward, pushed. Worktree retired.
PASS at high confidence, round three. Executed 87 → **89**, verified 64 → 66,
partial 53 → **55**. 6,379 tests.

**One implementation, and the mutation proves it**: `endConditionsOn` lives in
`commands/conditions.ts` and is called by both `useHealingTouch` and
`resolveEffects`. Lay On Hands' events are byte-identical and **none of its
tests was edited** — replacing the extracted call with a fresh removal naming
a source reddens `healing-touch.test.ts` *and* the new spell tests, which is
the evidence there is one removal rather than two.

### The brief said "whole" and the SRD says otherwise

My acceptance criterion called Lesser Restoration whole. SRD prints **"end
*one* condition on it: Blinded, Deafened, Paralyzed, or Poisoned"** — a choice
the caster makes — and the engine ends every one the target has. I checked the
line myself (`spells.md:3468`) rather than take either party's word: the
builder is right.

Building the choice would mean building `a-choice-made-at-the-casting`, an
already-enumerated missing shape with an existing consumer, plus
`CastSpellRequest` and `PendingCasting` carrying it so a *held* casting could
not lose it. That is architecture the brief did not approve. So the gap is in
`unmodelled`, adjudicated to that shape, and derived into `PARTIAL_SPELLS` —
which is why partial went to 55 rather than 54, and why **neither new spell is
whole**. That is the honest number.

**This is my fifth brief error of the tranche and the second of its kind** —
an outcome asserted without reading the SRD sentence, exactly as the
Paladin/Fighter hit die was. The rule added after IE-011 (a brief may not
assert a rules fact without quoting the line) covers the number and not the
*verdict*; a brief's claim that a spell comes out whole is the same kind of
claim and needs the same evidence.

### Heal was deferred with measurement, and my brief was wrong about that too

I called flat-only healing "a one-line format question". The builder measured
it: `DiceScaling.dice` is required, `parseNotation` refuses a count below one
so `0d6` cannot stand in, and making it optional touches `scaledDiceFor` and
the six resolution paths that hand its result to `rollSpellDice` — **and would
make flat-only *damage* expressible with no consumer**, which is precisely the
speculative member IE-013's own zero-user sweep exists to catch. Deferred on
evidence, which the brief authorised.

The thirteen conditions: 1 inside the brief · 2 COMPLETE · 3 PASS at high,
round three · 4 no defects · 5 gauntlet ✓ · 6 `COVERAGE.md` byte-clean, every
`unmodelled` clause adjudicated to a named shape citing text that predates the
commit · 7 no blocker · 8 no deviation; one reading, ruled above · 9 no event
type, no reducer, no fold change — `condition-removed` already existed ·
10 one file outside the surface, `commands/targeting.ts`, holding the return
type the required behaviour reports through · 11 no conflict · 12 gauntlet
re-run on `main`: typecheck ✓ lint ✓ **6379/6379** ✓ coverage byte-clean ✓ ·
13 GREEN.
