import { err, ok, type CharacterId, type Result } from '@ie/shared';

/**
 * Where things are.
 *
 * Positions are real coordinates, so distance is subtraction and area of effect
 * is an exact geometric test. Whether Fireball catches two goblins or three is
 * the most consequential positional call in the game, and it should not be a
 * judgement.
 *
 * What is guarded is *coherence*, not permission. Inventing a reasonable
 * position is the DM's job — the failure to prevent is a coordinate that nobody
 * chose, or one that contradicts what was just narrated. Hence: no silent
 * defaults, placement always relative to something established, binding once
 * made, and a declared scene extent.
 *
 * Cover and line of sight are declared rather than derived, because computing
 * them needs obstacle geometry, and that is where a rules engine becomes a VTT.
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

/** Feet, with `z` measured up from the floor. */
export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SceneExtent {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

export type CoverDegree = 'none' | 'half' | 'three-quarters' | 'total';

export interface PositionState {
  readonly extent: SceneExtent;
  readonly landmarks: Readonly<Record<string, Point>>;
  readonly positions: Readonly<Record<string, Point>>;
  /** Declared cover, keyed `attacker>target` — cover is directional. */
  readonly cover: Readonly<Record<string, CoverDegree>>;
}

export function scene(extent: SceneExtent): PositionState {
  return { extent, landmarks: {}, positions: {}, cover: {} };
}

export function positionOf(state: PositionState, who: CharacterId): Point | null {
  return state.positions[who] ?? null;
}

const within = (extent: SceneExtent, p: Point): boolean =>
  p.x >= 0 && p.x <= extent.width && p.y >= 0 && p.y <= extent.depth && p.z >= 0 && p.z <= extent.height;

/**
 * Landmarks are placed by coordinate because laying out a room is map-making,
 * not creature placement. Creatures then anchor to them.
 */
export function addLandmark(
  state: PositionState,
  name: string,
  at: Point,
): Result<PositionState> {
  if (!within(state.extent, at)) {
    return err('outside_scene', `${name} does not fit inside this scene`);
  }
  return ok({ ...state, landmarks: { ...state.landmarks, [name]: at } });
}

/**
 * What a placement is measured from. There is deliberately no "raw point"
 * option: the model states positions relative to things the fiction has already
 * established, which is what keeps a placement from drifting away from the
 * narration.
 */
export type Anchor =
  | { readonly creature: CharacterId }
  | { readonly landmark: string }
  /** For the first thing in an otherwise empty scene. A deliberate choice, not a default. */
  | { readonly sceneCenter: true };

export interface Placement {
  readonly from: Anchor;
  readonly feet: number;
  /** Compass bearing in degrees: 0 is +y, 90 is +x. Swept for if omitted. */
  readonly bearing?: number;
  /** Height above the anchor, for a flying creature. */
  readonly elevation?: number;
}

function resolveAnchor(state: PositionState, anchor: Anchor): Result<Point> {
  if ('sceneCenter' in anchor) {
    return ok({ x: state.extent.width / 2, y: state.extent.depth / 2, z: 0 });
  }
  if ('landmark' in anchor) {
    const at = state.landmarks[anchor.landmark];
    if (at === undefined) {
      return err('unknown_anchor', `there is no "${anchor.landmark}" in this scene`);
    }
    return ok(at);
  }
  const at = state.positions[anchor.creature];
  if (at === undefined) {
    return err('unplaced', `${anchor.creature} has no position to measure from`);
  }
  return ok(at);
}

/** Bearings tried, in order, when the caller does not name one. */
const BEARING_SWEEP = [0, 90, 180, 270, 45, 135, 225, 315];

const project = (from: Point, feet: number, bearing: number, elevation: number): Point => {
  const radians = (bearing * Math.PI) / 180;
  return {
    x: round(from.x + feet * Math.sin(radians)),
    y: round(from.y + feet * Math.cos(radians)),
    z: round(from.z + elevation),
  };
};

/** Keep coordinates tidy so replayed scenes compare exactly. */
const round = (n: number): number => Math.round(n * 1000) / 1000;

const occupied = (state: PositionState, at: Point, ignore: CharacterId | null): boolean =>
  Object.entries(state.positions).some(
    ([who, p]) => who !== ignore && p.x === at.x && p.y === at.y && p.z === at.z,
  );

function choosePoint(
  state: PositionState,
  from: Point,
  placement: Placement,
  moving: CharacterId | null,
): Result<Point> {
  const { feet } = placement;
  if (!Number.isFinite(feet) || feet < 0) {
    return err('bad_distance', `${feet} is not a distance`);
  }

  const elevation = placement.elevation ?? 0;
  const named = placement.bearing !== undefined;
  const bearings = named ? [placement.bearing!] : BEARING_SWEEP;

  let blockedByCreature = false;

  for (const bearing of bearings) {
    const at = project(from, feet, bearing, elevation);
    if (!within(state.extent, at)) continue;
    // Two creatures cannot share a space. With no bearing named, keep sweeping;
    // with one named, the caller asked for somewhere specific and deserves to
    // hear that it is taken rather than be silently relocated.
    if (occupied(state, at, moving)) {
      blockedByCreature = true;
      continue;
    }
    return ok(at);
  }

  // A zero-foot placement lands on the anchor itself, which is normally taken.
  // Sweeping outwards is the sensible reading of "put them right there".
  if (feet === 0 && !named) {
    for (const bearing of BEARING_SWEEP) {
      const at = project(from, 5, bearing, elevation);
      if (within(state.extent, at) && !occupied(state, at, moving)) return ok(at);
    }
  }

  return blockedByCreature
    ? err('occupied', `another creature is already standing there`)
    : err('outside_scene', `there is no room ${feet} feet from there inside this scene`);
}

/**
 * Place a creature that has no position yet.
 *
 * Maestro is expected to call this freely — a creature walking into the scene
 * is placed, not refused. What cannot happen is a position appearing without
 * this being called.
 */
export function placeCreature(
  state: PositionState,
  who: CharacterId,
  placement: Placement,
): Result<PositionState> {
  const from = resolveAnchor(state, placement.from);
  if (!from.ok) return from;

  const at = choosePoint(state, from.value, placement, null);
  if (!at.ok) return at;

  return ok({ ...state, positions: { ...state.positions, [who]: at.value } });
}

export interface MoveOutcome {
  readonly state: PositionState;
  /** How far the creature actually travelled, for the movement budget. */
  readonly distance: number;
}

/**
 * Move a creature that is already placed. Returns the distance travelled so the
 * caller can charge it against the turn's movement — `combat.ts` owns the
 * budget, this module owns the geometry.
 */
export function moveCreature(
  state: PositionState,
  who: CharacterId,
  placement: Placement,
): Result<MoveOutcome> {
  const current = state.positions[who];
  if (current === undefined) {
    return err('unplaced', `${who} has no position to move from`);
  }

  const from = resolveAnchor(state, placement.from);
  if (!from.ok) return from;

  const at = choosePoint(state, from.value, placement, who);
  if (!at.ok) return at;

  return ok({
    state: { ...state, positions: { ...state.positions, [who]: at.value } },
    distance: round(separation(current, at.value)),
  });
}

export function removeCreature(state: PositionState, who: CharacterId): Result<PositionState> {
  if (state.positions[who] === undefined) {
    return err('unplaced', `${who} is not in this scene`);
  }
  const positions = { ...state.positions };
  delete positions[who];
  return ok({ ...state, positions });
}

const separation = (a: Point, b: Point): number =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

/**
 * Distance in feet, measured through the air — so a wyvern hovering directly
 * overhead is genuinely 20 feet away rather than adjacent.
 *
 * An unplaced creature is reported as such. That is a signal back to the model,
 * which places the creature and carries on; it is never something a player sees.
 */
export function distanceBetween(
  state: PositionState,
  a: CharacterId,
  b: CharacterId,
): Result<number> {
  const from = state.positions[a];
  const to = state.positions[b];
  if (from === undefined) return err('unplaced', `${a} needs placing before distances mean anything`);
  if (to === undefined) return err('unplaced', `${b} needs placing before distances mean anything`);
  return ok(round(separation(from, to)));
}

/** Whether `target` is within `reach` feet of `attacker`. */
export function withinReach(
  state: PositionState,
  attacker: CharacterId,
  target: CharacterId,
  reach: number,
): Result<boolean> {
  const distance = distanceBetween(state, attacker, target);
  if (!distance.ok) return distance;
  return ok(distance.value <= reach);
}

const coverKey = (from: CharacterId, to: CharacterId): string => `${from}>${to}`;

/**
 * Cover is declared rather than derived, and is directional: the bar shields
 * the ogre from the fighter without shielding the fighter from the ogre.
 */
export function declareCover(
  state: PositionState,
  from: CharacterId,
  to: CharacterId,
  degree: CoverDegree,
): Result<PositionState> {
  return ok({ ...state, cover: { ...state.cover, [coverKey(from, to)]: degree } });
}

export function coverBetween(
  state: PositionState,
  from: CharacterId,
  to: CharacterId,
): CoverDegree {
  return state.cover[coverKey(from, to)] ?? 'none';
}

const COVER_RANK: Readonly<Record<CoverDegree, number>> = {
  none: 0,
  half: 1,
  'three-quarters': 2,
  total: 3,
};

/**
 * SRD: "If behind more than one degree of cover, a target benefits only from
 * the most protective degree."
 */
export function mostProtectiveCover(degrees: readonly CoverDegree[]): CoverDegree {
  return degrees.reduce<CoverDegree>(
    (best, degree) => (COVER_RANK[degree] > COVER_RANK[best] ? degree : best),
    'none',
  );
}

/**
 * SRD: Half Cover gives "+2 bonus to AC and Dexterity saving throws",
 * Three-Quarters Cover +5. Total Cover cannot be targeted at all, so it has no
 * bonus — see {@link canBeTargeted}.
 */
export function coverAcBonus(degree: CoverDegree): number {
  return degree === 'half' ? 2 : degree === 'three-quarters' ? 5 : 0;
}

/** SRD Total Cover: the target "can't be targeted directly". */
export function canBeTargeted(degree: CoverDegree): boolean {
  return degree !== 'total';
}

export type AreaShape =
  /** SRD: radius from the origin, which is included. */
  | { readonly kind: 'sphere'; readonly radius: number }
  /** SRD: radius of the base plus a height; the origin is included. */
  | { readonly kind: 'cylinder'; readonly radius: number; readonly height: number }
  /** SRD: width at any point equals that point's distance from the origin. */
  | { readonly kind: 'cone'; readonly length: number; readonly towards: Point }
  | { readonly kind: 'cube'; readonly size: number; readonly towards: Point }
  | { readonly kind: 'line'; readonly length: number; readonly width: number; readonly towards: Point }
  /** SRD: extends from a creature in all directions; that creature is excluded. */
  | { readonly kind: 'emanation'; readonly distance: number };

export type AreaOrigin =
  | { readonly point: Point }
  | { readonly creature: CharacterId };

export interface AreaOptions {
  /**
   * SRD: for a Cone, Cube, Line or Emanation the origin "isn't included in the
   * area of effect unless its creator decides otherwise".
   */
  readonly includeOrigin?: boolean;
}

const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const magnitude = (v: Point): number => Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y + a.z * b.z;

function unit(v: Point): Point | null {
  const length = magnitude(v);
  if (length === 0) return null;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/** Distance from a point to the axis running through the origin. */
const perpendicular = (offset: Point, axis: Point, along: number): number =>
  magnitude(subtract(offset, { x: axis.x * along, y: axis.y * along, z: axis.z * along }));

function inShape(origin: Point, shape: AreaShape, p: Point): boolean {
  const offset = subtract(p, origin);

  switch (shape.kind) {
    case 'sphere':
      return magnitude(offset) <= shape.radius;

    case 'emanation':
      return magnitude(offset) <= shape.distance;

    case 'cylinder': {
      const horizontal = Math.sqrt(offset.x ** 2 + offset.y ** 2);
      return horizontal <= shape.radius && offset.z >= 0 && offset.z <= shape.height;
    }

    case 'cone': {
      const axis = unit(subtract(shape.towards, origin));
      if (axis === null) return false;
      const along = dot(offset, axis);
      if (along < 0 || along > shape.length) return false;
      // SRD: the Cone's width at distance `along` equals `along`, so its radius
      // there is half that.
      return perpendicular(offset, axis, along) <= along / 2;
    }

    case 'line': {
      const axis = unit(subtract(shape.towards, origin));
      if (axis === null) return false;
      const along = dot(offset, axis);
      if (along < 0 || along > shape.length) return false;
      return perpendicular(offset, axis, along) <= shape.width / 2;
    }

    case 'cube': {
      const axis = unit(subtract(shape.towards, origin));
      if (axis === null) return false;
      const along = dot(offset, axis);
      if (along < 0 || along > shape.size) return false;
      return perpendicular(offset, axis, along) <= shape.size / 2;
    }
  }
}

/** Shapes whose point of origin is part of the area by default. */
const ORIGIN_INCLUDED_BY_DEFAULT = new Set(['sphere', 'cylinder']);

/**
 * Which placed creatures an area of effect catches.
 *
 * Creatures with no position are simply not in the area — the engine does not
 * guess where they might be. If the *origin* is an unplaced creature, that is
 * reported, so the model can place it and try again.
 */
export function creaturesInArea(
  state: PositionState,
  origin: AreaOrigin,
  shape: AreaShape,
  options: AreaOptions = {},
): Result<CharacterId[]> {
  let at: Point;
  let originCreature: CharacterId | null = null;

  if ('creature' in origin) {
    const found = state.positions[origin.creature];
    if (found === undefined) {
      return err('unplaced', `${origin.creature} needs placing before its area can be resolved`);
    }
    at = found;
    originCreature = origin.creature;
  } else {
    at = origin.point;
  }

  const includeOrigin = options.includeOrigin ?? ORIGIN_INCLUDED_BY_DEFAULT.has(shape.kind);

  const caught: CharacterId[] = [];
  for (const [who, p] of Object.entries(state.positions)) {
    const id = who as CharacterId;

    if (!inShape(at, shape, p)) continue;

    // The origin creature of an Emanation, or anything standing exactly on the
    // point of origin, is excluded unless the caster says otherwise.
    if (!includeOrigin) {
      if (originCreature !== null && id === originCreature) continue;
      if (p.x === at.x && p.y === at.y && p.z === at.z) continue;
    }

    caught.push(id);
  }

  return ok(caught);
}
