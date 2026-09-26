import {
  err,
  needsContext,
  ok,
  type CharacterId,
  type Result,
  type RollMode,
} from '@ie/shared';
import type { Rng } from './dice.js';
import type { Bonus, ModeSource } from './bonuses.js';
import { initiativeModifier, type CharacterSheet } from './character.js';
import { rollD20Test, type D20Roll } from './checks.js';
import {
  exhaustionBonus,
  initiativeConditionModes,
  isIncapacitated,
  type ConditionState,
} from './conditions.js';
import type { RollIssuer } from './rolls.js';
// Type-only, and deliberately: this module sits beneath the geometry and a
// value edge to it would be an economy that could not be reasoned about
// without a map. What a `MoveSegment` needs is the shape of a coordinate, and
// nothing here ever measures one.
import type { Point } from './positioning.js';

/**
 * Initiative and the turn economy.
 *
 * Positional questions — who is within 5 feet of whom, what is in reach — are
 * not answered here; they belong to `zones.ts`. This module owns the order of
 * turns and what each combatant may still spend on theirs.
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

/**
 * What a roll of Initiative is called in the log.
 *
 * One spelling, in the module that owns Initiative, because two rules read it
 * from opposite ends of the engine: `commands/initiative.ts` writes it onto
 * the `roll-recorded` it emits, and the fold's rest-interruption pass matches
 * on it to obey SRD's "Rolling Initiative". A string one module spells and
 * another matches is a rule that stops applying the day somebody rewords a
 * label, and neither end would say so.
 */
export const INITIATIVE_LABEL = 'Initiative';

export interface InitiativeOptions {
  readonly modes?: readonly (RollMode | ModeSource)[];
  /**
   * Named modifiers. Initiative is an ability check, so the Alert feat's
   * Proficiency Bonus and a magic item's bonus both apply here.
   *
   * Jack of All Trades does *not*: it needs "an ability check ... that uses a
   * skill proficiency you lack", and Initiative uses no skill at all.
   */
  readonly bonuses?: readonly Bonus[];
  readonly conditions?: ConditionState;
  /** SRD: a combatant surprised by combat starting rolls with Disadvantage. */
  readonly surprised?: boolean;
}

export interface InitiativeRoll extends D20Roll {
  readonly id: CharacterId;
}

/**
 * SRD: "they make a Dexterity check that determines their place in the
 * Initiative order."
 *
 * A bare Dexterity check — no proficiency by default. Surprise is Disadvantage
 * on this roll rather than a condition, which is a 2024 change.
 */
export function rollInitiative(
  issuer: RollIssuer,
  rng: Rng,
  id: CharacterId,
  sheet: CharacterSheet,
  options: InitiativeOptions,
): Result<InitiativeRoll> {
  const conditions = options.conditions;

  const modeSources: ModeSource[] = [
    ...(conditions === undefined ? [] : initiativeConditionModes(conditions)),
    ...(options.surprised === true
      ? [{ source: 'surprised', mode: 'disadvantage' as const }]
      : []),
    ...(options.modes ?? []).map((m) =>
      typeof m === 'string' ? { source: 'situational', mode: m } : m,
    ),
  ];

  const exhaustion = conditions === undefined ? null : exhaustionBonus(conditions);
  const bonuses = [...(options.bonuses ?? []), ...(exhaustion === null ? [] : [exhaustion])];

  // SRD Initiative is a Dexterity check, so it is a D20 Test and SRD Luck
  // reaches it — off the same sheet this function already rolls from.
  const rolled = rollD20Test(
    issuer,
    rng,
    initiativeModifier(sheet),
    modeSources,
    bonuses,
    undefined,
    sheet.rerollsD20On ?? null,
  );
  if (!rolled.ok) return rolled;

  return ok({ ...rolled.value, id });
}

/**
 * SRD: "Your Initiative score equals 10 plus your Dexterity modifier. If you
 * have Advantage on Initiative rolls, increase your Initiative score by 5. If
 * you have Disadvantage on those rolls, decrease that score by 5."
 *
 * For when the GM skips rolling.
 */
export function passiveInitiative(sheet: CharacterSheet, mode: RollMode = 'normal'): number {
  const shift = mode === 'advantage' ? 5 : mode === 'disadvantage' ? -5 : 0;
  return 10 + initiativeModifier(sheet) + shift;
}

/**
 * The slots a turn is spent out of — the action economy, named.
 *
 * Exactly the budget's own spenders, because a member here is a promise that
 * some primitive below refuses it: `spendAction`, `spendBonusAction`,
 * `spendReaction` and `spendMovement`. A rule naming anything else would be a
 * sentence nothing enforces, which is this repository's most-repeated finding.
 *
 * `freeInteraction` is the sixth field of a {@link TurnBudget} and is
 * deliberately **not** here: no SRD sentence forbids a creature the one free
 * object interaction a turn, and a member arrives with the paragraph that
 * writes it.
 */
export const ACTION_SLOTS = ['action', 'bonus-action', 'reaction', 'movement'] as const;

/** One of {@link ACTION_SLOTS}. */
export type ActionSlot = (typeof ACTION_SLOTS)[number];

/**
 * The book's named actions, as far as a spender can tell them apart.
 *
 * A slot says *how much* a thing costs and this says *what it is*, because
 * SRD writes restrictions both ways: Stinking Cloud forbids "an action or a
 * Bonus Action" and Befuddlement forbids "the Magic action" while leaving the
 * rest of the slot alone.
 *
 * **Every member has a spender that names it and an SRD sentence that asks
 * for it**, which is the rule that keeps the list from becoming a wish:
 *
 * | | Named by | Asked for by |
 * |---|---|---|
 * | `attack` | `attackCreature` | Confusion, "it takes the Attack action" |
 * | `dash` | `takeDash` | Fear, Eyebite, Wind Walk |
 * | `disengage` | `takeDisengage` | Conjure Woodland Beings |
 * | `dodge` | `takeDodge` | Bestow Curse, "forced to take the Dodge action" |
 * | `help` | `takeHelp` | the glossary's own Help entry |
 * | `hide` | `takeHide` | Wind Walk, Cunning Action, Naturally Stealthy |
 * | `influence` | `takeInfluence` | the glossary's own Influence entry |
 * | `magic` | every casting route | Befuddlement, Antimagic Field, True Polymorph |
 * | `opportunity-attack` | the Reaction a leaving move offers | Shocking Grasp |
 * | `search` | `takeSearch` | Wind Walk, "Dash, Hide, Search" |
 * | `study` | `takeStudy` | six definitions that ask for it before an Investigation check |
 * | `utilize` | `takeUtilize` | Fast Hands, "the Utilize action as a Bonus Action" |
 *
 * **`hide` was the member that arrived with its spender**, which is the rule
 * this list is kept by rather than an exception to it: the Hide action was
 * left out for four batches because "the engine has no spender that could be
 * told one of them apart", and it is here now because `takeHide` takes it —
 * cover, watchers, the DC 15 Dexterity (Stealth) check and the Invisible
 * condition it buys.
 *
 * **And the last five arrived the same way, in one commit with their five
 * spenders.** Search, Study, Influence and Utilize were listed here as the
 * book's and left to the table for exactly Hide's reason; Help had only the
 * stabilisation half a `declarations.ts` payout already reached. Each is here
 * because a command takes it: `takeUtilize` spends the slot a second object
 * interaction costs, `takeSearch` and `takeStudy` spend the action and roll
 * the check the entry prints, `takeHelp` hangs the one-shot Advantage its two
 * halves buy, and `takeInfluence` rolls the Charisma check against a DC the
 * DM set. Wind Walk's "Dash, Hide, Search" is therefore now writable whole —
 * see {@link ActionRule}, `permits-only`, which fails closed.
 */
export const NAMED_ACTIONS = [
  'attack',
  'dash',
  'disengage',
  'dodge',
  'help',
  'hide',
  'influence',
  'magic',
  'opportunity-attack',
  'search',
  'study',
  'utilize',
] as const;

/** One of {@link NAMED_ACTIONS}. */
export type NamedAction = (typeof NAMED_ACTIONS)[number];

/**
 * The prices a command can actually charge: which action, out of which slots.
 *
 * The consumer side of `ActionRule`'s `allows` member, and the reason it is
 * written down: an allowance nobody can ask for is data no code reads — a
 * sentence that validates, loads, lands on a creature and does nothing, which
 * is the failure this repository finds most often.
 *
 * **It is a map rather than a list of action names, and that is a defect
 * being closed rather than a flourish.** A list guarded the action and left
 * the slot to a separate "is it the normal price" check, so
 * `{ action: 'disengage', from: 'reaction' }` validated — and `takeDisengage`
 * then fell through its ternary and spent an **Action**, which is precisely
 * the quiet substitution {@link DisengageOptions} promises never to make. The
 * pair is the fact, so the pair is what is written down.
 *
 * **Both readers ask this**, which is what makes it a guard rather than a
 * comment: `checkSpellDefinition` refuses an allowance outside it at
 * authoring, and {@link takeDisengage} refuses a `from` outside it at the
 * door — because a caller may state one directly, with no definition anywhere
 * in it. The normal price is **not** a member: an allowance that charges what
 * the book charges grants nothing, and the validator says so in those words.
 *
 * **Three entries, and the two that arrived brought their paragraphs with
 * them.** SRD Conjure Woodland Beings was the first — the one *spell* that
 * moves an action to a cheaper slot — and the others are the sentence a
 * feature writes: SRD Cunning Action, "you can take the Dash, Disengage or
 * Hide action as a Bonus Action", and SRD Adrenaline Rush, "You can take the
 * Dash action as a Bonus Action". Each is admitted here because a command
 * takes the price: `takeDash`, `takeDisengage` and `takeHide` each take a
 * `from` and refuse one this map does not hold.
 *
 * **The fourth arrived the same way**, with its own command and its own
 * paragraph: SRD Fast Hands, "you can use the Utilize action as a Bonus
 * Action", which is the whole of what a Thief's feature says that the engine
 * can charge for. It could not be written at all while no command charged for
 * a Utilize — an allowance with no spend to be offered on — which is the
 * defect this map exists to name.
 *
 * A fifth arrives the same way again.
 */
export const STATABLE_PRICES: Readonly<Partial<Record<NamedAction, readonly ActionSlot[]>>> = {
  dash: ['bonus-action'],
  disengage: ['bonus-action'],
  hide: ['bonus-action'],
  utilize: ['bonus-action'],
};

/** Whether some command will actually charge this slot for this action. */
export const isStatablePrice = (action: NamedAction, from: ActionSlot): boolean =>
  STATABLE_PRICES[action]?.includes(from) ?? false;

/**
 * The slots a named action can actually come out of.
 *
 * `permits-only` narrows a slot to a few named actions, so a slot no action
 * is ever named in can only be narrowed to *nothing* — which is what
 * `forbids` already says, in fewer words. Two spellings of one rule is two
 * places for it to be wrong, so the validator refuses the second.
 *
 * Movement is the slot that is not here: nothing spends it by a name.
 */
export const SLOTS_WITH_NAMED_ACTIONS: readonly ActionSlot[] = [
  'action',
  'bonus-action',
  'reaction',
];

/**
 * What a running effect has changed about what a creature may spend a turn on.
 *
 * **This is not a condition, and the distinction is the whole design.** The
 * fifteen are the book's closed list and none of them forbids the Magic
 * action and leaves the rest of a turn alone; SRD writes that sentence
 * twenty-nine times across the spell list and the engine could say none of
 * it. `mayAct` is not it either — that answers a question about mandatory
 * *debt* the world owes, and it cannot know which action is being taken.
 *
 * So it is a standing effect with a source and a deadline: the ninth sourced
 * grant, hung on the creature, released by `releaseCasting`, by
 * `releaseOnTarget`, by a dispel, by a broken Concentration and by a `grants`
 * timer, through exactly the doors the other eight already use.
 *
 * ### Five members, because the SRD writes five sentences
 *
 * | | SRD | |
 * |---|---|---|
 * | `forbids` | Stinking Cloud: "can't take an action or a Bonus Action" | takes named slots or named actions away |
 * | `permits-only` | Wind Walk: "The only actions a target can take … are the Dash action, the Hide action, and the Search action" | narrows one slot to a named few |
 * | `allows` | Conjure Woodland Beings: "you can take the Disengage action as a Bonus Action" | widens, rather than narrows |
 * | `grants` | Haste: "it gains an additional action on each of its turns" | **creates** one, rather than governing one |
 * | `one-of` | Slow: "it can take either an action or a Bonus Action, not both" | **couples** slots, so the first spent forecloses the rest |
 *
 * The third has the opposite polarity from the first two and is in the same
 * union because it is the same fact — what this creature's action economy
 * permits *now*, as against what the rules permit in general — read from the
 * other end. A second mechanism for it would be a second place for one
 * sentence to be wrong.
 *
 * ### The fourth is a different verb, and says so
 *
 * The three above all answer "may this spend happen?". `grants` answers
 * nothing: it puts a {@link GrantedAction} in a {@link TurnBudget}, which is
 * the same field SRD Action Surge writes and the only place an extra action
 * can live — `fold/combat.ts` folds `action-spent` through
 * `must(event, spendAction(...))` and passes no rules, so an extra action held
 * on the *creature* would be an event the command legally emitted and the
 * reducer called corrupt. It is in this union anyway because it is hung,
 * ended and released exactly as its three neighbours are, and because a
 * second vocabulary for "what a running effect has done to a turn" is a
 * second place for one sentence to be wrong. {@link refuseSpend} never reads
 * it; {@link governs} says so in one line.
 *
 * ### What a compulsion is, and what it is not
 *
 * **A compelled action is a fact about what is legal, never an instruction
 * that executes.** SRD Fear says a Frightened creature "must take the Dash
 * action"; this engine writes that as `permits-only` on the Action slot with
 * `dash` the only member, refuses every other Action, and makes nobody run.
 * The doctrine is the reason and it is not negotiable: the engine adjudicates
 * reality and does not play creatures. A turn on which the table narrates
 * nothing is a turn on which nothing happened, and that is the honest answer
 * — where an engine that took the Dash itself would be writing fiction into
 * the log and calling it a rule.
 *
 * **The sentences that go the other way used to be refused here by name**, and
 * the owner's ruling of 2026-09-22 settled the question they were waiting on:
 * a spell may spend another creature's budget. What that ruling did *not*
 * move is the line above it, and the two are told apart by one word.
 *
 * | | |
 * |---|---|
 * | the engine **charges** a slot | legal: the economy is arithmetic, and a spell that uses up a Reaction has changed a number |
 * | the engine **performs** the action | never: which way the creature ran, and whether it ran at all, is fiction |
 *
 * So Dissonant Whispers' "must immediately use its Reaction … to move as far
 * away from you as it can" is written as the Reaction going, with the book's
 * own phrase pinned into the log beside it for the table to narrate from —
 * `OutcomeRiders.spends` is the vocabulary and `budget-compelled` is the
 * event. Nothing walks anybody anywhere, exactly as nothing takes Fear's
 * compelled Dash.
 *
 * **And it is not in this union**, which is the second half of the answer. A
 * rule here stands on a creature and is asked of every later spend; a spend is
 * a thing that happened once, at a moment, and the only door onto it is a
 * casting's resolver. A caller still cannot reach another creature's budget:
 * every command spends through `spendFor`, on the creature that is acting,
 * gated by whose turn it is — and `budget-compelled` is emitted by no command
 * a caller names. That is the distinction the old refusal was protecting, and
 * it survives the ruling intact.
 *
 * What is still open is what was always the harder half: Compulsion's Bonus
 * Action designating a direction and the three Dominates' telepathic link are
 * a *caller* playing somebody else's creature, which no vocabulary here
 * answers.
 */
export type ActionRule =
  /**
   * SRD Stinking Cloud, Slow, Befuddlement: a slot or a named action taken
   * away, with everything the sentence does not name left alone.
   *
   * Both lists are optional and at least one must be present, which
   * `checkSpellDefinition` enforces: a rule that forbids nothing is a
   * sentence somebody meant to finish.
   */
  | {
      readonly kind: 'forbids';
      readonly slots?: readonly ActionSlot[];
      readonly actions?: readonly NamedAction[];
      /**
       * SRD Gaseous Form: "the target can't attack or **cast spells**."
       *
       * **Not a slot and not one of {@link NAMED_ACTIONS}**, which is why it
       * is a field of its own rather than a member of either list. A casting
       * comes out of an Action, a Bonus Action or a Reaction depending on the
       * spell, and the Magic action is not it: SRD Misty Step is a Bonus
       * Action and nothing about it is a Magic action, so forbidding `magic`
       * would forbid three quarters of the sentence and permit the rest.
       *
       * The same fact one host along from `activated.forbidsCasting` and
       * `shapeShifts.forbidsCasting` — SRD Rage and SRD Wild Shape print it
       * about a feature that is running, and this prints it about an effect
       * that is on you. `castSpell` reads all three in the same three lines,
       * so a fourth sentence of this shape needs no fourth reader.
       *
       * {@link governs} does not read it, for the reason `grants` is not read
       * there: it is not about a *spend* at all. What refuses the casting is
       * the casting command, which is the only place that knows one is being
       * made.
       */
      readonly casting?: true;
      /**
       * SRD Gaseous Form: "The target can't talk or **manipulate objects**, and
       * any objects it was carrying or holding can't be dropped, used, or
       * otherwise interacted with."
       *
       * **Not a slot and not one of {@link NAMED_ACTIONS}**, which is
       * {@link casting}'s reason with a different list on the other side of it:
       * `utilize` is a named action and is *one* of the things this sentence
       * forbids, and the rest — a drop, an equip, a free interaction, a
       * purchase, something picked up off the floor — are spenders that cost
       * nothing, or nothing nameable. A rule forbidding the Utilize alone would
       * have left a cloud free to shed its armour and hand its sword to a
       * friend.
       *
       * So every command that puts a hand on a thing reads it, through
       * {@link refuseObjectHandling}, and refuses `cannot_manipulate_objects`.
       * {@link governs} does not read it, for `casting`'s reason: it is not a
       * fact about a *slot* being spent.
       *
       * **What it does not reach is somebody else's hands.** A forced drop is a
       * thing done *to* the creature — SRD Command's Drop, a disarm — and this
       * sentence is about what the target may do, so `forcedDrop` is left alone
       * deliberately rather than by omission.
       */
      readonly objects?: true;
    }
  /**
   * SRD Wind Walk, Fear, Magic Jar: one slot narrowed to a named few.
   *
   * **It fails closed**, which is what makes it honest about the actions the
   * engine cannot tell apart. A spend out of the governed slot that does not
   * name itself as one of {@link actions} is refused — so Wind Walk's "Dash,
   * Hide, Search" refuses the Attack action and the Magic action, and leaves
   * Hide and Search to a table the engine was never adjudicating anyway. The
   * alternative, letting an unnamed spend through, would silently permit
   * exactly the thing the spell forbade.
   */
  | {
      readonly kind: 'permits-only';
      readonly slot: ActionSlot;
      readonly actions: readonly NamedAction[];
    }
  /**
   * SRD Conjure Woodland Beings: a named action that may be paid for out of a
   * slot it does not normally come out of.
   *
   * The caller asks for the cheaper price and the engine rules on whether
   * they may have it, which is the same direction every other rule here runs
   * in — an allowance nobody invokes changes nothing, exactly as a Dodge
   * nobody takes does.
   *
   * **One action or a bundle of them, and the SRD prints both.** Conjure
   * Woodland Beings moves one action to a cheaper slot; SRD Patient Defense
   * prints "expend 1 Focus Point to take **both** the Disengage and the Dodge
   * actions as a Bonus Action", and Step of the Wind the same shape with Dash
   * and Disengage. A bundle is one allowance rather than two, because it is
   * one price: a Monk who paid for the pair and then took only the Disengage
   * has spent the point, and two separate allowances would have let them take
   * either for the same point twice.
   *
   * Exactly one of {@link action} and {@link actions} is written, which
   * `checkActionRule` enforces — a rule naming both would have two answers to
   * "what does this buy", and one naming neither buys nothing.
   */
  | {
      readonly kind: 'allows';
      readonly action?: NamedAction;
      /**
       * The actions one spend of {@link from} buys **together**, at least two.
       *
       * The first one taken charges the slot and whatever the allowance
       * prices; the rest are handed to the turn as {@link GrantedAction}s and
       * spent for nothing before it ends. A bundle of one is {@link action},
       * which is the same sentence with fewer words.
       */
      readonly actions?: readonly NamedAction[];
      readonly from: ActionSlot;
    }
  /**
   * SRD Haste, SRD Expeditious Retreat: an action added to a turn, rather
   * than one the turn already had being governed.
   *
   * It is the only member that makes a {@link TurnBudget} bigger, and the one
   * that {@link refuseSpend} never consults — see the union's own note for why
   * it is here anyway.
   */
  | {
      readonly kind: 'grants';
      /**
       * Which moment the turn gets it, and the two are different spells.
       *
       * `each-turn` is SRD Haste's "on each of its turns": the rule stands on
       * the creature and the turn boundary mints one every turn the casting
       * sees. `casting` is SRD Expeditious Retreat's "You take the Dash
       * action": once, as the casting resolves, into the turn that is running
       * — and nothing is left standing afterwards, because a turn either
       * spends what it was handed or loses it with the turn.
       *
       * **Required, with no default**, because the wrong one is silent in
       * both directions: a per-turn Expeditious Retreat is a free Dash action
       * every round for ten minutes, and a once-only Haste is a spell that
       * did nothing after the turn it was cast on.
       */
      readonly at: 'casting' | 'each-turn';
      /**
       * The only actions the granted one may be spent on — SRD Expeditious
       * Retreat's Dash.
       *
       * An allowlist rather than {@link GrantedAction.except}'s denylist,
       * because both SRD sentences in *this* position print a list of what is
       * allowed and Action Surge's prints the one thing that is not. It fails
       * closed on a spend that does not name itself, for `permits-only`'s
       * reason: letting an unnamed spend through would silently buy the
       * caster the very action the sentence withheld.
       *
       * Absent is unnarrowed, which is every grant whose sentence names no
       * list. SRD Haste names one — "the Attack (one attack only), Dash,
       * Disengage, Hide, or Utilize action" — and writes all five of them,
       * because {@link NAMED_ACTIONS} holds Utilize and `takeUtilize` is the
       * spender that names itself as one. The parenthesis is not here: how
       * many attacks one Attack action contains is {@link attacksCap}.
       */
      readonly only?: readonly NamedAction[];
      /**
       * The parenthesis: SRD Haste's "the Attack (**one attack only**)".
       *
       * How many swings the Attack action holds **when it is bought with this
       * extra action**, which is a different question from how many the
       * creature's own action holds — a hasted level 5 Fighter takes two swings
       * on their own Attack action and one on Haste's, out of the same Extra
       * Attack. So it travels on the grant rather than standing on the creature,
       * and {@link GrantedAction.attacksCap} is where `extraActionsOwedAtTurnStart`
       * puts it.
       *
       * {@link ActionRule}'s `caps-attacks` member is the same number said about
       * every Attack action a creature takes — SRD Slow — and the two are not one
       * field for that reason.
       *
       * Absent is uncapped, which is Action Surge and every extra action written
       * before this field: the action it buys is an Attack action like any other.
       */
      readonly attacksCap?: number;
    }
  /**
   * SRD Slow, SRD Dretch, SRD Copper Dragon Wyrmling: "it can take either an
   * action or a Bonus Action on its turn, not both." SRD Ice Devil, the same
   * sentence over a different pair: "it can move or take one action on its
   * turn, not both."
   *
   * **Spending any one of these forecloses the rest, for that turn.** It is
   * the one thing the four members above cannot say between them, and not for
   * want of trying: each of them judges a single slot considered alone, so a
   * `forbids` naming both slots refuses the turn entirely and a `forbids`
   * naming one takes away the very choice the book is offering.
   *
   * **What it needed was an input the refusal did not have.** {@link Spend}
   * carries the rules standing on the creature and what the spend is called,
   * and neither answers "has the other one gone yet". The turn's own
   * {@link TurnBudget} answers it, and the four spenders have held it all
   * along — so the question is asked where the budget already is, beside the
   * "have you got one left" every slot is asked anyway, and `refuseSpend`
   * keeps its two inputs.
   *
   * **A list rather than a pair**, because the Ice Devil prints the rule over
   * movement and the action. Movement is the slot nothing spends by name, so
   * it is read off the feet the turn has already been charged — which is why
   * `spendMovement` asks this too, and why "move or take one action" refuses
   * the move after the action and the action after the move.
   *
   * At least two distinct slots, which `checkActionRule` enforces: one slot
   * forecloses nothing but itself, and the same slot twice is a rule that
   * closes the moment it is read.
   */
  | {
      readonly kind: 'one-of';
      /** The slots coupled to each other; spending any one closes the rest. */
      readonly slots: readonly ActionSlot[];
    }
  /**
   * SRD Slow: "it can make **only one attack** if it takes the Attack action."
   *
   * **The count inside an action, where the five members above govern the
   * action itself.** Each of them answers a question about a *spend* — may this
   * slot go, what may it be spent on, what does spending it foreclose — and this
   * answers a question about what the spend then contains. `refuseSpend` never
   * consults it, for the reason it never consults `grants`: it is not a fact
   * about whether the slot may be spent.
   *
   * It is read where the quiver is filled, so it reaches **every** Attack action
   * the creature takes — its own, and any an Action Surge or a Haste buys — which
   * is what "if it takes the Attack action" says. `GrantedAction.attacksCap` is
   * the same number said of one *particular* extra action and is not this: SRD
   * Haste's parenthesis narrows the action it hands over and leaves the turn's
   * own alone.
   *
   * **A cap rather than a count**, so two of them do not add up and neither
   * raises anything: a creature under two such rules takes the smaller, and one
   * with no Extra Attack is not given a second swing by a spell that took one
   * away.
   */
  | {
      readonly kind: 'caps-attacks';
      /** How many swings an Attack action may hold. SRD prints one. */
      readonly attacks: number;
    };

/**
 * One rule a running effect hung on one creature.
 *
 * The ninth sourced grant, and it carries two strings the others do not
 * because of what a refusal has to say. `err('raging', …)` — the engine's one
 * prior sentence of this shape, SRD Rage's "you can't cast spells" — names
 * what forbade the casting and not for how long, and "you cannot do this" with
 * no end in sight is the least useful true thing a rules engine can say.
 *
 * So both are **pinned at the cast**, for the reason every other number on a
 * casting is: the fold opens no catalogue, and a spell already cast does not
 * change when its book does.
 */
export interface GrantedActionRule {
  /** `Binding Word#cast:3` — the casting, which is how it ends. */
  readonly source: string;
  readonly rule: ActionRule;
  /** What the log calls the thing that did it: a spell's name, or an item's. */
  readonly label: string;
  /** How the refusal finishes its sentence: "the spell ends", "your next turn". */
  readonly until: string;
  /** A pool a use of an `allows` rule spends when its price is taken — SRD Adrenaline Rush. */
  readonly spends?: string;
  /** Temporary Hit Points an `allows` rule pays when its price is taken, already a number. */
  readonly temporaryHitPoints?: number;
}

/**
 * What makes two granted rules the same rule, for a store that replaces.
 *
 * **The source alone is not enough, and one spell proves it.** SRD Magic Jar
 * prints two rules in one entry — "you can't move or take Reactions" beside
 * "The only action you can take is to project your soul" — a `forbids` and a
 * `permits-only` from one casting, one source string. Keyed by the source
 * alone, which is the rule seven of the nine grant families follow, the
 * second silently evicted the first: the paragraph lost half of itself
 * between the definition and the state. `rollModifierKey` is the same
 * function written for the same reason two cases above, when Beacon of Hope's
 * one sentence granted two modifiers.
 *
 * So identity is the source **and what the rule is about**: the kind, plus
 * the slot a `permits-only` narrows and the action an `allows` widens. Two
 * narrowings of two different slots are two statements and stand together;
 * the same statement restated by its own source still replaces rather than
 * stacks, which is what the source-keyed store was protecting.
 *
 * A `forbids` needs nothing past its kind, because it is already written as
 * one rule naming several slots and actions — Stinking Cloud's "an action or
 * a Bonus Action" is the plural inside it. `allows` keys on the action rather
 * than on the slot it is paid from: one source offering a cheaper price twice
 * for one action is restating the price, and `allowsPrice` matches the pair
 * anyway.
 *
 * **It decides a re-grant and nothing else.** An ending and a deadline both
 * match on the bare source — see `releaseGrants` — so a casting that ends
 * takes every rule it hung, exactly as it takes Beacon of Hope's two
 * modifiers.
 */
export function actionRuleKey(source: string, rule: ActionRule): string {
  return [
    source,
    rule.kind,
    rule.kind === 'permits-only' ? rule.slot : '',
    // The whole bundle, in the order it was written: SRD Patient Defense's
    // pair and SRD Step of the Wind's are two statements of one feature that
    // happen to share an action, and a key that read only the first would have
    // let the second evict it.
    rule.kind === 'allows' ? allowedActions(rule).join(',') : '',
    // And the coupled slots, for the same reason the narrowed one is here:
    // "an action or a Bonus Action, not both" and "move or take one action,
    // not both" are two statements, and one source may print both — SRD Ice
    // Devil's spear says the second while its Cold damage says nothing.
    rule.kind === 'one-of' ? rule.slots.join(',') : '',
  ].join('|');
}

/**
 * What one `allows` rule buys, however its sentence was written.
 *
 * One reader, so every site that asks "does this allowance reach the Dodge"
 * asks it the same way and a bundle is never half-read. See
 * {@link ActionRule}'s `allows` member for why the two spellings exist.
 */
export const allowedActions = (rule: Extract<ActionRule, { kind: 'allows' }>): readonly NamedAction[] =>
  rule.action === undefined ? (rule.actions ?? []) : [rule.action];

/**
 * Whether a rule reaches this spend at all.
 *
 * `grants` answers no, always, and that is the member rather than an omission:
 * it *creates* an action instead of judging one, so a spend that met it here
 * would be refused by the very sentence that handed it over.
 *
 * `one-of` answers no too, and for a different reason: it is not a fact about
 * the spend at all. Whether it bites depends on what the turn has *already*
 * spent, which is the budget's answer rather than the rule's — see
 * {@link refuseForeclosed}, which is where it is asked.
 */
const governs = (rule: ActionRule, slot: ActionSlot, as: NamedAction | undefined): boolean =>
  rule.kind === 'forbids'
    ? (rule.slots?.includes(slot) ?? false) || (as !== undefined && (rule.actions?.includes(as) ?? false))
    : rule.kind === 'permits-only'
      ? rule.slot === slot && !(as !== undefined && rule.actions.includes(as))
      : false;

/**
 * The extra actions a running effect owes this creature at the start of a turn.
 *
 * SRD Haste's "on each of its turns", read off the rules standing on the
 * creature. **Only `each-turn`**: a grant the casting handed over once is in
 * the budget already and is not owed again.
 *
 * Exported because the boundary that raises a turn's beginning is a command's
 * — the budget is written by a combat event and nothing else — and because
 * two boundaries raise one, `resolveTurn` and the opening of a fight.
 */
export function extraActionsOwedAtTurnStart(
  rules: readonly GrantedActionRule[],
): readonly GrantedAction[] {
  const owed: GrantedAction[] = [];
  for (const held of rules) {
    if (held.rule.kind !== 'grants' || held.rule.at !== 'each-turn') continue;
    owed.push({
      source: held.label,
      ...(held.rule.only === undefined ? {} : { only: held.rule.only }),
      // SRD Haste's parenthesis, travelling with the action it narrows.
      ...(held.rule.attacksCap === undefined ? {} : { attacksCap: held.rule.attacksCap }),
    });
  }
  return owed;
}

/**
 * What one spend is: the slot it comes out of, and what the book calls it.
 *
 * **The whole record, not the rules alone**, because a refusal has to name the
 * source and the deadline and a bare `ActionRule` carries neither.
 */
export interface Spend {
  /** Every rule standing on this creature: `CreatureState.actionRules`. */
  readonly rules: readonly GrantedActionRule[];
  /** Which of {@link NAMED_ACTIONS} this is, where the spender can tell. */
  readonly as?: NamedAction;
}

/** How a slot reads in a refusal. */
const SLOT_NAMES: Readonly<Record<ActionSlot, string>> = {
  action: 'an action',
  'bonus-action': 'a Bonus Action',
  reaction: 'a Reaction',
  movement: 'movement',
};

/**
 * How a named action reads in a refusal: the book's own capitalisation.
 *
 * A refusal is read by a person, and "the only action it permits is dash" is
 * the engine's spelling rather than the SRD's. One table, so the sentence and
 * the vocabulary cannot come apart.
 */
/**
 * What a refusal calls each named action, so every door says it the same way.
 *
 * Exported for the one caller outside this module: `refuseGrantMismatch` in
 * `commands/actions.ts` names the action an extra was **not** granted for, and
 * a second spelling of "the Dodge action" is a second place for it to drift.
 */
export const ACTION_TITLES: Readonly<Record<NamedAction, string>> = {
  attack: 'Attack',
  dash: 'Dash',
  disengage: 'Disengage',
  dodge: 'Dodge',
  help: 'Help',
  hide: 'Hide',
  influence: 'Influence',
  magic: 'Magic',
  'opportunity-attack': 'Opportunity Attack',
  search: 'Search',
  study: 'Study',
  utilize: 'Utilize',
};

/** "Dash", "Dash or Dodge", "Dash, Dodge or Attack" — and "nothing" for none. */
const listed = (actions: readonly NamedAction[]): string => {
  const titles = actions.map((a) => ACTION_TITLES[a]);
  if (titles.length === 0) return 'nothing at all';
  if (titles.length === 1) return titles[0]!;
  return `${titles.slice(0, -1).join(', ')} or ${titles[titles.length - 1]!}`;
};

/**
 * The one refusal, so every spender says it the same way.
 *
 * **Rules-legal, therefore a value.** A creature attempting something a spell
 * forbade has not made a programmer error and has not merely failed to supply
 * a fact, so this is neither an exception nor a `needs-context`: it is `err`,
 * with a sentence naming what forbade the action and until when.
 *
 * The first rule that bites wins, and rules are visited in the order the fold
 * keeps them — sorted by {@link actionRuleKey}, which begins with the source
 * — so the answer is fixed however they arrived.
 */
function refuseSpend(
  id: CharacterId,
  slot: ActionSlot,
  spend: Spend | undefined,
): Result<true> {
  for (const held of spend?.rules ?? []) {
    if (!governs(held.rule, slot, spend?.as)) continue;
    if (held.rule.kind === 'permits-only') {
      return err(
        'action_forbidden',
        `${id} cannot take ${SLOT_NAMES[slot]}: ${held.label} permits only ${listed(held.rule.actions)} until ${held.until}`,
      );
    }
    return err(
      'action_forbidden',
      `${id} cannot take ${SLOT_NAMES[slot]}: ${held.label} forbids it until ${held.until}`,
    );
  }
  return ok(true);
}

/**
 * How many swings this Attack action holds, after everything that caps it.
 *
 * Two sentences, and they are about different things. SRD Slow's "it can make
 * only one attack if it takes the Attack action" stands on the *creature* and
 * reaches every Attack action it takes; SRD Haste's "the Attack (one attack
 * only)" narrows the one action the spell hands over and leaves the turn's own
 * alone. So the rules are read off the creature and the cap off whichever extra
 * action is about to pay, and the answer is the smallest of the three.
 *
 * **A cap and never a count**, which is why this is `Math.min` rather than an
 * assignment: two such rules do not add up, neither of them raises anything, and
 * a creature with no Extra Attack is not handed a second swing by a spell that
 * took one away.
 */
const cappedAttacks = (
  attacksPerAction: number,
  rules: readonly GrantedActionRule[],
  paying: GrantedAction | undefined,
): number => {
  let most = attacksPerAction;
  for (const held of rules) {
    if (held.rule.kind === 'caps-attacks') most = Math.min(most, held.rule.attacks);
  }
  if (paying?.attacksCap !== undefined) most = Math.min(most, paying.attacksCap);
  return Math.max(0, most);
};

/**
 * The refusal every command that puts a hand on a thing shares.
 *
 * SRD Gaseous Form: "The target can't talk or manipulate objects, and any
 * objects it was carrying or holding can't be dropped, used, or otherwise
 * interacted with." One sentence over six spenders — a free interaction, a
 * Utilize, a drop, an equip, an unequip, a purchase and whatever is lying on the
 * floor — so it is one reader rather than six spellings, for
 * {@link refuseSpend}'s reason.
 *
 * **It is not {@link refuseSpend}**, because nothing here is a slot. Half of
 * these spend nothing at all, and `governs` therefore has nothing to answer
 * about them: the question is not "may this creature take an action" but "may
 * this creature touch anything", which is a different sentence that happens to
 * be written on the same rule.
 *
 * The first rule that bites wins, and the refusal names it and says until when —
 * the discipline every refusal in this file keeps.
 */
export function refuseObjectHandling(
  id: CharacterId,
  rules: readonly GrantedActionRule[],
): Result<true> {
  for (const held of rules) {
    if (held.rule.kind === 'forbids' && held.rule.objects === true) {
      return err(
        'cannot_manipulate_objects',
        `${id} cannot handle anything: ${held.label} until ${held.until}`,
      );
    }
  }
  return ok(true);
}

/** "an action or a Bonus Action", "movement, an action or a Reaction". */
const listedSlots = (slots: readonly ActionSlot[]): string => {
  const names = slots.map((slot) => SLOT_NAMES[slot]);
  if (names.length === 0) return 'nothing at all';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]!}`;
};

/**
 * Whether this turn has already spent a slot, however it was spent.
 *
 * Three of the four are a flag the budget keeps; **movement is the one nothing
 * spends by name**, so it is read off the feet the turn has been charged.
 * `movementSpent` and not `movementSegments`: a move with no scene records no
 * segment and is still a move.
 *
 * **Feet a feature handed over are asked and do not answer, and that is
 * deliberate rather than a gap being left.** {@link spendMovement} asks this
 * question before it reaches the `grantedMoves` branch, so a Tactical Shift
 * *after* the action is refused under a rule coupling the two — a move is a
 * move, and the sentence says "move". The other direction cannot be read:
 * `GrantedMove.feet` holds what is **left** of a grant rather than what has
 * gone, so a turn that has spent five of fifteen granted feet is
 * indistinguishable from one handed ten, and a counter that pretended
 * otherwise would be inventing a fact. No printed sentence reaches the
 * asymmetry — SRD Ice Devil is the only line that couples movement at all, it
 * is CR 14, and nothing that hands feet over has ever stood beside it — so
 * this is written down rather than arranged for, exactly as
 * `TurnBudget.movementGained`'s open reading is.
 *
 * The Reaction is the odd member and says so: a budget refreshes at the start
 * of the holder's *own* turn, so "has this creature taken a Reaction" is
 * answered about the Reaction's own life rather than about the turn that is
 * running. That is the Reaction's lifetime everywhere else in this file, and
 * no printed sentence couples it to anything — the SRD lines that take the
 * Reaction away take it away outright, which is `forbids`.
 */
const slotSpent = (budget: TurnBudget, slot: ActionSlot): boolean =>
  slot === 'action'
    ? !budget.action
    : slot === 'bonus-action'
      ? !budget.bonusAction
      : slot === 'reaction'
        ? !budget.reaction
        : budget.movementSpent > 0;

/**
 * The refusal the coupled slots make — see {@link ActionRule}'s `one-of`.
 *
 * **Separate from {@link refuseSpend} because it asks a different question.**
 * That one is handed the spend and the rules standing on the creature and
 * answers "may this happen at all"; this one is about what the turn has
 * *already* done, which only the budget knows. Widening the other's signature
 * would have put an input in front of four members that never read it.
 *
 * The first rule that bites wins, in the order the fold keeps them, exactly as
 * the neighbouring refusal does.
 */
function refuseForeclosed(
  id: CharacterId,
  slot: ActionSlot,
  budget: TurnBudget,
  spend: Spend | undefined,
): Result<true> {
  for (const held of spend?.rules ?? []) {
    if (held.rule.kind !== 'one-of' || !held.rule.slots.includes(slot)) continue;
    const gone = held.rule.slots.find((other) => other !== slot && slotSpent(budget, other));
    if (gone === undefined) continue;
    return err(
      'slot_foreclosed',
      `${id} cannot take ${SLOT_NAMES[slot]}: ${held.label} permits only one of ${listedSlots(held.rule.slots)} on a turn until ${held.until}, and ${id} has already spent ${SLOT_NAMES[gone]}`,
    );
  }
  return ok(true);
}

/**
 * Whether a named action may be paid for out of a slot it does not cost.
 *
 * The `allows` half, asked by the command rather than by the primitive,
 * because it is the *command* that knows a Disengage normally costs an Action
 * and is being asked for a Bonus Action instead. A refusal here is the same
 * kind of value as {@link refuseSpend}'s and reads the same way.
 */
export function allowsPrice(
  id: CharacterId,
  action: NamedAction,
  from: ActionSlot,
  rules: readonly GrantedActionRule[],
  /**
   * What the caller said about **which** allowance to take, where they said
   * anything.
   *
   * Two creatures' worth of sentences make this necessary and neither is
   * exotic. An Orc Rogue 2 holds `orc:adrenaline-rush` and
   * `rogue:cunning-action`, both of which offer a Dash as a Bonus Action and
   * only one of which charges for it; and a Monk's Focus offers the Disengage
   * free *and* in a priced pair with the Dodge. Left unsaid, the answer is the
   * cheapest allowance that reaches the action — the Rogue Dashes for nothing
   * and keeps the Orc's uses — which is the only default that can never take
   * something away the book gave for free.
   */
  choice: {
    /** The feature or casting whose allowance to take, by its source. */
    readonly usingFeature?: string;
    /** The other actions this one spend is buying — SRD Patient Defense's pair. */
    readonly alsoTaking?: readonly NamedAction[];
  } = {},
): Result<GrantedActionRule> {
  // The rule itself rather than a bare yes, because an allowance may carry a
  // price of its own — a use, Temporary Hit Points — that the command taking
  // the cheaper slot has to charge.
  const matching = rules.filter(
    (held) =>
      held.rule.kind === 'allows' &&
      held.rule.from === from &&
      allowedActions(held.rule).includes(action) &&
      (choice.alsoTaking ?? []).every((also) =>
        allowedActions(held.rule as Extract<ActionRule, { kind: 'allows' }>).includes(also),
      ),
  );

  // **The feature the caller named, and a refusal where they do not hold it.**
  // An Orc who wants the Temporary Hit Points says so; anything else is a
  // caller asking for a benefit this creature has not got, which is a
  // rules-legal refusal rather than a quiet substitution.
  if (choice.usingFeature !== undefined) {
    const named = matching.find((held) => held.source === choice.usingFeature);
    if (named !== undefined) return ok(named);
    return err(
      'no_such_allowance',
      `${choice.usingFeature} does not let ${id} take the ${ACTION_TITLES[action]} action as ${SLOT_NAMES[from]}`,
    );
  }

  if (matching.length > 0) {
    // **The free one first.** A priced allowance and an unpriced one for the
    // same pair is a real state — SRD Cunning Action beside SRD Adrenaline
    // Rush — and charging the price nobody asked for meant a Rogue whose Orc
    // uses were spent was refused an action the book gives them for nothing.
    const free = matching.find(
      (held) => held.spends === undefined && held.temporaryHitPoints === undefined,
    );
    return ok(free ?? matching[0]!);
  }

  return err(
    'action_not_allowed',
    (choice.alsoTaking ?? []).length === 0
      ? `nothing lets ${id} take the ${ACTION_TITLES[action]} action as ${SLOT_NAMES[from]}`
      : `nothing lets ${id} take the ${listed([action, ...(choice.alsoTaking ?? [])])} action${(choice.alsoTaking ?? []).length === 0 ? '' : 's'} together as ${SLOT_NAMES[from]}`,
  );
}

export interface Combatant {
  readonly id: CharacterId;
  /** The Initiative check total. */
  readonly initiative: number;
  /** Walking speed in feet, before conditions. */
  readonly speed: number;
  /**
   * Breaks ties, highest first. SRD leaves ties to the GM, so the engine takes
   * that decision as an input rather than inventing one.
   */
  readonly tiebreak: number;
  /**
   * The combatant this one takes its turn immediately after, where a rule
   * seats it by position rather than by number.
   *
   * SRD Find Steed: "the steed takes its turn immediately after yours". A
   * count and a tiebreak cannot say it — a third creature the DM put on that
   * exact count comes between the two — so the rung is the anchor's, copied,
   * and the position is kept by `addCombatant`: a follower is seated straight
   * after its anchor and after every follower already there, and any later
   * joiner that ties the anchor exactly lands after the followers, because it
   * ties them exactly too. Absent for every combatant seated by a number.
   */
  readonly after?: CharacterId;
}

export interface CombatantInput {
  readonly id: CharacterId;
  readonly initiative: number;
  readonly speed: number;
  readonly tiebreak?: number;
  /** Seat this combatant immediately after that one — see {@link Combatant.after}. */
  readonly after?: CharacterId;
}

/**
 * One action a feature or a spell added to this turn, beyond the turn's own.
 *
 * **It is here rather than on the creature, and that is the whole reason this
 * shape exists.** A rule standing on a creature — an `actionRules` entry, a
 * standing grant — is invisible to `fold/combat.ts`, which folds
 * `action-spent` through `must(event, spendAction(...))` and passes neither
 * the conditions nor the rules; an extra action carried anywhere else is an
 * event the command legally emitted and the reducer calls corrupt. Only a
 * combat event writes a budget, so only a combat event can add to one.
 *
 * {@link except} is SRD Action Surge's second clause — "you can take one
 * additional action, **except the Magic action**" — and it is a list of
 * {@link NAMED_ACTIONS} for the reason {@link ActionRule} is: a slot says how
 * much a thing costs and a name says what it is. It bites only where the
 * spender named itself, which is the same honesty `forbids` already has.
 *
 * The source is what the log calls whatever bought it, so a refusal can say
 * which extra action would not pay for the action asked for.
 */
export interface GrantedAction {
  readonly source: string;
  readonly except?: readonly NamedAction[];
  /**
   * The other polarity, and the one a spell writes: the only actions this
   * extra may be spent on — SRD Expeditious Retreat's Dash.
   *
   * It **fails closed**, where `except` fails open, and each matches the
   * sentence that prints it: Action Surge names the one thing that is not
   * allowed and leaves a turn otherwise whole, while Expeditious Retreat names
   * the one thing that is. A spend that does not name itself therefore passes
   * an `except` and is refused by an `only`, for `ActionRule`'s
   * `permits-only` reason — waving an unnamed spend through would buy the
   * caster the action the sentence withheld.
   *
   * The two are never written together by anything in this repository and
   * nothing forbids it: an extra that said both would simply have to satisfy
   * both, which is what a reader would expect of a sentence printing both.
   */
  readonly only?: readonly NamedAction[];
  /**
   * How many swings the Attack action holds when **this** extra pays for it.
   *
   * SRD Haste: "That action can be used to take only the Attack (**one attack
   * only**), Dash, Disengage, Hide, or Utilize action." Read by
   * {@link spendAttack} where the quiver is filled, off whichever extra is about
   * to pay — so a hasted Fighter swings twice on their own Attack action and once
   * on Haste's, which is what the parenthesis says and what neither a rule on the
   * creature nor a number on the sheet could have said.
   *
   * Absent is uncapped: Action Surge's extra action is an Attack action like any
   * other, and so is every extra written before this field.
   */
  readonly attacksCap?: number;
}

/**
 * Feet one feature handed this turn, and what is left of them.
 *
 * The source is what the log calls whatever handed them over — a feature's
 * own `feature:` source — so a refusal can say which grant had nothing left in
 * it, and a mover can say which one they are spending.
 */
export interface GrantedMove {
  readonly source: string;
  readonly feet: number;
}

/**
 * Attacks bought outside an Attack action, and what they may be spent on.
 *
 * SRD Flurry of Blows: "You can expend 1 Focus Point to make two Unarmed
 * Strikes as a Bonus Action." {@link TurnBudget.attacksRemaining} cannot hold
 * them: that counter *is* the Attack action — null means the action has not
 * been taken — so putting two Bonus Action strikes in it would spend the
 * Fighter's action and refuse the Monk's later one.
 *
 * `unarmedOnly` is the SRD's own narrowing and the only one printed, so it is
 * a flag rather than a set of weapons: a swing that does not qualify falls
 * through to the ordinary price instead of being refused, which is how a Monk
 * may flurry and then take the Attack action with a Quarterstaff.
 */
export interface GrantedAttacks {
  readonly remaining: number;
  readonly unarmedOnly: boolean;
  /**
   * What bought them, as the key the purchase is already counted under.
   *
   * SRD Open Hand Technique: "Whenever you hit a creature with **an attack
   * granted by your Flurry of Blows**". The sentence is about where the swing
   * came from, and a swing knew what it *cost* and not what had sold it — so
   * nothing could tell a Flurry's punch from the Attack action's. It is
   * `budgetPurchaseSlot`'s key, `<feature>/<purchase>`, because that is the
   * one string already minted per purchase and already pinned in the event.
   *
   * Absent for a log written before the field, and for anything that hands a
   * turn attacks without selling them.
   */
  readonly from?: string;
  /**
   * The one printed line the attacks may be, and the one creature they may be
   * at — SRD Allosaurus's Claws: "the allosaurus can make one Bite attack
   * against it." — W7-B10.
   *
   * Two narrowings beside {@link unarmedOnly}, and read the same way: a swing
   * that does not match falls through to the ordinary price rather than being
   * refused, so a Bite at somebody else still costs what a Bite costs. Absent
   * is every grant written before the fields, and every grant that narrows
   * nothing.
   */
  readonly line?: string;
  readonly against?: CharacterId;
}

/**
 * One move a creature made on its own turn, as the two ends of it.
 *
 * The feet are carried beside the points rather than derived from them,
 * because they are **what the turn was charged**: a move across Difficult
 * Terrain costs more feet than it covers, and the sentence a charge gate reads
 * — "moved 20+ feet straight toward it" — is about distance covered. Both
 * numbers are true of the same move and they are not the same number, so the
 * one that is stored is the one nothing else can recover, and the gate
 * measures the points.
 *
 * A segment is only ever the creature's own movement. Forced movement writes
 * no `movement-spent` at all, which is what keeps a shove from buying somebody
 * else's charge.
 */
export interface MoveSegment {
  readonly from: Point;
  readonly to: Point;
  /** What the turn was charged for it, which is not always what it covered. */
  readonly feet: number;
}

export interface TurnBudget {
  readonly action: boolean;
  readonly bonusAction: boolean;
  readonly reaction: boolean;
  /**
   * Actions added to this turn beyond the one it holds — SRD Action Surge.
   *
   * A list rather than a count, because each carries the narrowing its own
   * sentence prints and two of them need not narrow alike. Spent **after** the
   * turn's own action and never before it: the book adds to a turn rather than
   * replacing what it had, so a Magic action takes the ordinary one while
   * there is one to take, and meets Action Surge's exception only when there
   * is not.
   */
  readonly extraActions: readonly GrantedAction[];
  /** Attacks bought outside an Attack action, or null if none were. */
  readonly grantedAttacks: GrantedAttacks | null;
  /**
   * Feet of movement already spent this turn.
   *
   * **Store what happened, derive what is left.** This was
   * `movementRemaining` — a *derived* quantity frozen at the moment it was
   * seeded — and that is sound only while every later change to the allowance
   * moves in the direction a cap can express: downwards. A feature grant
   * raises it, and nothing but the seed can raise a remainder, so a Monk whose
   * Speed is 40 was refused at 30 by whichever reader still held the seed.
   *
   * A working live cap is not evidence that a live allowance exists. The test
   * is whether the stored number can represent an allowance **larger than its
   * seed**, and a remainder cannot.
   */
  readonly movementSpent: number;
  /**
   * The moves this turn was made of, in the order they were taken.
   *
   * **The shape of the movement, beside the amount of it.** SRD Boar: "if the
   * boar moved 20+ feet straight toward it immediately before the hit."
   * {@link movementSpent} cannot answer that and never could — twenty feet
   * spent walking in a circle is not a charge, and two ten-foot steps in one
   * line are — so the segments the turn was actually made of are kept, and the
   * swing reads the run back from itself while the bearing holds.
   *
   * **A list rather than one "last move", and the book is why.** The charge
   * lines say "moved 20+ feet straight toward it", which a creature may do in
   * as many steps as it likes: a mover that stepped ten feet and then ten more
   * along the same bearing has charged, and a reader holding only the last
   * step would see ten.
   *
   * Cleared with the rest of the budget at the turn boundary, because the
   * sentence is about the move that preceded *this* swing. A move that
   * recorded no points — a mover with no scene — leaves nothing here, and the
   * gate is simply not met: **no record is no charge**.
   */
  readonly movementSegments: readonly MoveSegment[];
  /**
   * Feet of extra movement banked this turn, which today is only a Dash.
   *
   * SRD Dash: "you gain extra movement for the current turn. The increase
   * equals your Speed after applying any modifiers." It is banked rather than
   * folded into the allowance because it was earned at a moment: the Speed it
   * was measured against was the Speed *then*.
   *
   * **A Dash's gained movement survives a later Speed of 0 this turn**, and
   * that is an open reading rather than a decision. SRD Grappled says "Your
   * Speed is 0 and can't increase", which is about the Speed and says nothing
   * about extra movement already banked. Today's arithmetic allowed it before
   * this field existed and this formula preserves the reading exactly; the
   * engine has not decided it, and this sentence is where that is written
   * down rather than discovered.
   */
  readonly movementGained: number;
  /**
   * Feet a feature **handed** this turn, and what handed them over.
   *
   * SRD Tactical Shift: "Whenever you activate your Second Wind with a Bonus
   * Action, you can move up to half your Speed without provoking Opportunity
   * Attacks."
   *
   * **A third counter, and neither of its two neighbours could be it.**
   * {@link movementGained} is a Dash: feet *added to the allowance*, spent out
   * of {@link movementSpent} like any other and provoking exactly as walking
   * does. `MoveCommand.forced` is the other half of what this needs — no Speed
   * and no Opportunity Attacks — and it is movement somebody else is doing to
   * you, so it also legalises ending in an occupied space, which SRD forbids
   * only *willingly* and a Tactical Shift is entirely willing.
   *
   * So what is handed over is its own thing: feet spent out of nothing, that
   * provoke nobody and are still the creature's own move.
   *
   * **A list with a source, for {@link extraActions}' reason.** Each is a
   * sentence somebody printed, the refusal has to be able to name what would
   * have paid for a move, and a mover states which grant they are spending —
   * because two features handing over feet on one turn is a thing the
   * vocabulary should not have to have an opinion about.
   *
   * Empty on a fresh budget: the sentence is about the turn the feature was
   * used on and nothing carries a foot of it into the next.
   */
  readonly grantedMoves: readonly GrantedMove[];
  /**
   * Attacks left in the Attack action, or null if it has not been taken.
   *
   * SRD Extra Attack: "You can attack twice instead of once whenever you take
   * the Attack action." The action is taken once and holds however many
   * attacks a feature puts in it, so counting actions alone gave a level 5
   * Fighter one swing a turn.
   *
   * Null rather than zero, because "has not attacked yet" and "has used up the
   * attacks" are different states and only the first may take the action.
   */
  readonly attacksRemaining: number | null;
  /**
   * SRD Disengage: "your movement doesn't provoke Opportunity Attacks for the
   * rest of the current turn." The turn is the whole of its life, which is why
   * it lives in the budget and not on the creature.
   */
  readonly disengaged: boolean;
  /** SRD: one free object interaction per turn; a second needs Utilize. */
  readonly freeInteraction: boolean;
  /**
   * The Light weapon this turn's Attack action has swung, or null.
   *
   * SRD Light: "When you take the Attack action on your turn and attack with a
   * **Light** weapon, you can make one extra attack as a Bonus Action later on
   * the same turn. That extra attack must be made with a **different** Light
   * weapon."
   *
   * **A per-turn record and not a hand**, which is the whole of why this field
   * closes a gap two notes had filed as "nothing records which hand an attack
   * came from". The SRD has no off-hand: what the sentence asks is which Light
   * weapon this turn's Attack action already used, and the only place a fact
   * about a turn can live is the turn's own budget. A hand model would have
   * been a second answer to a question the book never asks.
   *
   * **Written only by a swing of the Attack action**, which is the clause's
   * own condition — attacks something else bought (SRD Flurry of Blows) are
   * not the Attack action and do not open the allowance. The *first* such
   * swing wins, because that is the weapon the sentence is about and a later
   * swing with a second Light weapon is already the extra attack's business.
   *
   * Null on a fresh budget, so the allowance dies with the turn that earned
   * it: "later on the same turn" and nothing after it.
   */
  readonly lightWeaponSwung: string | null;
  /**
   * Which turn this creature last expended a spell slot on, or null.
   *
   * SRD: "On a turn, you can expend only one spell slot to cast a spell." Note
   * *a* turn, not *your* turn — a Reaction spell cast on someone else's turn
   * is a different turn from the one you cast Fireball on. So this records the
   * turn rather than a flag that the budget refresh would clear at the wrong
   * moment.
   */
  readonly spellSlotSpentOnTurn: number | null;
  /**
   * Which turn each once-per-turn feature was last used on.
   *
   * SRD writes "Once per turn" and "Once on each of your turns" on Sneak
   * Attack, Colossus Slayer, Divine Strike and Primal Strike, and it is
   * **not** once per round. The distinction is only visible on somebody
   * else's turn: a Rogue who Sneak Attacked on their own turn may Sneak
   * Attack again on the Opportunity Attack they take during the Fighter's,
   * because that is a different turn.
   *
   * So this records the turn rather than a flag, for exactly the reason
   * `spellSlotSpentOnTurn` above it does — a flag would be cleared by the
   * budget refresh at the start of the holder's *own* turn, which is the one
   * moment that does not matter, and would go on blocking every Reaction in
   * between.
   */
  readonly featureUsedOnTurn: Readonly<Record<string, number>>;
}

/**
 * How many turns a combatant has begun and ended.
 *
 * Both, because "until the start of your next turn" and "until the end of your
 * next turn" are a full round apart and nothing derives one from the other.
 * Counted per combatant rather than globally: "your next turn" is a question
 * about one creature's place in the order, not about the round.
 */
export interface TurnCount {
  readonly begun: number;
  readonly ended: number;
}

export interface CombatState {
  /** 1-based. */
  readonly round: number;
  readonly order: readonly Combatant[];
  readonly turnIndex: number;
  readonly budgets: Readonly<Record<string, TurnBudget>>;
  /**
   * Turns taken since the fight began, counting up and never reused.
   *
   * Derived from round and turn index it would not be: combatants leave, the
   * order shrinks, and two different turns could then share a number. A rule
   * that asks "was that on this turn?" needs an answer that cannot collide.
   */
  readonly turnsTaken: number;
  /** Turns begun and ended, per combatant, for turn-anchored durations. */
  readonly turnCounts: Readonly<Record<string, TurnCount>>;
}

/**
 * A fresh turn, which **takes no Speed**.
 *
 * It used to seed `movementRemaining` from the pinned Speed, and that seed was
 * the ceiling no grant could pass. Nothing is seeded now: the allowance is
 * `speedOf + gained − spent`, derived by the command and by the fold alike.
 */
const fullBudget = (): TurnBudget => ({
  action: true,
  bonusAction: true,
  reaction: true,
  extraActions: [],
  grantedAttacks: null,
  movementSpent: 0,
  movementSegments: [],
  movementGained: 0,
  grantedMoves: [],
  attacksRemaining: null,
  disengaged: false,
  freeInteraction: true,
  lightWeaponSwung: null,
  spellSlotSpentOnTurn: null,
  featureUsedOnTurn: {},
});

/**
 * Where two combatants stand relative to one another: negative if the first
 * acts earlier, positive if later, zero if the two are exactly level.
 *
 * **One ranking, two callers.** `startCombat` sorts a whole order by it and
 * {@link addCombatant} finds one creature's place in an order already sorted
 * by it. A second comparator written out beside the first is how a creature
 * joining a fight could come to sit somewhere other than where it would have
 * sat had the fight begun with it — a disagreement no assertion about a single
 * insertion would ever show, because both readings agree everywhere except on
 * a tie.
 *
 * It answers zero for a tie rather than falling through to a third key,
 * because the two callers break a tie differently *by construction* and not by
 * choice: `startCombat` has an index for every combatant and a joiner has
 * none. See each of them for what it does with the zero.
 */
const byInitiative = (
  a: { readonly initiative: number; readonly tiebreak: number },
  b: { readonly initiative: number; readonly tiebreak: number },
): number => b.initiative - a.initiative || b.tiebreak - a.tiebreak;

/**
 * SRD: "The GM ranks the combatants, from highest to lowest Initiative." Ties
 * fall to the supplied tiebreak, then to insertion order so the result is
 * stable and replayable.
 */
export function startCombat(combatants: readonly CombatantInput[]): Result<CombatState> {
  if (combatants.length === 0) {
    return err('empty_combat', 'combat needs at least one combatant');
  }

  const seen = new Set<string>();
  for (const c of combatants) {
    if (seen.has(c.id)) return err('duplicate_combatant', `${c.id} is in the combat twice`);
    seen.add(c.id);
  }

  const order = combatants
    .map((c, index) => ({
      id: c.id,
      initiative: c.initiative,
      speed: c.speed,
      tiebreak: c.tiebreak ?? 0,
      index,
    }))
    .sort((a, b) => byInitiative(a, b) || a.index - b.index)
    .map(({ id, initiative, speed, tiebreak }) => ({ id, initiative, speed, tiebreak }));

  const budgets: Record<string, TurnBudget> = {};
  const turnCounts: Record<string, TurnCount> = {};
  for (const c of order) {
    budgets[c.id] = fullBudget();
    turnCounts[c.id] = { begun: 0, ended: 0 };
  }
  // The first combatant's turn starts with the fight.
  const first = order[0];
  if (first !== undefined) turnCounts[first.id] = { begun: 1, ended: 0 };

  return ok({ round: 1, order, turnIndex: 0, budgets, turnsTaken: 0, turnCounts });
}

export function currentCombatant(state: CombatState): Combatant {
  const combatant = state.order[state.turnIndex];
  if (combatant === undefined) {
    throw new Error(`combat has no combatant at turn index ${state.turnIndex}`);
  }
  return combatant;
}

export function budgetFor(state: CombatState, id: CharacterId): TurnBudget | null {
  return state.budgets[id] ?? null;
}

const bumped = (
  counts: Readonly<Record<string, TurnCount>>,
  id: CharacterId,
  field: 'begun' | 'ended',
): Record<string, TurnCount> => {
  const current = counts[id] ?? { begun: 0, ended: 0 };
  return { ...counts, [id]: { ...current, [field]: current[field] + 1 } };
};

/** Refresh the budget of whoever is about to act, and count their turn begun. */
function beginTurn(state: CombatState): CombatState {
  const combatant = currentCombatant(state);
  return {
    ...state,
    budgets: { ...state.budgets, [combatant.id]: fullBudget() },
    turnCounts: bumped(state.turnCounts, combatant.id, 'begun'),
  };
}

/**
 * SRD: "When everyone involved in the combat has had a turn, the round ends."
 * The Initiative order itself does not change between rounds.
 */
export function advanceTurn(state: CombatState): CombatState {
  const next = state.turnIndex + 1;
  const wrapped = next >= state.order.length;

  // Whoever was acting has finished. Counted before the move, because "the end
  // of your next turn" is a moment in its own right, a full round after "the
  // start of your next turn".
  const ended = bumped(state.turnCounts, currentCombatant(state).id, 'ended');

  return beginTurn({
    ...state,
    turnCounts: ended,
    turnIndex: wrapped ? 0 : next,
    round: wrapped ? state.round + 1 : state.round,
    turnsTaken: state.turnsTaken + 1,
  });
}

function requireCombatant(state: CombatState, id: CharacterId): Result<TurnBudget> {
  const budget = state.budgets[id];
  if (budget === undefined) return needsContext('unknown_combatant', `${id} is not in this combat`);
  return ok(budget);
}

function requireTheirTurn(state: CombatState, id: CharacterId): Result<TurnBudget> {
  const budget = requireCombatant(state, id);
  if (!budget.ok) return budget;
  if (currentCombatant(state).id !== id) {
    return err('not_their_turn', `it is not ${id}'s turn`);
  }
  return budget;
}

/** SRD Incapacitated: "You can't take any action, Bonus Action, or Reaction." */
function requireCapable(id: CharacterId, conditions: ConditionState | undefined): Result<true> {
  if (conditions !== undefined && isIncapacitated(conditions)) {
    return err('incapacitated', `${id} is Incapacitated and can't act`);
  }
  return ok(true);
}

const withBudget = (
  state: CombatState,
  id: CharacterId,
  patch: Partial<TurnBudget>,
  budget: TurnBudget,
): CombatState => ({
  ...state,
  budgets: { ...state.budgets, [id]: { ...budget, ...patch } },
});

/**
 * **`spend` is where a spell reaches the action economy**, on this primitive
 * and the three below it.
 *
 * It is a parameter rather than a field on the combat state for the reason
 * `conditions` and `spendMovement`'s `allowance` are: this module sits beneath
 * `GameState` and a rule standing on a creature is not a fact about the turn
 * order. The caller has the creature in hand already — it is passing
 * `creature.conditions` on the line above — so it passes
 * `creature.actionRules` with it.
 *
 * **Optional, and the reason is the opposite of `allowance`'s.** That one is
 * required because a defaulted Speed silently *permitted* a move the fold then
 * refused, and the two readings forked. Here the default is "no rule stands on
 * this creature", which is the truth for every creature nobody has cast one of
 * these spells at and is the answer the engine gave before this existed. A
 * caller that forgets it refuses nothing it should have refused — a rule not
 * applied, which the action-economy sweep in `invariants.test.ts` is what
 * catches — rather than permitting something it should have refused twice over.
 */
export function spendAction(
  state: CombatState,
  id: CharacterId,
  conditions?: ConditionState,
  spend?: Spend,
  /**
   * The extra action to spend **by name**, where the caller is spending one
   * the turn was handed rather than the turn's own.
   *
   * SRD Patient Defense hands the Dodge to the turn when the Disengage is
   * bought, and the Monk then takes it for nothing — which the preference
   * below could not express: the turn's own action is still there, and an
   * extra narrowed to one action is worth nothing to anything else. So the
   * caller names it, exactly as a mover names the grant half a Speed came out
   * of, and `action-spent` carries the name so the reducer performs the same
   * spend the command did.
   *
   * Matched on the source alone. The narrowing is the *command's* to check,
   * because only a command knows which action it is taking — the reducer
   * folds a bare `action-spent` and never did.
   */
  grant?: string,
): Result<CombatState> {
  const capable = requireCapable(id, conditions);
  if (!capable.ok) return capable;

  const allowed = refuseSpend(id, 'action', spend);
  if (!allowed.ok) return allowed;

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  // Before the extras and before the turn's own action, because a foreclosed
  // slot is foreclosed however it would have been paid for: a Haste'd creature
  // under SRD Slow has an extra action and still may not take one after its
  // Bonus Action has gone.
  const open = refuseForeclosed(id, 'action', budget.value, spend);
  if (!open.ok) return open;

  if (grant !== undefined) {
    const index = budget.value.extraActions.findIndex((extra) => extra.source === grant);
    if (index === -1) {
      return err('no_such_grant', `nothing ${grant} handed ${id} this turn is left to spend`);
    }
    return ok(
      withBudget(
        state,
        id,
        { extraActions: budget.value.extraActions.filter((_, at) => at !== index) },
        budget.value,
      ),
    );
  }

  // **The turn's own action first, and the extras after it.** SRD Action Surge
  // adds to a turn rather than replacing what it had, so nothing is spent out
  // of a narrowed extra while the unnarrowed one is still there — which is
  // also what makes "except the Magic action" bite in the one case it is about.
  if (!budget.value.action) {
    return spendExtraAction(state, id, budget.value, spend?.as);
  }

  return ok(withBudget(state, id, { action: false }, budget.value));
}

/**
 * Spend one of the actions something added to this turn.
 *
 * The first extra that permits this action wins, and the order is the order
 * they were granted in — so a turn holding two extras spends them in the order
 * the log put them there, which is a fact about the log rather than about who
 * asked.
 *
 * The refusal says which is which: an empty list is the ordinary
 * `no_action`, and a list that all refuses the named action names what refused
 * it, because "you cannot do this" with no reason is the least useful true
 * thing a rules engine can say.
 */
/**
 * Whether one extra action will pay for this spend.
 *
 * Both narrowings at once, and they fail in opposite directions on the spend
 * that names nothing: an `except` has nothing to exclude and lets it by, an
 * `only` has nothing to match and refuses. See {@link GrantedAction.only}.
 */
const permitsExtra = (extra: GrantedAction, as: NamedAction | undefined): boolean =>
  (as === undefined || !(extra.except ?? []).includes(as)) &&
  (extra.only === undefined || (as !== undefined && extra.only.includes(as)));

/**
 * The same predicate, asked by a **command** about a grant it is naming.
 *
 * Exported because that question cannot be asked here: `spendAction` matches a
 * named grant on its source alone, since the reducer folds `action-spent`
 * without knowing which action it was. So the narrowing is checked by whoever
 * knows — see `refuseGrantMismatch` in `commands/actions.ts` — and both ends
 * read this one predicate rather than two spellings of it.
 */
export const permitsGrantedAction = (extra: GrantedAction, as: NamedAction): boolean =>
  permitsExtra(extra, as);

function spendExtraAction(
  state: CombatState,
  id: CharacterId,
  budget: TurnBudget,
  as: NamedAction | undefined,
): Result<CombatState> {
  if (budget.extraActions.length === 0) {
    return err('no_action', `${id} has already taken an action`);
  }

  const index = budget.extraActions.findIndex((extra) => permitsExtra(extra, as));
  if (index === -1) {
    const refusing = budget.extraActions[0]!;
    return err(
      'action_forbidden',
      as === undefined
        ? // An `only` list met by a spend that named nothing. The refusal says
          // which, because "you cannot do this" with no reason is the least
          // useful true thing a rules engine can say — and because the fix is
          // for the caller to take the action the list holds by its own name.
          `${id} has only the extra action ${refusing.source} bought, and that one is ${listed(refusing.only ?? [])} and nothing that does not say which it is`
        : `${id} has only the extra action ${refusing.source} bought, and that one is not the ${ACTION_TITLES[as]} action`,
    );
  }

  return ok(
    withBudget(
      state,
      id,
      { extraActions: budget.extraActions.filter((_, at) => at !== index) },
      budget,
    ),
  );
}

/**
 * Add to what this turn may be spent on: an action, or attacks outside an
 * Attack action.
 *
 * SRD Action Surge and SRD Flurry of Blows, which are one shape and two
 * fields. The command has already taken whatever the purchase cost — a Focus
 * Point, a Bonus Action — so everything this refuses is about the turn itself:
 * it is this creature's, and a second grant of attacks does not quietly
 * rewrite the gate on the ones already standing.
 */
export function grantTurnBudget(
  state: CombatState,
  id: CharacterId,
  grant: {
    readonly action?: GrantedAction;
    readonly attacks?: GrantedAttacks;
  },
): Result<CombatState> {
  if (grant.action === undefined && grant.attacks === undefined) {
    return err('nothing_granted', `nothing was added to ${id}'s turn`);
  }

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  const standing = budget.value.grantedAttacks;
  if (
    grant.attacks !== undefined &&
    standing !== null &&
    standing.remaining > 0 &&
    standing.unarmedOnly !== grant.attacks.unarmedOnly
  ) {
    return err(
      'attacks_outstanding',
      `${id} still has ${standing.remaining} granted attack(s) under a different rule about what may be swung`,
    );
  }

  return ok(
    withBudget(
      state,
      id,
      {
        ...(grant.action === undefined
          ? {}
          : { extraActions: [...budget.value.extraActions, grant.action] }),
        ...(grant.attacks === undefined
          ? {}
          : {
              grantedAttacks: {
                remaining: (standing?.remaining ?? 0) + grant.attacks.remaining,
                unarmedOnly: grant.attacks.unarmedOnly,
                // What sold them, carried so a rider written about "an attack
                // granted by your Flurry of Blows" has something to ask. The
                // newest grant names it, which is the same rule
                // `unarmedOnly` above follows: the refusal one block up keeps
                // two rules about what may be swung from standing at once.
                ...(grant.attacks.from === undefined ? {} : { from: grant.attacks.from }),
                // And the line and the creature a printed hit narrows them to
                // — W7-B10 — by the same rule: the newest grant names them.
                ...(grant.attacks.line === undefined ? {} : { line: grant.attacks.line }),
                ...(grant.attacks.against === undefined ? {} : { against: grant.attacks.against }),
              },
            }),
      },
      budget.value,
    ),
  );
}

/**
 * Whether one slot **could** be spent, without spending it.
 *
 * **The question, where its three neighbours are the deed**, and the split is
 * not cosmetic: a spell that uses up somebody else's Reaction has to know
 * whether the slot is there before it writes the event, and the fold performs
 * the spend by applying that event. A resolver that called `spendReaction` and
 * threw the answer away would be doing the thing in order to ask about it —
 * which reads to every sweep, and to every reader, as a spend.
 *
 * It delegates rather than restating the checks, so the answer a casting gets
 * and the answer the reducer gets are one function's: the capability, the
 * rules standing on the creature, whose turn it is, and whether the slot has
 * already gone are all asked exactly once, in one place.
 *
 * `movement` is not a member: movement is measured in feet against an
 * allowance this module is handed, so "is there any left" is a different
 * question with a different answer shape.
 */
export function canSpendSlot(
  state: CombatState,
  id: CharacterId,
  slot: 'action' | 'bonus-action' | 'reaction',
  conditions?: ConditionState,
  spend?: Spend,
): Result<true> {
  const after =
    slot === 'action'
      ? spendAction(state, id, conditions, spend)
      : slot === 'bonus-action'
        ? spendBonusAction(state, id, conditions, spend)
        : spendReaction(state, id, conditions, spend);
  return after.ok ? ok(true) : after;
}

/** SRD: "You can't take more than one Bonus Action on a turn." */
export function spendBonusAction(
  state: CombatState,
  id: CharacterId,
  conditions?: ConditionState,
  spend?: Spend,
): Result<CombatState> {
  const capable = requireCapable(id, conditions);
  if (!capable.ok) return capable;

  const allowed = refuseSpend(id, 'bonus-action', spend);
  if (!allowed.ok) return allowed;

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;
  const open = refuseForeclosed(id, 'bonus-action', budget.value, spend);
  if (!open.ok) return open;
  if (!budget.value.bonusAction) {
    return err('no_bonus_action', `${id} has already taken a Bonus Action`);
  }

  return ok(withBudget(state, id, { bonusAction: false }, budget.value));
}

/**
 * SRD: "You can take a Reaction on another creature's turn... Once you take a
 * Reaction, you can't take another one until the start of your next turn."
 *
 * So this is deliberately not restricted to the current combatant — an
 * Opportunity Attack is a Reaction taken on someone else's turn — and the
 * refresh happens in {@link beginTurn}, not at the end of a round.
 */
export function spendReaction(
  state: CombatState,
  id: CharacterId,
  conditions?: ConditionState,
  spend?: Spend,
): Result<CombatState> {
  const capable = requireCapable(id, conditions);
  if (!capable.ok) return capable;

  const allowed = refuseSpend(id, 'reaction', spend);
  if (!allowed.ok) return allowed;

  const budget = requireCombatant(state, id);
  if (!budget.ok) return budget;
  const open = refuseForeclosed(id, 'reaction', budget.value, spend);
  if (!open.ok) return open;
  if (!budget.value.reaction) {
    return err('no_reaction', `${id} has no Reaction until the start of their next turn`);
  }

  return ok(withBudget(state, id, { reaction: false }, budget.value));
}

/**
 * Take the Attack action, or take another swing inside the one already taken.
 *
 * SRD: "When you take the Attack action, you can make one attack roll with a
 * weapon or an Unarmed Strike", and Extra Attack puts more in the same action.
 * So the first swing spends the action and fills the quiver; every swing after
 * it empties the quiver and spends nothing.
 */
export function spendAttack(
  state: CombatState,
  id: CharacterId,
  attacksPerAction: number,
  conditions?: ConditionState,
  spend?: Spend,
  unarmed = false,
  light: string | null = null,
  /**
   * What this swing is and whom it is at, for a granted attack narrowed to a
   * line and a creature — W7-B10. Absent, no narrowed grant is spent, which is
   * what every caller written before the field means.
   */
  swing: { readonly name: string; readonly target: CharacterId } | null = null,
): Result<{ readonly state: CombatState; readonly tookAction: boolean }> {
  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  /**
   * SRD Light, recorded where the Attack action is paid for.
   *
   * The **first** Light weapon the action swings is the one the sentence is
   * about, so a record already standing is left alone: a second Light weapon
   * inside one Attack action is either Nick's extra attack, which spends
   * nothing here, or a swing the allowance has already been opened by.
   */
  const remembering = (had: TurnBudget): Partial<TurnBudget> =>
    light === null || had.lightWeaponSwung !== null ? {} : { lightWeaponSwung: light };

  // **Attacks something else bought come first**, where the swing qualifies
  // for them. A Monk who flurried and then swings a Quarterstaff does not
  // qualify and falls through to the ordinary price, which is the Attack
  // action they still have; a Monk who swings a fist spends what the Focus
  // Point bought and keeps the action. Taking the cheaper price first is never
  // worse — the action is still there afterwards either way.
  const granted = budget.value.grantedAttacks;
  // SRD Allosaurus: "one Bite attack against it" — W7-B10. A grant narrowed
  // to a line and a creature is spent only by a swing that is that line at
  // that creature; any other swing falls through to the ordinary price.
  const narrowedTo =
    granted === null ||
    ((granted.line === undefined ||
      (swing !== null && swing.name.toLowerCase() === granted.line.toLowerCase())) &&
      (granted.against === undefined || (swing !== null && swing.target === granted.against)));
  if (granted !== null && granted.remaining > 0 && (!granted.unarmedOnly || unarmed) && narrowedTo) {
    return ok({
      state: withBudget(
        state,
        id,
        { grantedAttacks: { ...granted, remaining: granted.remaining - 1 } },
        budget.value,
      ),
      tookAction: false,
    });
  }

  // Still inside an Attack action already taken.
  if (budget.value.attacksRemaining !== null && budget.value.attacksRemaining >= 1) {
    return ok({
      state: withBudget(
        state,
        id,
        {
          attacksRemaining: budget.value.attacksRemaining - 1,
          ...remembering(budget.value),
        },
        budget.value,
      ),
      tookAction: false,
    });
  }

  // **Through `spendAction`, naming itself.** The first swing of an Attack
  // action *is* an Action, so a rule forbidding the slot catches it here and
  // one naming `attack` in particular catches it too — Confusion's third row
  // compels the Attack action, which is `permits-only` on the same slot.
  // Swings after the first spend nothing and are above this line, which is
  // the same asymmetry the action budget already has.
  //
  // **An emptied quiver comes here too**, and that is what lets SRD Action
  // Surge buy the thing it is bought for. "You can take one additional
  // action" and the Attack action is an action: a Fighter who has swung twice
  // has spent the *action*, not the turn, so a second Attack action is a
  // second action — and the quiver fills again exactly as it did the first
  // time. Refusing here without asking was a Fighter who could Dodge after a
  // surge and could not swing.
  // **Which extra would pay, asked before the spend rather than after it.**
  // `spendAction` matches an extra on its source alone — the reducer folds
  // `action-spent` without knowing which action it was — so the grant that is
  // about to pay cannot be read back out of the state afterwards. It is found
  // here with `permitsExtra`, the one predicate `spendExtraAction` uses, so the
  // two can never disagree about which extra a swing spent.
  //
  // Only where the turn's own action has gone: the turn's own comes first, and
  // an Attack action paid for out of it is capped by whatever stands on the
  // creature and by nothing a grant says.
  const paying = budget.value.action
    ? undefined
    : budget.value.extraActions.find((extra) => permitsExtra(extra, 'attack'));

  const taken = spendAction(state, id, conditions, { rules: spend?.rules ?? [], as: 'attack' });
  if (!taken.ok) {
    // The more useful of two true sentences: a creature whose Attack action is
    // spent and who has nothing to buy a second one with is out of *attacks*,
    // which is what the swing was asking about.
    return budget.value.attacksRemaining === null
      ? taken
      : err('no_attacks_left', `${id} has used every attack of their Attack action`);
  }

  const after = requireTheirTurn(taken.value, id);
  if (!after.ok) return after;

  return ok({
    state: withBudget(
      taken.value,
      id,
      {
        attacksRemaining: Math.max(
          0,
          cappedAttacks(attacksPerAction, spend?.rules ?? [], paying) - 1,
        ),
        ...remembering(after.value),
      },
      after.value,
    ),
    tookAction: true,
  });
}

/**
 * What is left of this turn's movement, derived rather than stored.
 *
 * `allowance` is the creature's Speed **now** — `speedOf`'s answer, with
 * conditions, Exhaustion and every feature grant folded in — and the budget
 * holds only what happened: feet spent, and feet a Dash banked.
 *
 * **Store what happened, derive what is left.** The budget used to hold the
 * remainder, seeded from the pinned Speed, and a remainder is a derived
 * quantity frozen at its seed: sound only while every later change to the
 * allowance moves downwards, which is the one direction a cap can express. A
 * feature grant raises it, and nothing but the seed can raise a remainder — so
 * a Monk whose Speed is 40 was capped at 30 by whichever reader still held the
 * seed, and the command and the fold could disagree about which.
 *
 * A pure function over a budget and a number, so every caller asks it the same
 * way: `movementLeftFor` in `standing.ts` is the `GameState` half that looks
 * the allowance up first.
 */
export function movementLeft(budget: TurnBudget, allowance: number): number {
  return Math.max(0, allowance + budget.movementGained - budget.movementSpent);
}

/**
 * SRD Dash: "you gain extra movement for the current turn. The increase equals
 * your Speed **after applying any modifiers**."
 *
 * After modifiers is the load-bearing half, and the SRD spells it out: "If
 * your Speed of 30 feet is reduced to 15 feet, you can move up to 30 feet this
 * turn if you Dash." So the caller passes `speedOf`'s answer rather than a
 * printed number, and a Monk's Unarmored Movement reaches the Dash exactly as
 * it reaches the allowance and the mounting cost.
 *
 * **The increase is required, not optional.** An optional parameter defaulting
 * to `combatant.speed` is how the command and the fold came to measure one
 * question against two numbers — the fork this whole change exists to close —
 * so there is nowhere for a second answer to hide.
 *
 * **It is banked rather than added to an allowance**, because it was earned at
 * a moment: the Speed it was measured against was the Speed *then*. See
 * `TurnBudget.movementGained` for the open reading that follows from it.
 */
export function dash(
  state: CombatState,
  id: CharacterId,
  increase: number,
): Result<CombatState> {
  const combatant = state.order.find((c) => c.id === id);
  if (combatant === undefined) return err('not_a_combatant', `${id} is not in this fight`);

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  return ok(
    withBudget(
      state,
      id,
      { movementGained: budget.value.movementGained + Math.max(0, increase) },
      budget.value,
    ),
  );
}

/**
 * Hand this turn a number of feet that spend no Speed.
 *
 * SRD Tactical Shift, and the shape {@link grantTurnBudget} has one field
 * along: only a combat event writes a budget, so only a combat event can add
 * to one — see {@link GrantedAction} for why that rule exists.
 *
 * **A second grant from the same source replaces the first rather than
 * stacking**, which is the rule every sourced grant in this engine keeps: the
 * sentence hands over half a Speed each time it fires, not half a Speed more.
 * Nothing can fire it twice on one turn today — a pool use is a Bonus Action
 * and a turn has one — and the rule is here rather than waiting for the
 * feature that needs it, because the alternative is a silent accumulation.
 *
 * A grant of nothing is refused rather than filed: a row with no feet in it is
 * a refusal waiting to be read as an allowance.
 */
export function grantMovement(
  state: CombatState,
  id: CharacterId,
  grant: GrantedMove,
): Result<CombatState> {
  if (!Number.isFinite(grant.feet) || grant.feet <= 0) {
    return err('bad_distance', `${grant.feet} is not a number of feet to hand over`);
  }

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  return ok(
    withBudget(
      state,
      id,
      {
        grantedMoves: [
          ...budget.value.grantedMoves.filter((held) => held.source !== grant.source),
          grant,
        ],
      },
      budget.value,
    ),
  );
}

/**
 * SRD Disengage: no Opportunity Attacks from your movement, for this turn.
 *
 * The action each of these costs is spent by its own `action-spent` event, so
 * neither of them spends it here: one event, one thing, and a reducer that
 * cannot double-charge by replaying a pair.
 */
export function disengage(
  state: CombatState,
  id: CharacterId,
): Result<CombatState> {
  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  return ok(withBudget(state, id, { disengaged: true }, budget.value));
}

/**
 * SRD: "you can move a distance up to your Speed".
 *
 * **`allowance` is required, and that is the whole correction.** It is
 * `speedOf`'s answer — conditions, Exhaustion and every feature grant folded
 * together — supplied by the caller because this module sits below
 * `standing.ts`: `speedOf` needs a whole `GameState` and a combat state is not
 * one.
 *
 * It is not optional and must not become optional. The **reducer** calls this
 * function too, as its corrupt-log backstop, and a backstop is honest only
 * when it is the command's own check with the command's own inputs. An
 * optional parameter defaulting to `combatant.speed` is exactly how the two
 * came to measure one question against two numbers: the command validated a
 * Monk's 35-foot move against 40 and the fold refused the very event the
 * command had emitted, against 30. That is the Dodge-versus-Fire-Bolt fork,
 * and it is why a green suite folded a corrupt log.
 *
 * The cap is `movementLeft`, which is `allowance + gained − spent`. There is
 * no `min` against a stored remainder and no `movedSoFar`: both were the
 * arithmetic of a seeded remainder, and the remainder is gone. A condition
 * arriving mid-turn still cannot hand back distance already travelled — a
 * creature that has walked 20 of 30 feet and is then Grappled has
 * `max(0, 0 + 0 − 20)`, which is 0 — and the rule now falls out of the
 * subtraction rather than being arranged for.
 */
export function spendMovement(
  state: CombatState,
  id: CharacterId,
  feet: number,
  allowance: number,
  spend?: Spend,
  grant?: string,
  /**
   * The two ends of the move, where the mover was on a map.
   *
   * Eighth and last, appended rather than folded into an options object, for
   * `applyConditionTo`'s reason: every existing call site passes none, and the
   * two that matter — the command and the reducer's backstop — pass the same
   * one off the same event. A move with no points recorded simply records no
   * segment, which is what "no record is no charge" means.
   */
  segment?: MoveSegment,
): Result<CombatState> {
  if (!Number.isFinite(feet) || feet < 0) {
    return err('bad_distance', `${feet} is not a distance that can be moved`);
  }

  // SRD Tsunami: "it can't move". A Speed of 0 is a *different* sentence —
  // `speedOf`'s, and Hypnotic Pattern's — and the two are kept apart because
  // a Dash banked before the rule landed still spends against a Speed of 0
  // and must not spend against a prohibition.
  const permitted = refuseSpend(id, 'movement', spend);
  if (!permitted.ok) return permitted;

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

  // SRD Ice Devil: "it can move or take one action on its turn, not both."
  // The move asks the same question the three slot spenders do, which is what
  // makes the coupling symmetrical — the action after the move is refused by
  // `spendAction` and the move after the action is refused here.
  const open = refuseForeclosed(id, 'movement', budget.value, spend);
  if (!open.ok) return open;

  // **Feet a feature handed over come out of that grant and out of nothing
  // else**, which is the whole of why they are a counter rather than more
  // allowance: `movementSpent` is untouched, so a Tactical Shift leaves the
  // turn's own thirty feet exactly where they were. A grant nobody handed this
  // creature is refused by name rather than falling back on the Speed, because
  // a mover asking to spend one meant to keep their own movement.
  // The turn's own record of what it was made of, kept whichever allowance
  // paid for the move: SRD Tactical Shift's feet are still the creature's own
  // movement, and a boar that charged on them charged.
  const recorded = (budget: TurnBudget): Pick<TurnBudget, 'movementSegments'> | undefined =>
    segment === undefined ? undefined : { movementSegments: [...budget.movementSegments, segment] };

  if (grant !== undefined) {
    const held = budget.value.grantedMoves.find((one) => one.source === grant);
    if (held === undefined) {
      return err('no_such_grant', `nothing has handed ${id} a move under ${grant} this turn`);
    }
    if (feet > held.feet) {
      return err(
        'not_enough_movement',
        `${grant} has ${held.feet} feet left of what it handed ${id}`,
      );
    }
    return ok(
      withBudget(
        state,
        id,
        {
          grantedMoves: budget.value.grantedMoves.map((one) =>
            one.source === grant ? { ...one, feet: one.feet - feet } : one,
          ),
          ...recorded(budget.value),
        },
        budget.value,
      ),
    );
  }

  const allowed = movementLeft(budget.value, allowance);
  if (feet > allowed) {
    return err('not_enough_movement', `${id} has only ${allowed} feet of movement left`);
  }

  return ok(
    withBudget(
      state,
      id,
      { movementSpent: budget.value.movementSpent + feet, ...recorded(budget.value) },
      budget.value,
    ),
  );
}

/** SRD: one free object interaction per turn; a second requires Utilize. */
export function useFreeInteraction(state: CombatState, id: CharacterId): Result<CombatState> {
  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;
  if (!budget.value.freeInteraction) {
    return err('no_free_interaction', `${id} has already interacted with an object this turn`);
  }

  return ok(withBudget(state, id, { freeInteraction: false }, budget.value));
}

/**
 * Put a combatant into a fight already under way.
 *
 * **The first operation that changes the order's length mid-round**, and that
 * is the whole of its difficulty. `removeCombatant` shrinks the order and
 * `swapInitiative` reorders it; both leave every other combatant's relation to
 * the turn in progress alone, and this one does not.
 *
 * Three facts keep the order and the turn counts in exact step:
 *
 * **Where they go is {@link byInitiative}'s answer, not a second one.** The
 * order is already sorted by it, so the joiner belongs at the first index it
 * ranks *above* — and where it ranks level, the scan carries on past, which
 * puts a latecomer after everybody it exactly ties with. That is `startCombat`'s
 * own tiebreak read through the one fact that distinguishes a joiner: it was
 * listed last, because it arrived last.
 *
 * **Whoever is acting goes on acting.** Everything from the insertion point
 * onwards shifts one place later, so a `turnIndex` at or after it has to move
 * with them. Leaving it where it was would hand the rest of the turn to
 * whichever creature the shift pushed into that slot — one creature acting
 * twice, another never acting at all, and a log that looks perfectly
 * well-formed.
 *
 * **The joiner has taken no turns, and that is the honest number.** `begun`
 * and `ended` are per-creature counters that every turn-anchored deadline is
 * computed *relative* to — `begun + 1` for "the start of your next turn" — so
 * what has to be true is the relationship, not the round: `begun` equals
 * `ended` for everybody who is not mid-turn. Zero satisfies it, and the
 * command's first turn is counted when the order reaches them. A creature
 * inserted ahead of the one currently acting has simply missed this round,
 * which is what its place in the order says and what makes it act once next
 * round rather than at once.
 *
 * `round`, `turnsTaken` and the clock are untouched: nobody's turn ended.
 */
export function addCombatant(state: CombatState, joining: CombatantInput): Result<CombatState> {
  if (state.order.some((c) => c.id === joining.id)) {
    return err('duplicate_combatant', `${joining.id} is already in this combat`);
  }

  if (joining.after !== undefined) {
    // A position, not a number. SRD Find Steed's "immediately after yours":
    // the rung is the anchor's, copied so that a later joiner tying the anchor
    // exactly ties the follower exactly too and lands after both; the seat is
    // straight after the anchor and after every follower already seated there.
    const anchor = state.order.findIndex((c) => c.id === joining.after);
    if (anchor === -1) {
      return err(
        'unknown_anchor',
        `${joining.after} is not in this combat, so ${joining.id} cannot be seated after them`,
      );
    }
    const seated = state.order[anchor]!;
    let index = anchor + 1;
    while (index < state.order.length && state.order[index]!.after === joining.after) index += 1;
    return ok(
      seatAt(state, index, {
        id: joining.id,
        initiative: seated.initiative,
        speed: joining.speed,
        tiebreak: seated.tiebreak,
        after: joining.after,
      }),
    );
  }

  const combatant: Combatant = {
    id: joining.id,
    initiative: joining.initiative,
    speed: joining.speed,
    tiebreak: joining.tiebreak ?? 0,
  };

  const found = state.order.findIndex((c) => byInitiative(combatant, c) < 0);
  return ok(seatAt(state, found === -1 ? state.order.length : found, combatant));
}

/** The one place the order grows: a combatant seated at an index, with a fresh budget and count. */
function seatAt(state: CombatState, index: number, combatant: Combatant): CombatState {
  return {
    ...state,
    order: [...state.order.slice(0, index), combatant, ...state.order.slice(index)],
    turnIndex: index <= state.turnIndex ? state.turnIndex + 1 : state.turnIndex,
    budgets: { ...state.budgets, [combatant.id]: fullBudget() },
    turnCounts: { ...state.turnCounts, [combatant.id]: { begun: 0, ended: 0 } },
  };
}

/**
 * Take a combatant out of the fight.
 *
 * The turn index has to move with them: removing someone earlier in the order
 * would otherwise silently skip whoever's turn it actually is.
 */
export function removeCombatant(state: CombatState, id: CharacterId): Result<CombatState> {
  const index = state.order.findIndex((c) => c.id === id);
  if (index === -1) return needsContext('unknown_combatant', `${id} is not in this combat`);
  if (state.order.length === 1) {
    return err('last_combatant', 'combat needs at least one combatant');
  }

  const order = state.order.filter((c) => c.id !== id);
  const budgets = { ...state.budgets };
  delete budgets[id];
  // The counts go too. A duration anchored to "your next turn" has no such
  // moment left once you have left the fight, and a deadline that can never
  // arrive would strand the effect forever.
  const turnCounts = { ...state.turnCounts };
  delete turnCounts[id];

  // Removing someone before the current combatant shifts everyone down one.
  // Removing the current combatant means the next one is now at this index.
  let turnIndex = index < state.turnIndex ? state.turnIndex - 1 : state.turnIndex;
  let round = state.round;
  if (turnIndex >= order.length) {
    turnIndex = 0;
    round += 1;
  }

  const next: CombatState = { ...state, order, turnIndex, budgets, round, turnCounts };

  // If the removed combatant was the one acting, the next one is now up and
  // its turn is beginning.
  return ok(index === state.turnIndex ? beginTurn(next) : next);
}

/**
 * Whether the fight is still at the moment Initiative was rolled.
 *
 * SRD writes "when you roll Initiative" and "immediately after you roll
 * Initiative" on a handful of features, and the closest moment the engine
 * holds is the **first turn of the fight**: `turnsTaken` counts turns
 * *finished*, so it is still 0 throughout it. That window is the same for
 * everyone in the order rather than depending on where in it the holder sits,
 * which is what the sentence means — a creature fourth in Initiative takes it
 * during the first combatant's turn.
 *
 * `commands/features.ts` spells this out inline for `moment: 'initiative'`,
 * which is the same reading of the same clause; whoever next touches that file
 * should call this instead, so the moment has one definition rather than two
 * that agree today.
 */
export const isInitiativeMoment = (state: CombatState): boolean => state.turnsTaken === 0;

/**
 * SRD Alert: "Immediately after you roll Initiative, you can swap your
 * Initiative with the Initiative of one willing ally in the same combat. You
 * can't make this swap if you or the ally has the Incapacitated condition."
 */
export function swapInitiative(
  state: CombatState,
  a: CharacterId,
  b: CharacterId,
  conditionsA?: ConditionState,
  conditionsB?: ConditionState,
): Result<CombatState> {
  if (a === b) return err('same_combatant', 'a combatant cannot swap Initiative with themselves');

  const first = state.order.find((c) => c.id === a);
  const second = state.order.find((c) => c.id === b);
  if (first === undefined) return needsContext('unknown_combatant', `${a} is not in this combat`);
  if (second === undefined) return needsContext('unknown_combatant', `${b} is not in this combat`);

  for (const [id, conditions] of [
    [a, conditionsA],
    [b, conditionsB],
  ] as const) {
    if (conditions !== undefined && isIncapacitated(conditions)) {
      return err('incapacitated', `${id} is Incapacitated and can't swap Initiative`);
    }
  }

  const swapped = state.order.map((c) =>
    c.id === a
      ? { ...c, initiative: second.initiative, tiebreak: second.tiebreak }
      : c.id === b
        ? { ...c, initiative: first.initiative, tiebreak: first.tiebreak }
        : c,
  );

  const rebuilt = startCombat(swapped);
  if (!rebuilt.ok) return rebuilt;

  // Re-sorting rebuilds the order but must not reset the fight in progress.
  return ok({
    ...state,
    order: rebuilt.value.order,
    turnIndex: Math.min(state.turnIndex, rebuilt.value.order.length - 1),
  });
}

/**
 * SRD: "On a turn, you can expend only one spell slot to cast a spell."
 *
 * Whether a slot is available this turn, and recording that one went. Both
 * no-op for a creature outside the initiative order: with no turns there is
 * nothing for the restriction to attach to.
 */
export function canSpendSpellSlotThisTurn(state: CombatState, id: CharacterId): boolean {
  const budget = state.budgets[id];
  if (budget === undefined) return true;
  return budget.spellSlotSpentOnTurn !== state.turnsTaken;
}

/**
 * Whether a once-per-turn feature is still available to this creature.
 *
 * Outside combat there are no turns, so nothing restricts it — the same
 * reading the one-slot-per-turn rule takes, and for the same reason: "once per
 * turn" has no referent where nobody is taking turns.
 */
export function canUseFeatureThisTurn(
  state: CombatState,
  id: CharacterId,
  feature: string,
): boolean {
  const budget = state.budgets[id];
  if (budget === undefined) return true;
  return budget.featureUsedOnTurn[feature] !== state.turnsTaken;
}

/**
 * The namespaces the **engine itself** writes into the once-per-turn ledger.
 *
 * `featureUsedOnTurn` is one map keyed by a string, and three things write
 * into it: a feature's own id, which is content's; a swing inside a stated
 * sequence; a weapon property's allowance; and a printed Bonus Action line the
 * creature took. The last three are namespaced so that a reader can pick its
 * own entries out again — and a *reader* is the half a write-side convention
 * does not cover. `statedBonusActionsUsed` filters on the third of these and
 * hands what it finds to a gated Multiattack, so a feature whose id began
 * `stated-bonus-action:` would open a branch the book gates behind a line the
 * creature never took.
 *
 * So the namespaces are reserved: `checkFeatureDefinition` refuses a content
 * id in one of them. Reserved rather than the readers being made defensive,
 * because the ledger is one key space and the question "whose key is this" has
 * to have one answer.
 */
export const MULTIATTACK_LEDGER = 'multiattack:';
export const STATED_BONUS_ACTION_LEDGER = 'stated-bonus-action:';
export const WEAPON_MASTERY_LEDGER = 'weapon-mastery:';
/**
 * A fourth, and the reason it is not one of the three above it.
 *
 * SRD Sanctuary's ward is settled once per attacker per turn — owner's ruling,
 * 2026-09-22 — and a turn against a key is exactly what this ledger is. What
 * it must **not** be written under is `multiattack:`: `attacksMadeThisTurn`
 * filters on that prefix and splits what it finds on the last `#` to recover
 * an attack's name, so a key with no `#` in it comes back as a nonsense name
 * counted as a swing, and a warded creature's Multiattack sequence would hold
 * an attack nobody made. One key space, one answer to "whose key is this".
 */
export const PASSIVE_DEFENSE_LEDGER = 'passive-defense:';

/** All of them, for the validator that keeps content out. */
export const RESERVED_LEDGER_NAMESPACES: readonly string[] = [
  MULTIATTACK_LEDGER,
  STATED_BONUS_ACTION_LEDGER,
  WEAPON_MASTERY_LEDGER,
  PASSIVE_DEFENSE_LEDGER,
];

export function markFeatureUsed(
  state: CombatState,
  id: CharacterId,
  feature: string,
  turn: number,
): CombatState {
  const budget = state.budgets[id];
  if (budget === undefined) return state;
  // Sorted, because this reaches `GameState` and a fold has to compare byte
  // for byte however the keys arrived.
  const used: Record<string, number> = {};
  for (const key of [...Object.keys(budget.featureUsedOnTurn), feature].sort()) {
    used[key] = key === feature ? turn : (budget.featureUsedOnTurn[key] ?? 0);
  }
  return withBudget(state, id, { featureUsedOnTurn: used }, budget);
}

export function markSpellSlotSpent(state: CombatState, id: CharacterId): CombatState {
  const budget = state.budgets[id];
  if (budget === undefined) return state;
  return withBudget(state, id, { spellSlotSpentOnTurn: state.turnsTaken }, budget);
}
