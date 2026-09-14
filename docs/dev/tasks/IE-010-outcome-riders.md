# IE-010 — Outcome riders, and the two `on` rules made one

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 4
parallel-safe: NO beside any task touching the `SpellEffect` union or `commands/spell-resolution.ts`; YES beside `creation.ts`, a new command module, and conformance work
depends-on: IE-001, IE-007
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: none

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
