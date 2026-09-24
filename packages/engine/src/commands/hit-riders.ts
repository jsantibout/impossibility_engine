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
import { weaponInSet } from '../attack.js';
import { CONFERRED_LEVEL } from '../catalogue.js';
import {
  modifierFor,
  proficiencyBonus,
  spellAttackModifierWith,
  spellSaveDcWith,
  type CharacterSheet,
} from '../character.js';
import { canUseFeatureThisTurn } from '../combat.js';
import { conditionInstanceId } from '../conditions.js';
import { applyEvent, type GameEvent, type GameState, grantSourcesOf } from '../events.js';
import { featureSource } from '../progression.js';
import { remaining } from '../resources.js';
import { sheetAsItStands, type HitOption } from '../standing.js';
import { type EffectTarget, timerKey } from '../timers.js';
import { turnAnchored, type Duration } from '../time.js';
import { type Supply } from './casting.js';
import { creatureOf } from './command.js';
import { applyConditionTo, schedule } from './conditions.js';
import { conditionLanding } from './spell-effect-riders.js';
import { runEffects } from './spell-resolution.js';
import { pullToward, shoveAwayFrom } from './spell-effect-movement.js';
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
  request: HitRiderRequest | undefined,
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

  // **The grapple, after the effect list and before the deadlines**, because
  // it is neither: it hangs no condition the option's own span is about — SRD
  // ends a grapple on facts about the grappler and never on the clock — and it
  // must see the world the effects left.
  const grabbed = makeTheGrapple(resolved.value.state, hit, option, unverified);
  if (!grabbed.ok) return grabbed;
  events.push(...grabbed.value);

  const held = grabbed.value.reduce(applyEvent, resolved.value.state);

  // **The shove, after the grapple**, because the order is the engine's to fix
  // and no printed line does both: a hold and a push are two answers to "where
  // is the target now", and a homebrew line that wrote both would otherwise be
  // ambiguous.
  const shoved = shoveOnTheHit(held, hit, option);
  events.push(...shoved.events);
  unverified.push(...shoved.unverified);

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

  const timed = fileDeadlines(
    [...shoved.events, ...lowering, ...emptied.value].reduce(applyEvent, held),
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
  return ok(landed.value.events);
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
): HitRiderOutcome {
  const move = option.forcedMove;
  if (move === undefined) return NOTHING;
  const performed =
    move.direction === 'push'
      ? shoveAwayFrom(world, hit.target, hit.attacker, { feet: move.feet }, option.name)
      : pullToward(world, hit.target, hit.attacker, { feet: move.feet }, option.name);
  return { events: performed.events, unverified: performed.unverified };
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
