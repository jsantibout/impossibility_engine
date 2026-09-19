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
  err,
  ok,
  type Result,
} from '@ie/shared';
import { isIncapacitated } from '../conditions.js';
import { type Rng } from '../dice.js';
import { turnAnchored } from '../time.js';
import { type CommandStamp, type GameEvent, type GameState, wearsHeavyArmor } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { remaining } from '../resources.js';
import { type RollIssuer, rollRecorded } from '../rolls.js';
import {
  type ActivatedFeature,
  type HealAmount,
  recoveryCap,
  selfHealAddend,
  sheetAsItStands,
} from '../standing.js';
import { creatureOf, reachedBy, spendFor, unknownCreature } from './command.js';
import { endConditionsOn, schedule } from './conditions.js';
import { healCreature } from './creatures.js';
import { mayAct } from './holds.js';

export interface ActivateFeatureCommand extends CommandIdentity {
  readonly feature: string;
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
 */
export function activateFeature(
  state: GameState,
  id: CharacterId,
  command: ActivateFeatureCommand,
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

    if (creature.activeFeatures.includes(command.feature)) {
      return err('already_active', `${id} is already in ${definition.name}`);
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

    events.push({
      type: 'feature-activated',
      id,
      feature: command.feature,
      ...(stamp === null ? {} : { command: stamp }),
    });

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

    events.push({ type: 'resource-spent', id, key: definition.pool, amount: 1 });

    const healed = rollAndHeal(state, id, definition, definition.name, supply, stamp);
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
 */
function rollAndHeal(
  state: GameState,
  id: CharacterId,
  heal: HealAmount,
  name: string,
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
  stamp: CommandStamp | null,
): Result<GameEvent[]> {
  const creature = creatureOf(state, id);
  if (creature === null) return unknownCreature(id);

  const issuedBefore = supply.issuer.count;
  const rolled = rollRecorded(supply.issuer, supply.rng, heal.dice);
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
    ...done.value.map((event) =>
      event.type === 'healed' && stamp !== null ? { ...event, command: stamp } : event,
    ),
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
      const healed = rollAndHeal(state, id, definition.heal, definition.name, supply, null);
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

    const events: GameEvent[] = [];
    if (command.by === 'bonus-action' && state.combat !== null) {
      const spent = spendFor(state, id, 'bonus-action');
      if (!spent.ok) return spent;
      events.push(spent.value);
    }

    const timer = featureTimer(state, id, definition);
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

/** The deadline one activation runs to. */
export function featureTimer(
  state: GameState,
  id: CharacterId,
  definition: ActivatedFeature,
): Result<GameEvent | null> {
  // Outside combat there are no turns, so a turn-anchored deadline has no
  // meaning — `resolveDuration` refuses it rather than inventing seconds, and
  // the feature simply runs until something ends it.
  if (state.combat === null) return ok(null);

  const timer = schedule(
    state,
    { kind: 'feature', on: id, feature: definition.feature },
    // The feature's own anchor, carried across rather than branched on: a
    // mapping from each member of the pair to its constructor is what
    // `turnAnchored` is, and one written here would be a third place a third
    // member has to be remembered.
    turnAnchored(definition.lasts, id),
  );
  if (!timer.ok) return timer;
  return ok(timer.value);
}

