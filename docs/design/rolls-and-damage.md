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

**A rule may also read a whole roll.** `RollRule` / `rollUnder` judge the
total rather than a face: SRD Savage Attacker's "roll the weapon's damage dice
twice and use either roll" is `roll-twice-keep-either`, reached through the
`attack-roll-rule` standing grant, applied to the weapon's own component only,
after a critical has doubled the notation, once per turn. The losing throw's
dice ride along `dropped` exactly as a keep clause's do, so both throws are one
`RollOutcome` under one id and the log shows what was given up. "Either" is
the higher, stated rather than asked — a second way for a replay to diverge is
not a decision worth offering a caller.

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

**One reroll lives inside the pipeline.** SRD Halfling Luck's "reroll the die,
and you must use the new roll" is neither a mode (weighed before the die) nor a
Reaction at a window (Indomitable's `rerollTest`): `rollD20Recorded` rethrows
the counted die when the sheet's `rerollsD20On` says so — derived onto
`CharacterSheet` from a `reroll-test-die` standing grant, so every site that
throws a D20 Test reaches it through `sheetAsItStands` with nothing to
remember; Initiative and the death save, the two rollers handed no sheet, are
wired by hand. The new face is used even when it is worse, a 1 on it is not
chased, a stated die is untouched, and `roll-recorded.supersedes` keeps the
first face so the audit trail shows both.

A casting's damage may be altered before it is rolled, by the caster's own
features and by nothing else. The alterations are gathered once, at the
casting, and reach the three sites a casting rolls damage at and the one
notation it pins; they do not reach an area settling later, an activation, a
scheduled hit or an item's conferral, because each of those is a moment the
five SRD features do not speak about. A maximised casting throws nothing at
all, so the generator has not moved and a replay reproduces it for free.
Overchannel's price is a `Tally` — a count with no ceiling, because a pool of
one would refuse the second use where the book charges for it — and its damage
is dealt against no defences at all, which is what "ignores Resistance and
Immunity" names.

**A second reroll is elected before the die and read against it.** SRD Heroic
Inspiration — "you can expend it to reroll any die immediately after rolling
it, and you must use the new roll" — reaches a roll that succeeded, an attack
roll and a damage die, and none of those lands in a window. A window on every
die was tried and withdrawn: a table would then settle one before every next
roll. So the roller states the *condition* on the command that rolls — reroll
if this misses, if this fails, or if the die shows a named face or lower —
naming a pool that a `reroll` Reaction of theirs spends. `RollElection` is the
statement, `electedRethrow` reads it against the roll as it stands, and
`rethrowCountedD20` is the one rethrow it shares with Halfling Luck, so the
two can never disagree about which die counted. It is intent from the caller
and a number from the engine, and it is still a decision made knowing the die,
because the condition is a function of the face. The pool is spent only where
the condition was met, the first face rides on `roll-recorded.supersedes`, and
the second roll stands whatever it shows. **Only a reroll of "any die" may be
elected**, read off the `tests` its Reaction declares: naming both kinds of
D20 Test is how "any die" is already spelled on that window, so a reroll
naming both is electable anywhere and a narrower one keeps the window road it
has. Indomitable is the narrower one — "if you **fail** a saving throw", with
a bonus equal to your Fighter level — and electing it would go wrong twice: a
face condition would throw a *made* save again, and the pipeline rethrow
carries no `Bonus`, so the Fighter level would vanish. A grant with a bonus on
it is refused for that second reason alone, whatever its `tests` say. The
window keeps its arm, because Indomitable and Cutting Words share it and a
player may prefer to look first; what the same pool may not do is buy a second
reroll of a die an election already threw again. A damage election names a die
by its position **among those that counted**, and a position past the end
simply does not fire — how many dice a swing throws is settled by the critical
and by whatever doubled the notation, so a caller cannot know the count
beforehand, and refusing a swing the engine had already rolled would leave the
generator advanced and make the retry a different swing.

**A selector may name a family of D20 Tests, and it must then name the ability
behind them.** `RollFamily`'s sixth member is the glossary's own union of the
other three — an ability check, an attack roll, a saving throw — and it
arrived with the spell that needed it rather than ahead of one: SRD Ray of
Enfeeblement's "Disadvantage on Strength-based D20 Tests" is a single sentence
over three families, and three selectors would read as three sentences.
`rollSelectorProblems` refuses the family with no ability on it, because every
consumer in reach prints the narrowing and a bare one would reach every roll its
holder ever made. Initiative and the death save are not in the union, for the
reason they are not in the families they resemble: neither is made with an
ability, so no narrowed selector could ever pick one out.

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
`reduceDamage` takes its amount off the total. A granted reduction (SRD
Resistance's d4, `damage-reduction.ts`) is rolled where the damage lands and
fed to `adjustmentsFor` on both the ordinary and the held road, so it comes off
before the halving — the SRD's order — and once per turn through the
`feature-used` ledger. `resolveDamage` lands the damage and settles the
Concentration save it put at risk in one command.

**A creature may be made to subtract from its own damage rolls.** SRD Ray of
Enfeeblement's 1d8 and SRD Enlarge/Reduce's 1d4 are the mirror of the granted
reduction above: that one stands on whoever is *hit* and this one on whoever
*swung*, so a single family would have made a Ray of Enfeeblement on the ogre
protect the ogre. It is a sourced grant rather than a `BonusApplies` member,
which still names no damage, because the sentence fixes no moment, no source and
no type — it is a standing arrangement every later damage roll consults.
`damagePenaltyOf` is the one reader, shared by the road a defender is holding
open and the one nobody may answer, and its die is thrown where the damage is
rolled and reaches the log as its own line; the amount joins the ward's in one
adjustment, which is SRD's order. A floor — "this can't reduce the damage below
1" — is read against the blow's total, and absent is no floor at all.

A cantrip may be cast **with** a swing (SRD True Strike): `AttackCommand.cantrip`
names it, the attack command casts it as the Magic action before the roll, a
`weapon-attack` effect imposes the spellcasting ability on both rolls and
offers its damage type, and no `attack-made` is emitted because no Attack
action was spent. Nothing outlives the swing.

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
`CreatureState.falling`, `lastDamage`'s twin with the dealer dropped.

**The height is still the table's; the landing is now the engine's.**
`resolveFall` (`commands/movement.ts`) takes a height somebody states and
deals 1d6 Bludgeoning per ten feet to a maximum of 20d6, through the damage
path a Fire Bolt already takes, with the Prone condition on landing unless the
drop cost nothing. What has not changed is who says how far: a height is a
fact about the room, the same class as the Hydra's active head count, so when
the fall gets a tool that tool is **DM-only** — a model stating a height
converts directly into 20d6; that tool is `resolve_fall`. A reduction comes off
the landing's dice when the faller elects a feature by name — SRD Slow Fall is a
`fall-damage-reduction` standing grant, read by `resolveFall`, which spends the
Reaction where a fight is running — but no *window* opens on a fall:
`FeatureReactionWindow` still excludes `creature-falling`, which is why Feather
Fall, a spell cast in answer to somebody else's fall, does not work yet.
