# IE-020 — A held casting keeps the facts its caster stated

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — owns `events.ts` and `commands/spell-resolution.ts` for wave 1; safe beside every conformance and tooling task in that wave
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

A casting declared with `hold: true` must settle with the damage type and the
unaffected list its caster stated at the declaration, exactly as the atomic
path already does. Today both are silently dropped.

### Why now

**This is a shipped correctness gap and it is the exact failure the feature it
breaks was built to prevent.** IE-014's builder found it: `PendingCasting`
carries no `damageType` and no `unaffected`, so a Spirit Guardians declared
Necrotic settles Radiant — against an Undead that is immune to one and not the
other — and a creature the caster designated unaffected is caught anyway.
`CLAUDE.md` states the rule it violates in two places: "Picking Radiant because
most clerics are good is where a Necrotic-immune Undead finds the engine out",
and "a Dispel Magic aimed at that goblin must not put the Cleric's weapon out"
is the same class of silent wrong answer.

It is wave 1's mechanism task because everything else in the chain builds on
`PendingCasting` and on the settlement path, and because a correctness gap
outranks every capability behind it.

### Current relevant architecture

- `PendingCasting`, `packages/engine/src/events.ts:486` — the declaration
  record. It already pins `targets`, `origin` and `area` for exactly this
  reason: "settlement takes no fresh request, so a Spiritual Weapon declared
  beside the goblins cannot settle beside the party."
- `resolveOnTargets`, `packages/engine/src/commands/spell-resolution.ts:472` —
  the atomic path. `ongoingWith()` at :499 writes `unaffected` (sorted, absent
  when empty) and `damageType` onto the ongoing record at :513–517; the effects
  themselves are substituted at :531 by
  `statedDamageType(definition.effects, request.damageType)`.
- `resolveDeclaredCast`, `packages/engine/src/commands/spell-resolution.ts:143`
  — the settlement. **It does not call `resolveOnTargets`**; it calls
  `resolveEffects` directly at :186 and builds its own `becomesOngoing` at
  :194–213 from `pending` alone. Neither stated fact is in `pending`, so
  neither reaches the record or the effects.
- The declaration writes `spell-declared` at
  `packages/engine/src/commands/casting.ts:520`.
- The readers that then go wrong: `events.ts:2727` filters the spared
  creatures out of a carried area, and `commands/turns.ts:539` substitutes the
  stated type into an area trigger's effects.
- `statedDamageType` and the definition's `damageTypeStated` are validated at
  `packages/engine/src/spell-schema.ts:1064`.

### Required behaviour

SRD Spirit Guardians: "When you cast this spell, you can designate creatures to
be unaffected by it." And: "3d8 Radiant damage (if you are good or neutral) or
3d8 Necrotic damage (if you are evil)." SRD Protection from Energy:
"Resistance to one damage type of your choice: Acid, Cold, Fire, Lightning, or
Thunder."

A casting states these once, at the casting. Whether that casting is settled in
one breath or held open for a Counterspell changes nothing about what the
caster said.

1. `PendingCasting` gains `readonly damageType?: string` and
   `readonly unaffected?: readonly CharacterId[]`, both optional.
2. The declaration writes them from the request it validated, with the same
   normalisation the atomic path uses — `unaffected` sorted, and absent rather
   than empty, so two declarations that mean the same thing fold to the same
   bytes.
3. Settlement reads them off `pending` and passes them on exactly as
   `resolveOnTargets` does: the effects through `statedDamageType`, and both
   fields onto the `becomesOngoing` plan.
4. Validation of both facts stays where it is — at the declaration, where
   refusing still costs nothing. Settlement re-validates neither, because
   settlement takes no fresh request.

### Architecture constraints

- **Optional fields, so both frozen logs fold unchanged.** A declaration
  written before this exists has neither field and means what it always meant.
  Never regenerate `golden-log.json` or `golden-log-2.json`.
- **No second normalisation.** If the sort and the empty-list elision are
  written twice they will disagree; extract or share the one the atomic path
  already performs.
- The settlement path keeps calling `resolveEffects`. Do **not** refactor
  settlement to go through `resolveOnTargets` — that is IE-027's file and a
  different change.
- A declaration whose spell does not print either clause is still refused at
  declaration by the existing guards (`targeting.ts:332` for `unaffected`,
  `:348` for the stated type). Do not move or duplicate those.

### Acceptance criteria

1. **Reproduce first**, and watch each fail for the right reason:
   - hold Spirit Guardians with `damageType: 'necrotic'` and one designated
     creature; settle; assert the area trigger's damage is Necrotic and the
     designated creature takes none.
   - hold Protection from Energy with `damageType: 'cold'`; settle; assert the
     granted Resistance is to Cold.
2. The same two spells cast atomically produce the same stated facts — the
   comparison that says the two paths agree.
3. A held casting that states nothing settles byte-identically to today.
4. Both frozen logs fold unchanged; `persistence.test.ts` and
   `persistence-2.test.ts` untouched.
5. `npm test`, `npm run typecheck`, `npm run lint` green; `npm run coverage`
   run and committed if anything it reads changed.

### Tests and conformance

New cases in the file that owns declared castings
(`packages/engine/src/counterspell.test.ts` holds the hold/settle fixtures; a
new file is fine if it is clearer). The mutation that must redden them:
delete either field from the settlement's plan.

### Dependencies

None. First mechanism task of the tranche.

### Likely file surface

`packages/engine/src/events.ts` (the record), `commands/casting.ts` (the
write), `commands/spell-resolution.ts` (the read), and one test file.

### Out of scope

Splitting `resolveEffects` (IE-027). Any change to how the two facts are
validated. Any new stated fact — IE-030 adds the third.

### Known risks

`PendingCasting` is folded by `ongoing-compatibility.ts:77`'s neighbour for the
*ongoing* record; check whether a pending record has a parallel upgrade path
before adding a field, and if it does, absent must keep meaning absent.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
