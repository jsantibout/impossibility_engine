/**
 * A second place to put a creature: the record, and what reads it.
 *
 * The engine holds one scene. SRD prints a dozen sentences that take a
 * creature out of it without destroying it — Blink's Ethereal Plane, Find
 * Familiar's pocket dimension, Rope Trick's extradimensional space, a Giant
 * Frog's gullet — and every one of them wants the same three facts: **where
 * the creature is instead**, named as a kind of nowhere rather than modelled;
 * **the space it left**, because the way back is measured from it; and **the
 * rule the way back is checked against**, pinned when the creature left so
 * that a return a year later opens no book.
 *
 * While a creature is elsewhere it has no position — `positionOf` answers
 * null and every ruler refuses `not_here`, which is the refusal the unplaced
 * already earn under a name that says why — it is caught by no area and no
 * aura, and it holds whatever conditions the record hung under its `source`.
 * The way back is **stated, never invented**: a caller names the space, the
 * engine checks it against {@link ElsewhereReturn}, and where nobody named
 * one the engine takes the single space that qualifies or asks.
 *
 * Pure and content-free: readers over `GameState` and `PositionState`, with
 * no command and no event in them. `commands/elsewhere.ts` is the door and
 * `fold/elsewhere.ts` is the seam.
 */
import type { Ability, CharacterId, Skill } from '@ie/shared';
import type { CreatureSize, PrintedHoldCapacity } from '@ie/srd';
import { sizeAtMost } from './positioning.js';
import type { Deadline, TurnMoment } from './time.js';
import type { GameState } from './state.js';
import { castingIdOf } from './spells.js';
import {
  distanceBetweenPoints,
  distanceToPoint,
  placeCreature,
  type Point,
  type PositionState,
} from './positioning.js';

/**
 * The kinds of nowhere the book names.
 *
 * Three, and each is a different sentence about what reaches the creature:
 * `ethereal` is another plane overlapping this one (Blink, the Ghost's
 * Etherealness) — nothing here reaches it and it reaches nothing here;
 * `extradimensional` is a pocket with a door (Rope Trick, the familiar's
 * dismissal) — the same isolation, entered and left by the door; and `inside`
 * is another creature's body (Swallow, Engulf) — the one place that has a
 * neighbour, which is the host, and the host alone.
 */
export type ElsewhereKind = 'ethereal' | 'extradimensional' | 'inside';

/**
 * The mark the scene keeps on a creature that is away — see
 * `PositionState.away`. What the geometry needs to refuse `not_here` and to
 * let a swallowed creature reach its host, and nothing else.
 */
export interface AwayMark {
  readonly kind: ElsewhereKind;
  readonly host?: CharacterId;
}

/**
 * The rule the way back is checked against, pinned at the leaving.
 *
 * `within` is SRD's "within 10 feet of the space you vanished from" (Blink),
 * "within 30 feet of you" (Find Familiar, with `near` naming the caster),
 * "using 5 feet of movement" from the corpse (Swallow, with `near` the host).
 * **Zero is a rule rather than an absence**: the Etherealness lines return a
 * creature to the spot it left, and only if that spot is taken does the
 * nearest unoccupied space stand in — which is what a candidate search over a
 * radius of nothing finds.
 */
export interface ElsewhereReturn {
  /** Feet from the anchor the return may land within; 0 is the anchor itself. */
  readonly within: number;
  /**
   * The creature the return is measured from, where the sentence names one
   * rather than the space left: Find Familiar's "within 30 feet of you", a
   * Swallow's corpse. Absent, the anchor is {@link Elsewhere.from}.
   */
  readonly near?: CharacterId;
  /** SRD Blink's "a space of your choice that you can see". */
  readonly requiresSight?: true;
  /**
   * The moment the boundary performs the return at, where the sentence names
   * one — Blink's "At the start of your next turn". Absent, nothing but a
   * command or the casting's ending brings the creature back.
   */
  readonly at?: TurnMoment;
  /** SRD Swallow: "exiting with the Prone condition". */
  readonly prone?: true;
}

/**
 * What being inside a creature costs at its turn boundaries — SRD Giant
 * Toad's "takes 10 (3d6) Acid damage at the end of each of the toad's turns",
 * SRD Giant Frog's "At the end of the frog's next turn, the swallowed target
 * takes 5 (2d4) Acid damage. If that damage doesn't kill it, the frog
 * disgorges it".
 *
 * Two shapes, because the book writes two: a hit at **every** one of the
 * host's boundaries, and a hit at **one** deadline that ends the stay. The
 * dice are a notation rather than a total, thrown afresh at each boundary.
 */
export type ElsewhereDamage =
  | {
      readonly dice: string;
      readonly damageType: string;
      /** The host's turn boundary it recurs at. */
      readonly each: TurnMoment;
    }
  | {
      readonly dice: string;
      readonly damageType: string;
      /** The one boundary it falls due at, resolved when the creature was taken in. */
      readonly once: Deadline;
      /** "If that damage doesn't kill it, the frog disgorges it." */
      readonly disgorges: true;
    };

/**
 * The check a creature inside another may spend an action on to get out —
 * SRD Gelatinous Cube's "An engulfed target can try to escape by taking an
 * action to make a DC 12 Strength (Athletics) check." — W7-B10.
 *
 * Pinned on the record at the leaving, as the way back is, so the escape a
 * round later opens no book. Its own door (`escapeFromInside`) rather than an
 * `EffectCheck` on a timer, for `escapeGrapple`'s reason turned round: a
 * success here has to put the creature *somewhere*, and a space is a choice
 * the fold cannot make.
 */
export interface ElsewhereEscape {
  readonly ability: Ability;
  readonly skill?: Skill;
  readonly dc: number;
}

/**
 * A neighbour's action that pulls a creature out of another — SRD Ooze Cube's
 * "As an action, a creature within 5 feet of the cube can pull a creature or an
 * object out of the cube by succeeding on a DC 12 Strength (Athletics) check,
 * and the puller takes 10 (3d6) Acid damage." — W7-B10.
 *
 * {@link ElsewhereEscape}'s twin from the outside: the reach is measured to
 * the **host**, because the creature inside has no position to be within
 * five feet of. The price is the puller's, rolled where the pull lands.
 */
export interface ElsewherePullOut {
  readonly within: number;
  readonly ability: Ability;
  readonly skill?: Skill;
  readonly dc: number;
  readonly damage?: {
    readonly dice: string | null;
    readonly flat: number;
    readonly damageType: string;
  };
}

/** A creature's second place — see `CreatureState.elsewhere`. */
export interface Elsewhere {
  readonly kind: ElsewhereKind;
  /** The creature this one is inside, for the `inside` kind. */
  readonly host?: CharacterId;
  /**
   * The space the creature left, or null where it stood in no scene.
   *
   * Recorded by the fold off the scene at the moment of leaving, which is the
   * one moment the fact is knowable and the only copy the return needs.
   */
  readonly from: Point | null;
  /** The clock at the leaving, stamped by the fold. */
  readonly since: number;
  /**
   * What sent the creature: a casting's source, a kept bond's, or a printed
   * line's. What the record hung on the creature is filed under this, and the
   * return lifts exactly that.
   */
  readonly source: string;
  readonly returns: ElsewhereReturn;
  readonly damage?: ElsewhereDamage;
  /** The check the creature's own action buys to get out — W7-B10. */
  readonly escape?: ElsewhereEscape;
  /** The neighbour's action that pulls the creature out — W7-B10. */
  readonly pullOut?: ElsewherePullOut;
  /**
   * SRD Gelatinous Cube: an engulfed target "can't cast spells with a Verbal
   * component" — SRD Silence's standing, read by `silencedBy` off this record
   * while the creature is inside. — W7-B10.
   */
  readonly noVerbalCasting?: true;
}

/** The record on a creature, or null for one standing in the scene. */
export const elsewhereOf = (state: GameState, who: CharacterId): Elsewhere | null =>
  state.creatures[who]?.elsewhere ?? null;

/** The source a printed line files its hold under: `line:<host>/<heading>`. */
export const printedElsewhereSource = (host: CharacterId, line: string): string =>
  `line:${host}/${line}`;

/** The source a kept summons' dismissal files under: `kept:<summoner>/<spell>`. */
export const keptElsewhereSource = (by: CharacterId, spell: string): string =>
  `kept:${by}/${spell}`;

/** How a refusal reads where a creature is. */
export function describeElsewhere(record: Elsewhere): string {
  switch (record.kind) {
    case 'ethereal':
      return 'in the Ethereal Plane';
    case 'extradimensional':
      return 'in an extradimensional space';
    case 'inside':
      return record.host === undefined ? 'inside another creature' : `inside ${record.host}`;
  }
}

/** Everyone a creature is holding inside itself, sorted so every walk is fixed. */
export function heldInside(state: GameState, host: CharacterId): readonly CharacterId[] {
  return (Object.keys(state.creatures) as CharacterId[])
    .sort()
    .filter((who) => {
      const record = state.creatures[who]?.elsewhere;
      return record?.kind === 'inside' && record.host === host;
    });
}

/**
 * Whether a hold with room for so many has room for one more of this size —
 * W7-B10.
 *
 * SRD Ooze Cube: "the cube can hold one Large creature or up to four Medium or
 * Small creatures inside itself at a time." SRD Water Elemental's Whelm prints
 * the same shape over a grapple. A bare count is a count; the sized shape
 * reads the book's "or" as exclusive — a Large creature needs the hold empty,
 * and a smaller one needs no Large creature already in it and a place among
 * the smaller ones. A creature bigger than Large has no room at all: the
 * book names Large as the most the hold takes. The sizes are whatever the
 * caller measured, so an enlarged prisoner counts as what it is now.
 */
export function roomInside(
  capacity: PrintedHoldCapacity,
  held: readonly CreatureSize[],
  newcomer: CreatureSize,
): boolean {
  if ('creatures' in capacity) return held.length < capacity.creatures;
  const bigHeld = held.filter((size) => !sizeAtMost(size, 'medium')).length;
  const smallHeld = held.length - bigHeld;
  if (!sizeAtMost(newcomer, 'medium')) {
    return sizeAtMost(newcomer, 'large') && held.length === 0 && capacity.large >= 1;
  }
  return bigHeld === 0 && smallHeld < capacity.mediumOrSmaller;
}

/**
 * Creatures elsewhere whose casting has ended, and so are owed a return.
 *
 * SRD Rope Trick: "Anything inside the space drops out when the spell ends";
 * SRD Blink: "when the spell ends if you are on the Ethereal Plane, you
 * return". The casting ends in the fold, which may not choose a space, so the
 * return is a debt of `strandedSummons`' kind: derived from the world as it
 * stands, refused by the turn, settled by a command that names the space.
 *
 * A record sourced to no casting — a kept bond's pocket, a printed line — is
 * never stranded: its way back is its own door.
 */
export function strandedElsewhere(state: GameState): readonly CharacterId[] {
  return (Object.keys(state.creatures) as CharacterId[]).sort().filter((who) => {
    const record = state.creatures[who]?.elsewhere;
    if (record === null || record === undefined) return false;
    const castingId = castingIdOf(record.source);
    return castingId !== null && state.ongoing[castingId] === undefined;
  });
}

/**
 * The point a return is measured from, or null where the record has none.
 *
 * `near` first — the caster a familiar reappears beside, the corpse a
 * swallowed creature climbs out of — read off the scene as it stands, so a
 * caster who has moved is measured from where they are now. The space left
 * otherwise.
 */
export function returnAnchor(scene: PositionState, record: Elsewhere): Point | null {
  if (record.returns.near !== undefined) {
    return scene.positions[record.returns.near] ?? record.from;
  }
  return record.from;
}

/**
 * How far a space is from what the return is measured from — W7-B10.
 *
 * From the named creature's whole box where the record names one and it is
 * standing in the scene, so a space beside any part of a Large host is five
 * feet away; from the anchor point otherwise. The one ruler `returnCandidates`
 * and `settleReturn` share, so the candidates and the refusal cannot disagree.
 */
export function returnDistance(scene: PositionState, record: Elsewhere): (at: Point) => number {
  const near = record.returns.near;
  if (near !== undefined && scene.positions[near] !== undefined) {
    return (at) => {
      const apart = distanceToPoint(scene, near, at);
      return apart.ok ? apart.value : Number.POSITIVE_INFINITY;
    };
  }
  const anchor = returnAnchor(scene, record);
  return (at) => (anchor === null ? Number.POSITIVE_INFINITY : distanceBetweenPoints(anchor, at));
}

/**
 * Every space the record lets the creature come back to, on the lattice.
 *
 * Within `returns.within` of the anchor, unoccupied for the creature's own
 * size, inside the scene's extent, on the anchor's own level. **Where none
 * qualifies, the nearest unoccupied spaces stand in**, which is Blink's own
 * second sentence — "If no unoccupied space is available within that range,
 * you appear in the nearest unoccupied space" — and is searched ring by ring
 * so that the answer is the nearest ring and not the first free square a walk
 * happened to meet.
 *
 * Sorted, so two replays of one log take the same single candidate. A caller
 * that gets several back asks the table; one that gets exactly one takes it.
 */
export function returnCandidates(
  scene: PositionState,
  who: CharacterId,
  record: Elsewhere,
): readonly Point[] {
  const anchor = returnAnchor(scene, record);
  if (anchor === null) return [];
  const size: CreatureSize = scene.sizes[who] ?? 'medium';
  // The scene refuses to place a creature that is away — the return is the
  // door — so occupancy is asked of the scene with this one mark lifted, which
  // is exactly the world the return will land in.
  const probe: PositionState = {
    ...scene,
    away: Object.fromEntries(Object.entries(scene.away).filter(([key]) => key !== who)),
  };
  const free = (at: Point): boolean =>
    placeCreature(probe, who, { from: { point: at }, feet: 0, size }).ok;

  // **From the creature's whole box where the rule names a creature** —
  // W7-B10. "Within 5 feet of the cube" is five feet from any of the cube's
  // four cubes, and a Large host measured from its origin alone left the far
  // side of its body out of reach. The scan is widened by the largest
  // footprint so that far side is inside it; the ruler is exact.
  const measure = returnDistance(scene, record);
  const span = 20;
  const ring = (radius: number): readonly Point[] => {
    const found: Point[] = [];
    for (let x = anchor.x - radius - span; x <= anchor.x + radius + span; x += 5) {
      for (let y = anchor.y - radius - span; y <= anchor.y + radius + span; y += 5) {
        const at = { x, y, z: anchor.z };
        if (measure(at) !== radius) continue;
        if (free(at)) found.push(at);
      }
    }
    return found.sort((a, b) => a.x - b.x || a.y - b.y);
  };

  const within: Point[] = [];
  for (let radius = 0; radius <= record.returns.within; radius += 5) within.push(...ring(radius));
  if (within.length > 0) return within;

  // The nearest ring with anything free in it, out to the scene's own edge.
  const farthest = Math.max(scene.extent.width, scene.extent.depth);
  for (let radius = record.returns.within + 5; radius <= farthest; radius += 5) {
    const nearest = ring(radius);
    if (nearest.length > 0) return nearest;
  }
  return [];
}
