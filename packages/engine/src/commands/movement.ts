/**
 * Moving, and the Opportunity Attacks a move provokes.
 *
 * A move that provokes nobody simply happens; a move that provokes somebody is
 * declared and completes when the last reactor has answered. That offer list
 * is the shape every Reaction window in the engine was generalised from.
 */

import { type CharacterId, err, needsContext, ok, type Result } from '@ie/shared';
import { reachOf } from '../attack.js';
import { spendMovement, spendReaction } from '../combat.js';
import { isIncapacitated } from '../conditions.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  distanceToPoint,
  moveCreature,
  type Placement,
  type Point,
  positionOf,
  sightBetween,
} from '../positioning.js';
import { type AttackResolution, resolveAttack } from './attacks.js';
import { type ConcentrationSaveSupply } from './casting.js';
import { creatureOf, unknownCreature } from './command.js';
import { completeIfSettled, mayAct } from './holds.js';
import { sweptRoute } from './ongoing.js';

export interface MoveCommand extends CommandIdentity {
  /** Where to, relative to something already established. */
  readonly placement: Placement;
  /**
   * Movement somebody else is doing to you.
   *
   * SRD makes an Opportunity Attack available only when a creature leaves your
   * reach "using its action, its Bonus Action, its Reaction, or one of its
   * speeds". Being shoved by Thunderwave is none of those, and it is not the
   * creature's own movement either, so it costs no Speed and provokes nobody.
   */
  readonly forced?: boolean;
  /**
   * How many feet of this move are through Difficult Terrain.
   *
   * SRD: "every foot of movement in that space costs 1 extra foot", and
   * "Difficult Terrain isn't cumulative; either a space is Difficult Terrain or
   * it isn't" — which declaring *feet* rather than sources makes true for
   * free, since there is no way to say a space is difficult twice.
   *
   * Declared rather than deduced, on the same grounds as cover and line of
   * sight: five of the SRD's six environmental cases are fiction — snow,
   * rubble, furniture, a slope, a narrow opening — and working them out means
   * modelling the room. The seventh, another creature's space, the engine
   * *can* see, and `isDifficultTerrain` has answered it since positioning
   * landed, for a caller working out the number to declare.
   */
  readonly difficultFeet?: number;
}

export interface MoveResolution {
  readonly events: readonly GameEvent[];
  /** How far they went, on the same 5-foot lattice as everything else. */
  readonly feet: number;
  /** What it cost, which is the distance plus every difficult foot again. */
  readonly cost: number;
  /** Facts the engine could not check — see `AttackResolution.unverified`. */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Move, spending the Speed it costs and offering what it provokes.
 *
 * `moveCreature` and `spendMovement` have both existed since positioning and
 * combat landed, and nothing called either: a creature could cross a
 * battlefield without spending a foot, and nobody ever got an Opportunity
 * Attack, because no command sat between the two.
 *
 * SRD: "The attack occurs right before the creature leaves your reach." So a
 * move that provokes does not happen yet — it is declared, held, and completed
 * once every provoked creature has answered. Same shape as a held attack, and
 * for the same reason: the rule needs a moment between two things that would
 * otherwise happen at once.
 */
export function resolveMove(
  state: GameState,
  id: CharacterId,
  command: MoveCommand,
  supply: ConcentrationSaveSupply,
): Result<MoveResolution> {
  return moveWithin(state, id, command, supply, null);
}

/**
 * {@link resolveMove}, and the same thing paid for out of something else.
 *
 * `allowance` is null for an ordinary move, which draws on the turn budget,
 * and a number of feet for a move the turn budget knows nothing about — SRD
 * Ready's "move up to your Speed in response to it", taken on somebody else's
 * turn. One function rather than two because everything except where the feet
 * come from is identical, Opportunity Attacks included.
 */
export function moveWithin(
  state: GameState,
  id: CharacterId,
  command: MoveCommand,
  supply: ConcentrationSaveSupply,
  allowance: number | null,
): Result<MoveResolution> {
  void supply;

  return once(state, `move:${id}`, command, () => {
    return { events: [], feet: 0, cost: 0, unverified: [], duplicate: true };
  }, (stamp) => {
    if (state.pendingMove !== null) {
      return err('move_pending', `${state.pendingMove.mover} is already mid-move; settle it first`);
    }
    if (state.pendingAttack !== null) {
      return err('attack_pending', 'a hit is waiting for its damage; settle it first');
    }
    // Walking on out of an area that has already caught you would leave the
    // engine owing a save against a Web the mover is no longer standing in.
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const mover = creatureOf(state, id);
    if (mover === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (state.scene === null) return needsContext('no_scene', 'there is no scene to move within');

    const from = positionOf(state.scene, id);
    if (from === null) {
      return needsContext(
        'unplaced',
        `nobody has said where ${id} is standing, so there is nowhere to move from`,
        [
          {
            kind: 'position',
            subject: id,
            need: `where ${id} is standing`,
            because: 'a move is measured from where the mover starts',
            satisfyWith: `a creature-placed event for ${id}`,
          },
        ],
      );
    }

    // Resolve the destination through the same placement rules everything else
    // uses, so the move is measured on the lattice rather than in a straight line.
    const moved = moveCreature(state.scene, id, command.placement);
    if (!moved.ok) return moved;
    const to = positionOf(moved.value.state, id);
    if (to === null) return needsContext('unplaced', `${id} did not land anywhere`);

    // The distance positioning itself measured, on the lattice, between volumes.
    const feet = moved.value.distance;

    // **A carried area sweeps, and a move of more than one space does not say
    // what it swept.** Checked before any cost, any budget and any Opportunity
    // Attack, so a move that needs its route stated costs nothing to ask about.
    const sweeping = sweptRoute(state, state.scene, moved.value.state);
    if (sweeping.length > 0) {
      return needsContext(
        'route_required',
        `${id} is carrying ${sweeping.length === 1 ? 'an area' : 'areas'} that catch every creature they move into, and a move of ${feet} feet crosses spaces nothing records; send the move again as single 5-foot steps`,
        sweeping,
      );
    }

    // SRD: "every foot of movement in that space costs 1 extra foot."
    const difficult = command.difficultFeet ?? 0;
    if (!Number.isInteger(difficult) || difficult < 0 || difficult > feet) {
      return err(
        'bad_difficult_terrain',
        `a ${feet}-foot move cannot pass through ${difficult} feet of Difficult Terrain`,
      );
    }
    const cost = feet + difficult;

    // — what it costs ——————————————————————————————————————————————————————
    //
    // Forced movement is not the creature's own, so it spends none of their
    // Speed. Outside combat there is no budget to spend at all.
    const events: GameEvent[] = [];
    if (allowance !== null) {
      // A readied move: the Reaction paid for it, so no Speed is spent and
      // nothing is recorded against a budget this move does not belong to.
      if (cost > allowance) {
        return err(
          'not_enough_movement',
          `${id} may move up to ${allowance} feet in response, and that move costs ${cost}`,
        );
      }
    } else if (
      state.combat !== null &&
      state.combat.budgets[id] !== undefined &&
      command.forced !== true
    ) {
      const spent = spendMovement(state.combat, id, cost, mover.conditions);
      if (!spent.ok) {
        return spent.code === 'not_enough_movement' || spent.code === 'no_movement'
          ? spent
          : err('not_enough_movement', spent.reason);
      }
      events.push({ type: 'movement-spent', id, feet: cost });
    }

    // — what it provokes ———————————————————————————————————————————————————
    // SRD Disengage: "your movement doesn't provoke Opportunity Attacks for the
    // rest of the current turn." Forced movement provokes nothing either, for a
    // different reason — it is not the creature's movement at all.
    // SRD Disengage: "for the rest of the current turn." A readied move is taken
    // on a later turn, so a Disengage taken on the mover's own turn does not
    // reach it — and it could not have been taken on the same turn anyway, since
    // Disengage and Ready are both the action.
    const disengaged = allowance === null && state.combat?.budgets[id]?.disengaged === true;
    const opportunity =
      command.forced === true || disengaged
        ? { provoked: [], unverified: [] }
        : provokedBy(state, id, from, to);

    if (opportunity.provoked.length === 0) {
      // Nobody is owed a swing, so this is the whole move and the stamp belongs
      // here. Without it the guard above computed a fingerprint that nothing
      // ever recorded: a retry moved the creature a second time, and an id
      // reused for different work was executed instead of refused.
      events.push({
        type: 'creature-moved',
        id,
        placement: command.placement,
        ...(command.forced === true ? { forced: true } : {}),
        ...(stamp === null ? {} : { command: stamp }),
      });
      return ok({ events, feet, cost, unverified: opportunity.unverified, duplicate: false });
    }

    events.push({
      type: 'movement-declared',
      move: {
        mover: id,
        placement: command.placement,
        destination: to,
        feet,
        provoked: opportunity.provoked,
      },
      ...(stamp === null ? {} : { command: stamp }),
    });

    return ok({ events, feet, cost, unverified: opportunity.unverified, duplicate: false });
  });
}

/**
 * Who may attack this creature for leaving, and what the engine could not check.
 *
 * SRD: "You can make an Opportunity Attack when a creature that you can see
 * leaves your reach." Four clauses, each of which is a way to get this wrong:
 *
 * - **leaves** your reach — within it at the start and outside it at the end.
 *   Circling an ogre at five feet provokes nothing.
 * - **your reach** — the reactor's, which a Reach weapon extends to ten.
 * - **that you can see** — declared, and three-valued. A creature nobody has
 *   said about is not thereby blind, so the offer is made and the fact
 *   reported rather than the rule being silently dropped.
 * - and they must have a Reaction to take, which an Incapacitated creature
 *   does not.
 */
function provokedBy(
  state: GameState,
  mover: CharacterId,
  from: Point,
  to: Point,
): {
  readonly provoked: readonly { readonly reactor: CharacterId; readonly reach: number }[];
  readonly unverified: readonly string[];
} {
  const scene = state.scene;
  const side = state.creatures[mover]?.side ?? null;
  if (scene === null) return { provoked: [], unverified: [] };

  const provoked: { reactor: CharacterId; reach: number }[] = [];
  const unverified: string[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const other = state.creatures[key];
    if (other === undefined || other.id === mover) continue;

    // An ally does not swing at you for walking away — the same conservative
    // reading an aura takes of "your allies". Declared and allied is settled;
    // an *undeclared* side is checked below, after the geometry, so that the
    // report only appears where it would actually have mattered.
    const allied = other.side !== null && side !== null && other.side === side;
    if (allied) continue;
    if (other.vitals.dead || isIncapacitated(other.conditions)) continue;
    if (state.combat !== null && state.combat.budgets[other.id]?.reaction === false) continue;

    const reach = reachOf(other);
    const before = distanceToPoint(scene, other.id, from);
    const after = distanceToPoint(scene, other.id, to);
    if (!before.ok || !after.ok) continue;
    if (!(before.value <= reach && after.value > reach)) continue;

    // Everything else about this creature says they would swing. If nobody
    // has said whose side they are on, the offer is withheld — and that is a
    // whole Reaction the table was never told about, so it is reported rather
    // than passing as a rule that checked and found nothing.
    if (other.side === null || side === null) {
      unverified.push(
        `nobody has said whose side ${other.side === null ? other.id : mover} is on, so ${other.id} was not offered an Opportunity Attack on ${mover}`,
      );
      continue;
    }

    // SRD: "a creature that you can see". Declared unseen is a refusal;
    // undeclared is a fact nobody has established, and withholding the
    // Reaction on that basis would be the engine deciding it.
    const seen = sightBetween(scene, other.id, mover);
    if (seen === false) continue;
    if (seen === null) {
      unverified.push(
        `nobody has said whether ${other.id} can see ${mover}, and an Opportunity Attack needs that; the offer was made rather than withheld`,
      );
    }

    provoked.push({ reactor: other.id, reach });
  }

  return { provoked, unverified };
}

export interface OpportunityCommand extends CommandIdentity {
  /** The weapon, by catalogue id, or null for an Unarmed Strike. */
  readonly weapon?: string | null;
}

/**
 * Take the Opportunity Attack a move offered.
 *
 * The mover is still standing where they were, so this is an ordinary attack
 * against an ordinary distance — which is the whole reason the move was held.
 * Spending the Reaction and completing the move when the last answer comes in
 * are both this command's, because the reducer cannot emit events.
 */
export function takeOpportunityAttack(
  state: GameState,
  reactor: CharacterId,
  command: OpportunityCommand,
  supply: ConcentrationSaveSupply,
): Result<AttackResolution> {
  // Before the offer is checked, exactly as `declineOpportunity` does it: the
  // first run answered the offer and completed the move, so a retry finds no
  // `pendingMove` and used to come back `not_provoked` — telling the caller
  // they were never offered the swing that in fact landed. The guard has to
  // precede validation or it reports the first run's consequences instead of
  // the fact that it happened.
  return once(state, `opportunity:${reactor}`, command, () => {
    return { events: [], attack: null, unverified: [], duplicate: true };
  }, (stamp) => {
    const waiting = state.pendingMove;
    if (waiting === null || !waiting.provoked.some((p) => p.reactor === reactor)) {
      return err('not_provoked', `${reactor} was not offered an Opportunity Attack`);
    }

    const events: GameEvent[] = [];
    if (state.combat !== null && state.combat.budgets[reactor] !== undefined) {
      const creature = creatureOf(state, reactor);
      const spent = spendReaction(state.combat, reactor, creature?.conditions);
      if (!spent.ok) return spent;
      events.push({ type: 'reaction-spent', id: reactor });
    }

    // The attack itself goes through the ordinary command, so every derivation
    // it makes — cover, conditions, proficiency, the target's defences — applies
    // here too rather than being reimplemented for this one case.
    const after = events.reduce(applyEvent, state);
    const swing = resolveAttack(
      after,
      reactor,
      {
        target: waiting.mover,
        weapon: command.weapon ?? null,
        // The Reaction above is what this costs; it is not the Attack action.
        free: true,
        // No id: this command owns the guard, and the same id fingerprinted
        // twice under two kinds would make the retry read as a reused id.
        // Same split as `releaseReady`, which guards the release and hands the
        // inner move no id of its own.
      },
      supply,
    );
    if (!swing.ok) return swing;

    const answered: GameEvent[] = [
      ...events,
      ...swing.value.events,
      {
        type: 'opportunity-answered',
        reactor,
        took: true,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ];

    return ok({
      ...swing.value,
      events: [...answered, ...completeIfSettled(state, answered)],
    });
  });
}

/** Pass on an Opportunity Attack that was offered. */
export function declineOpportunity(
  state: GameState,
  reactor: CharacterId,
  command: CommandIdentity,
): Result<GameEvent[]> {
  // The retry used to come back `not_provoked`, which reads as "you were never
  // offered that" — and a decline that lands twice would complete the move
  // twice. Both are fixed by the same stamp.
  return once(state, `decline:${reactor}`, command, () => [], (stamp) => {
    const waiting = state.pendingMove;
    if (waiting === null || !waiting.provoked.some((p) => p.reactor === reactor)) {
      return err('not_provoked', `${reactor} was not offered an Opportunity Attack`);
    }

    const answered: GameEvent[] = [
      {
        type: 'opportunity-answered',
        reactor,
        took: false,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ];
    return ok([...answered, ...completeIfSettled(state, answered)]);
  });
}

