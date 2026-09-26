/**
 * Forced movement a spell causes, and the one place it is performed.
 *
 * `moveCreature` has taken `forced: true` since positioning landed and has
 * reported whose space is being shared, and for as long as it did nothing in
 * the definition format reached it: SRD Thunderwave dealt its damage and moved
 * nobody. This is the missing half — the recurring finding in this repository
 * that a pure function nothing calls is a rule nothing enforces.
 *
 * **One function, because the SRD writes one sentence.** The push is measured
 * *straight away from the caster*, which on this lattice is the bearing from
 * the caster to the creature being shoved, applied from **the creature's own
 * anchor**. Anchoring on the caster instead would add a box-to-box distance to
 * an anchor-to-anchor projection, and those are the same number only while
 * both are Medium — the correction `masteryAfterHit`'s Push and the Shove both
 * already carry, and the reason this reads like them.
 *
 * **A shove that cannot happen is a gap, not a refusal.** The casting has
 * already spent its slot and landed its damage by the time a rider runs, and
 * `creature-moved` is applied by the fold through `must` — so a push into a
 * wall would be a log that cannot be folded rather than a refusal. It is asked
 * before it is written, and what could not happen is said out loud on the
 * casting's `unverified`, exactly as the Push mastery says it.
 *
 * **And a casting's own barriers are asked about too**, which they were not:
 * `resolveMove` has consulted `barriersAgainst` since SRD Tiny Hut's dome
 * landed, and every function here called `moveCreature` straight past it — so
 * a Thunderwave drove a goblin through a dome that bars it and a Levitate
 * lifted one through the roof, neither refused nor reported. {@link
 * stopAtBarriers} is the one ask, shared by the push, the lift and the pull,
 * and it **stops** the creature on its own side rather than refusing, which is
 * the same paragraph again.
 */

import { err, ok, type CharacterId, type Result } from '@ie/shared';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import {
  bearingBetween,
  damagingPatchesAt,
  distanceBetween,
  moveCreature,
  moverInRegionAt,
  positionOf,
  sizeAtMost,
  type Placement,
  type Point,
  type PositionState,
} from '../positioning.js';
import { effectiveSizeOf } from '../size.js';
import type { CreatureSize } from '@ie/srd';
import { ranged, type ForcedMovement } from '../spell-definitions.js';
import { castingIdOf } from '../spells.js';
import { barriersAgainst, type BarrierAgainst } from '../standing.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';

/** A size as the book prints it, for a reason a person reads. */
const printed = (size: CreatureSize): string =>
  `${size.charAt(0).toUpperCase()}${size.slice(1)}`;

/** One space on the lattice, which is the granularity a crossing is read at. */
const STEP = 5;

/** How a barrier's own clause reads in a sentence a table acts on. */
const verbOf = (crossing: BarrierAgainst['crossing']): string =>
  crossing === 'in' ? 'entering' : crossing === 'out' ? 'leaving' : 'passing through';

/** How far a forced move really carries, and what the engine could not settle. */
interface ShoveReach {
  readonly feet: number;
  readonly unverified: readonly string[];
}

/**
 * Stop a forced move at the first barrier it would cross.
 *
 * SRD Tiny Hut: "All other creatures and objects are barred from passing
 * through it." SRD Magic Circle, SRD Wind Wall the same of their own
 * populations. `resolveMove` has asked `barriersAgainst` since the barriers
 * landed and **a spell's shove never did**: `shoveAwayFrom` and {@link lift}
 * call `moveCreature` straight, so a Thunderwave drove a goblin through a dome
 * that bars it and nothing was refused, reported or even noticed.
 *
 * **It stops rather than refuses**, which is the movement command's own rule
 * for forced movement: by the time a rider runs the slot is spent and the save
 * is rolled, so a refusal here would be a casting undone by the room. The
 * creature travels as far as the last space on its own side of the boundary and
 * comes to rest there, and the wall it is up against is named in `unverified`.
 * Where the very first space would cross, nothing moves at all.
 *
 * **Read a space at a time**, because a crossing is a step from one side to the
 * other and the endpoints cannot always see it: a ten-foot push that begins
 * outside a dome and ends outside the far side of it has passed through. The
 * geometry is `moverInRegionAt`'s, asked of the mover's whole volume, which is
 * the same question `checkBarriers` asks of a walk.
 *
 * **`flying: false`**, for `teleportTo`'s reason: nobody flies through a shove,
 * so SRD Wind Wall's clause about a Small flier does not bite on one.
 */
function stopAtBarriers(
  state: GameState,
  scene: PositionState,
  target: CharacterId,
  feet: number,
  /** The placement this move would use at a given distance. */
  placementAt: (feet: number) => Placement,
  /** What the log calls the thing that moved them, and how it moved them. */
  by: { readonly name: string; readonly verb: string },
): ShoveReach {
  const barriers = barriersAgainst(state, target, { flying: false });
  if (barriers.length === 0) return { feet, unverified: [] };

  const from = positionOf(scene, target);
  if (from === null) return { feet, unverified: [] };

  // Every space the move passes through, and the end of it whether or not the
  // printed distance lands on the lattice.
  const stops: number[] = [];
  for (let step = STEP; step < feet; step += STEP) stops.push(step);
  if (feet > 0) stops.push(feet);

  let previous = from;
  let reached = 0;
  for (const step of stops) {
    const moved = moveCreature(scene, target, placementAt(step), { forced: true });
    // The room's own answer, left to the caller that already reports it.
    if (!moved.ok) break;
    const at = moved.value.state.positions[target];
    if (at === undefined) break;
    for (const barrier of barriers) {
      const inA = moverInRegionAt(scene, barrier.region, target, previous);
      const inB = moverInRegionAt(scene, barrier.region, target, at);
      const crossed =
        barrier.crossing === 'in' ? !inA && inB : barrier.crossing === 'out' ? inA && !inB : inA !== inB;
      if (!crossed) continue;
      return {
        feet: reached,
        unverified: [
          `${by.name}: ${target} was ${by.verb} into ${barrier.spell}, which bars ${verbOf(barrier.crossing)} it, and comes to rest against it after ${reached} feet`,
        ],
      };
    }
    previous = at;
    reached = step;
  }
  return { feet, unverified: [] };
}

/** What a shove came to: the event it wrote, or the reason it wrote none. */
export interface PushOutcome {
  readonly events: readonly GameEvent[];
  /** What the engine could not settle, in the caller's own words. */
  readonly unverified: readonly string[];
}

/**
 * Push a creature straight away from the creature that caused it.
 *
 * Takes the world rather than a scene so the two refusals a bare scene cannot
 * answer — nobody has described a room, nobody has said where anybody is
 * standing — come back as the same reported gap as a wall, because by the time
 * a rider runs none of them is a question the caller can still be asked.
 */
export function shoveAwayFrom(
  state: GameState,
  target: CharacterId,
  source: CharacterId,
  movement: ForcedMovement,
  /** What the log calls the thing that pushed: the spell's name. */
  name: string,
): PushOutcome {
  const scene = state.scene;
  if (scene === null) {
    return {
      events: [],
      unverified: [`nobody has said where anybody is standing, so ${target} was not pushed`],
    };
  }

  // **The ceiling the sentence prints, where it prints one.** SRD Repelling
  // Blast pushes "a Large or smaller creature" and nothing bigger; the reading
  // is `masteryAfterHit`'s Push word for word — what somebody *said* before
  // what the map assumed, a creature too big left standing rather than the
  // casting refused, and the reason said out loud. A rider with no ceiling
  // asks nothing, which is SRD Thunderwave.
  const assumed: string[] = [];
  if (movement.targetNoLargerThan !== undefined) {
    const limit = movement.targetNoLargerThan;
    const size = effectiveSizeOf(state, target);
    if (size !== null && !sizeAtMost(size, limit)) {
      return {
        events: [],
        unverified: [
          `${name}: ${target} is ${size}, and this pushes a creature that is ${printed(limit)} or smaller`,
        ],
      };
    }
    if (state.creatures[target]?.size == null) {
      assumed.push(
        `${name}: nobody has said how big ${target} is, so this took them for Medium; a creature larger than ${printed(limit)} would not have moved`,
      );
    }
  }

  // Two creatures in the same space have no bearing between them, and that is
  // the honest answer rather than north: SRD's "straight away from yourself"
  // names no direction when there is no distance.
  const bearing = bearingBetween(scene, source, target);
  if (!bearing.ok) return { events: [], unverified: [...assumed, `${name}: ${bearing.reason}`] };

  const placementAt = (feet: number): Placement => ({
    from: { creature: target },
    feet,
    bearing: bearing.value,
  });

  // **And the barriers a casting has raised against this creature**, which a
  // spell's shove had never asked about. Reported and stopped rather than
  // refused: see {@link stopAtBarriers}.
  const reach = stopAtBarriers(state, scene, target, movement.feet, placementAt, {
    name,
    verb: 'pushed',
  });
  if (reach.feet <= 0) return { events: [], unverified: [...assumed, ...reach.unverified] };
  const placement = placementAt(reach.feet);

  // SRD: "You can't **willingly** end a move in a space occupied by another
  // creature." A shove is the "somehow" that rule leaves room for, so
  // occupancy does not stop it — `forced: true` is what says so, and it is the
  // same flag the fold applies this event under.
  const moved = moveCreature(scene, target, placement, { forced: true });
  if (!moved.ok) {
    return {
      events: [],
      unverified: [...assumed, `${name}: ${target} could not be pushed: ${moved.reason}`],
    };
  }

  // Nobody spent their Speed on this, nobody provoked anything, and no
  // Difficult Terrain was charged — a shove is not the creature's movement.
  return {
    events: [{ type: 'creature-moved', id: target, placement, forced: true }],
    unverified: [
      ...assumed,
      ...reach.unverified,
      ...cutOnTheWay(state, target, name, positionOf(moved.value.state, target)),
    ],
  };
}

/**
 * SRD Spike Growth cuts "when a creature moves into or within the area", and a
 * creature thrown into it has — but a rider on a settled outcome rolls nothing
 * and refuses nothing, and it states no route for the dice to be owed along.
 * So a shove or a lift that lands on ground that cuts is reported here, in the
 * words the walking road (`checkTerrainDamage`) uses for a forced move with no
 * path stated, and the table sends the move again with its route to have the
 * dice thrown. (W7-S19)
 */
function cutOnTheWay(
  state: GameState,
  target: CharacterId,
  name: string,
  landed: Point | null,
): readonly string[] {
  if (landed === null) return [];
  const patches = damagingPatchesAt(state, landed);
  if (patches.length === 0) return [];
  return [
    `${name}: ${target} came to rest in ${patches.join(' and ')}, which deals damage for every five feet travelled inside it; a forced move states no route, so no dice were thrown for it — send the move again with its route filled in to have them thrown`,
  ];
}

/**
 * Raise a creature straight up, and record whose magic is holding it there.
 *
 * SRD *Levitate*: "rises vertically up to 20 feet and **remains suspended
 * there for the duration**."
 *
 * **Its siblings' arithmetic with the one axis a bearing cannot name.** A push
 * projects along a compass bearing; there is no bearing that means *up*, so
 * the lattice's own elevation is what a lift moves and `Placement.elevation`
 * is the field that carries it — the same one `resolveFall` uses to drop a
 * creature, with the sign reversed. Zero feet along the ground, because
 * nothing moved the creature sideways.
 *
 * **Two events, because the lift is two facts.** The rise is an ordinary
 * `creature-moved` and belongs to the scene; the *hold* is a grant on the
 * creature under the casting's own source, and it is the half that makes the
 * ending possible — SRD gives this rider an undoing no other has, and
 * `releaseCasting` performs it off exactly this grant. A rise with no grant
 * beside it would be a creature nothing could ever bring down.
 *
 * **`checkRise` is not asked and must not be**, which is the rule it already
 * writes down: a creature ends a move higher than it began only if it flew,
 * climbed or jumped — *unless something else put it there*, and forced
 * movement is exempt by name. Being held up by somebody's magic is the
 * clearest case of the exemption there is.
 *
 * A lift that cannot happen is reported rather than refused, exactly as a
 * shove is and for the same reason: by the time a rider runs the slot is spent
 * and the save is rolled, so a ceiling is a gap in the casting's own
 * `unverified` rather than an event the fold could not apply.
 */
export function lift(
  state: GameState,
  target: CharacterId,
  movement: ForcedMovement,
  /** What the casting files the hold under: `Levitate#cast:3`. */
  source: string,
  /** What the log calls the thing that lifted them: the spell's name. */
  name: string,
  /**
   * SRD Levitate's "up to 20 feet in either direction on your turn", read off
   * the definition's activation and pinned onto the hold — see
   * `GrantedLift.altitudePerTurn`. Absent for a spell that prints none.
   */
  altitudePerTurn?: number,
): PushOutcome {
  const scene = state.scene;
  if (scene === null) {
    return {
      events: [],
      unverified: [`nobody has said where anybody is standing, so ${target} was not lifted`],
    };
  }

  const placementAt = (feet: number): Placement => ({
    from: { creature: target },
    feet: 0,
    elevation: feet,
  });

  // A dome has a roof, and a rise is a crossing like any other: the barrier
  // read is the same one a push gets, on the one axis a bearing cannot name.
  const reach = stopAtBarriers(state, scene, target, movement.feet, placementAt, {
    name,
    verb: 'lifted',
  });
  if (reach.feet <= 0) return { events: [], unverified: reach.unverified };
  const placement = placementAt(reach.feet);

  // Forced, for the reason every other movement in this module is: nobody
  // spent a Speed on it, it provokes nothing, and the space it ends in is not
  // the creature's to willingly choose.
  const raised = moveCreature(scene, target, placement, { forced: true });
  if (!raised.ok) {
    return { events: [], unverified: [`${name}: ${target} could not be lifted: ${raised.reason}`] };
  }

  return {
    events: [
      { type: 'creature-moved', id: target, placement, forced: true },
      {
        type: 'creature-lifted',
        id: target,
        lift: { source, ...(altitudePerTurn === undefined ? {} : { altitudePerTurn }) },
      },
    ],
    unverified: [
      ...reach.unverified,
      ...cutOnTheWay(state, target, name, positionOf(raised.value.state, target)),
    ],
  };
}

/**
 * Move a creature this casting is holding off the ground, up or down.
 *
 * SRD *Levitate*: "You can change the target's altitude by up to 20 feet in
 * either direction on your turn. … you can take a Magic action to move the
 * target, **which must remain within the spell's range**."
 *
 * **The only movement in this module that refuses.** Its three neighbours are
 * riders on a settled outcome — the slot is spent and the save is rolled by
 * the time they run, so a wall or a ceiling is reported on the casting's
 * `unverified` rather than refused. This is not a rider: it is a Magic action
 * a caster is *deciding* to take, and `activateSpell` discards the whole batch
 * on a refusal, so a rise the room or the Range will not have costs its caster
 * nothing at all.
 *
 * Three questions, and each is a refusal rather than a substitution:
 *
 * | | |
 * |---|---|
 * | is this creature aloft **by this casting** | `not_held_aloft` — the sentence moves "the target", and a casting holds up whom it lifted |
 * | does the destination stay inside the Range | `out_of_range` — read from the caster afresh, because a lattice distance counts the climb |
 * | is there room | whatever `moveCreature` says: a ceiling is the room's answer and not the spell's |
 *
 * **The cap is not asked here.** How far the caster may move the target is a
 * fact about the request, and `activateSpell` refuses it before anything is
 * spent — where every other pre-flight of a stated fact lives.
 *
 * **Lowering to the ground is not the spell ending.** The `GrantedLift` is
 * untouched, so the casting goes on holding the creature and a later turn may
 * take it back up — and the landing SRD prints for the casting's *end* stays
 * `releaseCasting`'s, derived and written nowhere.
 */
export function resolveChangeAltitudeEffect(
  ctx: EffectContext,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { casterId, events, outcomes, altitude, name } = ctx;
  const { definition, castingId } = ctx.casting();

  // Refused at the command, before anything is spent; a resolver reached
  // without one is the command layer and the definition disagreeing.
  if (altitude === undefined) {
    return err(
      'altitude_required',
      `${name} moves a creature it is holding up, and nobody said how far`,
    );
  }

  const scene = world.scene;
  if (scene === null) {
    return err('no_scene', `${name} needs a scene to move anybody about in`);
  }

  // "the target" is whoever this casting lifted. A creature aloft by somebody
  // else's Levitate is that caster's to move, and one standing on the floor
  // was never lifted at all.
  // **The id, exactly.** `castingIdOf` is the one reader of this join — a
  // `substring` would read `Levitate#cast:1` out of `Levitate#cast:12` and let
  // the eleventh casting move the creature the first one is holding, which is
  // a guard that stops guarding the moment a campaign passes ten castings.
  const held = world.creatures[target]?.lifts ?? [];
  if (!held.some((lift) => castingIdOf(lift.source) === castingId)) {
    return err(
      'not_held_aloft',
      `${name} moves the creature it is holding off the ground, and ${castingId} is not holding ${target}`,
    );
  }

  const placement = { from: { creature: target }, feet: 0, elevation: altitude } as const;
  const moved = moveCreature(scene, target, placement, { forced: true });
  if (!moved.ok) return moved;

  // "which must remain within the spell's range." Measured from the caster to
  // where the creature **ends up**, because a Chebyshev distance on this
  // lattice counts the climb: a target ten feet away and sixty feet up is
  // sixty feet away. Read off the moved scene rather than added to the old
  // reading, so the one measurement everything else uses answers this too.
  const reach = ranged(definition.range);
  if (reach !== null) {
    const apart = distanceBetween(moved.value.state, casterId, target);
    if (!apart.ok) return apart;
    if (apart.value > reach) {
      return err(
        'out_of_range',
        `${name} reaches ${reach} feet and that would leave ${target} ${apart.value} feet from ${casterId}`,
      );
    }
  }

  // The lift is untouched: the casting is still holding them, wherever it has
  // just put them.
  events.push({ type: 'creature-moved', id: target, placement, forced: true });
  outcomes.push({ target, affected: true });
  return ok(events.slice(-1).reduce(applyEvent, world));
}

/**
 * Pull a creature straight toward the creature that caused it.
 *
 * SRD Merrow: "the merrow pulls the target up to 15 feet straight toward
 * itself"; SRD Shambling Mound pulls five. The same lattice arithmetic as
 * {@link shoveAwayFrom} with the bearing reversed, and **capped at
 * adjacency**, which is the one thing the reversal adds: a push has the whole
 * room to travel into and a pull has only the gap, so fifteen feet of pull
 * across a ten-foot gap is a creature dragged through the thing pulling it.
 * The book leaves the amount to the puller ("up to"), so stopping at the
 * puller's face is inside the sentence rather than a correction to it.
 *
 * Everything else is its twin's, including the reason it reports rather than
 * refuses: by the time a rider runs the blow has landed, and a `creature-moved`
 * the fold would refuse is worse than a hit whose shove did not happen.
 */
export function pullToward(
  state: GameState,
  target: CharacterId,
  source: CharacterId,
  movement: ForcedMovement,
  /** What the log calls the thing that pulled: the line's own name. */
  name: string,
): PushOutcome {
  const scene = state.scene;
  if (scene === null) {
    return {
      events: [],
      unverified: [`nobody has said where anybody is standing, so ${target} was not pulled`],
    };
  }

  // The bearing from the creature being pulled **to** the one pulling, which
  // is the reversal: `shoveAwayFrom` measures the other way and applies it
  // from the same anchor.
  const bearing = bearingBetween(scene, target, source);
  if (!bearing.ok) return { events: [], unverified: [`${name}: ${bearing.reason}`] };

  // "Up to", capped at the gap. `distanceBetween` measures volume to volume,
  // so a Huge puller's flank is where the gap ends and the pull stops there.
  const gap = distanceBetween(scene, target, source);
  if (!gap.ok) return { events: [], unverified: [`${name}: ${gap.reason}`] };
  const feet = Math.min(movement.feet, gap.value);
  if (feet <= 0) return { events: [], unverified: [] };

  const placementAt = (far: number): Placement => ({
    from: { creature: target },
    feet: far,
    bearing: bearing.value,
  });

  // The same ask its twin gets, and the same reason: a creature dragged into a
  // dome that bars it stops at the boundary and the wall is named.
  const reach = stopAtBarriers(state, scene, target, feet, placementAt, { name, verb: 'pulled' });
  if (reach.feet <= 0) return { events: [], unverified: reach.unverified };
  const placement = placementAt(reach.feet);

  const moved = moveCreature(scene, target, placement, { forced: true });
  if (!moved.ok) {
    return { events: [], unverified: [`${name}: ${target} could not be pulled: ${moved.reason}`] };
  }

  return {
    events: [{ type: 'creature-moved', id: target, placement, forced: true }],
    unverified: reach.unverified,
  };
}

/**
 * The casting takes the cost of landing away from its target.
 *
 * SRD *Feather Fall*: "If a creature lands before the spell ends, the creature
 * takes **no damage** from the fall, and the spell ends for that creature."
 *
 * **A grant rather than something done now**, because the sentence is about a
 * moment that has not arrived: the spell is cast while the creature is still
 * in the air, and what it changes is what the landing costs. So this is the
 * shape `resolveSenseEffect` and `resolveDamageReductionEffect` already are —
 * nothing is rolled, the casting is in the source, and `releaseCasting`,
 * `releaseOnTarget` and a `grants` deadline take it back — and the reading
 * happens in `resolveFall`, which is where a fall is paid for and where the
 * other half of the sentence ends the spell on whoever landed.
 *
 * It is in this module rather than beside those two because falling is
 * movement, and this is what a spell does to a creature's movement through
 * space.
 */
export function resolveFallWardEffect(
  ctx: EffectContext,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { source, events, outcomes, held } = ctx;
  held.add(target);
  events.push({ type: 'fall-ward-granted', id: target, ward: { source } });
  outcomes.push({ target, affected: true });
  return ok(events.slice(-1).reduce(applyEvent, world));
}

/**
 * The casting buys its target a jump, at a price it fixes.
 *
 * SRD *Jump*: "Once on each of its turns until the spell ends, that creature
 * can jump up to 30 feet by spending 10 feet of movement."
 *
 * Its neighbour's shape exactly — nothing is rolled, the casting is in the
 * source, and the three doors that end a grant end this one — and it is in
 * this module for its neighbour's reason: a jump is movement, and so is the
 * landing the other one pays for. What reads it is `commands/movement.ts`,
 * where a jump is bounded and a move is charged.
 */
export function resolveJumpEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'jump-allowance'>,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { source, events, outcomes, held } = ctx;
  held.add(target);
  events.push({
    type: 'jump-allowance-granted',
    id: target,
    allowance: { source, feet: effect.feet, costsMovement: effect.costsMovement },
  });
  outcomes.push({ target, affected: true });
  return ok(events.slice(-1).reduce(applyEvent, world));
}
