/**
 * A thing a feature makes, put in the room and taken out of it again.
 *
 * SRD Gnomish Lineage's clockwork device is the one printing, and three
 * commands are its whole sentence: the making, the dismantling, and the Bonus
 * Action that presses the button.
 *
 * **Nothing here is a second kind of target.** `objects.ts` argued that at
 * length and this is the argument arriving: a device is a creature in the
 * roster with a stated sheet, so every reader past it — the Armour Class, the
 * damage pipeline, the map, the conditions it cannot be given — is the one
 * that already existed, and a blow that breaks a music box goes through
 * `resolveAttack` without a word.
 *
 * **Nor is its lifetime a second kind of deadline.** What is made is *kept* by
 * its maker, on the terms `SummonBond.kept` was built for: the four ways a
 * kept creature goes — destroyed, its keeper dead, its keeper rested, its
 * keeper gone — are read by `strandedSummons` and settled by
 * `dismissStrandedSummons`, and the eight hours are a fifth read the same way.
 * A timer could not do it: what runs out takes a *creature* away, and a
 * creature leaving is a batch of events rather than a line the fold may
 * delete.
 *
 * **What the device does is prose and stays prose.** The SRD's own sentence
 * hands it over — the function is "one effect from the Prestidigitation
 * spell", and the engine holds no candle to light, no soap and no thimbleful
 * of flavour. So the maker names one of the effects the trait prints, it is
 * pinned into the arrival, and the Bonus Action spends the slot and hands the
 * sentence back. That is the reading `takePrintedAction` already takes of a
 * stat block's line, and the alternative — an effect list — would be the
 * engine inventing mechanics for six sentences that print none.
 */

import { err, ok, type CharacterId, type Result } from '@ie/shared';
import type { GameEvent, GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  objectDefenses,
  objectSheet,
  OBJECT_CONDITION_IMMUNITIES,
  OBJECT_CREATURE_TYPE,
} from '../objects.js';
import type { ObjectMaker } from '../standing.js';
import { sheetAsItStands } from '../standing.js';
import type { Placement } from '../positioning.js';
import { creatureOf, reachedBy, spendFor, unknownCreature } from './command.js';
import { mayAct } from './holds.js';
import { removeCreatureEverywhere } from './creatures.js';

export interface CreateDeviceCommand extends CommandIdentity {
  /** The feature that makes it — SRD's Gnomish Lineage. */
  readonly feature: string;
  /** The id the thing will have in play. */
  readonly device: CharacterId;
  /** What to call it: "a tin bird", "a music box". Narration. */
  readonly name: string;
  /**
   * The effect the maker chose, out of the ones the feature prints.
   *
   * Held to that list rather than taken as free prose, so a device always does
   * something its own trait allows — which is the half of "you determine its
   * function by choosing one effect from the Prestidigitation spell" the
   * engine can check.
   */
  readonly function: string;
  /**
   * SRD: "If the chosen effect has options within it, you choose one of those
   * options for the device when you create it." Free prose, because the
   * options are inside a sentence and no list of them is printed.
   */
  readonly detail?: string;
  /**
   * Where it is put down.
   *
   * Absent leaves it in the game and off the map, which is what
   * `declareObject` and `addCreature` both do and what `creaturesInArea`
   * already says about an unplaced creature. A device nobody has put anywhere
   * cannot be touched, and `reachedBy` asks for the placement rather than
   * refusing.
   */
  readonly placement?: Placement;
}

export interface DismantleDeviceCommand extends CommandIdentity {
  readonly device: CharacterId;
}

export interface ActivateDeviceCommand extends CommandIdentity {
  readonly device: CharacterId;
}

/** What pressing the button bought: the sentence its maker chose. */
export interface DeviceUse {
  readonly events: readonly GameEvent[];
  /** The effect the device was made with, in the book's own words. */
  readonly function: string;
  /** The option inside that effect, where the maker chose one. */
  readonly detail: string | null;
}

const NOTHING_USED: DeviceUse = { events: [], function: '', detail: null };

/** The making this feature declares, or null where the creature holds none. */
const makerOf = (state: GameState, id: CharacterId, feature: string): ObjectMaker | null => {
  const creature = creatureOf(state, id);
  if (creature === null) return null;
  const sheet = sheetAsItStands(state, id) ?? creature.sheet;
  return (sheet.objectMakers ?? []).find((one) => one.feature === feature) ?? null;
};

/**
 * How many of this feature's things are standing.
 *
 * SRD: "You can have three such devices in existence at a time." A count of
 * the room rather than of a pool, which is the whole reason it is derived: one
 * dismantled makes room for another the same minute, and a pool with no
 * recovery would refuse the fourth for ever.
 */
const standingFor = (state: GameState, id: CharacterId, feature: string): readonly CharacterId[] =>
  Object.keys(state.creatures)
    .sort()
    .flatMap((key) => {
      const other = state.creatures[key];
      if (other === undefined || other.device?.feature !== feature) return [];
      return other.summonedBy?.by === id ? [other.id] : [];
    });

/**
 * Make one, and spend the time it takes.
 *
 * **The ten minutes are the price and this command spends them.** SRD prints
 * a casting time and no action, and `advanceTime` states the rule the other
 * half of that rests on: inside a fight the clock is the turn order's. So a
 * making is refused in combat — ten minutes is not something a round holds —
 * and outside one the command moves the clock itself, because the eight hours
 * the thing stands are dated from the moment it is finished and a caller who
 * advanced the clock separately could date them from either end.
 *
 * Every refusal is reached before anything is spent.
 */
export function createDevice(
  state: GameState,
  id: CharacterId,
  command: CreateDeviceCommand,
): Result<GameEvent[]> {
  return once(state, `create-device:${id}`, command, () => [], (stamp) => {
    const owed = mayAct(state, id);
    if (owed !== null) return owed;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const maker = makerOf(state, id, command.feature);
    if (maker === null) {
      return err('no_such_feature', `${id} has no feature called ${command.feature} that makes anything`);
    }

    if (creatureOf(state, command.device) !== null) {
      return err('already_present', `${command.device} is already in this game`);
    }

    if (!maker.functions.includes(command.function)) {
      return err(
        'no_such_function',
        `${maker.name} makes a thing that does one of the effects it prints, and “${command.function}” is not one of them`,
      );
    }

    const held = standingFor(state, id, command.feature);
    if (held.length >= maker.atOnce) {
      return err(
        'too_many_devices',
        `${maker.name} keeps ${maker.atOnce} in existence at a time, and ${held.join(', ')} already stand`,
      );
    }

    // The clock's own rule, one command along: a fight's seconds belong to the
    // turn order, so a casting measured in minutes cannot happen inside one.
    if (state.combat !== null) {
      return err(
        'in_combat',
        `${maker.name} takes ${maker.castingSeconds} seconds of casting, and inside a fight the clock is the turn order's — a round is six seconds and nothing else moves it`,
      );
    }

    // — from here it costs something ——————————————————————————————————————
    //
    // **And the whole of what it costs is the clock.** There is no action to
    // charge: every making happens outside a fight, by the refusal above, and
    // outside one there is no economy to spend an action from. The grant
    // carries no field for one either, so nothing here is being skipped.
    const events: GameEvent[] = [];

    events.push({
      type: 'time-advanced',
      seconds: maker.castingSeconds,
      reason: `${creature.name} spends ${maker.castingSeconds} seconds casting ${maker.spell}`,
    });

    events.push({
      type: 'creature-added',
      id: command.device,
      name: command.name,
      // Every number is the trait's, pinned into the arrival, so the fold
      // opens nothing and a log replayed next year raises the same device.
      sheet: objectSheet(maker.armorClass),
      maxHp: maker.hitPoints,
      // SRD: "An object is destroyed when it has 0 Hit Points."
      diesAtZero: true,
      creatureType: OBJECT_CREATURE_TYPE,
      // The rule every object obeys and nothing else: the trait prints an
      // Armour Class outright and never says what the thing is made of, so
      // there is no substance to read a ruling off.
      defenses: objectDefenses(null),
      conditionImmunities: OBJECT_CONDITION_IMMUNITIES,
      size: maker.size,
      device: {
        feature: maker.feature,
        featureName: maker.name,
        function: command.function,
        ...(command.detail === undefined ? {} : { detail: command.detail }),
        activation: maker.activation,
      },
    });

    events.push({
      type: 'creature-summoned',
      id: command.device,
      by: id,
      kept: {
        spell: maker.spell,
        // SRD says the device "stops working" when its maker dies rather than
        // that it goes: it is still a Tiny thing with an Armour Class and a
        // hit point lying there. What stops is the button, which
        // `activateDevice` refuses.
        untilSummonerDies: false,
        lastsSeconds: maker.lastsSeconds,
        since: state.elapsed + maker.castingSeconds,
      },
    });

    if (command.placement !== undefined) {
      events.push({
        type: 'creature-placed',
        id: command.device,
        placement: command.placement,
      });
    }

    if (stamp === null) return ok(events);
    return ok([...events.slice(0, -1), { ...events[events.length - 1]!, command: stamp }]);
  });
}

/** The thing and what made it, or the refusal a creature that is not one earns. */
function deviceAt(state: GameState, device: CharacterId) {
  const thing = creatureOf(state, device);
  if (thing === null) return unknownCreature(device);
  if (thing.device === null) {
    return err('not_a_device', `${device} is not a thing any feature made, so there is nothing to work`);
  }
  return ok({ thing, record: thing.device });
}

/**
 * Take one apart.
 *
 * SRD: "each falls apart ... when it is dismantled by you or another
 * creature." No action is printed and none is charged; what is asked for is
 * reach, because taking a thing apart is done with hands.
 *
 * The departure is the one the engine already models, unchanged:
 * `removeCreatureEverywhere` settles what the leaver owed, takes it off the
 * map and out of the Initiative order.
 */
export function dismantleDevice(
  state: GameState,
  id: CharacterId,
  command: DismantleDeviceCommand,
): Result<GameEvent[]> {
  return once(state, `dismantle-device:${id}`, command, () => [], (stamp) => {
    const owed = mayAct(state, id);
    if (owed !== null) return owed;

    if (creatureOf(state, id) === null) return unknownCreature(id);

    const found = deviceAt(state, command.device);
    if (!found.ok) return found;

    const near = reachedBy(state, id, command.device, `taking ${command.device} apart`);
    if (near !== null) return near;

    const gone = removeCreatureEverywhere(state, command.device);
    if (!gone.ok) return gone;
    const events = gone.value;
    if (stamp === null || events.length === 0) return ok(events);
    return ok([...events.slice(0, -1), { ...events[events.length - 1]!, command: stamp }]);
  });
}

/**
 * Press the button.
 *
 * SRD: "the device produces that effect whenever you or another creature takes
 * a Bonus Action to activate it with a touch." **Anybody**, which is why this
 * takes the toucher rather than the maker, and **with a touch**, which is why
 * it asks for reach.
 *
 * What it hands back is the sentence the making pinned. Nothing is rolled and
 * nothing is applied: the engine has no reader for "you clean or soil an
 * object", and a die thrown for a sentence nobody executes is the defect this
 * repository calls its worst.
 */
export function activateDevice(
  state: GameState,
  id: CharacterId,
  command: ActivateDeviceCommand,
): Result<DeviceUse> {
  return once(state, `activate-device:${id}`, command, () => NOTHING_USED, (stamp) => {
    const owed = mayAct(state, id);
    if (owed !== null) return owed;

    if (creatureOf(state, id) === null) return unknownCreature(id);

    const found = deviceAt(state, command.device);
    if (!found.ok) return found;
    const { thing, record } = found.value;

    // SRD: "Each device also stops working if you die." The thing is still
    // there — a Tiny object with an Armour Class and a hit point — and the
    // button is what has stopped, so this is a refusal rather than a removal.
    const madeBy = thing.summonedBy?.by ?? null;
    const maker = madeBy === null ? null : (state.creatures[madeBy] ?? null);
    if (madeBy !== null && maker === null) {
      // Through the one door, so the request names the command that would
      // settle it: a reason with nothing a caller can send is half an answer.
      return unknownCreature(
        madeBy,
        `made ${command.device} and is not in this game, so nothing can say whether it still works`,
      );
    }
    if (maker !== null && maker.vitals.dead) {
      return err(
        'device_stopped',
        `${maker.name} is dead, and ${record.featureName} stops working when its maker does`,
      );
    }

    const near = reachedBy(state, id, command.device, `touching ${command.device}`);
    if (near !== null) return near;

    // — from here it costs something ——————————————————————————————————————
    // The action economy only exists in combat; outside one there is nothing
    // to spend, which every feature and every potion finds alike.
    const priced = state.combat === null ? null : spendFor(state, id, record.activation);
    if (priced !== null && !priced.ok) return priced;
    const spent = priced === null ? [] : [priced.value];

    return ok({
      events:
        stamp === null || spent.length === 0
          ? spent
          : [...spent.slice(0, -1), { ...spent[spent.length - 1]!, command: stamp }],
      function: record.function,
      detail: record.detail ?? null,
    });
  });
}
