import type { Ability, CharacterId, RollMode, Skill } from '@ie/shared';
import type { ModeSource } from './bonuses.js';
import type { GameState } from './events.js';

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
 * Five members, and the two that look redundant are the two the SRD is most
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
 * **There is deliberately no member for "D20 Tests".** Three SRD spells write
 * that phrase — Foresight, Resurrection, Ray of Enfeeblement — and every one
 * of them is blocked on something else entirely: a casting time of a minute, a
 * penalty linked to no casting, a repeat save that ends a spell hanging no
 * condition. A vocabulary member no definition can use is a guess. The phrase
 * does not even mean "all five of these": a death save is a D20 Test and
 * Initiative is one already counted as a check. When a castable spell needs
 * it, it arrives with that spell.
 */
export type RollFamily =
  | 'attack'
  | 'ability-check'
  | 'saving-throw'
  | 'initiative'
  | 'death-save';

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
 * Which rolls a modifier picks out.
 *
 * `ability` and `skill` are filters and both narrow rather than widen: absent
 * means the whole family. They are constrained to where they mean something —
 * an SRD attack roll is not a "Strength attack roll" in the language Advantage
 * is granted in, and a saving throw uses no skill — and the validator says so
 * rather than letting a definition express a rule the engine would then
 * quietly ignore.
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
   * The ability the roll uses. Only for `ability-check` and `saving-throw`.
   *
   * A skill check uses an ability too, so a selector naming a skill may name
   * its ability as well — but they have to agree, or the selector describes a
   * roll nobody can make.
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
   * **Only an attack roll spends one today**, and the validator says so rather
   * than letting a definition express a rule nothing would enforce. The two
   * attack rollers emit `roll-modifier-consumed`; the nine other emitters of
   * `roll-recorded` do not, so a one-shot on a save or a check would quietly
   * run to its deadline instead — which is a durable grant wearing this
   * field's name. SRD writes the sentence about a save (Improved Brutal
   * Strike's "Disadvantage on its next saving throw"), so the restriction is
   * this engine's rather than the book's, and it lifts when a save roller
   * spends one. See {@link oneShotProblem}.
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
  readonly ability?: Ability;
  readonly skill?: Skill;
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
  if (selector.roll !== query.family) return false;

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

  return true;
}

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

  // An attack roll uses an ability, but the SRD never grants Advantage on
  // "Strength attack rolls" — the phrase it uses for that is "Strength-based
  // D20 Tests", a different selector this vocabulary deliberately does not
  // have. Initiative names no ability either, and a death save has none at all.
  if (
    selector.ability !== undefined &&
    selector.roll !== 'ability-check' &&
    selector.roll !== 'saving-throw'
  ) {
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

  return found;
}

/**
 * A grant nothing would ever spend is a grant that does not end the way it says.
 *
 * {@link RollModifier.oneShot} is meaningful only where some roller emits
 * `roll-modifier-consumed`, and only the two attack rollers do. On any other
 * family the flag compiles, the grant lands, and it then runs to its deadline
 * like any durable one — the *silent* failure this file's whole validator
 * exists to convert into a refusal at authoring.
 *
 * **A limit of this engine and not of the SRD**, which is why it is worth
 * saying in the refusal: the book writes the sentence about a saving throw
 * too. The day a save roller spends one, this function is the single place
 * that stops refusing it.
 */
export function oneShotProblem(roll: RollFamily): RollSelectorProblem | null {
  if (roll === 'attack') return null;
  return {
    code: 'one_shot_off_an_attack',
    reason: `only an attack roll spends a one-shot modifier today, so one on a ${roll} would never be used up and would run to its deadline instead`,
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
      if (!selectorMatches(held.modifier.selector, holder as CharacterId, query)) continue;
      sources.add(held.source);
    }

    for (const source of [...sources].sort()) {
      spent.push({ holder: holder as CharacterId, source });
    }
  }

  return spent;
}
