/**
 * Teleportation inside the scene: a position change that costs no movement.
 *
 * CLAUDE.md has recorded this gap in those words since the tracked bucket
 * existed — *"No command teleports. `moveCreature` charges a movement budget
 * and `placeCreature` refuses a creature that already has a position, so a
 * spell that relocates somebody has nothing authoritative to call"* — and
 * records that it was misfiled for a long time as "a separate placement the
 * caller makes", which reads as a division of labour and is a hole.
 *
 * **A teleport is not a move, and the list of what it therefore is not comes
 * from the SRD rather than from taste.** None of Speed, Difficult Terrain,
 * Opportunity Attacks, Disengage or Grappled applies, because the book applies
 * none of them to a teleport: an Opportunity Attack is offered only when a
 * creature "leaves your reach using its action, its Bonus Action, its
 * Reaction, or **one of its speeds**", and Misty Step is none of those. That is
 * the same reasoning `relocateOrigin` already records for a spell's point, and
 * it is why this is its own command rather than a flag on `resolveMove`:
 * routing it through that one would import every one of those rules silently.
 *
 * **What it *is* is an authoritative position change**, so it writes the same
 * `creature-moved` a walk writes, and every consequence the reducer derives
 * from one follows — an area entry above all, which is the SRD's reading of
 * arriving inside a Web. No new event type and no flag on the old one: the
 * event already means "this creature's authoritative position changed", which
 * is exactly what happened, and a field nothing branches on is the speculative
 * member this repository's own sweeps exist to refuse. (`forced` is a field
 * because the *reducer* branches on it, to permit an occupied space.)
 *
 * **A rider goes with a teleported mount**, because the geometry is
 * `moveCreature`'s and riding is a relationship rather than an offset. SRD
 * says nothing either way about a rider on a creature that teleports, and the
 * reading that keeps a rogue clinging to a dragon is the one this engine
 * already takes of every other way the dragon can move.
 *
 * **A teleport crosses nothing, so it is never asked for a route.**
 * `moveWithin` asks a carrier of an Emanation which spaces it passed through,
 * because two points do not imply the line between them — and a teleport has
 * no line at all. Whoever is standing at the destination is caught by the
 * carrier arriving; nobody in between is, because the area was never in
 * between.
 *
 * **A destination outside the scene stays the DM's.** There is one scene, so
 * Plane Shift and Word of Recall have no position to move anybody to; this
 * command refuses a destination the scene cannot contain rather than inventing
 * a second place to put somebody.
 */

import {
  type CharacterId,
  type ContextRequest,
  err,
  needsContext,
  ok,
  type Result,
} from '@ie/shared';
import { type CommandStamp, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  moveCreature,
  type Placement,
  positionOf,
} from '../positioning.js';
import { canSee } from '../standing.js';
import { anchorNeeded, creatureOf, sceneFor, unknownCreature } from './command.js';
import { mayAct } from './holds.js';

export interface RelocateCommand extends CommandIdentity {
  /** Where to, relative to something already established. */
  readonly placement: Placement;
  /**
   * The furthest the creature may be sent, in feet, measured from where they
   * are standing now.
   *
   * SRD Misty Step's "up to 30 feet" and Dimension Door's Range of 500. Absent
   * is a relocation nothing bounds — a DM's ruling, a trapdoor, a portal — and
   * the scene's own extent is still the outer limit of it.
   */
  readonly within?: number;
  /**
   * SRD Misty Step's "an unoccupied space **you can see**".
   *
   * Absent is Dimension Door, which prints the opposite in as many words: the
   * destination "can be a place you can see, one you can visualize, or one you
   * can describe by stating distance and direction". A clause a spell does not
   * print is not one the engine may apply.
   */
  readonly requiresSight?: true;
}

export interface RelocateOutcome {
  readonly events: readonly GameEvent[];
  /** How far they went, on the same 5-foot lattice as everything else. */
  readonly feet: number;
  /** Facts the engine could not check — see `AttackResolution.unverified`. */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Relocate a creature, spending nothing.
 *
 * **`mayAct` applies and the command is not a spender**, which is the one
 * combination worth stating rather than leaving to be inferred. It takes no
 * Action, Bonus Action, Reaction, movement or pool use — so the action-economy
 * sweep does not classify it as a spender and no exemption list has anything
 * to say about it — and it is guarded anyway, because it is an authoritative
 * position change that *raises* area debts. `resolveMove`, the neighbouring
 * operation that raises the same debts, is guarded for the same reason — and
 * so are the two holds that are about a *position* rather than about the
 * economy, because two operations that both move a creature must not disagree
 * about whether the world has to be settled first.
 *
 * The guard sits **inside** `once`, so a retry is told its command landed
 * rather than told about the debt its own first run raised.
 */
export function relocateCreature(
  state: GameState,
  who: CharacterId,
  command: RelocateCommand,
): Result<RelocateOutcome> {
  return once(
    state,
    `relocate:${who}`,
    command,
    () => ({ events: [], feet: 0, unverified: [], duplicate: true }),
    (stamp) => {
      // **The same two holds `resolveMove` refuses**, because they are about
      // this creature's *position* rather than about the economy neither of
      // them spends. A declared move is an intent `completeIfSettled` will
      // later apply, so teleporting out from under one is a relocation the
      // move silently undoes; a held attack was measured against where the
      // target is standing. Two operations that both change a position must
      // not disagree about whether the world has to be settled first.
      if (state.pendingMove !== null) {
        return err('move_pending', `${state.pendingMove.mover} is already mid-move; settle it first`);
      }
      if (state.pendingAttack !== null) {
        return err('attack_pending', 'a hit is waiting for its damage; settle it first');
      }

      const owedHere = mayAct(state, who);
      if (owedHere !== null) return owedHere;

      const done = teleportTo(state, who, command, stamp);
      if (!done.ok) return done;
      return ok({ ...done.value, duplicate: false });
    },
  );
}

/**
 * The half with no identity of its own, for a caller that already has one.
 *
 * Same split as `castSpell` beneath `resolveCast` and `damageCreature` beneath
 * `resolveDamage`: a spell's `teleport` effect has already paid for the
 * casting through `castOrRelease`, which established the identity and asked
 * `mayAct` before the first die. Calling the command from inside an effect
 * would fingerprint a second object under the same id and could refuse a
 * resolution the action was already spent on — a refused operation that had
 * moved the world.
 *
 * **It is also the pre-flight, which is what makes a declared casting able to
 * settle.** `castOrRelease` runs it over every target **before the slot, the
 * action and the first die**, discarding the events: it is pure, rolls
 * nothing and changes nothing, so asking twice costs a caller nothing and
 * asking *once* would cost them the action. SRD Counterspell makes that
 * action "wasted" whatever follows, so a Misty Step declared at a space 120
 * feet away would spend it and then fail at every settlement for ever —
 * `resolveTurn` refusing `casting_pending` behind it. Every refusal this
 * function has is therefore reachable before anything is spent: the distance,
 * the occupied space, the scene's extent and the declared sight alike.
 *
 * **The caveat is `creatureTypeNeeds`' own.** The pre-flight reads the world
 * as it stands rather than the world the casting's earlier effects leave, so
 * a spell that moved somebody and *then* teleported into their space would be
 * asked the question against the wrong world. No definition does, because a
 * casting applies one effect list to every target; the day one does, the
 * resolver's own answer is still the authoritative one.
 */
export function teleportTo(
  state: GameState,
  who: CharacterId,
  command: RelocateCommand,
  stamp: CommandStamp | null = null,
): Result<Omit<RelocateOutcome, 'duplicate'>> {
  if (creatureOf(state, who) === null) return unknownCreature(who);

  const scene = sceneFor(state, who, `${who} to be teleported within`);
  if (!scene.ok) return scene;

  if (positionOf(scene.value, who) === null) {
    return needsContext(
      'unplaced',
      `nobody has said where ${who} is standing, so there is nowhere to teleport from`,
      [
        {
          kind: 'position',
          subject: who,
          need: `where ${who} is standing`,
          because: 'a teleport is measured from where the creature is standing now',
          satisfyWith: `a placeCreatureInScene command for ${who}`,
        },
      ],
    );
  }

  // **Asked before the geometry**, because a `needs-context` costs nothing and
  // invites the caller straight back, where a refusal about occupancy would
  // send them looking for a different space they still could not see.
  const sight = teleportSight(state, who, command);
  if (!sight.ok) return sight;
  if (sight.value.needs.length > 0) {
    return needsContext(
      'visibility',
      `${who} cannot be teleported until ${sight.value.needs[0]!.need} is established`,
      sight.value.needs,
    );
  }
  const unverified = [...sight.value.unverified];

  const anchor = command.placement.from;

  // The destination goes through the same placement rules every other position
  // does, so it is measured on the lattice and the scene's extent and the
  // occupied spaces are the geometry's answers rather than a second copy of
  // them. `forced` is deliberately never passed: SRD Misty Step names "an
  // unoccupied space", and Dimension Door's own answer to an occupied one is
  // 4d6 Force damage rather than a creature standing inside another.
  const moved = moveCreature(scene.value, who, command.placement);
  if (!moved.ok) {
    // The refusal stays `moveCreature`'s; this says which fact about the anchor
    // is missing. It was written out here when a creature nobody had placed was
    // the only one it could be; an undeclared landmark joined it when that
    // stopped being a verdict, and `anchorNeeded` is the one place both are
    // answered.
    return anchorNeeded(moved, anchor, `${who} is being teleported to a space measured from it`);
  }

  // Measured from where they were, on the lattice, between volumes — the one
  // ruler this engine has.
  const feet = moved.value.distance;
  if (command.within !== undefined && feet > command.within) {
    return err(
      'teleport_too_far',
      `${who} may be teleported up to ${command.within} feet, and that space is ${feet} away`,
    );
  }

  return ok({
    events: [
      {
        type: 'creature-moved',
        id: who,
        placement: command.placement,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ],
    feet,
    unverified,
  });
}

/**
 * Whether the caster can see where they are going — asked in two places.
 *
 * **Sight is declared between two creatures and a destination is a
 * coordinate**, which is the gap CLAUDE.md already records for Arcane Sword's
 * "a spot you can see". What the engine *can* read is the anchor a placement
 * is measured from: "beside the ogre" is a space the teleporter can see if
 * they can see the ogre. Anchored on a landmark or a bare point there is no
 * pairwise declaration to read and nothing it could read instead, so the
 * clause goes unchecked and says so in `unverified` rather than passing
 * silently — the three-valued discipline declared cover and declared sight
 * already follow, with the third value written down.
 *
 * Private, and reached only through {@link teleportTo} — which is itself the
 * pre-flight, so this question is asked before the slot without anybody
 * having to remember to ask it separately.
 */
function teleportSight(
  state: GameState,
  who: CharacterId,
  command: RelocateCommand,
): Result<{ readonly needs: readonly ContextRequest[]; readonly unverified: readonly string[] }> {
  if (command.requiresSight !== true) return ok({ needs: [], unverified: [] });

  const anchor = command.placement.from;
  if (!('creature' in anchor)) {
    return ok({
      needs: [],
      unverified: [
        `${who} must be able to see where they are going, and the destination is measured from something sight is not declared between; nobody can say`,
      ],
    });
  }

  // **The teleporting creature's senses**: "an unoccupied space *you* can
  // see" is the mover's clause, and the anchor's own Darkvision shows the
  // mover nothing.
  const seen = canSee(state, who, anchor.creature);
  if (seen === false) {
    return err(
      'cannot_see_destination',
      `${who} cannot see ${anchor.creature}, and the destination is measured from them`,
    );
  }
  if (seen === null) {
    return ok({
      needs: [
        {
          kind: 'visibility',
          subject: anchor.creature,
          need: `whether ${who} can see ${anchor.creature}`,
          because: 'the spell teleports its caster to a space they can see',
          satisfyWith: `a declareSightBetween command from ${who} to ${anchor.creature}`,
        },
      ],
      unverified: [],
    });
  }
  return ok({ needs: [], unverified: [] });
}
