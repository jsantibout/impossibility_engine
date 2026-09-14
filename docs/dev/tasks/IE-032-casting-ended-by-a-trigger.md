# IE-032 — A casting ended by a trigger

state: IMPLEMENTING
lane: mechanism
tranche: 5
parallel-safe: NO — a union task touching `events.ts` and `spell-resolution.ts`; runs alone
depends-on: IE-027, IE-028, IE-030
worker: qb-builder · .claude/worktrees/agent-a8c3683dd1f652c5b · worktree-agent-a8c3683dd1f652c5b
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

Let a definition say that its casting ends early when something happens, and
end it — derived, in the reducer, the way expiry and a lost Concentration
already are.

### Why now

`a-casting-ended-by-a-trigger` blocks **29 spells, eight of them executed
definitions the engine drives today and leaves unfinished** — the largest
executed-spell debt in the map. Four of those eight carry it as their **only**
clause: Invisibility, Mage Armor, Animal Friendship and Suggestion. Two more —
Charm Person and Charm Monster — carry it plus IE-030's fact, so with IE-030
merged this finishes both. Mislead is finished outright.

### Current relevant architecture

- `packages/engine/src/events.ts` — `expireEffects` (`:3351`) and the derived
  Concentration pass are the precedent: nobody decides either, so neither
  writes an event.
- `releaseCasting` (`:1999`) is the single door a casting leaves by;
  `releaseOnTarget` (`:2230`) releases it on one creature.
- `OngoingSpell` in `spells.ts` — where the trigger list is pinned at the cast,
  exactly as `area` and `areaTrigger` are: *pinned for the casting, read live
  for the creature it is happening to.*
- `CreatureState.lastDamage` — already records who dealt the most recent
  damage, built for Hellish Rebuke's "in response to".
- IE-028's `grantSourcesOf` / `withoutGrants` — the enumerator this cleanup
  routes through.

### Required behaviour

A closed `endsEarly` list on the definition, each member transcribed from a
printed sentence:

| Member | SRD |
|---|---|
| `target-attacks`, `target-deals-damage`, `target-casts` | Invisibility: "The spell ends early immediately after the target makes an attack roll, deals damage, or casts a spell." |
| `target-dons-armor` | Mage Armor: "The spell ends early if the target dons armor." |
| `caster-or-ally-damages-target` | Animal Friendship: "If you or one of your allies deals damage to the target, the spells ends." (transcribed as the raw file prints it). Charm Person: the Charmed condition lasts "until the spell ends or until you or your allies damage it." Suggestion: "or until you or your allies deal damage to the target." |

Pinned on the ongoing record, and a **derived pass in the reducer after each
event** that releases the casting — or releases it **on that target** for a
multi-target charm, which is the distinction `releaseOnTarget` exists for.

Two constraints, both decided:

1. **Hang a trigger on the consequence event, never on `roll-recorded`.**
   `roll-recorded` changes no state by rule; a trigger there would fire on a
   roll whose outcome had not happened.
2. **Where "ally" needs a `side` nobody has declared, the ending is withheld,
   not invented** — the same three-valued reading Sneak Attack takes. A derived
   pass has no `unverified` line to write, so expose it as a **query** a caller
   can ask instead.

### Architecture constraints

- **Derived, so no event.** Nobody decides that a target attacked; the reducer
  finds it. This is the audit trade `CLAUDE.md` already records for expiry and
  Concentration, and it is deliberate.
- Pinned on the record at the cast. A correction to a definition must not reach
  a casting made before it — the rule IE-007 established for the area.
- Route the cleanup through IE-028's enumerator. Do not add a sixth hand-walk.
- A trigger that would need a fact the log does not hold is **filed in
  `missing-shapes.ts`, not modelled**. Do not widen the list to make a spell
  fit.

### Acceptance criteria

1. Invisibility ends when its target attacks, deals damage, or casts — three
   cases, each driven end to end.
2. Mage Armor ends when the target dons armour, through `equipItem`. Its
   granted Armour Class goes with it, through the enumerator.
3. Animal Friendship and Suggestion end when the caster or a declared ally
   damages the target; with **no side declared**, the casting stands and the
   query says why.
4. Charm Person and Charm Monster leave `PARTIAL_SPELLS` — with IE-030 merged,
   both clauses are closed. Mislead is finished.
5. A multi-target charm releases **on the damaged target only**; the casting
   runs for everyone else.
6. Both frozen logs fold unchanged; `npm run coverage` run and committed.

### Tests and conformance

`spell-honesty.test.ts` must agree in both directions: every clause closed here
leaves the adjudication map, and no shape is left claiming nothing. The derived
count of `PARTIAL_SPELLS` moves; it is not edited by hand.

### Dependencies

**IE-027** (the resolver split), **IE-028** (the enumerator), **IE-030** (the
fact that finishes the two charms alongside this).

### Likely file surface

`spell-definitions.ts` (types and eight definitions), `events.ts` (record field
and the derived pass), `spell-schema.ts` (one rule),
`commands/spell-resolution.ts` (the record write), `scripts/missing-shapes.ts`,
`COVERAGE.md`.

### Out of scope

Any trigger whose fact the log does not hold. Hypnotic Pattern's "someone else
uses an action to shake the creature out of its stupor" — an action a spell
grants, which is a different named shape.

### Known risks

The derived pass runs after **every** event. It must be cheap and it must not
re-enter: releasing a casting emits nothing, but it does change state that the
same pass then reads. Establish termination explicitly, the way `expireEffects`
does.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
