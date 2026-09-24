/**
 * Features a creature switches on, and what spending one buys.
 *
 * A pool is declared in `pools.ts` and spent here: a recovery that refills a
 * different pool, a self-heal, a healing touch that lifts conditions at five
 * hit points apiece. The cap is derived at the moment of use and never stored,
 * because a pool's maximum can move.
 */

import {
  type CharacterId,
  type ConditionName,
  type ContextRequest,
  err,
  needsContext,
  ok,
  type Result,
} from '@ie/shared';
import { CONFERRED_LEVEL, itemChargePool } from '../catalogue.js';
import {
  modifierFor,
  proficiencyBonus,
  spellAttackModifierWith,
  spellSaveDcWith,
  type CharacterSheet,
} from '../character.js';
import { conditionInstanceId, isIncapacitated } from '../conditions.js';
import { type Rng } from '../dice.js';
import { describeElapsed, endOfCurrentTurn, turnAnchored, type Duration } from '../time.js';
import { type EffectTarget, type MaintenanceCap, timerKey } from '../timers.js';
import {
  applyEvent,
  type CommandStamp,
  type GameEvent,
  type GameState,
  grantSourcesOf,
  wearsHeavyArmor,
} from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { conferredSource, featureSource, hungSource } from '../progression.js';
import { type Placement, type Point } from '../positioning.js';
import { spendAttack, spendReaction } from '../combat.js';
import { remaining } from '../resources.js';
import { type RollIssuer, rollRecorded } from '../rolls.js';
import { healingRuleOf, maximisedHealing } from '../vitals.js';
import {
  isCreatureType,
  statedDamageType,
  type SpellArea,
  type SpellEffect,
} from '../spell-definitions.js';
import {
  type ActivatedFeature,
  actionRulesOn,
  canSee,
  type HungSpan,
  type HealAmount,
  type HitPointBudget,
  type PoolOption,
  recoveryCap,
  selfHealAddend,
  sheetAsItStands,
  speedOf,
} from '../standing.js';
import { weaponNarrowingHolds } from '../attack.js';
import { handsFor } from '../catalogue.js';
import { type Content } from '../content.js';
import { type Supply } from './casting.js';
import { featureConjuredLine, freeHands, quantityOf } from './inventory.js';
import { resolveAttack } from './attacks.js';
import { reactionSwing } from './movement.js';
import { attacksInAction } from '../monster.js';
import { creatureOf, reachedBy, spendFor, unknownCreature } from './command.js';
import { endConditionsOn, schedule } from './conditions.js';
import { healCreature } from './creatures.js';
import { mayAct } from './holds.js';
import { dealSpellDamage } from './damage.js';
import { rollSpellDice } from './rolls.js';
import { runEffects } from './spell-resolution.js';
import { areaTargets, type SpellTargetOutcome } from './targeting.js';
import { teleportTo } from './teleport.js';

export interface ActivateFeatureCommand extends CommandIdentity {
  readonly feature: string;
  /**
   * The object this use imbues — SRD Sacred Weapon's "one Melee weapon that
   * you are holding", by catalogue id.
   *
   * Required for a feature whose record carries an `imbuesWeapon` and refused
   * for one that does not, which is the symmetry `CastSpellRequest.weapon`
   * already keeps: the engine will not choose between two Longswords a
   * character is carrying, and a feature that does nothing to a weapon is not
   * asking which one.
   */
  readonly weapon?: string;
}

/**
 * Turn a feature on, paying everything it costs.
 *
 * SRD Rage is the shape this is built to: "You can enter it as a Bonus Action
 * if you aren't wearing Heavy armor... You can enter your Rage the number of
 * times shown for your Barbarian level." A prerequisite, an action, a pool,
 * and a deadline — and nothing is spent until all of them pass, which is the
 * same validate-before-rolling discipline casting obeys.
 *
 * The benefits are not here and should not be: they are standing effects that
 * require the feature to be active, so turning it on grants nothing directly
 * and turning it off takes nothing away directly. Neither can go stale.
 *
 * **Except what a use hangs on an object.** SRD Sacred Weapon imbues "one
 * Melee weapon that you are holding", and one object is the thing no derived
 * benefit can name: a standing grant is read off its holder and narrows by a
 * *kind* of weapon. So an activation with an `imbuesWeapon` on its record
 * names the weapon, and this is the reason the command takes `content` — the
 * kind a weapon is lives in the catalogue, `equipped` pins an armour record
 * and no weapon record, and a command may read a catalogue where the fold may
 * not. What it hangs is pinned into the event, so the fold still opens
 * nothing.
 */
export function activateFeature(
  state: GameState,
  id: CharacterId,
  command: ActivateFeatureCommand,
  content: Content,
): Result<GameEvent[]> {
  return once(state, `activate:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const definition = (creature.sheet.activated ?? []).find((a) => a.feature === command.feature);
    if (definition === undefined) {
      return err('no_such_feature', `${id} has no feature called ${command.feature}`);
    }

    // **A feature that imbues an object may be used again while it runs**, and
    // that is the book rather than an exception carved for one subclass: SRD
    // Sacred Weapon runs "for 10 minutes **or until you use this feature
    // again**", which is the same sentence SRD Wild Shape prints and
    // `assumeShape` already obeys. Every other activation is a state its
    // holder is in, and entering it twice is a use nobody would get anything
    // for. The prior imbuing ends below, before this one begins.
    const reused = creature.activeFeatures.includes(command.feature);
    if (reused && definition.imbuesWeapon === undefined) {
      return err('already_active', `${id} is already in ${definition.name}`);
    }

    // The object this use is aimed at, checked against the catalogue and
    // against what the holder is carrying **before anything is spent** — so a
    // Paladin who names their Longbow keeps the Channel Divinity.
    const imbuing = imbuedWeapon(state, id, definition, command.weapon, content);
    if (!imbuing.ok) return imbuing;

    // **And whether there is a hand to put it in**, asked here for the reason
    // `resolveSpell` asks it of a casting's conjuring: before the action, the
    // pool and the deadline, so a Warlock with both hands full pays nothing
    // for finding out. SRD Pact of the Blade: "you can conjure a pact weapon
    // **in your hand**" — a Glaive takes two of them, off the catalogue
    // record, and `featureConjuredLine` pins the same number onto the line.
    const conjuring =
      definition.conjuresWeapon === true && imbuing.value !== null
        ? (content.item(imbuing.value) ?? null)
        : null;
    if (conjuring !== null) {
      const wants = handsFor(conjuring);
      // **Asked of the world the *previous* bond has already left.** SRD Pact
      // of the Blade ends the first bond with the same Bonus Action that
      // begins the second — "if you use this feature's Bonus Action again" —
      // so a Warlock holding a two-handed Glaive has two hands free for the
      // Longsword, not none. The ending is folded here as a hypothetical and
      // thrown away: nothing is emitted until every refusal has passed, which
      // is the rule this whole block is under.
      const free = freeHands(
        reused
          ? applyEvent(state, {
              type: 'feature-ended',
              id,
              feature: command.feature,
              reason: 'dismissed',
            })
          : state,
        content,
        id,
      );
      if (wants > free) {
        return err(
          'no_free_hand',
          `${definition.name} puts ${conjuring.name} in ${id}'s hand${wants === 1 ? '' : 's'}, and ${free === 0 ? 'both are' : 'not enough is'} full`,
        );
      }
    }

    // SRD Rage: "if you aren't wearing Heavy armor". The same clause that ends
    // it is the one that stops it starting, so it is read from one list.
    for (const requirement of definition.endsOn ?? []) {
      if (requirement === 'incapacitated' && isIncapacitated(creature.conditions)) {
        return err('incapacitated', `${id} is Incapacitated and cannot enter ${definition.name}`);
      }
      if (requirement === 'heavy-armor' && wearsHeavyArmor(creature)) {
        return err('heavy_armor', `${definition.name} cannot be entered in Heavy armour`);
      }
      // SRD Pact of the Blade: "Your bond with the weapon ends ... if you
      // die." The same clause that ends it is what stops it starting, which is
      // the rule this whole list is read under.
      if (requirement === 'death' && creature.vitals.dead) {
        return err('dead', `${id} is dead and cannot enter ${definition.name}`);
      }
    }

    // SRD Steady Aim: "You can use this feature only if you haven't moved
    // during this turn." A gate on paying for the use, asked before anything is
    // spent like every other prerequisite here, and read off the feet the
    // budget *stored* rather than off what is left of an allowance — which is
    // the whole reason `movementSpent` holds what happened.
    if (definition.onlyIfUnmoved === true) {
      const moved = state.combat?.budgets[id]?.movementSpent ?? 0;
      if (moved > 0) {
        return err(
          'already_moved',
          `${definition.name} may be used only before moving, and ${id} has already moved ${moved} feet this turn`,
        );
      }
    }

    if (definition.pool !== null && remaining(creature.resources, definition.pool) < 1) {
      return err('exhausted', `${id} has no uses of ${definition.name} left`);
    }

    const events: GameEvent[] = [];

    // The action economy only exists in combat; outside it there is nothing to
    // spend, exactly as `resolveCast` finds.
    if (state.combat !== null && definition.action !== 'none') {
      const spent = spendFor(state, id, definition.action);
      if (!spent.ok) return spent;
      events.push(spent.value);
    }

    if (definition.pool !== null) {
      events.push({ type: 'resource-spent', id, key: definition.pool, amount: 1 });
    }

    // "or until you use this feature again". The same `feature-ended` a
    // deadline would have written, so the fold's one route out of an
    // activation is the route taken and the derived pass below it takes the
    // old rider away before the new one is hung.
    if (reused) {
      events.push({ type: 'feature-ended', id, feature: command.feature, reason: 'dismissed' });
    }

    events.push({
      type: 'feature-activated',
      id,
      feature: command.feature,
      ...(stamp === null ? {} : { command: stamp }),
    });

    // **What the use puts in a hand**, after the activation so the line names a
    // feature the log has already switched on, and before the rider so the
    // weapon the rider is hung on is a weapon the holder has. SRD Pact of the
    // Blade's "you can conjure a pact weapon in your hand": pinned from the
    // sheet, taken away by nothing, and gone the fold after the bond is — see
    // `InventoryLine.feature`, whose lifetime the fold settles because a bond
    // ends by three doors and writes an event about a weapon at none of them.
    if (conjuring !== null) {
      events.push({
        type: 'items-gained',
        id,
        items: [featureConjuredLine(conjuring, definition.feature)],
        source: `${definition.name}, conjured`,
      });
    }

    if (imbuing.value !== null) {
      events.push({
        type: 'weapon-rider-granted',
        id,
        rider: {
          source: featureSource(definition.feature),
          // The feature's own name rather than its id, because this is what a
          // bonus on an attack roll is printed as; read off the sheet the
          // activation is already holding and pinned, so the log never needs
          // the book opened again.
          name: definition.name,
          weapon: imbuing.value,
          // "This effect also ends if you aren't carrying the weapon", where
          // the feature prints that sentence and not where it does not.
          ...(definition.imbuesWeapon?.endsWhenLetGo === undefined
            ? {}
            : { endsWhenLetGo: definition.imbuesWeapon.endsWhenLetGo }),
          ...(definition.imbuesWeapon?.attackBonusFrom === undefined
            ? {}
            : { attackBonusFrom: definition.imbuesWeapon.attackBonusFrom }),
          ...(definition.imbuesWeapon?.damageTypes === undefined
            ? {}
            : { damageTypes: definition.imbuesWeapon.damageTypes }),
          // SRD Pact of the Blade's two clauses beside the type offer: the
          // modifier the swing may use instead of the weapon's own, and the
          // training in **that** weapon. Both ride the record a casting
          // already writes — `ability` is Shillelagh's own field, and
          // `strikeStyleFor` sends it to the attack roll and the damage roll
          // together, which is exactly the pair the sentence names.
          ...(definition.imbuesWeapon?.offersAbility === undefined
            ? {}
            : { ability: definition.imbuesWeapon.offersAbility }),
          ...(definition.imbuesWeapon?.grantsProficiency === undefined
            ? {}
            : { proficient: definition.imbuesWeapon.grantsProficiency }),
        },
      });
    }

    const hung = hangGrants(state, id, definition);
    if (!hung.ok) return hung;
    events.push(...hung.value);

    const timer = featureTimer(state, id, definition);
    if (!timer.ok) return timer;
    if (timer.value !== null) events.push(timer.value);

    return ok(events);
  });
}

export interface HealingTouchCommand extends CommandIdentity {
  readonly feature: string;
  readonly target: CharacterId;
  /** Hit points to draw. Zero is legal when the touch is only lifting. */
  readonly hitPoints?: number;
  /** Conditions to lift, each at the feature's own cost. */
  readonly lift?: readonly ConditionName[];
}

/**
 * Draw on a pool of hit points by touching somebody.
 *
 * SRD Lay On Hands: "As a Bonus Action, you can touch a creature (which could
 * be yourself) and draw power from the pool of healing to restore a number of
 * Hit Points to that creature, up to the maximum amount remaining in the
 * pool. You can also expend 5 Hit Points from the pool of healing power to
 * remove the Poisoned condition from the creature; **those points don't also
 * restore Hit Points to the creature.**"
 *
 * That last clause is the whole reason the cost and the healing are two
 * numbers. Five points buy the lifting and heal nothing, so a Paladin who
 * draws 3 and lifts Poisoned spends 8 and the creature gains 3.
 *
 * Restoring Touch lengthens the list of conditions and changes nothing else,
 * which is why it is not a second command: it is the Improved Critical shape,
 * a later feature restating an earlier one.
 *
 * **The whole drawing is validated before any of it is spent**, so a Paladin
 * who asks for more than the pool holds keeps every point.
 */
export function useHealingTouch(
  state: GameState,
  id: CharacterId,
  command: HealingTouchCommand,
): Result<GameEvent[]> {
  return once(state, `healing-touch:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const definition = (creature.sheet.healingTouch ?? []).find((h) => h.feature === command.feature);
    if (definition === undefined) {
      return err('no_such_feature', `${id} has no feature called ${command.feature}`);
    }

    const target = creatureOf(state, command.target);
    if (target === null) return unknownCreature(command.target);

    const hitPoints = command.hitPoints ?? 0;
    if (!Number.isInteger(hitPoints) || hitPoints < 0) {
      return err('bad_amount', `a drawing is a whole number of hit points, got ${hitPoints}`);
    }

    const lift = command.lift ?? [];
    if (new Set(lift).size !== lift.length) {
      return err('duplicate_condition', 'a condition named twice would be charged for twice');
    }
    for (const condition of lift) {
      if (!definition.lifts.includes(condition)) {
        return err('cannot_lift', `${definition.name} does not lift the ${condition} condition`);
      }
    }

    const drawn = hitPoints + lift.length * definition.costPerCondition;
    if (drawn < 1) return err('nothing_drawn', `${definition.name} was used to draw nothing`);

    const left = remaining(creature.resources, definition.pool);
    if (left < drawn) {
      return err('exhausted', `${definition.name} has ${left} left, and ${drawn} was drawn`);
    }

    // SRD: "you can touch a creature." The reach a fist has, measured the way
    // everything else is — and the same rule a potion administered to somebody
    // else asks, which is why it is `reachedBy` and not a copy of it here.
    const beyond = reachedBy(state, id, command.target, definition.name);
    if (beyond !== null) return beyond;

    const events: GameEvent[] = [];

    // The action economy only exists in combat; outside it there is nothing to
    // spend, exactly as every other feature here finds.
    if (state.combat !== null) {
      const spent = spendFor(state, id, definition.action);
      if (!spent.ok) return spent;
      events.push(spent.value);
    }

    events.push({
      type: 'resource-spent',
      id,
      key: definition.pool,
      amount: drawn,
      ...(stamp === null ? {} : { command: stamp }),
    });

    if (hitPoints > 0) {
      const healed = healCreature(state, command.target, hitPoints);
      if (!healed.ok) return healed;
      events.push(...healed.value);
    }

    // SRD removes *the condition*, not a cause of it — so an ally poisoned twice
    // over is not half-cured. That reading lives in `endConditionsOn`, which a
    // spell that ends a condition reaches too: one removal, two callers.
    events.push(...endConditionsOn(command.target, lift));

    return ok(events);
  });
}

export interface ConferReactionCommand extends CommandIdentity {
  readonly feature: string;
  readonly target: CharacterId;
}

export interface Conferral {
  readonly events: readonly GameEvent[];
  /** What the engine could not check — the half of a sense it does not model. */
  readonly unverified: readonly string[];
}

const NOTHING_CONFERRED: Conferral = { events: [], unverified: [] };

/**
 * Spend a use of a pool to put a Reaction in somebody else's hands.
 *
 * SRD Bardic Inspiration: "As a Bonus Action, you can inspire another creature
 * within 60 feet of yourself who can see or hear you. That creature gains one
 * of your Bardic Inspiration dice ... Once within the next hour when the
 * creature fails a D20 Test, the creature can roll the die and add the number
 * rolled to the d20."
 *
 * **Nothing is handed over.** The use is spent here, on the giver, and what
 * the recipient gains is a sourced grant with a deadline — which is why this
 * command rolls nothing and takes no `Supply`: the die belongs to the moment
 * the recipient uses it, and what is pinned now is which die it is.
 *
 * **"Can see or hear you" is reported, never refused.** Sight is declared
 * between two creatures and hearing is modelled nowhere, so a recipient the
 * log says cannot see the giver may still be able to hear them. Withholding
 * the conferral would be the engine deciding a fact nobody stated; the offer
 * is made and the line comes back in `unverified`, which is the rule
 * `offersForDamage` and `offersForTest` already keep.
 */
export function conferReaction(
  state: GameState,
  id: CharacterId,
  command: ConferReactionCommand,
): Result<Conferral> {
  return once(state, `confer-reaction:${id}`, command, () => NOTHING_CONFERRED, (stamp) => {
    // After the duplicate check, never before it.
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const giver = creatureOf(state, id);
    if (giver === null) return unknownCreature(id);

    const definition = (giver.sheet.conferredReactions ?? []).find(
      (c) => c.feature === command.feature,
    );
    if (definition === undefined) {
      return err('no_such_feature', `${id} has no feature called ${command.feature}`);
    }

    const holder = creatureOf(state, command.target);
    if (holder === null) return unknownCreature(command.target);

    if (definition.excludesSelf === true && command.target === id) {
      return err(
        'not_another_creature',
        `${definition.name} is given to another creature, and ${id} is not another creature`,
      );
    }

    const left = remaining(giver.resources, definition.pool);
    if (left < 1) return err('exhausted', `${definition.name} has no uses left`);

    const beyond = reachedBy(state, id, command.target, definition.name, definition.range);
    if (beyond !== null) return beyond;

    // The recipient is the one who has to notice, so the looker is the
    // recipient — the same rule `ReactionFeature.requiresSight` states about
    // who must see whom.
    const unverified: string[] = [];
    if (definition.requiresSightOrHearing === true && canSee(state, command.target, id) !== true) {
      unverified.push(
        `nobody has said whether ${command.target} can hear ${id}, and ${definition.name} needs them to see or hear; the conferral was made rather than withheld`,
      );
    }

    const events: GameEvent[] = [];

    // The action economy only exists in combat; outside it there is nothing to
    // spend, exactly as every other feature here finds.
    if (state.combat !== null) {
      const spent = spendFor(state, id, definition.action);
      if (!spent.ok) return spent;
      events.push(spent.value);
    }

    events.push({
      type: 'resource-spent',
      id,
      key: definition.pool,
      amount: 1,
      ...(stamp === null ? {} : { command: stamp }),
    });

    const source = conferredSource(definition.feature, id);
    for (const reaction of definition.confers) {
      events.push({
        type: 'reaction-granted',
        id: command.target,
        reaction: { source, from: id, reaction },
      });
    }

    // The hour, filed the way every other grant's deadline is. It is filed
    // once however many Reactions the conferral hung, because `releaseGrants`
    // takes the whole source off at once.
    const timer = schedule(
      events.reduce(applyEvent, state),
      { kind: 'grants', on: command.target, source },
      { kind: 'seconds', seconds: definition.durationSeconds },
    );
    if (!timer.ok) return timer;
    events.push(timer.value);

    return ok({ events, unverified });
  });
}

export interface UseSelfHealCommand extends CommandIdentity {
  readonly feature: string;
}

/**
 * Spend a use of a feature, roll its die, and heal the holder.
 *
 * SRD Second Wind — "As a Bonus Action, you can use it to regain Hit Points
 * equal to 1d10 plus your Fighter level" — and Wholeness of Body, which is the
 * same sentence with the Monk's own die and modifier. Both pools were already
 * declared, sized off the class table and refilling on the right rest, and
 * neither gave back a hit point: Second Wind's note said as much out loud,
 * *"healCreature exists and nothing ties the two together."*
 *
 * **Validate before rolling.** Every refusal here — no such feature, an empty
 * pool, no Bonus Action, a dead Fighter — lands before the die is thrown, so a
 * refused use costs neither the use nor a turn of the generator. Rolling first
 * would let a rejected operation move authoritative state, and a replay would
 * then diverge from the session that produced it.
 *
 * The healing itself goes through `healCreature`, so the cap at the hit point
 * maximum and the rule that lifts unconsciousness from 0 hit points — and only
 * that unconsciousness — are the ones already written rather than a second
 * copy of them.
 */
export function useSelfHeal(
  state: GameState,
  id: CharacterId,
  command: UseSelfHealCommand,
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
): Result<GameEvent[]> {
  return once(state, `self-heal:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const definition = (creature.sheet.selfHeals ?? []).find((s) => s.feature === command.feature);
    if (definition === undefined) {
      return err('no_such_feature', `${id} has no feature called ${command.feature}`);
    }

    if (remaining(creature.resources, definition.pool) < 1) {
      return err('exhausted', `${id} has no uses of ${definition.name} left`);
    }

    // Asked before the die rather than discovered after it: `healCreature`
    // refuses a corpse, and a refusal that arrived after the roll would have
    // spent a die on nothing.
    if (creature.vitals.dead) {
      return err('dead', `${id} is dead; hit points alone will not bring them back`);
    }

    const events: GameEvent[] = [];

    // The action economy only exists in combat; outside it there is nothing to
    // spend, exactly as `resolveCast` and `activateFeature` find.
    if (state.combat !== null) {
      const spent = spendFor(state, id, definition.action);
      if (!spent.ok) return spent;
      events.push(spent.value);
    }

    // **The stamp goes on the use, not on the healing** — `useRecovery`'s
    // shape, one command along, and for a reason that only arrived with a rule
    // that can forbid healing. A batch's command id is recorded by whichever
    // event carries it, and the `healed` event is the one event of this batch
    // that a `prevented` rule can take away: a Fighter under a Chill Touch
    // spent the use, healed nothing, recorded no id, and was free to spend the
    // use again. The use is the thing that always happens, so the stamp
    // belongs on it.
    events.push({
      type: 'resource-spent',
      id,
      key: definition.pool,
      amount: 1,
      ...(stamp === null ? {} : { command: stamp }),
    });

    // **And the feet a later feature hands over for using it.** SRD Tactical
    // Shift: "Whenever you activate your Second Wind **with a Bonus Action**,
    // you can move up to half your Speed without provoking Opportunity
    // Attacks." Both halves of that condition are checked here: the slot the
    // use costs, and whether this character has the feature at all — which
    // creation answered by compiling the rider or not.
    //
    // **Before the healing and after the use**, because it is part of what the
    // use buys rather than part of what the dice say: a heal prevented by a
    // Chill Touch still hands the feet over, which is what the sentence says.
    // Outside combat there is no turn to hand them to, and nothing is written.
    const hands = definition.handsMove;
    if (hands !== undefined && definition.action === 'bonus-action' && state.combat !== null) {
      // Half of the Speed the feature was used at, floored — one number,
      // pinned onto the event, so a Speed that changes later moves no foot of
      // what has already been handed over.
      const feet = Math.floor(speedOf(state, id) / 2);
      if (feet > 0) {
        events.push({
          type: 'movement-granted',
          id,
          source: featureSource(hands.feature),
          feet,
        });
      }
    }

    const healed = rollAndHeal(state, id, definition, definition.name, supply);
    if (!healed.ok) return healed;
    events.push(...healed.value);

    return ok(events);
  });
}

/**
 * Roll a feature's healing die, add what its sentence adds, and heal.
 *
 * Shared by the two commands that heal from a feature, so the SRD floor and
 * the cap at the hit point maximum live in one place. The caller has already
 * refused a dead creature — this rolls, so everything that could say no must
 * have said it.
 *
 * **It carries no command stamp, and both callers put theirs on the use.** A
 * rule standing in front of healing can take the `healed` event away entirely,
 * and a batch whose only stamped event is the one that may not be emitted
 * records no id at all — so the stamp belongs on the `resource-spent` that
 * always happens. `useSelfHeal` says it at the call site; `useRecovery` has
 * done it that way since it was written.
 */
function rollAndHeal(
  state: GameState,
  id: CharacterId,
  heal: HealAmount,
  name: string,
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
): Result<GameEvent[]> {
  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);

  const issuedBefore = supply.issuer.count;
  // **And what this creature's own running effects say about the dice.** SRD
  // Beacon of Hope maximises "any healing", and a Second Wind spent by a
  // Fighter standing in one is healing the phrase reaches as squarely as a
  // Cure Wounds does — the rule is the recipient's, not the caster's, and here
  // the two are the same creature.
  const rolled = rollRecorded(
    supply.issuer,
    supply.rng,
    heal.dice,
    healingRuleOf(creature.healingRules) === 'maximised'
      ? [maximisedHealing('the maximum possible')]
      : [],
  );
  if (!rolled.ok) return rolled;

  // The abilities as they stand. `selfHealAddend` says the ability case is
  // derived "so the number is the one on the sheet when the die is thrown",
  // and an item that sets a score is exactly what that sentence was written to
  // outlive — but only the command holds the state to ask.
  const sheet = sheetAsItStands(state, id) ?? creature.sheet;
  const addend = selfHealAddend(heal, sheet.abilities);
  // SRD Wholeness of Body: "(minimum of 1 Hit Point regained)". Second Wind
  // and Uncanny Metabolism name no floor, and neither could reach one.
  const amount = Math.max(heal.minimum ?? 1, rolled.value.total + addend.amount);

  const done = healCreature(state, id, amount);
  if (!done.ok) return done;

  return ok([
    {
      type: 'roll-recorded',
      who: id,
      label: `${name} (${heal.dice})`,
      natural: rolled.value.total,
      total: rolled.value.total + addend.amount,
      contributions: [{ source: addend.label, amount: addend.amount }],
      outcome: `${amount} hit points`,
    },
    { type: 'rolls-issued', count: supply.issuer.count - issuedBefore, rng: supply.rng.snapshot() },
    ...done.value,
  ]);
}

export interface UseRecoveryCommand extends CommandIdentity {
  readonly feature: string;
}

/**
 * Use a feature that gives another pool's uses back.
 *
 * SRD Sorcerous Restoration and Magical Cunning, which are the same sentence
 * with every number changed. `restore()` in `resources.ts` has been written,
 * correct and reached by no command since the day pools landed — the eighth
 * time in this repo that a rule turned out to be a pure function nothing
 * called.
 *
 * **How much comes back is derived, never supplied.** The command names a
 * feature; the cap comes from the feature's own sentence, what is actually
 * expended comes from the pool, and the smaller of the two is what is given.
 * There is no field here for an amount, for the same reason there is none on
 * an effect check for a result.
 *
 * **Nothing expended is a refusal, not a silent success.** "You regain
 * expended Sorcery Points" has nothing to do when none are, and spending a
 * once-a-day feature for nothing is the kind of quiet loss a player discovers
 * two rooms later. A refusal costs neither the use nor anything else.
 */
export function useRecovery(
  state: GameState,
  id: CharacterId,
  command: UseRecoveryCommand,
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
): Result<GameEvent[]> {
  return once(state, `recovery:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const definition = (creature.sheet.recoveries ?? []).find((r) => r.feature === command.feature);
    if (definition === undefined) {
      return err('no_such_feature', `${id} has no feature called ${command.feature}`);
    }

    // SRD Sorcerous Restoration happens "when you finish a Short Rest". The
    // finest grain the engine has for "when" out of combat is the clock, which
    // is the same window a Reaction to damage uses: the rest earned a Short
    // Rest's benefits and nothing has happened since.
    if (definition.moment === 'short-rest' && creature.lastShortRestAt !== state.elapsed) {
      return err(
        'not_the_moment',
        `${definition.name} happens when a Short Rest finishes, and ${id} has not just finished one`,
      );
    }

    // SRD Uncanny Metabolism and Persistent Rage happen "when you roll
    // Initiative", which is before anybody acts. The closest the engine holds is
    // the first turn of the fight — `turnsTaken` counts turns *finished*, so it
    // is still 0 throughout it — and that window is the same for everyone in the
    // order rather than depending on where in it the holder sits. A creature who
    // is fourth in Initiative takes it during the first combatant's turn, which
    // is when the SRD says it happens.
    if (definition.moment === 'initiative' && (state.combat === null || state.combat.turnsTaken > 0)) {
      return err(
        'not_the_moment',
        `${definition.name} happens when Initiative is rolled, and that moment has passed`,
      );
    }

    if (remaining(creature.resources, definition.pool) < 1) {
      return err('exhausted', `${id} has no uses of ${definition.name} left`);
    }

    const target = creature.resources.pools[definition.restores];
    if (target === undefined) {
      return err('unknown_pool', `${id} has no ${definition.restores} to regain`);
    }
    // One check, two causes, because a mutation proved they were two checks and
    // one cause: a separate `spent === 0` guard above this one was unreachable,
    // since nothing expended makes the amount zero and lands here anyway. Which
    // cause it was still belongs in the message.
    const amount = Math.min(recoveryCap(definition, target.max), target.spent);
    if (amount < 1) {
      return err(
        'nothing_to_regain',
        target.spent === 0
          ? `${id} has spent no ${target.label}`
          : `${definition.name} gives back nothing at level ${definition.classLevel}`,
      );
    }

    // SRD Uncanny Metabolism heals "when you do so" — riding on the recovery,
    // with no cost of its own. A creature who cannot be healed still recovers:
    // the sentence gives the points first.
    const events: GameEvent[] = [
      { type: 'resource-spent', id, key: definition.pool, amount: 1 },
      {
        type: 'resource-regained',
        id,
        key: definition.restores,
        amount,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ];

    if (definition.heal !== undefined && !creature.vitals.dead) {
      const healed = rollAndHeal(state, id, definition.heal, definition.name, supply);
      if (!healed.ok) return healed;
      events.push(...healed.value);
    }

    return ok(events);
  });
}

export interface EndFeatureCommand extends CommandIdentity {
  readonly feature: string;
}

/** Switch a feature off deliberately. Costs nothing and refunds nothing. */
export function endFeature(
  state: GameState,
  id: CharacterId,
  command: EndFeatureCommand,
): Result<GameEvent[]> {
  return once(state, `end-feature:${id}`, command, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);
    if (!creature.activeFeatures.includes(command.feature)) {
      return err('not_active', `${id} is not in ${command.feature}`);
    }

    return ok([
      {
        type: 'feature-ended',
        id,
        feature: command.feature,
        reason: 'dismissed',
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

export interface ExtendFeatureCommand extends CommandIdentity {
  readonly feature: string;
  /**
   * Which of the SRD's ways of extending it happened.
   *
   * SRD Rage offers three: "Make an attack roll against an enemy. Force an
   * enemy to make a saving throw. Take a Bonus Action to extend your Rage."
   * Only the third costs anything, so which one it was changes what is spent —
   * and the engine cannot see the first two for itself, because nothing routes
   * a weapon attack through a command yet. The caller says which, and the log
   * records it.
   */
  readonly by: 'attack' | 'forced-save' | 'bonus-action';
}

/**
 * Push a running feature's deadline out by another round.
 *
 * The timer is *replaced* rather than added to. Timers are keyed by what they
 * end, so re-scheduling overwrites — which is what stops a stale deadline
 * ending a Rage that has already been extended past it.
 */
export function extendFeature(
  state: GameState,
  id: CharacterId,
  command: ExtendFeatureCommand,
): Result<GameEvent[]> {
  return once(state, `extend:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.** Its four
    // sibling feature commands have always asked; this one spends a Bonus Action
    // and a pool use and did not, which is the hole the sweep in
    // `invariants.test.ts` now makes impossible to reintroduce quietly.
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);
    if (!creature.activeFeatures.includes(command.feature)) {
      return err('not_active', `${id} is not in ${command.feature}`);
    }

    const definition = (creature.sheet.activated ?? []).find((a) => a.feature === command.feature);
    if (definition === undefined) {
      return err('no_such_feature', `${id} has no feature called ${command.feature}`);
    }

    // A span the book prints is not maintained: SRD Innate Sorcery runs "for 1
    // minute" and Large Form "for 10 minutes" whatever the holder does, so
    // there is no deadline to push and nothing to spend on pushing it.
    if (typeof definition.lasts === 'object') {
      return err(
        'not_extendable',
        definition.lasts.kind === 'seconds'
          ? `${definition.name} runs for ${describeElapsed(definition.lasts.seconds)} and is not maintained round by round`
          : // SRD Pact of the Blade prints no deadline at all, so there is
            // nothing to push out: the same refusal for the same reason, and
            // the one thing a caller could be told that is true.
            `${definition.name} runs until something ends it, so there is no deadline to maintain`,
      );
    }

    // SRD Rage: "You can maintain a Rage for up to 10 minutes." The ceiling
    // was pinned onto this activation when it began and is read back off it —
    // **before anything is spent**, so a refused extension costs the Bonus
    // Action nothing. Nothing ends here: the feature's own deadline is simply
    // not pushed out again, so it lapses at the boundary it was already
    // running to, which is what "can be maintained for up to" says.
    const cap = maintenanceCap(state, id, definition, true);
    if (cap !== null && state.elapsed >= cap.until) {
      return err(
        'cap_reached',
        `${definition.name} may be maintained for ${describeElapsed(cap.seconds)} — the cap ` +
          `pinned onto this activation from ${id}'s sheet — and it began ` +
          `${describeElapsed(state.elapsed - (cap.until - cap.seconds))} ago`,
      );
    }

    const events: GameEvent[] = [];
    if (command.by === 'bonus-action' && state.combat !== null) {
      const spent = spendFor(state, id, 'bonus-action');
      if (!spent.ok) return spent;
      events.push(spent.value);
    }

    const timer = featureTimer(state, id, definition, true);
    if (!timer.ok) return timer;
    // Outside combat there is no timer and no Bonus Action, so the batch is
    // empty — and an empty batch is idempotent without needing a stamp at all.
    if (timer.value !== null) {
      events.push(
        stamp === null ? timer.value : ({ ...timer.value, command: stamp } as GameEvent),
      );
    }

    return ok(events);
  });
}

/**
 * The ceiling this activation of a feature runs under, or null for none.
 *
 * Two readings, and {@link maintaining} is what decides between them, because
 * the state cannot:
 *
 * - **Maintaining** an activation that is already running: the ceiling is
 *   carried off its own timer, unchanged. A ceiling re-derived at every
 *   extension is pushed out by the act of approaching it, and reading it back
 *   out of the log is what keeps a Rage bounded by the number it was written
 *   with rather than by this year's book.
 * - **Beginning** one: the span on the holder's sheet, where creation pinned
 *   it, added to the clock now. Still not a catalogue — the sheet folded out
 *   of the log like everything else.
 *
 * **The flag is not an optimisation and the state cannot stand in for it.**
 * `feature-ended` drops the feature and leaves its deadline to lapse on its
 * own, so for up to a round there is a timer standing over a Rage that has
 * already been dismissed. A second Rage entered in that window would inherit
 * the first one's ceiling and get whatever was left of somebody else's ten
 * minutes, which is why the caller says which of the two it is doing.
 *
 * A feature whose record carries no span is bounded by nothing either way,
 * which is every feature in the SRD but one.
 */
function maintenanceCap(
  state: GameState,
  id: CharacterId,
  definition: ActivatedFeature,
  maintaining: boolean,
): MaintenanceCap | null {
  if (maintaining) {
    const running = state.timers[timerKey({ kind: 'feature', on: id, feature: definition.feature })];
    if (running?.target.kind === 'feature' && running.target.cap !== undefined) {
      return running.target.cap;
    }
  }
  if (definition.capSeconds === undefined) return null;
  return { seconds: definition.capSeconds, until: state.elapsed + definition.capSeconds };
}

/**
 * The moment a hung grant runs to, in the vocabulary the engine already has.
 *
 * A ternary rather than a `switch`, and safely: the tail hands `lasts` to
 * `turnAnchored`, which takes a {@link TurnAnchor} — so a member added to
 * {@link HungSpan} that is not one fails to compile here rather than being
 * silently given somebody's next turn.
 */
const hungSpan = (lasts: HungSpan, holder: CharacterId): Duration =>
  lasts === 'end-of-current-turn' ? endOfCurrentTurn : turnAnchored(lasts, holder);

/**
 * What a use of a feature hangs on its holder, and the deadline on each.
 *
 * **The stored grants an activation emits, as against the derived ones running
 * it implies.** `whileActive` compiles to standing effects requiring
 * `feature-active` and is re-read from the world every time anybody asks;
 * these are written into the log where the action is paid for, because a
 * derived grant can never be *spent* — `consumedRollModifiers` reads
 * `CreatureState.rollModifiers`. SRD Steady Aim's "Advantage on your next
 * attack roll" is the sentence that needs the stored half.
 *
 * **One source per grant and one timer per source.** Everything one source
 * granted ends together, whether the ending arrives as a deadline or as the
 * roll that spent it, so two clauses of one sentence with two different
 * lifetimes are two sources — see {@link hungSource}.
 *
 * `schedule` reads the clock and the turn order and nothing a grant moves, so
 * the grants are not folded in on the way: what each of them is timed against
 * is the same world the activation was paid for in. A span that cannot be
 * resolved — a turn boundary with no combat to have one — refuses the whole
 * activation, which is right: nothing is spent, and a grant nothing could end
 * would run for ever.
 */
/**
 * The object this use imbues, or null where the feature imbues none.
 *
 * SRD Sacred Weapon: "imbue **one Melee weapon that you are holding**". Four
 * questions and the book asks all four — does this feature imbue anything, is
 * the thing named a weapon, is it of the kind the sentence names, and is the
 * holder carrying it — and every one of them is answered **before** the
 * Channel Divinity, the action or the deadline, which is the same
 * validate-before-spending discipline `resolveSpell` keeps for the identical
 * clause on Shillelagh and Magic Weapon.
 *
 * **"Holding" is carrying, which is as close as this engine gets.** An
 * inventory says what a creature has; nothing says which hand a thing is in,
 * `equipped` is per kind of thing rather than per hand, and `resolveAttack`
 * gates a swing on the same question. So the check here and the fold's ending
 * below read the same list, and a feature cannot be imbued onto something its
 * holder could not swing.
 *
 * The refusals are the three `resolveSpell` already writes for the same
 * sentence, plus one the narrowing needs: a spell names its weapons by id and
 * refuses `weapon_not_named`, and a feature names a *kind* of weapon, which is
 * `weapon_not_of_kind`.
 */
function imbuedWeapon(
  state: GameState,
  id: CharacterId,
  definition: ActivatedFeature,
  named: string | undefined,
  content: Content,
): Result<string | null> {
  const imbues = definition.imbuesWeapon;
  if (imbues === undefined) {
    if (named === undefined) return ok(null);
    return err(
      'no_weapon_clause',
      `${definition.name} does nothing to a weapon; which one is not a fact it asks for`,
    );
  }
  if (named === undefined) {
    return err(
      'weapon_required',
      `${definition.name} imbues one weapon and the engine will not choose which; name it`,
    );
  }

  const item = content.item(named);
  const weapon = item?.weapon;
  if (item === null || weapon === undefined || weapon === null) {
    return err('unknown_weapon', `${named} is not a weapon the SRD lists`);
  }
  if (imbues.weapons !== undefined && !weaponNarrowingHolds(imbues.weapons, { weapon })) {
    return err(
      'weapon_not_of_kind',
      `${definition.name} does not imbue a ${weapon.name}`,
    );
  }
  // **Unless the use is what makes it.** SRD Pact of the Blade conjures the
  // weapon it bonds, so there is nothing to be holding: what the narrowing
  // above has already refused is the only question the book asks of the name,
  // and the line appears in the same batch as the rider.
  if (definition.conjuresWeapon === true) {
    // The one rule a conjuring keeps that an imbuing does not, in the words
    // `checkContent` keeps it for a spell: a thing that lasts exactly as long
    // as the bond has nothing to remember, and a conjured line is a stack
    // rather than a labelled copy — so a weapon with a charge pool of its own
    // would arrive with a pool nobody declared and lose it the moment the
    // bond ended. Refused here because a feature names its weapon at the use
    // and the catalogue is only reachable from a command.
    if (itemChargePool(item) !== null) {
      return err(
        'conjured_item_has_charges',
        `${named} keeps charges of its own, and a weapon that lasts only as long as ${definition.name} has nothing to remember`,
      );
    }
    // **And the book's own narrowing, which the kind alone cannot say.** SRD
    // Pact of the Blade conjures "a Simple or Martial Melee weapon" — a row of
    // the Weapons table — and reaches a *magic* weapon only through the other
    // half of its sentence, "create a bond with a magic weapon you touch",
    // which prints two exclusions this engine cannot check. A conjuring that
    // admitted a Frost Brand would be handing over the half that is not
    // offered, for nothing, at will.
    //
    // **"Magic" is read as what the catalogue actually marks**, which is the
    // three things `docs/design/characters-and-equipment.md` says a magic item
    // is a `CatalogueItem` that has grown: grants of its own, an attunement
    // requirement, and a charge pool. There is no `magical` flag to read, and
    // this is the honest reading of its absence rather than a guess: every one
    // of the SRD's twenty-eight Melee Weapons table rows carries none of the
    // three, and every magic weapon built on one of those rows carries at
    // least one.
    if ((item.grants ?? []).length > 0 || item.attunement !== undefined) {
      return err(
        'weapon_is_magical',
        `${named} is a magic item, and ${definition.name} conjures a weapon off the Weapons table; bonding a magic weapon is the half of the sentence this feature does not offer`,
      );
    }
    return ok(named);
  }
  if (quantityOf(state, id, named) < 1) {
    return err('weapon_not_held', `${id} has no ${weapon.name} for ${definition.name} to imbue`);
  }
  return ok(named);
}

function hangGrants(
  state: GameState,
  id: CharacterId,
  definition: ActivatedFeature,
): Result<readonly GameEvent[]> {
  const events: GameEvent[] = [];

  for (const hung of definition.hangs ?? []) {
    const source = hungSource(definition.feature, hung.kind);
    const granted: GameEvent =
      hung.kind === 'roll-mode'
        ? { type: 'roll-modifier-granted', id, modifier: { source, modifier: hung.modifier } }
        : {
            type: 'speed-modifier-granted',
            id,
            modifier: {
              source,
              change: hung.change,
              ...(hung.feet === undefined ? {} : { feet: hung.feet }),
            },
          };

    const timer = schedule(state, { kind: 'grants', on: id, source }, hungSpan(hung.lasts, id));
    if (!timer.ok) return timer;
    events.push(granted, timer.value);
  }

  return ok(events);
}

/**
 * The deadline one activation runs to.
 *
 * @param maintaining whether this is an activation *continuing* rather than
 * one beginning, which is the whole of what {@link maintenanceCap} cannot
 * read off the state. Default false, so a caller with no cap to think about —
 * Dodge, Ready — says nothing and gets the reading that cannot go wrong.
 */
export function featureTimer(
  state: GameState,
  id: CharacterId,
  definition: ActivatedFeature,
  maintaining = false,
): Result<GameEvent | null> {
  // A printed span runs on the clock, in and out of a fight alike — the same
  // clock a form's hours run on — and carries no cap: the span is the cap. The
  // `feature` target is what the expiry pass drops from `activeFeatures`.
  if (typeof definition.lasts === 'object') {
    // A feature the book gives no deadline — SRD Pact of the Blade — is
    // scheduled against nothing at all. The endings it does print are the
    // second use, the `endsOn` list and whatever takes the imbued weapon away,
    // and every one of them is already a door out of `activeFeatures`.
    if (definition.lasts.kind === 'until-ended') return ok(null);
    return schedule(
      state,
      { kind: 'feature', on: id, feature: definition.feature },
      { kind: 'seconds', seconds: definition.lasts.seconds },
    );
  }

  // Outside combat there are no turns, so a turn-anchored deadline has no
  // meaning — `resolveDuration` refuses it rather than inventing seconds, and
  // the feature simply runs until something ends it.
  if (state.combat === null) return ok(null);

  // The ceiling rides on the target rather than beside it, so replacing the
  // deadline carries it across: `timerKey` reads only the identity fields, and
  // this is the only record the engine keeps of one activation.
  const cap = maintenanceCap(state, id, definition, maintaining);

  const timer = schedule(
    state,
    {
      kind: 'feature',
      on: id,
      feature: definition.feature,
      ...(cap === null ? {} : { cap }),
    },
    // The feature's own anchor, carried across rather than branched on: a
    // mapping from each member of the pair to its constructor is what
    // `turnAnchored` is, and one written here would be a third place a third
    // member has to be remembered.
    turnAnchored(definition.lasts, id),
  );
  if (!timer.ok) return timer;
  return ok(timer.value);
}

/** What the order left behind: the log, and what the swing could not check. */
export interface SummonsAttackOutcome {
  readonly events: readonly GameEvent[];
  /** What the familiar's own swing could not check — `resolveAttack`'s. */
  readonly unverified: readonly string[];
  /** A retry of an order already given, which did nothing the first did not. */
  readonly duplicate?: true;
}

export interface SummonsAttackCommand extends CommandIdentity {
  /** The feature whose sentence this is — SRD Pact of the Chain. */
  readonly feature: string;
  /** The creature that is to swing: SRD's "your familiar". */
  readonly summons: CharacterId;
  readonly target: CharacterId;
  /** The weapon it swings with, by catalogue id, or null for an Unarmed Strike. */
  readonly weapon?: string | null;
  /**
   * A line the summons' own stat block prints, by its printed name — an Imp's
   * Sting. Naming neither this nor a weapon leaves the choice to
   * `reactionSwing`, which takes the block's best printed melee line.
   */
  readonly attack?: string;
}

/**
 * Give up one of your own swings so that a creature of yours may take one.
 *
 * SRD Pact of the Chain: "Additionally, when you take the Attack action, you
 * can forgo one of your own attacks to allow your familiar to make one attack
 * of its own with its Reaction."
 *
 * **Two economies, and the command's whole job is to charge both of them
 * before anybody swings.** The holder gives up one attack of an Attack action
 * they have already taken — {@link spendOneAttack}, the price SRD Breath Weapon
 * prints — and the summons gives up its Reaction. Either refusal leaves both
 * unspent, which is the validate-before-rolling rule this file keeps
 * everywhere.
 *
 * **The swing is the ordinary one.** `resolveAttack` with `free: true`, exactly
 * as an Opportunity Attack is, so the familiar's printed line, its reach, the
 * target's cover and every defence on either side apply without a word of it
 * being written again here. No command id is handed inward: this command owns
 * the guard, which is the split `takeOpportunityAttack` already makes.
 *
 * **And this is the sentence that lets a familiar attack at all.** SRD Find
 * Familiar prints "A familiar can't attack", which `summonCreature` stores as
 * an `action-rule` forbidding the Attack action and the Opportunity Attack.
 * The Reaction spent here names neither — `Spend.as` is left off on purpose —
 * because the Pact's own sentence is the permission that overrides the spell's
 * refusal, and a swing bought by the Pact is neither of the two things the
 * familiar was forbidden. What the rule still refuses is everything else: the
 * familiar cannot take the Attack action on its own turn, and it cannot answer
 * a provocation.
 */
export function orderSummonsAttack(
  state: GameState,
  id: CharacterId,
  command: SummonsAttackCommand,
  supply: Supply,
): Result<SummonsAttackOutcome> {
  return once(
    state,
    `summons-attack:${id}`,
    command,
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id);

      const sheet = sheetAsItStands(state, id) ?? creature.sheet;
      const licence = (sheet.forgoneAttacks ?? []).find((one) => one.feature === command.feature);
      if (licence === undefined) {
        return err('no_such_feature', `${id} has no feature called ${command.feature}`);
      }

      const summons = creatureOf(state, command.summons);
      if (summons === null) return unknownCreature(command.summons);
      // SRD's "**your** familiar", which is the creature this caster keeps from
      // the spell the feature names. A creature somebody else summoned, or one
      // this caster keeps from another spell, is not what the sentence is
      // about — and neither is a creature nobody summoned at all.
      const bond = summons.summonedBy;
      if (bond == null || bond.by !== id || bond.kept?.spell !== licence.from) {
        return err(
          'not_your_summons',
          `${licence.name} lets ${id} give up an attack for the familiar they summoned, and ${command.summons} is not one`,
        );
      }

      // Both prices, in the order the sentence prints them and both before any
      // die: the swing the holder forgoes, then the Reaction the familiar
      // spends. Each refusal leaves the other unspent.
      //
      // **"When you take the Attack action" is read as the taking**, which is
      // `spendAttack`'s own two branches and is why this does not go through
      // `spendOneAttack` beside it. A holder who has already swung spends one
      // of what the action has left; a holder who has not spends the Action
      // and the first of its attacks. The second branch is the one that
      // matters here and it is the book: a Warlock 5 makes **one** attack in
      // an Attack action, so a rule that asked for an attack left over after
      // the action was taken would be a sentence no Warlock could ever use.
      // SRD Breath Weapon prints the same price and `spendOneAttack` reads it
      // the stricter way; the two are recorded as disagreeing rather than
      // quietly reconciled here, because that reading is another feature's.
      const combat = state.combat;
      if (combat === null) {
        return err(
          'not_in_combat',
          `${licence.name} gives up one of the attacks of an Attack action, and there is no action economy outside combat to take one in`,
        );
      }
      const forgone = spendAttack(
        combat,
        id,
        // **No printed lines, and that is a fact about who holds this rather
        // than a shortcut.** `attacksInAction`'s third argument narrows a
        // *stat block's* gated Multiattack branch, and a feature compiled onto
        // a character's sheet has no Multiattack to gate: `multiattackOf`
        // answers null and the list is never read. Written as the empty list
        // rather than threaded from the turn's ledger because there is nothing
        // there to thread, and a reader should be told so.
        attacksInAction(sheet, creature.heads, []),
        creature.conditions,
        { rules: actionRulesOn(state, id) },
      );
      if (!forgone.ok) return forgone;
      const reaction = spendReaction(combat, command.summons, summons.conditions, {
        rules: actionRulesOn(state, command.summons),
      });
      if (!reaction.ok) return reaction;

      const events: GameEvent[] = [
        // The swing's own event, for `spendOneAttack`'s reason: `attack-made`
        // is what the budget arithmetic hangs on, and a second event with the
        // same body would be a second place for the two to disagree.
        { type: 'attack-made', id },
        { type: 'reaction-spent', id: command.summons },
      ];
      const after = events.reduce(applyEvent, state);
      const swing = resolveAttack(
        after,
        command.summons,
        {
          target: command.target,
          ...reactionSwing(sheetAsItStands(after, command.summons) ?? summons.sheet, command),
          // The Reaction above is what this costs; it is not the Attack action,
          // and the attack the holder gave up was the holder's.
          free: true,
        },
        supply,
      );
      if (!swing.ok) return swing;

      return ok({
        events: [
          ...events,
          ...swing.value.events,
          {
            type: 'feature-used',
            id,
            feature: command.feature,
            turn: combat.turnsTaken,
            ...(stamp === null ? {} : { command: stamp }),
          },
        ],
        unverified: swing.value.unverified,
      });
    },
  );
}

export interface UsePoolOptionCommand extends CommandIdentity {
  /** The feature whose pool is being spent — SRD's Channel Divinity. */
  readonly feature: string;
  /** Which of the things a use buys — SRD's "Turn Undead". */
  readonly option: string;
  /**
   * Who it is aimed at, for an option that names a creature rather than
   * filling an area. Absent is the holder themselves, which is the only target
   * an option with no reach at all can have.
   */
  readonly target?: CharacterId;
  /**
   * Which of the shapes the option offers this use takes — SRD Breath
   * Weapon's "a 15-foot Cone or a 30-foot Line ... (choose the shape each
   * time)".
   *
   * Named by the area's own kind, which is what distinguishes the two the SRD
   * prints. Required for an option that offers a choice and refused for one
   * that prints a single area, exactly as {@link damageType} is: the engine
   * will not pick between two things the book gives its holder.
   */
  readonly shape?: string;
  /**
   * Which way a Cone, Cube or Line points.
   *
   * The field a casting's own area takes, on the one host that can now fill a
   * directional template without a spell behind it. Every area an option
   * prints starts at its holder — SRD writes no option centred anywhere else —
   * so there is no `at` beside this: what a template needs is the direction
   * and nothing more.
   */
  readonly towards?: Point;
  /** Which of the damage types the option prints, where it prints a choice. */
  readonly damageType?: string;
  /**
   * How the hit points a distributing option mints are divided — SRD Preserve
   * Life's "Choose Bloodied creatures within 30 feet of yourself (which can
   * include you), and divide those Hit Points among them."
   *
   * **The division is the caller's, exactly as the slot a trade burns is.**
   * The engine works out the budget, measures the reach and holds every share
   * to the cap; which creature gets how much is a decision the SRD gives the
   * Cleric and nothing here could make for them. It is not a number the caller
   * produced about a *roll* — no die is thrown by this option at all — and the
   * total is refused rather than trusted.
   */
  readonly among?: readonly HitPointShare[];
  /**
   * Where a `teleport` effect on this option puts its holder — SRD Cloud's
   * Jaunt: "As a Bonus Action, you magically teleport up to 30 feet to an
   * unoccupied space you can see."
   *
   * **The holder's decision, stated at the use and never derived**, which is
   * the shape `CastSpellRequest.teleportTo` already takes for the same effect:
   * the engine checks the distance, the space and the sight, and which space
   * is a choice the book gives its holder. Required for an option that
   * teleports and refused for one that does not, exactly as {@link damageType}
   * is — a destination quietly ignored is a caller who thinks they said
   * something.
   */
  readonly teleportTo?: Placement;
}

/** One creature's share of a distributing option's hit points. */
export interface HitPointShare {
  readonly target: CharacterId;
  readonly hitPoints: number;
}

/** What a use of a pool option did. */
export interface PoolOptionUse {
  readonly events: readonly GameEvent[];
  /** What it did, target by target — a `SpellResolution`'s half that applies. */
  readonly outcomes: readonly SpellTargetOutcome[];
  /** What the use could not check. */
  readonly unverified: readonly string[];
}

const NOTHING_USED: PoolOptionUse = { events: [], outcomes: [], unverified: [] };

/**
 * Spend a use of a feature's pool on one of the things that use buys.
 *
 * SRD Channel Divinity is the shape: one pool, a menu, and each option a
 * different effect list at the same price. Turn Undead makes every Undead in
 * thirty feet roll a Wisdom save and leaves those that fail Frightened and
 * Incapacitated for a minute; Divine Spark heals a creature or hurts it. The
 * pool was declared, sized and recovered correctly from the day pools landed,
 * and what a use *bought* was executed by nothing.
 *
 * **The third origin, and the only thing it changes is where the numbers come
 * from.** `runEffects` is the same loop a casting and a potion go through — a
 * feature with a resolver of its own would be a second place for every rules
 * fix to be missed — and what a feature supplies that an item cannot is a save
 * DC derived from the holder's own sheet. An item prints "(save DC 15)" and a
 * feature says "your spell save DC", which is the whole of the fork.
 *
 * **There is no casting.** What this hangs is filed under `feature:<id>`,
 * which `castingIdOf` answers null for, so `releaseCasting`, `ongoingSpellsOn`
 * and the Dispel resolver pass over it by construction. What ends it is the
 * timer filed below, whose deadline is the option's own printed span.
 *
 * **Every refusal is reached before anything is spent.** The creature, the
 * feature, the option, the damage type the option asks the caller to name, the
 * targets, the reach and the pool are all settled before the action goes and
 * before the first die — so a Turn Undead with an empty pool costs its Cleric
 * nothing at all.
 */
export function usePoolOption(
  state: GameState,
  id: CharacterId,
  command: UsePoolOptionCommand,
  supply: Supply,
): Result<PoolOptionUse> {
  return once(state, `pool-option:${id}`, command, () => NOTHING_USED, (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose
    // start has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const offered = (creature.sheet.poolOptions ?? []).filter(
      (one) => one.feature === command.feature,
    );
    if (offered.length === 0) {
      return err('no_such_feature', `${id} has no feature called ${command.feature}`);
    }
    const option = offered.find((one) => one.option === command.option);
    if (option === undefined) {
      return err(
        'no_such_option',
        `${command.feature} buys ${offered.map((one) => one.option).join(', ')}, not ${command.option}`,
      );
    }

    // A form that mints hit points and divides them is the one purchase on a
    // menu that resolves no effects at all, so it settles here and takes the
    // rest of this command's discipline with it: everything checked, then the
    // action, then the use, then what it bought.
    if (option.distributes !== undefined) {
      return divideHitPoints(
        state,
        id,
        option,
        option.distributes,
        remaining(creature.resources, option.pool),
        command,
        stamp,
      );
    }
    if (command.among !== undefined) {
      return err(
        'nothing_to_divide',
        `${option.name} mints no hit points, so there is nothing for shares to divide`,
      );
    }

    // **Stated or refused, never defaulted**, which is the rule a spell that
    // prints two damage types already keeps: picking Radiant because most
    // Clerics are good would be the engine answering a question the SRD asked
    // about the caster.
    const typed = statedTypeFor(option, command.damageType);
    if (!typed.ok) return typed;

    // Where a teleporting option goes, under the same rule and the same two
    // refusals `declaredFacts` states for a casting: required where the option
    // teleports, refused where it does not.
    const goes = teleportIn(typed.value);
    if (goes === null) {
      if (command.teleportTo !== undefined) {
        return err(
          'no_teleport_clause',
          `${option.name} teleports nobody; where they would go is not a fact it asks for`,
        );
      }
    } else if (command.teleportTo === undefined) {
      return err(
        'destination_required',
        `${option.name} teleports its holder and the engine will not choose where; name the space`,
      );
    }

    // **The shape, settled before the targets, because it is what finds
    // them.** SRD Breath Weapon prints two templates and gives the choice to
    // the breather; an option that prints one takes no answer at all.
    const shaped = shapeFor(option, command.shape);
    if (!shaped.ok) return shaped;

    const found = targetsOf(state, id, option, shaped.value, command);
    if (!found.ok) return found;
    const targets = found.value;

    // **The teleport's pre-flight, run before anything is spent.** It is pure,
    // rolls nothing and changes nothing, so asking twice costs a caller
    // nothing and asking once would cost them the Bonus Action and the use:
    // the distance, the occupied space, the scene's extent and the declared
    // sight are all reachable here, and `resolveTeleportEffect` throws rather
    // than refuses if it arrives with no destination. The same move
    // `castOrRelease` makes for the same effect.
    if (goes !== null && command.teleportTo !== undefined) {
      for (const target of targets) {
        const reachable = teleportTo(state, target, {
          placement: command.teleportTo,
          within: goes.feet,
          ...(goes.requiresSight === undefined ? {} : { requiresSight: goes.requiresSight }),
        });
        if (!reachable.ok) return reachable;
      }
    }

    if (remaining(creature.resources, option.pool) < 1) {
      return err('exhausted', `${id} has no uses of ${option.featureName} left`);
    }

    // — from here it costs something ——————————————————————————————————————
    const events: GameEvent[] = [];

    // The action economy only exists in combat; outside it there is nothing to
    // spend, exactly as every other feature here finds.
    //
    // **Except a swing of an Attack action, which exists nowhere else.** SRD
    // Breath Weapon replaces one of the attacks of an Attack action already
    // taken, and outside combat there is no Attack action to have taken — so
    // that price is refused rather than waived, which is the one place this
    // command's "outside combat, nothing" reading does not hold. A price that
    // vanished would let a Dragonborn breathe once a round for ever between
    // fights.
    const priced = spendOptionCost(state, id, option);
    if (!priced.ok) return priced;
    if (priced.value !== null) events.push(priced.value);

    events.push({
      type: 'resource-spent',
      id,
      key: option.pool,
      amount: 1,
      ...(stamp === null ? {} : { command: stamp }),
    });

    // **The numbers are the holder's, derived at the moment of use.** SRD
    // writes "your spell save DC" on the feature and the feature prints no
    // number at all, so this is the sheet as it stands — an item that sets a
    // score is exactly what that reading is for. The ability is the granting
    // class's, resolved at creation; `8 + Proficiency Bonus` where the class
    // casts nothing at all, which is the rule an item already falls back to
    // for a wielder with no ability of their own.
    const sheet = sheetAsItStands(state, id) ?? creature.sheet;
    const ability = option.ability;
    const unverified: string[] = [];
    const resolved = runEffects(state, id, creature, {
      origin: { kind: 'feature', feature: option.feature, name: option.name },
      effects: typed.value,
      route: null,
      ability,
      castLevel: CONFERRED_LEVEL,
      numbers: {
        attackModifier:
          ability === null ? proficiencyBonus(sheet) : spellAttackModifierWith(sheet, ability),
        saveDc: ability === null ? 8 + proficiencyBonus(sheet) : spellSaveDcWith(sheet, ability),
        spellcastingModifier: ability === null ? 0 : modifierFor(sheet, ability),
        casterLevel: sheet.level,
      },
      targets,
      ...(command.teleportTo === undefined ? {} : { teleportTo: command.teleportTo }),
      unverified,
      supply,
      events,
    });
    if (!resolved.ok) return resolved;

    // **A deadline on what this actually hung, and on nothing else.** SRD Turn
    // Undead: the conditions last "for 1 minute". There is no casting for
    // `releaseCasting` to end, so the timer is the only door — the reading
    // `useItem` already takes for a potion, asked of a feature's own span.
    //
    // Filed per condition instance, because that is what identifies one and
    // what a second use has to replace rather than duplicate: `timerKey` is
    // `condition|<who>|<instance>`, so turning the same wight twice moves the
    // deadline instead of filing a second one.
    if (option.durationSeconds !== undefined) {
      const source = featureSource(option.feature);
      const world = resolved.value.state;
      for (const outcome of resolved.value.outcomes) {
        for (const condition of outcome.conditions ?? []) {
          const on: EffectTarget = {
            kind: 'condition',
            on: outcome.target,
            instance: conditionInstanceId(condition, source),
          };
          const timer = schedule(
            world,
            on,
            { kind: 'seconds', seconds: option.durationSeconds },
            // The repeat the resolution already filed, kept: the span is the
            // option's and not the effect's, so re-stating the deadline
            // without the repeat would drop the sentence the resolver had just
            // written down.
            world.timers[timerKey(on)]?.repeatSave,
            undefined,
            option.endsEarly,
          );
          if (!timer.ok) return timer;
          events.push(timer.value);
        }
      }

      // **And a `grants` deadline only where a grant is actually held.**
      // `grantSourcesOf` is the one enumerator of the sourced families and is
      // the honest question here: a condition-only option would otherwise file
      // a timer that takes nothing away, keyed where a later grant from the
      // same feature would have landed.
      for (const on of [...resolved.value.held].sort()) {
        const holder = world.creatures[on];
        if (holder === undefined || !grantSourcesOf(holder).includes(source)) continue;
        const timer = schedule(
          world,
          { kind: 'grants', on, source },
          { kind: 'seconds', seconds: option.durationSeconds },
        );
        if (!timer.ok) return timer;
        events.push(timer.value);
      }
    }

    // **What a later feature burns the failures with** — SRD Sear Undead:
    // "roll a number of d8s equal to your Wisdom modifier (minimum of 1d8) and
    // add the rolls together. Each Undead that fails its saving throw against
    // that use of Turn Undead takes Radiant damage equal to the roll's total."
    //
    // **Here rather than in the effect list, and the sentence is why.** An
    // effect is resolved once per target, so a `save-damage` appended to the
    // option would roll a fresh total for every creature — and the book says
    // *the* roll's total, one number for the whole use. What the option's own
    // effect decides is who failed; this is what one roll then does to all of
    // them, through `dealSpellDamage` like every other spell's damage, so
    // Resistance, Immunity and a broken Concentration are the engine's usual
    // answers rather than a second set.
    //
    // **And it ends nothing**: "This damage doesn't end the turn effect" needs
    // no clause, because the conditions the failure imposed are already
    // standing and nothing here takes one away.
    const burned = burnFailures(resolved.value, id, option, sheet, supply, events, unverified);
    if (!burned.ok) return burned;
    const outcomes = burned.value;

    return ok({ events, outcomes, unverified });
  });
}

/**
 * The damage a later feature deals to whoever failed the option's saving
 * throw — SRD Sear Undead.
 *
 * **One roll, every failure.** "Roll a number of d8s … and add the rolls
 * together. Each Undead that fails its saving throw … takes Radiant damage
 * equal to *the* roll's total." The total is thrown once for the use and dealt
 * to each of them, which is what a `save-damage` effect could not say: effects
 * are resolved per target, so the option would have rolled a fresh total for
 * every creature standing in the area.
 *
 * Nothing rolls at all where nobody failed, because the generator moving for a
 * use that burns no one is a difference in the log that stands for nothing.
 *
 * The outcomes come back with the damage written onto the failures, so the
 * caller reports what a use did in one place rather than two.
 */
function burnFailures(
  resolved: {
    readonly state: GameState;
    readonly outcomes: readonly SpellTargetOutcome[];
  },
  id: CharacterId,
  option: PoolOption,
  sheet: CharacterSheet,
  supply: Supply,
  events: GameEvent[],
  /**
   * What the damage could not settle, collected the way `events` is.
   *
   * The caller already returns one of these and this road was dropping the
   * funnel's share: a Warlock standing beside an Undead the Cleric burned down
   * is owed the same sentence about a side nobody declared.
   */
  unverified: string[],
): Result<readonly SpellTargetOutcome[]> {
  const burning = option.damagesFailures;
  if (burning === undefined) return ok(resolved.outcomes);

  const failed = resolved.outcomes.filter((one) => one.save?.success === false);
  if (failed.length === 0) return ok(resolved.outcomes);

  const rolled = rollSpellDice(supply, sheet, option.name, burning.damageType, burning.dice);
  if (!rolled.ok) return rolled;

  let current = resolved.state;
  const dealt = new Map<CharacterId, number>();
  for (const outcome of failed) {
    const hurt = dealSpellDamage(current, outcome.target, rolled.value, option.name, supply, {
      by: id,
    });
    if (!hurt.ok) return hurt;
    events.push(...hurt.value.events);
    current = hurt.value.events.reduce(applyEvent, current);
    unverified.push(...hurt.value.unverified);
    dealt.set(outcome.target, hurt.value.amount);
  }

  return ok(
    resolved.outcomes.map((outcome) => {
      const amount = dealt.get(outcome.target);
      return amount === undefined
        ? outcome
        : { ...outcome, damage: (outcome.damage ?? 0) + amount };
    }),
  );
}

/**
 * Spend one use to mint a budget of hit points and divide it — SRD Preserve
 * Life.
 *
 * The one purchase on a menu that runs no effect at all, and the reason is the
 * sentence: "divide those Hit Points among them" hands the *amounts* to the
 * Cleric, where every effect in the vocabulary carries its own amount and
 * reaches each target alike. So what arrives is a list of shares and what this
 * does is check every one of them before a single hit point is paid — the
 * whole-drawing-validated-first discipline `useHealingTouch` keeps for the
 * same reason, one feature along.
 *
 * Four refusals and each is the SRD's own clause:
 *
 * - **the budget** — "a number of Hit Points equal to five times your Cleric
 *   level", which the shares may not add up past;
 * - **the reach** — "within 30 feet of yourself", measured to each creature a
 *   share names;
 * - **the cap** — "can restore a creature to no more than half its Hit Point
 *   maximum", which is also the whole of "Choose **Bloodied** creatures": a
 *   creature above half its maximum has no room under the cap at all, so the
 *   sentence is enforced without a second reading of it;
 * - **the types** — "You can't use this feature on an Undead or a Construct",
 *   refused rather than filtered, because the caller named this creature
 *   rather than standing it in an area.
 */
function divideHitPoints(
  state: GameState,
  id: CharacterId,
  option: PoolOption,
  divided: HitPointBudget,
  /** What is left of the pool, read by the caller that already holds it. */
  poolLeft: number,
  command: UsePoolOptionCommand,
  stamp: CommandStamp | null,
): Result<PoolOptionUse> {
  if (command.target !== undefined) {
    return err(
      'division_required',
      `${option.name} divides its hit points among the creatures the shares name; it is not aimed at one`,
    );
  }
  if (command.damageType !== undefined) {
    return err(
      'damage_type_fixed',
      `${option.name} restores hit points and deals none, so a damage type is not something it offers`,
    );
  }

  const shares = command.among ?? [];
  if (shares.length === 0) {
    return err(
      'division_required',
      `${option.name} restores ${divided.hitPoints} hit points divided among creatures, and no share was named`,
    );
  }

  // The arithmetic first, because none of it needs the world: a share of no
  // hit points buys nothing, a creature named twice would be capped twice
  // against the wrong total, and a division that overspends the budget is
  // refused before anybody is measured.
  const named = new Set<CharacterId>();
  let total = 0;
  for (const share of shares) {
    if (named.has(share.target)) {
      return err(
        'duplicate_share',
        `${share.target} is given two shares of ${option.name}, and one creature takes one`,
      );
    }
    named.add(share.target);
    if (!Number.isInteger(share.hitPoints) || share.hitPoints < 1) {
      return err(
        'bad_share',
        `a share is a whole number of hit points of at least one, got ${String(share.hitPoints)}`,
      );
    }
    total += share.hitPoints;
  }
  if (total > divided.hitPoints) {
    return err(
      'too_much_divided',
      `${option.name} restores ${divided.hitPoints} hit points and ${total} were divided out`,
    );
  }

  // And then the world, share by share.
  const unstated: ContextRequest[] = [];
  for (const share of shares) {
    const who = creatureOf(state, share.target);
    if (who === null) return unknownCreature(share.target);

    // A type the option refuses is checked; a type **nobody has stated** is
    // asked for rather than waved through, which is the rule `spellTargets`
    // already keeps of the same comparison — `isCreatureType(null, …)` is
    // false, so an undeclared creature would otherwise be quietly healed by a
    // feature that may not touch an Undead.
    const excluded = divided.excludesTypes ?? [];
    if (excluded.length > 0) {
      if (who.creatureType === null || who.creatureType === undefined) {
        unstated.push({
          kind: 'creature-type',
          subject: share.target,
          need: `what kind of creature ${share.target} is`,
          because: `${option.name} may not be used on ${excluded.join(' or ')}`,
          satisfyWith: `declareCreatureType(${share.target}, …), or a creatureType when the creature is added`,
        });
      } else {
        for (const type of excluded) {
          if (!isCreatureType(who.creatureType, type)) continue;
          return err(
            'cannot_be_restored',
            `${option.name} may not be used on ${type}, and ${share.target} is ${who.creatureType}`,
          );
        }
      }
    }

    const beyond = reachedBy(state, id, share.target, option.name, option.reach ?? 0);
    if (beyond !== null) return beyond;

    // "no more than half its Hit Point maximum", which is a ceiling on where
    // the creature ends up rather than on the size of the share.
    const ceiling = Math.floor(who.vitals.hpMax / 2);
    if (who.vitals.hp + share.hitPoints > ceiling) {
      return err(
        'past_the_cap',
        `${option.name} restores a creature to no more than half its maximum, and ${share.hitPoints} would carry ${share.target} from ${who.vitals.hp} past ${ceiling}`,
      );
    }
  }

  if (unstated.length > 0) {
    return needsContext(
      'unknown_creature_type',
      `nobody has said what kind of creature ${unstated.map((one) => one.subject).join(' or ')} ${unstated.length === 1 ? 'is' : 'are'}, and ${option.name} may not be used on some of them`,
      unstated,
    );
  }

  // And the pool, last of the refusals exactly as it is on the path beside
  // this one: a use that arrives with the pool empty must be a value, because
  // a `resource-spent` the fold cannot apply is a thrown `CorruptLogError`
  // rather than a refusal anybody can read.
  if (poolLeft < 1) {
    return err('exhausted', `${id} has no uses of ${option.featureName} left`);
  }

  // — from here it costs something ——————————————————————————————————————
  const events: GameEvent[] = [];

  // The action economy only exists in combat, as everywhere else here.
  const priced = spendOptionCost(state, id, option);
  if (!priced.ok) return priced;
  if (priced.value !== null) events.push(priced.value);

  events.push({
    type: 'resource-spent',
    id,
    key: option.pool,
    amount: 1,
    ...(stamp === null ? {} : { command: stamp }),
  });

  const outcomes: SpellTargetOutcome[] = [];
  for (const share of shares) {
    const healed = healCreature(state, share.target, share.hitPoints);
    if (!healed.ok) return healed;
    events.push(...healed.value);
    outcomes.push({ target: share.target, healed: share.hitPoints, affected: true });
  }

  return ok({ events, outcomes, unverified: [] });
}

/**
 * The `teleport` an option's effect list performs, or null for every other
 * option in the book.
 *
 * `teleportOf`'s twin on the other host, and read by the same three readers
 * that must agree about a casting's: the stated-fact check's *is a destination
 * required*, the pre-flight's *may this use reach that space*, and the
 * resolver's *put them there*. A list holds at most one — two would be two
 * destinations for one use, which nothing could state.
 */
function teleportIn(
  effects: readonly SpellEffect[],
): Extract<SpellEffect, { kind: 'teleport' }> | null {
  return effects.find((effect) => effect.kind === 'teleport') ?? null;
}

/**
 * The option's effects with the damage type the caller named, or the refusal.
 *
 * `SpellDefinition.damageTypeStated` asked of a feature's option — a list the
 * option prints, one value named at the use, refused if it is not on the list,
 * and refused the other way when the option prints no list and the caller
 * named one anyway. The substitution itself is `statedDamageType`, which is
 * the spell path's own and not a second copy of it.
 */
function statedTypeFor(
  option: PoolOption,
  named: string | undefined,
): Result<readonly SpellEffect[]> {
  const types = option.damageTypeStated;
  if (types === undefined) {
    if (named !== undefined) {
      return err(
        'damage_type_fixed',
        `${option.name} prints no choice of damage type; naming one is not something it offers`,
      );
    }
    return ok(option.effects);
  }
  if (named === undefined) {
    return err(
      'damage_type_required',
      `${option.name} prints ${types.join(' or ')} and the engine will not choose between them; name which`,
    );
  }
  if (!types.includes(named)) {
    return err('unknown_damage_type', `${option.name} prints ${types.join(' or ')}, not ${named}`);
  }
  return ok(statedDamageType(option.effects, named));
}

/**
 * What one use of an option costs in the economy, whichever of the three
 * prices it prints.
 *
 * **The action economy only exists in combat** — outside one there is nothing
 * to spend, which every feature and every potion finds alike — and
 * {@link spendOneAttack} is the exception the third price brings with it: an
 * Attack action nobody could have taken is a refusal rather than a waiver, so
 * a Dragonborn cannot breathe once a round for ever between fights.
 *
 * `null` where nothing was spent, which is every use outside a fight.
 */
function spendOptionCost(
  state: GameState,
  id: CharacterId,
  option: PoolOption,
): Result<GameEvent | null> {
  if (option.action === 'one-attack') return spendOneAttack(state, id, option);
  if (state.combat === null) return ok(null);
  return spendFor(state, id, option.action);
}

/**
 * One swing of an Attack action already taken, spent on something that is not
 * a swing.
 *
 * SRD Breath Weapon: "When you take the Attack action on your turn, you can
 * **replace one of your attacks** with an exhalation of magical energy." Two
 * facts the sentence turns on and each is a refusal here: the Attack action
 * must have been taken — `attacksRemaining` is null until it is, which is what
 * that null *means* — and one of its attacks must be left.
 *
 * **The event is the swing's own**, and that is the whole of why no new one
 * was minted: `attack-made` is what the budget arithmetic hangs on, the fold
 * spends it through the same `spendAttack` this does, and a second event with
 * the same body would be a second place for the two to disagree. What a
 * Dragonborn exhales is not an Unarmed Strike, so the flag is absent — which
 * is also what keeps a Monk's Flurry out of it: attacks bought `unarmedOnly`
 * are skipped by a swing that is not one, in the command and in the fold
 * alike.
 *
 * **The stricter of two readings of one printed price**, and it is written
 * down here rather than argued each time somebody meets it. SRD Pact of the
 * Chain prints the same clause — "when you take the Attack action, you can
 * forgo one of your own attacks" — and `orderSummonsAttack` reads it as the
 * *taking*, because a Warlock makes one attack in an Attack action and a rule
 * that asked for one left over would be a sentence no Warlock could ever use.
 * The same is true of a Dragonborn with no Extra Attack and this feature; that
 * is a question about Breath Weapon rather than about the Pact, so it is filed
 * rather than settled here.
 */
function spendOneAttack(
  state: GameState,
  id: CharacterId,
  option: PoolOption,
): Result<GameEvent> {
  const combat = state.combat;
  if (combat === null) {
    return err(
      'not_in_combat',
      `${option.name} replaces one of the attacks of an Attack action, and there is no action economy outside combat to have taken one in`,
    );
  }
  const budget = combat.budgets[id];
  if (budget === undefined || budget.attacksRemaining === null) {
    return err(
      'no_attack_action',
      `${option.name} replaces one of the attacks of the Attack action, and ${id} has not taken that action this turn`,
    );
  }
  if (budget.attacksRemaining < 1) {
    return err(
      'no_attacks_left',
      `${id} has used every attack of their Attack action, and ${option.name} replaces one of them`,
    );
  }

  const spent = spendAttack(
    combat,
    id,
    0,
    creatureOf(state, id)?.conditions,
    { rules: actionRulesOn(state, id) },
  );
  if (!spent.ok) return spent;
  return ok({ type: 'attack-made', id });
}

/**
 * The template this use fills, out of the one the option prints or the several
 * it offers.
 *
 * `statedTypeFor` one field along and written to the same three rules: an
 * option that prints a single shape takes no answer, an option that prints a
 * choice takes one and will not be chosen for, and a shape it does not print
 * is a refusal rather than a substitution. SRD Breath Weapon is the only
 * sentence in the book that offers two — "a 15-foot Cone or a 30-foot Line
 * that is 5 feet wide (choose the shape each time)" — and it names them by
 * the shapes they are, which is what the caller names here.
 */
function shapeFor(option: PoolOption, named: string | undefined): Result<SpellArea | undefined> {
  const offered = option.areas;
  if (offered === undefined) {
    if (named !== undefined) {
      return err(
        'shape_fixed',
        `${option.name} prints no choice of shape; naming one is not something it offers`,
      );
    }
    return ok(option.area);
  }
  const shapes = offered.map((one) => one.kind);
  if (named === undefined) {
    return err(
      'shape_required',
      `${option.name} is a ${shapes.join(' or a ')} and the engine will not choose between them; name which`,
    );
  }
  const found = offered.find((one) => one.kind === named);
  if (found === undefined) {
    return err('no_such_shape', `${option.name} forms a ${shapes.join(' or a ')}, not a ${named}`);
  }
  return ok(found);
}

/**
 * Whom this option reaches: whoever is standing in its area, or the one
 * creature the caller named.
 *
 * The two halves a casting already has, asked of an option. An area catches
 * whoever is in it and filters by creature type without refusing anybody; a
 * named target is checked as itself, at the reach the option prints.
 * `areaTargets` does the first through the geometry a spell's area goes
 * through, which is why it takes the area and the name rather than a
 * definition there is none of.
 *
 * The area arrives resolved rather than read off the option, because an option
 * may offer two of them and only {@link shapeFor} knows which this use took.
 */
function targetsOf(
  state: GameState,
  id: CharacterId,
  option: PoolOption,
  area: SpellArea | undefined,
  command: UsePoolOptionCommand,
): Result<readonly CharacterId[]> {
  const named = command.target;
  if (area !== undefined) {
    if (named !== undefined) {
      return err(
        'area_picks_its_own_targets',
        `${option.name} fills an area and catches whoever is in it; it does not take a target`,
      );
    }
    return areaTargets(
      state,
      id,
      {
        name: option.name,
        ...(option.mustBeType === undefined ? {} : { mustBeType: option.mustBeType }),
      },
      area,
      {
        targets: [],
        // A Cone or a Line has to be pointed somewhere, and every area an
        // option prints starts at its holder — so the direction is the whole
        // of the placement a caller supplies.
        ...(command.towards === undefined ? {} : { towards: command.towards }),
      },
      null,
    );
  }

  // An option aimed at a creature has nothing to point: the refusal a
  // non-directional *area* already gets, for a use that fills none at all.
  if (command.towards !== undefined) {
    return err('not_directional', `${option.name} fills no area and has no direction to point`);
  }

  const target = named ?? id;
  if (creatureOf(state, target) === null) return unknownCreature(target);
  const beyond = reachedBy(state, id, target, option.name, option.reach ?? 0);
  if (beyond !== null) return beyond;
  return ok([target]);
}

