# IE-017 — A Resistance an effect grants, and the deadline it needs

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 4
parallel-safe: NO beside another union task; YES beside conformance and command-surface work
depends-on: IE-014
worker: none
approved: none
merge-approved: none

## Brief

### Objective

Let an effect grant a Resistance, Immunity or Vulnerability with a source and a
lifetime, as `defensesOf`'s third input — and add the one `EffectTarget` member
that lets such a grant end before its casting does.

### Why now

Wave 3's union task, and **the numbers are the re-derived ones, not the
leverage audit's.** That document claimed 4 spells and 5 features; the fourth
whole-engine audit (§4) read the SRD text and found **2 spells whole, 1
partial, and 1 feature**:

- **Stoneskin** — whole.
- **Protection from Energy** — whole, reusing `damageTypeStated`, because a
  type stated at the cast already exists (Spirit Guardians).
- **Protection from Poison** — partial; its first sentence is IE-014's
  condition removal, and the rest is adjudicated.
- **Absorb Elements is not in SRD 5.2.1 at all** — `spells.md` has no such
  heading. The leverage audit was wrong to list it.
- On the feature side: **Rage's resistance is already executed**
  (`barbarian.ts:98`, `standing.ts:710`); Elemental Affinity is applied per its
  own note; Fiendish Resilience is "re-chosen on a rest"; the Monk's Superior
  Defense is Rage's shape with twelve types and a minute, a content task with
  no engine change. **Only Superior Hunter's Defense needs the grant** — and
  it is exactly "a Resistance with a deadline" (`classes.md:6838`, "until the
  end of the current turn"), which is what forces the second half of this task.

It survives that correction as still the cheapest new grant kind, on honest
numbers, and it is the task where a deadline on a grant stops being a named gap.

### Current relevant architecture

- `defensesOf` (`standing.ts:727`) — **the gatherer already exists** and merges
  a stat block's defences with feature grants. A casting's grant is its
  **third input**, not a second merge.
- The three sourced-grant precedents on `CreatureState`, all of which
  `releaseCasting` and `releaseOnTarget` already end through one door:
  `bonuses` (`bonus-applied`), `GrantedArmorClass` (`armor-class-granted`), and
  `rollModifiers` (`roll-modifier-granted`). This is a fourth instance of that
  pattern.
- `conditionApplicability` (`monster.ts:266`) — three answers, not a boolean,
  because a *qualified* defence ("except from its vampire master") is not an
  unconditional one. A granted defence is unconditional by construction; read
  that function so the distinction is preserved rather than flattened.
- `applyDamage`'s ordering, which `CLAUDE.md` states: adjustments, then
  Resistance, then Vulnerability, and both are booleans rather than counts.
- `EffectTarget` (`duration.ts:139`) — three members: `condition`, `casting`,
  `feature`.

### Required behaviour

1. A `SpellEffect` member granting one or more damage types as Resistance,
   Immunity or Vulnerability, sourced (`Spell#cast:N`) and ending with its
   casting through the existing door.
2. `defensesOf` takes the granted set as a third input. **Multiple instances of
   Resistance still count as one** — it is a boolean, not a tally.
3. **A fourth `EffectTarget` member**, exactly as Fable specified:
   `{ kind: 'grants'; on: CharacterId; source: string }` — every grant that
   source made on that creature. The operation already exists;
   `releaseOnTarget` performs it by casting, and this is the same operation on
   a deadline. `source` rather than `castingId`, **so a feature and a casting
   use one member**.
   It is **one member, not four**: a per-grant-kind member would need a
   per-kind identity on the timer (`rollModifierKey` against `source`) and
   would be four ways to write one sentence.
4. **Superior Hunter's Defense is the timer's user**, and its inclusion is what
   justifies the member. If the builder finds it needs more than the grant and
   the deadline, it reports rather than widening, and the member is still
   built with the spells as users of the grant alone.
5. Proving spells with SRD lines quoted: Stoneskin, Protection from Energy
   (with its type stated at the cast).

### Architecture constraints

- No new state container. A granted defence sits on `CreatureState` beside the
  three existing sourced grants and dies through `releaseCasting` /
  `releaseOnTarget` with them.
- Do not change `applyDamage`'s ordering or make Resistance a count.
- Do not fold the qualified-defence distinction away. Granted defences are
  unconditional; the stat block's qualified entries stay out of the automatic
  tables exactly as they are now.
- Both frozen logs fold unchanged.
- If the `grants` member turns out to need a per-kind identity after all, that
  is `ARCHITECTURE_BLOCKED` — Fable specified one member and the reason.

### Acceptance criteria

1. A failing test first: a creature with a granted fire Resistance takes half
   from a fire effect, and the full amount once the casting ends.
2. A grant with a deadline expires on time and leaves the casting running —
   the `grants` member driven end to end, with Superior Hunter's Defense or, if
   it is deferred, a hand-built feature grant.
3. Resistance granted twice is still Resistance once, asserted.
4. A granted Immunity and the stat block's own qualified entry coexist without
   the qualified one becoming unconditional.
5. `COVERAGE.md` regenerated; both frozen logs fold; the whole gauntlet passes.

### Dependencies

**IE-014**, which precedes it in the union chain. The foreman rebases.

### Likely file surface

`packages/engine/src/spell-definitions.ts`, `commands/spell-resolution.ts`,
`standing.ts` (`defensesOf`), `events.ts` (the grant's state and its cleanup),
`duration.ts` (the `EffectTarget` member), `spell-schema.ts`, a spell test
file, `coverage.ts`, `COVERAGE.md`, `CLAUDE.md`.

### Out of scope

The Monk's Superior Defense and Fiendish Resilience (content and a rest-time
re-choice); Death Ward; damage an effect forbids; the qualified-defence
adjudication, which stays as it is.

### Known risks

- This is the tranche's only task touching `events.ts` **and** `duration.ts`
  **and** the union. It is weighted accordingly and sequenced last among the
  union tasks for that reason.
