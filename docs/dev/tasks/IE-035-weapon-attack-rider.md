# IE-035 — A rider on later weapon attacks, and a duration the slot changes

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — a union task; safe beside IE-036, which touches only definitions and the registry
depends-on: IE-034
worker: none
approved: none
merge-approved: none

## Brief

### Objective

Two shapes the map ranks together because two spells need both: a sourced rider
on the caster's later weapon attacks, and a duration that changes with the slot.

### Why now

`a-rider-on-a-later-weapon-attack` blocks 10 spells and finishes three on its
own — Divine Favor, Magic Weapon, True Strike.
`a-duration-the-slot-changes` blocks 10 and finishes Major Image. **Hunter's
Mark is blocked on exactly these two and nothing else**, verified against the
derived map, so building them together finishes it as well.

Hex needs both *and* a third — an ability chosen at the casting — so it stays
blocked, and that is the evidence the audit wanted for a "choice at the
casting" bag: a third stated fact, in a later cycle.

### Current relevant architecture

- `resolveAttackDamage` and `featureDamageTypes` — where a class feature's
  extra damage already reaches a hit. The rider is read **beside** it, as a
  sixth member of the enumerated family IE-028 built.
- IE-028's `grantSourcesOf` / `withoutGrants` — the door this grant is ended
  through.
- `persists(definition)` — where the deadline is scheduled from the duration.
- `OngoingSpell` — the record the marked target is pinned on.

### Required behaviour

Two sub-shapes and one grant.

**The rider.** A sourced rider on the **caster's** attacks — dice, damage type,
and an optional **marked target** or none:

- SRD Divine Favor: "Until the spell ends, your attacks with weapons deal an
  extra 1d4 Radiant damage on a hit." No marked target.
- SRD Hunter's Mark: "you deal an extra 1d6 Force damage to the target whenever
  you hit it with an attack roll." A marked target.
- SRD Hex: "you deal an extra 1d6 Necrotic damage to the target whenever you
  hit it with an attack roll." Also marked, and blocked on its chosen ability.

**The duration.** `durationAtSlot: { level: seconds }` on the definition, read
where `persists` schedules the deadline:

- SRD Hunter's Mark: "Your Concentration can last longer with a spell slot of
  level 3–4 (up to 8 hours) or 5+ (up to 24 hours)."
- SRD Hex prints a different set of bands: "level 2 (up to 4 hours), 3–4 (up to
  8 hours), or 5+ (24 hours)." **Two spells, two tables — this is why the field
  is per-definition and not a formula.**
- The three Dominates and Mass Suggestion print the same shape; read each
  against its own paragraph.

### Architecture constraints

- A sixth member of the sourced-grant family, **through IE-028's enumerator**.
  Do not add a sixth hand-walk.
- The extra damage is a second damage **component** with its own source, not a
  bonus folded into the weapon's: it meets the target's defences as its own
  type, and a Critical Hit doubles its dice. The reading `featureDamageTypes`
  already takes.
- Magic Weapon needs `replacesPriorCasting` — the Mage Hand rule, already in
  the vocabulary. Do not invent a second mechanism for it.
- **Hex's chosen ability stays a named gap.** Do not build a choice bag for one
  spell.

### Acceptance criteria

1. Divine Favor, Magic Weapon and True Strike leave the undefined population;
   Hunter's Mark leaves it too, on both shapes at once; Major Image's duration
   clause closes.
2. The rider's damage is typed: a fixture whose target **resists** the rider's
   type but not the weapon's shows the two applied separately. An undefended
   dummy cannot tell the two apart — the lesson `featureDamageTypes` already
   carries.
3. Hunter's Mark at slot level 3 lasts eight hours and at 5 twenty-four, driven
   past the deadline; Hex's own bands differ and are not shared.
4. The grant ends with the casting through the one door: a dispel, a broken
   Concentration and the deadline all take the rider away.
5. Hex stays blocked, on its chosen ability alone, and the map says so.
6. `npm run coverage` run and committed; both frozen logs fold unchanged.

### Tests and conformance

`spell-honesty.test.ts` in both directions. The rider's interaction with a
Critical Hit needs its own case: dice double, flat does not.

### Dependencies

**IE-034.** Runs beside **IE-036**, colliding only on registry lines.

### Likely file surface

`attack.ts`, `commands/attacks.ts`, `events.ts`, `spell-definitions.ts`,
`spell-schema.ts`, `commands/spell-resolution.ts`, `scripts/missing-shapes.ts`,
`COVERAGE.md`.

### Out of scope

Hex's chosen ability. Bestow Curse, Enlarge/Reduce, Alter Self and Shillelagh,
each blocked on something else besides. Any change to how a class feature's
rider works.

### Known risks

"Your attacks with weapons" (Divine Favor) and "whenever you hit it with an
attack roll" (Hunter's Mark) are **not the same clause** — one is weapon
attacks, the other any attack roll. Transcribe each rather than sharing one
predicate, and let the difference be data.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
