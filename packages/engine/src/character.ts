import { SKILL_ABILITY, type Ability, type CharacterId, type RollMode, type Skill } from '@ie/shared';
import type {
  ActivatedFeature,
  CastingOption,
  ShapeShift,
  HealingTouch,
  HitOption,
  ObjectMaker,
  PoolOption,
  RecoveryFeature,
  SelfHealFeature,
  StandingEffect,
  StrikeStyle,
  TradeFeature,
} from './standing.js';
import type { ConferrableReaction, ReactionFeature } from './reactions.js';
import type { NamedAction } from './combat.js';
import type {
  Armor,
  MonsterAttack,
  MonsterMultiattack,
  MonsterRecharge,
  MonsterSave,
  MonsterTrait,
  WeaponMastery,
} from '@ie/srd';

/**
 * Derived character statistics.
 *
 * Everything here is a pure function of a {@link CharacterSheet} — no dice, no
 * state, no I/O. These are the numbers the rest of the engine builds on: what a
 * check adds, what a save adds, what a hit has to beat.
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

export type AbilityScores = Readonly<Record<Ability, number>>;

/**
 * The ceiling on an ability score, for every character and every score no
 * feature has lifted.
 *
 * **Here rather than in `progression.ts` beside `MAX_LEVEL`, and rather than
 * as the bare `20` `creation.ts` used to carry inside one refusal.** A level
 * is progression's subject; a score is this file's — `AbilityScores` and
 * `abilityModifier` are what the rest of the engine reads a score through, so
 * the number a score may not pass belongs beside them, and one name is what
 * lets a second reader ask the same question rather than repeat the literal.
 *
 * It is a **default and not a constant of the rules**: an `ability-score-increase`
 * grant lifts it for the scores its own feature touches — SRD's Epic Boons
 * reach 30 and two capstones reach 25 — and nothing lifts it for all six at
 * once. `creation.ts` resolves the per-ability ceiling, because only the
 * character's features know which of them have been lifted.
 */
export const ABILITY_SCORE_MAXIMUM = 20;

/**
 * The highest score anything in the rules reaches, lifted ceiling included.
 *
 * SRD's Epic Boons print "to a maximum of 30" and nothing prints more, so 30
 * is what a score *can* be rather than what a character may raise one to —
 * the difference between this and {@link ABILITY_SCORE_MAXIMUM}. It is the
 * bound `checkAbilities` holds a raw assignment to and the bound an item that
 * **sets** a score is held to, and it is one name because it was the same
 * literal in two files the moment the second reader existed.
 */
export const MAX_ABILITY_SCORE = 30;

export type ProficiencyLevel = 'none' | 'proficient' | 'expertise';

export interface ArmorTraining {
  readonly light: boolean;
  readonly medium: boolean;
  readonly heavy: boolean;
  readonly shields: boolean;
}

/**
 * One attack a stat block prints, under the name it prints it: `Bite`.
 *
 * The line's own numbers — see `MonsterAttack` — plus the heading they were
 * printed under, because that heading is how a caller names the attack and how
 * a log reads afterwards.
 */
export interface StatedAttack extends MonsterAttack {
  readonly name: string;
  /**
   * What brings this attack back once it has been used, where its heading
   * prints a recharge.
   *
   * **Carried from the line onto the attack**, because the two readers of it
   * want different things in the same breath: the default Opportunity Attack
   * has an attack in its hand and must leave a breath weapon out of the
   * choice, and the swing that spends one has to know what it would take to
   * get it back. The book prints it on the heading, which is why `Feature`
   * owns it in `@ie/srd` and this is a copy the adapter makes rather than a
   * second place it could be written.
   */
  readonly recharge?: MonsterRecharge;
  /**
   * How many times between dawns this attack may be made, where its heading
   * prints a limit — see {@link StatedAction.perDay}, which carries the rule.
   *
   * **No SRD attack line prints one**, and it is here anyway, because the
   * adapter is the door homebrew comes through as well as the book and a
   * limit dropped at the door is a limit that silently becomes none. One
   * reader today: `bestPrintedMeleeAttack`, which leaves a once-a-day line out
   * of the default Opportunity Attack for exactly the reason it already leaves
   * out a recharging one.
   */
  readonly perDay?: number;
}

/**
 * One line a stat block prints under **Bonus Actions**, as printed.
 *
 * The heading and the sentence, and nothing derived from either. A caller
 * names the line by its heading — including whatever the book prints inside it
 * — exactly as a caller names a printed attack, so the string a log carries
 * and the string the block prints are one.
 */
export interface StatedBonusAction {
  readonly name: string;
  /** The book's sentence, verbatim, because a spend reports it. */
  readonly text: string;
  /**
   * What brings this line back once it has been taken, where its heading
   * prints a recharge — see {@link StatedAttack.recharge}.
   *
   * Thirteen of the SRD's Bonus Action lines print one, including the only
   * line in the book that prints the rest form. Absent on the rest, which is a
   * line a creature may take every turn.
   */
  readonly recharge?: MonsterRecharge;
  /**
   * How many times between dawns this line may be taken, where its heading
   * prints a limit — see {@link StatedAction.perDay}, which carries the rule.
   *
   * **Twelve of the SRD's Bonus Action lines print one**, which is more than
   * any other section the engine can spend from: Divine Aid, Misty Step,
   * Spiritual Weapon, Rampage, a Unicorn's Blessing.
   */
  readonly perDay?: number;
  /**
   * The saving throw this line forces, where its sentence is the book's save
   * template — see {@link StatedAction.save}, which this is the same field as
   * and for the same reason.
   *
   * **It is here because the book prints it here.** Three Trample lines — the
   * Gorgon's, the Elephant's and the Mammoth's — write the template under
   * **Bonus Actions**, and what a heading changes is what the line *costs*
   * and nothing else the engine can see. So the field is on both sections and
   * `forcePrintedSave` spends whichever slot the heading names.
   */
  readonly save?: MonsterSave;
}

/**
 * One line a stat block prints under **Actions** that the parser read nothing
 * out of, as printed.
 *
 * The heading, the sentence and whatever recharge the heading carries — the
 * same three fields {@link StatedBonusAction} holds, because the two sections
 * differ in what a line *costs* and in nothing else the engine can see. A
 * caller names the line by its heading, exactly as a printed attack is named.
 */
export interface StatedAction {
  readonly name: string;
  /** The book's sentence, verbatim, because a spend reports it. */
  readonly text: string;
  /**
   * What brings this line back once it has been taken, where its heading
   * prints a recharge — see {@link StatedAttack.recharge}.
   *
   * **Where most of the book's recharges are**: seventy-one of them are
   * printed on one of these lines, against thirteen under Bonus Actions and a
   * handful on attacks. Absent on the rest, which is a line a creature may
   * take every turn.
   */
  readonly recharge?: MonsterRecharge;
  /**
   * How many times between dawns this line may be taken, where its heading
   * prints a limit: "Dominate Mind (2/Day)" is 2.
   *
   * **The book's other sentence about how often, and it is not a recharge.**
   * A recharge is a d6 at the start of a turn and a rest; this is a count, and
   * the owner has ruled that it comes back at **dawn** — the `Recovery` tag
   * the engine has always kept apart from the two rest tags. Sixty headings
   * across the SRD print the notation and none of them prints both, which is
   * asserted over the corpus where the book is parsed.
   *
   * What the creature has *spent* against this number is a `Tally` tagged
   * `dawn` in its own resources — see `perDayTallyKey` — for the reason the
   * recharge's expenditure is state and not sheet: this is what the block
   * prints, and that is what happened. The ceiling is here because a tally
   * has none.
   *
   * Absent on the rest, which is a line a creature may take every turn.
   */
  readonly perDay?: number;
  /**
   * The saving throw this line forces, where its sentence is the book's other
   * template — see `MonsterSaveSchema`.
   *
   * **It is on one of *these* lines rather than beside the attacks**, and the
   * reason is what a heading costs rather than what it says: a line that
   * forces a save prints no attack roll, so it was never an attack and has
   * always come down this road. What changes is only that a caller now has
   * two things it can do with it — `takeStatedAction` spends the Action and
   * hands the sentence over, as it does for every line; `forcePrintedSave`
   * spends the same Action and rolls the save.
   *
   * Absent on every line whose sentence says anything else, which is most of
   * them: a condition after the damage, a second rung of failure, a trigger
   * before the save. Those are still handed over whole.
   */
  readonly save?: MonsterSave;
}

/**
 * One line a stat block prints under **Traits** whose save a *moment* forces.
 *
 * SRD Magmin's Death Burst and SRD Ghast's Stench: the template word for word,
 * under a heading nobody spends. That is exactly why they are here and why
 * they were nowhere for two batches — a trait is not a line a creature takes,
 * so `forcePrintedSave` cannot reach one, and a save nothing could reach was a
 * die nothing could ever throw.
 *
 * What changed is that `MonsterSave.trigger` says *when*: the fold raises the
 * save the moment settles — a death, a turn beginning inside the aura — and
 * `resolvePendingSaves` rolls it. So the raiser needs the line on the pinned
 * sheet, where every other stat-block fact is pinned.
 *
 * **Only the lines that carry a save**, which is ten across the whole
 * bestiary. A trait's *mechanic* is {@link StatedValues.traits}, a different
 * vocabulary with a different reader, and a trait that is neither is prose in
 * the catalogue where a DM reads it.
 */
export interface StatedTrait {
  readonly name: string;
  /** The book's sentence, verbatim, because what the engine hands back quotes it. */
  readonly text: string;
  /** The saving throw the line forces — always one a trigger says the moment of. */
  readonly save: MonsterSave;
}

/**
 * A day's grace from **one creature's one printed line**.
 *
 * > SRD Ghost: "_Success:_ The target is immune to this ghost's Horrific
 * > Visage for 24 hours." SRD Mummy's Dreadful Glare and SRD Nalfeshnee's
 * > Horror Nimbus print it word for word.
 *
 * The eighteenth member of the family `grantsOf` enumerates, and it is here —
 * beside {@link StatedAction}, whose `save` is what it holds off — for
 * `GrantedArmorClass`'s reason: a grant lives with the vocabulary it is
 * written in rather than with the other grants.
 *
 * **Not a condition Immunity**, and the difference is the whole of why it is
 * its own family: `GrantedConditionImmunity` refuses a *condition* from any
 * source at all, and a creature that shrugged off the visage is still
 * Frightenable by a second ghost, by a Lion's Roar and by Fear. What this
 * refuses is one heading on one creature, which is exactly what
 * `printedLineSource` names — so the source is the whole of the identity and
 * the `grants` deadline over it is the whole of the lifetime, exactly as it
 * is for the seventeen families beside it.
 */
export interface GrantedLineImmunity {
  /** `printedLineSource(who, line)` — `printed:ghost:Horrific Visage`. */
  readonly source: string;
  /** The creature whose line it is, so a refusal reads as a sentence. */
  readonly by: CharacterId;
  /** The printed heading, for the same reason. */
  readonly line: string;
}

/**
 * Values a stat block states outright instead of deriving.
 *
 * A character's Armour Class follows from what they are wearing and their
 * Dexterity; a monster's is simply printed. The same goes for its saving
 * throws, its skills and its proficiency bonus — a stat block can and does
 * carry numbers that no derivation would produce. Forcing a monster through
 * the character derivations would quietly change its numbers.
 *
 * **A block states what it *does* on the same terms it states what it is.**
 * `+4, reach 5 ft., 5 (1d6 + 2) Piercing` is four printed numbers, and the
 * Engine owing them to a caller rather than asking for them is the same rule
 * that put the printed Armour Class here. So the two lists below are on this
 * shelf beside the numbers rather than in the feature vocabulary a class is
 * written in: nothing compiled them, nothing may end them, and a reader
 * reaches them exactly where it reaches a monster's Armour Class.
 */
export interface StatedValues {
  readonly armorClass?: number;
  /**
   * SRD "Damage Threshold": "A creature or an object that has a damage
   * threshold has Immunity to all damage unless it takes an amount of damage
   * from a single attack or effect equal to or greater than its damage
   * threshold, in which case it takes that entire instance of damage."
   *
   * **A printed defensive number, so it sits beside the printed Armour
   * Class.** That is not tidiness; it is what keeps the frozen fixtures
   * frozen. The sheet is already pinned whole into `creature-added`, so a
   * threshold reaches state, the fold and a reload with no new event field, no
   * new region of `CreatureState` and no migration — where a field on the
   * event or on `Vitals` would have needed all three.
   *
   * **Not expressible as a `DamageDefenses`**, which was the first thing
   * checked: that record is three booleans per damage *type*, and a threshold
   * is a comparison against the *size* of one instance across every type at
   * once. Immunity to everything below ten is not immunity to anything.
   *
   * Absent for every character and every stat block the SRD prints, and absent
   * means there is no threshold rather than a threshold of zero.
   */
  readonly damageThreshold?: number;
  /**
   * This thing has no ability scores at all.
   *
   * SRD "Breaking Objects": "An object lacks ability scores unless a rule
   * assigns scores to the object. Without ability scores, an object can't make
   * ability checks, and **it fails all saving throws**."
   *
   * **A stated fact rather than six zeroes**, because zeroes are a number and
   * this is an absence. `objectSheet` writes 0 across the board, which is the
   * nearest the scores can come to saying nothing - and a modifier of -5 is
   * still a modifier: a door caught in a Fireball would make its Dexterity
   * save about a third of the time and halve the damage, which is the wrong
   * answer that naming the gap in a comment did not fix.
   *
   * **Read in `checks.ts`, once**, where every saving throw in the engine
   * already passes through one `resolve`. Ten call sites throw saves and not
   * one of them has to know what an object is; the sheet says, and the rule is
   * applied where the die is. The die is still thrown and recorded, exactly as
   * it is for the Stunned condition's automatic failure and for SRD Blight's
   * "A Plant creature automatically fails the save" - other effects can care
   * what it showed.
   *
   * **The other half of the sentence is not here.** "Can't make ability
   * checks" is a *refusal* and not a failure, which is a different shape and a
   * different door; nothing in the engine asks a door for a check today, and
   * inventing an answer would be picking one of the two readings by accident.
   */
  readonly noAbilityScores?: true;
  readonly proficiencyBonus?: number;
  /**
   * The Initiative modifier a stat block prints, which need not equal the
   * Dexterity modifier: an Adult Red Dragon has +0 Dexterity and Initiative
   * +12. Callers should never have to construct a compensating bonus.
   */
  readonly initiative?: number;
  readonly saves?: Partial<Record<Ability, number>>;
  readonly skills?: Partial<Record<Skill, number>>;
  /**
   * The attacks the block's Actions section prints, in printed order.
   *
   * Absent for every character and for a block whose attacks nobody could
   * read, which are the same absence: this creature makes no attack the engine
   * can roll on its own, and a caller who wants one names a weapon.
   */
  readonly attacks?: readonly StatedAttack[];
  /**
   * The mechanics the block's traits state, where the parser recognised one.
   *
   * A short list on purpose — a trait is English, and what is here is the
   * handful of sentences somebody has matched. The rest of a creature's traits
   * stay prose in the catalogue, where a DM reads them.
   */
  readonly traits?: readonly MonsterTrait[];
  /**
   * The block's trait lines that force a save, in printed order.
   *
   * Beside {@link traits} rather than inside it, because the two are different
   * questions with different readers: a `MonsterTrait` is a mechanic a
   * standing rule consults, and this is a line with a DC and a moment on it
   * that the fold raises and a command rolls. See {@link StatedTrait}.
   *
   * Absent for every character and for every block whose traits print no save,
   * which is all but ten in the SRD.
   */
  readonly traitSaves?: readonly StatedTrait[];
  /**
   * The **named sequence** the block's Multiattack prints, where it prints one
   * this engine can execute.
   *
   * A stat block is not a character's sheet. `attacksPerAction` says how many
   * swings the Attack action holds, which is the whole of what a class feature
   * gives — and it is *not* the whole of what a Multiattack says: "the ghoul
   * makes two Bite attacks" names the attacks as well as counting them, and a
   * creature allowed two of anything is a creature the book did not print.
   *
   * So the count and the composition are two fields, both stated: the count is
   * `attacksPerAction` above, derived from this one's total, and this is what
   * each of those swings is allowed to be. Absent for every character and for
   * every block whose sentence says something else — an alternative, a free
   * choice from a menu, a use that is not an attack — and absent is what the
   * engine had before any of this: one attack, named by the caller.
   *
   * Every name here is a line the same block prints, bound by the adapter
   * before it reaches the sheet, so nothing downstream has to wonder whether
   * a sequence names an attack that exists.
   */
  readonly multiattack?: MonsterMultiattack;
  /**
   * The lines the block prints under **Bonus Actions**, in printed order.
   *
   * A name and the book's sentence, which is the whole of what one of these
   * lines *is*: the SRD prints seventy-five of them and not one prints an
   * attack roll, so there is no structure under the heading for a parser to
   * carry — they cast a spell, force a saving throw, take another action,
   * move, shape-shift, teleport, or are prose.
   *
   * The sentence is here because a line is spent deliberately by a caller who
   * then has to be told what it says: the engine applies none of it, so a
   * spend that did not hand the sentence back would be a creature doing
   * something nobody could act on. {@link unreadActions} below now says the
   * same, for the same reason, since the same spend arrived for it.
   *
   * Nothing branches on a name. A caller names a line, `statedBonusActionOf`
   * finds it, and the name is written into the log — the same way a printed
   * attack is named and for the same reason.
   *
   * Absent for every character and for a block that prints none.
   */
  readonly bonusActions?: readonly StatedBonusAction[];
  /**
   * The Actions lines the parser read nothing out of, in printed order.
   *
   * **This held names alone, and the reason it no longer does is a spend.**
   * The argument for names was that these lines are a *report about an
   * absence* — what a swing quotes when it says it could not size the Attack
   * action — and that their prose is kilobytes nobody had a use for. The first
   * half is still true and is the second paragraph below. The second half
   * stopped being true the moment `takeStatedAction` existed: two hundred-odd
   * lines the engine applies no part of are handed over rather than executed,
   * and a hand-over with no sentence in it is a creature doing something
   * nobody can act on.
   *
   * **And the sentence could not live anywhere else.** The other candidate was
   * to keep names here and let the spend read the block out of content and pin
   * the one sentence it quotes into its own event — cheaper in the log, and it
   * does not work: the turn boundary asks `rechargeOfLine` of this sheet with
   * no content in its hand, `adaptMonster` is a door a block reaches a fight
   * through with no catalogue behind it at all, and a caller who could state
   * the prose would be a caller stating the rules. So the record is pinned
   * where every other stat-block fact is pinned, at the arrival, and the event
   * a spend writes carries the name alone. The price is measured rather than
   * feared: across the whole SRD bestiary the worst block gains under two
   * kilobytes, a third of them gain nothing, and the field is absent — not
   * empty — on every block the parser read whole.
   *
   * It exists because an absence otherwise looks like an answer. A block that
   * prints no Multiattack and a block whose Multiattack the parser could not
   * read both reach the sheet with no sequence on them, and only the second is
   * a creature whose Attack action the engine has *assumed* the size of — SRD
   * Hydra's "as many Bite attacks as it has heads" is the sentence.
   *
   * **It does not tell the two apart, and a reader must not think it does.**
   * Which lines went unread is all this holds; whether one of them was the one
   * that sized the action is exactly what the parser could not say. So a swing
   * whose block left *anything* unread reports what it was — a Winter Wolf's
   * Cold Breath as readily as a Hydra's Multiattack — and claims only that
   * something went unread. That is narrower than every stat block without a
   * sequence, which would be noise about a fact that is not missing, and wider
   * than the handful of blocks whose unread line is the one that sizes the
   * action — which is the honest width of what the engine knows.
   *
   * Absent for every character and for every block the parser read whole.
   */
  readonly unreadActions?: readonly StatedAction[];
}

/**
 * What a use of one of this character's pools buys in the turn budget.
 *
 * `PoolOption`'s neighbour, resolved at creation the same way and out of the
 * same grant: the pool grant prices it and `BudgetPurchaseGrant` says what it
 * is. It is declared here rather than in `standing.ts` beside the rest because
 * nothing about it is derived from state — there is no rule to re-read on
 * every look, only a purchase to make and a `TurnBudget` to write.
 */
export interface BudgetPurchase {
  /** The feature that sells it, by id — SRD's Monk's Focus. */
  readonly feature: string;
  readonly featureName: string;
  /** The purchase, by id — SRD's Flurry of Blows. */
  readonly purchase: string;
  readonly name: string;
  /** The pool a use comes out of, which may be another feature's. */
  readonly pool: string;
  readonly action: 'action' | 'bonus-action' | 'none';
  readonly extraAction?: { readonly except?: readonly NamedAction[] };
  readonly extraAttacks?: { readonly count: number; readonly unarmedOnly: boolean };
  readonly oncePerTurn?: boolean;
}

/**
 * The five Speeds the SRD prints, as the name of a move rather than a number.
 *
 * `walk` is the unqualified one — "your Speed", the field every rule that does
 * not say otherwise reads — and the other four are the glossary's: "Some
 * creatures have a Climb Speed, a Fly Speed, a Swim Speed, or a Burrow Speed."
 * A mode is what a *move* names, which is why it lives here beside the sheet
 * that holds the Speeds rather than in `positioning.ts` beside the lattice: a
 * mode is a fact about the mover, not about the ground.
 */
export type MovementMode = 'walk' | 'fly' | 'climb' | 'swim' | 'burrow';

/** Every mode, for a caller enumerating them; `walk` first, as the book does. */
export const MOVEMENT_MODES: readonly MovementMode[] = [
  'walk',
  'climb',
  'fly',
  'swim',
  'burrow',
];

/**
 * The four Speeds beside walking, and the one fact that rides with a Fly Speed.
 *
 * Shaped like the stat block's printed line, because that is where all but a
 * spell's come from: a block prints "Speed 20 ft., Fly 40 ft." and
 * `adaptMonster` carries both rather than dropping the second.
 *
 * Every field is optional and absent means the creature has no such Speed.
 * Zero is not written: a printed 0 and an absent line say the same thing about
 * a mode nobody has, and one spelling keeps `speedInMode` from having to tell
 * them apart.
 */
export interface OtherSpeeds {
  readonly climb?: number;
  readonly fly?: number;
  readonly swim?: number;
  readonly burrow?: number;
  /**
   * SRD "Flying": a flier that hovers is the exception to the fall.
   *
   * On the speeds rather than beside them because the book prints it there —
   * "Fly 40 ft. (hover)" — and because it means nothing without one: a
   * creature that cannot fly cannot hover either, and `fliesWithoutFalling`
   * reads the pair.
   */
  readonly hover?: boolean;
}

/**
 * A feature that pays its holder when an enemy reaches 0 Hit Points.
 *
 * SRD Dark One's Blessing, compiled: the ability is still a name, because a
 * modifier is a number on the sheet at the moment the enemy falls, and the
 * class level is already a number, because only creation can read one class's
 * column for a character who is also something else. See the
 * `on-dropping-a-hostile` grant.
 */
export interface DropReward {
  /** The granting feature's id, for the log and for a reader. */
  readonly feature: string;
  /** Its printed name, which is what the log says paid the points. */
  readonly name: string;
  /** SRD's "your Charisma modifier", read off the sheet as it stands. */
  readonly ability: Ability;
  /** SRD's "plus your Warlock level", resolved at that class's own level; 0 where none is added. */
  readonly classLevel: number;
  /** SRD's "(minimum of 1 Temporary Hit Point)". */
  readonly minimum: number;
  /**
   * SRD's "if someone else reduces an enemy within 10 feet of you".
   *
   * Absent is the holder's own kills and nothing else, which is what a feature
   * printing only the first sentence says.
   */
  readonly within?: number;
}

export interface CharacterSheet {
  readonly level: number;
  readonly abilities: AbilityScores;
  readonly skills: Readonly<Partial<Record<Skill, ProficiencyLevel>>>;
  readonly saveProficiencies: readonly Ability[];
  /** Body armour worn, if any. Must not be a Shield. */
  readonly armor: Armor | null;
  /** Shield held, if any. Must be category `shield`. */
  readonly shield: Armor | null;
  readonly armorTraining: ArmorTraining;
  /** Walking speed in feet before armour penalties. */
  readonly baseSpeed: number;
  /**
   * The other Speeds this creature has, where it has any.
   *
   * SRD prints five and the engine held one. The walking Speed keeps its own
   * field because every rule that says "your Speed" unqualified means that
   * one; the other four are optional, and **absent is not zero with extra
   * steps** — a creature with no Fly Speed cannot fly at all, while one whose
   * Fly Speed is momentarily 0 has been stopped, and only the second of those
   * falls out of the sky. See {@link speedInMode} for the reader that keeps
   * the two apart, and `commands/movement.ts` for what each mode charges.
   *
   * Optional, and absent means walking only — what every sheet written before
   * this field says, which is why both frozen fixtures fold unchanged and
   * neither was regenerated.
   */
  readonly speeds?: OtherSpeeds;
  /**
   * How many hands this creature has to hold things in.
   *
   * Absent is two, which is every creature the SRD prints a head count for and
   * every creature it does not: the book gives no line for it and says "two
   * hands" in the weapon properties as if nothing else were possible. The
   * field exists because content may say otherwise — a homebrew four-armed
   * thing wields two weapons and a shield without the engine learning its name
   * — and because a creature can be left with none.
   *
   * What it is *not* is a slot list. SRD has one two-handed rule, one shield
   * and no off-hand, so the fact a rule ever asks for is a **count**: how many
   * are free. See `freeHands` in `commands/inventory.ts`, which is the only
   * thing that subtracts.
   */
  readonly hands?: number;
  /**
   * How long a Long Rest takes this creature, in seconds.
   *
   * SRD Trance: "You can finish a Long Rest in 4 hours if you spend those
   * hours in a trancelike meditation, during which you retain consciousness."
   * A Long Rest was eight hours for everybody — one constant inside `rest.ts`
   * with no per-creature answer at all — and a trait that shortens it for its
   * holder alone had nothing to bend.
   *
   * **Absent is `LONG_REST`**, which is every sheet ever written, so both
   * frozen fixtures fold unchanged and eight hours stays the answer for
   * everybody the book says nothing about.
   *
   * **A fact of the sheet rather than a derived standing effect**, and the
   * sentence is why: there is no state for a reader to consult. An Elf in
   * Heavy armour, Stunned, Poisoned or at one hit point still finishes a Long
   * Rest in four hours, so a grant recomputed on every read would recompute
   * one answer. It sits here beside {@link hands} and `armorTraining`, which
   * are the other facts creation pins and nothing turns off — and `endRest`
   * reads it through `sheetAsItStands`, so an item that ever granted it would
   * reach the rest by the door the Constitution modifier already uses.
   *
   * **The cooldown is not this**, because the SRD does not shorten it: "you
   * must wait at least 16 hours before starting another one" is printed on
   * the rest and Trance says nothing about it.
   */
  readonly longRestSeconds?: number;
  readonly spellcastingAbility: Ability | null;
  /**
   * Weapon categories this character is proficient with.
   *
   * The vocabulary a class definition uses — `simple`, `martial`, and the two
   * qualified ones the SRD actually prints: the Monk's "Martial weapons that
   * have the Light property" and the Rogue's "Martial weapons that have the
   * Finesse or Light property". Absent means nobody has said, and a creature
   * nobody has said about is treated as proficient — a stat block prints its
   * attack bonus outright, so deriving one for a monster would be inventing a
   * number the block already gave.
   */
  readonly weaponProficiencies?: readonly string[];
  /**
   * Alternative ways to work out base Armour Class, from class features.
   *
   * SRD writes three of these and they differ in both halves. Absent, and a
   * creature's Armour Class is derived exactly as it always was.
   */
  readonly unarmoredDefense?: readonly UnarmoredDefense[];
  /**
   * Benefits this creature's features grant for as long as their rule holds.
   *
   * Resolved at creation, evaluated from state at every read — see
   * `standing.ts`. On the sheet rather than on the creature because it is a
   * property of what the character *is*, not of what has happened to them:
   * nothing applies an aura and nothing takes it away.
   */
  readonly standing?: readonly StandingEffect[];
  /**
   * Features this character can switch on, and what switching them on costs.
   *
   * Resolved at creation like `standing`, and for the same reason: the reducer
   * has to know what ends a running Rage without re-deriving a class table on
   * every event.
   */
  readonly activated?: readonly ActivatedFeature[];
  /**
   * Features that lay another creature's stat block over this sheet — SRD
   * Wild Shape — with the Beast Shapes table read at this character's level.
   * See `ShapeShift`; what a form does to the sheet is `assumeStatBlock`.
   */
  readonly shapeShifts?: readonly ShapeShift[];
  /**
   * Features that make a thing with statistics of its own — SRD Gnomish
   * Lineage's clockwork device. See `ObjectMaker`; what a making puts in the
   * room is a creature, so nothing about the thing itself is on this sheet.
   */
  readonly objectMakers?: readonly ObjectMaker[];
  /**
   * Features that give another pool's uses back — Sorcerous Restoration,
   * Magical Cunning.
   *
   * Resolved at creation beside `activated`, and for the same reason: what a
   * feature refills is named by a class table, and Pact Magic's pool key
   * carries a slot level that moves as the Warlock levels.
   */
  readonly recoveries?: readonly RecoveryFeature[];
  /**
   * Features that spend one resource to buy another — Wild Resurgence.
   *
   * Resolved at creation beside `recoveries`, and for the same reason: what a
   * trade gives and takes is a pool key, and a spell slot's key carries a
   * level the grant cannot write.
   */
  readonly trades?: readonly TradeFeature[];
  /**
   * Features whose use is spent to heal their own holder — Second Wind,
   * Wholeness of Body.
   *
   * Resolved at creation beside `recoveries`, because one of the two reads its
   * die off a class table.
   */
  readonly selfHeals?: readonly SelfHealFeature[];
  /**
   * Pools of hit points spent by touching somebody — Lay On Hands, and the
   * Restoring Touch that lengthens the list of conditions it lifts.
   *
   * Resolved at creation, because what one feature can lift is the union of
   * what several of them say.
   */
  readonly healingTouch?: readonly HealingTouch[];
  /**
   * What a use of a feature's pool buys, where what it buys is an effect list
   * — SRD Channel Divinity's menu.
   *
   * Resolved at creation beside `healingTouch`, and for the same reason both
   * of its neighbours are: the dice are a column of a class table read at that
   * class's own level, and the spellcasting ability the DC comes from belongs
   * to the class that granted the feature rather than to the character.
   */
  readonly poolOptions?: readonly PoolOption[];
  /**
   * What a use of a feature's pool buys, where what it buys is room in the
   * turn's own budget — SRD Action Surge, SRD Flurry of Blows.
   *
   * Resolved at creation beside `poolOptions`, and for the nearer of its
   * reasons: the menu is the feature's and the pool it is priced in may belong
   * to a different feature, so the answer is read once here rather than a
   * class table being re-opened on somebody's turn.
   */
  readonly budgetPurchases?: readonly BudgetPurchase[];
  /**
   * Whether this character may swap Initiative with a willing ally — SRD
   * Alert's second printed benefit.
   *
   * Resolved at creation off a declaration rather than off a feat's id, for
   * inviolable rule 4's reason: a catalogue without Alert would otherwise lose
   * the rule, and one that spelled it differently would never get it. Absent
   * means no, which is what every creature the engine was ever told about says
   * — including every stat block, none of which prints the sentence.
   */
  readonly initiativeSwap?: boolean;
  /**
   * What a casting of this character's may buy, and what each purchase costs
   * — SRD Metamagic's menu.
   *
   * Resolved at creation beside `poolOptions`, and for the nearer of that
   * field's two reasons: the menu the book prints is not the menu this
   * character has. SRD gives a Sorcerer "two Metamagic options of your choice"
   * out of ten, so the answer is read once, here, and the casting command sees
   * a sheet with two entries on it rather than a class table and a choice to
   * re-apply on every spell.
   */
  readonly castingOptions?: readonly CastingOption[];
  /**
   * What a **hit** buys, where what it buys is an effect list — SRD Stunning
   * Strike.
   *
   * Resolved at creation beside `poolOptions` and for its reasons: the DC is
   * the granting class's to derive, and the pool a rider spends belongs to a
   * feature that may not be this one. The attack path reads the sheet and
   * never a class table.
   */
  readonly hitOptions?: readonly HitOption[];
  /**
   * Reactions this character's features offer, and what each one costs.
   *
   * Resolved at creation beside `selfHeals`, because what one is worth is read
   * off a class table — Deflect Attacks adds the Monk's level, Cutting Words
   * rolls the Bardic Inspiration die, which is a d6 at Bard 1 and a d12 at 15.
   * Recomputing a class table to find out whether an attack opens a window is
   * not a thing to do on every swing.
   */
  readonly reactions?: readonly ReactionFeature[];
  /**
   * Reactions this character can hand to **somebody else** — SRD Bardic
   * Inspiration's die.
   *
   * Resolved at creation beside `reactions`, and for exactly the same reason:
   * the die is a column of the class table, read at that class's own level.
   * What makes it a second field rather than a flag on the first is who ends
   * up holding it — a Reaction on this list is never taken by this character,
   * and one on the list above is never given away.
   */
  readonly conferredReactions?: readonly ConferrableReaction[];
  /**
   * What this character gains when an enemy reaches 0 Hit Points — SRD Dark
   * One's Blessing.
   *
   * Resolved at creation beside `reactions`, and for that field's reason: the
   * grant says "plus your **Warlock** level", which is a column of one class's
   * table, and a Warlock 3 / Fighter 5 is paid three and not eight. The
   * ability modifier stays symbolic and is read off the sheet as it stands at
   * the moment the enemy falls, exactly as a Reaction's addend is.
   */
  readonly onDroppingAHostile?: readonly DropReward[];
  /**
   * How many attacks this character's Attack action holds. One, unless a
   * feature says otherwise.
   *
   * SRD Multiclassing: "If you gain the Extra Attack feature from more than
   * one class, the features don't stack. You can't make more than two attacks
   * with this feature unless you have a feature that says you can." So a
   * Fighter/Ranger has two, not three — the highest grant wins rather than the
   * sum, and the Fighter's own later features are the ones that say more.
   */
  readonly attacksPerAction?: number;
  /**
   * The catalogue ids of the weapons this character has mastery with, sorted.
   *
   * SRD: "a weapon's mastery property is usable only by a character who has a
   * feature, such as Weapon Mastery, that unlocks the property" — so this is
   * the unlocking, per weapon kind, and the properties themselves are printed
   * on the weapons. On the sheet beside `criticalOn` for the reason that one
   * is: it is unconditional, there is no state of the world in which it is not
   * true, and an attack would otherwise re-derive a class table on every
   * swing.
   *
   * **Ids, which are the player's answer rather than the engine's list.** What
   * is written here came out of `featureChoices`, and nothing in the engine
   * names a weapon.
   */
  readonly weaponMasteries?: readonly string[];
  /**
   * Mastery properties this character may use **in place of** a weapon's own.
   *
   * SRD Tactical Master: "you can replace its mastery property with Push, Sap,
   * or Slow for that attack." The substitution is offered per attack and is
   * refused for any property not on this list.
   */
  readonly masterySubstitutions?: readonly WeaponMastery[];
  /**
   * The lowest natural d20 that scores a Critical Hit. 20 unless a feature
   * lowers it.
   *
   * SRD Improved Critical: "Your attack rolls with weapons and Unarmed Strikes
   * can score a Critical Hit on a roll of 19 or 20 on the d20", and Superior
   * Critical lowers it again to 18. On the sheet rather than in `standing.ts`
   * because it is unconditional — there is no state of the world in which a
   * Champion's 19 stops being a critical — and `attacksPerAction` beside it is
   * the same kind of always-on number read off the features.
   */
  readonly criticalOn?: number;
  /**
   * A face of the d20 this creature throws again, and what says so.
   *
   * SRD Luck: "When you roll a 1 on the d20 of a D20 Test, you can reroll the
   * die, and you must use the new roll."
   *
   * **On the sheet for `criticalOn`'s reason turned inside out.** That one is
   * here because it is unconditional; this one is here because it must reach
   * every D20 Test there is. A D20 Test is rolled from seventeen places across
   * eleven command modules, and each of them already asks for the sheet as it
   * stands — so a field read by `checks.ts` and `attack.ts` reaches all of
   * them with nothing to remember, where an option gathered at each site is
   * seventeen places for a trait to be forgotten. That is the fork
   * `savingSupport` exists to prevent, on a wider surface.
   *
   * **Derived rather than compiled**, which is the one way it differs from
   * every neighbour here: `sheetAsItStands` folds it in from the creature's
   * standing effects on every read, so an item or a spell that granted the
   * same sentence would reach the same roller, and taking the item off takes
   * it away again. Creation writes nothing here.
   *
   * It does not reach a die a *table* threw — `resolveStatedD20` is a
   * different path and the engine may not replace a face somebody read out —
   * nor `rerollTest`, which is already a reroll and is handed no sheet.
   */
  readonly rerollsD20On?: {
    /** SRD's "a 1 on the d20". */
    readonly on: number;
    /** The feature that said so, for the log. */
    readonly source: string;
  };
  /**
   * Ways this character's features redefine an attack of their own — the
   * Monk's growing fist, and whatever a homebrew class writes with the same
   * grant.
   *
   * Resolved at creation beside `reactions`, and for the same reason: the die
   * is a column of a class table read at *that class's* level, so a Monk 5 /
   * Fighter 5 rolls the Monk's d8 rather than a level 10 character's d10.
   *
   * **Not in `standing` beside the other conditional benefits**, because a
   * standing effect is a bonus or a mode hung on a creature and this is a
   * substitution inside one roll: which die is thrown at all, and which
   * ability is added to it. `attack.ts` is where those two are decided and a
   * `StandingGrant` has no member that could say either.
   */
  readonly strikeStyles?: readonly StrikeStyle[];
  /** Set for creatures whose numbers are printed rather than derived. */
  readonly stated?: StatedValues;
}

/**
 * SRD: "Ability Scores and Modifiers". Verified to match the printed table for
 * every score it lists — the formula rounds down, so odd negative scores land
 * where you might not expect (5 gives -3, not -2).
 */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** +2 at levels 1-4, rising by 1 every four levels to +6 at 17-20. */
export function proficiencyBonusForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

export function proficiencyBonus(sheet: CharacterSheet): number {
  return sheet.stated?.proficiencyBonus ?? proficiencyBonusForLevel(sheet.level);
}

/**
 * Half the Proficiency Bonus, rounded down.
 *
 * The Bard's Jack of All Trades adds this "to any ability check you make that
 * **uses a skill proficiency you lack** and that doesn't otherwise use your
 * Proficiency Bonus".
 *
 * Note what that excludes. Initiative is a *bare* Dexterity check — it uses no
 * skill at all — so Jack of All Trades does **not** apply to it, despite the
 * 2014 version having done so. Earlier guidance here said otherwise and had a
 * test enshrining it; both were wrong. The rounding is still worth a primitive.
 */
export function halfProficiencyBonus(sheet: CharacterSheet): number {
  return Math.floor(proficiencyBonus(sheet) / 2);
}

export function modifierFor(sheet: CharacterSheet, ability: Ability): number {
  return abilityModifier(sheet.abilities[ability]);
}

export function saveModifier(sheet: CharacterSheet, ability: Ability): number {
  const stated = sheet.stated?.saves?.[ability];
  if (stated !== undefined) return stated;

  const proficient = sheet.saveProficiencies.includes(ability);
  return modifierFor(sheet, ability) + (proficient ? proficiencyBonus(sheet) : 0);
}

export function skillModifier(sheet: CharacterSheet, skill: Skill): number {
  const stated = sheet.stated?.skills?.[skill];
  if (stated !== undefined) return stated;

  const ability = SKILL_ABILITY[skill];
  const level = sheet.skills[skill] ?? 'none';

  const multiplier = level === 'expertise' ? 2 : level === 'proficient' ? 1 : 0;
  return modifierFor(sheet, ability) + multiplier * proficiencyBonus(sheet);
}

/**
 * A class feature that replaces the Armour Class calculation.
 *
 * SRD writes three, and they differ in both halves — which ability joins
 * Dexterity, and whether a Shield is allowed:
 *
 * | Feature | Ability | Shield |
 * |---|---|---|
 * | Barbarian Unarmored Defense | Constitution | "You can use a Shield and still gain this benefit" |
 * | Monk Unarmored Defense | Wisdom | "or wielding a Shield" — forbidden |
 * | Draconic Resilience | Charisma | not mentioned, so allowed |
 *
 * The Monk's Shield clause is the half that gets dropped, and it is not the
 * obvious one: a Monk holding a Shield does not lose the Shield's bonus, they
 * lose the whole alternative calculation and fall back to 10 + Dexterity.
 *
 * None of these applies in armour — every one of them says "while you aren't
 * wearing armor" — so armour still replaces everything, as it always did.
 */
export interface UnarmoredDefense {
  /** The feature that grants it, so a log can say which rule made the number. */
  readonly source: string;
  /** The ability added alongside Dexterity. */
  readonly ability: Ability;
  /** SRD Monk: "while you aren't wearing armor **or wielding a Shield**". */
  readonly shieldAllowed: boolean;
}

/**
 * An alternative base Armour Class an **ongoing effect** supplies.
 *
 * SRD Mage Armor: "the target's base AC becomes 13 plus its Dexterity
 * modifier." That is the same shape {@link UnarmoredDefense} is — a base
 * calculation that replaces `10 + Dexterity` while the wearer is unarmoured,
 * competing with every other such calculation for the best applicable one —
 * and it differs in exactly two ways, which is why it is a second type rather
 * than a reuse of the first:
 *
 * - **the base is not 10.** Every class feature starts from the ordinary base
 *   and adds a second ability; Mage Armor states its own number and adds no
 *   second ability at all;
 * - **it is not on the sheet.** A feature is part of what a creature *is*; a
 *   spell's grant is part of what is currently happening to it, so it lives on
 *   `CreatureState` and carries the casting inside its `source` — the same
 *   link `ActiveBonus` uses, which is what ends it when the casting does.
 *
 * The comparison itself is shared: {@link armorClassCalculation} folds both
 * sources into one "best applicable" pass, because SRD Multiclassing settles
 * that question once for all of them — "If you have multiple ways to calculate
 * your Armor Class, you can benefit from only one at a time."
 */
export interface GrantedArmorClass {
  /** What granted it, carrying the casting: `Mage Armor#cast:3`. */
  readonly source: string;
  /**
   * The number Dexterity is added to: SRD Mage Armor's "13".
   *
   * 10 for every class feature, because every one of them is written as an
   * addition to the ordinary base. Mage Armor is the reason this is a field.
   */
  readonly base: number;
  /**
   * A **second** ability added alongside Dexterity, or null for none.
   *
   * Dexterity is in every base Armour Class calculation the SRD writes, so it
   * is in the formula rather than in this field — which is what the field
   * being null means for Mage Armor. "13 plus its Dexterity modifier" is
   * `base: 13, plusAbility: null`; a Barbarian's is `base: 10,
   * plusAbility: 'con'`. Naming this `ability` reads as though Mage Armor
   * should name Dexterity, and adds it twice.
   */
  readonly plusAbility: Ability | null;
  /** Whether a Shield still adds on top. */
  readonly shieldAllowed: boolean;
}

/** How a creature's Armour Class was arrived at, and by which rule. */
export interface ArmorClassCalculation {
  /** The base before a Shield: 10 + Dexterity, armour's own, or a feature's. */
  readonly base: number;
  /** What a Shield added, or 0. */
  readonly shield: number;
  /**
   * The feature whose calculation won, or null for the ordinary ones.
   *
   * Null covers both "10 + Dexterity" and "the armour being worn", because
   * neither is a feature and the sheet already says which of the two applied.
   */
  readonly source: string | null;
  readonly total: number;
}

/**
 * SRD: base AC is 10 + Dexterity modifier. Armour supplies a *different* base
 * calculation rather than adding to that one — you use one or the other, never
 * both. A Shield then adds on top of whichever base applies.
 *
 * A class feature is a third way, and SRD Multiclassing settles what happens
 * when a character has several: "If you have multiple ways to calculate your
 * Armor Class, you can benefit from only one at a time." That is a choice with
 * exactly one sensible answer — a higher Armour Class costs nothing and gives
 * up nothing — so the best *applicable* calculation is taken and recorded,
 * rather than asking a question whose answer is arithmetic. It is also why a
 * feature never lowers the number: 10 + Dexterity is itself one of the ways.
 *
 * `granted` is the same question asked by an ongoing effect rather than by a
 * feature — see {@link GrantedArmorClass}. It joins the same comparison rather
 * than being applied afterwards, which is what keeps Mage Armor from stacking
 * with a Barbarian's Unarmoured Defense, and it is consulted in the unarmoured
 * branch only, which is what keeps it from applying through plate.
 */
export function armorClassCalculation(
  sheet: CharacterSheet,
  granted: readonly GrantedArmorClass[] = [],
): ArmorClassCalculation {
  const stated = sheet.stated?.armorClass;
  if (stated !== undefined) {
    return { base: stated, shield: 0, source: null, total: stated };
  }

  const { armor, shield } = sheet;

  // Wrong slot is a programmer error, not a rules-legal refusal, so it throws.
  if (armor !== null && armor.category === 'shield') {
    throw new Error(`${armor.name} is a shield and cannot be worn as body armor`);
  }
  if (shield !== null && shield.category !== 'shield') {
    throw new Error(`${shield.name} is not a shield and cannot be held as one`);
  }

  const dex = modifierFor(sheet, 'dex');

  let base: number;
  let source: string | null = null;

  if (armor === null) {
    base = 10 + dex;
    // Every alternative reads Dexterity too, so they differ only in the second
    // ability — but the comparison is on the whole number, because a future
    // feature need not be shaped that way. Mage Armor is the proof of that:
    // it states its own base and adds no second ability.
    const alternatives: readonly GrantedArmorClass[] = [
      ...(sheet.unarmoredDefense ?? []).map((feature) => ({
        source: feature.source,
        base: 10,
        plusAbility: feature.ability as Ability | null,
        shieldAllowed: feature.shieldAllowed,
      })),
      ...granted,
    ];
    for (const alternative of alternatives) {
      if (shield !== null && !alternative.shieldAllowed) continue;
      const theirs =
        alternative.base +
        dex +
        (alternative.plusAbility === null ? 0 : modifierFor(sheet, alternative.plusAbility));
      if (theirs > base) {
        base = theirs;
        source = alternative.source;
      }
    }
  } else {
    const cap = armor.maxDexBonus;
    // The cap limits how much Dex helps; it never turns a penalty into a bonus.
    const dexContribution = armor.addsDexModifier ? (cap === null ? dex : Math.min(dex, cap)) : 0;
    base = (armor.baseAc ?? 10) + dexContribution;
  }

  // A Shield only helps someone trained to use one.
  const shieldBonus = shield !== null && sheet.armorTraining.shields ? (shield.acBonus ?? 0) : 0;

  return { base, shield: shieldBonus, source, total: base + shieldBonus };
}

export function armorClass(
  sheet: CharacterSheet,
  granted: readonly GrantedArmorClass[] = [],
): number {
  return armorClassCalculation(sheet, granted).total;
}

/**
 * SRD: armour listing a Strength score reduces speed by 10 feet unless the
 * wearer's Strength *score* — not modifier — meets it.
 */
export function speed(sheet: CharacterSheet): number {
  const requirement = sheet.armor?.strengthRequirement ?? null;
  const penalty = requirement !== null && sheet.abilities.str < requirement ? 10 : 0;
  return Math.max(0, sheet.baseSpeed - penalty);
}

/**
 * The Speed this sheet prints for a mode, before anything has happened to it.
 *
 * The **base** `speedOf` measures from, and nothing else: no condition, no
 * grant, no armour. Zero for a mode the creature has no Speed in, which is
 * why {@link hasSpeedInMode} exists beside it — a rule that asks "can it fly
 * at all" and a rule that asks "how fast" want different answers about a
 * Cockatrice somebody has Restrained.
 */
export function speedInMode(sheet: CharacterSheet, mode: MovementMode): number {
  if (mode === 'walk') return sheet.baseSpeed;
  return Math.max(0, sheet.speeds?.[mode] ?? 0);
}

/**
 * Whether this creature has a Speed of this kind at all.
 *
 * Read off the sheet rather than off state on purpose: "has a Swim Speed" is a
 * fact about what the creature *is*, and a Restrained fish has a Swim Speed of
 * 0 without having stopped being a fish. SRD's climbing and swimming surcharge
 * asks exactly this question — "unless you have a Climb Speed" — and asking
 * the live number instead would charge a Grappled creature double for a swim
 * it could not make anyway.
 */
export function hasSpeedInMode(sheet: CharacterSheet, mode: MovementMode): boolean {
  return mode === 'walk' || speedInMode(sheet, mode) > 0;
}

/**
 * SRD "Flying": "the creature falls unless it has the Hover trait."
 *
 * True only for a creature that has both — a Fly Speed to lose and the trait
 * that keeps it up when everything else is gone.
 */
export function fliesWithoutFalling(sheet: CharacterSheet): boolean {
  return hasSpeedInMode(sheet, 'fly') && sheet.speeds?.hover === true;
}

/**
 * SRD "Jump", the Long Jump:
 *
 * > "When you make a Long Jump, you leap horizontally a number of feet up to
 * > your Strength score if you move at least 10 feet immediately before the
 * > jump. When you make a standing Long Jump, you can leap only half that
 * > distance."
 *
 * The **score**, not the modifier, which is the one thing about this rule
 * everybody gets wrong: a Strength of 16 jumps sixteen feet, not three. Half
 * is rounded down, because a jump is measured on the same 5-foot lattice
 * everything else is and the book prints no half-foot anywhere.
 */
export function longJumpDistance(sheet: CharacterSheet, running: boolean): number {
  const full = Math.max(0, sheet.abilities.str);
  return running ? full : Math.floor(full / 2);
}

/**
 * SRD "Jump", the High Jump:
 *
 * > "you leap into the air a number of feet equal to 3 plus your Strength
 * > modifier if you move at least 10 feet immediately before the jump. When
 * > you make a standing High Jump, you can jump only half that distance."
 *
 * The **modifier** here, where the Long Jump takes the score — the asymmetry
 * is the book's, and it is why these are two functions rather than one with a
 * flag. Never negative: a Strength of 4 gets a High Jump of nothing, not a
 * hole in the floor.
 */
export function highJumpHeight(sheet: CharacterSheet, running: boolean): number {
  const full = Math.max(0, 3 + abilityModifier(sheet.abilities.str));
  return running ? full : Math.floor(full / 2);
}

/**
 * SRD writes every rule about holding in twos — "requires two hands", "a hand
 * that is free" — and never prints the number, because for everything that
 * carries a weapon it is two.
 */
export const DEFAULT_HANDS = 2;

/** How many hands this creature has; see {@link CharacterSheet.hands}. */
export function handsOf(sheet: CharacterSheet): number {
  return Math.max(0, sheet.hands ?? DEFAULT_HANDS);
}

/** SRD: armour marked "Disadvantage" imposes it on Dexterity (Stealth) checks. */
export function stealthRollMode(sheet: CharacterSheet): RollMode {
  return sheet.armor?.stealthDisadvantage === true ? 'disadvantage' : 'normal';
}

/**
 * SRD "Armor Training": wearing armour you lack training in gives Disadvantage
 * on any D20 Test involving Strength or Dexterity, and prevents spellcasting.
 * This reports the condition; applying it is the caller's job.
 */
export function untrainedArmorPenalty(sheet: CharacterSheet): boolean {
  const armor = sheet.armor;
  if (armor === null || armor.category === 'shield') return false;
  return !sheet.armorTraining[armor.category];
}

/**
 * SRD: 10 + the Wisdom (Perception) check modifier, adjusted by 5 in either
 * direction when the creature has advantage or disadvantage on those checks.
 */
export function passivePerception(sheet: CharacterSheet, mode: RollMode = 'normal'): number {
  const adjustment = mode === 'advantage' ? 5 : mode === 'disadvantage' ? -5 : 0;
  return 10 + skillModifier(sheet, 'perception') + adjustment;
}

/** SRD: 8 + Proficiency Bonus + spellcasting ability modifier. */
export function spellSaveDc(sheet: CharacterSheet): number | null {
  const ability = sheet.spellcastingAbility;
  if (ability === null) return null;
  return 8 + proficiencyBonus(sheet) + modifierFor(sheet, ability);
}

/** SRD: Proficiency Bonus + spellcasting ability modifier. */
export function spellAttackModifier(sheet: CharacterSheet): number | null {
  const ability = sheet.spellcastingAbility;
  if (ability === null) return null;
  return spellAttackModifierWith(sheet, ability);
}

/**
 * The same numbers, for a spellcasting ability that is not the sheet's.
 *
 * A feat brings its own: SRD Magic Initiate says "Intelligence, Wisdom, or
 * Charisma is your spellcasting ability for this feat's spells (choose when
 * you select this feat)". Reading the class's ability for those would be quietly
 * wrong for every character whose feat ability differs — and flatly wrong for a
 * Fighter, who has none at all.
 */
export function spellAttackModifierWith(sheet: CharacterSheet, ability: Ability): number {
  return proficiencyBonus(sheet) + modifierFor(sheet, ability);
}

export function spellSaveDcWith(sheet: CharacterSheet, ability: Ability): number {
  return 8 + proficiencyBonus(sheet) + modifierFor(sheet, ability);
}

/**
 * SRD Illumination: the light a stat block says its creature carries, or null.
 *
 * > "The azer sheds Bright Light in a 10-foot radius and Dim Light for an
 * > additional 10 feet."
 *
 * Both radii, for {@link printedLeap}'s reason: the sentence prints two
 * numbers and a reader that took one would be enforcing half of it. The second
 * is the book's own "for an additional", so it is measured **beyond** the
 * first.
 *
 * **Here rather than in `monster.ts` beside its siblings**, and the reason is
 * the reader: `lightAt` in `positioning.ts` is what spends this, and that
 * module is deliberately kept next to the leaves — it holds `events.ts`
 * type-only so that a value edge back would not be a cycle, and an edge to
 * `monster.ts` would pull the combat, checks and dice half of the engine in
 * through the geometry. This file has no value import but `@ie/shared`, so it
 * is the one place a sheet-reading predicate can sit and be reachable from
 * there.
 */
export function printedLight(
  sheet: CharacterSheet,
): { readonly brightRadiusFeet: number; readonly dimBeyondFeet: number } | null {
  for (const trait of sheet.stated?.traits ?? []) {
    if (trait.kind === 'sheds-light') {
      return { brightRadiusFeet: trait.brightRadiusFeet, dimBeyondFeet: trait.dimBeyondFeet };
    }
  }
  return null;
}

/**
 * What a creature adds to its Initiative roll.
 *
 * A character derives it from Dexterity. A stat block prints it, and the two
 * need not agree — an Adult Red Dragon has a +0 Dexterity modifier and prints
 * Initiative +12. Reading Dexterity for a monster silently dropped twelve
 * points off every legendary creature's place in the order.
 */
export function initiativeModifier(sheet: CharacterSheet): number {
  return sheet.stated?.initiative ?? modifierFor(sheet, 'dex');
}
