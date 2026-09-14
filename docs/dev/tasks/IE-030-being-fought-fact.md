# IE-030 — The declared "being fought" fact

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — a union task; safe beside IE-031, which touches no file it touches
depends-on: IE-028
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

Let a casting state the fact five SRD spells key a save's Advantage on — "if
you or your allies are fighting it" — as a stated fact of the casting, in the
shape `damageType` already is.

### Why now

The fourth whole-engine audit read the six spells the leverage audit's "C2"
claimed and found **zero consumers made whole**: five of them need a *declared
fact*, not a selector axis on the save. C2 was dropped, and this is the half
that replaces it. The derived map agrees:
`a-fact-only-the-table-can-declare` blocks nine spells and finishes Enthrall
outright, and it is **one of exactly two clauses** on Charm Person and Charm
Monster — the other being IE-032's trigger ending. Build both and those two
spells are finished.

### Current relevant architecture

- `packages/engine/src/commands/targeting.ts:327` — `declaredFacts`, which
  already validates one stated fact: `:348` reads
  `definition.damageTypeStated`, `:371` refuses `damage_type_required` when the
  spell prints the clause and nothing was stated, `:377` refuses
  `unknown_damage_type` when the value is not one the spell offers. **This is
  the mirror to build.**
- `packages/engine/src/bonuses.ts:112` — `ModeSource`, which attributes a mode.
  `CLAUDE.md`: "Because advantage cancels rather than stacks, `modeSources`
  records **every** source including ones that cancelled."
- `PendingCasting` — carries the stated facts as of IE-020, which is the
  carrier a held casting rides on.
- `packages/engine/src/spell-schema.ts` — where the definition clause is
  validated. IE-024 has already made every branch there report rather than
  throw.

### Required behaviour

SRD Charm Person, whole sentence: "One Humanoid you can see within range makes
a Wisdom saving throw. **It does so with Advantage if you or your allies are
fighting it.**" Charm Monster prints the identical sentence. Modify Memory
prints the same rule in different words — "If you are fighting the creature, it
has Advantage on the save" — and is a sixth candidate; read it against its own
paragraph rather than assuming it in or out.

1. A definition clause on a host that rolls a saving throw — an
   `advantageIfFought` flag — refused by the validator anywhere else.
2. `CastSpellRequest.fought: boolean`, **required** when the definition prints
   the clause and **refused** when it does not: the exact mirror of
   `damage_type_required` / `unknown_damage_type`.
3. Carried on the pending record through IE-020's carrier, so a held casting
   settles with the fact its caster stated.
4. Applied as a **named `ModeSource`** inside the save, so it cancels rather
   than counts. Three Advantages against one Disadvantage is a normal roll, and
   this goes through `combineRollModes` like every other mode.

### Architecture constraints

- **It is not `side`.** Allegiance is a different question and may be
  undeclared; "are you fighting it" is a fact about *this casting*, stated by
  the caster, exactly as the damage type is. Substituting `side` would be the
  engine answering the question the caster was asked — the error `CLAUDE.md`
  records for Spirit Guardians' designated creatures.
- It is **not** a `RollModifier` selector. `roll-modifiers.ts` selects by roll,
  relation, ability and skill, and none of those can say "in this casting".
- No default. A boolean with a default is the engine inventing a fact; the
  refusal is the honest answer and costs nothing.
- The consumers' *other* clauses stay in the map: Charm Person and Charm
  Monster still carry the trigger ending until IE-032, and the three Dominates
  carry more besides.

### Acceptance criteria

1. Enthrall's clause is closed and the spell leaves `PARTIAL_SPELLS`, derived
   rather than declared.
2. Charm Person cast with `fought: true` rolls the save with Advantage and
   `modeSources` names the source; with `fought: false` it does not; with the
   field absent the casting is refused and **nothing is spent** — no slot, no
   action, no die.
3. A spell that does not print the clause is refused for stating it.
4. A **held** Charm Person settles with the stated fact — the IE-020 path.
5. Each consumer's clause is re-read against its own SRD paragraph and either
   closed or left with an honest note; the map and `COVERAGE.md` move
   accordingly, and `npm run coverage` is run and committed.
6. Both frozen logs fold unchanged.

### Tests and conformance

Drive both refusals through the public API and pin their codes in
`refusals.test.ts` — IE-018's rule, and these are new codes a tool surface will
branch on. `spell-honesty.test.ts` must agree with the new adjudications in
both directions.

### Dependencies

**IE-028** (the enumerator, `events.ts`). Runs beside **IE-031**, which
touches no file this one does.

### Likely file surface

`spell-definitions.ts` (types and the consumers' definitions),
`commands/targeting.ts`, `commands/spell-resolution.ts`, `spell-schema.ts`,
`events.ts` (one record field), `scripts/missing-shapes.ts`, `COVERAGE.md`.

### Out of scope

A general "choice made at the casting" bag. The delta audit is explicit: two
stated facts exist after this, and a **third** — an ability chosen, for Hex,
Enhance Ability and Bestow Curse — is the evidence for a bag. Two is not.

### Known risks

`fought` is about the caster and *their allies*, not about the target's side.
A fixture that declares sides and then asserts the save proves nothing about
which fact was read.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
