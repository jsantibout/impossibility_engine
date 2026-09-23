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

  const rolled = rollD20Test(issuer, rng, initiativeModifier(sheet), modeSources, bonuses);
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
 * ### Four members, because the SRD writes four sentences
 *
 * | | SRD | |
 * |---|---|---|
 * | `forbids` | Stinking Cloud: "can't take an action or a Bonus Action" | takes named slots or named actions away |
 * | `permits-only` | Wind Walk: "The only actions a target can take … are the Dash action, the Hide action, and the Search action" | narrows one slot to a named few |
 * | `allows` | Conjure Woodland Beings: "you can take the Disengage action as a Bonus Action" | widens, rather than narrows |
 * | `grants` | Haste: "it gains an additional action on each of its turns" | **creates** one, rather than governing one |
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
   */
  | {
      readonly kind: 'allows';
      readonly action: NamedAction;
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
       * Absent is unnarrowed. **Haste's narrowing is absent on purpose**: the
       * five actions it lists include Utilize, which {@link NAMED_ACTIONS}
       * leaves out because no spender could be told apart as having taken one,
       * so a rule naming it would read as enforced and would not be.
       */
      readonly only?: readonly NamedAction[];
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
    rule.kind === 'allows' ? rule.action : '',
  ].join('|');
}

/**
 * Whether a rule reaches this spend at all.
 *
 * `grants` answers no, always, and that is the member rather than an omission:
 * it *creates* an action instead of judging one, so a spend that met it here
 * would be refused by the very sentence that handed it over.
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
const ACTION_TITLES: Readonly<Record<NamedAction, string>> = {
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
): Result<true> {
  for (const held of rules) {
    if (held.rule.kind === 'allows' && held.rule.action === action && held.rule.from === from) {
      return ok(true);
    }
  }
  return err(
    'action_not_allowed',
    `nothing lets ${id} take the ${ACTION_TITLES[action]} action as ${SLOT_NAMES[from]}`,
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
}

export interface CombatantInput {
  readonly id: CharacterId;
  readonly initiative: number;
  readonly speed: number;
  readonly tiebreak?: number;
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
  movementGained: 0,
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
): Result<CombatState> {
  const capable = requireCapable(id, conditions);
  if (!capable.ok) return capable;

  const allowed = refuseSpend(id, 'action', spend);
  if (!allowed.ok) return allowed;

  const budget = requireTheirTurn(state, id);
  if (!budget.ok) return budget;

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
  if (granted !== null && granted.remaining > 0 && (!granted.unarmedOnly || unarmed)) {
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
      { attacksRemaining: Math.max(0, attacksPerAction - 1), ...remembering(after.value) },
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

  const allowed = movementLeft(budget.value, allowance);
  if (feet > allowed) {
    return err('not_enough_movement', `${id} has only ${allowed} feet of movement left`);
  }

  return ok(
    withBudget(state, id, { movementSpent: budget.value.movementSpent + feet }, budget.value),
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

  const combatant: Combatant = {
    id: joining.id,
    initiative: joining.initiative,
    speed: joining.speed,
    tiebreak: joining.tiebreak ?? 0,
  };

  const found = state.order.findIndex((c) => byInitiative(combatant, c) < 0);
  const index = found === -1 ? state.order.length : found;

  return ok({
    ...state,
    order: [...state.order.slice(0, index), combatant, ...state.order.slice(index)],
    turnIndex: index <= state.turnIndex ? state.turnIndex + 1 : state.turnIndex,
    budgets: { ...state.budgets, [combatant.id]: fullBudget() },
    turnCounts: { ...state.turnCounts, [combatant.id]: { begun: 0, ended: 0 } },
  });
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
