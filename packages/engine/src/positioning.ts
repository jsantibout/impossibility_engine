import { err, needsContext, ok, type CharacterId, type Result } from '@ie/shared';
import type { CreatureSize } from '@ie/srd';

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
  /** Sizes, which every rule about sharing a space depends on. */
  readonly sizes: Readonly<Record<string, CreatureSize>>;
  /** Heights in feet, as declared. Absent means nobody has said. */
  readonly heights: Readonly<Record<string, number>>;
  /** Declared cover, keyed `attacker>target` — cover is directional. */
  readonly cover: Readonly<Record<string, CoverDegree>>;
  /**
   * Who can see whom, declared rather than ray-cast — same reasoning as cover.
   *
   * Directional, and deliberately three-valued: `true` seen, `false` unseen,
   * and *absent* meaning nobody has said. A spell that needs sight treats the
   * third as a fact to go and establish, not as a no.
   */
  readonly sight: Readonly<Record<string, boolean>>;
  /** Who is riding what, and whether the mount consented. */
  readonly riding: Readonly<Record<string, Ride>>;
}

export interface Ride {
  readonly mount: CharacterId;
  /**
   * The SRD only covers a *willing* mount. Clinging to a hostile creature is
   * recorded rather than refused, and flagged so narration and any ongoing
   * checks know which it was.
   */
  readonly willing: boolean;
}

export function scene(extent: SceneExtent): PositionState {
  return {
    extent,
    landmarks: {},
    positions: {},
    sizes: {},
    heights: {},
    cover: {},
    sight: {},
    riding: {},
  };
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
  const on = snapPoint(at);
  if (!within(state.extent, on)) {
    return err('outside_scene', `${name} does not fit inside this scene`);
  }
  return ok({ ...state, landmarks: { ...state.landmarks, [name]: on } });
}

/**
 * What a placement is measured from.
 *
 * The three a caller may use are all relative to something the fiction has
 * already established, which is what keeps a placement from drifting away from
 * the narration — the model never types coordinates. The fourth is the
 * engine's own and is documented on the variant.
 */
export type Anchor =
  | { readonly creature: CharacterId }
  | { readonly landmark: string }
  /** For the first thing in an otherwise empty scene. A deliberate choice, not a default. */
  | { readonly sceneCenter: true }
  /**
   * A point the engine has already worked out for itself.
   *
   * **Not for callers.** "The model never types raw coordinates" is the rule
   * that keeps a placement tied to something just narrated, and it stands: no
   * tool surface exposes this. It exists because a *deferred* placement can
   * outlive its anchor — a move waits on Opportunity Attacks, and the creature
   * it was measured from can be killed and removed before the move completes.
   * Re-resolving then fails, and the `creature-moved` event that results can
   * never be folded again: an append-only log with an unfoldable event in it is
   * a campaign that will not load.
   *
   * So a declared move carries the destination it measured, and falls back to
   * it when the anchor it named is gone. The fallback is a fact the engine
   * recorded, not a coordinate anybody invented.
   */
  | { readonly point: Point };

export interface Placement {
  readonly from: Anchor;
  readonly feet: number;
  /** Compass bearing in degrees: 0 is +y, 90 is +x. Swept for if omitted. */
  readonly bearing?: number;
  /** Height above the anchor, for a flying creature. */
  readonly elevation?: number;
  /**
   * Defaults to Medium. Unlike a position, this is a safe default — most
   * creatures are Medium, and size only affects who may share a space.
   */
  readonly size?: CreatureSize;
  /**
   * Height in feet. This is fiction, so it is Maestro's to decide — a giraffe
   * and a hippopotamus are both Large and nothing about the size category
   * distinguishes them. See {@link heightOf} for what happens when nobody says.
   */
  readonly height?: number;
}

/** SRD "Creature Size and Space": the width of the square a creature occupies. */
const FOOTPRINT: Readonly<Record<CreatureSize, number>> = {
  // SRD gives Tiny a 2.5-foot space, four to a square. The lattice has no half
  // cubes, so a Tiny creature holds one — the rules that actually care about
  // Tiny are the size-category ones (passing through, sharing a space), and
  // those read the category rather than the footprint.
  tiny: 5,
  small: 5,
  medium: 5,
  large: 10,
  huge: 15,
  gargantuan: 20,
};

export function footprintOf(size: CreatureSize): number {
  return FOOTPRINT[size];
}

/**
 * Whether a creature's height was actually declared, rather than assumed.
 *
 * A tool surface can use this to ask Maestro for a height when one would change
 * the answer — a blast at head height against something tall — instead of
 * quietly proceeding on a guess.
 */
export function isHeightDeclared(state: PositionState, who: CharacterId): boolean {
  return state.heights[who] !== undefined;
}

/**
 * A creature's height in feet.
 *
 * The SRD gives every creature a *space* but never a height, and size category
 * is a poor proxy: a giraffe and a hippopotamus are both Large. Height is part
 * of the fiction, so Maestro declares it.
 *
 * Falling back to the footprint keeps the geometry working when nobody has
 * said — it is a placeholder so nothing crashes, not a claim the engine knows
 * how tall anything is. {@link isHeightDeclared} distinguishes the two.
 */
export function heightOf(state: PositionState, who: CharacterId): number {
  const declared = state.heights[who];
  // Snapped like every other measurement: an eighteen-foot giraffe stands four
  // cubes tall, because the game has no half-cubes.
  return Math.max(CUBE, snap(declared ?? footprintOf(state.sizes[who] ?? 'medium')));
}

interface Box {
  readonly min: Point;
  readonly max: Point;
}

/**
 * The volume a creature occupies: its footprint centred on its position, rising
 * from its feet to its height.
 *
 * Treating creatures as points made a tall creature mechanically flat — a blast
 * at head height missed it entirely — and put a Huge creature's only point
 * seven feet inside its own body, out of a fighter's reach.
 */
function boxOf(state: PositionState, who: CharacterId): Box | null {
  const at = state.positions[who];
  if (at === undefined) return null;

  // A creature is anchored at its own cube and extends from there, so every
  // bound stays on the lattice. Centring a Large creature would put its edges
  // on half cubes, which the game has no notion of.
  const width = footprintOf(state.sizes[who] ?? 'medium');

  return {
    min: at,
    max: { x: at.x + width, y: at.y + width, z: at.z + heightOf(state, who) },
  };
}

/**
 * The centre of every cube a creature occupies.
 *
 * A grid resolves an area of effect by asking whether a square's *centre* falls
 * inside the template, rather than whether any sliver of it is clipped. That is
 * both how the game is actually adjudicated and what keeps a blast from
 * catching someone because half a foot of their shoulder was in range.
 */
const cubeCentre = (p: Point): Point => ({
  x: p.x + CUBE / 2,
  y: p.y + CUBE / 2,
  z: p.z + CUBE / 2,
});

const cubeCentres = (box: Box): Point[] => {
  const points: Point[] = [];
  for (let x = box.min.x; x < box.max.x; x += CUBE) {
    for (let y = box.min.y; y < box.max.y; y += CUBE) {
      for (let z = box.min.z; z < box.max.z; z += CUBE) {
        points.push({ x: x + CUBE / 2, y: y + CUBE / 2, z: z + CUBE / 2 });
      }
    }
  }
  return points;
};

const SIZE_ORDER: readonly CreatureSize[] = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
];

const sizeRank = (size: CreatureSize): number => SIZE_ORDER.indexOf(size);

export function sizeOf(state: PositionState, who: CharacterId): CreatureSize | null {
  return state.sizes[who] ?? null;
}

export interface PassageContext {
  /** Allies may always be passed through, and cost nothing to pass through. */
  readonly allied?: boolean;
  /** SRD: an Incapacitated creature may be passed through whatever its size. */
  readonly occupantIncapacitated?: boolean;
}

/**
 * SRD: "During your move, you can pass through the space of an ally, a creature
 * that has the Incapacitated condition, a Tiny creature, or a creature that is
 * two sizes larger or smaller than you."
 */
export function canPassThrough(
  mover: CreatureSize,
  occupant: CreatureSize,
  context: PassageContext,
): boolean {
  if (context.allied === true) return true;
  if (context.occupantIncapacitated === true) return true;
  // Tiny is a blanket exception in both directions, not merely a size gap.
  if (mover === 'tiny' || occupant === 'tiny') return true;
  return Math.abs(sizeRank(mover) - sizeRank(occupant)) >= 2;
}

/**
 * SRD: "Another creature's space is Difficult Terrain for you unless that
 * creature is Tiny or your ally."
 *
 * Note this is a *different* exception list from {@link canPassThrough}: an
 * Incapacitated ogre can be squeezed past, but it still costs double.
 */
export function isDifficultTerrain(occupant: CreatureSize, context: PassageContext): boolean {
  if (context.allied === true) return false;
  return occupant !== 'tiny';
}

/**
 * SRD: "If you somehow end a turn in a space with another creature, you have
 * the Prone condition unless you are Tiny or are of a larger size than the
 * other creature."
 */
export function endsProne(mover: CreatureSize, occupant: CreatureSize): boolean {
  if (mover === 'tiny') return false;
  return sizeRank(mover) <= sizeRank(occupant);
}

function resolveAnchor(state: PositionState, anchor: Anchor): Result<Point> {
  if ('point' in anchor) return ok(anchor.point);
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
    return needsContext('unplaced', `${anchor.creature} has no position to measure from`);
  }
  return ok(at);
}

/** Bearings tried, in order, when the caller does not name one. */
const BEARING_SWEEP = [0, 90, 180, 270, 45, 135, 225, 315];

/**
 * Offset a point by a bearing and a distance, on the same metric distance uses.
 *
 * Trigonometric projection is wrong here, and visibly so: asked for a creature
 * 30 feet away on a diagonal it produced an offset of (21, 21), which the
 * engine's own Chebyshev ruler then measured as 20 feet. The placement and the
 * ruler disagreed.
 *
 * Normalising the direction by its Chebyshev norm rather than its Euclidean
 * one fixes that: a diagonal at 30 feet offsets (30, 30), which measures 30.
 * That is what a diagonal step costing the same as an orthogonal one means.
 */
const project = (from: Point, feet: number, bearing: number, elevation: number): Point => {
  const radians = (bearing * Math.PI) / 180;
  const east = Math.sin(radians);
  const north = Math.cos(radians);

  // Scale so the dominant axis carries the full distance.
  const dominant = Math.max(Math.abs(east), Math.abs(north));
  const scale = dominant === 0 ? 0 : feet / dominant;

  return snapPoint({
    x: from.x + east * scale,
    y: from.y + north * scale,
    z: from.z + elevation,
  });
};

/**
 * Everything lives on a lattice of 5-foot cubes.
 *
 * SRD: "Each square represents 5 feet", and entering a diagonally adjacent
 * square costs the same one square as an orthogonal one. So distance in D&D is
 * Chebyshev, not Euclidean, and always an integer multiple of 5 — a diagonal
 * neighbour is 5 feet away, not 7.07, and nobody at a table ever hears "seven
 * and a half feet".
 *
 * The lattice is an internal representation, not a battlemap: nothing is
 * rendered, and Maestro still speaks in feet from landmarks.
 */
const CUBE = 5;

/** Snap a measurement in feet onto the lattice. */
const snap = (feet: number): number => Math.round(feet / CUBE) * CUBE;

const snapPoint = (p: Point): Point => ({ x: snap(p.x), y: snap(p.y), z: snap(p.z) });

/**
 * Whether a volume placed here would overlap anyone else's.
 *
 * Comparing anchor cubes was not enough: ranges are measured between occupied
 * volumes, so a Medium creature could be dropped *inside* a Large one simply by
 * having a different anchor. Occupancy now asks the same question the ruler
 * does.
 */
function occupied(
  state: PositionState,
  at: Point,
  size: CreatureSize,
  height: number,
  ignore: CharacterId | null,
): boolean {
  const width = footprintOf(size);
  const box: Box = {
    min: at,
    max: { x: at.x + width, y: at.y + width, z: at.z + Math.max(CUBE, snap(height)) },
  };

  return Object.keys(state.positions).some((who) => {
    if (who === ignore) return false;
    const other = boxOf(state, who as CharacterId);
    return other !== null && overlaps(box, other);
  });
}

function choosePoint(
  state: PositionState,
  from: Point,
  placement: Placement,
  moving: CharacterId | null,
  forced: boolean,
): Result<Point> {
  const { feet } = placement;
  if (!Number.isFinite(feet) || feet < 0) {
    return err('bad_distance', `${feet} is not a distance`);
  }

  const elevation = placement.elevation ?? 0;
  const named = placement.bearing !== undefined;
  const bearings = named ? [placement.bearing!] : BEARING_SWEEP;

  const size = placement.size ?? (moving === null ? 'medium' : (state.sizes[moving] ?? 'medium'));
  const height =
    placement.height ?? (moving === null ? footprintOf(size) : heightOf(state, moving));

  let blockedByCreature = false;

  for (const bearing of bearings) {
    const at = project(from, feet, bearing, elevation);
    if (!within(state.extent, at)) continue;
    // Two creatures cannot share a space. With no bearing named, keep sweeping;
    // with one named, the caller asked for somewhere specific and deserves to
    // hear that it is taken rather than be silently relocated.
    // SRD: "You can't *willingly* end a move in a space occupied by another
    // creature." Forced movement is exactly the "somehow" the rule allows for,
    // so a shove or a thunderwave may land on top of someone.
    if (!forced && occupied(state, at, size, height, moving)) {
      blockedByCreature = true;
      continue;
    }
    return ok(at);
  }

  // A zero-foot placement lands on the anchor itself, which is normally taken.
  // Sweeping outwards is the sensible reading of "put them right there".
  if (feet === 0 && !named) {
    for (const bearing of BEARING_SWEEP) {
      const at = project(from, CUBE, bearing, elevation);
      if (within(state.extent, at) && !occupied(state, at, size, height, moving)) return ok(at);
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
  // Placing is for a creature entering the scene. A creature that is already
  // somewhere moves — explicitly, spending movement — rather than being
  // silently teleported by a stray placement.
  if (state.positions[who] !== undefined) {
    return err('already_placed', `${who} is already in this scene; move them instead`);
  }

  const from = resolveAnchor(state, placement.from);
  if (!from.ok) return from;

  const at = choosePoint(state, from.value, placement, null, false);
  if (!at.ok) return at;

  const heights = { ...state.heights };
  if (placement.height !== undefined) heights[who] = placement.height;

  return ok({
    ...state,
    positions: { ...state.positions, [who]: at.value },
    sizes: { ...state.sizes, [who]: placement.size ?? 'medium' },
    heights,
  });
}

export interface MoveOutcome {
  readonly state: PositionState;
  /** How far the creature actually travelled, for the movement budget. */
  readonly distance: number;
  /** Anyone whose space the creature has ended up sharing. */
  readonly sharingWith: readonly CharacterId[];
  /**
   * Whether ending there leaves the creature Prone. Applying the condition is
   * the caller's job — `conditions.ts` owns what Prone then means.
   */
  readonly prone: boolean;
}

export interface MoveOptions {
  /**
   * Forced movement — a shove, a Thunderwave. SRD only forbids ending a move
   * in an occupied space *willingly*, so this permits it and reports the
   * consequence.
   */
  readonly forced?: boolean;
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
  options: MoveOptions = {},
): Result<MoveOutcome> {
  const current = state.positions[who];
  if (current === undefined) {
    return needsContext('unplaced', `${who} has no position to move from`);
  }

  const from = resolveAnchor(state, placement.from);
  if (!from.ok) return from;

  const forced = options.forced === true;
  const at = choosePoint(state, from.value, placement, who, forced);
  if (!at.ok) return at;

  const positions = { ...state.positions, [who]: at.value };

  // Riders travel with their mount — the reason this is a relationship rather
  // than a one-off offset. A dragon that takes off carries whoever is clinging
  // to it.
  for (const rider of ridersOf(state, who)) {
    positions[rider] = { ...at.value, z: at.value.z + RIDER_ELEVATION };
  }

  const moverSize = state.sizes[who] ?? 'medium';

  const sharingWith = Object.entries(positions)
    .filter(
      ([other, p]) =>
        other !== who && p.x === at.value.x && p.y === at.value.y && p.z === at.value.z,
    )
    .map(([other]) => other as CharacterId);

  return ok({
    state: { ...state, positions },
    distance: Math.max(
      Math.abs(at.value.x - current.x),
      Math.abs(at.value.y - current.y),
      Math.abs(at.value.z - current.z),
    ),
    sharingWith,
    prone: sharingWith.some((other) => endsProne(moverSize, state.sizes[other] ?? 'medium')),
  });
}

export function removeCreature(state: PositionState, who: CharacterId): Result<PositionState> {
  if (state.positions[who] === undefined) {
    return needsContext('unplaced', `${who} is not in this scene`);
  }
  const positions = { ...state.positions };
  delete positions[who];
  const sizes = { ...state.sizes };
  delete sizes[who];
  const heights = { ...state.heights };
  delete heights[who];

  // Anyone riding the departing creature is set down rather than vanishing
  // with it.
  const riding = { ...state.riding };
  delete riding[who];
  for (const rider of ridersOf(state, who)) delete riding[rider];

  return ok({ ...state, positions, sizes, heights, riding });
}

/**
 * Distance in feet between two creatures, measured between their spaces.
 *
 * SRD: "To determine the range on a grid between two things — whether creatures
 * or objects — count squares from a square adjacent to one of them and stop
 * counting in the space of the other one." Distance in D&D is always measured
 * space to space; nothing is ever measured centre to centre.
 *
 * That distinction is invisible between two Medium creatures and decisive
 * against a large one: a Huge creature's centre sits seven and a half feet
 * inside its own body, so centre-to-centre measurement reports a fighter
 * standing against its flank as out of melee range, and a spell range against
 * it as longer than it is.
 *
 * Measured through the air, so a wyvern hovering overhead is genuinely distant.
 *
 * An unplaced creature is reported as such. That is a signal back to the model,
 * which places the creature and carries on; it is never something a player sees.
 */
export function distanceBetween(
  state: PositionState,
  a: CharacterId,
  b: CharacterId,
): Result<number> {
  if (a === b) {
    return state.positions[a] === undefined
      ? needsContext('unplaced', `${a} needs placing before distances mean anything`)
      : ok(0);
  }

  const boxA = boxOf(state, a);
  const boxB = boxOf(state, b);
  if (boxA === null) return needsContext('unplaced', `${a} needs placing before distances mean anything`);
  if (boxB === null) return needsContext('unplaced', `${b} needs placing before distances mean anything`);

  return ok(chebyshev(boxA, boxB));
}

/**
 * How far a creature is from a bare point, in feet.
 *
 * "A point you choose within range" is a real target in the rules — Fireball
 * is aimed at one — and it has to be measured with the same ruler as
 * everything else, from the creature's volume rather than from an anchor cube.
 * There is one distance function in this file and this is a caller of it, not
 * a second one.
 */
export function distanceToPoint(
  state: PositionState,
  who: CharacterId,
  point: Point,
): Result<number> {
  const box = boxOf(state, who);
  if (box === null) return needsContext('unplaced', `${who} needs placing before distances mean anything`);
  return ok(chebyshev(box, pointBox(point)));
}

/**
 * Cubes between two occupied volumes, in feet.
 *
 * Taking the largest axis rather than the diagonal is the whole point: SRD
 * costs a diagonal step the same one square as an orthogonal one, so a creature
 * one cube north and one cube east is 5 feet away, not 7.07.
 */
function chebyshev(a: Box, b: Box): number {
  // Spans are half-open — a Medium creature at x=10 holds the cube from 10 up
  // to but not including 15 — so touching spans separate by zero.
  const gap = (minA: number, maxA: number, minB: number, maxB: number): number =>
    Math.max(0, Math.max(minA - maxB, minB - maxA));

  const steps = Math.max(
    gap(a.min.x, a.max.x, b.min.x, b.max.x),
    gap(a.min.y, a.max.y, b.min.y, b.max.y),
    gap(a.min.z, a.max.z, b.min.z, b.max.z),
  );

  // Touching spans are adjacent, and SRD counts an adjacent square as 5 feet:
  // range is counted "from a square adjacent to one of them" and stops "in the
  // space of the other one". Only genuine overlap is zero.
  if (steps > 0) return steps + CUBE;
  return overlaps(a, b) ? 0 : CUBE;
}

/**
 * The cube a point sits in, so one metric serves everything.
 *
 * A zero-size box can never overlap anything, which would report a blast
 * centred inside a dragon as five feet from it.
 */
const pointBox = (p: Point): Box => ({
  min: p,
  max: { x: p.x + CUBE, y: p.y + CUBE, z: p.z + CUBE },
});

const overlaps = (a: Box, b: Box): boolean =>
  a.min.x < b.max.x &&
  b.min.x < a.max.x &&
  a.min.y < b.max.y &&
  b.min.y < a.max.y &&
  a.min.z < b.max.z &&
  b.min.z < a.max.z;

/** Whether `target` is within `reach` feet of `attacker`, space to space. */
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

/**
 * Riding a creature.
 *
 * SRD Mounted Combat covers a *willing* creature at least one size larger with
 * an appropriate anatomy. It says nothing about leaping onto a hostile dragon,
 * which is among the most-attempted moves at any table — so that is permitted
 * and recorded as unwilling rather than refused. Whether the character got up
 * there is a check the DM calls for; the engine only tracks that they did.
 *
 * The rider sits one cube above the mount. Their volumes still overlap for
 * anything the mount is tall enough to carry, so they stay within reach of what
 * they are clinging to and an area of effect that catches the mount catches
 * them. Nothing knocks them Prone for sharing, because that rule governs
 * *movement* into an occupied space, and mounting is not movement.
 *
 * Deriving the offset from the mount's size would be more realistic and would
 * break the point of doing it: fifteen feet above a dragon you could no longer
 * melee the dragon you are clinging to. How high it looks is narration.
 */
const RIDER_ELEVATION = CUBE;

/** SRD: mounting "costs an amount of movement equal to half your Speed (round down)". */
export function mountingCost(speed: number): number {
  return Math.floor(Math.max(0, speed) / 2);
}

export function mountOf(state: PositionState, rider: CharacterId): CharacterId | null {
  return state.riding[rider]?.mount ?? null;
}

export function ridersOf(state: PositionState, mount: CharacterId): CharacterId[] {
  return Object.entries(state.riding)
    .filter(([, ride]) => ride.mount === mount)
    .map(([rider]) => rider as CharacterId);
}

export function isRidingUnwilling(state: PositionState, rider: CharacterId): boolean {
  const ride = state.riding[rider];
  return ride !== undefined && !ride.willing;
}

export interface MountOptions {
  /**
   * SRD Mounted Combat requires a willing mount. False records the house case:
   * clinging to a creature that would rather you did not.
   */
  readonly willing: boolean;
}

export function mount(
  state: PositionState,
  rider: CharacterId,
  target: CharacterId,
  options: MountOptions,
): Result<PositionState> {
  if (state.riding[rider] !== undefined) {
    return err('already_riding', `${rider} is already riding something`);
  }

  const mountAt = state.positions[target];
  if (state.positions[rider] === undefined) return needsContext('unplaced', `${rider} needs placing first`);
  if (mountAt === undefined) return needsContext('unplaced', `${target} needs placing first`);

  // SRD: "you can mount a creature that is within 5 feet of you" — measured
  // space to space like every other distance.
  const gap = distanceBetween(state, rider, target);
  if (!gap.ok) return gap;
  if (gap.value > 5) {
    return err('out_of_reach', `${target} is not within 5 feet of ${rider}`);
  }

  // SRD: a mount is "at least one size larger than a rider".
  const riderSize = state.sizes[rider] ?? 'medium';
  const mountSize = state.sizes[target] ?? 'medium';
  if (sizeRank(mountSize) <= sizeRank(riderSize)) {
    return err('too_small', `${target} is not larger than ${rider}`);
  }

  return ok({
    ...state,
    positions: { ...state.positions, [rider]: { ...mountAt, z: mountAt.z + RIDER_ELEVATION } },
    riding: { ...state.riding, [rider]: { mount: target, willing: options.willing } },
  });
}

export function dismount(
  state: PositionState,
  rider: CharacterId,
  placement: Placement,
): Result<PositionState> {
  if (state.riding[rider] === undefined) {
    return err('not_riding', `${rider} is not riding anything`);
  }

  const riding = { ...state.riding };
  delete riding[rider];

  const moved = moveCreature({ ...state, riding }, rider, placement);
  if (!moved.ok) return moved;

  return ok(moved.value.state);
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
      const axis = unit(subtract(cubeCentre(shape.towards), origin));
      if (axis === null) return false;
      const along = dot(offset, axis);
      if (along < 0 || along > shape.length) return false;
      // SRD: the Cone's width at distance `along` equals `along`, so its radius
      // there is half that.
      return perpendicular(offset, axis, along) <= along / 2;
    }

    case 'line': {
      const axis = unit(subtract(cubeCentre(shape.towards), origin));
      if (axis === null) return false;
      const along = dot(offset, axis);
      if (along < 0 || along > shape.length) return false;
      return perpendicular(offset, axis, along) <= shape.width / 2;
    }

    case 'cube': {
      const axis = unit(subtract(cubeCentre(shape.towards), origin));
      if (axis === null) return false;
      const along = dot(offset, axis);
      if (along < 0 || along > shape.size) return false;
      return perpendicular(offset, axis, along) <= shape.size / 2;
    }
  }
}

/**
 * Whether an area of effect catches any cube a creature occupies.
 *
 * Every shape is resolved the same way — cube centre against the template —
 * which is how a grid adjudicates it. A thirty-foot dragon is six cubes tall,
 * so a blast at head height catches its upper cubes and misses its feet.
 */
function boxInShape(
  origin: Point,
  originBox: Box,
  shape: AreaShape,
  box: Box,
): boolean {
  switch (shape.kind) {
    // A Sphere is centred on a *point*, so a large creature at its centre
    // does not widen it.
    case 'sphere':
      return chebyshev(pointBox(origin), box) <= shape.radius;

    // SRD: an Emanation "extends in straight lines from a creature or an
    // object in all directions" — from the creature, not from a point inside
    // it. So it starts at the boundary: a 10-foot Emanation around a
    // Gargantuan creature covers far more ground than one around a Medium,
    // and is not skewed toward the corner the creature is anchored at.
    case 'emanation':
      return chebyshev(originBox, box) <= shape.distance;

    // A Cylinder's radius and its height are separate constraints. Folding the
    // height into the one metric would let a creature hovering just above a
    // short cylinder count as inside its radius.
    case 'cylinder': {
      const column: Box = {
        min: { x: origin.x, y: origin.y, z: box.min.z },
        max: { x: origin.x + CUBE, y: origin.y + CUBE, z: box.max.z },
      };
      const withinRadius = chebyshev(column, box) <= shape.radius;
      const withinHeight = box.min.z < origin.z + shape.height && box.max.z > origin.z;
      return withinRadius && withinHeight;
    }

    // Cone, Line and Cube are directional, and a direction has no Chebyshev
    // shorthand. These resolve geometrically against the centre of each cube
    // the creature occupies — the way a grid adjudicates a template — and are
    // the one approximation in this module rather than an exact answer.
    default: {
      // Creatures are sampled at their cube centres, so the origin has to be
      // the centre of *its* cube too. Measuring from a lattice corner made a
      // Line drawn along a row of cubes miss every one of them.
      const from = cubeCentre(origin);
      return cubeCentres(box).some((p) => inShape(from, shape, p));
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
      return needsContext('unplaced', `${origin.creature} needs placing before its area can be resolved`);
    }
    at = found;
    originCreature = origin.creature;
  } else {
    at = origin.point;
  }

  // An Emanation measures from the whole creature; every other shape measures
  // from a point.
  const originBox =
    originCreature === null ? pointBox(at) : (boxOf(state, originCreature) ?? pointBox(at));

  const includeOrigin = options.includeOrigin ?? ORIGIN_INCLUDED_BY_DEFAULT.has(shape.kind);

  const caught: CharacterId[] = [];
  for (const [who, p] of Object.entries(state.positions)) {
    const id = who as CharacterId;
    const box = boxOf(state, id);
    if (box === null) continue;

    if (!boxInShape(at, originBox, shape, box)) continue;

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

/** Declare whether one creature can see another. Directional, like cover. */
export function declareSight(
  state: PositionState,
  from: CharacterId,
  to: CharacterId,
  seen: boolean,
): Result<PositionState> {
  if (from === to) return err('same_creature', 'a creature can see itself');
  return ok({ ...state, sight: { ...state.sight, [coverKey(from, to)]: seen } });
}

/**
 * Whether one creature can see another, or null when nobody has said.
 *
 * Null is the important value: it is not "no", it is "ask". A spell that
 * requires sight turns it into a request to go and establish the fact.
 */
export function sightBetween(
  state: PositionState,
  from: CharacterId,
  to: CharacterId,
): boolean | null {
  return state.sight[coverKey(from, to)] ?? null;
}
