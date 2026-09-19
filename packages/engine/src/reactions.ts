import { type Ability, type CharacterId } from '@ie/shared';
import type { D20TestKind } from './checks.js';
import { abilityModifier } from './character.js';
import { isIncapacitated } from './conditions.js';
import { distanceBetween, sightBetween } from './positioning.js';
import { remaining } from './resources.js';
import { sensesOf } from './standing.js';
import type { GameState } from './events.js';

/**
 * The moments a Reaction can answer, named once for everything that answers
 * them.
 *
 * Spells had their own vocabulary — `SpellDefinition.trigger` — and class
 * features had none at all, which is how eight features spent eleven batches
 * saying *"needs an interrupt the engine does not have"* while the arithmetic
 * they needed (`reduceDamage`, `interveneAfterRoll`, `rerollTest`) sat written
 * and unreachable. The temptation at that point is a general trigger bus. The
 * SRD does not ask for one: it asks for a **small finite set of mechanically
 * real instants**, each of which is a point in a resolution the engine already
 * performs.
 *
 * So this is that set, and it is a set rather than a framework because every
 * member is here on the strength of concrete rules that name it:
 *
 * | Window | What is already true | What is not yet decided | Who names it |
 * |---|---|---|---|
 * | `hit-by-attack` | the attack roll hit | the damage roll | *Shield*; seven monsters' Parry; the Shield Guardian |
 * | `damage-rolled` | the damage roll, by type | the damage the target takes | Uncanny Dodge, Deflect Attacks, Cutting Words, the Stone Giant |
 * | `damaged-by-creature` | **everything** — the damage landed | nothing | *Hellish Rebuke*, Retaliation |
 * | `test-rolled` | the d20's total, and whether it beat the DC | the effects of that outcome | Indomitable, Dark One's Own Luck, Peerless Skill, Cutting Words, the Sphinx |
 * | `casting-a-spell` | the casting is declared and the action spent | the slot, the effects | *Counterspell* |
 *
 * **`damaged-by-creature` is in both columns**, and that overlap is the
 * evidence this vocabulary is shared rather than merely tidy: a spell
 * (*Hellish Rebuke*) and a class feature (Retaliation) answer the same instant
 * under the same rule, and there is exactly one place that decides whether the
 * instant is still open.
 *
 * **What this deliberately is not.** There is no predicate language, no
 * registry, no subscription and no ordering engine. A window is a named point
 * in a resolution path, and adding one means adding a point to a path — which
 * is why two of the five arrived with the mechanics that needed them and three
 * were already there under other names.
 */
export type ReactionWindow =
  /** SRD *Shield*: "when you are hit by an attack roll". Damage is unrolled. */
  | 'hit-by-attack'
  /**
   * SRD Cutting Words: "when a creature ... **makes a damage roll**".
   *
   * The damage is rolled and typed and **nothing has been applied** — no hit
   * points have moved, no Concentration save has been asked for. That is the
   * only honest place for a rule that reduces "the attack's total damage
   * against you", because the total has to exist and must not yet have landed.
   */
  | 'damage-rolled'
  /**
   * SRD *Hellish Rebuke*: "in response to taking damage from a creature that
   * you can see"; SRD Retaliation: "When you take damage from a creature that
   * is within 5 feet of you".
   *
   * Everything is settled. A reaction here answers what happened and cannot
   * change it, which is exactly why it needs no pending state of any kind.
   */
  | 'damaged-by-creature'
  /**
   * SRD Dark One's Own Luck: "You can do so **after seeing the roll but before
   * any of the roll's effects occur**."
   *
   * The SRD writes this window out in a single clause, which is what makes it
   * a real instant rather than a convenient one. The total and the
   * success/failure are known; nothing has been done about them.
   */
  | 'test-rolled'
  /** SRD *Counterspell*: "a creature in the process of casting a spell". */
  | 'casting-a-spell';

/**
 * The windows a **spell** answers.
 *
 * A narrowing rather than the whole union, so `triggerRefusal` stays
 * exhaustive over exactly the moments SRD spells name. A case written for a
 * window no spell uses would be a rule nothing could reach.
 */
export type SpellReactionWindow = Extract<
  ReactionWindow,
  'hit-by-attack' | 'damaged-by-creature' | 'casting-a-spell'
>;

/**
 * The windows a **class feature** answers.
 *
 * Also a narrowing, and the two lists overlap in one member on purpose — see
 * {@link ReactionWindow}. No SRD class feature answers `hit-by-attack` by
 * changing the Armour Class the way *Shield* and Parry do; the two that look
 * as though they might (Uncanny Dodge, Deflect Attacks) are triggered by the
 * hit and **act on the damage**, so they belong to `damage-rolled`.
 */
export type FeatureReactionWindow = Extract<
  ReactionWindow,
  'damage-rolled' | 'damaged-by-creature' | 'test-rolled'
>;

/**
 * Something added to a reaction's die at the moment it is used.
 *
 * SRD Deflect Attacks: "1d10 plus your Dexterity modifier **and** Monk level"
 * — two addends on one feature, which is why this is a list where
 * {@link HealAmount} has a single `plus`. The ability case is resolved when the
 * die is thrown rather than at creation, on the same rule every conditional
 * benefit in `standing.ts` follows: a number written down at creation goes on
 * being the old one.
 */
export type ReactionAddend =
  | { readonly kind: 'ability'; readonly ability: Ability; readonly label: string }
  /** Resolved at creation, because it is a column of *that class's* table. */
  | { readonly kind: 'level'; readonly level: number; readonly label: string };

/**
 * How much a reaction is worth.
 *
 * Two shapes, because the SRD writes two. Deflect Attacks and Cutting Words
 * roll something; Uncanny Dodge halves. `halve` is not a die of any size, so
 * it is its own field rather than a notation nobody could write.
 */
export interface ReactionAmount {
  /** "1d10", or the Bardic Inspiration die resolved off the class table. */
  readonly dice?: string;
  readonly plus?: readonly ReactionAddend[];
  /** SRD Uncanny Dodge: "halve the attack's damage against you (round down)." */
  readonly halve?: true;
}

/**
 * What a reaction actually does, once the engine has agreed it may happen.
 *
 * Four members for nine features, and each member exists because at least two
 * features write it. A feature whose effect fits none of them is `manual` with
 * a note — the same answer `FeatureGrant` gives, and the honest one far more
 * often than a fifth member would be.
 */
export type ReactionEffect =
  /**
   * Take damage off a roll that has been made and not yet applied.
   *
   * SRD Uncanny Dodge ("halve the attack's damage against you"), Deflect
   * Attacks ("reduce the attack's total damage against you") and Cutting Words
   * ("subtract the number rolled from the creature's roll, reducing the
   * damage").
   */
  | {
      readonly kind: 'reduce-damage';
      readonly amount: ReactionAmount;
      /**
       * SRD Deflect Attacks: "its damage **includes** Bludgeoning, Piercing,
       * or Slashing damage". Absent, the feature answers any damage — which is
       * literally what Deflect Energy does to this list.
       */
      readonly damageTypes?: readonly string[];
      /**
       * SRD: "When an attack roll hits you". Absent for Cutting Words, which
       * answers a damage roll however it arose.
       */
      readonly fromAttackOnly?: true;
    }
  /**
   * Push a D20 Test that has landed, in either direction.
   *
   * SRD Dark One's Own Luck adds, Cutting Words subtracts, and Peerless Skill
   * adds to your own — one mechanism with a sign, which is the argument
   * `interveneAfterRoll` already settled for itself.
   */
  | {
      readonly kind: 'intervene';
      readonly amount: ReactionAmount;
      readonly direction: 'bonus' | 'penalty';
      /** Which D20 Tests the feature's own sentence names. */
      readonly tests: readonly D20TestKind[];
      /** Whether it answers a failure, a success, or says nothing either way. */
      readonly outcome: 'failure' | 'success' | 'either';
      /**
       * SRD Peerless Skill: "On a failure, the Bardic Inspiration **isn't
       * expended**."
       *
       * The one feature whose cost depends on whether it worked, which is why
       * the spend happens after the new total is known rather than before it.
       */
      readonly refundedOnFailure?: true;
    }
  /**
   * Roll the test again and keep the new number.
   *
   * SRD Indomitable: "You **must use the new roll**." Both features that write
   * this answer a **failure** and nothing else, so there is no `outcome` field
   * — a field with one possible value is a field nothing reads.
   */
  | { readonly kind: 'reroll'; readonly bonus?: ReactionAddend }
  /**
   * Swing back.
   *
   * SRD Retaliation: "you can take a Reaction to make one melee attack against
   * that creature, using a weapon or an Unarmed Strike." It changes nothing
   * about the damage that provoked it, which is the whole reason its window
   * needs no pending state.
   */
  | { readonly kind: 'melee-attack'; readonly withinFeet: number };

/** How far a reaction reaches from the creature taking it. */
export type ReactionReach =
  | { readonly kind: 'self' }
  /** SRD Cutting Words: "a creature that you can see within 60 feet". */
  | { readonly kind: 'within'; readonly feet: number };

/**
 * A Reaction a class feature offers, resolved at creation onto the sheet.
 *
 * On the sheet for the reason `standing` and `activated` are: what a feature
 * is worth is read off a class table, and re-deriving a class table on every
 * attack is not a thing to do in a reducer.
 *
 * **`costsReaction` is a real field and not a constant.** Four of the nine
 * features here are Reactions and five are not: Indomitable, Disciplined
 * Survivor, Dark One's Own Luck, Peerless Skill and the holder's own use of a
 * Bardic Inspiration die all sit in the `test-rolled` window and cost no
 * Reaction at all — they cost a pool use and nothing else. Treating the window
 * and the action-economy cost as one thing would have made every one of them
 * wrong, and it is the single most common mistake about this corner of the
 * rules.
 */
export interface ReactionFeature {
  readonly feature: string;
  readonly name: string;
  readonly window: FeatureReactionWindow;
  /** Whether the SRD spends a Reaction on it. Often it does not — see above. */
  readonly costsReaction: boolean;
  /** The pool one use comes out of, or null where the feature is free. */
  readonly pool: string | null;
  readonly reach: ReactionReach;
  /**
   * SRD Uncanny Dodge: "an attacker **that you can see**"; Cutting Words: "a
   * creature **that you can see** within 60 feet".
   *
   * Who must see whom is uniform: the reactor must see the creature whose roll
   * they are answering. A feature whose sentence says nothing about sight
   * leaves this absent, and a declared-unseen creature is then no obstacle.
   */
  readonly requiresSight?: true;
  readonly does: ReactionEffect;
}

/**
 * One creature's standing opportunity to answer an open window.
 *
 * Kept **on the pending record in `GameState`**, so a reload rebuilds exactly
 * who still owes an answer — the same reason `pendingMove.provoked` holds its
 * list rather than recomputing it. What it does *not* hold is the feature's
 * arithmetic: that is read off the sheet when the reaction is actually taken,
 * so a cap or a die size that has moved is the current one.
 */
export interface ReactionOffer {
  readonly reactor: CharacterId;
  readonly feature: string;
  /** The feature's display name, so a narrating layer needs no lookup. */
  readonly name: string;
  readonly costsReaction: boolean;
  /** The pool a use would come from, or null. */
  readonly pool: string | null;
}

/** What the engine could not check when it worked out who may answer. */
export interface ReactionOffers {
  readonly offers: readonly ReactionOffer[];
  readonly unverified: readonly string[];
}

/**
 * What a reaction adds to its die, and what to call it in the log.
 *
 * The ability case is read from the sheet at the moment of use; the level case
 * was fixed when the character was built. Same split as `selfHealAddend`.
 */
export function reactionAddends(
  amount: ReactionAmount,
  abilities: Readonly<Record<Ability, number>>,
): { readonly total: number; readonly labels: readonly string[] } {
  let total = 0;
  const labels: string[] = [];
  for (const addend of amount.plus ?? []) {
    total +=
      addend.kind === 'level' ? addend.level : abilityModifier(abilities[addend.ability]);
    labels.push(addend.label);
  }
  return { total, labels };
}

/**
 * Whether a creature could spend what this feature costs right now.
 *
 * Three things and no more: they are able to act at all, they still have the
 * Reaction if the feature needs one, and the pool has a use left. The Reaction
 * is only checked **in combat** — outside it there is no economy to spend, the
 * same reading `resolveCast`, `activateFeature` and `useSelfHeal` all take.
 */
function canAfford(state: GameState, reactor: CharacterId, feature: ReactionFeature): boolean {
  const creature = state.creatures[reactor];
  if (creature === undefined) return false;
  if (creature.vitals.dead) return false;
  // SRD Incapacitated: "You can't take any action, Bonus Action, or Reaction."
  // A feature that costs no Reaction is still the holder acting, and the
  // Monk's own text says so out loud on Evasion; nothing here is available to
  // a creature that cannot act.
  if (isIncapacitated(creature.conditions)) return false;

  if (feature.costsReaction && state.combat !== null) {
    const budget = state.combat.budgets[reactor];
    if (budget !== undefined && !budget.reaction) return false;
  }

  if (feature.pool !== null && remaining(creature.resources, feature.pool) < 1) return false;

  return true;
}

/**
 * Whether the reactor is close enough to the creature they are answering, and
 * can see them.
 *
 * Three-valued throughout, and the two unknowns are answered differently on
 * purpose — the same split `provokedBy` already makes:
 *
 * - **An unplaced creature is not offered a ranged reaction.** Where somebody
 *   is standing has no right answer until it is declared, and inventing one to
 *   hand out a Reaction is the wrong direction to guess in.
 * - **An undeclared sight line does not withhold the offer.** Absence from
 *   state is not evidence of blindness, and withholding a whole Reaction on
 *   that basis would be the engine deciding a fact nobody has established.
 *
 * Both are reported, because a Reaction the table was never told about is
 * exactly the sort of thing that vanishes silently.
 */
function reaches(
  state: GameState,
  reactor: CharacterId,
  feature: ReactionFeature,
  actor: CharacterId | null,
  unverified: string[],
): boolean {
  if (feature.reach.kind === 'self') {
    // "An attacker that you can see": the reactor's own sight of whoever acted.
    if (feature.requiresSight !== true || actor === null || actor === reactor) return true;
    return seen(state, reactor, actor, feature, unverified);
  }

  if (actor === null) return false;
  if (reactor === actor) return false;
  if (state.scene === null) {
    unverified.push(
      `no scene is set, so ${reactor} was not offered ${feature.name} against ${actor}`,
    );
    return false;
  }

  const apart = distanceBetween(state.scene, reactor, actor);
  if (!apart.ok) {
    unverified.push(
      `nobody has said where ${reactor} and ${actor} are standing, so ${feature.name} was not offered`,
    );
    return false;
  }
  if (apart.value > feature.reach.feet) return false;

  return feature.requiresSight !== true || seen(state, reactor, actor, feature, unverified);
}

function seen(
  state: GameState,
  reactor: CharacterId,
  actor: CharacterId,
  feature: ReactionFeature,
  unverified: string[],
): boolean {
  // **The reactor's senses.** `ReactionFeature.requiresSight` says who must
  // see whom — "the reactor must see the creature whose roll they are
  // answering" — so the looker is the reactor, and the Bard's Darkvision is
  // what settles Cutting Words rather than the Ogre's.
  const line =
    state.scene === null
      ? null
      : sightBetween(state.scene, reactor, actor, sensesOf(state, reactor));
  if (line === false) return false;
  if (line === null) {
    unverified.push(
      `nobody has said whether ${reactor} can see ${actor}, and ${feature.name} needs that; the offer was made rather than withheld`,
    );
  }
  return true;
}

/** Every reaction feature a creature has for one window. */
function featuresFor(
  state: GameState,
  who: CharacterId,
  window: FeatureReactionWindow,
): readonly ReactionFeature[] {
  return (state.creatures[who]?.sheet.reactions ?? []).filter((r) => r.window === window);
}

/** What the `damage-rolled` window is being asked about. */
export interface DamageContext {
  readonly target: CharacterId;
  /** Who dealt it, or null where nobody did — a trap has no attacker to see. */
  readonly by: CharacterId | null;
  /** An attack roll caused it, which two features require and one does not. */
  readonly fromAttack: boolean;
  /** The damage types present, for Deflect Attacks' clause. */
  readonly damageTypes: readonly string[];
}

/**
 * Who may answer a damage roll that has been made and not yet applied.
 *
 * **An empty list is the common case and the important one.** A window that
 * opens whenever damage is rolled would make every swing of every sword a
 * two-command negotiation; one that opens only when a creature actually has
 * something to spend leaves the ordinary attack exactly as atomic as it was.
 * That is not an optimisation — it is the rule `pendingMove` already follows,
 * where a move that provokes nobody simply happens.
 *
 * Sorted by reactor and then feature, so two readers of the same state agree
 * about the order, and so the fold compares byte for byte.
 */
export function offersForDamage(state: GameState, context: DamageContext): ReactionOffers {
  const offers: ReactionOffer[] = [];
  const unverified: string[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const reactor = key as CharacterId;
    for (const feature of [...featuresFor(state, reactor, 'damage-rolled')].sort((a, b) =>
      a.feature.localeCompare(b.feature),
    )) {
      if (feature.does.kind !== 'reduce-damage') continue;

      // SRD Uncanny Dodge and Deflect Attacks both begin "When an attack roll
      // hits you"; Cutting Words does not, and answers a damage roll from
      // anywhere the engine rolls one.
      if (feature.does.fromAttackOnly === true && !context.fromAttack) continue;

      // SRD Deflect Attacks: "its damage includes Bludgeoning, Piercing, or
      // Slashing damage" — *includes*, so one qualifying type is enough.
      const wanted = feature.does.damageTypes;
      if (wanted !== undefined && !context.damageTypes.some((t) => wanted.includes(t))) continue;

      // A self-reaching feature answers damage aimed at its own holder.
      // A reaching one answers somebody else's *roll* — Cutting Words is "a
      // creature that you can see within 60 feet ... makes a damage roll", so
      // the distance is to whoever rolled, and a Bard may well be the target
      // of the blow they are cutting. `reaches` below excludes the roller
      // themselves, which is the whole of "a creature that you can see".
      if (feature.reach.kind === 'self' && reactor !== context.target) continue;

      if (!canAfford(state, reactor, feature)) continue;
      if (!reaches(state, reactor, feature, context.by, unverified)) continue;

      offers.push(offerOf(reactor, feature));
    }
  }

  return { offers, unverified };
}

/** What the `test-rolled` window is being asked about. */
export interface TestContext {
  readonly who: CharacterId;
  readonly kind: D20TestKind;
  readonly success: boolean;
}

/**
 * Who may push a D20 Test that has landed and not yet had its effects.
 *
 * The same empty-list rule as {@link offersForDamage}: a test nobody can
 * change resolves in one call and records one event.
 */
export function offersForTest(state: GameState, context: TestContext): ReactionOffers {
  const offers: ReactionOffer[] = [];
  const unverified: string[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const reactor = key as CharacterId;
    for (const feature of [...featuresFor(state, reactor, 'test-rolled')].sort((a, b) =>
      a.feature.localeCompare(b.feature),
    )) {
      const does = feature.does;
      if (does.kind !== 'intervene' && does.kind !== 'reroll') continue;

      // SRD Indomitable and Disciplined Survivor both say "If you fail a
      // saving throw", and neither says anything about an ability check.
      const tests = does.kind === 'intervene' ? does.tests : (['saving-throw'] as const);
      if (!tests.includes(context.kind)) continue;

      const wants = does.kind === 'intervene' ? does.outcome : 'failure';
      if (wants === 'failure' && context.success) continue;
      if (wants === 'success' && !context.success) continue;

      // Indomitable is your own save; Cutting Words is somebody else's roll,
      // and `reaches` excludes the roller themselves.
      if (feature.reach.kind === 'self' && reactor !== context.who) continue;

      if (!canAfford(state, reactor, feature)) continue;
      if (!reaches(state, reactor, feature, context.who, unverified)) continue;

      offers.push(offerOf(reactor, feature));
    }
  }

  return { offers, unverified };
}

function offerOf(reactor: CharacterId, feature: ReactionFeature): ReactionOffer {
  return {
    reactor,
    feature: feature.feature,
    name: feature.name,
    costsReaction: feature.costsReaction,
    pool: feature.pool,
  };
}

/**
 * The feature a reactor named, if they have it and it answers this window.
 *
 * Read off the sheet rather than off the offer, so a feature whose die or cap
 * has moved since the window opened is the current one.
 */
export function reactionFeatureOf(
  state: GameState,
  reactor: CharacterId,
  featureId: string,
  window: FeatureReactionWindow,
): ReactionFeature | null {
  return (
    (state.creatures[reactor]?.sheet.reactions ?? []).find(
      (r) => r.feature === featureId && r.window === window,
    ) ?? null
  );
}

/**
 * Whether the moment a Reaction to *taking damage* answers is still open.
 *
 * SRD says "in response to", which means immediately, and the finest grain the
 * engine has for it is the turn — the same grain the one-slot-per-turn rule
 * and `pendingSaves` already use. Outside combat there are no turns, so the
 * clock closes it instead. Both facts are already in state; neither invents a
 * number of seconds, which is exactly the kind of number this engine exists
 * not to invent.
 *
 * Shared by *Hellish Rebuke*'s trigger and by Retaliation, which is the whole
 * point of the window vocabulary: one rule, one reading, two clients.
 */
export function damageWindowOpen(
  state: GameState,
  who: CharacterId,
): { readonly by: CharacterId; readonly turn: number | null; readonly elapsed: number } | null {
  const hurt = state.creatures[who]?.lastDamage ?? null;
  if (hurt === null) return null;
  if (hurt.turn !== (state.combat?.turnsTaken ?? null)) return null;
  if (hurt.elapsed !== state.elapsed) return null;
  return hurt;
}

/**
 * An opportunity a caller could take right now, whatever window it belongs to.
 *
 * This is the half Maestro needs and the engine had none of: the trigger
 * machinery could *refuse* a Reaction taken at the wrong moment, and nothing
 * could say that a moment was open. A model that has to guess whether a Shield
 * is available will either never cast one or will try constantly and be
 * refused.
 *
 * **It transfers no authority.** Every field is a fact the engine already
 * holds, and taking the opportunity still goes through the command that checks
 * every one of them again. What the query decides is nothing; what it does is
 * save a round trip of refusals.
 */
export interface ReactionOpportunity {
  readonly window: ReactionWindow;
  readonly reactor: CharacterId;
  /** A feature id, or a spell id for a Reaction spell. */
  readonly id: string;
  readonly name: string;
  readonly kind: 'feature' | 'spell';
  readonly costsReaction: boolean;
  /** The pool a use would come from, where one would. */
  readonly pool: string | null;
  /** What it answers: the creature that acted, or the casting that is open. */
  readonly against: CharacterId | null;
  /**
   * Which casting a `casting-a-spell` opportunity answers, by id.
   *
   * Several may be open at once and several may belong to one caster, so
   * `against` alone no longer names one — this is the id the caller sends back
   * as `CastSpellRequest.answers`, and without it a creature with two castings
   * open would produce two opportunities nothing could tell apart.
   */
  readonly casting?: string;
}
