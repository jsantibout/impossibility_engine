/**
 * What a feature does **because a blow landed**, where what it does is an
 * effect list.
 *
 * SRD Stunning Strike: "Once per turn when you hit a creature with a Monk
 * weapon or an Unarmed Strike, you can expend 1 Focus Point to attempt a
 * stunning strike. The target must make a Constitution saving throw." A
 * Cunning Strike, an Open Hand Technique and a Goliath's Hill's Tumble write
 * the same sentence about the same moment, and before this the moment had
 * nothing to fire at it: a feature's effect list was reachable from a pool use
 * and from nothing else, so every option on one was a purchase somebody made
 * with an action.
 *
 * **Nothing here resolves an effect.** `runEffects` does, the way it does for
 * a casting, a potion and a pool use — with the feature origin `usePoolOption`
 * already files under, so what a rider hangs is `feature:<id>` and
 * `castingIdOf` answers null for it. What this module is, is the *trigger*:
 * which swings qualify, what one costs, when it is asked for, and the deadline
 * the SRD prints on what it leaves behind.
 *
 * **Asked for, never automatic.** SRD writes "you can" on every one of them,
 * so the swing names the feature and the option; a swing that names none buys
 * nothing. That is also what keeps this off the sixteen other paths that deal
 * damage: it is a rider on an attack the attacker chose to spend something on.
 */

import { err, ok, type CharacterId, type ConditionName, type Result } from '@ie/shared';
import type { Weapon } from '@ie/srd';
import { weaponInSet, type ExtraDamage } from '../attack.js';
import { CONFERRED_LEVEL } from '../catalogue.js';
import {
  modifierFor,
  proficiencyBonus,
  spellAttackModifierWith,
  spellSaveDcWith,
  type CharacterSheet,
} from '../character.js';
import { canUseFeatureThisTurn, currentCombatant } from '../combat.js';
import { conditionInstanceId } from '../conditions.js';
import { applyEvent, type GameEvent, type GameState, grantSourcesOf } from '../events.js';
import { featureSource } from '../progression.js';
import { sizeAtMost } from '../positioning.js';
import { effectiveSizeOf } from '../size.js';
import { attachSource } from '../state.js';
import { remaining } from '../resources.js';
import {
  attackDamageDiceOf,
  sheetAsItStands,
  speedOf,
  type AttackContext,
  type HitHoldPayout,
  type HitOption,
} from '../standing.js';
import { carrying } from './inventory.js';
import { type EffectTarget, timerKey } from '../timers.js';
import { turnAnchored, type Duration } from '../time.js';
import { type Supply } from './casting.js';
import { creatureOf } from './command.js';
import { applyConditionTo, schedule } from './conditions.js';
import { conditionLanding } from './spell-effect-riders.js';
import { runEffects } from './spell-resolution.js';
import { pullToward, shoveAwayFrom } from './spell-effect-movement.js';
import { ABILITY_NAMES } from '@ie/shared';
import { rollSavingThrow } from '../checks.js';
import { recordD20Test, savingSupport } from './rolls.js';
import { escapeCheck, grappleSource } from './unarmed.js';
import { type SpellTargetOutcome } from './targeting.js';

/** What a swing says it is buying: one option of one feature. */
export interface HitRiderRequest {
  /** The feature whose sentence this is — SRD's "Stunning Strike". */
  readonly feature: string;
  /** Which of the things it offers, for a feature that prints several. */
  readonly option: string;
}

/** What a rider did, in the shape the attack path already hands back. */
export interface HitRiderOutcome {
  readonly events: readonly GameEvent[];
  readonly unverified: readonly string[];
}

const NOTHING: HitRiderOutcome = { events: [], unverified: [] };

/**
 * The dice this rider puts **into the blow**, or null where it adds none.
 *
 * SRD Fire's Burn: "When you hit a target with an attack roll and deal damage
 * to it, you can also deal 1d10 Fire damage to that target." The attack path
 * calls this where it gathers a smite's dice and a Cantrip Upgrade's, so the
 * component is rolled with the rest of the blow: one `damage-rolled`, a
 * critical that doubles it, and the target's Resistance to its own type
 * meeting it separately.
 *
 * **It answers null for a rider whose price can no longer be paid**, and that
 * is the same question {@link applyHitRider} asks a moment later for the same
 * reason. `hitRiderAsked` checked the pool at the *swing*; a held swing settles
 * a command later and `mayAct` lets its holder act in between, so a rider can
 * arrive at the settlement unaffordable and be dropped unspent. Dice that had
 * already ridden on the blow would be a rider that was dropped and still hurt
 * somebody.
 *
 * **Two of the three roads out of a swing cannot drift and the third is not
 * closed.** In the unheld swing this and `applyHitRider` run inside one
 * command; in `resolveAttackDamage` only the damage roll stands between them.
 * The third is the deferred one: where the blow opened a Reaction window, the
 * rider rides on the hold and `settleDamage` runs it a whole command later,
 * and `mayAct` does not refuse a pool use while damage is pending. So a holder
 * who spent the same pool inside that window would have the dice ride and the
 * rider reported dropped. No SRD content reaches it — a Goliath's boon is
 * gated `onlyIfChoice`, so one pool has one spender, and a second swing in the
 * same turn is refused before this is asked — and a homebrew that put two
 * spenders on one pool would want the price settled at the swing rather than a
 * fourth reading here.
 *
 * The source names the option rather than the feature, because that is what a
 * log reader has to see: a Goliath's blow says "Fire's Burn", not "Giant
 * Ancestry".
 */
export function riderDamageOnTheBlow(
  state: GameState,
  attacker: CharacterId,
  option: HitOption | null,
): ExtraDamage | null {
  if (option?.extraDamage === undefined) return null;
  if (option.pool !== null) {
    const creature = creatureOf(state, attacker);
    if (creature === null) return null;
    if (remaining(creature.resources, option.pool) < option.costs) return null;
  }
  return {
    source: option.name,
    type: option.extraDamage.damageType,
    dice: option.extraDamage.dice,
  };
}

/**
 * The dice this rider is **paying with**, for the gather that takes them off.
 *
 * SRD Cunning Strike: "You remove the die before rolling." The damage gather
 * is the one loop that knows whether the feature being charged fired on this
 * blow at all, so the price goes *into* it rather than being taken beside it —
 * see {@link AttackContext.forgoing}.
 *
 * `undefined` for every rider whose price is not dice, which is all of them
 * but one.
 */
export function riderDicePrice(option: HitOption | null): AttackContext['forgoing'] {
  if (option?.forgoesDiceOf === undefined) return undefined;
  return { feature: option.forgoesDiceOf, dice: option.costsDice ?? 0 };
}

/**
 * Whether the blow paid the rider's price, and the sentence it owes if not.
 *
 * SRD Cunning Strike buys an effect "when you deal Sneak Attack damage", and
 * `forgone` is the gather's answer to whether this blow dealt any: zero means
 * the feature did not qualify — no Advantage on the roll, no ally beside the
 * target, the allowance already spent this turn — and a rider that could not
 * be paid for does not happen.
 *
 * **Dropped and reported rather than refused**, which is the answer
 * {@link applyHitRider} already gives a pool that emptied inside a hold, and
 * for the same reason: by the time the price can be asked the die has been
 * thrown, and a rules refusal arriving after the blow has landed is a refusal
 * with a footprint.
 */
export function riderPricePaid(
  option: HitOption | null,
  forgone: number,
): { readonly option: HitOption | null; readonly unverified: readonly string[] } {
  if (option?.forgoesDiceOf === undefined || forgone > 0) return { option, unverified: [] };
  return {
    option: null,
    unverified: [
      `${option.featureName} rode on this hit and was dropped unspent: it is paid for with dice ${option.forgoesDiceOf} rolls, and this blow dealt none`,
    ],
  };
}

/**
 * The option this swing is buying, or the reason it cannot.
 *
 * **Asked before the attack is rolled**, which is the rule every other
 * caller-supplied argument on a swing follows: a refusal that arrives after
 * the blow has landed is a refusal with a footprint. Everything checkable
 * without knowing whether the attack hit is checked here — the feature, the
 * option, the weapon, the allowance and the pool — so a Monk who asks for a
 * Stunning Strike with an empty pool keeps their action and their point.
 *
 * `null` where the swing asked for nothing, which is nearly every swing.
 */
export function hitRiderAsked(
  state: GameState,
  id: CharacterId,
  sheet: CharacterSheet,
  weapon: Weapon | null,
  /**
   * Who the swing is aimed at, for the one qualification that is about them.
   *
   * SRD Hill's Tumble: "when you hit a **Large or smaller** creature". Every
   * other clause here asks about the attacker — their pool, their allowance,
   * their weapon, what bought the swing — and this one asks about the
   * creature on the other end, which is why it is a parameter rather than
   * something read off the sheet.
   */
  target: CharacterId,
  request: HitRiderRequest | undefined,
  /**
   * Whether this swing is an Unarmed Strike.
   *
   * Only {@link HitOption.fromGrant} reads it, and it has to: attacks a
   * purchase sold may be narrowed to Unarmed Strikes, so whether *this* swing
   * will come out of them is a question about the swing as well as about the
   * budget. A weapon is not the answer — a stat block's printed Claw is
   * neither a weapon nor an Unarmed Strike — which is why the caller states it
   * rather than this reading it off `weapon`.
   */
  unarmed = false,
): Result<HitOption | null> {
  if (request === undefined) return ok(null);

  const offered = (sheet.hitOptions ?? []).filter((one) => one.feature === request.feature);
  if (offered.length === 0) {
    return err('no_such_feature', `${id} has no feature called ${request.feature}`);
  }
  const option = offered.find((one) => one.option === request.option);
  if (option === undefined) {
    return err(
      'no_such_option',
      `${offered[0]!.featureName} buys ${offered.map((one) => one.option).join(', ')}, not ${request.option}`,
    );
  }

  // SRD: "with a Monk weapon or an Unarmed Strike" — two clauses, because an
  // Unarmed Strike is in no set of weapons: it is not a weapon. A feature that
  // names neither asks nothing of the swing.
  const asks = option.weapons !== undefined || option.unarmedStrike === true;
  const covered =
    weapon === null
      ? option.unarmedStrike === true
      : weaponInSet(weapon, option.weapons ?? []);
  if (asks && !covered) {
    return err(
      'weapon_not_covered',
      `${option.featureName} rides on ${describeWeapons(option)}, and ${id} is swinging ${weapon === null ? 'no weapon at all' : `a ${weapon.name}`}`,
    );
  }

  // SRD Open Hand Technique: "Whenever you hit a creature with **an attack
  // granted by your Flurry of Blows**."
  //
  // **Asked of the budget and answered before the roll**, which is where every
  // other qualification on a swing is settled: a rider refused after the blow
  // has landed is a refusal with a footprint.
  //
  // **What it asks is whether the purchase has an attack left that this swing
  // could take**, and that is a narrower claim than "this swing will spend
  // one". Two swings never reach `spendAttack` at all — the extra attack a
  // mastery or the Light property gives, and a Bonus Action swing — so a
  // purchase whose attacks are **not** narrowed to Unarmed Strikes could have
  // a rider ride on one of those and deduct nothing. No SRD purchase is
  // written that way: SRD Flurry of Blows is the only one in the book and it
  // is `unarmedOnly`, which the clause below reads, and neither free swing is
  // an Unarmed Strike. A homebrew that widened it would want the swing's own
  // price threaded down here, which is a fact `resolveAttack` settles after
  // this is asked.
  if (option.fromGrant !== undefined) {
    const granted = state.combat?.budgets[id]?.grantedAttacks ?? null;
    const sold =
      granted !== null &&
      granted.remaining > 0 &&
      granted.from === option.fromGrant &&
      (!granted.unarmedOnly || unarmed);
    if (!sold) {
      return err(
        'not_from_that_grant',
        `${option.featureName} rides on an attack ${option.fromGrant} granted, and this swing is not one of those`,
      );
    }
  }

  // SRD Hill's Tumble: "when you hit a **Large or smaller** creature with an
  // attack roll". Asked here with the rest, so a Goliath who names the boon
  // against an Ogre keeps the boon and the swing keeps its Action.
  //
  // **A creature nobody has measured is let through and said out loud**, which
  // is the reading a printed line's identical clause already takes —
  // `sizeReaches` in `commands/attacks.ts` — and the three-valued discipline
  // declared cover and declared sight keep. This is the certain half, where a
  // stated size refuses; the assumption is reported by {@link applyHitRider},
  // which is where the rider actually happens and the one end with somewhere
  // to put a sentence.
  if (option.targetNoLargerThan !== undefined) {
    const size = effectiveSizeOf(state, target);
    if (size !== null && !sizeAtMost(size, option.targetNoLargerThan)) {
      return err(
        'target_too_large',
        `${option.featureName} reaches a creature that is ${option.targetNoLargerThan} or smaller, and ${target} is ${size}`,
      );
    }
  }

  // SRD: "Once per turn." Outside combat there are no turns to count it
  // against, which is the answer Slow, Sap and Cleave already give to the same
  // absence — the swing happens and nothing is restricted.
  if (
    option.oncePerTurn === true &&
    state.combat !== null &&
    !canUseFeatureThisTurn(state.combat, id, option.feature)
  ) {
    return err('already_used', `${id} has already used ${option.featureName} this turn`);
  }

  const creature = creatureOf(state, id);
  if (creature !== null && option.pool !== null) {
    if (remaining(creature.resources, option.pool) < option.costs) {
      return err(
        'exhausted',
        `${option.featureName} costs ${option.costs} of ${id}'s ${option.pool} and they have ${remaining(creature.resources, option.pool)} left`,
      );
    }
  }

  // SRD Cunning Strike: "the number of Sneak Attack damage dice you must forgo
  // to add the effect."
  //
  // **The half a sheet can answer, answered here with the pool.** Whether this
  // creature holds those dice at all, and whether it holds enough of them, are
  // facts about the character — so a Rogue 1 who somehow named a rider costing
  // three keeps their action and their swing. The other half cannot be asked
  // yet: "if you have Advantage on the roll" is a fact about a die nobody has
  // thrown, and `standingAttackDamage` settles it where the dice are gathered.
  if (option.forgoesDiceOf !== undefined) {
    const held = attackDamageDiceOf(state, id, option.forgoesDiceOf);
    const price = option.costsDice ?? 0;
    if (held === null || held < price) {
      return err(
        'no_dice_to_forgo',
        held === null
          ? `${option.featureName} is paid for with dice ${option.forgoesDiceOf} rolls, and ${id} has no such feature`
          : `${option.name} costs ${price} of the dice ${option.forgoesDiceOf} rolls, and ${id} rolls ${held}`,
      );
    }
  }

  // SRD Cunning Strike's Poison: "To use this effect, you must have a
  // Poisoner's Kit on your person." A kit is an item, so the fact is the
  // engine's — and it is asked here with the rest, before the die.
  if (option.requiresItem !== undefined) {
    const line = carrying(state, id).find((one) => one.id === option.requiresItem);
    if (line === undefined) {
      return err(
        'item_not_carried',
        `${option.name} needs ${option.requiresItem} on ${id}'s person, and they are carrying none`,
      );
    }
  }

  // A deadline the clock cannot reach is a condition that would never lift, so
  // it is refused here rather than hung on somebody for ever. SRD writes the
  // span on the turn order — "until the start of your next turn" — and outside
  // combat there is no such moment.
  if (option.lasts !== undefined && state.combat === null) {
    return err(
      'no_turns',
      `${option.featureName} lasts until a turn boundary, and there are no turns outside combat for it to end at`,
    );
  }

  return ok(option);
}

/** How the refusal names the weapons a rider wants. */
function describeWeapons(option: HitOption): string {
  const weapons = (option.weapons ?? []).map((selector) =>
    [selector.category, selector.kind, ...(selector.properties ?? [])].filter(Boolean).join(' '),
  );
  const unarmed = option.unarmedStrike === true ? ['an Unarmed Strike'] : [];
  return [...weapons, ...unarmed].join(' or ');
}

/**
 * Everything the rider does, once the blow has landed.
 *
 * The state handed in is the world **after** the damage, folded, for the
 * reason a mastery property's rider takes it that way: the save this rolls is
 * rolled by a creature the blow itself may have changed.
 *
 * The cost goes first and the effects follow, so a log read forwards never
 * shows what a Focus Point bought before it shows the point being spent.
 *
 * **And a price that can no longer be paid drops the rider rather than
 * throwing.** `hitRiderAsked` checked the pool at the *swing*, which is where
 * every other refusal on a swing belongs — a rules refusal arriving after the
 * blow has landed is a refusal with a footprint. But a held swing settles a
 * command later and `mayAct` deliberately lets its holder act in between: SRD
 * Divine Smite is cast into that very window, and a use of the same pool is
 * just as legal there. So the pool can be empty by the time this runs, and
 * what used to happen then was a `resource-spent` the fold refuses — a
 * `CorruptLogError` out of three legal commands.
 *
 * Dropped unspent and reported, which is the answer the owner has already
 * ruled for the other two endings of a pinned rider — Shield turning the
 * triggering hit into a miss, and a creature leaving mid-hold — and the answer
 * `settleDamage` gives for a rider that will not resolve. **A refusal is not
 * available here**: the settlement is the only door out of the hold, so a
 * refusal would wedge the fight and every retry would wedge it again. Nothing
 * is refunded because nothing was charged.
 */
export function applyHitRider(
  state: GameState,
  supply: Supply,
  hit: {
    readonly attacker: CharacterId;
    readonly target: CharacterId;
    /**
     * What the blow came to on this creature **after its own defences**.
     *
     * SRD Specter: "its Hit Point maximum decreases by an amount equal to the
     * damage taken." The one number a rider reads off the blow rather than off
     * a sheet, and it has to be handed in: by the time this runs the damage is
     * folded, and the world after it holds a lowered pool of Hit Points rather
     * than the amount that lowered them.
     *
     * Absent where the caller is not settling damage, which is every rider
     * that does not read it.
     */
    readonly dealt?: number;
    /**
     * Whether **this blow** took the target's last hit point.
     *
     * SRD Phase Spider: "If this damage reduces the target to 0 Hit Points."
     * Handed in rather than read off the state, and the difference is a rule:
     * by the time this runs the world says only that the target is *at* 0, and
     * a creature already on the floor that is hit again takes a Death Saving
     * Throw failure. Only the caller, which held the world on both sides of
     * the damage, can tell the two apart.
     *
     * Absent where the caller is not settling damage, exactly as
     * {@link dealt} is.
     */
    readonly droppedToZero?: boolean;
  },
  option: HitOption,
): Result<HitRiderOutcome> {
  const attacker = creatureOf(state, hit.attacker);
  if (attacker === null) return ok(NOTHING);

  const events: GameEvent[] = [];

  if (option.pool !== null) {
    const left = remaining(attacker.resources, option.pool);
    if (left < option.costs) {
      return ok({
        events: [],
        unverified: [
          `${option.featureName} rode on this hit and was dropped unspent: it costs ${option.costs} of ${hit.attacker}'s ${option.pool} and there ${left === 1 ? 'is 1' : `are ${left}`} left by the time the blow landed`,
        ],
      });
    }
    events.push({ type: 'resource-spent', id: hit.attacker, key: option.pool, amount: option.costs });
  }
  // The allowance, marked where the swing spent it. Outside combat there is no
  // turn to count it against and nothing is written down.
  if (option.oncePerTurn === true && state.combat !== null) {
    events.push({
      type: 'feature-used',
      id: hit.attacker,
      feature: option.feature,
      turn: state.combat.turnsTaken,
    });
  }

  // **The numbers are the holder's, derived at the moment of the hit** — the
  // same derivation `usePoolOption` makes, with the same fallback for a class
  // that casts nothing at all. The ability was settled at creation: the
  // feature's own where it prints one, the granting class's otherwise.
  const sheet = sheetAsItStands(state, hit.attacker) ?? attacker.sheet;
  const ability = option.ability;
  // **A number the line states beats a number a sheet derives.** Derivation is
  // right for a class feature — SRD Stunning Strike is "your spell save DC" —
  // and wrong for a DC the book prints, and the two are indistinguishable
  // afterwards: `8 + Proficiency Bonus` equals the Ghoul's printed 10 by
  // coincidence and does not equal the Death Dog's 12.
  const saveDc =
    option.saveDc ??
    (ability === null ? 8 + proficiencyBonus(sheet) : spellSaveDcWith(sheet, ability));
  const unverified: string[] = [];
  // SRD Hill's Tumble's "a Large or smaller creature", where nobody has said
  // how big this one is. The swing refuses a size that *is* stated and too
  // big; an unstated one is let through and said out loud, which is the
  // reading a printed line's identical clause already takes and the
  // three-valued discipline declared cover keeps.
  if (option.targetNoLargerThan !== undefined && effectiveSizeOf(state, hit.target) === null) {
    unverified.push(
      `nobody has said how big ${hit.target} is, so ${option.featureName} rode on the hit regardless; a creature larger than ${option.targetNoLargerThan} would have been left alone`,
    );
  }
  // **The world before what this rider has just written down**, because
  // `runEffects` folds `events` onto whatever state it is handed. Passing it
  // the already-folded world applied the cost twice — invisible while a pool
  // was big enough to take it, and a `CorruptLogError` on a pool of one — and
  // it is the shape `usePoolOption` has always had: the state, and the events
  // beside it.
  const resolved = runEffects(state, hit.attacker, attacker, {
    origin: { kind: 'feature', feature: option.feature, name: option.name },
    effects: option.effects,
    route: null,
    ability,
    castLevel: CONFERRED_LEVEL,
    numbers: {
      attackModifier:
        ability === null ? proficiencyBonus(sheet) : spellAttackModifierWith(sheet, ability),
      saveDc,
      spellcastingModifier: ability === null ? 0 : modifierFor(sheet, ability),
      casterLevel: sheet.level,
    },
    // The creature the attack hit, and nobody else: a rider has no area and no
    // reach, because the blow is what chose its target.
    targets: [hit.target],
    unverified,
    supply,
    events,
  });
  if (!resolved.ok) return resolved;

  // **The hazard, before the hold and after the list**, because it is neither
  // and holds nothing open: SRD Fire Elemental's Burn leaves a creature
  // standing in a fire that nothing about this rider owns — no source to
  // release it by, no deadline to lift it, and no condition immunity that
  // reaches it. A creature already alight is re-lit rather than doubled, which
  // is the fold's own reading of the mark.
  if (option.hazard !== undefined) {
    events.push({
      type: 'hazard-caught',
      id: hit.target,
      hazard: { hazard: option.hazard, lit: option.name },
    });
  }

  // **The grapple, after the effect list and before the deadlines**, because
  // it is neither: it hangs no condition the option's own span is about — SRD
  // ends a grapple on facts about the grappler and never on the clock — and it
  // must see the world the effects left.
  const grabbed = makeTheGrapple(resolved.value.state, hit, option, unverified);
  if (!grabbed.ok) return grabbed;
  events.push(...grabbed.value);

  // **The attach, beside the grapple and for the grapple's reason**: it is a
  // relation between two creatures rather than anything hung on one of them,
  // and it must see the world the effects left. The two never both happen on
  // one printed line — a block either holds you or holds on to you.
  const fixed = makeTheAttach(
    grabbed.value.reduce(applyEvent, resolved.value.state),
    hit,
    option,
    unverified,
  );
  if (!fixed.ok) return fixed;
  events.push(...fixed.value);

  const held = [...grabbed.value, ...fixed.value].reduce(applyEvent, resolved.value.state);

  // **The shove, after the grapple**, because the order is the engine's to fix
  // and no printed line does both: a hold and a push are two answers to "where
  // is the target now", and a homebrew line that wrote both would otherwise be
  // ambiguous.
  const shoved = shoveOnTheHit(held, hit, option, saveDc, supply);
  if (!shoved.ok) return shoved;
  events.push(...shoved.value.events);
  unverified.push(...shoved.value.unverified);

  // **The maximum, off the damage rather than off the roll.** SRD Specter:
  // "an amount equal to the damage taken" — what the target actually took,
  // after Resistance, after Immunity, after a reduction. Tagged with the roll
  // issuer's position, so a Multiattack's second Life Drain lowers the maximum
  // again instead of replacing the first under one source key: the reading
  // `applyPrintedClauses` already takes of the Wight's identical sentence.
  const lowering: GameEvent[] = [];
  const dealt = hit.dealt ?? 0;
  if (option.lowersHitPointMaximum === 'damage-taken' && dealt > 0) {
    lowering.push({
      type: 'hit-point-maximum-adjusted',
      id: hit.target,
      adjustment: {
        source: `${featureSource(option.feature)}:${supply.issuer.count}`,
        amount: -dealt,
      },
    });
  }
  events.push(...lowering);

  // **What a blow that emptied the target leaves**, on the world the lowered
  // maximum has already been written onto — SRD Specter's sentence and SRD
  // Phase Spider's can both ride on one homebrew line, and a maximum lowered
  // after the Stable would be a creature stabilised at a number that then
  // moved. Last of the three because it is the one clause that can end the
  // creature.
  const emptied = onDroppingToZero(
    lowering.reduce(applyEvent, held),
    hit,
    option,
    supply,
  );
  if (!emptied.ok) return emptied;
  events.push(...emptied.value);

  // **The feet the rider hands over**, after everything it imposed and before
  // the deadlines, because it is neither: SRD Cunning Strike's Withdraw is
  // "Immediately after the attack, you move up to half your Speed", which is
  // the turn's business rather than the target's.
  //
  // Half of the Speed the rider fired at, floored and pinned onto the event —
  // the rule SRD Tactical Shift's own grant keeps, so a Speed that changes
  // later moves no foot of what has already been handed over. What it provokes
  // is nothing, and no field says so: `spendMovement` charges a granted move
  // out of that grant alone and `moveCreature` offers nobody a swing for it.
  //
  // **Only on the holder's own turn**, because feet a feature hands over
  // belong to a turn budget and a swing taken on somebody else's turn — an
  // Opportunity Attack, a Reaction — has none to hand them to. Said out loud
  // rather than refused: the blow has landed.
  if (option.handsMove !== undefined) {
    const theirs = state.combat !== null && currentCombatant(state.combat).id === hit.attacker;
    const feet = theirs ? Math.floor(speedOf(state, hit.attacker) / 2) : 0;
    if (feet > 0) {
      events.push({
        type: 'movement-granted',
        id: hit.attacker,
        source: featureSource(option.feature),
        feet,
      });
    } else {
      unverified.push(
        `${option.name} hands ${hit.attacker} half their Speed to move immediately, and ${theirs ? 'they have no Speed to halve' : 'it is not their turn, so there is no turn budget to hand it to'}`,
      );
    }
  }

  const timed = fileDeadlines(
    [...shoved.value.events, ...lowering, ...emptied.value].reduce(applyEvent, held),
    resolved.value.outcomes,
    resolved.value.held,
    { attacker: hit.attacker, option },
  );
  if (!timed.ok) return timed;

  return ok({ events: [...events, ...timed.value], unverified });
}

/**
 * SRD Ankheg: "it has the Grappled condition (escape DC 13)."
 *
 * **Made the way the Attack action's own grapple is made**, and that is the
 * whole of why it is here rather than in the effect list: the condition is
 * filed under {@link grappleSource}, so `grapplesOn` can find it, SRD's two
 * automatic endings can lapse it and `escapeGrapple` can be attempted against
 * it. The escape check is pinned at the moment the grapple is made, because
 * the book makes the grapple's DC and the escape's one number and an escape
 * attempted an hour later is against the number it was made at.
 *
 * **A creature immune to Grappled is unaffected, not an error** — the blow
 * still landed and still dealt its damage, which is the reading
 * `conditionLanding` holds at every other door a condition arrives through.
 */
function makeTheGrapple(
  world: GameState,
  hit: { readonly attacker: CharacterId; readonly target: CharacterId },
  option: HitOption,
  unverified: string[],
): Result<readonly GameEvent[]> {
  const grapple = option.grapples;
  if (grapple === undefined) return ok([]);

  const landed = conditionLanding(
    applyConditionTo(
      world,
      hit.target,
      'grappled',
      grappleSource(hit.attacker),
      [],
      undefined,
      undefined,
      {},
      escapeCheck(hit.attacker, grapple.escapeDc),
      // SRD Crocodile: "While Grappled, the target has the Restrained
      // condition." Implied by the Grappled instance, so it lifts with it —
      // at the escape, at either automatic lapse and at a release — through
      // the doors those already go through.
      grapple.whileHeld,
    ),
  );
  if (!landed.ok) return landed;
  if (!landed.value.landed) {
    unverified.push(
      `${option.featureName} grapples, and ${hit.target} cannot be given the Grappled condition at all`,
    );
    return ok([]);
  }
  return ok([
    ...landed.value.events,
    // SRD Animated Rug of Smothering: "takes 10 (2d6 + 3) Bludgeoning damage
    // at the start of each of its turns" — an arrangement the hold makes,
    // filed under the hold's own source so the boundary can read it and
    // `holdStillStands` can stop reading it the moment the escape succeeds.
    ...payoutEvents(grapple.payout, grappleSource(hit.attacker), hit),
  ]);
}

/**
 * SRD Stirge: "the stirge attaches to the target." SRD Darkmantle: the same,
 * plus a cover and a Speed of 0.
 *
 * **Made the way the grapple above it is made**, and filed the other way
 * round: the relation is written on the creature that attached, and everything
 * it hung at either end is filed under {@link attachSource} so one
 * `creature-detached` takes all of it.
 *
 * **Nothing here refuses.** The blow has landed; a creature immune to the
 * condition the cover imposes is attached without being covered and is said so
 * out loud, which is the reading `conditionLanding` holds at every door a
 * condition arrives through.
 */
function makeTheAttach(
  world: GameState,
  hit: { readonly attacker: CharacterId; readonly target: CharacterId },
  option: HitOption,
  unverified: string[],
): Result<readonly GameEvent[]> {
  const attach = option.attaches;
  if (attach === undefined) return ok([]);

  const source = attachSource(hit.target);
  const events: GameEvent[] = [
    {
      type: 'creature-attached',
      id: hit.attacker,
      attachment: {
        to: hit.target,
        name: option.name,
        ...(attach.detachDc === undefined ? {} : { detachDc: attach.detachDc }),
      },
    },
  ];

  // SRD Darkmantle: "Its Speed becomes 0." The grant the engine already writes
  // for Hypnotic Pattern's own sentence, filed under the attach so it comes
  // back the moment the darkmantle lets go.
  if (attach.holderSpeedBecomesZero === true) {
    events.push({
      type: 'speed-modifier-granted',
      id: hit.attacker,
      modifier: { source, change: 'zero' },
    });
  }

  // SRD Darkmantle: "it covers the target, which has the Blinded condition."
  // No deadline of its own — the attach is the lifetime — so the condition is
  // applied with no duration and lifted by the cause when the hold ends.
  let current = events.reduce(applyEvent, world);
  for (const condition of attach.whileHeld ?? []) {
    const landed = conditionLanding(
      applyConditionTo(current, hit.target, condition, attachSource(hit.attacker)),
    );
    if (!landed.ok) return landed;
    if (!landed.value.landed) {
      unverified.push(
        `${option.featureName} leaves ${hit.target} ${condition} while it is attached, and ${hit.target} cannot be given that condition at all`,
      );
      continue;
    }
    events.push(...landed.value.events);
    current = landed.value.events.reduce(applyEvent, current);
  }

  // SRD Stirge: "the target takes 5 (2d4) Necrotic damage at the start of each
  // of the stirge's turns."
  events.push(...payoutEvents(attach.payout, source, hit));
  return ok(events);
}

/**
 * The arrangement a hold makes, as the grant a turn boundary already reads.
 *
 * **Filed on whoever's turn collects it**, which is the shape `payoutsAt`
 * wants: SRD Stirge collects at its own boundary and the damage lands on the
 * creature it is drinking from, so the grant sits on the stirge and names the
 * other end. SRD Animated Rug writes "each of its turns" — the creature that
 * was struck — so its grant sits on them and names nobody.
 *
 * The dice are a notation, thrown at the boundary and never here: a payment
 * that repeats throws a new die each turn, and rolling one at the hit would
 * put the number in the log before the moment that produced it.
 */
function payoutEvents(
  payout: HitHoldPayout | undefined,
  source: string,
  hit: { readonly attacker: CharacterId; readonly target: CharacterId },
): readonly GameEvent[] {
  if (payout === undefined) return [];
  const collector = payout.onTurnOf === 'attacker' ? hit.attacker : hit.target;
  return [
    {
      type: 'turn-payout-granted',
      id: collector,
      payout: {
        source,
        at: payout.at,
        payout: 'damage',
        dice: payout.dice,
        flat: payout.flat,
        damageType: payout.damageType,
        ...(collector === hit.target ? {} : { to: hit.target }),
      },
    },
  ];
}

/**
 * SRD Phase Spider: "If this damage reduces the target to 0 Hit Points, the
 * target becomes Stable, and it has the Poisoned condition for 1 hour." SRD
 * Gibbering Mouther: "The target dies."
 *
 * **Nothing here refuses**, which is the rule the shove above it keeps and for
 * the same reason: the blow has landed. A creature immune to the condition is
 * reported by {@link conditionLanding} and the Stable still stands; a creature
 * already dead is not made deader, which is the reading `applyPrintedClauses`
 * takes of the same event.
 *
 * The order is the book's own: Stable, then what the hour hangs, then the
 * death — so a log read forwards never shows a condition hung on a corpse.
 * Only one line in the SRD prints the death and it prints nothing else, so the
 * order is the engine's to fix rather than a rule anybody wrote down.
 */
function onDroppingToZero(
  world: GameState,
  hit: {
    readonly attacker: CharacterId;
    readonly target: CharacterId;
    readonly droppedToZero?: boolean;
  },
  option: HitOption,
  supply: Supply,
): Result<readonly GameEvent[]> {
  const leaves = option.onDroppingToZero;
  if (leaves === undefined || hit.droppedToZero !== true) return ok([]);

  const events: GameEvent[] = [];
  let current = world;
  const land = (made: readonly GameEvent[]): void => {
    events.push(...made);
    current = made.reduce(applyEvent, current);
  };

  if (leaves.stable === true && current.creatures[hit.target]?.vitals.stable !== true) {
    land([{ type: 'stabilised', id: hit.target }]);
  }

  // **Sourced per use**, the reading the lowered maximum one function up
  // already takes of a Multiattack: two bites from one spider are two hours,
  // and under a shared source the second would merely move the first's
  // deadline.
  const source = `${featureSource(option.feature)}:${supply.issuer.count}`;
  for (const one of leaves.conditions ?? []) {
    const applied = applyConditionTo(
      current,
      hit.target,
      one.condition,
      source,
      [],
      { kind: 'seconds', seconds: one.durationSeconds },
      undefined,
      {},
      undefined,
      one.implies,
    );
    const landed = conditionLanding(applied);
    if (!landed.ok) return landed;
    if (landed.value.landed) land(landed.value.events);
  }

  // SRD Gibbering Mouther: "The target dies if it is reduced to 0 Hit Points by
  // this attack." `creature-died` and not damage — a healthy creature taking
  // exactly its maximum drops to 0 and does not die, which is the distinction
  // this event exists for.
  if (leaves.dies === true && current.creatures[hit.target]?.vitals.dead !== true) {
    land([{ type: 'creature-died', id: hit.target, cause: option.name }]);
  }

  return ok(events);
}

/**
 * SRD Satyr: "the satyr pushes the target up to 10 feet straight away from
 * itself." SRD Merrow pulls fifteen the other way.
 *
 * **The blow has landed, so nothing here may refuse.** A target nobody has
 * placed, a room nobody has described, a wall, two creatures in one space —
 * every one of them is a shove that did not happen rather than a hit that did
 * not, which is the reading `shoveAwayFrom` was written with and the reading
 * the Push mastery already takes of the same absence. The two performers are
 * that function and its twin, so a printed line and a spell push along the
 * same bearing with the same arithmetic.
 */
function shoveOnTheHit(
  world: GameState,
  hit: { readonly attacker: CharacterId; readonly target: CharacterId },
  option: HitOption,
  saveDc: number,
  supply: Supply,
): Result<HitRiderOutcome> {
  const move = option.forcedMove;
  if (move === undefined) return ok(NOTHING);

  // **The branch a feature prints and a printed line does not.** SRD Open Hand
  // Technique's Push: "The target must succeed on a Strength saving throw or
  // be pushed up to 15 feet away from you." A satyr simply pushes, so a line
  // with no `save` is the shove that always lands.
  const events: GameEvent[] = [];
  if (move.save !== undefined) {
    const victim = creatureOf(world, hit.target);
    if (victim === null) return ok(NOTHING);
    const issuedBefore = supply.issuer.count;
    const sheet = sheetAsItStands(world, hit.target) ?? victim.sheet;
    const support = savingSupport(world, hit.target, victim, move.save, supply);
    const save = rollSavingThrow(supply.issuer, supply.rng, sheet, move.save, {
      dc: saveDc,
      conditions: support.conditions,
      modes: support.modes,
      bonuses: support.bonuses,
    });
    if (!save.ok) return save;
    events.push(
      recordD20Test(
        hit.target,
        `${ABILITY_NAMES[move.save]} save vs ${option.name} (DC ${saveDc})`,
        save.value,
        save.value.success ? 'stands its ground' : 'is moved',
      ),
      {
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      },
    );
    if (save.value.success) return ok({ events, unverified: [] });
  }

  const performed =
    move.direction === 'push'
      ? shoveAwayFrom(world, hit.target, hit.attacker, { feet: move.feet }, option.name)
      : pullToward(world, hit.target, hit.attacker, { feet: move.feet }, option.name);
  return ok({ events: [...events, ...performed.events], unverified: performed.unverified });
}

/**
 * The deadline on what the rider actually hung, and on nothing else.
 *
 * `usePoolOption`'s own two loops, asked of a span that may be a moment in the
 * turn order rather than a number of seconds: a condition is filed per
 * instance, so the same rider landing twice moves the deadline instead of
 * filing a second one, and a `grants` deadline is filed only where a grant is
 * actually held.
 */
function fileDeadlines(
  world: GameState,
  outcomes: readonly SpellTargetOutcome[],
  held: ReadonlySet<CharacterId>,
  hit: { readonly attacker: CharacterId; readonly option: HitOption },
): Result<readonly GameEvent[]> {
  if (hit.option.lasts === undefined && hit.option.durationSeconds === undefined) return ok([]);

  const events: GameEvent[] = [];
  const source = featureSource(hit.option.feature);
  // **Whose next turn, decided per creature rather than once.** A span
  // anchored on the target is anchored on the creature the deadline is being
  // filed for, and one anchored on the attacker is the same creature every
  // time; a hit has one target, so the two agree everywhere but in what they
  // would mean if it ever had two.
  const spanFor = (holder: CharacterId): Duration | null =>
    spanOf(hit.option, hit.option.lastsOn === 'target' ? holder : hit.attacker);

  for (const { target, condition } of outcomeConditions(outcomes)) {
    const span = spanFor(target);
    if (span === null) continue;
    const on: EffectTarget = {
      kind: 'condition',
      on: target,
      instance: conditionInstanceId(condition, source),
    };
    const timer = schedule(
      world,
      on,
      span,
      // The repeat the resolution filed, kept: the span is the option's and not
      // the effect's, so restating the deadline without it would drop a
      // sentence the resolver had just written down.
      world.timers[timerKey(on)]?.repeatSave,
      undefined,
      hit.option.endsEarly,
    );
    if (!timer.ok) return timer;
    events.push(timer.value);
  }

  for (const on of [...held].sort()) {
    const holder = world.creatures[on];
    if (holder === undefined || !grantSourcesOf(holder).includes(source)) continue;
    const span = spanFor(on);
    if (span === null) continue;
    const timer = schedule(world, { kind: 'grants', on, source }, span);
    if (!timer.ok) return timer;
    events.push(timer.value);
  }

  return ok(events);
}

/** Every condition this run left on somebody, with whom it was left on. */
function outcomeConditions(
  outcomes: readonly SpellTargetOutcome[],
): readonly { readonly target: CharacterId; readonly condition: ConditionName }[] {
  return outcomes.flatMap((outcome) =>
    (outcome.conditions ?? []).map((condition) => ({ target: outcome.target, condition })),
  );
}

/**
 * How long what this rider hung lasts, as the clock's own vocabulary.
 *
 * Exactly one of the two, which `checkContent` holds the definition to: a
 * moment in the turn order — "until the start of **your** next turn" — or a
 * printed number of seconds.
 *
 * **Whose turn is the caller's to decide and not this function's**, which is
 * why the anchor arrives as a creature rather than being read off the option:
 * `HitOption.lastsOn` names a role and only the hit knows who is standing in
 * it.
 */
function spanOf(option: HitOption, anchor: CharacterId): Duration | null {
  if (option.lasts !== undefined) return turnAnchored(option.lasts, anchor);
  if (option.durationSeconds !== undefined) {
    return { kind: 'seconds', seconds: option.durationSeconds };
  }
  return null;
}
