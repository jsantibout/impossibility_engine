/**
 * M-RISE: the printed lines that restore a creature and raise one.
 *
 * SRD Otherworldly Steed's Healing Touch — "One creature within 5 feet of the
 * steed regains a number of Hit Points equal to 2d8 plus the spell's level" —
 * and SRD Wraith's Create Specter. Each is a door of the kind the other
 * printed-line doors in `commands/actions.ts` are: the heading names what the
 * use costs, the line's structure says what it does, and the engine rolls,
 * measures and spends while the caller names the creature it is aimed at.
 *
 * Kept in a module of its own rather than in `actions.ts`, which holds the
 * doors the book prints most; nothing here is read by anything there.
 */

import {
  type CharacterId,
  err,
  needsContext,
  ok,
  type Result,
} from '@ie/shared';
import { type CommandIdentity, once } from '../idempotency.js';
import { spendAction, spendBonusAction } from '../combat.js';
import { type StatedAction, type StatedBonusAction } from '../character.js';
import { wrongFormFor } from '../forms.js';
import { actionRulesOn, isBloodied, requirementsHold } from '../standing.js';
import { applyEvent, type CommandStamp, type GameEvent, type GameState } from '../events.js';
import { distanceBetween } from '../positioning.js';
import {
  describePerDay,
  describeRecharge,
  perDayTallyKey,
  printedLimbSevering,
  printedLineSource,
  SEVERED_LIMB_TALLY,
  statedActionOf,
  statedBonusActionOf,
} from '../monster.js';
import { tallied } from '../resources.js';
import { rollRecorded, type RollIssuer } from '../rolls.js';
import { type Rng } from '../dice.js';
import { healingRuleOf, maximisedHealing } from '../vitals.js';
import { creatureOf, unknownCreature } from './command.js';
import { healCreature, summonCreature } from './creatures.js';
import { placeCreatureInScene } from './scene.js';
import { type Supply } from './casting.js';
import { mayAct } from './holds.js';

/** A printed line found under either heading a creature spends from, and which. */
interface FoundLine {
  readonly line: StatedAction | StatedBonusAction;
  readonly action: boolean;
}

/** The line under Actions first, then Bonus Actions — the order every printed door searches. */
function printedLineOf(state: GameState, id: CharacterId, name: string): FoundLine | null {
  const sheet = state.creatures[id]?.sheet;
  if (sheet === undefined) return null;
  const action = statedActionOf(sheet, name);
  if (action !== null) return { line: action, action: true };
  const bonus = statedBonusActionOf(sheet, name);
  return bonus === null ? null : { line: bonus, action: false };
}

/**
 * What a printed line's heading forbids before anything is spent, or null.
 *
 * The four refusals every printed door asks in this order — the form and type
 * the heading prints the line for, what it requires, a use not yet back, and a
 * day's worth gone — so a line is refused here in the words the other doors use.
 */
function headingRefusal(
  state: GameState,
  id: CharacterId,
  found: FoundLine,
): Result<never> | null {
  const creature = state.creatures[id]!;
  const { line } = found;
  const wrongForm = wrongFormFor(creature, line);
  if (wrongForm !== null) return err('wrong_form', wrongForm);
  if (line.requires !== undefined && !requirementsHold(state, id, line.requires, line.name)) {
    return err('requirement_unmet', `${line.name} states a condition ${id} does not meet`);
  }
  if (creature.expendedLines.includes(line.name)) {
    return err(
      'line_expended',
      `${id} has used ${line.name} and not got it back${
        line.recharge === undefined ? '' : `: ${describeRecharge(line.recharge)}`
      }`,
    );
  }
  const perDay = line.perDay ?? null;
  const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
  if (perDay !== null && usedToday >= perDay) {
    return err(
      'daily_limit_reached',
      `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`,
    );
  }
  return null;
}

/**
 * The slot the heading names, the line's own recharge and day, and the record
 * that the line was taken — the events every printed door writes for a spend.
 */
function spendTheLine(
  state: GameState,
  id: CharacterId,
  found: FoundLine,
  stamp: CommandStamp | null,
): Result<GameEvent[]> {
  const combat = state.combat!;
  const creature = state.creatures[id]!;
  const { line } = found;
  const spent = found.action
    ? spendAction(combat, id, creature.conditions, { rules: actionRulesOn(state, id) })
    : spendBonusAction(combat, id, creature.conditions, { rules: actionRulesOn(state, id) });
  if (!spent.ok) return spent;
  return ok([
    found.action ? { type: 'action-spent', id } : { type: 'bonus-action-spent', id },
    ...(line.recharge === undefined
      ? []
      : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
    ...(line.perDay === undefined
      ? []
      : [
          {
            type: 'resource-spent' as const,
            id,
            key: perDayTallyKey(line.name),
            amount: 1,
            tally: 'dawn' as const,
          },
        ]),
    found.action
      ? {
          type: 'stated-action-taken' as const,
          id,
          line: line.name,
          ...(stamp === null ? {} : { command: stamp }),
        }
      : {
          type: 'stated-bonus-action-taken' as const,
          id,
          line: line.name,
          turn: combat.turnsTaken,
          ...(stamp === null ? {} : { command: stamp }),
        },
  ]);
}

/** How far apart two creatures stand, or a request for where they are. */
function measured(
  state: GameState,
  from: CharacterId,
  to: CharacterId,
  because: string,
): Result<number> {
  const apart = state.scene === null ? null : distanceBetween(state.scene, from, to);
  if (apart !== null && apart.ok) return ok(apart.value);
  return needsContext('unplaced', `${because}, and ${from} and ${to} are not both standing somewhere`, [
    {
      kind: 'position',
      subject: from,
      need: `where ${from} and ${to} are standing`,
      because,
      satisfyWith: `a placeCreatureInScene command for ${from} and ${to}`,
    },
  ]);
}

export interface PrintedHealCommand extends CommandIdentity {
  readonly line: string;
  /**
   * The creature the line restores — SRD Healing Touch's "One creature within
   * 5 feet of the steed". The table's choice; asked for rather than chosen.
   */
  readonly target?: CharacterId;
}

export interface PrintedHealOutcome {
  readonly events: readonly GameEvent[];
  /** The Hit Points the creature actually regained, after its maximum. */
  readonly healed: number;
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Take a printed line that restores Hit Points to a creature near its holder —
 * SRD Otherworldly Steed's Healing Touch (Celestial Only; Recharges after a
 * Long Rest). M-RISE.
 *
 * **The dice are thrown here and the flat is the casting's.** "2d8 plus the
 * spell's level": the arrival wrote the level of the casting that raised the
 * steed over the line's mark, so the number on the sheet is a number, and a
 * steed walked in by hand carries the line as prose and is refused here
 * (`line_states_no_heal`) rather than healing by a level nobody supplied.
 *
 * Everything that could say no says it before the slot is spent: the heading's
 * type, a use not yet back, the creature named and standing within reach.
 * The healing itself goes through `healCreature`, so a rule standing in front
 * of healing — SRD Chill Touch — and a block that regains none are met where
 * every other heal meets them, and SRD Beacon of Hope maximises the dice.
 */
export function takePrintedHeal(
  state: GameState,
  id: CharacterId,
  command: PrintedHealCommand,
  supply: { readonly issuer: RollIssuer; readonly rng: Rng },
): Result<PrintedHealOutcome> {
  return once(
    state,
    `printed-heal:${id}`,
    command,
    () => ({ events: [], healed: 0, unverified: [], duplicate: true }),
    (stamp) => {
      const owedHere = mayAct(state, id, 'act');
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        return err('not_in_combat', 'there is no turn to spend a printed line from outside combat');
      }

      const found = printedLineOf(state, id, command.line);
      if (found === null) {
        return err(
          'no_such_line',
          `no line called ${command.line} is printed under this creature's Actions or Bonus Actions`,
        );
      }
      const heals = found.line.heals;
      if (heals === undefined) {
        return err(
          'line_states_no_heal',
          `${found.line.name} states no healing this engine could read; take it with the door that hands the sentence over`,
        );
      }

      const refused = headingRefusal(state, id, found);
      if (refused !== null) return refused;

      if (command.target === undefined) {
        return needsContext(
          'undeclared_target',
          `${found.line.name} restores "one creature within ${heals.within} feet", and nobody has said which`,
          [
            {
              kind: 'creature',
              subject: id,
              need: `the creature ${found.line.name} restores`,
              because: 'the book offers a choice of creatures and the engine makes none of them',
              satisfyWith: 'takePrintedHeal again with its target filled in',
            },
          ],
        );
      }
      const target = creatureOf(state, command.target);
      if (target === null) return unknownCreature(command.target);
      if (target.vitals.dead) {
        return err('dead', `${command.target} is dead; hit points alone will not bring them back`);
      }
      const apart = measured(
        state,
        id,
        command.target,
        `${found.line.name} reaches one creature within ${heals.within} feet of ${id}`,
      );
      if (!apart.ok) return apart;
      if (apart.value > heals.within) {
        return err(
          'out_of_range',
          `${command.target} is ${apart.value} feet from ${id}, and ${found.line.name} reaches ${heals.within}`,
        );
      }

      const spent = spendTheLine(state, id, found, stamp);
      if (!spent.ok) return spent;
      const events: GameEvent[] = [...spent.value];

      // The dice, thrown by the engine; SRD Beacon of Hope's maximum is the
      // recipient's rule and reaches them here as it does every heal.
      const issuedBefore = supply.issuer.count;
      const rolled = rollRecorded(
        supply.issuer,
        supply.rng,
        heals.dice,
        healingRuleOf(target.healingRules) === 'maximised'
          ? [maximisedHealing('the maximum possible')]
          : [],
      );
      if (!rolled.ok) return rolled;
      const amount = rolled.value.total + heals.flat;
      events.push(
        {
          type: 'roll-recorded',
          who: id,
          label: `${found.line.name} (${heals.dice})`,
          natural: rolled.value.total,
          total: amount,
          contributions: [{ source: "the spell's level", amount: heals.flat }],
          outcome: `${amount} hit points`,
        },
        {
          type: 'rolls-issued',
          count: supply.issuer.count - issuedBefore,
          rng: supply.rng.snapshot(),
        },
      );

      const world = events.reduce(applyEvent, state);
      const before = world.creatures[command.target]?.vitals.hp ?? 0;
      const healed = healCreature(
        world,
        command.target,
        Math.max(1, amount),
        {},
        printedLineSource(id, found.line.name),
      );
      if (!healed.ok) return healed;
      events.push(...healed.value);
      const after = healed.value.reduce(applyEvent, world).creatures[command.target]?.vitals.hp ?? before;

      return ok({ events, healed: after - before, unverified: [], duplicate: false });
    },
  );
}

/**
 * The limbs that fall as the turn in progress ends — SRD Troll's Loathsome
 * Limbs (4/Day). M-RISE.
 *
 * > If the troll ends any turn Bloodied and took 15+ Slashing damage during
 * > that turn, one of the troll's limbs is severed, falls into the troll's
 * > space, and becomes a **Troll Limb**. The limb acts immediately after the
 * > troll's turn. The troll has 1 Exhaustion level for each missing limb, and
 * > it grows replacement limbs the next time it regains Hit Points.
 *
 * **Any turn, so every holder is asked at every turn's end**, and asked
 * *before* the order moves on: a limb cut at the end of the troll's own turn is
 * seated straight after it and so takes the very next turn, which is "acts
 * immediately after the troll's turn" read for the one case where the two
 * could come apart. The turn's damage is the fold's count
 * (`CreatureState.turnDamage`) for this turn and no other.
 *
 * **What it writes is what already exists.** The limb arrives through
 * `summonCreature` — the block the trait names, on the holder's side and its
 * Initiative, seated after it — stands in the holder's space (placed, then
 * dropped into the occupied space as a fall rather than a move of its own:
 * `forced`), and `limb-severed` counts the limb, its Exhaustion and the day's
 * use. Nobody names the limb, because nobody decides to sever it: its id is
 * the holder's own with the first free ordinal, which a replay derives the same.
 * The regrowth is the fold's, at the next heal.
 *
 * A generator is not needed, but a catalogue is — the limb's block is read out
 * of content — so a turn's end that owes a limb and has no `Supply` refuses
 * `limb_owed` rather than advancing past the sentence.
 */
export function severedLimbsAt(
  state: GameState,
  supply: Supply | undefined,
): Result<readonly GameEvent[]> {
  if (state.combat === null) return ok([]);
  const turn = state.combat.turnsTaken;
  const events: GameEvent[] = [];
  let current = state;
  const land = (more: readonly GameEvent[]): void => {
    events.push(...more);
    current = more.reduce(applyEvent, current);
  };

  for (const key of Object.keys(state.creatures).sort()) {
    const holder = current.creatures[key];
    if (holder === undefined || holder.vitals.dead) continue;
    const severing = printedLimbSevering(holder.sheet);
    if (severing === null || !isBloodied(holder)) continue;
    const took = holder.turnDamage?.turn === turn ? (holder.turnDamage.byType[severing.damageType] ?? 0) : 0;
    if (took < severing.atLeast) continue;
    if (severing.perDay !== null && tallied(holder.resources, SEVERED_LIMB_TALLY) >= severing.perDay) {
      continue;
    }
    if (supply === undefined) {
      return err(
        'limb_owed',
        `${key} ends this turn Bloodied having taken ${took} ${severing.damageType} damage, and a limb falls; ending the turn needs the catalogue to raise it`,
      );
    }
    const who = key as CharacterId;
    let ordinal = 1;
    while (current.creatures[`${key}-limb-${ordinal}`] !== undefined) ordinal += 1;
    const limb = `${key}-limb-${ordinal}` as CharacterId;
    const rung = current.combat?.order.find((one) => one.id === who);

    const raised = summonCreature(current, supply.content, {
      id: limb,
      monsterId: severing.block,
      by: who,
      ...(rung === undefined ? {} : { initiative: rung.initiative, after: who }),
    });
    if (!raised.ok) return raised;
    land(raised.value.events);

    if (current.scene?.positions[who] !== undefined) {
      const placed = placeCreatureInScene(current, limb, { from: { creature: who }, feet: 0 });
      if (!placed.ok) return placed;
      land(placed.value);
      // "falls into the troll's space" — a fall, not a move the limb makes.
      land([{ type: 'creature-moved', id: limb, placement: { from: { creature: who }, feet: 0 }, forced: true }]);
    }
    land([{ type: 'limb-severed', id: who, limb, tally: SEVERED_LIMB_TALLY }]);
  }
  return ok(events);
}

export interface PrintedRaiseCommand extends CommandIdentity {
  readonly line: string;
  /**
   * The corpse the line targets — SRD Create Specter's "a Humanoid corpse
   * within 10 feet". A creature the engine holds, dead. The table's choice.
   */
  readonly corpse?: CharacterId;
  /**
   * What to call the creature that rises. The book names no creature and the
   * engine invents no name, exactly as SRD Split's two halves are named.
   */
  readonly into?: CharacterId;
}

export interface PrintedRaiseOutcome {
  readonly events: readonly GameEvent[];
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Take a printed line that raises a creature out of a corpse and keeps it
 * under its holder's control — SRD Wraith, Create Specter. M-RISE.
 *
 * > The wraith targets a Humanoid corpse within 10 feet of itself that has
 * > been dead for no longer than 1 minute. The target's spirit rises as a
 * > **Specter** in the space of its corpse or in the nearest unoccupied space.
 * > The specter is under the wraith's control. The wraith can have no more than
 * > seven specters under its control at a time.
 *
 * **Every clause is a fact the engine already holds.** The corpse is a dead
 * creature with a type and a `Vitals.diedAt`; the distance is the ruler's; the
 * block arrives through `summonCreature` and stands through
 * `placeCreatureInScene` measured from the corpse at no distance, which is the
 * corpse's space where it is free and the nearest unoccupied one where it is
 * not — the sentence's own two answers. "Under the wraith's control" is
 * `SummonBond.controlled` with no lapse, named by this line's own source, and
 * the seven are counted over the live creatures bound that way. The corpse
 * stays where it lies: it is the spirit that rises, and a spirit rises once.
 *
 * **What it does not do is seat the specter.** The book gives a raised
 * creature no place in the order, so it arrives without one and the table
 * rolls its Initiative, as for any creature a fight did not start with — said
 * in the report rather than invented.
 */
export function raisePrintedLine(
  state: GameState,
  id: CharacterId,
  command: PrintedRaiseCommand,
  supply: Supply,
): Result<PrintedRaiseOutcome> {
  return once(
    state,
    `printed-raise:${id}`,
    command,
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      const owedHere = mayAct(state, id, 'act');
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        return err('not_in_combat', 'there is no turn to spend a printed line from outside combat');
      }

      const found = printedLineOf(state, id, command.line);
      if (found === null) {
        return err(
          'no_such_line',
          `no line called ${command.line} is printed under this creature's Actions or Bonus Actions`,
        );
      }
      const raises = 'raises' in found.line ? found.line.raises : undefined;
      if (raises === undefined) {
        return err(
          'line_states_no_raise',
          `${found.line.name} states no raising this engine could read; take it with the door that hands the sentence over`,
        );
      }

      const refused = headingRefusal(state, id, found);
      if (refused !== null) return refused;

      if (command.corpse === undefined) {
        return needsContext(
          'undeclared_corpse',
          `${found.line.name} targets "a ${raises.corpseType} corpse within ${raises.within} feet", and nobody has said which`,
          [
            {
              kind: 'creature',
              subject: id,
              need: `the corpse ${found.line.name} targets`,
              because: 'the book offers a choice of corpses and the engine makes none of them',
              satisfyWith: 'raisePrintedLine again with its corpse filled in',
            },
          ],
        );
      }
      const corpse = creatureOf(state, command.corpse);
      if (corpse === null) return unknownCreature(command.corpse);
      if (!corpse.vitals.dead) {
        return err('not_a_corpse', `${command.corpse} is not dead, and ${found.line.name} targets a corpse`);
      }
      if (corpse.creatureType?.toLowerCase() !== raises.corpseType.toLowerCase()) {
        return err(
          'wrong_creature_type',
          `${found.line.name} targets a ${raises.corpseType} corpse, and ${command.corpse} is ${
            corpse.creatureType === null ? 'of no type anybody stated' : `a ${corpse.creatureType}`
          }`,
        );
      }
      const diedAt = corpse.vitals.diedAt;
      if (diedAt === null) {
        return err(
          'death_unrecorded',
          `${command.corpse} is dead and the log does not say when, so whether it has been dead for no longer than ${raises.deadForAtMostSeconds} seconds cannot be told`,
        );
      }
      if (state.elapsed - diedAt > raises.deadForAtMostSeconds) {
        return err(
          'dead_too_long',
          `${command.corpse} has been dead for ${state.elapsed - diedAt} seconds, and ${found.line.name} targets a corpse dead for no longer than ${raises.deadForAtMostSeconds}`,
        );
      }
      // "The target's spirit rises" — once. A corpse something has already
      // risen out of has no spirit left in it for a second line to raise.
      const risen = Object.keys(state.creatures)
        .sort()
        .find((key) => state.creatures[key]?.raisedFrom === command.corpse);
      if (risen !== undefined) {
        return err(
          'spirit_already_risen',
          `${risen} has already risen out of ${command.corpse}, and a spirit rises once`,
        );
      }
      const apart = measured(
        state,
        id,
        command.corpse,
        `${found.line.name} targets a corpse within ${raises.within} feet of ${id}`,
      );
      if (!apart.ok) return apart;
      if (apart.value > raises.within) {
        return err(
          'out_of_range',
          `${command.corpse} lies ${apart.value} feet from ${id}, and ${found.line.name} reaches ${raises.within}`,
        );
      }

      // "No more than seven … under its control at a time": the live creatures
      // this line's own control holds. A destroyed one is under nobody's.
      const bondKey = printedLineSource(id, found.line.name);
      const held = Object.values(state.creatures).filter(
        (one) =>
          one.summonedBy?.by === id &&
          one.summonedBy.controlled?.spell === bondKey &&
          !one.vitals.dead,
      ).length;
      if (held >= raises.controlsAtMost) {
        return err(
          'controls_too_many',
          `${id} already has ${held} creatures under its control from ${found.line.name}, and the line allows no more than ${raises.controlsAtMost}`,
        );
      }

      if (command.into === undefined) {
        return needsContext(
          'undeclared_creature',
          `${found.line.name} raises a creature, and nobody has said what it is called`,
          [
            {
              kind: 'creature',
              subject: id,
              need: 'what the risen creature is called',
              because: 'the book names no creature and the engine invents no name',
              satisfyWith: 'raisePrintedLine again with into filled in',
            },
          ],
        );
      }

      const spent = spendTheLine(state, id, found, stamp);
      if (!spent.ok) return spent;
      const events: GameEvent[] = [...spent.value];
      let current = events.reduce(applyEvent, state);
      const land = (more: readonly GameEvent[]): void => {
        events.push(...more);
        current = more.reduce(applyEvent, current);
      };

      const raised = summonCreature(current, supply.content, {
        id: command.into,
        monsterId: raises.block,
        by: id,
        controlled: { spell: bondKey },
        raisedFrom: command.corpse,
      });
      if (!raised.ok) return raised;
      land(raised.value.events);

      // "in the space of its corpse or in the nearest unoccupied space": a
      // placement at no distance from the corpse is exactly that pair.
      const stood = placeCreatureInScene(current, command.into, {
        from: { creature: command.corpse },
        feet: 0,
      });
      if (!stood.ok) return stood;
      land(stood.value);

      return ok({
        events,
        unverified: [
          ...raised.value.unverified,
          `${command.into} has no place in the order yet; roll its Initiative to seat it`,
        ],
        duplicate: false,
      });
    },
  );
}
