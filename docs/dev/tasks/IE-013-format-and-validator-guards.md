# IE-013 — Guards that can see a zero-user member, and three that were missing

state: APPROVED_FOR_IMPLEMENTATION
lane: conformance
tranche: 4
parallel-safe: YES — validator rules, sweeps and one read-site change; no effect kind, no union member, no new event
depends-on: none
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: none

## Brief

### Objective

Close the validation and conformance holes the fourth whole-engine audit
found, and add the one guard that would have caught three of them by itself:
a sweep asserting that **every member of the definition format has a user or a
written exemption.**

### Why now

The audit's §3.1 is the structural finding: `checkSpellDefinition` checks that
one definition is coherent, and **nothing in the repository can see a member
that nobody uses.** Three exist right now — `roll-mode.save`, `SpellCheck.dc`,
and `'end-casting'` as a `save.repeats.onSuccess` value — each written for a
spell blocked on something else. Speculative shape accumulates silently, which
is exactly what the doctrine's generalization rule exists to prevent.

The guard already exists for a neighbouring vocabulary: `spell-honesty.test.ts`
asserts that no entry in `MISSING_SHAPES` sits unclaimed. The same sweep over
the format is one test.

### Current relevant architecture

- `checkSpellDefinition` / `checkShape` in `spell-schema.ts`. Its two
  lifetime-shaped siblings are the model for the new rule: `check` demands a
  lifetime at `:619`, and `activation_without_duration` at `:697`.
- `spell-honesty.test.ts:909` — "no shape sits unclaimed", the guard to copy.
- `spell-schema.test.ts:651-659` — `RUNTIME`, the special-case sweep's file
  list. It reads `commands/`, `events.ts`, `spells.ts`, `spellcasting.ts` and
  `standing.ts`, and **not** the six files IE-005 and IE-001 moved eight
  readers into. No special case is there today; this is a hole, not a breach.
- `spell-catalogue.test.ts:127-132` — hand-enumerates which kinds carry a
  turn-anchored rider, where `riderDurations` is the derivation.
- `commands/turns.ts:488` — `settleAreaEffects` resolves a trigger's effects
  through `definitionFor(record.spellId)`, so IE-007's pinned
  `areaTrigger.effects` and `.label` have no reader.

### Required behaviour

1. **A zero-user sweep over the definition format.** Every optional field and
   every union member of `SpellEffect`, `SpellDefinition`, `TargetRule`,
   `SpellArea`, `AreaTrigger`, `RiderDuration` and `SpellCheck` is either
   written by at least one registered definition or carries a written
   exemption with its reason — the shape `definition.anchoring`'s pinned
   decision already takes (`spatial-model.test.ts:644`). The three zero-user
   members above are its first findings: `roll-mode.save` is removed by
   IE-010, so this task expects `SpellCheck.dc` and `'end-casting'` to need
   either a user, an exemption, or removal — **the builder decides which for
   each, with the reason, and says so.**
2. **`grant_without_lifetime`.** A definition with none of `durationSeconds`,
   `durationUntil`, `untilDispelled` or `concentration` may not carry `buff`,
   `roll-mode`, `armor-class`, or a condition rider lacking both `lasts` and
   `outlivesCasting`. **No definition violates it today** — the foreman drove
   all 132 — so this is a guard with no fix attached, and the test must
   therefore drive a hand-built definition that violates it.
3. **`SpellCheck` field rules.** The validator checks no `SpellCheck` field at
   all: a check naming a skill of the wrong ability compiles and validates.
   Check what the existing vocabulary can check — that the skill exists, that
   it belongs to the named ability.
4. **The special-case sweep reads every non-test source file**, with the
   definitions region's own `id:` lines allowed. The six feature-id literals
   in `creation.ts` and the one in `multiclass.ts` are pre-existing, unchanged
   since the third audit, and go on an allowlist with their reason rather than
   being removed.
5. **`spell-catalogue.test.ts` uses `riderDurations`** instead of its
   hand-written kind list.
6. **`settleAreaEffects` reads `record.areaTrigger`**, not the catalogue. The
   compatibility worry recorded on IE-007 is already answered: `upgradeOngoing`
   fills `areaTrigger` when a pre-versioned record enters the fold
   (`ongoing-compatibility.ts:73`), so **no record in `state.ongoing` ever
   lacks it** — verify that before relying on it.

### Architecture constraints

- No new effect kind, no union member, no new event type, no change to
  `events.ts` or the reducer.
- Item 6 is a read-site change in `turns.ts` only. If it turns out to need
  more, stop and report rather than widening.
- Every new guard must have a test that *drives* a violation, not merely
  asserts the current state passes. A guard nothing can fail is not a guard —
  this repository has recorded that twice.
- Do not "fix" a zero-user member by inventing a definition for it. Removal or
  a written exemption are the honest answers.

### Acceptance criteria

1. The zero-user sweep exists, drives a synthetic violation, and reports its
   findings by name.
2. `grant_without_lifetime` and the `SpellCheck` rules each refuse a
   hand-built definition, with a path on the problem.
3. The special-case sweep's file list is derived from the directory, and a
   mutation that smuggles a spell-id literal into any newly-covered file
   fails it by file name.
4. Item 6 has a test that a definition corrected under an already-written log
   does not move a settlement — the mirror of the test IE-007 wrote for the
   trigger's other fields.
5. The whole gauntlet passes; both frozen logs fold; `COVERAGE.md`
   regenerated.

### Tests and conformance

`spell-schema.test.ts` for items 1–3, a new sweep beside the honesty guard's;
`spell-catalogue.test.ts` for item 5; `ongoing-spells.test.ts` for item 6.

### Dependencies

None on `main`. **Sequenced after IE-010 at merge**, because IE-010 removes
`roll-mode.save` and item 1 counts it; the foreman rebases.

### Likely file surface

`packages/engine/src/spell-schema.ts`, `spell-schema.test.ts`,
`spell-catalogue.test.ts`, `commands/turns.ts`, `ongoing-spells.test.ts`,
`CLAUDE.md`.

### Out of scope

The feature-definition validator (a bigger task, named in the audit's `later`
row); the refusal-code coverage sweep (41 of 112 unasserted — its own task);
per-event field schemas; `index.ts` tiering.

### Known risks

- Item 1 may find more than the three zero-user members the audit named. That
  is the guard working; report them, and take the honest answer for each
  rather than inventing users.
