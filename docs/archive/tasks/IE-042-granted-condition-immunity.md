# IE-042 — A condition immunity a spell grants

state: DONE
lane: mechanism
tranche: 7
parallel-safe: CONDITIONAL — `spell-definitions.ts` types, `spell-schema.ts`, its own resolver module, `fold/release.ts`; not beside IE-053 or IE-054
depends-on: IE-051
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 7."

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

## Re-rostered to tranche 7 — 2026-09-14

**Carried forward because it was never launched.** Tranche 6 approved it and the
foreman never ran it: it was correctly held out of two waves — it collides with
IE-046 on `commands/spell-resolution.ts` and with IE-047 on `fold/release.ts` —
and then never picked back up, and the tranche was closed over it with a report
that said "thirteen of thirteen delivered". That report is corrected in the gate
log. The brief is **unchanged**; three bookkeeping lines are not.

- `tranche` becomes **7** and `approved` returns to `none`, to be re-approved
  with tranche 7. The tranche 6 approval lapses with tranche 6; this is
  bookkeeping, not a reversal.
- `depends-on` becomes **IE-051**, which moves the per-kind resolvers into their
  own modules — your new `condition-immunity` resolver lands there, not in
  `commands/spell-resolution.ts`.
- `parallel-safe` names IE-053 and IE-054 as the collisions: IE-053 owns
  `fold/release.ts`, and IE-054 owns a reader in `spell-definitions.ts`.

Three things to read with the brief, all of which changed under it:

- **IE-040 built the printed half**, which is the gatherer this reads:
  `conditionImmunitiesOf` in `standing.ts`, `CreatureState.conditionImmunities`,
  and `applyConditionTo` reading state. Your grant is its **second input**, and
  it unions — a grant may never weaken what is printed.
- **`SpellEffectOptions.immuneTo` may already be gone.** IE-040 left it with
  zero writers because the file was held; IE-053 deletes it. If it is still
  there when you arrive, say so rather than working around it.
- **This is the only capability family tranche 7 can honestly carry.** Every
  other shape in `COVERAGE.md` reads `Finishes (read) = 0`; this one reads 1,
  because IE-044 backfilled its ten claimants. That is why the roster looks
  correctness-heavy, and it is also why acceptance criterion 7 — re-reading the
  nine remaining claimants one at a time — is the part that must not be rushed.

## Completion digest

**Merged `60348ef`**, reviewer PASS at high confidence, round 2. `main` green at
**8,720 tests across 127 files**; both frozen logs untouched.

**The task tranche 6 lost is shipped.** It was approved in tranche 6, held
correctly out of two waves because it collided with IE-046 and IE-047, then
never picked back up — the failure that produced IE-058. Re-rostered here and
delivered.

### The foreman put two owners on one primitive, and the builder caught it

The launch prompt told this builder *"Neither shares a file with you"*. **That
was wrong.** IE-056 owned `packages/engine/scripts/missing-shapes.ts` and
`packages/engine/src/blocked-on.test.ts`, and this brief's **required behaviour
6 forces the builder into both**. That is a one-owner-per-primitive violation
and the foreman caused it.

**Why it did not cost anything**, and none of the three reasons is luck:

1. **The builder read its own brief against the launch prompt, found the
   contradiction, and said so** rather than assuming the foreman knew — with the
   overlap characterised precisely: *by content, not by region*; it touched only
   the ten `a-condition-immunity-a-spell-grants` claimants, the `MISSING_SHAPES`
   vocabulary and the one `describe` block about that family, while IE-056
   worked four other families.
2. It named the two fixture changes a merge would hide: two assertions moved off
   `mind-blank` (now defined) onto `heroes-feast`, and the `SOLE` row
   `['mind-blank', ...]` replaced with `['heroism', 'a-payout-at-a-turn-boundary']`.
3. **It told the foreman not to trust a clean auto-merge** — *"a mechanical merge
   will leave the map saying something false, so the foreman should resolve it by
   reading."*

**It was right, and the falsehood was in a third file neither of us named.**
`missing-shapes.ts` and `blocked-on.test.ts` auto-merged cleanly. The conflict
landed in `persistence-2.test.ts`, and the part git *silently* merged was worse
than the part it flagged: IE-055 and IE-042 had each added a paragraph to the
uncovered-event ledger, and **both correctly wrote "is the fifth"** against a
`main` that held four. The merge produced two fifths, in an order running third,
fifth, fourth, fifth. No test could see it — it is prose.

Resolved by reading: `combatant-joined` is the fifth (it merged first),
`condition-immunity-granted` is the sixth, and the out-of-order paragraph was
moved to where its ordinal says it belongs.

### The real finding: `parallel-safe` is a hand-kept list that its own brief contradicts

This brief's `parallel-safe` line names *"`spell-definitions.ts` types,
`spell-schema.ts`, its own resolver module, `fold/release.ts`"*. It does **not**
name `missing-shapes.ts` or `blocked-on.test.ts` — which requirement 6 makes
mandatory — nor `persistence-2.test.ts`, where the collision with IE-055 actually
happened. Two independent collisions in one wave, both from a summary line that
the brief body contradicts.

**That is this repository's most-repeated failure shape wearing a new hat**: a
hand-maintained list of something derivable. The foreman schedules from that line
and it is not sound. Recorded in `LATER`.

### Two new shape ids, and why they are not the precedent they look like

The retired `a-condition-immunity-a-spell-grants` leaves two residues:
`a-condition-immunity-narrowed-to-its-source` (**4** claimants) and
`a-condition-a-spell-suppresses` (**1**).

A one-claimant shape looks inconsistent with the foreman's decision earlier today
that Creation stays out of `an-area-a-slot-scales` for having one consumer. **It
is not, and the distinction is worth stating so the record does not contradict
itself.** The two-writer bar governs *inventing* a shape. These are **residues of
a bundle that was split after reading all ten entries** — IE-015's recorded
pattern — and a residue inherits the bundle's justification. Creation would be a
new id with one writer and no bundle behind it.

### Criterion 7: nine claimants re-read entry by entry

Four turn out to be **expressible** and are freed — Calm Emotions' first clause,
Gaseous Form, Heroes' Feast, Heroism, Wind Walk. Four are narrowed by their
source: Freedom of Movement (*"spells and other magical effects"* — a Ghoul's
claws still land), Hallow, Magic Circle, Protection from Evil and Good. One is
suppression rather than immunity. Hallow's second clause was **re-filed** to
`a-standing-effect-derived-from-where-a-creature-stands`, where its sibling
clause Fear already sat.

**And the re-reading paid somewhere else entirely**: freeing Heroism leaves it
with one blocker and hands `a-payout-at-a-turn-boundary` a **read** finish, which
is visible in `COVERAGE.md` as that family moving out of the zero table. A
capability task that ungates a *different* family by reading carefully is the
instrument working exactly as IE-044 intended.

### Verified

Mind Blank enters verified — **98 executed, 76 verified** — the retired shape
leaves the table and the two residues enter. The end-to-end fixture is the
discriminating one the reviewer named: a Charm Person aimed at the protected
fighter **and** an unprotected squire on one seed, asserting **both saves
failed**, so the refusal cannot be confused with a lucky roll. Two mutations,
both biting: dropping the `grantsOf` line fails `tsc` with TS2741 naming the
property — the mapped-type guard doing its job — and dropping the union in
`conditionImmunitiesOf` fails four tests.

`COVERAGE.md` was **regenerated at integration rather than merged**, which is
this repository's rule for it; the builder's copy was correct for a base without
IE-056.

### Reported, not acted on

- `conditionApplicability` at `monster.ts:266` still takes an `AdaptedMonster`
  rather than a `CreatureState` — **verified, read, and deliberately untouched**.
  That is the boundary that let this bundle split cleanly, and it is the exact
  thing that made the derived `unblocks` query mispredict Mind Blank two tranches
  ago.
- `grant-enumerator.test.ts` exercises four of seven families at runtime — a gap
  predating families five and six.
- The `save` host reports `affected: true` on a failed save even when the
  condition was refused as immune, with `conditions: []` carrying the truth —
  pre-existing, identical for a printed immunity.
