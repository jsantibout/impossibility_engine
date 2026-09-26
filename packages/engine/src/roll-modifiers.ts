import {
  CONDITIONS,
  type Ability,
  type CharacterId,
  type ConditionName,
  type RollMode,
  type Skill,
} from '@ie/shared';
import type { ModeSource } from './bonuses.js';
import type { GameState } from './events.js';
import { SENSE_NAMES, type SenseName } from './positioning.js';

/**
 * Advantage and Disadvantage as a property of a *particular roll under
 * particular circumstances*, rather than as a thing a caller remembers to pass
 * in.
 *
 * The engine has always had the two halves that bracket this. `ModeSource`
 * carries one attributed mode, and `combineRollModes` settles a list of them
 * into the SRD's presence rule. What sat between them was nothing: a mode came
 * from a hard-coded reader per roll family — `standingSaveModes`,
 * `standingSkillModes`, `standingInitiativeModes`, `attackedWithDisadvantage`
 * — each of which knew one question and could answer no other. A spell that
 * says "any creature has Disadvantage on attack rolls **against you**" had
 * nowhere to be written down at all.
 *
 * So this module is one question, asked once:
 *
 * > **Does this source modify THIS roll?**
 *
 * Everything here exists to make that answerable from authoritative state
 * without a spell name, a narration, or a caller's judgement.
 *
 * **It is a selector, not a predicate language.** Every field is a closed
 * union naming a rule concept the engine already resolves, and there is no
 * expression, no callback and no string to interpret. A definition that cannot
 * be said in this vocabulary is a shape that has not been built, which is the
 * honest answer and the one the coverage tables are for.
 */

/**
 * Which kind of roll a modifier reaches.
 *
 * Six members. The two that look redundant are the two the SRD is most
 * insistent about:
 *
 * - **`initiative` is not `ability-check`.** Initiative *is* an ability check
 *   — the Alert feat's Proficiency Bonus applies for exactly that reason — but
 *   the SRD grants Advantage on "Initiative rolls", which is a smaller set
 *   than "Dexterity checks". Feral Instinct does not help a Barbarian pick a
 *   lock. The engine has kept the two apart since that grant landed, and this
 *   keeps them apart.
 * - **`death-save` is not `saving-throw`.** "Unlike other saving throws, this
 *   one isn't tied to an ability score", so an ability-keyed selector has
 *   nothing to match on and would either miss every death save or catch every
 *   one. Beacon of Hope names both in one sentence and means two different
 *   things by them.
 *
 * **And a sixth that is the other five's union, narrowed.** `d20-test` is the
 * glossary's own phrase — "a D20 Test is an ability check, an attack roll, or
 * a saving throw" — and it names exactly those three. It arrived with the
 * spell that needed it, which is the rule this member's own absence used to
 * state: SRD Ray of Enfeeblement's "Disadvantage on **Strength-based** D20
 * Tests" is one sentence over three families, and writing it as three
 * selectors would be three grants a reader of the spell could not tell from
 * three sentences.
 *
 * **It requires an ability**, and that is what keeps it from being a guess.
 * Every consumer in reach prints the narrowing — Ray of Enfeeblement's
 * "Strength-based", Enlarge/Reduce's "Strength checks and Strength saving
 * throws", the Gold Dragon Wyrmling's Weakening Breath — and the bare phrase
 * is printed only by spells out of reach (Foresight at level 9, Resurrection's
 * week-long toll). `rollSelectorProblems` refuses the family without one, so
 * the day the bare phrase is wanted it arrives with the spell that writes it,
 * exactly as this member did.
 *
 * **Initiative and the death save are not in it**, and the reason is the one
 * the two members above give: the phrase would have to reach them through an
 * ability, and neither has one. An Initiative roll is granted by that name
 * rather than as a Dexterity check, and a death save "isn't tied to an ability
 * score" — so a Strength-based selector could never pick out either, and a
 * member that swept them in would be claiming a reach nothing could use.
 */
export type RollFamily =
  | 'attack'
  | 'ability-check'
  | 'saving-throw'
  | 'initiative'
  | 'death-save'
  | 'd20-test';

/**
 * The three families {@link RollFamily}'s `d20-test` member stands for.
 *
 * The glossary's list, written once: "**D20 Test.** An ability check, an
 * attack roll, or a saving throw." Read by {@link selectorMatches} and by
 * nothing else — a query is never of this family, because a roll is one of
 * the three and the union is a thing only a *selector* can be.
 */
const D20_TEST_FAMILIES: ReadonlySet<RollFamily> = new Set<RollFamily>([
  'attack',
  'ability-check',
  'saving-throw',
]);

/**
 * Whether the family a selector names covers the family a roll is of.
 *
 * Equality for five of the six members and membership for the sixth, in one
 * place so `selectorMatches` reads as it always did and the union has exactly
 * one definition.
 */
function familyReaches(selector: RollFamily, rolled: RollFamily): boolean {
  return selector === 'd20-test' ? D20_TEST_FAMILIES.has(rolled) : selector === rolled;
}

/**
 * Whose roll this is, relative to the creature carrying the effect.
 *
 * The bit the engine did not have, and the reason Dodge was its own grant kind
 * rather than a mode with a key. These two sentences are mechanically
 * different and both are about the same creature:
 *
 * | | |
 * |---|---|
 * | `roller` | "The affected creature has Disadvantage on attack rolls." |
 * | `against-holder` | "Attack rolls against the affected creature have Advantage." |
 *
 * **`against-holder` is legal only on `attack`**, and that is a rule rather
 * than a simplification: an attack roll is the one D20 Test the engine records
 * a second participant for. A saving throw knows its DC and not who set it —
 * `CLAUDE.md` has recorded that gap since Countercharm — so an
 * `against-holder` selector on a save would match every save ever rolled. The
 * validator refuses it.
 *
 * **There is deliberately no third relation**, and two SRD sentences are why
 * rather than why not. Bestow Curse's "Disadvantage on attack rolls **against
 * you**" and the Vex property's "Advantage on your next attack roll **against
 * that creature**" both narrow a roll to one *named* creature — and an enum
 * member cannot hold an id, so a third member would still need the id written
 * down beside it. What they want is the other participant pinned, which is
 * {@link RollSelector.counterpart}, and it composes with both members here
 * rather than being a third alternative to them.
 */
export type RollRelation = 'roller' | 'against-holder';

/**
 * What an ability check is being made **for**, as a rule can read it.
 *
 * A closed vocabulary of *mechanisms*, not of fictions: the caller states the
 * creature they are trying to find and the engine decides whether that creature
 * is one the roller has marked, so nothing here is a phrase somebody typed.
 *
 * One member, because one sentence in reach asks: SRD Hunter's Mark's "any
 * Wisdom (Perception or Survival) check you make **to find it**". A second
 * arrives with the sentence that needs it — see {@link RollSelector.purpose}.
 */
export type CheckPurpose = 'find-marked';

/**
 * Which rolls a modifier picks out.
 *
 * `ability` and `skill` are filters and both narrow rather than widen: absent
 * means the whole family. They are constrained to where they mean something —
 * a saving throw uses no skill, Initiative is granted by name rather than as a
 * Dexterity check, and a death save "isn't tied to an ability score" at all —
 * and the validator says so rather than letting a definition express a rule
 * the engine would then quietly ignore.
 *
 * The narrowing that matters most is the one that costs nothing to get wrong:
 * **an ability check and a saving throw of the same ability are different
 * rolls**. Enhance Ability grants Advantage on Wisdom checks and touches no
 * Wisdom save; Beacon of Hope grants it on Wisdom saves and touches no Wisdom
 * check. One family field keeps those apart, and `resolve()` in `checks.ts`
 * shares a code path between them, which is exactly where a looser key would
 * have leaked.
 */
export interface RollSelector {
  readonly roll: RollFamily;
  readonly relation: RollRelation;
  /**
   * The ability the roll uses. Not for `initiative` or `death-save`.
   *
   * A skill check uses an ability too, so a selector naming a skill may name
   * its ability as well — but they have to agree, or the selector describes a
   * roll nobody can make.
   *
   * **An attack roll is made with one, and the SRD narrows by it.** Reckless
   * Attack: "Doing so gives you Advantage on attack rolls **using Strength**";
   * Frenzy is written about the same swing. This field used to be refused on
   * the family on the strength of a reading — that an SRD attack roll is not a
   * "Strength attack roll" in the language Advantage is granted in — and the
   * Barbarian's own feature is that sentence, so a mode that could not say it
   * bought Advantage on every swing its holder made, the Dexterity rapier in
   * the other hand included.
   *
   * What it matches is the ability the attack was **made** with rather than
   * the one its weapon suggests, and that is a fact the attack path already
   * settles for itself before anything is thrown: `attackAbility` resolves
   * Finesse's "your choice of your Strength or Dexterity modifier" and a
   * strike style's offer, and {@link RollQuery.ability} carries the answer. So
   * a Rapier swung with Strength is a Strength attack roll and the same Rapier
   * swung with Dexterity is not, which is how the book reads Finesse.
   *
   * The two families still refused are the two with no ability to name:
   * Initiative is granted by that name rather than as a Dexterity check, and a
   * death save "isn't tied to an ability score".
   */
  readonly ability?: Ability;
  /**
   * The skill the check uses. Only for `ability-check`.
   *
   * SRD writes both shapes and they are not the same set: Remarkable Athlete
   * grants Advantage on "Strength (Athletics) checks" and Enhance Ability on
   * "ability checks using the chosen ability".
   */
  readonly skill?: Skill;
  /**
   * What the check is **for**, where a sentence narrows by that rather than by
   * the roll.
   *
   * SRD Hunter's Mark: "You also have Advantage on any Wisdom (Perception or
   * Survival) check you make **to find it**." The ability and the skill are
   * already selectable and neither of them is the narrowing: a ranger tracking
   * the quarry and a ranger listening at a door roll the same Wisdom
   * (Perception) check, and the difference is a fact about the *attempt*. So it
   * is stated by whoever asks for the check — `TestCommand.purpose`, the shape
   * `senses` and `fought` already have — and left silent otherwise, which a
   * purpose-keyed selector reads as a miss.
   *
   * **The member names a mechanism rather than a spell.** `find-marked` is
   * "this check is being made to find a creature the roller has marked", and
   * whether the roller has marked them is `attackRiders`' answer — what
   * `attack-rider.marksTarget` wrote, which is the same fact `knowledge.ts`
   * reads and no spell's name. A homebrew spell that marks a quarry and grants
   * this mode reaches it.
   *
   * **Only for `ability-check`.** An attack roll and a saving throw are not
   * made *to* anything the caller could state — an attack has its target and a
   * save has what it is about, both already selectable — so a purpose on either
   * would pick out nothing for ever.
   */
  readonly purpose?: CheckPurpose;
  /**
   * The other participant, pinned — so the selector picks out rolls involving
   * one named creature rather than anybody.
   *
   * SRD writes two sentences that need it, and they sit on opposite sides of
   * {@link RollRelation}:
   *
   * > Vex: "you have Advantage on your next attack roll **against that
   * > creature**." The holder is the attacker (`roller`), and the creature
   * > they hit is the counterpart.
   * > Bestow Curse: "The target has Disadvantage on attack rolls **against
   * > you**." The holder is the cursed creature (`roller`), and the caster is
   * > the counterpart.
   *
   * **It is the participant the relation does not name.** For a `roller`
   * selector the holder is who rolls, so the counterpart is who the roll is
   * against; for `against-holder` the holder is who it is against, so the
   * counterpart is who rolls. One field, read from the end that is still free,
   * rather than two fields of which one is always the holder over again.
   *
   * **A `CharacterId`, so only an attack roll can carry it**, for the reason
   * `against-holder` is confined to one: an attack is the single D20 Test the
   * engine records a second participant for, and a selector naming one on a
   * saving throw would describe a roll the engine cannot recognise. The
   * validator refuses it.
   *
   * **A definition names a role and the command pins the id**, the rule every
   * other number on a casting follows: the fold opens no catalogue, and "that
   * creature" is not a fact a book can hold. See `ModifierRider`'s
   * `counterpart`.
   */
  readonly counterpart?: CharacterId;
  /**
   * The senses that excuse an attacker from this modifier — the sense clause
   * read on the **attacker's** side.
   *
   * SRD Blur: "any creature has Disadvantage on attack rolls against you. **An
   * attacker is immune to this effect if it perceives you with Blindsight or
   * Truesight.**" Two sentences, and the second is about what the *other*
   * participant can perceive. Everything else on this selector narrows by what
   * the roll *is* — its family, its ability, its skill, who the other creature
   * is — and none of that could ask what that creature perceives with, so
   * every attacker took the Disadvantage and a Truesight attacker took it
   * wrongly.
   *
   * **It is not the sight question, and confusing the two would be the whole
   * bug.** Ordinary sight is precisely what Blur defeats: a goblin staring
   * straight at the wizard still rolls at Disadvantage, and a declared sight
   * line must change nothing. So the fact this reads is
   * `sensesPerceiving` — which senses of the roller actually reach the holder
   * — and never `canSee` or `canSomehowSee`, both of which answer off a
   * declaration first and would hand an immunity to every attacker the table
   * had placed in the wizard's line of sight.
   *
   * **Legal only on `against-holder`**, and that is the direction of the one
   * fact the engine records rather than a simplification: {@link
   * RollQuery.rollerPerceives} says what the roller perceives the creature
   * rolled against with, so the holder is the creature perceived and the
   * counterpart is the perceiver. A `roller` selector would need the other
   * direction, there is nowhere to read it from, and a modifier that could
   * never switch off is the silent failure the validator exists to refuse.
   *
   * An empty list names no sense and is refused for the same reason: it reads
   * as an exception and is none.
   */
  readonly unlessPerceivedWith?: readonly SenseName[];
  /**
   * The creature types this modifier reaches, read of the **attacker**.
   *
   * SRD Protection from Evil and Good: "one willing creature you touch is
   * protected against creatures that are Aberrations, Celestials, Elementals,
   * Fey, Fiends, or Undead ... Creatures of those types have Disadvantage on
   * attack rolls against the target." Every other field here narrows by what
   * the roll *is* — its family, its ability, the other creature's id, what
   * that creature perceives with — and none of them could ask what the other
   * creature **is**, so the mode was granted to every attacker or to none, and
   * a ward that protected the cleric from its own party is the wrong answer
   * rather than the missing one.
   *
   * **Legal only on `against-holder`**, for the reason `unlessPerceivedWith`
   * is: the relation says which end of the roll the holder is, and this reads
   * the *other* end. On a `roller` selector the holder is the attacker and the
   * sentence would be about the creature's own type — a fact it could read off
   * itself, which no SRD sentence of this shape asks for.
   *
   * **The type a spell sees rather than the creature's own**, which is
   * `typeMagicSees`' rule and this is one of its readers: SRD Arcanist's
   * Magic Aura makes "spells and other magical effects treat the target as if
   * it were a creature of the chosen type", and a ward is a spell. A creature
   * nobody has typed is **not** spared and is not caught either: the list is a
   * membership test, and `null` is in no list — the reading `mustBeType`
   * already takes of an untyped creature.
   *
   * An empty list is refused for the reason an empty sense list is: it reads
   * as a filter and is none.
   */
  readonly attackerType?: readonly string[];
  /**
   * SRD Faerie Fire: "Attack rolls against an affected creature or object
   * have Advantage **if the attacker can see it**." The roller's sight of the
   * creature rolled against, asked of `canSee` — the declaration first, then
   * the roller's senses against the holder's space — so a grant on an
   * outlined creature is nothing to a blindfolded attacker. Only on
   * `against-holder`, for the reason the sense clause above is.
   *
   * Three-valued like every sight question: where nobody has said, the mode
   * is applied and the roll reports it, which is the direction every
   * unsettled clause takes.
   */
  readonly ifRollerSees?: true;
  /**
   * SRD Innate Sorcery: "You have Advantage on the **attack rolls of
   * Sorcerer spells** you cast."
   *
   * An attack roll a *spell* makes, which every other field on this selector
   * could not tell from a club: `ability` narrows by the ability the swing was
   * made with and a Fire Bolt has one, `counterpart` names a creature, and the
   * family is `attack` for both. A feature that could not say this bought
   * Advantage on every swing its holder made, which is a benefit misapplied
   * rather than one never applied.
   *
   * Only on the `attack` family and only from the `roller`'s end, both refused
   * by the validator: a saving throw is not made by a spell, and a rule about
   * rolls *against* its holder is a rule about who is attacking them rather
   * than about what they cast.
   *
   * The site that throws the die answers it — {@link RollQuery.spellAttack} —
   * for {@link RollSelector.againstMagic}'s reason: a roll nobody classified
   * is a miss rather than a guess, so a weapon swing, which says nothing here,
   * is never one.
   */
  readonly onlySpellAttacks?: true;
  /**
   * SRD Innate Sorcery's other word: "**Sorcerer** spells you cast."
   *
   * The class the casting was made through, matched against
   * {@link RollQuery.castThrough}. A feature belongs to exactly one class and
   * the sentence names it, so a Sorcerer 1 / Wizard 4 rolls the half she casts
   * as a Sorcerer with Advantage and the other half flat.
   *
   * Beside {@link onlySpellAttacks} rather than folded into it, because they
   * are two narrowings of one sentence and a homebrew feature may want either
   * alone: "Advantage on your spell attacks" is a real sentence, and so is a
   * class-wide one about something other than an attack. The validator holds
   * this one to the company it keeps — a casting's class is a fact only a
   * spell's roll carries — so it is legal only where `onlySpellAttacks` is.
   */
  readonly onlyThroughClass?: string;
  /**
   * The condition this saving throw is **about** — what it would avoid or end.
   *
   * The axis the SRD writes four times over and the vocabulary had no room
   * for. Three species traits and one spell say the same sentence:
   *
   * > Dwarven Resilience: "You have Advantage on saving throws you make to
   * > avoid or end the **Poisoned** condition."
   * > Fey Ancestry, the **Charmed** condition; Brave, the **Frightened**;
   * > Protection from Poison, the Poisoned again, granted to somebody else.
   *
   * A save was selected by its ability and by nothing else, so the nearest
   * sayable thing was *Advantage on every Constitution saving throw the dwarf
   * ever makes* — a different and much larger trait, and one that would help
   * her resist a Disintegrate. This narrows it to the sentence.
   *
   * **"Avoid or end" is one field, not two**, because it is one save seen at
   * two moments: a casting forces the avoiding, and a turn boundary repeats
   * the ending against a condition already on the creature. Both arrive
   * through {@link RollQuery.aboutConditions}, and the boundary derives its
   * answer from the timer that names the condition instance rather than from
   * a field on the debt, so the two can never disagree.
   *
   * **A list on the query and one name here**, because the SRD writes the
   * imposing sentence plural — Hideous Laughter imposes "the Prone and
   * Incapacitated conditions" on one Wisdom save — and the granting sentence
   * singular. A save that is among other things about being Frightened is a
   * save made to avoid the Frightened condition.
   *
   * **Legal only on a saving throw today**, and that is this engine's limit
   * rather than the book's, so it is worth naming: SRD Powerful Build grants
   * "Advantage on any ability check you make to end the Grappled condition",
   * which is the same axis on the other family. No check roller says what it
   * is about, so a selector naming one there would match nothing for ever —
   * the silent failure {@link oneShotProblem} refuses for the same reason.
   * The day an escape check carries its condition, the refusal below is the
   * single place that stops refusing it.
   */
  readonly condition?: ConditionName;
  /**
   * The save is against **a spell or other magical effect**.
   *
   * SRD Magic Resistance, printed word for word on twenty-seven stat blocks
   * and on eleven at CR 5 or below: "The devil has Advantage on saving throws
   * against spells and other magical effects." A save was selected by its
   * family, its ability and what it was about, so the nearest sayable thing
   * was *Advantage on every saving throw the devil ever makes* — a much larger
   * trait, and one that would help it against a Grapple.
   *
   * **What the roller decides, not what this asks.** The axis is one fact —
   * {@link RollQuery.magical} — and the site that throws the die is the only
   * thing that can answer it. A spell's own `save` effect answers yes; a
   * printed stat-block line's save answers nothing, because a dragon's breath
   * is not a spell; a repeat save at a turn boundary answers by asking whether
   * the effect it would end came from a casting, which is a question
   * `castingIdOf` already answers off the engine's own source format.
   *
   * **A miss where nobody said**, which is the reading every narrowing field
   * here takes: an unkeyed save is not this sentence. That is the conservative
   * direction — a save the engine cannot classify gives the devil nothing
   * rather than giving it Advantage on everything.
   *
   * **Legal only on a saving throw.** The SRD sentence is about saves; an
   * attack roll and an ability check record nothing of the kind, so a selector
   * naming this on one would pick out nothing for ever — the silent failure
   * this validator exists to refuse.
   */
  readonly againstMagic?: true;
  /**
   * The save is the one made **to maintain Concentration**.
   *
   * SRD Eldritch Mind, and SRD War Caster beside it: "You have Advantage on
   * Constitution saving throws that you make to maintain Concentration." A
   * save was selected by its family, its ability, what it was about and
   * whether magic forced it, and none of those tells this save from any other
   * Constitution save — so the nearest sayable thing was *Advantage on every
   * Constitution saving throw the Warlock ever makes*, which is a far larger
   * benefit and one that would help against a Disintegrate.
   *
   * **What the roller decides, not what this asks** — {@link
   * RollQuery.concentration}, answered by the one site that throws this die.
   * Silence is a miss, which is the reading {@link againstMagic} takes and for
   * the same reason: a save the engine cannot classify gives nothing rather
   * than giving everything.
   *
   * **Legal only on a saving throw**, and only on the `roller` end: the SRD
   * sentence is about a save its holder makes, and a rule about a save made
   * *against* them is somebody else's Concentration.
   */
  readonly onlyConcentration?: true;
  /**
   * The creature at the **other end** of this roll is missing Hit Points.
   *
   * SRD Blood Frenzy: "The sahuagin has Advantage on attack rolls against any
   * creature that doesn't have all its Hit Points" — the same predicate SRD
   * Colossus Slayer writes as "if it's missing any of its Hit Points", which
   * `attack-damage.targetMissingHitPoints` has carried since the Ranger's
   * feature landed. A roll mode had no way to say it: every field here narrows
   * by what the roll *is*, and this is a fact about a creature.
   *
   * **The creature rolled against, and only that one.** It is named for the
   * end it reads rather than for "the end the relation left free", because on
   * an `against-holder` selector that end is the holder itself and a sentence
   * about the holder's own Hit Points is `while-bloodied`'s. So the validator
   * confines it to `roller`, which is the sentence the book prints.
   *
   * **Answered from state by the gatherer**, which is the one thing that can:
   * a creature's current and maximum Hit Points are the engine's own record,
   * so `rollModesFor` fills {@link RollQuery.targetMissingHitPoints} in
   * before the predicate is asked rather than waiting for the site that throws
   * the die to volunteer it. Silence is a miss, which is the reading every
   * narrowing here takes — a roll with no recorded second creature is not this
   * sentence.
   *
   * **Legal only on an attack roll**, because that is the single D20 Test the
   * engine records a second participant for; a selector naming it on a save
   * would pick out nothing for ever.
   */
  readonly targetMissingHitPoints?: true;
}

/** A mode, and the rolls it reaches. */
export interface RollModifier {
  readonly mode: RollMode;
  readonly selector: RollSelector;
  /**
   * Spent by the first roll it reaches, rather than running to a deadline.
   *
   * SRD Guiding Bolt: "**the next attack roll** made against it before the end
   * of your next turn has Advantage." SRD Vicious Mockery: "Disadvantage on
   * **the next attack roll it makes** before the end of its next turn." A
   * durable grant applies until the thing that made it ends, so neither of
   * those sentences could be written at all: both name a roll that *uses the
   * grant up*.
   *
   * **The roll it reaches, not the roll it changed.** A one-shot Disadvantage
   * met by an Advantage cancels to `normal` — and it is still spent, because
   * SRD says "the next attack roll it makes" and does not say "the next one
   * that came out worse". `combineRollModes` settles the outcome and this is
   * about the selector, so the two questions never have to agree.
   *
   * **Both endings, and neither replaces the other.** The sentence names a
   * moment as well as a roll, and the moment is the `grants` timer's to keep:
   * a grant that is consumed leaves a timer standing over nothing, which costs
   * nothing, because `withoutGrants` hands the creature back by reference when
   * it matches no grant.
   *
   * **An attack roll and an ability check spend one today**, and the validator
   * says so rather than letting a definition express a rule nothing would
   * enforce. The check half arrived with SRD Help — "Advantage on the next
   * ability check they make with the chosen skill" — and is the same mechanic
   * one family along. The remaining emitters of `roll-recorded` do not spend
   * one, so a one-shot on a **save** would quietly run to its deadline instead
   * — which is a durable grant wearing this field's name. SRD writes that
   * sentence too (Improved Brutal Strike's "Disadvantage on its next saving
   * throw"), so the restriction is this engine's rather than the book's, and it
   * lifts when a save roller spends one. See {@link oneShotProblem}.
   */
  readonly oneShot?: true;
}

/**
 * A roll modifier a running effect has hung on a creature.
 *
 * The durable half, stored on `CreatureState` beside `bonuses` and
 * `armorClasses` and linked the same way: the `source` carries the casting
 * (`Blur#cast:3`), so `releaseCasting` and `releaseOnTarget` end it with the
 * spell through machinery that already existed. There is no removal event and
 * no second lifecycle.
 *
 * **Not an `ActiveBonus` with a mode on it.** A bonus is arithmetic that adds;
 * a mode is presence that cancels, and `BonusApplies` has no relation axis to
 * carry `against-holder` at all. Folding the two together would have made Blur
 * into a negative number.
 */
export interface ActiveRollModifier {
  readonly source: string;
  readonly modifier: RollModifier;
}

/**
 * What makes two grants the same grant.
 *
 * **The source alone is not enough, and one spell proves it.** SRD Beacon of
 * Hope grants "Advantage on Wisdom saving throws **and Death Saving Throws**"
 * — one casting, one source string, two modifiers on two different rolls. A
 * store keyed by source alone, which is the rule `bonus-applied` and
 * `armor-class-granted` both follow, silently kept the second and dropped the
 * first: the spell's own sentence lost half of itself between the definition
 * and the state.
 *
 * So identity is the source **and the rolls it reaches**. Re-granting the same
 * rolls from the same casting still replaces rather than stacks, which is what
 * those two events were protecting; granting a *different* roll from the same
 * casting is a second grant, because it is a second sentence. The mode is not
 * part of the identity — one casting granting Advantage and then Disadvantage
 * on the same rolls is a contradiction, and the later word wins.
 *
 * **The counterpart is part of it too**, and one property proves that the way
 * Beacon of Hope proved the rest. SRD Vex hangs its Advantage on the attacker,
 * narrowed to the creature they just hit; an attacker who hits two goblins in
 * one turn holds two of them from one source, and under a key that stopped at
 * the selector's roll the second would have evicted the first — the same
 * sentence losing half of itself between the state and the roll.
 *
 * **`oneShot` is not**, for the reason the mode is not: it says how a grant
 * ends rather than which rolls it reaches, and one source cannot mean both
 * about the same rolls at once.
 */
export function rollModifierKey(source: string, selector: RollSelector): string {
  return [
    source,
    selector.roll,
    selector.relation,
    selector.ability ?? '',
    selector.skill ?? '',
    selector.counterpart ?? '',
    // Sorted, because a list is a set here: naming Truesight and Blindsight is
    // the same exception whichever order a definition wrote them in, and two
    // spellings of one sentence must not become two grants.
    [...(selector.unlessPerceivedWith ?? [])].sort().join(','),
    selector.ifRollerSees === true ? 'if-roller-sees' : '',
    selector.condition ?? '',
    // The two narrowings SRD Innate Sorcery prints, kept in the identity for
    // Beacon of Hope's reason: one source that said "your spell attacks" and
    // "your attacks" would be two statements, and a key that could not tell
    // them apart would evict the first.
    //
    // **Present only when written, which is what keeps the ordering still.**
    // `fold/grants.ts` sorts `CreatureState.rollModifiers` by this key, so that
    // order is persisted state and a key that changed shape would reorder it.
    // Appending a fixed empty tail to *every* key is not safe — two keys of one
    // source differing only in whether the last segment is empty compare as
    // "one ends here" before and as `'|'` against a letter after, which is the
    // opposite answer — so the tail is added only by a selector that writes
    // one. Every key an existing log holds is therefore byte-identical to what
    // it was, and the only keys that gained a segment are keys nothing had yet.
    //
    // **A conditional segment can be ambiguous and this pair is not**, which
    // the validator beside it is what settles: `rollSelectorProblems` refuses
    // a class narrowing with no `onlySpellAttacks` next to it, so the marker
    // is present whenever a class is, and the only three tails a source can
    // have are nothing, the marker, and the marker with a class after it. A
    // homebrew class named `only-spell-attacks` keys as the marker twice and
    // collides with nothing. What could still write an ambiguous tail is an
    // event hand-made past the validator, which is outside what any key here
    // promises.
    ...(selector.onlySpellAttacks === true ? ['only-spell-attacks'] : []),
    ...(selector.onlyThroughClass === undefined ? [] : [selector.onlyThroughClass]),
    // **The creature types the attacker must be one of**, kept in the identity
    // for Beacon of Hope's reason and appended for the paragraph above's:
    // every key an existing log holds stays byte-identical, and the only keys
    // that gain a segment are keys nothing had yet.
    //
    // **And it cannot be read as either of the other two tails**, which is the
    // ambiguity that paragraph is about: the segment carries its own name and
    // a colon, and neither the marker nor a class id contains one. Sorted,
    // because a list is a set here — a ward naming six types is the same
    // sentence whichever order a definition wrote them in.
    ...(selector.attackerType === undefined
      ? []
      : [`attacker-type:${[...selector.attackerType].sort().join(',')}`]),
    // **And what the check is for**, appended for the two paragraphs above's
    // reasons: every key an existing log holds stays byte-identical, and the
    // segment carries its own name and a colon, so it cannot be read as the
    // marker, a class id or a type list. One source that grants a mode on a
    // check made to find its quarry and another on the same check made for
    // anything would be two statements, and a key that could not tell them
    // apart would evict the first.
    ...(selector.purpose === undefined ? [] : [`purpose:${selector.purpose}`]),
  ].join('|');
}

/**
 * The roll being made, as the engine knows it at the moment of the roll.
 *
 * Only facts, and only facts the engine holds authoritatively. There is no
 * field a caller could use to assert that Advantage applies: that is the point
 * — the engine decides, from state, and a caller who also knows about an
 * effect cannot apply it twice, because the gatherers deduplicate by source.
 */
export interface RollQuery {
  readonly family: RollFamily;
  readonly roller: CharacterId;
  /**
   * The creature the roll is against, where the roll has one.
   *
   * An attack's target. Null or absent everywhere else, which is what makes an
   * `against-holder` selector unmatchable outside an attack even if one
   * somehow reached state.
   */
  readonly against?: CharacterId | null;
  /**
   * The ability this roll is made with, where the roll has one.
   *
   * A check's and a save's, and — since Reckless Attack — an attack's: the one
   * `attackAbility` settled from the weapon, the attacker's own choice where a
   * rule offers two, and whatever a strike style offered. It is the *answer*
   * rather than the question, which is what lets "attack rolls using Strength"
   * pick out a Finesse weapon swung with Strength and pass over the same
   * weapon swung with Dexterity.
   *
   * Absent on an attack nobody worked one out for, and an ability-keyed
   * selector misses it rather than guessing — the reading `against` already
   * takes of a roll with no recorded target.
   */
  readonly ability?: Ability;
  readonly skill?: Skill;
  /**
   * The senses with which the roller perceives the creature the roll is
   * against — the attacker's side of a sense clause, gathered before the die.
   *
   * A fact and not a judgement, in the spirit of the rest of this type: it is
   * `sensesPerceiving(state, roller, against)`, which is the roller's own
   * senses filtered to those whose printed range reaches. **Not a sight
   * answer** — a declared sight line is not in it and must not be, because the
   * sentence that reads this ({@link RollSelector.unlessPerceivedWith}) is
   * about a sense defeating an effect and not about seeing.
   *
   * Absent or empty means nobody perceives anything by a sense, which is the
   * behaviour every roll in this engine had before the axis existed: the
   * modifier applies. There is no third value, because a sense is a fact the
   * engine holds outright rather than one the table declares.
   */
  readonly rollerPerceives?: readonly SenseName[];
  /**
   * Whether the roller can see the creature rolled against, as `canSee`
   * answers it: yes, no, or nobody has said. Read by a selector gated
   * `ifRollerSees`; absent applies such a grant and is reported.
   */
  readonly rollerSees?: boolean | null;
  /**
   * Whether this attack roll is a **spell's** — what
   * {@link RollSelector.onlySpellAttacks} matches.
   *
   * Answered by the site that throws the die, because it is the only thing
   * that knows: one site says yes, the `attack` effect's resolver, and the
   * weapon attack says nothing. Absent is "nobody said it was", and a selector
   * that asks for a spell reads that as a miss rather than a guess — the
   * reading {@link magical} already takes of a save.
   */
  readonly spellAttack?: true;
  /**
   * The class the casting making this roll was made **through**, where it was
   * made through one — what {@link RollSelector.onlyThroughClass} matches.
   *
   * Read off the casting's own route, which is where the answer lives: a class
   * route names its class, and a feat's granted route, a stat block's
   * declaration and an item's route name none. Absent therefore means "through
   * no class", which a class-keyed selector reads as a miss.
   */
  readonly castThrough?: string;
  /**
   * The conditions this roll would **avoid or end**, where it is about any.
   *
   * What {@link RollSelector.condition} matches against, gathered by whoever
   * rolls the save because only they know what it is for. Three places know:
   * the resolver for a save whose failure imposes a condition, its sibling
   * that also deals damage, and the turn boundary repeating a save against a
   * condition already standing — the last reading the timer that names the
   * instance, so the answer is derived rather than carried.
   *
   * **A list, because one save may impose several.** SRD Hideous Laughter
   * imposes "the Prone and Incapacitated conditions" on one Wisdom save; a
   * trait naming either of them reaches that save.
   *
   * Absent means nobody said what the roll was about, which a condition-keyed
   * selector reads as a miss rather than a guess — the reading `against`
   * already takes of a roll with no recorded target. Most saves the engine
   * rolls are about nothing in particular, so an unkeyed Wisdom save is not
   * the elf's sentence.
   */
  readonly aboutConditions?: readonly ConditionName[];
  /**
   * Whether this roll is against **a spell or other magical effect** — what
   * {@link RollSelector.againstMagic} matches.
   *
   * Answered by the site that throws the die, because it is the only thing
   * that knows. Four sites say yes: the three spell-effect resolvers that
   * force a save, and the turn boundary repeating one, which asks
   * `castingIdOf` whether the effect it would end came from a casting.
   *
   * Absent or false means "nobody said it was", and a selector that asks for
   * magic reads that as a miss rather than a guess — the reading `against`
   * already takes of a roll with no recorded target. A printed stat-block
   * line's save says nothing here on purpose: a dragon's breath is not a
   * spell.
   */
  readonly magical?: boolean;
  /**
   * Whether this saving throw is the one made **to maintain Concentration** —
   * what {@link RollSelector.onlyConcentration} matches.
   *
   * Answered by the site that throws the die, because it is the only thing
   * that knows: one site says yes, the Concentration save `resolveDamage`
   * settles after a blow, and every other Constitution save says nothing.
   *
   * Absent means "nobody said it was", and a selector that asks for one reads
   * that as a miss rather than a guess — the reading {@link magical} takes.
   */
  readonly concentration?: boolean;
  /**
   * Whether the creature at the other end of this roll is missing Hit Points —
   * what {@link RollSelector.targetMissingHitPoints} matches.
   *
   * **Filled in by the gatherer rather than by the site that throws the die**,
   * and it is the one field here that is: every other fact on this query is
   * something only the roller knows — what the save was about, whether a spell
   * forced it, which class a casting went through — and this one is read off
   * `CreatureState.vitals`, which `rollModesFor` has in hand and the swing
   * would only be repeating. So no attack site has to remember it and no
   * caller can assert it.
   *
   * Absent means nobody worked it out, which a selector asking for it reads as
   * a miss — the reading {@link magical} takes.
   */
  readonly targetMissingHitPoints?: boolean;
  /**
   * What the creature **rolling** is, as a spell or other magical effect sees
   * it — what {@link RollSelector.attackerType} matches.
   *
   * **Filled in by the gatherer rather than by the site that throws the die**,
   * which is the reading {@link targetMissingHitPoints} already takes and for
   * the same reason: it is read off `CreatureState` through `typeMagicSees`,
   * which `rollModesFor` has the state for and a swing would only be
   * repeating. So no attack site has to remember it and no caller can assert
   * it.
   *
   * Absent or null means nobody has said what the creature is, and a selector
   * naming types reads that as a miss — the reading every other fact here
   * takes of a silence, and the one `mustBeType` already takes of an untyped
   * creature.
   */
  readonly rollerType?: string | null;
  /**
   * The creature this check is being made **to find** — SRD Hunter's Mark's
   * "any Wisdom (Perception or Survival) check you make to find it".
   *
   * Stated by whoever asks for the check, because nothing else could know:
   * tracking the quarry and listening at a door are the same Wisdom
   * (Perception) check and the difference is what the attempt is *for*. It is
   * the shape {@link aboutConditions} has on the other family — a fact about
   * the roll that only its asker holds — and the shape `senses` has on the
   * command.
   *
   * Absent is a check nobody said the purpose of, which is most of them.
   */
  readonly finding?: CharacterId;
  /**
   * Whether {@link finding} names a creature the **roller** has marked — what
   * {@link RollSelector.purpose}'s `find-marked` matches.
   *
   * **Filled in by the gatherer rather than by the site that throws the die**,
   * which is the reading {@link rollerType} and
   * {@link targetMissingHitPoints} already take: the mark is
   * `CreatureState.attackRiders`, which `rollModesFor` has the state for and a
   * caller would only be repeating. So the asker states the purpose and the
   * engine decides whether the sentence is about it.
   *
   * Absent means nobody worked it out, which a purpose-keyed selector reads as
   * a miss.
   */
  readonly findingMarked?: boolean;
}

/**
 * Whether a modifier held by `holder` reaches this roll.
 *
 * **The one predicate.** Every source of a standing mode — a class feature, an
 * action anybody can take, a spell's durable grant — is matched here and
 * nowhere else, so there is exactly one answer to "does this apply" and one
 * place a rule about it can be wrong.
 */
export function selectorMatches(
  selector: RollSelector,
  holder: CharacterId,
  query: RollQuery,
): boolean {
  if (!familyReaches(selector.roll, query.family)) return false;

  const against = query.against ?? null;

  if (selector.relation === 'roller') {
    if (holder !== query.roller) return false;
  } else {
    // An attack with no recorded target matches nothing: the rule needs a
    // second participant and there is none, which is a miss rather than a
    // guess in either direction.
    if (against === null || holder !== against) return false;
  }

  // The other participant, where the selector pins one — the end the relation
  // has not already spoken for. A roll that records nobody there is a miss for
  // the reason an `against-holder` selector is: the rule names a creature and
  // the roll cannot say whether this is them.
  if (selector.counterpart !== undefined) {
    const other = selector.relation === 'roller' ? against : query.roller;
    if (other === null || other !== selector.counterpart) return false;
  }

  if (selector.ability !== undefined && selector.ability !== query.ability) return false;
  if (selector.skill !== undefined && selector.skill !== query.skill) return false;

  // SRD Fey Ancestry: "Advantage on saving throws you make to avoid or end the
  // Charmed condition." A save that is about several is about each of them, so
  // membership rather than equality; a save nobody keyed is a miss, because an
  // unkeyed Wisdom save is a different sentence from this one.
  if (selector.condition !== undefined) {
    const about = query.aboutConditions;
    if (about === undefined || !about.includes(selector.condition)) return false;
  }

  // SRD Blur: "An attacker is immune to this effect if it perceives you with
  // Blindsight or Truesight." The holder is the creature rolled against — the
  // validator confines this to `against-holder` for exactly that reason — so
  // the perceiver is the roller, and `rollerPerceives` is what its senses
  // reach. A sense nobody has is not in the list, so an absent list applies
  // the modifier, which is what the roll did before the axis existed.
  if (selector.unlessPerceivedWith !== undefined) {
    const perceived = query.rollerPerceives ?? [];
    if (selector.unlessPerceivedWith.some((sense) => perceived.includes(sense))) return false;
  }

  // SRD Protection from Evil and Good: "Creatures of those types have
  // Disadvantage on attack rolls against the target." The holder is the
  // creature rolled against — the validator confines this to `against-holder`
  // for that reason — so the type read is the roller's, and a roller nobody
  // has typed is in no list. `RollQuery.rollerType` is the gatherer's, filled
  // in the way SRD's "spells and other magical effects" says to read a type.
  if (
    selector.attackerType !== undefined &&
    (query.rollerType == null || !selector.attackerType.includes(query.rollerType))
  ) {
    return false;
  }

  // SRD Faerie Fire: "if the attacker can see it". A declared *no* withholds
  // the mode; a yes or a silence applies it, and `rollModesFor` reports the
  // silence — see {@link unsettledSightGrants}.
  if (selector.ifRollerSees === true && query.rollerSees === false) return false;

  // SRD Magic Resistance: "Advantage on saving throws against spells and other
  // magical effects." A roll nobody classified is a miss, not a guess — see
  // {@link RollQuery.magical}.
  if (selector.againstMagic === true && query.magical !== true) return false;

  // SRD Eldritch Mind: "Advantage on Constitution saving throws that you make
  // to maintain Concentration." Read exactly as the line above is — the site
  // that throws the die says which save this is, and silence is a miss.
  if (selector.onlyConcentration === true && query.concentration !== true) return false;

  // SRD Blood Frenzy: "against any creature that doesn't have all its Hit
  // Points." The fact is the gatherer's — see
  // {@link RollQuery.targetMissingHitPoints} — and silence is a miss, so
  // a swing at nobody in particular is not this sentence.
  if (
    selector.targetMissingHitPoints === true &&
    query.targetMissingHitPoints !== true
  ) {
    return false;
  }

  // SRD Innate Sorcery: "the attack rolls of Sorcerer spells you cast." Two
  // narrowings of one sentence, read the same way `againstMagic` is: a swing
  // that said nothing about being a spell's is not one, and a casting through
  // no class is not a casting through this one.
  // SRD Hunter's Mark: "any Wisdom (Perception or Survival) check you make **to
  // find it**." The asker states which creature the attempt is about and the
  // gatherer decides whether it is one the roller has marked; a check nobody
  // said the purpose of is a miss, because an unkeyed Perception check is a
  // different sentence from this one.
  if (selector.purpose === 'find-marked' && query.findingMarked !== true) return false;

  if (selector.onlySpellAttacks === true && query.spellAttack !== true) return false;
  if (
    selector.onlyThroughClass !== undefined &&
    selector.onlyThroughClass !== query.castThrough
  ) {
    return false;
  }

  return true;
}

/**
 * The two families a selector may not name an ability on.
 *
 * The same two {@link RollFamily} keeps apart from the families they resemble,
 * and for the same sentences: Initiative is granted by that name rather than
 * as a Dexterity check, and a death save "isn't tied to an ability score".
 * Written as the exceptions rather than as a list of the families that *do*
 * take one, so a sixth family arrives taking an ability unless somebody says
 * otherwise — which is the way round the SRD writes them.
 */
const ABILITY_LESS_ROLLS: ReadonlySet<RollFamily> = new Set<RollFamily>([
  'initiative',
  'death-save',
]);

/** One thing wrong with a selector, in the shape the definition validator uses. */
export interface RollSelectorProblem {
  readonly code: string;
  readonly reason: string;
}

/**
 * Every way a selector can describe a roll that cannot happen.
 *
 * Shared by the spell-definition validator and by the sweep that holds the
 * class features to the same vocabulary, so a homebrew definition and a
 * transcribed feature are checked against one list rather than two.
 *
 * Each of these is a combination that would otherwise fail **silently**: the
 * definition compiles, the effect lands in state, and the modifier then
 * matches nothing for ever — or matches far more than the spell says.
 *
 * The skill's owning ability is passed in rather than imported so this stays a
 * pure function of its arguments; `SKILL_ABILITY` is the one caller's answer.
 */
export function rollSelectorProblems(
  selector: RollSelector,
  abilityOfSkill: (skill: Skill) => Ability,
): readonly RollSelectorProblem[] {
  const found: RollSelectorProblem[] = [];

  // Initiative is granted by name rather than as a Dexterity check — Feral
  // Instinct does not help a Barbarian pick a lock — and a death save "isn't
  // tied to an ability score", so on both of these an ability-keyed selector
  // would either miss every roll or catch every one. An attack roll *is* made
  // with an ability and the SRD narrows by it: see {@link RollSelector.ability}.
  if (selector.ability !== undefined && ABILITY_LESS_ROLLS.has(selector.roll)) {
    found.push({
      code: 'ability_on_ability_less_roll',
      reason: `a ${selector.roll} roll is not made with an ability in the sense Advantage is granted on one`,
    });
  }

  if (selector.skill !== undefined && selector.roll !== 'ability-check') {
    found.push({
      code: 'skill_off_ability_check',
      reason: `a ${selector.roll} roll uses no skill`,
    });
  }

  // **The one member that must be narrowed**, and the refusal is what keeps it
  // from being a vocabulary member nothing could use. Every SRD sentence in
  // reach says which ability the tests are "based" on, and a selector that
  // said none would take Disadvantage off every roll its holder ever made —
  // the confident wrong answer rather than the missing one. See
  // {@link RollFamily}.
  if (selector.roll === 'd20-test' && selector.ability === undefined) {
    found.push({
      code: 'd20_test_without_an_ability',
      reason:
        'every sentence in reach names the ability its D20 Tests are based on — "Strength-based D20 Tests" — and a selector for the bare phrase would reach every ability check, attack roll and saving throw its holder ever makes',
    });
  }

  // A selector may name both — "Strength (Athletics) checks" — but naming a
  // skill and the wrong ability describes a roll nobody makes.
  if (selector.skill !== undefined && selector.ability !== undefined) {
    const owner = abilityOfSkill(selector.skill);
    if (owner !== selector.ability) {
      found.push({
        code: 'skill_ability_mismatch',
        reason: `${selector.skill} is a ${owner} skill, so a ${selector.ability} check never uses it`,
      });
    }
  }

  // The rule rather than a simplification: see `RollRelation`.
  if (selector.relation === 'against-holder' && selector.roll !== 'attack') {
    found.push({
      code: 'against_holder_without_target',
      reason: `an attack roll is the only D20 Test the engine records a target for, so "against the holder" cannot pick out a ${selector.roll}`,
    });
  }

  if (selector.counterpart !== undefined) {
    const wrong = counterpartProblem(selector.roll);
    if (wrong !== null) found.push(wrong);
  }

  // The sense clause, and the three ways it describes an exception nothing
  // could ever take. The vocabulary check is here rather than in the spell
  // validator because both callers need it and the names are the engine's own
  // closed list — the same reason `against_holder_without_target` is here.
  if (selector.unlessPerceivedWith !== undefined) {
    // **The shape before the vocabulary, because this validator meets
    // homebrew.** Every field here arrives as `unknown` through
    // `loadContent`, and inviolable rule 6 says a rules-legal refusal is a
    // value: walking a number with `for…of` would throw a `TypeError` out of
    // the one door an author's JSON comes through. A bare string is refused
    // with the rest rather than iterated, which would report one `bad_sense`
    // per letter.
    if (!Array.isArray(selector.unlessPerceivedWith)) {
      found.push({
        code: 'perceived_with_is_not_a_list',
        reason: 'a sense clause is a list of sense names — the senses that excuse an attacker',
      });
    } else {
      for (const sense of selector.unlessPerceivedWith) {
        if (!SENSE_NAMES.includes(sense)) {
          found.push({
            code: 'bad_sense',
            reason: `"${String(sense)}" is not a sense the rules glossary names`,
          });
        }
      }
      if (selector.unlessPerceivedWith.length === 0) {
        found.push({
          code: 'perceived_with_names_no_sense',
          reason: 'an exception that names no sense excuses nobody; leave the field off instead',
        });
      }
      if (selector.relation !== 'against-holder') {
        found.push({
          code: 'perceived_with_off_against_holder',
          reason:
            'the engine records what the roller perceives the creature rolled against with, so a sense clause can only excuse an attacker — on a "roller" selector there is no direction to read and the exception would never apply',
        });
      }
    }
  }

  // The attacker's creature type, and the three ways it describes a narrowing
  // nothing could read — the sense clause's own three, on the other axis. The
  // **names** are deliberately not checked against a list: a creature type is
  // content (`typeMagicSees` reads whatever the table declared) and this
  // validator holds the engine's own closed vocabularies, not the book's.
  if (selector.attackerType !== undefined) {
    // The shape before anything else, for the sense clause's reason: this
    // validator meets homebrew, and a bare string walked with `for…of` would
    // report one problem per letter.
    if (!Array.isArray(selector.attackerType)) {
      found.push({
        code: 'attacker_type_is_not_a_list',
        reason:
          'a type filter is a list of creature types — the types SRD Protection from Evil and Good names',
      });
    } else {
      if (selector.attackerType.some((type) => typeof type !== 'string' || type.length === 0)) {
        found.push({
          code: 'bad_creature_type',
          reason: 'a creature type is a non-empty name, as the table and the stat blocks write it',
        });
      }
      if (selector.attackerType.length === 0) {
        found.push({
          code: 'type_filters_nothing',
          reason: 'a filter that names no creature type reaches nobody; leave the field off instead',
        });
      }
      if (selector.relation !== 'against-holder') {
        found.push({
          code: 'type_on_the_wrong_end',
          reason:
            'this clause reads the creature **making** the roll, and on a "roller" selector that creature is the holder — a sentence about the holder\'s own type is a requirement on the grant rather than a narrowing on the roll',
        });
      }
    }
  }

  // The condition a save is about. Two refusals, and the second is a limit of
  // this engine rather than of the SRD — see {@link RollSelector.condition}.
  if (selector.ifRollerSees !== undefined) {
    if (selector.ifRollerSees !== true) {
      found.push({
        code: 'bad_sight_gate',
        reason: '"if the attacker can see it" is written ifRollerSees: true, or left off',
      });
    }
    if (selector.relation !== 'against-holder') {
      found.push({
        code: 'sight_gate_off_against_holder',
        reason:
          'the engine reads whether the roller can see the creature rolled against, so a sight gate can only govern a roll made against the holder — on a "roller" selector there is nobody to be seen',
      });
    }
  }

  if (selector.condition !== undefined) {
    if (!CONDITIONS.includes(selector.condition)) {
      found.push({
        code: 'bad_condition',
        reason: `"${String(selector.condition)}" is not one of the fifteen conditions the rules glossary names`,
      });
    }
    // **Two families say what they are about, and the second one is new.**
    // The refusal here used to name every roll but a save, with the ability
    // check that ends a Grapple written into it as the next one that would
    // say. It says now: `resolveEffectCheck` and `escapeGrapple` both derive
    // the condition their check would end from the timer they are settling —
    // `conditionEndedBy`, the same one line for both — so SRD Powerful Build's
    // "Advantage on any ability check you make to end the Grappled condition"
    // picks out exactly that check and no other Strength check its holder
    // makes. Every other family is still refused for the reason this was: an
    // attack roll and an Initiative roll are about nobody's condition, so a
    // selector naming one there would match nothing for ever.
    if (selector.roll !== 'saving-throw' && selector.roll !== 'ability-check') {
      found.push({
        code: 'condition_off_a_saving_throw',
        reason: `a saving throw and the ability check that ends an effect say what they are about; a ${selector.roll} does not, so naming a condition on one would pick out nothing for ever`,
      });
    }
  }

  // What a check is **for**, held to the one family that can say. See
  // {@link RollSelector.purpose}: an attack roll and a saving throw are not made
  // *to* anything a caller states, so a purpose on either would pick out
  // nothing for ever — the refusal `skill_off_ability_check` makes about the
  // narrowing beside it.
  if (selector.purpose !== undefined) {
    if (selector.purpose !== 'find-marked') {
      found.push({
        code: 'bad_check_purpose',
        reason: `"${String(selector.purpose)}" is not a purpose a check can be made for; the engine reads find-marked`,
      });
    }
    if (selector.roll !== 'ability-check') {
      found.push({
        code: 'purpose_off_ability_check',
        reason: `only an ability check is made *to* something a caller states, so a purpose cannot pick out a ${selector.roll}`,
      });
    }
  }

  // SRD Blood Frenzy is a sentence about the creature at the other end of a
  // swing, and an attack roll is the only D20 Test that has one. See
  // {@link RollSelector.targetMissingHitPoints}.
  if (selector.targetMissingHitPoints !== undefined) {
    if (selector.targetMissingHitPoints !== true) {
      found.push({
        code: 'bad_wounded_gate',
        reason:
          '"against a creature that doesn\'t have all its Hit Points" is written targetMissingHitPoints: true, or left off',
      });
    }
    if (selector.roll !== 'attack') {
      found.push({
        code: 'wounded_gate_off_an_attack',
        reason: `only an attack roll records a second creature, so a clause about that creature's Hit Points cannot pick out a ${selector.roll}`,
      });
    }
    if (selector.relation !== 'roller') {
      found.push({
        code: 'wounded_gate_off_the_roller',
        reason:
          "this clause reads the creature rolled against, and on an \"against-holder\" selector that creature is the holder — a sentence about the holder's own Hit Points is written with the while-bloodied requirement instead",
      });
    }
  }

  // SRD Magic Resistance is a sentence about saving throws, and only a saving
  // throw carries the fact it reads. See {@link RollSelector.againstMagic}.
  if (selector.againstMagic !== undefined && selector.roll !== 'saving-throw') {
    found.push({
      code: 'against_magic_off_a_saving_throw',
      reason: `only a saving throw records what it was forced by, so "against spells and other magical effects" cannot pick out a ${selector.roll}`,
    });
  }

  // SRD Eldritch Mind and War Caster are sentences about a save their holder
  // makes, and only a saving throw the caster rolls carries the fact they read.
  // See {@link RollSelector.onlyConcentration}.
  if (selector.onlyConcentration !== undefined) {
    if (selector.onlyConcentration !== true) {
      found.push({
        code: 'bad_concentration_gate',
        reason: '"a save you make to maintain Concentration" is written onlyConcentration: true, or left off',
      });
    }
    if (selector.roll !== 'saving-throw') {
      found.push({
        code: 'concentration_off_a_saving_throw',
        reason: `Concentration is maintained by a saving throw, so naming it on a ${selector.roll} would pick out nothing for ever`,
      });
    }
    if (selector.relation !== 'roller') {
      found.push({
        code: 'concentration_against_the_holder',
        reason: 'the save that maintains Concentration is made by whoever is concentrating, so a rule about saves made against them is somebody else\'s spell',
      });
    }
  }

  // SRD Innate Sorcery is a sentence about attack rolls its holder makes, and
  // only an attack roll carries the fact it reads. The relation half is the
  // reason a *spell* attack can be narrowed at all: the roller is the caster,
  // so a rule about rolls against the holder is a rule about who is attacking
  // them rather than about what they cast.
  if (selector.onlySpellAttacks !== undefined) {
    if (selector.onlySpellAttacks !== true) {
      found.push({
        code: 'bad_spell_attack_gate',
        reason: '"the attack rolls of spells you cast" is written onlySpellAttacks: true, or left off',
      });
    }
    if (selector.roll !== 'attack') {
      found.push({
        code: 'spell_attack_off_an_attack_roll',
        reason: `only an attack roll says whether a spell made it, so "the attack rolls of spells you cast" cannot pick out a ${selector.roll}`,
      });
    }
    if (selector.relation !== 'roller') {
      found.push({
        code: 'spell_attack_off_the_roller',
        reason:
          'a spell attack is made **by** the creature the sentence is about, so this narrowing belongs on a "roller" selector; on "against-holder" it would describe whoever is attacking them',
      });
    }
  }

  // And the class the casting was made through, which only a casting has: it
  // rides with the narrowing above rather than alone, because a weapon swing
  // was never made through a class and a roll that could not say it is a spell
  // could not say which class cast it either.
  if (selector.onlyThroughClass !== undefined && selector.onlySpellAttacks !== true) {
    found.push({
      code: 'class_narrowing_without_a_spell',
      reason:
        'the class a roll was made through is a fact only a casting carries, so narrowing by one needs onlySpellAttacks beside it',
    });
  }

  return found;
}

/**
 * A grant nothing would ever spend is a grant that does not end the way it says.
 *
 * {@link RollModifier.oneShot} is meaningful only where some roller emits
 * `roll-modifier-consumed`. On any family where none does, the flag compiles,
 * the grant lands, and it then runs to its deadline like any durable one — the
 * *silent* failure this file's whole validator exists to convert into a
 * refusal at authoring.
 *
 * **Two families spend one now, and the second arrived with the SRD sentence
 * that needed it.** The attack rollers were the first, for Guiding Bolt and
 * Vicious Mockery. The ability-check rollers are the second, for SRD Help:
 * "that ally has Advantage on **the next ability check they make** with the
 * chosen skill" — the same mechanic, one family along. `resolveTest`,
 * `resolveEffectCheck`, the escape check and the three glossary actions each
 * emit the event through `spentRollModifiers`.
 *
 * **One check roller still does not, and it is named rather than glossed
 * over**: `takeHide` gathers its modes and spends nothing, so a Help offered
 * on Stealth reaches a Hide and is not used up by it. It expires at the
 * helper's next turn either way, which is why this is an over-generosity of
 * one roll rather than a grant that never ends.
 *
 * **A limit of this engine and not of the SRD** for what is left, which is why
 * it is worth saying in the refusal: the book writes the sentence about a
 * saving throw too (Improved Brutal Strike's "Disadvantage on its next saving
 * throw"). The day a save roller spends one, this function is the single place
 * that stops refusing it.
 */
export function oneShotProblem(roll: RollFamily): RollSelectorProblem | null {
  if (roll === 'attack' || roll === 'ability-check') return null;
  return {
    code: 'one_shot_off_an_attack',
    reason: `only an attack roll and an ability check spend a one-shot modifier today, so one on a ${roll} would never be used up and would run to its deadline instead`,
  };
}

/**
 * A counterpart names the other participant, and only one roll has one.
 *
 * The same sentence `against_holder_without_target` says on the other axis,
 * and it is the same fact underneath: an attack roll is the one D20 Test the
 * engine records a second participant for, so on any other family a pinned
 * counterpart picks out nothing for ever.
 *
 * **Its own function because two readers ask it of two different things.**
 * `rollSelectorProblems` asks it of a selector that already holds an id — a
 * feature's grant, a homebrew written against the state vocabulary — and the
 * definition validator asks it of a rider that holds a *role*, before anything
 * has been pinned. One rule and one wording, or two places for it to drift.
 */
export function counterpartProblem(roll: RollFamily): RollSelectorProblem | null {
  if (roll === 'attack') return null;
  return {
    code: 'counterpart_without_target',
    reason: `an attack roll is the only D20 Test the engine records a second participant for, so naming the other creature cannot pick out a ${roll}`,
  };
}

/**
 * Durable roll modifiers reaching this roll, from every creature holding one.
 *
 * Walks the whole cast rather than only the roller, because an
 * `against-holder` modifier lives on the creature being *attacked*: Blur is on
 * the wizard and changes the goblin's roll. Sorted by holder so two readers of
 * the same state agree about the order, which matters only for the log and
 * matters there.
 */
export function grantedRollModes(state: GameState, query: RollQuery): readonly ModeSource[] {
  const modes: ModeSource[] = [];

  for (const holder of Object.keys(state.creatures).sort()) {
    const creature = state.creatures[holder];
    if (creature === undefined) continue;

    for (const held of creature.rollModifiers) {
      if (!selectorMatches(held.modifier.selector, holder as CharacterId, query)) continue;
      modes.push({ source: held.source, mode: held.modifier.mode });
    }
  }

  return modes;
}

/**
 * The granted modes this roll applies although nobody has said whether the
 * roller can see the creature rolled against — SRD Faerie Fire's gate, left
 * unsettled. Reported by `rollModesFor` beside the modes, so a table that
 * never declared the sight line is told what was assumed.
 */
export function unsettledSightGrants(state: GameState, query: RollQuery): readonly string[] {
  if (query.rollerSees !== undefined && query.rollerSees !== null) return [];
  const sources = new Set<string>();
  for (const holder of Object.keys(state.creatures).sort()) {
    const creature = state.creatures[holder];
    if (creature === undefined) continue;
    for (const held of creature.rollModifiers) {
      if (held.modifier.selector.ifRollerSees !== true) continue;
      if (!selectorMatches(held.modifier.selector, holder as CharacterId, query)) continue;
      sources.add(held.source);
    }
  }
  return [...sources].sort();
}

/** One creature's grant, named the way the deadline on it is named. */
export interface SpentRollModifier {
  readonly holder: CharacterId;
  readonly source: string;
}

/**
 * The one-shot grants this roll uses up.
 *
 * {@link grantedRollModes}' walk asked a second time for a second question,
 * and the two are deliberately not one call: what a roll *reads* is a list of
 * attributed modes that `combineRollModes` settles, and what it *spends* is a
 * list of grants that were reached. A roll can read a mode without spending
 * anything, and — the case that matters — it spends a grant it read even when
 * the reading cancelled to `normal`. The predicate is the same
 * {@link selectorMatches}, so the two can never disagree about whether the
 * grant applied.
 *
 * **Holder and bare source, which is what the ending takes.** `releaseGrants`
 * matches the bare source for the reason a `grants` deadline does: Beacon of
 * Hope's two modifiers are one source's grant, and whatever ends one ends
 * both. So a source appears once however many of its modifiers this roll
 * reached, and the caller emits one event for it.
 *
 * Sorted by holder and then source, because the answer reaches the log and two
 * readers of one state have to agree about the order.
 *
 * **A grant whose exception this query did not answer is not spent**, and
 * that is the one place the two walks are allowed to differ. The rule is "the
 * roll it reached", and {@link RollSelector.unlessPerceivedWith} is part of
 * reaching: a spender whose query left {@link RollQuery.rollerPerceives}
 * unset cannot tell whether the grant applied, and spending on a fact nobody
 * gathered would use up a sentence that changed nothing. Absence is "nobody
 * asked" rather than "nobody perceives, so it applied" — the asymmetry is
 * deliberate, because the conservative direction differs between the two
 * questions: a gatherer that does not know applies the benefit and says so,
 * and a spender that does not know spends nothing. No printed effect combines
 * the two flags today; the day one does, a call site that has not been taught
 * to gather the fact leaves the grant standing rather than eating it, and
 * refusing the pairing outright — the move `oneShotProblem` makes for a family
 * nothing can end on — is the definition validator's to add.
 */
export function consumedRollModifiers(
  state: GameState,
  query: RollQuery,
): readonly SpentRollModifier[] {
  const spent: SpentRollModifier[] = [];

  for (const holder of Object.keys(state.creatures).sort()) {
    const creature = state.creatures[holder];
    if (creature === undefined) continue;

    const sources = new Set<string>();
    for (const held of creature.rollModifiers) {
      if (held.modifier.oneShot !== true) continue;
      if (
        held.modifier.selector.unlessPerceivedWith !== undefined &&
        query.rollerPerceives === undefined
      ) {
        continue;
      }
      if (!selectorMatches(held.modifier.selector, holder as CharacterId, query)) continue;
      sources.add(held.source);
    }

    for (const source of [...sources].sort()) {
      spent.push({ holder: holder as CharacterId, source });
    }
  }

  return spent;
}
