# IE-003 — Close the guard holes and make the guard sweeps mechanical

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
batch: 1
parallel-safe: CONDITIONAL — beside conformance (IE-004) and content only; it edits `commands.ts`, `events.ts`, `rest.ts`, `spells.ts` and the invariants suite, so no other mechanism task runs beside it
depends-on: none
worker: none
approved: 2026-09-13 — "APPROVE BATCH"
merge-approved: none

## Brief

### Objective

Seven measured holes in the engine's guards, each closed behind a
reproduction, and the two sweeps that would have caught them made mechanical
so the next hole fails in a test rather than in play. Every item is in
`docs/architecture/whole-engine-audit-2026-09-13.md`, §3.3 and §3.1, with
file:line evidence.

### Why now

Correctness comes before the next family and before the structural split.
Two `CLAUDE.md` sentences promise sweeps that do not exist; a command spends
an economy with no guard; a settlement path re-rolls saves on a retry; a
removed creature can wedge a fight; the duplicate-check trap has been sprung
an eighth time, in a wrapper. Each is small. Together they are the audit's
first recommendation.

### Current relevant architecture

- `mayAct` (`commands.ts:7681`) is the one policy for "may this creature
  spend anything"; `unsettledRefusal` (`:7620`) is the stronger form used by
  casting and activation; sixteen commands spend an Action, Bonus Action,
  movement, pool use or slot (audit §3.3, and the state sweep's table).
- `identify` (`commands.ts:300`), `wasCommandApplied` (`:322`),
  `commandOutcome` (`:333`) and the fingerprint (`stableStringify`, `:275`)
  are the idempotency machinery; `rest.ts:6` imports `identify` from the
  command layer, the engine's only upward value import.
- `GUARDED` (`invariants.test.ts:566`) is a hand-written array of 39 commands
  run twice under one id.
- `castOrRelease` (`commands.ts:7715`) wraps `resolveSpell`; its refusals at
  `:7740` (`unknown_creature`), `:7744` (`no_definition`), `:7803`
  (`cast_on_a_hit`), `:7891` (`needs_context`) and `:8614`
  (`no_free_casting`) precede `castSpell`'s `identify` (`:5450`); the two
  pending-state guards at `:7735` and `:7781` are already replay-exempt.
- `creature-removed` (`events.ts:3310`) does not touch `timers`;
  `dropOrphanedSaves` (`:2956`) drops a pending save only when its timer is
  gone; `resolvePendingSaves` (`commands.ts:6776`) refuses `unknown_creature`
  at `:6789`; `resolveTurn` refuses `saves_pending` at `:6919`.
  `settleHoldsInvolving` (`commands.ts:549`) is how the other holds are
  settled when a creature leaves.
- The Counterspell exemption at `commands.ts:7780` lets a `casting-a-spell`
  Reaction be declared while a casting is pending; when the pending casting is
  itself a Counterspell, the reducer throws `CorruptLogError`
  (`events.ts:3531`) instead of the command refusing.
- `castingNumber` (`commands.ts:4021`) and `castingNumberOf` (`:6576`) are
  identical; `commands.ts:8765` hand-builds a casting source that
  `castingSource` (`spells.ts:30`) already builds.

### Required behaviour

1. **`extendFeature` guards.** It calls `mayAct` (or `unsettledRefusal`, as
   its siblings do) before `spendFor`. Reproduction: with a global owed area
   effect, `extendFeature` is refused `area_effect_owed` exactly as
   `activateFeature` is.
2. **A mechanical `mayAct` sweep.** A test enumerates every exported command
   that spends an Action, Bonus Action, Reaction, movement, a pool use or a
   slot, runs each against a state holding a global owed area effect, and
   asserts `area_effect_owed` — except for commands on an explicit allowlist,
   each with a written reason (Reactions and the settlement commands, per
   `CLAUDE.md`, "Reactions are not routed through either"). The list of
   spenders is declared in the test with its evidence line, so a new spender
   is a one-line addition and an unguarded one fails.
3. **`GUARDED` derived, not recalled.** The idempotency sweep asserts that
   every export of `commands.ts` and `rest.ts` whose return carries events is
   either in the sweep or in an allowlist with a reason (the four `CLAUDE.md`
   names as fixture and log-reconstruction halves, plus any others the
   builder can justify). Add `activateFeature`, `resolveAttackDamage`,
   `beginRest`, `castSpell` and `resolveDamage` to the sweep. Give
   `resolvePendingSaves` and `removeCreatureEverywhere` a `CommandIdentity`
   and stamp the event that always happens (for the saves, `roll-recorded` is
   not always emitted — choose the event that is, as the healing-touch lesson
   in `CLAUDE.md` says). A retried `resolvePendingSaves` rolls nothing.
4. **The duplicate check first in the casting wrapper.** `resolveSpell` /
   `castOrRelease` establishes the command's identity before any refusal
   that reads a fact which can change between the first run and a retry.
   Reproduction: `resolveSpell` succeeds, the caster is removed, the same
   command id is retried — the result is an empty batch, not
   `unknown_creature`. The fingerprint rules stay exactly as they are.
5. **A removed creature takes its timers with it.** Reproduction: a creature
   Paralyzed by Hold Person, owing an end-of-turn repeat save, is removed
   mid-fight; `resolveTurn` advances and `pendingSaves` is empty. Fix in the
   reducer's `creature-removed` case, purging condition timers whose target
   is the departed creature (and, through the existing derived pass, their
   pending saves). A Hold Person on two targets keeps the other target's
   timer and save. Nothing is written for the departed creature's condition
   ending — expiry is derived, as it always was.
6. **Counterspell on Counterspell is a value.** When the pending casting is
   itself a `casting-a-spell` Reaction, `castOrRelease` returns
   `err('casting_pending', …)` naming the nesting, and nothing is spent. The
   reducer's throw stays as the corrupt-log backstop.
7. **Hygiene in the same files.** One `castingNumber` in `spells.ts`; the
   hand-written source at `:8765` replaced by `castingSource`; `identify`,
   `wasCommandApplied`, `commandOutcome`, `CommandIdentity` and the
   fingerprint moved to a new `idempotency.ts` that `commands.ts` and
   `rest.ts` both import (and `index.ts` re-exports), so `rest.ts` no longer
   imports the command layer.
8. **`CLAUDE.md` tells the truth.** Replace the sentence at "A sweep holds the
   list…" and the one at "`invariants.test.ts` is the authoritative list…"
   with what the two sweeps now actually assert.

### Architecture constraints

- No behaviour change beyond the eight items; no reorganisation of
  `commands.ts` (that is IE-005).
- `golden-log.json` untouched; the fold must still reproduce it byte for
  byte.
- Refusals stay values; the reducer's corrupt-log throws stay throws.
- Do not widen `mayAct`'s policy; only its coverage.
- The fingerprint's identity semantics (same id, different inputs → refused)
  are unchanged and re-asserted.

### Acceptance criteria

1. Each of items 1, 4, 5 and 6 has a test that failed before the change for
   the reason the audit gives, and passes after.
2. The `mayAct` sweep and the derived `GUARDED` sweep exist, enumerate from
   the module rather than from a hand list, and fail when a spender or an
   event-returning export is added without a guard (the builder proves this
   with a mutation: temporarily add an unguarded export and watch the sweep
   fail).
3. `resolvePendingSaves` and `removeCreatureEverywhere` are in the
   idempotency sweep and pass it.
4. `rest.ts` imports nothing from `commands.ts`; the value-level import graph
   is still acyclic.
5. The two `CLAUDE.md` sentences are corrected.
6. The whole gauntlet passes.

### Tests and conformance

`invariants.test.ts` (the two sweeps), `turn-hooks.test.ts` or
`death-saves.test.ts` (the wedge), `counterspell.test.ts` (the value
refusal), `casting.test.ts` or `idempotency` tests (the wrapper retry),
`rage.test.ts` or the feature tests (`extendFeature`). No golden-log change.

### Dependencies

None.

### Likely file surface

`packages/engine/src/commands.ts` (bounded: `extendFeature`, `castOrRelease`
/ `resolveSpell`, `resolvePendingSaves`, `removeCreatureEverywhere`, the two
`castingNumber` sites, `:8765`, the identity block moving out),
`events.ts` (`creature-removed`), `rest.ts`, `spells.ts`, new
`idempotency.ts`, `index.ts`, `invariants.test.ts`, three or four existing
test files, `CLAUDE.md`, `COVERAGE.md` if the counts move (they should not).

### Out of scope

The split of `commands.ts`; the fold's reads of the spell and equipment
catalogues (IE-007); `rollInitiativeFor`'s generator advance;
`free-interaction-used`; the `spell-ongoing` acceptance for an ended casting
(IE-007); any change to what `mayAct` refuses.

### Known risks

- Item 4 touches the casting path; the golden log and `casting.test.ts` are
  the safety net, and the change must be the ordering only.
- Item 5 must not lift conditions on creatures that stayed; the two-target
  Hold Person fixture discriminates.
- The idempotency-stamp choice for `resolvePendingSaves` has to ride on an
  event that always happens; `CLAUDE.md`'s "an event that always happens is
  where a stamp has to ride" is the rule.

## Completion digest

(none yet)

## Architectural gate

(none yet)

## Merge record

(none yet)
