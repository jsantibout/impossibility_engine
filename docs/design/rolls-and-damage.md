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

**A grant can also be spent.** SRD Guiding Bolt says "the next attack roll
made against it" and Vicious Mockery "the next attack roll it makes": a
modifier used up by the roll it reaches, rather than one that runs until the
thing that made it ends. `RollModifier.oneShot` marks it, and
`roll-modifier-consumed` is how it ends — one event, emitted by the rolling
command beside `roll-recorded`, whose fold body is the same `releaseGrants`
call a `grants` deadline makes. Both endings stand and the first to arrive
wins; a consumed grant simply leaves its timer standing over nothing. **The
rule is the roll it reached, not the roll it changed**: a one-shot
Disadvantage cancelled to `normal` by an Advantage is still spent, because the
SRD sentence counts rolls and not outcomes. Only the two attack rollers spend
one today, and `oneShotProblem` refuses the flag on any other family rather
than letting a definition promise an ending nothing keeps.

**A selector may pin the other participant.** `RollSelector.counterpart`
narrows a modifier to rolls involving one named creature — Vex's "against that
creature", Bestow Curse's "against you" — and it is the participant the
relation does not name. It is not a third `RollRelation`, because an enum
member cannot hold an id; it is part of `rollModifierKey`, so an attacker
holds one per creature rather than one in total; and it is legal only on an
attack roll, for the reason `against-holder` is. A definition names a role and
the rider resolver binds it.

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

A sixth window, `creature-falling`, and **the first opened by a declaration
rather than by a resolution**. The other five are points in something the
engine is in the middle of doing — an attack it rolled, damage it typed, a
test it settled, a casting it is holding — and the moment is open because the
engine has not finished. Nothing in the engine drops a creature off anything,
so this one is open because somebody at the table said a fall happened,
exactly as they say where the cover is. It is still a *window* rather than a
trigger bus because it closes on the same two facts as the rest — the turn in
combat, the clock outside one — and holds nothing open. The fact is
`CreatureState.falling`, `lastDamage`'s twin with the dealer dropped, and it
carries no height, no rate and no landing: those are the table's numbers, and
a window that recorded one would be the engine inventing it.
