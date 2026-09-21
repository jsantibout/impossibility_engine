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
import { actionRulesOn, canSee, sheetAsItStands, speedOf } from '../standing.js';
import type { CharacterSheet } from '../character.js';
import { bestPrintedMeleeAttack } from '../monster.js';
import {
  checkRoute,
  costOfRoute,
  dismount,
  distanceToPoint,
  mount,
  mountingCost,
  type MountOptions,
  moveCreature,
  type Placement,
  type Point,
  type PositionState,
  liveTerrainNames,
  positionOf,
  uniformTerrainBetween,
} from '../positioning.js';
import { type AttackResolution, resolveAttack } from './attacks.js';
import { type Content } from '../content.js';
import { type Supply } from './casting.js';
import {
  creatureOf,
  ROUTE_REQUIRED,
  sceneFor,
  SINGLE_STEPS_REQUIRED,
  unknownCreature,
} from './command.js';
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
  /**
   * The 5-foot spaces this move passed through, in order, ending where it ends.
   *
   * **The table's half of a cost the engine works out.** A move records where
   * it began and where it ended and nothing in between, so a walk that clips
   * the corner of a Web has a cost the endpoints cannot answer — and inferring
   * a line between them would be the engine deciding a route nobody took.
   * Stated here, the engine reads each space against the patches it already
   * holds and charges what they say.
   *
   * Needed only when the ground disagrees with itself along the way: if every
   * space a shortest route could enter charges the same, every shortest route
   * costs the same and the move is charged without asking. Where they
   * disagree the move is refused `route_required`, which is a context request
   * of kind `route` — the one kind satisfied by sending the same command again
   * with a field filled in.
   *
   * **Not the same answer `sweptRoute` gives, and the difference is a rule
   * rather than a preference.** A carried area that catches what it moves over
   * has to *settle* what each space raised before the next is entered, so it
   * asks for the move to be re-sent as single steps. Terrain settles nothing —
   * it changes a number — so stating the spaces in one command is the whole of
   * what it needs. **That is why the two carry different codes**: filling in
   * this field is the answer to one of them and not the other, and a caller
   * that could not tell which it had been asked would fill in `route`, be
   * asked again, and loop. See {@link SINGLE_STEPS_REQUIRED}.
   *
   * A route is a **shortest** path; see `checkRoute` for why a wandering one
   * is refused rather than charged. A move that spends nothing never needs
   * one at all — forced movement, and any move outside combat — because
   * Difficult Terrain costs movement and there is none being spent.
   */
  readonly route?: readonly Point[];
}

export interface MoveResolution {
  readonly events: readonly GameEvent[];
  /** How far they went, on the same 5-foot lattice as everything else. */
  readonly feet: number;
  /** What it cost, which is the distance plus every difficult foot again. */
  readonly cost: number;
  /** The patches of Difficult Terrain that charged for it, by name. */
  readonly terrain: readonly string[];
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
  supply: Supply,
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
  supply: Supply,
  allowance: number | null,
): Result<MoveResolution> {
  void supply;

  return once(state, `move:${id}`, command, () => {
    return { events: [], feet: 0, cost: 0, terrain: [], unverified: [], duplicate: true };
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
    // Homework rather than a verdict, through the same helper mounting uses:
    // the record is thin, and `setScene` is what settles it.
    const scene = sceneFor(state, id, `${id} to move within`);
    if (!scene.ok) return scene;

    const from = positionOf(scene.value, id);
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
            satisfyWith: `a placeCreatureInScene command for ${id}`,
          },
        ],
      );
    }

    // Resolve the destination through the same placement rules everything else
    // uses, so the move is measured on the lattice rather than in a straight line.
    const moved = moveCreature(scene.value, id, command.placement);
    if (!moved.ok) return moved;
    const to = positionOf(moved.value.state, id);
    if (to === null) return needsContext('unplaced', `${id} did not land anywhere`);

    // The distance positioning itself measured, on the lattice, between volumes.
    const feet = moved.value.distance;

    // **A carried area sweeps, and a move of more than one space does not say
    // what it swept.** Checked before any cost, any budget and any Opportunity
    // Attack, so a move that needs its route stated costs nothing to ask about.
    //
    // Under its own code, because it is asked first and the other question a
    // move can be asked about its route is answered a different way. See
    // {@link SINGLE_STEPS_REQUIRED}.
    const sweeping = sweptRoute(state, supply.content, scene.value, moved.value.state);
    if (sweeping.length > 0) {
      return needsContext(
        SINGLE_STEPS_REQUIRED,
        `${id} is carrying ${sweeping.length === 1 ? 'an area' : 'areas'} that catch every creature they move into, and a move of ${feet} feet crosses spaces nothing records; send the move again as single 5-foot steps`,
        sweeping,
      );
    }

    // SRD: "every foot of movement in that space costs 1 extra foot."
    //
    // **Two ways in, and they add rather than compete.** The patches the table
    // has declared are read off the lattice here; the number the mover
    // declares is for ground no patch covers — the snow, the slope, the narrow
    // opening — and every foot of that still costs a foot extra.
    const charging = chargingOf(state, id, command, allowance);
    const ground = chargeTerrain(state, scene.value, id, from, to, feet, charging, command.route);
    if (!ground.ok) return ground;

    const difficult = command.difficultFeet ?? 0;
    if (!Number.isInteger(difficult) || difficult < 0 || difficult > feet) {
      return err(
        'bad_difficult_terrain',
        `a ${feet}-foot move cannot pass through ${difficult} feet of Difficult Terrain`,
      );
    }
    const terrain = ground.value.patches;
    // **Both doors obey the same rule**, which is the whole reason `charging`
    // is one value rather than a condition spelled twice: a shove pays neither
    // the patches nor the feet the mover declared, because it is not the
    // creature's movement and Difficult Terrain costs movement.
    const cost = ground.value.cost + (charging === 'none' ? 0 : difficult);

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
          `${id} may move up to ${allowance} feet in response, and that move costs ${cost}${becauseOf(state, terrain)}`,
        );
      }
    } else if (
      state.combat !== null &&
      state.combat.budgets[id] !== undefined &&
      command.forced !== true
    ) {
      // **The economy's refusal is passed through under its own code.** This
      // rewrote everything that was not already about movement, and the one
      // other refusal reachable here is `not_their_turn` — SRD gives a
      // creature its movement on its own turn and nowhere else — so a move
      // taken out of turn reported `not_enough_movement` with a reason that
      // said "it is not b's turn". A caller branching on the code and a DM
      // reading the reason were given two different answers to one question,
      // which is exactly what a refusal being a value is meant to prevent.
      const spent = spendMovement(state.combat, id, cost, speedOf(state, id), {
        rules: actionRulesOn(state, id),
      });
      // **Running out of movement mid-square has to say what made the ground
      // expensive.** The economy knows a number was too big and nothing about
      // why, so a walker stopped halfway across a Web reads as arithmetic
      // unless the patch is named. The *code* is untouched — a caller may
      // branch on it, and this is the same refusal it always was.
      if (!spent.ok) {
        return spent.code === 'not_enough_movement' && terrain.length > 0
          ? err(
              'not_enough_movement',
              `${spent.reason}, and this ${feet}-foot move costs ${cost}${becauseOf(state, terrain)}`,
            )
          : spent;
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
        : provokedBy(state, supply.content, id, from, to);

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
      return ok({
        events,
        feet,
        cost,
        terrain,
        unverified: [...opportunity.unverified, ...ground.value.unverified],
        duplicate: false,
      });
    }

    events.push({
      type: 'movement-declared',
      move: {
        mover: id,
        placement: command.placement,
        destination: to,
        provoked: opportunity.provoked,
      },
      ...(stamp === null ? {} : { command: stamp }),
    });

    return ok({
      events,
      feet,
      cost,
      terrain,
      unverified: [...opportunity.unverified, ...ground.value.unverified],
      duplicate: false,
    });
  });
}

/**
 * What the ground is allowed to do to this move.
 *
 * **One value rather than a condition spelled in three places**, because the
 * three answers differ and each is a rule:
 *
 * | | | |
 * |---|---|---|
 * | `spend` | a budget is being drawn on | charge exactly, and ask when the path decides the number |
 * | `report` | there is no budget | charge what is unambiguous, and never ask |
 * | `none` | a shove | charge nothing, by either door |
 *
 * `spend` is the same predicate the budget below is gated on, and is written
 * here so the two cannot drift.
 */
type Charging = 'spend' | 'report' | 'none';

function chargingOf(
  state: GameState,
  id: CharacterId,
  command: MoveCommand,
  allowance: number | null,
): Charging {
  if (command.forced === true) return 'none';
  if (allowance !== null) return 'spend';
  return state.combat !== null && state.combat.budgets[id] !== undefined ? 'spend' : 'report';
}

interface TerrainChargeOutcome {
  readonly cost: number;
  readonly patches: readonly string[];
  /** What the engine could not settle and did not stop the table to ask about. */
  readonly unverified: readonly string[];
}

/**
 * What the ground charged for this move, and which patches charged it.
 *
 * Four cases, and only one of them costs the caller a second round trip:
 *
 * - **a shove** — charged nothing at all, by either door; see below;
 * - **a route was stated** — check it, and read the spaces one by one;
 * - **every space a shortest route could enter charges the same** — charge
 *   the distance at that rate, because no route could have cost differently;
 * - **the ground disagrees with itself** — refuse `route_required`, naming
 *   the field that answers it, or, where nothing is being spent, hand back
 *   the open-ground figure and say that is what it is.
 *
 * The third is what keeps a Web in the far corner of a room from turning
 * every move in that room into a two-step conversation, and the region it
 * asks about is exact rather than convenient — every space on some shortest
 * route and no other. `uniformTerrainBetween` is where that region is
 * computed, and where the reason it is wider than the box between the
 * endpoints is written down.
 */
function chargeTerrain(
  state: GameState,
  scene: PositionState,
  id: CharacterId,
  from: Point,
  to: Point,
  feet: number,
  charging: Charging,
  route: readonly Point[] | undefined,
): Result<TerrainChargeOutcome> {
  // **Difficult Terrain costs movement, and a shove is not the creature's
  // movement.** SRD offers an Opportunity Attack only against a creature
  // moving "using its action, its Bonus Action, its Reaction, or one of its
  // speeds", and being thrown by Thunderwave is none of those; `relocateOrigin`
  // already records the same reading for a spell's own point — "no Speed is
  // spent, no Difficult Terrain is charged".
  if (charging === 'none') return ok({ cost: feet, patches: [], unverified: [] });

  if (route !== undefined) {
    const checked = checkRoute(scene, from, to, route);
    if (!checked.ok) return checked;
    return ok({ ...costOfRoute(state, checked.value), unverified: [] });
  }

  // Nothing was entered, so nothing charged. A zero-foot move is a mount, a
  // dismount, or a placement that resolved to where the creature already was.
  if (feet === 0) return ok({ cost: 0, patches: [], unverified: [] });

  const uniform = uniformTerrainBetween(state, from, to);
  if (uniform !== null) {
    return ok({ cost: feet * uniform.costPerFoot, patches: uniform.patches, unverified: [] });
  }

  // **Outside combat there is nothing to run out of, so the question is
  // reported rather than raised.** A walk through a mire is still a walk
  // through a mire and what unambiguous ground costs is still charged above;
  // what would be wrong is stopping the table to itemise a route against a
  // budget that does not exist. The figure handed back is then the
  // open-ground one, and saying so is what keeps it from passing as the
  // answer.
  if (charging === 'report') {
    return ok({
      cost: feet,
      patches: [],
      unverified: [
        `the ground between (${from.x}, ${from.y}, ${from.z}) and (${to.x}, ${to.y}, ${to.z}) is Difficult Terrain in some places and not others — ${declaredHere(state)} — and no route was stated, so no patch was charged for this move; outside combat there was no budget for one to be charged against`,
      ],
    });
  }

  return needsContext(
    ROUTE_REQUIRED,
    `the ground between (${from.x}, ${from.y}, ${from.z}) and (${to.x}, ${to.y}, ${to.z}) is Difficult Terrain in some places and not others, so a ${feet}-foot move costs a different number of feet depending which spaces ${id} crossed`,
    [
      {
        kind: 'route',
        subject: id,
        need: `the ${feet / 5} spaces ${id} passed through, in order, ending where the move ends`,
        because:
          'every foot of movement in Difficult Terrain costs one extra foot, and which feet those were is not something the engine may decide',
        satisfyWith: `the same resolveMove command with route filled in, as ${feet / 5} points of 5 feet each`,
      },
    ],
  );
}

/**
 * Which patches are in play, for a report that asked nobody a question.
 *
 * **The live ones, through the same view every charge reads.** A patch whose
 * casting has ended charges nothing anywhere and made nothing about this
 * figure approximate, so naming it would be the one place in this design
 * that ignored the lapse rule. The names are *declared in this scene* and
 * the sentence says only that — which of them the walk could have crossed is
 * precisely the thing no route was stated to settle.
 */
function declaredHere(state: GameState): string {
  const names = liveTerrainNames(state);
  if (names.length === 0) return 'nothing is declared here';
  return `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} declared in this scene`;
}

/** The tail of a refusal that names what slowed the mover, or nothing at all. */
function becauseOf(state: GameState, patches: readonly string[]): string {
  if (patches.length === 0) return '';
  const named = patches.map((patch) => {
    const rate = state.scene?.terrain[patch]?.costPerFoot;
    return rate === undefined ? patch : `${patch} at ${rate} feet per foot`;
  });
  return `, crossing ${named.join(' and ')}`;
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
  content: Content,
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

    const reach = reachOf(content, other);
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
    // **The would-be attacker's senses**, because they are the one who has to
    // see: "a creature that you can see leaves your reach" is written from
    // the reactor's side, and a mover's own Darkvision would not help the
    // creature swinging at them one bit.
    const seen = canSee(state, other.id, mover);
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
  /**
   * An attack the reactor's own stat block prints, by its printed name.
   *
   * The same field `AttackCommand.action` is, offered here for the same
   * reason: a Wolf's swing is a Bite, and the only way a caller could ask for
   * one used to be to go round this command. Exclusive with `weapon`, which
   * `resolveAttack` refuses below rather than resolving in some order nobody
   * can see.
   *
   * Naming neither is the ordinary case and is where the default lives — see
   * {@link takeOpportunityAttack}.
   */
  readonly action?: string;
}

/**
 * What a creature swings when it is provoked and nobody said with what.
 *
 * Three answers in the order a caller expects: what they named, what they are
 * holding, and — where the creature's block prints attacks of its own — its
 * best printed melee line. See {@link bestPrintedMeleeAttack} for what "best"
 * means and why each part of it is the book's rather than the engine's.
 *
 * Shared with the `damaged-by-creature` window, which asks the same question
 * about the same kind of Reaction: SRD Retaliation is "one melee attack", word
 * for word what an Opportunity Attack is.
 */
export function reactionSwing(
  sheet: CharacterSheet,
  command: { readonly weapon?: string | null; readonly action?: string },
): { readonly weapon: string | null; readonly action?: string } {
  // Both named goes through as both named, so `resolveAttack` refuses it in
  // the one place that refusal lives. Choosing one here would make a swing
  // with two answers legal at this door and illegal at the other.
  if (command.action !== undefined) {
    return { weapon: command.weapon ?? null, action: command.action };
  }
  // Explicitly null is a caller asking for an Unarmed Strike, and is answered
  // rather than second-guessed; undefined is nobody having said.
  if (command.weapon !== undefined) return { weapon: command.weapon };

  const printed = bestPrintedMeleeAttack(sheet);
  return printed === null ? { weapon: null } : { weapon: null, action: printed.name };
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
  supply: Supply,
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
      // SRD Shocking Grasp: "can't make Opportunity Attacks until the start
      // of its next turn." This is the one place the engine offers that
      // Reaction, so it is the one place the name can be told apart.
      const spent = spendReaction(state.combat, reactor, creature?.conditions, {
        rules: actionRulesOn(state, reactor),
        as: 'opportunity-attack',
      });
      if (!spent.ok) return spent;
      events.push({ type: 'reaction-spent', id: reactor });
    }

    // The attack itself goes through the ordinary command, so every derivation
    // it makes — cover, conditions, proficiency, the target's defences — applies
    // here too rather than being reimplemented for this one case.
    const after = events.reduce(applyEvent, state);
    const swinger = creatureOf(after, reactor);
    if (swinger === null) return unknownCreature(reactor);
    const swing = resolveAttack(
      after,
      reactor,
      {
        target: waiting.mover,
        // What the reactor swings with: what the caller named, or — for a
        // creature whose block prints its own attacks — the best of those. A
        // Wolf's Opportunity Attack was an Unarmed Strike at a Strength
        // modifier its block never printed, which is a number the engine
        // invented against a line that was there to be read.
        ...reactionSwing(sheetAsItStands(after, reactor) ?? swinger.sheet, command),
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

/**
 * What mounting or dismounting costs, and the event that records spending it.
 *
 * SRD Mounted Combat: "During your move, you can mount a creature that is
 * within 5 feet of you or dismount. Doing so costs an amount of movement equal
 * to half your Speed (round down)." `mountingCost` has said exactly that since
 * positioning landed and nothing called it.
 *
 * It is *movement*, not an action, so it draws on the same budget a walk does
 * and spends nothing at all outside combat — the reading `resolveMove` already
 * takes, and the reason the command stamp rides on `mounted`/`dismounted`
 * rather than on a `movement-spent` that may not be there.
 *
 * **A Speed of 0 is refused rather than charged nothing, and the refusal has
 * to be its own.** "Half your Speed" of 0 is 0, so a cost check asking whether
 * the rider can afford it compares 0 against 0 and passes — the guard
 * cancelling itself out the moment both halves read the same live number. SRD
 * puts the whole sentence inside "**During your move**", and a creature the
 * rules have pinned has no move to do it during: Grappled and Restrained both
 * print "Your Speed is 0", and a Paralyzed knight does not climb onto a horse
 * for free. It also keeps the log honest — a `movement-spent` of 0 feet is an
 * event recording that nothing happened.
 *
 * It reports `not_enough_movement`, which is the code this refused under
 * before the allowance became live, because a refusal code is observable
 * behaviour and a caller may branch on one.
 */
function spendMounting(state: GameState, rider: CharacterId): Result<readonly GameEvent[]> {
  if (state.combat === null || state.combat.budgets[rider] === undefined) return ok([]);

  const combatant = state.combat.order.find((entry) => entry.id === rider);
  if (combatant === undefined) return ok([]);

  // Half the Speed the rider *has*, not half the one the Initiative order
  // pinned: SRD says "half your Speed", and a Barbarian's Fast Movement is as
  // much a part of that as Exhaustion is. One reader answers both.
  const speed = speedOf(state, rider);
  if (speed <= 0) {
    return err('not_enough_movement', `${rider} has no Speed to mount or dismount with`);
  }

  const feet = mountingCost(speed);
  // The economy's refusal is passed through under its own code, for the reason
  // `resolveMove` records above — this rewrite was copied from there, and the
  // rider climbing up out of turn is the case it got wrong.
  const spent = spendMovement(state.combat, rider, feet, speed, {
    rules: actionRulesOn(state, rider),
  });
  if (!spent.ok) return spent;

  return ok([{ type: 'movement-spent', id: rider, feet }]);
}

/**
 * Climb onto something.
 *
 * `mount` has been a correct pure function since positioning landed, with
 * exactly one caller: the **reducer**, folding an event no command wrote. Every
 * refusal below is its own — already riding, out of reach, a mount no larger
 * than the rider — and the two `unplaced` answers are turned into the requests
 * a pure helper cannot know to attach.
 *
 * SRD covers "a willing creature that is at least one size larger than a
 * rider"; it says nothing about leaping onto a hostile dragon, which is among
 * the most-attempted moves at any table. So that is recorded as
 * `willing: false` rather than refused, and whether the character got up there
 * is a check the DM calls for.
 *
 * **`mayAct` applies, because this spends movement.** The action-economy sweep
 * in `invariants.test.ts` derives that from the call to `spendMovement` rather
 * than from this sentence, which is why it is a guard and not a claim.
 */
export function mountCreature(
  state: GameState,
  rider: CharacterId,
  target: CharacterId,
  options: MountOptions,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `mount:${rider}`, { ...command, target, ...options }, () => [], (stamp) => {
    // **After the duplicate check, never before it.**
    const owedHere = mayAct(state, rider);
    if (owedHere !== null) return owedHere;

    const scene = sceneFor(state, rider, `${rider} to climb onto ${target} in`);
    if (!scene.ok) return scene;

    const mounted = mount(scene.value, rider, target, options);
    if (!mounted.ok) {
      // The refusal stays `mount`'s; this says whose position is missing.
      if (mounted.code !== 'unplaced') return mounted;
      const missing = positionOf(scene.value, rider) === null ? rider : target;
      return needsContext(mounted.code, mounted.reason, [
        {
          kind: 'position',
          subject: missing,
          need: `where ${missing} is standing`,
          because: 'mounting is measured from one creature to the other',
          satisfyWith: `a placeCreatureInScene command for ${missing}`,
        },
      ]);
    }

    // The whole operation is validated before any of it is emitted: the ride
    // has to be legal *and* the movement has to be there to spend.
    const spent = spendMounting(state, rider);
    if (!spent.ok) return spent;

    return ok([
      ...spent.value,
      {
        type: 'mounted',
        rider,
        mount: target,
        willing: options.willing,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/**
 * Get down, somewhere established.
 *
 * The other half of the same SRD sentence, at the same cost. Where the rider
 * lands is an ordinary `Placement`, so it is measured on the lattice like
 * every other position and `dismount` refuses one that does not work — which
 * is the refusal this surfaces rather than restating.
 */
export function dismountRider(
  state: GameState,
  rider: CharacterId,
  placement: Placement,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `dismount:${rider}`, { ...command, placement }, () => [], (stamp) => {
    const owedHere = mayAct(state, rider);
    if (owedHere !== null) return owedHere;

    const scene = sceneFor(state, rider, `${rider} to get down into`);
    if (!scene.ok) return scene;

    const down = dismount(scene.value, rider, placement);
    if (!down.ok) return down;

    const spent = spendMounting(state, rider);
    if (!spent.ok) return spent;

    return ok([
      ...spent.value,
      {
        type: 'dismounted',
        rider,
        placement,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

