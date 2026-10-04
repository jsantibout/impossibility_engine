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
import { actionRulesOn, requirementsHold } from '../standing.js';
import { applyEvent, type CommandStamp, type GameEvent, type GameState } from '../events.js';
import { distanceBetween } from '../positioning.js';
import {
  describePerDay,
  describeRecharge,
  perDayTallyKey,
  printedLineSource,
  statedActionOf,
  statedBonusActionOf,
} from '../monster.js';
import { tallied } from '../resources.js';
import { rollRecorded, type RollIssuer } from '../rolls.js';
import { type Rng } from '../dice.js';
import { healingRuleOf, maximisedHealing } from '../vitals.js';
import { creatureOf, unknownCreature } from './command.js';
import { healCreature } from './creatures.js';
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
