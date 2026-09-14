# IE-042 — A condition immunity a spell grants

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `spell-definitions.ts` types, `spell-schema.ts`, `commands/spell-resolution.ts`, `fold/release`; not beside IE-040, IE-043, IE-046, IE-047 or IE-048
depends-on: IE-040
worker: none
approved: none
merge-approved: none

## Brief

### Objective

The seventh sourced grant family: a condition immunity an effect grants, ended
through the door the other six already use.

### Why now

`a-condition-immunity-a-spell-grants` blocks 10 spells and finishes 1 (Mind
Blank) — verified in `COVERAGE.md`. It is the narrower id IE-017 left behind
when it built damage defences and correctly did **not** touch
`conditionApplicability`; the bundle's other half is now the residue. IE-040
builds the printed storage and the gatherer this reads, which is why printed
comes first and granted second.

### Current relevant architecture

- `CreatureState` — six sourced grant families; `GrantFamily` is **derived
  from the shape of `CreatureState`**, so declaring a seventh field makes
  `grantsOf` a compile error naming the property it lacks. That is the guard
  IE-028 built; the fifth and sixth families each cost one line.
- `fold/release` (after IE-039) — `releaseCasting`, `releaseOnTarget`,
  `releaseGrants`, `expireEffects`, `holdsNothingOf`, all through
  `grantSourcesOf` and `withoutGrants`.
- IE-040's `conditionImmunitiesOf(state, who)` — the gatherer this becomes a
  second input to.
- `checkGrantLifetimes` in `spell-schema.ts` — a grant on an Instantaneous
  casting with no lifetime is `grant_without_lifetime`.

### Required behaviour

1. `grantedConditionImmunities` on `CreatureState`; `condition-immunity-granted`
   as the event; a `condition-immunity` **effect kind** in the definition
   format, with its own per-kind resolver in the resolver set IE-027 created.
2. The grant carries a `source`, so `releaseCasting`, `releaseOnTarget` and an
   `EffectTarget.grants` deadline end it with no lifecycle of its own. The
   enumerator line `grantsOf` demands is the whole of the plumbing.
3. `conditionImmunitiesOf` gains it as a second input and **unions**; multiple
   instances of immunity to one condition count as one, and a grant may never
   weaken what is printed.
4. `checkSpellDefinition` gains the format rules: an unknown condition name is
   refused, and a grant on a casting that never becomes ongoing is
   `grant_without_lifetime` like every other grant.
5. **Mind Blank is defined.** Its Psychic damage immunity is IE-017's existing
   kind and its Charmed immunity is this one; the definition is read against
   its own SRD paragraph and carries adjudications for whatever is left.
6. `missing-shapes.ts`: the other nine claimants are **re-read one at a time**
   — Heroism, Freedom of Movement, Heroes' Feast, Hallow and the rest lose this
   clause and keep their others. The shape retires only if nothing claims it,
   and narrows rather than being renamed if the residue is real.

### Architecture constraints

Settled; a deviation is `ARCHITECTURE_BLOCKED`:

- the seventh family goes through the existing enumerator — no new walk, no
  per-family release code;
- one gatherer shared with the printed immunities, not a second table;
- a granted immunity is unconditional by construction; qualified entries remain
  IE-040's `needs-adjudication` and are untouched here.

### Acceptance criteria

1. A creature under Mind Blank cannot be Charmed; when the casting ends, it
   can. Driven end to end through the public resolution path.
2. The grant ends by **all three** doors: the casting ending, a release on one
   target, and a `grants` deadline.
3. Two castings granting the same immunity: one ending leaves the other
   standing.
4. A printed immunity and a granted one on one creature answer once, and the
   printed one survives the casting ending.
5. `grantsOf` would not compile without the enumerator line — asserted by the
   mutation IE-028's tests already use (remove the family from the literal and
   the build goes red).
6. A definition granting an immunity on an Instantaneous spell is refused
   `grant_without_lifetime`.
7. `COVERAGE.md` regenerated; the re-read of the nine claimants is in the
   digest, entry by entry.

### Tests and conformance

The gauntlet, the frozen logs (the new event type is outside both by
construction — add it to `persistence-2.test.ts`'s uncovered-type ledger with
its reason, as the three before it are).

### Dependencies

IE-040 (the gatherer and the printed storage).

### Out of scope

Condition immunity a **feature** grants. Anything about `conditionApplicability`
beyond reading it. Summons.

### Known risks

Low — the fifth and sixth families each cost one line and the compiler forces
the seventh. The content half (nine re-reads) is where the time goes, and it is
the half that must not be find-and-replaced.
