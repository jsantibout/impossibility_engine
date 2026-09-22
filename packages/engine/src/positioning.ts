import { err, needsContext, ok, type CharacterId, type Result } from '@ie/shared';
import type { CreatureSize } from '@ie/srd';
// Type-only, and deliberately: `events.ts` reads this module's geometry at
// value level, so a value edge back would be a real cycle.
import type { GameState } from './events.js';

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
 * A creature's own **senses** are the one thing the sight question consults
 * besides the declaration — a fact about the looker rather than a simulation
 * of the light, and one the declaration always outranks. See
 * {@link sightBetween}.
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
  /**
   * Ground that costs more to cross, by the name the table gave the patch.
   *
   * Declared, and for the same reason cover and sight are: five of the SRD's
   * six environmental examples — snow, rubble, furniture, a slope, a narrow
   * opening — are fiction, and working them out means modelling the room.
   * What the engine computes is everything downstream of the declaration:
   * which spaces the patch covers, what a crossing costs, and whether the
   * patch is still there. See {@link DifficultPatch}.
   */
  readonly terrain: Readonly<Record<string, DifficultPatch>>;
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
    terrain: {},
    riding: {},
  };
}

export function positionOf(state: PositionState, who: CharacterId): Point | null {
  return state.positions[who] ?? null;
}

/**
 * How far above the floor a creature is, or null if nobody has said where.
 *
 * `z` measured up from the floor is the lattice's own definition, and this is
 * the one place that fact is turned into a *height* — the distance to the
 * floor **of the lattice**, which is the only floor the engine has. A ledge,
 * a rooftop and a rope bridge are fiction and none of them is in here, so a
 * creature at 30 feet has thirty feet of air under it as far as this model is
 * concerned, exactly as it has whatever cover somebody declared and no other.
 *
 * `resolveFall` is the one caller, it asks only for a flier the air has
 * stopped holding up, and it reports the assumption rather than burying it: a
 * table that had a ledge in mind states the height instead, and a stated
 * height always wins.
 */
export function altitudeOf(state: PositionState, who: CharacterId): number | null {
  return positionOf(state, who)?.z ?? null;
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

/**
 * Whether a size is no larger than a named one — SRD's "Large or smaller".
 *
 * Off {@link SIZE_ORDER} rather than off a list of the sizes above the line,
 * so a seventh size is ranked by the one place sizes are ranked and cannot be
 * silently admitted by a literal nobody updated. The sentence appears on
 * Push's mastery property and on a good deal of SRD besides.
 */
export function sizeAtMost(size: CreatureSize, limit: CreatureSize): boolean {
  return sizeRank(size) <= sizeRank(limit);
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
 * The compass bearing from one creature to another, on the scene's own metric.
 *
 * SRD Push: "you can push the creature up to 10 feet **straight away from
 * yourself**" — a direction the engine had no way to name. `project` turns a
 * bearing into a point and is private; this is the other direction, and it is
 * exported because the sentence that needs it is a command's rather than a
 * placement's.
 *
 * Degrees, with 0 as +y and 90 as +x, which is what a {@link Placement} means
 * by `bearing` — so what comes back can be handed straight to one. Two
 * creatures in the same space have no bearing between them and say so, rather
 * than answering north.
 */
export function bearingBetween(
  state: PositionState,
  from: CharacterId,
  to: CharacterId,
): Result<number> {
  const here = positionOf(state, from);
  const there = positionOf(state, to);
  if (here === null) {
    return needsContext('unplaced', `${from} needs placing before a direction means anything`);
  }
  if (there === null) {
    return needsContext('unplaced', `${to} needs placing before a direction means anything`);
  }

  const east = there.x - here.x;
  const north = there.y - here.y;
  if (east === 0 && north === 0) {
    return err(
      'same_space',
      `${from} and ${to} are in the same space, and there is no direction between them`,
    );
  }

  const degrees = (Math.atan2(east, north) * 180) / Math.PI;
  return ok((degrees + 360) % 360);
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
 * How far one bare point is from another, in feet.
 *
 * The third caller of the one distance function, and the one that measures
 * nothing anybody is standing in. SRD Spiritual Weapon moves "the force up to
 * 20 feet", from where the force is to where it is going, and neither end of
 * that is a creature.
 *
 * Same ruler as everything else, so twenty feet here is the twenty feet a
 * fighter walks: each point is the cube it sits in, and the gap between two
 * cubes is counted the way a grid counts it.
 */
export function distanceBetweenPoints(a: Point, b: Point): number {
  return chebyshev(pointBox(a), pointBox(b));
}

/**
 * How far apart two creatures are, or null where nobody has said.
 *
 * Null is a real answer rather than a failure: positions are declared, so an
 * unplaced creature is one nobody has placed, not one standing nowhere. Every
 * rule that reads a distance has to decide what to do with the third case, and
 * none of them may decide it by assuming.
 */
export function apartFrom(state: GameState, a: CharacterId, b: CharacterId): number | null {
  if (state.scene === null) return null;
  const measured = distanceBetween(state.scene, a, b);
  return measured.ok ? measured.value : null;
}

/**
 * How far a target is from where the attack actually comes from.
 *
 * **Actor and spatial origin are two different things**, and Spiritual Weapon
 * is the first mechanic in the engine that separates them: the Cleric rolls
 * and the force is what is standing next to the goblin. Given a point, that
 * point is the ruler's end; given none, the actor is, which is every other
 * attack in the book.
 *
 * The alternative — moving the caster to the force, or making the force a
 * creature — would have been two lies in state to avoid one optional
 * argument.
 */
export function apartFromSource(
  state: GameState,
  from: Point | undefined,
  actor: CharacterId,
  target: CharacterId,
): number | null {
  if (from === undefined) return apartFrom(state, actor, target);
  if (state.scene === null) return null;
  const measured = distanceToPoint(state.scene, target, from);
  return measured.ok ? measured.value : null;
}

/**
 * The space a point sits in.
 *
 * SRD writes "a space of your choice" as often as it writes "a point you
 * choose", and a space is a cube on this lattice. Every creature position in
 * the engine is already snapped — `project` does it on the way out — so a
 * point that is going to be *kept* is snapped too, and a stored coordinate is
 * always one the engine could have produced itself.
 *
 * Not a default and not a guess: the caller chose the space, and this names
 * which cube that is.
 */
export function snapToSpace(point: Point): Point {
  return snapPoint(point);
}

/**
 * Whether a point is inside the scene's declared extent.
 *
 * "Scenes declare their extent" is the guard that stops a 60x40 tavern
 * containing a 1000-foot gap, and a point something *keeps* has to obey it for
 * the same reason a creature's position does.
 */
export function isInsideScene(state: PositionState, point: Point): boolean {
  return within(state.extent, point);
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

/**
 * Which convention a coordinate is read under.
 *
 * A lattice corner and a space's minimum corner are the same three numbers, so
 * a coordinate on its own cannot say which of the two it is — and that one bit
 * decides every footprint the game cares about. A 20-foot radius centred on a
 * *space* reaches nine spaces across; the same radius centred on the *corner*
 * between four of them reaches eight.
 *
 * Neither is wrong, and the SRD picks neither: its "Playing on a Grid" sidebar
 * gives rules for squares, Speed, entering a square, corners and ranges, and
 * says nothing whatever about areas of effect on a grid. The 8-square
 * convention most tables use comes from a 2014 optional rule. So the engine
 * does not choose — the caster does, and the log records which they chose.
 */
export type PointAnchoring = 'space' | 'intersection';

/**
 * Where a geometric origin or target sits.
 *
 * `space` names the 5-foot space with this minimum corner — the same
 * coordinate a creature's position is — and resolves to that space's centre.
 *
 * `intersection` names the vertical edge four spaces share, which is exactly
 * what a table means by an intersection of squares, and resolves to the point
 * on that edge at the mid-height of the space the coordinate names. **It is
 * horizontal, and deliberately so.** The convention it transcribes is about
 * squares on a map; nothing in the SRD, and nothing in the 2014 optional rule
 * it comes from, gives a vertical stack an intersection. Reading the
 * coordinate's `z` as a floor *plane* rather than as a space would drop every
 * origin half a space below every creature standing on that floor, which for
 * a 5-foot-wide Line is the whole of its half-width. A three-dimensional
 * corner is a third member if a rule ever asks for one; none does.
 *
 * The rule that falls out, with no spell named anywhere: **an even-space
 * footprint wants an intersection, an odd-space footprint wants a space.** A
 * 20-foot radius is 8 spaces (even) and a 5-foot-wide Line is 1 space (odd).
 */
export type AreaPoint =
  | { readonly space: Point }
  | { readonly intersection: Point };

/** An {@link AreaPoint} from a coordinate and the convention to read it under. */
export function areaPointAt(at: Point, anchoring: PointAnchoring = 'space'): AreaPoint {
  return anchoring === 'intersection' ? { intersection: at } : { space: at };
}

/** Which convention an {@link AreaPoint} was written under. */
export function anchoringOf(where: AreaPoint): PointAnchoring {
  return 'space' in where ? 'space' : 'intersection';
}

/** The bare coordinate inside an {@link AreaPoint}, whichever it names. */
export function coordinateOf(where: AreaPoint): Point {
  return 'space' in where ? where.space : where.intersection;
}

/**
 * The world point an {@link AreaPoint} denotes.
 *
 * The one conversion between the lattice and geometry. Every predicate below
 * consumes what this returns and nothing else, so an origin and the point it
 * is aimed at are always in the same frame *by construction* rather than
 * because one call site remembered to centre both.
 *
 * Snapped on the way through: a space that is not on the lattice is not a
 * space, and a corner that is not on the lattice is not a corner.
 */
function worldPointOf(where: AreaPoint): Point {
  if ('space' in where) return cubeCentre(snapPoint(where.space));
  // Horizontally the shared edge; vertically the mid-height of the space named,
  // for the reason set out on {@link AreaPoint}.
  const on = snapPoint(where.intersection);
  return { x: on.x, y: on.y, z: on.z + CUBE / 2 };
}

export type AreaShape =
  /** SRD: radius from the origin, which is included. */
  | { readonly kind: 'sphere'; readonly radius: number }
  /** SRD: radius of the base plus a height; the origin is included. */
  | { readonly kind: 'cylinder'; readonly radius: number; readonly height: number }
  /** SRD: width at any point equals that point's distance from the origin. */
  | { readonly kind: 'cone'; readonly length: number; readonly towards: AreaPoint }
  | { readonly kind: 'cube'; readonly size: number; readonly towards: AreaPoint }
  | {
      readonly kind: 'line';
      readonly length: number;
      readonly width: number;
      readonly towards: AreaPoint;
    }
  /** SRD: extends from a creature in all directions; that creature is excluded. */
  | { readonly kind: 'emanation'; readonly distance: number };

/** A shape that has to be pointed somewhere. */
type DirectionalShape = Extract<AreaShape, { readonly towards: AreaPoint }>;

export type AreaOrigin = AreaPoint | { readonly creature: CharacterId };

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

/**
 * Whether a directional template laid from `origin` towards `towards` covers
 * the world point `p`.
 *
 * **Both endpoints are world points and neither is converted here.** The axis
 * is the difference of two coordinates in one frame, so it cannot acquire a
 * half-space tilt from one side being centred and the other not — which is
 * what happens the moment a function takes one already-resolved point and one
 * raw lattice coordinate and is held together by a single call site.
 */
function inDirectional(
  origin: Point,
  towards: Point,
  shape: DirectionalShape,
  p: Point,
): boolean {
  const axis = unit(subtract(towards, origin));
  if (axis === null) return false;

  const offset = subtract(p, origin);
  const along = dot(offset, axis);

  switch (shape.kind) {
    case 'cone':
      if (along < 0 || along > shape.length) return false;
      // SRD: the Cone's width at distance `along` equals `along`, so its radius
      // there is half that.
      return perpendicular(offset, axis, along) <= along / 2;

    case 'line':
      if (along < 0 || along > shape.length) return false;
      return perpendicular(offset, axis, along) <= shape.width / 2;

    case 'cube':
      if (along < 0 || along > shape.size) return false;
      return perpendicular(offset, axis, along) <= shape.size / 2;
  }
}

/**
 * Chebyshev distance along one axis from a world coordinate to the nearest
 * space centre a span covers.
 *
 * This is the arithmetic that makes a radial area read the same as the ruler.
 * For an origin sitting at a *space centre* it agrees exactly with
 * {@link chebyshev} between that space and the span — touching spans give 0,
 * adjacent spans give 5, a gap of `g` gives `g + 5` — so moving the radial
 * shapes onto it changes no answer. What it adds is an origin that is *not* a
 * space centre: from a corner the nearest centres are 2.5 feet away instead of
 * 0, and the footprint comes out even.
 */
const axisGap = (from: number, lo: number, hi: number): number => {
  const first = lo + CUBE / 2;
  const last = hi - CUBE / 2;
  if (from <= first) return first - from;
  if (from >= last) return from - last;
  return Math.abs(first + Math.round((from - first) / CUBE) * CUBE - from);
};

/** Chebyshev distance from a world point to the nearest space a volume occupies. */
const pointToVolume = (from: Point, box: Box): number =>
  Math.max(
    axisGap(from.x, box.min.x, box.max.x),
    axisGap(from.y, box.min.y, box.max.y),
    axisGap(from.z, box.min.z, box.max.z),
  );

/** Whether any space centre in a span falls within `[from, to]`. */
const spanHoldsCentre = (lo: number, hi: number, from: number, to: number): boolean => {
  for (let centre = lo + CUBE / 2; centre < hi; centre += CUBE) {
    if (centre >= from && centre <= to) return true;
  }
  return false;
};

/**
 * Whether an area of effect catches any cube a creature occupies.
 *
 * Every shape is resolved the same way — cube centre against the template —
 * which is how a grid adjudicates it. A thirty-foot dragon is six cubes tall,
 * so a blast at head height catches its upper cubes and misses its feet.
 */
function boxInShape(
  /** The origin, already resolved to a world point. */
  origin: Point,
  /**
   * The origin's coordinate on the lattice, for the one rule that reads a
   * plane rather than a point.
   *
   * SRD: a Cylinder's "point of origin located at the center of the circular
   * top or bottom" — horizontally central, vertically on a *face*. So its
   * height is measured from the lattice plane the origin sits on, never from
   * a space's mid-height, which would leave a 40-foot Cylinder straddling
   * space boundaries and covering seven of them instead of eight.
   */
  anchor: Point,
  /** The origin creature's volume, for an Emanation. Null for a bare point. */
  originBox: Box | null,
  /** Where a directional shape points, already resolved to a world point. */
  towards: Point | null,
  shape: AreaShape,
  box: Box,
): boolean {
  switch (shape.kind) {
    // A Sphere is centred on a *point*, so a large creature at its centre
    // does not widen it.
    case 'sphere':
      return pointToVolume(origin, box) <= shape.radius;

    // SRD: an Emanation "extends in straight lines from a creature or an
    // object in all directions" — from the creature, not from a point inside
    // it. So it starts at the boundary: a 10-foot Emanation around a
    // Gargantuan creature covers far more ground than one around a Medium,
    // and is not skewed toward the corner the creature is anchored at.
    //
    // An Emanation asked for from a bare point has no creature to start at, so
    // it measures like a Sphere.
    case 'emanation':
      return originBox === null
        ? pointToVolume(origin, box) <= shape.distance
        : chebyshev(originBox, box) <= shape.distance;

    // A Cylinder's radius and its height are separate constraints. Folding the
    // height into the one metric would let a creature hovering just above a
    // short cylinder count as inside its radius.
    case 'cylinder': {
      const withinRadius =
        Math.max(
          axisGap(origin.x, box.min.x, box.max.x),
          axisGap(origin.y, box.min.y, box.max.y),
        ) <= shape.radius;
      return (
        withinRadius && spanHoldsCentre(box.min.z, box.max.z, anchor.z, anchor.z + shape.height)
      );
    }

    // Cone, Line and Cube are directional, and a direction has no Chebyshev
    // shorthand. These resolve geometrically against the centre of each cube
    // the creature occupies — the way a grid adjudicates a template — and are
    // the one approximation in this module rather than an exact answer.
    default:
      return towards !== null && cubeCentres(box).some((p) => inDirectional(origin, towards, shape, p));
  }
}

/** Shapes whose point of origin is part of the area by default. */
const ORIGIN_INCLUDED_BY_DEFAULT = new Set(['sphere', 'cylinder']);

/** Everything a shape has to be resolved against, once the origin is known. */
interface AreaFrame {
  /** The origin as a world point, which every predicate below consumes. */
  readonly world: Point;
  /** The origin's coordinate on the lattice, which the Cylinder's height reads. */
  readonly anchor: Point;
  /** The origin creature's volume, for an Emanation. Null for a bare point. */
  readonly originBox: Box | null;
  /**
   * The space the origin sits in, when it sits in one at all.
   *
   * A corner is not a space, so nobody can be standing on it — which is why
   * this is null there rather than the coordinate. The exclusion in
   * {@link creaturesInArea} asks "is this creature standing *on* the point of
   * origin", and for a corner the honest answer is nobody.
   */
  readonly originSpace: Point | null;
  readonly originCreature: CharacterId | null;
}

/**
 * Where an area sits, resolved once for whatever wants to ask what it covers.
 *
 * Two callers and one spelling: {@link creaturesInArea} asks which creatures a
 * shape catches, and {@link spaceInRegion} asks whether it lies over one
 * 5-foot space. A second copy of this would be a second chance for a Cylinder
 * to measure its height from a different plane than the one the ruler uses.
 */
function areaFrame(state: PositionState, origin: AreaOrigin): Result<AreaFrame> {
  if ('creature' in origin) {
    const found = state.positions[origin.creature];
    if (found === undefined) {
      return needsContext('unplaced', `${origin.creature} needs placing before its area can be resolved`);
    }
    return ok({
      world: cubeCentre(found),
      anchor: found,
      originBox: boxOf(state, origin.creature),
      originSpace: found,
      originCreature: origin.creature,
    });
  }

  const anchor = snapPoint(coordinateOf(origin));
  return ok({
    world: worldPointOf(origin),
    anchor,
    originBox: null,
    originSpace: 'space' in origin ? anchor : null,
    originCreature: null,
  });
}

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
  const frame = areaFrame(state, origin);
  if (!frame.ok) return frame;
  const { world, anchor, originBox, originSpace, originCreature } = frame.value;

  const towards = 'towards' in shape ? worldPointOf(shape.towards) : null;

  const includeOrigin = options.includeOrigin ?? ORIGIN_INCLUDED_BY_DEFAULT.has(shape.kind);

  const caught: CharacterId[] = [];
  for (const [who, p] of Object.entries(state.positions)) {
    const id = who as CharacterId;
    const box = boxOf(state, id);
    if (box === null) continue;

    if (!boxInShape(world, anchor, originBox, towards, shape, box)) continue;

    // The origin creature of an Emanation, or anything standing exactly on the
    // point of origin, is excluded unless the caster says otherwise.
    if (!includeOrigin) {
      if (originCreature !== null && id === originCreature) continue;
      if (
        originSpace !== null &&
        p.x === originSpace.x &&
        p.y === originSpace.y &&
        p.z === originSpace.z
      ) {
        continue;
      }
    }

    caught.push(id);
  }

  return ok(caught);
}

// — Difficult Terrain ————————————————————————————————————————————————————
//
// SRD: "If a space is Difficult Terrain, every foot of movement in that space
// costs 1 extra foot. For example, moving 5 feet through Difficult Terrain
// costs 10 feet of movement. Difficult Terrain isn't cumulative; either a
// space is Difficult Terrain or it isn't."
//
// **The line between what the table says and what the engine works out, drawn
// in one place because the whole design is where it falls.** The table
// declares the *patch*: which ground is expensive, how expensive, and which
// casting — if any — made it so. Five of the SRD's six environmental examples
// are fiction the engine holds no record of, and a spell's own area would
// only ever have covered the sixth. Everything after the declaration is the
// engine's: which spaces the shape covers, what crossing them costs, whether
// two patches overlap, and whether the patch is still there at all.
//
// The rate is a number rather than a flag because the book prints two of
// them. The glossary's Difficult Terrain is {@link DIFFICULT_TERRAIN}; Plant
// Growth and Wall of Thorns each cost four feet per foot, which no boolean
// can say and which a boolean would have had to be widened into the first
// time anybody transcribed them.

/** SRD's glossary rate: a foot of Difficult Terrain costs two feet to cross. */
export const DIFFICULT_TERRAIN = 2;

/** Ordinary ground: a foot costs a foot. */
const ORDINARY_GROUND = 1;

/**
 * Where a patch of ground lies, in the same vocabulary an area of effect uses.
 *
 * Deliberately the *same* vocabulary: a Web is a 20-foot Cube and a bank of
 * fog is a Sphere, and a second geometry for terrain would be a second place
 * for a Cylinder's height to be measured from the wrong plane.
 */
export interface TerrainRegion {
  readonly origin: AreaOrigin;
  readonly shape: AreaShape;
}

/** A patch of expensive ground, as the table declared it. */
export interface DifficultPatch {
  readonly region: TerrainRegion;
  /** Feet of movement spent per foot of ground. At least {@link DIFFICULT_TERRAIN}. */
  readonly costPerFoot: number;
  /**
   * The casting that made this ground expensive, if one did.
   *
   * A patch hung on a casting stops charging the moment that casting leaves
   * `state.ongoing` — dispelled, expired, Concentration broken, however it
   * went. That is derived at the moment the question is asked rather than
   * swept up by a pass of its own, so there is no window in which the webs
   * are gone and the ground still costs double.
   */
  readonly source?: string;
}

/**
 * Declare a patch of ground expensive to cross.
 *
 * Overwrites a patch of the same name, exactly as {@link declareCover} does
 * and for the same reason: ground changes. A mire freezes over, a rockfall
 * doubles the rubble, and the table says so again rather than arguing with
 * what it said before.
 */
export function declareDifficultPatch(
  state: PositionState,
  patch: string,
  region: TerrainRegion,
  costPerFoot: number,
  source?: string,
): Result<PositionState> {
  if (patch.trim().length === 0) {
    return err('bad_patch', 'a patch of ground needs a name, so a refusal can say what it was');
  }
  if (!Number.isInteger(costPerFoot) || costPerFoot < DIFFICULT_TERRAIN) {
    return err(
      'bad_terrain_cost',
      `${costPerFoot} feet per foot is not Difficult Terrain; the glossary's rate is ${DIFFICULT_TERRAIN} and a spell that prints its own prints a larger whole number`,
    );
  }

  return ok({
    ...state,
    terrain: {
      ...state.terrain,
      [patch]: { region, costPerFoot, ...(source === undefined ? {} : { source }) },
    },
  });
}

/**
 * Whether a region lies over one 5-foot space.
 *
 * The same geometry {@link creaturesInArea} uses, against the space itself
 * rather than against a creature's volume — and with **no origin exclusion**.
 * SRD's "the point of origin isn't included unless its creator decides
 * otherwise" is a sentence about a creature not being caught by their own
 * spell; a patch of ground has no creator standing on it, and Arcane Hand's
 * "its space counts as Difficult Terrain" wants the origin space included.
 */
function spaceInRegion(
  state: PositionState,
  region: TerrainRegion,
  space: Point,
): boolean {
  const frame = areaFrame(state, region.origin);
  // An unplaced origin creature is not anywhere, so its patch covers nothing.
  // The engine does not guess where the ground it carries might be.
  if (!frame.ok) return false;

  const at = snapPoint(space);
  const box: Box = { min: at, max: { x: at.x + CUBE, y: at.y + CUBE, z: at.z + CUBE } };
  const towards = 'towards' in region.shape ? worldPointOf(region.shape.towards) : null;

  return boxInShape(
    frame.value.world,
    frame.value.anchor,
    frame.value.originBox,
    towards,
    region.shape,
    box,
  );
}

/** What a foot of one space costs, and which patches made it cost that. */
export interface TerrainCharge {
  /** Feet of movement per foot of ground; {@link ORDINARY_GROUND} for open floor. */
  readonly costPerFoot: number;
  /** The patches lying over it, named so a refusal can say what slowed the mover. */
  readonly patches: readonly string[];
}

const OPEN_FLOOR: TerrainCharge = { costPerFoot: ORDINARY_GROUND, patches: [] };

/**
 * The patches still charging, in a fixed order.
 *
 * A patch a casting made lapses when that casting does, and this is where it
 * lapses: read from `state.ongoing` at the moment the question is asked,
 * rather than dropped by a pass that has to be remembered. Nothing can then
 * be stale, and a log folded a second time answers the same way because it
 * reads the same two facts.
 */
function livePatches(state: GameState): readonly (readonly [string, DifficultPatch])[] {
  const scene = state.scene;
  if (scene === null) return [];
  return Object.keys(scene.terrain)
    .sort()
    .flatMap((name) => {
      const patch = scene.terrain[name];
      if (patch === undefined) return [];
      if (patch.source !== undefined && state.ongoing[patch.source] === undefined) return [];
      return [[name, patch] as const];
    });
}

/**
 * The patches still charging, by name.
 *
 * For a caller that wants to say which declarations are in play without
 * asking about a space — a report rather than a charge. It reads the same
 * live view every other answer does, so a patch whose casting has ended is
 * absent here exactly as it is absent from the cost.
 */
export function liveTerrainNames(state: GameState): readonly string[] {
  return livePatches(state).map(([name]) => name);
}

/**
 * What crossing one space costs, and why.
 *
 * SRD: "Difficult Terrain isn't cumulative; either a space is Difficult
 * Terrain or it isn't." So two patches over one space cost what one does.
 * Where they disagree the dearer governs — the same shape the book gives
 * overlapping cover, where a target "benefits only from the most protective
 * degree" — because a space covered by thorns is thorny whatever else is also
 * growing there.
 */
export function terrainAt(state: GameState, space: Point): TerrainCharge {
  const scene = state.scene;
  return scene === null ? OPEN_FLOOR : chargeAt(scene, livePatches(state), space);
}

/**
 * {@link terrainAt} with the live list already in hand.
 *
 * The scans below ask about hundreds of spaces against the same handful of
 * patches, and rebuilding and re-sorting that list per space would be the
 * whole cost of the question.
 */
function chargeAt(
  scene: PositionState,
  patches: readonly (readonly [string, DifficultPatch])[],
  space: Point,
): TerrainCharge {
  let costPerFoot = ORDINARY_GROUND;
  const over: string[] = [];
  for (const [name, patch] of patches) {
    if (!spaceInRegion(scene, patch.region, space)) continue;
    over.push(name);
    if (patch.costPerFoot > costPerFoot) costPerFoot = patch.costPerFoot;
  }

  return over.length === 0 ? OPEN_FLOOR : { costPerFoot, patches: over };
}

/** What a stated route costs in feet of movement, and what charged for it. */
export interface RouteCharge {
  readonly cost: number;
  readonly patches: readonly string[];
}

/**
 * The cost of entering each space of a route, in order.
 *
 * The space a creature starts in is not among them: it is the space being
 * left, and SRD charges the extra foot for movement **in** a space, which a
 * creature entering the next one is no longer doing in the last.
 */
export function costOfRoute(state: GameState, spaces: readonly Point[]): RouteCharge {
  const scene = state.scene;
  const live = scene === null ? [] : livePatches(state);

  let cost = 0;
  const patches = new Set<string>();
  for (const space of spaces) {
    const here = scene === null ? OPEN_FLOOR : chargeAt(scene, live, space);
    cost += CUBE * here.costPerFoot;
    for (const name of here.patches) patches.add(name);
  }
  return { cost, patches: [...patches].sort() };
}

/**
 * The rate every space a shortest route could enter agrees on, or null.
 *
 * **This is what keeps the engine from asking for a route it does not need.**
 * If every space any shortest route could enter charges the same, then every
 * shortest route costs the same and the path has nothing to tell the engine
 * that it does not already know. Where they disagree, the number depends on
 * which spaces were crossed, and that is the table's to say.
 *
 * **The straight box between the endpoints is the wrong region, and by
 * exactly the amount Chebyshev distance is not Manhattan.** A move of 5 feet
 * across and 15 feet along is three steps, and one of them may be spent
 * sideways and taken back: (100, 100) to (105, 115) can go by way of
 * (110, 110), which the box misses altogether.
 *
 * The region is therefore the spaces `p` with `cheb(from, p) + cheb(p, to)`
 * equal to the distance itself — a walk of single spaces reaching `p` and
 * then the destination is exactly that long, so it is a shortest route if and
 * only if the two halves add up. That is the same set `checkRoute` will
 * accept, which is the property that matters: the engine never charges
 * without asking about ground a route it would accept could have crossed.
 *
 * The per-axis slack `(D - dᵢ) / 2`, rounded down to a whole space, is the
 * enclosing box the scan walks — necessary but not sufficient on its own,
 * because the two halves can reach their maxima on different axes, which is
 * why the test above is applied inside it rather than instead of it.
 *
 * The starting space is excluded, because it is the one space a move does not
 * enter.
 */
export function uniformTerrainBetween(
  state: GameState,
  from: Point,
  to: Point,
): TerrainCharge | null {
  const scene = state.scene;
  if (scene === null) return OPEN_FLOOR;
  const live = livePatches(state);
  if (live.length === 0) return OPEN_FLOOR;

  const start = snapPoint(from);
  const end = snapPoint(to);
  const reach = distanceBetweenPoints(start, end);
  /** The spaces one axis may wander to and still arrive in the same number of steps. */
  const span = (a: number, b: number, limit: number): readonly number[] => {
    const slack = Math.floor((reach - Math.abs(a - b)) / (2 * CUBE)) * CUBE;
    const lo = Math.max(0, Math.min(a, b) - slack);
    const hi = Math.min(limit, Math.max(a, b) + slack);
    const out: number[] = [];
    for (let v = lo; v <= hi; v += CUBE) out.push(v);
    return out;
  };

  let agreed: TerrainCharge | null = null;
  const patches = new Set<string>();
  for (const x of span(start.x, end.x, scene.extent.width)) {
    for (const y of span(start.y, end.y, scene.extent.depth)) {
      for (const z of span(start.z, end.z, scene.extent.height)) {
        if (x === start.x && y === start.y && z === start.z) continue;
        const space = { x, y, z };
        // The box is the enclosure; this is the region. See above.
        if (distanceBetweenPoints(start, space) + distanceBetweenPoints(space, end) > reach) {
          continue;
        }
        const here = chargeAt(scene, live, space);
        if (agreed === null) agreed = here;
        else if (agreed.costPerFoot !== here.costPerFoot) return null;
        for (const name of here.patches) patches.add(name);
      }
    }
  }

  return agreed === null
    ? OPEN_FLOOR
    : { costPerFoot: agreed.costPerFoot, patches: [...patches].sort() };
}

/**
 * Check a stated route: the spaces a mover says they passed through.
 *
 * A route is a **shortest** path, and a wandering one is refused rather than
 * charged. The budget is charged the distance the ruler measured, and an
 * Opportunity Attack is offered by comparing where the mover stood with where
 * they ended — so a detour through somebody's reach is a move that has to be
 * sent as segments, each of which the engine sees whole.
 */
export function checkRoute(
  state: PositionState,
  from: Point,
  to: Point,
  route: readonly Point[],
): Result<readonly Point[]> {
  const spaces = route.map(snapPoint);
  const steps = distanceBetweenPoints(from, to) / CUBE;

  if (spaces.length !== steps) {
    return err(
      'bad_route',
      `a ${steps * CUBE}-foot move crosses ${steps} spaces, and this route names ${spaces.length}; a route is the shortest path, so a longer way round is two moves rather than one`,
    );
  }

  let previous = snapPoint(from);
  for (const space of spaces) {
    const step = distanceBetweenPoints(previous, space);
    if (step !== CUBE) {
      return err(
        'bad_route',
        `a route is a walk of single spaces, and (${previous.x}, ${previous.y}, ${previous.z}) to (${space.x}, ${space.y}, ${space.z}) is ${step} feet`,
      );
    }
    if (!isInsideScene(state, space)) {
      return err('bad_route', `(${space.x}, ${space.y}, ${space.z}) is outside this scene`);
    }
    previous = space;
  }

  const end = snapPoint(to);
  if (previous.x !== end.x || previous.y !== end.y || previous.z !== end.z) {
    return err(
      'bad_route',
      `this route ends at (${previous.x}, ${previous.y}, ${previous.z}) and the move ends at (${end.x}, ${end.y}, ${end.z})`,
    );
  }

  return ok(spaces);
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
 * The senses the SRD rules glossary defines, in the words it defines them in.
 *
 * A closed vocabulary rather than a catalogue, on the same test everything
 * else at this boundary is held to: the book defines these four in its
 * *rules* glossary, beside the conditions and the actions, and a world that
 * wanted a fifth would be asking for a mechanic rather than for an entry. So
 * content may say which of the four a creature has and how far it reaches,
 * and may not invent a name nothing knows what to do with.
 *
 * Declared once, as a list, and the type read off it — two spellings of one
 * fact is how a validator and a union drift apart.
 */
export const SENSE_NAMES = ['blindsight', 'darkvision', 'tremorsense', 'truesight'] as const;

export type SenseName = (typeof SENSE_NAMES)[number];

/**
 * A sense a creature has, as the sight question reads it: which one, and how
 * far it reaches.
 *
 * "You have Darkvision with a range of 60 feet" is the SRD's sentence for all
 * four, which is why this is a pair rather than a flag — Goggles of Night
 * needs the answer to be a number, not a yes.
 */
export interface CreatureSense {
  readonly sense: SenseName;
  readonly feet: number;
}

/**
 * The three that are a form of sight, and the one that is not.
 *
 * SRD Tremorsense: a creature "can pinpoint the location of creatures and
 * moving objects within a specific range... **it doesn't count as a form of
 * sight**". Blindsight is defined as seeing "without relying on physical
 * sight" and Truesight as vision that "is enhanced", so both are. A rule, not
 * a second copy of the list above.
 */
export const SIGHT_SENSES: ReadonlySet<SenseName> = new Set<SenseName>([
  'blindsight',
  'darkvision',
  'truesight',
]);

/**
 * Which of a creature's senses actually reach another creature right now.
 *
 * The senses are passed in rather than read, because they are a fact about a
 * creature and this module holds space — `sensesOf` in `standing.ts` is what
 * derives them. Measured the way everything else is: Chebyshev between
 * volumes, on the cube lattice.
 *
 * Empty where either creature is unplaced, and empty for a creature and
 * itself: where a creature is standing has no right answer until somebody
 * says, and a creature needs no sense to know where it is.
 */
export function sensesReaching(
  state: PositionState,
  senses: readonly CreatureSense[],
  from: CharacterId,
  to: CharacterId,
): readonly CreatureSense[] {
  if (from === to || senses.length === 0) return [];
  const apart = distanceBetween(state, from, to);
  if (!apart.ok) return [];
  return senses.filter((sense) => apart.value <= sense.feet);
}

/**
 * Whether one creature can see another, or null when nobody has said.
 *
 * Null is the important value: it is not "no", it is "ask". A spell that
 * requires sight turns it into a request to go and establish the fact.
 *
 * **A creature can see itself, and that is the engine's fact rather than the
 * table's.** It used to be null, and the hole that left was the worst defect
 * this module has had: `resolveTargets` turned the null into a request to
 * establish whether a caster could see themselves, and {@link declareSight}
 * refused to record the answer — so Healing Word and Mass Healing Word could
 * not be cast on their own casters at all, and Boots of Levitation had no way
 * into a catalogue. The refusal was right; asking was not. So the pair
 * answers first, before the declaration, before cover and before any sense:
 * there is nothing for a table to establish and nothing a wall could stand
 * in the way of.
 *
 * **A declaration always outranks a sense.** Sight here is a fact the table
 * states, because computing it needs obstacle geometry; a sense is a fact
 * about the creature doing the looking, and all it may do is answer where
 * nobody has stated anything. A dwarf whose Darkvision reaches ninety feet is
 * still blind to whatever the table said she cannot see, and the engine holds
 * no Bright, Dim or Darkness to condition the sense on — which is exactly why
 * the declaration wins rather than the other way about.
 *
 * The senses default to none, so a caller that has no creature to read them
 * off asks the pairwise question and gets the pairwise answer.
 *
 * **Declared Total Cover silences a sense**, which is the other half of the
 * same rule: cover is a declaration too, it lives in this state beside
 * sight, and a target under it "can't be targeted directly". The glossary
 * spells the consequence out on Blindsight — "you can see anything that
 * **isn't** behind Total Cover" — and it is no less true of the other two.
 * The answer then falls back to null rather than to `false`: the sense has
 * nothing to say, and what the table declared was about cover rather than
 * about sight, so the honest response is still to ask.
 */
export function sightBetween(
  state: PositionState,
  from: CharacterId,
  to: CharacterId,
  senses: readonly CreatureSense[] = [],
): boolean | null {
  if (from === to) return true;
  const declared = state.sight[coverKey(from, to)];
  if (declared !== undefined) return declared;
  if (!canBeTargeted(coverBetween(state, from, to))) return null;

  const reaching = sensesReaching(
    state,
    senses.filter((sense) => SIGHT_SENSES.has(sense.sense)),
    from,
    to,
  );
  return reaching.length > 0 ? true : null;
}
