/**
 * The moves a printed line makes before its save — W7-B9.
 *
 * SRD Bulette, Deadly Leap: "The bulette spends 5 feet of movement to jump to
 * a space within 15 feet that contains one or more Large or smaller creatures.
 * _Dexterity Saving Throw:_ DC 15, each creature in the bulette's destination
 * space." SRD Centaur Trooper, Trampling Charge: "The centaur moves up to its
 * Speed without provoking Opportunity Attacks and can move through the spaces
 * of Medium or smaller creatures. Each creature whose space the centaur enters
 * is targeted once by the following effect. _Strength Saving Throw:_ DC 14."
 *
 * **One door for the two, and it is the DM's.** `forcePrintedSave` rolls a
 * save over a head count the caller supplies, because an area is measured from
 * an origin and a facing nobody declared; these two lines are the opposite
 * case — who the save catches is *whoever's space the mover entered*, and the
 * lattice knows that better than any caller. So the caller states the
 * destination or the route, and the engine checks it against the printed
 * allowance, moves the creature, and rolls the save once per creature whose
 * space was entered, through `forcePrintedSaveOn`, the same body every
 * printed save lands through. A caller who names targets on such a line at
 * the other door is refused `line_moves_first`.
 *
 * **The economy is the one every printed-line door spends**, in the order they
 * all spend it — the form gate, the recharge, the day's uses, then the slot
 * the heading names — and every refusal the geometry can raise comes before
 * any of it, so a leap at an empty space costs the bulette nothing.
 */

import { type CharacterId, err, needsContext, ok, type Result } from '@ie/shared';
import { spendMovement } from '../combat.js';
import { isIncapacitated } from '../conditions.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { wrongFormFor } from '../forms.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  describePerDay,
  describeRecharge,
  perDayTallyKey,
  printedLineSource,
  statedActionOf,
  statedBonusActionOf,
} from '../monster.js';
import type { CharacterSheet, StatedAction, StatedBonusAction } from '../character.js';
import {
  canPassThrough,
  checkRoute,
  costOfRoute,
  crossingsAlong,
  distanceBetweenPoints,
  moveCreature,
  type Placement,
  type Point,
  positionOf,
  sizeAtMost,
  sizeOf,
} from '../positioning.js';
import { tallied } from '../resources.js';
import { effectiveSizeOf } from '../size.js';
import { actionRulesOn, speedOf } from '../standing.js';
import type { Supply } from './casting.js';
import { anchorNeeded, creatureOf, ROUTE_REQUIRED, sceneFor, spendFor, unknownCreature } from './command.js';
import { mayAct } from './holds.js';
import {
  forcePrintedSaveOn,
  type PrintedSaveOnACreature,
  withDeclaredDamage,
} from './printed-save-clauses.js';

export interface PrintedMoveCommand extends CommandIdentity {
  readonly line: string;
  /**
   * Where a **jump** lands, relative to something already established — the
   * bulette's "a space within 15 feet that contains one or more Large or
   * smaller creatures". The one fact the table supplies; the engine checks
   * the reach and who is standing there. Absent is asked about.
   */
  readonly to?: Placement;
  /**
   * The spaces a **walk** enters, in order, ending where it ends — the
   * centaur's "can move through the spaces of Medium or smaller creatures".
   * The same field a move states for Difficult Terrain, and for the same
   * reason: which spaces were crossed is not something the engine may decide,
   * and here it is also who saves. Absent is asked about.
   */
  readonly route?: readonly Point[];
}

export interface PrintedMoveOutcome {
  readonly events: readonly GameEvent[];
  /** How far the creature went, on the lattice. */
  readonly feet: number;
  /** One per creature whose space was entered, in id order. */
  readonly outcomes: readonly PrintedSaveOnACreature[];
  /** What the engine applied without being able to check, and what it handed over. */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/** The heading and the slot it costs, found on a sheet. Actions first, as every printed door searches. */
function printedLineNamed(
  sheet: CharacterSheet,
  name: string,
): { readonly line: StatedAction | StatedBonusAction; readonly slot: 'action' | 'bonus-action' } | null {
  const action = statedActionOf(sheet, name);
  if (action !== null) return { line: action, slot: 'action' };
  const bonus = statedBonusActionOf(sheet, name);
  return bonus === null ? null : { line: bonus, slot: 'bonus-action' };
}

/**
 * The distinct creatures a set of crossings entered, in id order — the same
 * order `takePrintedPull` drags in, so two saves over one world land the same
 * way on every replay.
 */
function enteredBy(crossings: readonly { readonly occupant: CharacterId }[]): readonly CharacterId[] {
  return [...new Set(crossings.map((crossing) => crossing.occupant))].sort();
}

/**
 * Take the move a creature's printed line makes, and roll the save it forces
 * on everybody whose space was entered.
 *
 * Two arms off the pinned record's `movesThen`, and everything after the move
 * is one code path:
 *
 * - **`jump-to`** — the destination is resolved through the same placement
 *   rules every position goes through, with the one rule relaxed that the
 *   sentence relaxes: it may end in an occupied space, and must. The distance
 *   is the lattice's and is checked against the printed reach; everybody in
 *   the box the mover lands as must be no bigger than the printed size, and
 *   there must be somebody. The printed feet are spent from the turn's own
 *   movement — "spends 5 feet of movement" — and not the fifteen cleared.
 * - **`move-through`** — the route is checked as a move's is (`checkRoute`),
 *   every space it enters is read for occupants, and a creature bigger than
 *   the printed size whom the glossary would not let the mover pass is
 *   `blocked_by_creature`. The walk ends in an unoccupied space, costs what
 *   the ground charges, is capped at the creature's Speed, and is a granted
 *   move rather than the turn's own — SRD Tactical Shift's shape — so it
 *   spends none of the turn's feet. It provokes nothing, because the line
 *   says so.
 *
 * Then one save per creature entered, each over the world the last one left,
 * so a push on a success lands where the previous target already is.
 */
export function takePrintedMove(
  state: GameState,
  id: CharacterId,
  command: PrintedMoveCommand,
  supply: Supply,
): Result<PrintedMoveOutcome> {
  return once(
    state,
    `printed-move:${id}`,
    command,
    () => ({ events: [], feet: 0, outcomes: [], unverified: [], duplicate: true }),
    (stamp) => {
      // The same two holds `resolveMove` refuses, because this is a move.
      if (state.pendingMove !== null) {
        return err('move_pending', `${state.pendingMove.mover} is already mid-move; settle it first`);
      }
      if (state.pendingAttack !== null) {
        return err('attack_pending', 'a hit is waiting for its damage; settle it first');
      }
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        return err('not_in_combat', 'there is no turn to spend a printed line from outside combat');
      }

      const found = printedLineNamed(creature.sheet, command.line);
      if (found === null) {
        return err(
          'no_such_line',
          `no line called ${command.line} is printed under this creature's Actions or Bonus Actions; a printed attack is taken by the command that swings it, and a heading printed under another section by the command that owns that one`,
        );
      }
      const { line, slot } = found;
      const printed = line.save;
      const move = printed?.movesThen;
      if (printed === undefined || move === undefined) {
        return err(
          'line_moves_nobody',
          `${line.name} states no move-then-save this engine could read; a line that grants a move is spent by the door that hands the turn its feet, and a line that forces a save standing still by the one that rolls over a head count`,
        );
      }

      // The economy's refusals, before any geometry: a leap the creature
      // cannot take at all is refused before anybody is asked where.
      const wrongForm = wrongFormFor(creature, line);
      if (wrongForm !== null) return err('wrong_form', wrongForm);
      const recharge = line.recharge ?? null;
      if (creature.expendedLines.includes(line.name)) {
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${recharge === null ? '' : `: ${describeRecharge(recharge)}`}`,
        );
      }
      const perDay = line.perDay ?? null;
      const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
      if (perDay !== null && usedToday >= perDay) {
        return err('daily_limit_reached', `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`);
      }

      // A damage type the block leaves to the table is asked for here, before
      // anything moves, as `forcePrintedSave` asks at its own door.
      const save = withDeclaredDamage(state, id, line.name, printed);
      if (!save.ok) return save;

      const scene = sceneFor(state, id, `${id} to move within`);
      if (!scene.ok) return scene;
      const from = positionOf(scene.value, id);
      if (from === null) {
        return needsContext('unplaced', `nobody has said where ${id} is standing, so there is nowhere to move from`, [
          {
            kind: 'position',
            subject: id,
            need: `where ${id} is standing`,
            because: 'a move is measured from where the mover starts',
            satisfyWith: `a placeCreatureInScene command for ${id}`,
          },
        ]);
      }
      const sizeHere = (who: CharacterId) => effectiveSizeOf(state, who) ?? sizeOf(scene.value, who) ?? 'medium';
      const rules = actionRulesOn(state, id);
      const walk = speedOf(state, id);

      let feet: number;
      let placement: Placement;
      let entered: readonly CharacterId[];
      let intoOccupied = false;
      const movement: GameEvent[] = [];

      if (move.kind === 'jump-to') {
        if (command.to === undefined) {
          return needsContext(
            'undeclared_destination',
            `${line.name} jumps ${id} to a space within ${move.within} feet that holds one or more ${move.intoOccupiedBy} or smaller creatures, and nobody has said which space`,
            [
              {
                kind: 'position',
                subject: id,
                need: `the space ${id} lands in`,
                because: 'the book offers a choice of occupied spaces and the engine makes none of them',
                satisfyWith: 'takePrintedMove again with `to` filled in',
              },
            ],
          );
        }
        // Landing in an occupied space is what the sentence says, so the one
        // rule a shove relaxes is relaxed here — and the fold relaxes the same
        // one off `intoOccupied`, so the command and the fold agree.
        const landed = moveCreature(scene.value, id, command.to, { forced: true });
        if (!landed.ok) return anchorNeeded(landed, command.to.from, `${id} is leaping relative to it`);
        feet = landed.value.distance;
        if (feet > move.within) {
          return err('leap_too_far', `${line.name} reaches a space within ${move.within} feet, and that one is ${feet} away`);
        }
        const to = positionOf(landed.value.state, id);
        if (to === null) return needsContext('unplaced', `${id} did not land anywhere`);
        // Everybody in the box the mover lands as, not only at its own point.
        entered = enteredBy(crossingsAlong(scene.value, id, [to]));
        if (entered.length === 0) {
          return err(
            'nobody_to_land_on',
            `${line.name} jumps to a space that contains one or more ${move.intoOccupiedBy} or smaller creatures, and nobody is standing there`,
          );
        }
        const big = entered.find((who) => !sizeAtMost(sizeHere(who), move.intoOccupiedBy));
        if (big !== undefined) {
          return err(
            'too_large_to_land_on',
            `${line.name} lands among ${move.intoOccupiedBy} or smaller creatures, and ${big} is ${sizeHere(big)}`,
          );
        }
        // "spends 5 feet of movement": the printed price, out of the turn's own.
        const spent = spendMovement(state.combat, id, move.feetSpent, walk, { rules });
        if (!spent.ok) return spent;
        movement.push({ type: 'movement-spent', id, feet: move.feetSpent, from, to });
        placement = command.to;
        intoOccupied = true;
      } else {
        const last = command.route?.[command.route.length - 1];
        if (command.route === undefined || last === undefined) {
          return needsContext(
            ROUTE_REQUIRED,
            `${line.name} moves ${id} up to its Speed through the spaces of ${move.throughSpacesOf} or smaller creatures, and who saves is whoever's space was entered; nobody has said which spaces`,
            [
              {
                kind: 'route',
                subject: id,
                need: `the spaces ${id} moves through, in order, ending where the move ends`,
                because: 'which spaces were crossed decides who the line catches, and that is not something the engine may decide',
                satisfyWith: 'takePrintedMove again with `route` filled in, as points of 5 feet each',
              },
            ],
          );
        }
        const checked = checkRoute(scene.value, from, last, command.route);
        if (!checked.ok) return checked;
        const spaces = checked.value;

        // "can move through the spaces of Medium or smaller creatures" — the
        // line's own permission, beside the glossary's. Anybody bigger whom
        // the glossary would not let this mover pass is in the way.
        const moverSize = sizeHere(id);
        const side = creature.side;
        const crossings = crossingsAlong(scene.value, id, spaces);
        for (const { space, occupant } of crossings) {
          const size = sizeHere(occupant);
          if (sizeAtMost(size, move.throughSpacesOf)) continue;
          const other = state.creatures[occupant];
          const allied = side !== null && other?.side != null && other.side === side;
          if (canPassThrough(moverSize, size, { allied, occupantIncapacitated: other !== undefined && isIncapacitated(other.conditions) })) {
            continue;
          }
          return err(
            'blocked_by_creature',
            `${occupant} is standing at (${space.x}, ${space.y}, ${space.z}) and is ${size}; ${line.name} moves through the spaces of ${move.throughSpacesOf} or smaller creatures`,
          );
        }

        // The walk ends in an unoccupied space: the last point named, at the
        // ordinary rule, so a route that stops on somebody is refused.
        placement = { from: { point: last }, feet: 0, bearing: 0 };
        const landed = moveCreature(scene.value, id, placement);
        if (!landed.ok) return landed;
        const to = positionOf(landed.value.state, id);
        if (to === null) return needsContext('unplaced', `${id} did not land anywhere`);
        feet = distanceBetweenPoints(from, to);

        // "moves up to its Speed": a granted move, SRD Tactical Shift's shape,
        // capped at the Speed the line was taken at. The ground charges what it
        // charges; a space another creature stands in is charged as the
        // ordinary move charges it.
        //
        // **The grant is the move, and nothing is left on the turn.** The line
        // grants one walk and this door performs the whole of it, so the grant
        // is pinned at what the route cost rather than at the Speed: a
        // remainder would be feet a later move could spend under this source
        // and provoke nobody with, for a line whose exemption was for the
        // charge alone.
        const cost = costOfRoute(state, spaces).cost;
        if (cost > walk) {
          return err('not_enough_movement', `${line.name} moves ${id} up to ${walk} feet, and this route costs ${cost}`);
        }
        const source = printedLineSource(id, line.name);
        const granted: GameEvent = { type: 'movement-granted', id, source, feet: cost };
        const spent = spendMovement(applyEvent(state, granted).combat!, id, cost, walk, { rules }, source);
        if (!spent.ok) return spent;
        movement.push(granted, { type: 'movement-spent', id, feet: cost, grant: source, from, to });
        entered = enteredBy(crossings);
      }

      // The slot the heading names, after every refusal the geometry can raise.
      const slotSpent = spendFor(state, id, slot);
      if (!slotSpent.ok) return slotSpent;
      const events: GameEvent[] = [
        slotSpent.value,
        ...(recharge === null ? [] : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
        ...(perDay === null
          ? []
          : [{ type: 'resource-spent' as const, id, key: perDayTallyKey(line.name), amount: 1, tally: 'dawn' as const }]),
        slot === 'action'
          ? { type: 'stated-action-taken' as const, id, line: line.name, ...(stamp === null ? {} : { command: stamp }) }
          : {
              type: 'stated-bonus-action-taken' as const,
              id,
              line: line.name,
              turn: state.combat.turnsTaken,
              ...(stamp === null ? {} : { command: stamp }),
            },
        ...movement,
        // No Opportunity Attack either way: the centaur's line says so, and a
        // jump into somebody's space leaves nobody's reach.
        {
          type: 'creature-moved',
          id,
          placement,
          ...(intoOccupied ? { intoOccupied: true as const } : {}),
        },
      ];

      // One save per creature entered, each over the world the last one left.
      // **Where the generator was before anything was thrown**, read once and
      // written back once at the end — `forcePrintedSave`'s shape: one
      // `rolls-issued` covers every save and every damage roll, so a replay
      // rewinds to the same faces under the same ids.
      const issuedBefore = supply.issuer.count;
      let world = events.reduce(applyEvent, state);
      const outcomes: PrintedSaveOnACreature[] = [];
      const unverified: string[] = [];
      for (const target of entered) {
        if (world.creatures[target]?.vitals.dead === true) continue;
        const landed = forcePrintedSaveOn(world, id, target, line.name, save.value, supply);
        if (!landed.ok) return landed;
        events.push(...landed.value.events);
        world = landed.value.events.reduce(applyEvent, world);
        outcomes.push(landed.value.outcome);
        unverified.push(...landed.value.unverified);
      }
      if (supply.issuer.count > issuedBefore) {
        events.push({
          type: 'rolls-issued',
          count: supply.issuer.count - issuedBefore,
          rng: supply.rng.snapshot(),
        });
      }
      for (const clause of printed.handedOver ?? []) {
        unverified.push(`${line.name}: "${clause}" — the engine does not apply that; a DM does`);
      }
      if (intoOccupied) {
        unverified.push(
          `${id} ends ${line.name} in a space shared with ${entered.join(', ')}; SRD's Prone for ending a turn in another creature's space is the turn's end to settle, and this engine does not settle it`,
        );
      }

      return ok({ events, feet, outcomes, unverified, duplicate: false });
    },
  );
}
