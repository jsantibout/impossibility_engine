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
 */

import { err, ok, type CharacterId, type Result } from '@ie/shared';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { bearingBetween, distanceBetween, moveCreature } from '../positioning.js';
import { ranged, type ForcedMovement } from '../spell-definitions.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';

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

  // Two creatures in the same space have no bearing between them, and that is
  // the honest answer rather than north: SRD's "straight away from yourself"
  // names no direction when there is no distance.
  const bearing = bearingBetween(scene, source, target);
  if (!bearing.ok) return { events: [], unverified: [`${name}: ${bearing.reason}`] };

  const placement = {
    from: { creature: target },
    feet: movement.feet,
    bearing: bearing.value,
  } as const;

  // SRD: "You can't **willingly** end a move in a space occupied by another
  // creature." A shove is the "somehow" that rule leaves room for, so
  // occupancy does not stop it — `forced: true` is what says so, and it is the
  // same flag the fold applies this event under.
  const moved = moveCreature(scene, target, placement, { forced: true });
  if (!moved.ok) {
    return { events: [], unverified: [`${name}: ${target} could not be pushed: ${moved.reason}`] };
  }

  // Nobody spent their Speed on this, nobody provoked anything, and no
  // Difficult Terrain was charged — a shove is not the creature's movement.
  return { events: [{ type: 'creature-moved', id: target, placement, forced: true }], unverified: [] };
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
): PushOutcome {
  const scene = state.scene;
  if (scene === null) {
    return {
      events: [],
      unverified: [`nobody has said where anybody is standing, so ${target} was not lifted`],
    };
  }

  const placement = { from: { creature: target }, feet: 0, elevation: movement.feet } as const;

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
      { type: 'creature-lifted', id: target, lift: { source } },
    ],
    unverified: [],
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
  const held = world.creatures[target]?.lifts ?? [];
  if (!held.some((lift) => lift.source.includes(castingId))) {
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

  const placement = { from: { creature: target }, feet, bearing: bearing.value } as const;

  const moved = moveCreature(scene, target, placement, { forced: true });
  if (!moved.ok) {
    return { events: [], unverified: [`${name}: ${target} could not be pulled: ${moved.reason}`] };
  }

  return { events: [{ type: 'creature-moved', id: target, placement, forced: true }], unverified: [] };
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
