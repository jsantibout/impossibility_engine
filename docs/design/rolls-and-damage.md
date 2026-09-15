# Rolls, modifiers, damage, reaction windows

Read before changing `dice.ts`, `rolls.ts`, `roll-modifiers.ts`,
`checks.ts`, `attack.ts`, `bonuses.ts`, `reactions.ts`,
`commands/attacks.ts`, `commands/damage.ts`, `commands/reactions.ts` or
`commands/rolls.ts`.

## Dice

`dice.ts` is sfc32 seeded through xmur3; its whole state is four integers,
so `snapshot()` / `restoreRng()` persist a generator mid-fight. Every die is
individually addressable (`DieRoll`), which is what per-die effects need —
Great Weapon Fighting's substitution, Sorcerous Burst's explosion, rerolls.

## Provenance

Every roll carries a `RollSource`: `engine`, `physical-dice` or
`dm-override`. Only `rolls.ts` stamps `engine`; `recordExternalD20` and
`recordExternalDamage` refuse it, so the layer above cannot forge the audit
trail. Roll ids are sequential from a caller-supplied prefix, never random,
so a replayed log reproduces every `RollId` it references. Damage takes a
`RollId` the engine issued and never a bare number.

## The D20 pipeline

Checks, saves, attacks, Initiative and death saves are one pipeline
(`checks.ts`): modifiers are **named** (`Bonus` with a source), advantage is
a property of the roll with attributed sources (`ModeSource`), and both are
gathered from the sheet, the creature's conditions, its standing effects and
the granted modifiers on it, then from what the caller supplied. A
`RollModifier` selects by roll family, ability, skill and relation
(roller or target), one selector for spells and class features alike.
Exhaustion is a flat penalty per level, not Disadvantage.

## Damage

Damage is typed components, not a number: each component has a type and a
source, meets the target's defences per type (resistance, vulnerability,
immunity — the creature's own plus granted ones with a source that can end),
and a critical doubles the dice of every component that came from the hit.
`reduceDamage` takes its amount off the total. `resolveDamage` lands the
damage and settles the Concentration save it put at risk in one command.

## Reaction windows

A Reaction is a **window**, not a trigger: `hit-by-attack` (damage unrolled),
`damage-rolled` (rolled, nothing applied), `damaged-by-creature` (landed),
`casting-a-spell`, and the windows class features answer. An attack or damage
resolution holds open (`pendingAttack`, `pendingDamage`, `pendingTest`) while
a window has takers; `reactionOpportunities(state, content)` lists who may
answer and with what, and the hold settles when every taker has acted or
declined. Spells and features share one `ReactionWindow` vocabulary.
