import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { declaredCasting } from './spellcasting.js';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { anchoringFor, resolveSpell } from './commands.js';
import {
  SPELL_DEFINITIONS,
  definitionFor,
  type SpellDefinition,
} from './spell-definitions.js';
import {
  addLandmark,
  anchoringOf,
  areaPointAt,
  coordinateOf,
  creaturesInArea,
  distanceToPoint,
  placeCreature,
  positionOf,
  scene,
  type AreaPoint,
  type AreaShape,
  type Point,
  type PositionState,
} from './positioning.js';

/**
 * A coordinate says *where*, never *what*.
 *
 * A lattice corner and a space's minimum corner are the same three numbers, so
 * a bare `Point` cannot say which of the two it is — and that one bit decides
 * every footprint the game argues about. The engine used to answer it by
 * convention held at one call site: an area origin was read as a *space*, and
 * a 20-foot radius therefore came out nine spaces across.
 *
 * Nothing here says that was wrong. SRD 5.2.1's "Playing on a Grid" sidebar
 * gives rules for squares, Speed, entering a square, corners and ranges, and
 * says **nothing at all** about areas of effect on a grid; the 8-square
 * footprint most tables expect comes from a 2014 optional rule ("choose an
 * intersection"). Neither is mandated, so the engine declines to pick — it
 * makes both sayable, and records which was said.
 *
 * What these tests pin is that the two are different things, that the
 * footprint follows from which was chosen rather than from anything named
 * after a spell, and that both endpoints of a directional template are always
 * read in the same frame.
 */

const id = (s: string) => asCharacterId(s);

/** Big enough that nothing here is ever decided by the scene's edge. */
const arena = (): PositionState => scene({ width: 400, depth: 400, height: 100 });

/** The middle of the arena, on the lattice. Every fixture measures from here. */
const O: Point = { x: 200, y: 200, z: 0 };

const shift = (p: Point, dx: number, dy = 0, dz = 0): Point => ({
  x: p.x + dx,
  y: p.y + dy,
  z: p.z + dz,
});

/**
 * Put a creature in an exact space.
 *
 * Placement is relative to something established, always — so an exact space
 * is stated as a landmark and the creature is placed nowhere from it. That is
 * not a back door: the landmark is a coordinate somebody laid out, which is
 * what `addLandmark` is for.
 */
function standing(state: PositionState, who: string, at: Point): PositionState {
  const named = unwrap(addLandmark(state, `${who}-spot`, at), 'landmark');
  return unwrap(placeCreature(named, id(who), { from: { landmark: `${who}-spot` }, feet: 0 }), who);
}

/** A row of Medium creatures every 5 feet along one axis, centred on `O`. */
function row(axis: 'x' | 'y' | 'z', from = -6, to = 6): PositionState {
  let state = arena();
  for (let k = from; k <= to; k += 1) {
    const at =
      axis === 'x'
        ? shift(O, k * 5)
        : axis === 'y'
          ? shift(O, 0, k * 5)
          : shift(O, 0, 0, k * 5);
    if (at.x < 0 || at.y < 0 || at.z < 0) continue;
    state = standing(state, `k${k}`, at);
  }
  return state;
}

/**
 * A row across a template's width, ten feet along it.
 *
 * Far enough east that nobody in it is standing on the point of origin, which
 * a Cone, Cube or Line excludes by default — otherwise a width measurement
 * comes back one short for a reason that has nothing to do with the width.
 */
function across10(from = -3, to = 3): PositionState {
  let state = arena();
  for (let j = from; j <= to; j += 1) state = standing(state, `k${j}`, shift(O, 10, j * 5));
  return state;
}

/** Which offsets along the row an area caught, in order. */
function offsets(
  state: PositionState,
  origin: Parameters<typeof creaturesInArea>[1],
  shape: AreaShape,
  options: Parameters<typeof creaturesInArea>[3] = {},
): number[] {
  const caught = unwrap(creaturesInArea(state, origin, shape, options), 'area');
  return caught
    .map((who) => Number(String(who).slice(1)) * 5)
    .sort((a, b) => a - b);
}

/** The distance in feet from the first space caught to the last. */
const span = (feet: readonly number[]): number =>
  feet.length === 0 ? 0 : feet[feet.length - 1]! - feet[0]! + 5;

describe('a space and an intersection are different places', () => {
  it('names the same coordinate under two conventions', () => {
    const space = areaPointAt(O);
    const crossing = areaPointAt(O, 'intersection');

    expect(anchoringOf(space)).toBe('space');
    expect(anchoringOf(crossing)).toBe('intersection');
    // Same three numbers. The difference is in what they are said to mean, and
    // nowhere else — which is exactly why a bare Point could not carry it.
    expect(coordinateOf(space)).toEqual(coordinateOf(crossing));
    expect(coordinateOf(space)).toEqual(O);
  });

  it('defaults to a space, because that is what every existing casting meant', () => {
    expect(areaPointAt(O)).toEqual({ space: O });
  });

  /**
   * A space is something a creature stands in. An intersection is not a space
   * at all, so nobody can be standing on one — which is the whole distinction,
   * stated where it is observable.
   */
  it('has a creature standing on a space origin and nobody on an intersection', () => {
    const state = standing(arena(), 'goblin', O);
    expect(positionOf(state, id('goblin'))).toEqual(O);

    const sphere = { kind: 'sphere', radius: 20 } as const;
    // SRD lets the creator exclude the point of origin. The creature in that
    // space is on it; the creature beside the intersection is not.
    expect(
      unwrap(creaturesInArea(state, { space: O }, sphere, { includeOrigin: false }), 'space'),
    ).toEqual([]);
    expect(
      unwrap(creaturesInArea(state, { intersection: O }, sphere, { includeOrigin: false }), 'crossing'),
    ).toEqual([id('goblin')]);
  });
});

describe('the footprint follows from the origin, not from the spell', () => {
  const sphere = { kind: 'sphere', radius: 20 } as const;

  /**
   * The tabletop footprint: 8 spaces, 40 feet, symmetric about the crossing.
   *
   * Nothing in this test knows what Fireball is. The radius is a number and
   * the origin is an intersection, and 8 falls out of the arithmetic.
   */
  it('gives a 20-foot radius an 8-space, 40-foot footprint from an intersection', () => {
    const caught = offsets(row('x'), { intersection: O }, sphere);
    expect(caught).toHaveLength(8);
    expect(span(caught)).toBe(40);
    // Symmetric about the crossing: four spaces each side, whose centres run
    // from 17.5 feet west to 17.5 feet east of it.
    expect(caught).toEqual([-20, -15, -10, -5, 0, 5, 10, 15]);
  });

  /** The same radius on a space: 9 across, and just as deliberate. */
  it('gives the same radius a 9-space, 45-foot footprint from a space', () => {
    const caught = offsets(row('x'), { space: O }, sphere);
    expect(caught).toHaveLength(9);
    expect(span(caught)).toBe(45);
    expect(caught).toEqual([-20, -15, -10, -5, 0, 5, 10, 15, 20]);
  });

  it('gives the same answer on every axis, so the lattice has no favourite direction', () => {
    for (const axis of ['x', 'y'] as const) {
      expect(offsets(row(axis), { intersection: O }, sphere)).toHaveLength(8);
      expect(offsets(row(axis), { space: O }, sphere)).toHaveLength(9);
    }
  });

  /**
   * Two dimensions, which is where the convention is usually argued about: the
   * 8x8 block a table draws around an intersection.
   */
  it('covers 8 by 8 spaces around an intersection', () => {
    let state = arena();
    for (let i = -5; i <= 5; i += 1) {
      for (let j = -5; j <= 5; j += 1) {
        state = standing(state, `c${i + 5}_${j + 5}`, shift(O, i * 5, j * 5));
      }
    }
    const caught = unwrap(creaturesInArea(state, { intersection: O }, sphere), 'block');
    expect(caught).toHaveLength(64);
    expect(unwrap(creaturesInArea(state, { space: O }, sphere), 'block')).toHaveLength(81);
  });

  /**
   * An even footprint wants an intersection and an odd one wants a space, and
   * it is one rule rather than a fact about any particular template. A 20-foot
   * Cube is 4 spaces on a side; a 5-foot-wide Line is 1 space wide.
   */
  it('gives a 20-foot Cube 4 spaces deep from an intersection and 5 from a space', () => {
    const eastward = (towards: AreaPoint): AreaShape =>
      ({ kind: 'cube', size: 20, towards }) as const;

    // SRD: a Cube's point of origin "isn't included in the area of effect
    // unless its creator decides otherwise", so the depth is counted with the
    // origin space in, or the two conventions would be compared across a
    // difference that is about inclusion rather than about the lattice.
    const alongX = row('x', 0, 6);
    const depth = (origin: AreaPoint, towards: AreaPoint): number[] =>
      offsets(alongX, origin, eastward(towards), { includeOrigin: true });

    expect(
      depth(areaPointAt(O, 'intersection'), areaPointAt(shift(O, 60), 'intersection')),
    ).toEqual([0, 5, 10, 15]);
    expect(depth(areaPointAt(O), areaPointAt(shift(O, 60)))).toEqual([0, 5, 10, 15, 20]);
  });

  it('gives a 5-foot-wide Line one space from a space and two from an intersection', () => {
    // Creatures across the Line's width, ten feet along it so that none of
    // them is standing on the point of origin.
    const across = across10();
    const line = (towards: AreaPoint): AreaShape =>
      ({ kind: 'line', length: 60, width: 5, towards }) as const;

    expect(offsets(across, { space: O }, line(areaPointAt(shift(O, 60))))).toEqual([0]);
    expect(
      offsets(across, { intersection: O }, line(areaPointAt(shift(O, 60), 'intersection'))),
    ).toEqual([-5, 0]);
  });
});

describe('a directional template reads both endpoints in one frame', () => {
  const eastRow = () => row('x', 0, 8);

  /**
   * The half-space tilt, and why it cannot happen.
   *
   * A near aiming point is where a mixed frame shows up: aiming from an
   * intersection at a *space* one step away offsets the axis by 2.5 feet on
   * two axes, which is an 18 degree tilt, and a 60-foot Line then drifts 19
   * feet sideways by its far end. Under one frame the axis is the difference
   * of two coordinates written the same way, so a near aiming point and a far
   * one on the same ray give the identical template.
   */
  it('gives a near aiming point and a far one the same template, on a space frame', () => {
    const line = (towards: Point): AreaShape =>
      ({ kind: 'line', length: 60, width: 5, towards: areaPointAt(towards) }) as const;

    const near = offsets(eastRow(), { space: O }, line(shift(O, 5)));
    const far = offsets(eastRow(), { space: O }, line(shift(O, 60)));
    expect(near).toEqual(far);
    expect(near).toEqual([5, 10, 15, 20, 25, 30, 35, 40]);
  });

  it('gives a near aiming point and a far one the same template, on an intersection frame', () => {
    const line = (towards: Point): AreaShape =>
      ({
        kind: 'line',
        length: 60,
        width: 5,
        towards: areaPointAt(towards, 'intersection'),
      }) as const;

    const near = offsets(eastRow(), { intersection: O }, line(shift(O, 5)));
    const far = offsets(eastRow(), { intersection: O }, line(shift(O, 60)));
    expect(near).toEqual(far);
  });

  /**
   * A Cone narrows to nothing at its apex, so it is the shape a tilt ruins
   * soonest. Aimed along a row of spaces it catches the row, near aim or far.
   */
  it('keeps a Cone on its row however close the aiming point is', () => {
    const cone = (towards: Point): AreaShape =>
      ({ kind: 'cone', length: 40, towards: areaPointAt(towards) }) as const;

    const near = offsets(eastRow(), { space: O }, cone(shift(O, 5)));
    const far = offsets(eastRow(), { space: O }, cone(shift(O, 40)));
    expect(near).toEqual(far);
    expect(near.length).toBeGreaterThan(0);
  });

  /**
   * The trap this pass removed, kept visible.
   *
   * Mixing the frames is constructible at the geometry layer — the two members
   * are just data — and it is exactly what an implementation does when one
   * endpoint is silently centred and the other is not. It is a different
   * template, which is why no command builds one: `placeArea` reads a single
   * anchoring for the whole shape.
   */
  it('is a different template when the two ends are written in different frames', () => {
    const consistent = offsets(eastRow(), { intersection: O }, {
      kind: 'line',
      length: 60,
      width: 5,
      towards: areaPointAt(shift(O, 5), 'intersection'),
    });
    const mixed = offsets(eastRow(), { intersection: O }, {
      kind: 'line',
      length: 60,
      width: 5,
      towards: areaPointAt(shift(O, 5)),
    });
    expect(mixed).not.toEqual(consistent);
  });
});

describe('the radial shapes measure with the ruler everything else uses', () => {
  /**
   * The proof that moving Sphere and Cylinder onto space centres changed no
   * answer: for a space origin, area membership is exactly
   * `distanceToPoint <= radius`, and `distanceToPoint` is the same box-counted
   * Chebyshev that reach and spell range have always used.
   *
   * Swept across sizes and offsets rather than spot-checked, because the case
   * that would break is a creature whose volume is wider than one space.
   */
  it('agrees with distanceToPoint for every size, offset and radius', () => {
    for (const size of ['medium', 'large', 'huge', 'gargantuan'] as const) {
      for (let k = 0; k <= 8; k += 1) {
        const at = shift(O, k * 5);
        const named = unwrap(addLandmark(arena(), 'spot', at), 'landmark');
        const state = unwrap(
          placeCreature(named, id('mark'), { from: { landmark: 'spot' }, feet: 0, size }),
          'placed',
        );
        const away = unwrap(distanceToPoint(state, id('mark'), O), 'distance');

        for (const radius of [0, 5, 10, 15, 20, 25, 30, 40]) {
          const caught = unwrap(
            creaturesInArea(state, { space: O }, { kind: 'sphere', radius }),
            'sphere',
          );
          expect(
            caught.includes(id('mark')),
            `${size} at ${k * 5} feet, radius ${radius}: distance ${away}`,
          ).toBe(away <= radius);
        }
      }
    }
  });
});

describe('three dimensions stay coherent', () => {
  /**
   * An intersection is a **horizontal** convention, and this is where that is
   * observable. The vertical edge four spaces share is taken at the mid-height
   * of the space named, so the two conventions differ in x and y and agree in
   * z. Reading the coordinate's z as a floor plane instead would put every
   * origin half a space below every creature standing on that floor.
   */
  it('splits the footprint horizontally and leaves the vertical alone', () => {
    const sphere = { kind: 'sphere', radius: 20 } as const;
    const upward = row('z', 0, 8);
    expect(offsets(upward, { intersection: O }, sphere)).toEqual(
      offsets(upward, { space: O }, sphere),
    );
    // And the horizontal halves genuinely differ, so the test above is not
    // passing because the two conventions are the same thing.
    expect(offsets(row('x'), { intersection: O }, sphere)).not.toEqual(
      offsets(row('x'), { space: O }, sphere),
    );
  });

  it('catches a tall creature from either convention alike', () => {
    const named = unwrap(addLandmark(arena(), 'lair', O), 'landmark');
    const state = unwrap(
      placeCreature(named, id('dragon'), {
        from: { landmark: 'lair' },
        feet: 0,
        size: 'huge',
        height: 30,
      }),
      'dragon',
    );
    // 20 feet up, well inside a 30-foot dragon standing on the floor.
    const overhead = shift(O, 0, 0, 20);
    const sphere = { kind: 'sphere', radius: 20 } as const;
    expect(unwrap(creaturesInArea(state, { space: overhead }, sphere), 'space')).toEqual([
      id('dragon'),
    ]);
    expect(
      unwrap(creaturesInArea(state, { intersection: overhead }, sphere), 'crossing'),
    ).toEqual([id('dragon')]);
  });

  /** A Cylinder's height is a plane, not a point: SRD puts its origin on a face. */
  it('measures a Cylinder’s height from the lattice plane under both conventions', () => {
    const named = unwrap(addLandmark(arena(), 'perch', shift(O, 0, 0, 10)), 'landmark');
    const state = unwrap(
      placeCreature(named, id('bat'), { from: { landmark: 'perch' }, feet: 0 }),
      'bat',
    );
    for (const origin of [{ space: O }, { intersection: O }] as const) {
      expect(
        unwrap(creaturesInArea(state, origin, { kind: 'cylinder', radius: 20, height: 10 }), 'low'),
      ).toEqual([]);
      expect(
        unwrap(creaturesInArea(state, origin, { kind: 'cylinder', radius: 20, height: 20 }), 'high'),
      ).toEqual([id('bat')]);
    }
  });
});

/**
 * The command layer's half: a casting says which convention it used, once, for
 * the whole template — and a casting that says nothing means what it always
 * meant.
 */
describe('a casting states its convention and keeps it', () => {
  const WIZARD = id('kessa');

  const sheet = (): CharacterSheet => ({
    level: 5,
    abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: true, shields: true },
    baseSpeed: 30,
    spellcastingAbility: 'int',
  });

  const added = (who: CharacterId): GameEvent => ({
    type: 'creature-added',
    id: who,
    name: who,
    sheet: sheet(),
    maxHp: 40,
    diesAtZero: false,
    creatureType: 'Humanoid',
  });

  /**
   * Four creatures around one intersection, each 20 feet from it on a
   * diagonal — the classic "drop it between them" shape. A 20-foot radius
   * centred on that intersection reaches 17.5 feet to a space centre, so it
   * catches the inner ring and not these.
   */
  const CROSSING: Point = { x: 200, y: 200, z: 0 };

  const setup = (): readonly GameEvent[] => [
    added(WIZARD),
    added(id('east')),
    added(id('west')),
    {
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 3, recovers: 'long-rest' },
    },
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the pillar', at: { x: 100, y: 200, z: 0 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the pillar' }, feet: 0 } },
    // 20 feet east of the crossing: inside a space-centred Sphere, outside an
    // intersection-centred one. The one space the two conventions disagree on.
    { type: 'landmark-added', name: 'east mark', at: { x: 220, y: 200, z: 0 } },
    { type: 'creature-placed', id: id('east'), placement: { from: { landmark: 'east mark' }, feet: 0 } },
    { type: 'landmark-added', name: 'west mark', at: { x: 185, y: 200, z: 0 } },
    { type: 'creature-placed', id: id('west'), placement: { from: { landmark: 'west mark' }, feet: 0 } },
    {
      type: 'spellcasting-declared',
      id: WIZARD,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['fireball', 'burning-hands'] }),
    },
  ];

  const supply = () => ({
    issuer: createRollIssuer('r'),
    rng: createRng('anchoring') as Rng,
    bonuses: [{ source: 'forced', flat: -40 }],
  });

  const caught = (state: GameState, request: Parameters<typeof resolveSpell>[2]) =>
    unwrap(resolveSpell(state, WIZARD, request, supply()), 'cast')
      .outcomes.map((o) => o.target)
      .sort();

  const base = (): GameState => fold('seed', setup());

  it('catches the far space on a space origin and not on an intersection', () => {
    const onSpace = caught(base(), {
      spellId: 'fireball',
      targets: [],
      at: CROSSING,
      slotLevel: 3,
      commandId: 'c1',
    });
    const onCrossing = caught(base(), {
      spellId: 'fireball',
      targets: [],
      at: CROSSING,
      anchoring: 'intersection',
      slotLevel: 3,
      commandId: 'c2',
    });

    expect(onSpace).toContain(id('east'));
    expect(onCrossing).not.toContain(id('east'));
    // Both catch the creature that is comfortably inside either template, so
    // the difference above is the convention and not the fixture.
    expect(onSpace).toContain(id('west'));
    expect(onCrossing).toContain(id('west'));
  });

  /**
   * `space` **is** the absence, so a casting that names it and one that says
   * nothing fold to the same bytes. Two records that mean the same thing must
   * not serialise differently, or a replay comparison starts failing on
   * bookkeeping.
   */
  it('folds a casting that names `space` identically to one that says nothing', () => {
    const cast = (anchoring?: 'space'): GameState => {
      const log = setup();
      const out = unwrap(
        resolveSpell(
          fold('seed', log),
          WIZARD,
          {
            spellId: 'fireball',
            targets: [],
            at: CROSSING,
            slotLevel: 3,
            commandId: 'c',
            ...(anchoring === undefined ? {} : { anchoring }),
          },
          supply(),
        ),
        'cast',
      );
      return fold('seed', [...log, ...out.events]);
    };

    expect(JSON.stringify(cast('space'))).toEqual(JSON.stringify(cast()));
  });

  /** A self-origin area is anchored by the caster's own space; there is no choice to make. */
  it('refuses a convention for an area that starts at the caster', () => {
    const result = resolveSpell(
      base(),
      WIZARD,
      {
        spellId: 'burning-hands',
        targets: [],
        towards: { x: 160, y: 200, z: 0 },
        anchoring: 'intersection',
        slotLevel: 3,
        commandId: 'c',
      },
      supply(),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('area_starts_at_caster');
  });
});

/**
 * Which convention a casting reads its footprint under, and who decides.
 *
 * Three sources, in one order, resolved in one function so that the geometry
 * and the ongoing record cannot disagree: **the request, then the definition,
 * then `space`.** The request path is driven end to end above; this pins the
 * precedence itself, which is the half no SRD content exercises.
 */
describe('a spell may declare the footprint its template wants', () => {
  const fireball = definitionFor('fireball')!;

  const declaring = (anchoring: 'space' | 'intersection'): SpellDefinition => ({
    ...fireball,
    anchoring,
  });

  it('falls back to a space when neither says', () => {
    expect(anchoringFor(fireball, {})).toBe('space');
  });

  it('takes the definition’s when the caster says nothing', () => {
    expect(anchoringFor(declaring('intersection'), {})).toBe('intersection');
    expect(anchoringFor(declaring('space'), {})).toBe('space');
  });

  /**
   * The caster keeps the last word, because `CastSpellRequest.anchoring`
   * exists precisely so a caster who wants the other convention can ask for
   * it. The definition replaces the hard-coded default underneath, not the
   * caster’s choice on top.
   */
  it('lets the caster override it either way', () => {
    expect(anchoringFor(declaring('space'), { anchoring: 'intersection' })).toBe('intersection');
    expect(anchoringFor(declaring('intersection'), { anchoring: 'space' })).toBe('space');
  });

  /**
   * One resolver, both readers. The geometry builds the template with it and
   * the ongoing record stores it for every later trigger; if either re-derived
   * it, a footprint a spell declared would survive to one and not the other.
   */
  it('is the only place the runtime decides', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./commands.ts', import.meta.url)),
      'utf8',
    );
    // Two call sites and the declaration itself.
    expect(source.split('anchoringFor(').length - 1).toBe(3);
    expect(source).not.toContain("request.anchoring ?? 'space'");
  });

  /**
   * **No SRD spell declares one**, and that is a decision rather than a gap.
   *
   * SRD 5.2.1 mandates no convention — its "Playing on a Grid" sidebar covers
   * squares, Speed, entering a square, corners and ranges and says nothing
   * whatever about areas of effect, and the intersection convention comes from
   * a 2014 optional rule. Declaring one per spell would be the engine choosing
   * a rule the book declined to give, and doing it inside a definitions pass
   * would change thirteen spells’ footprints behind a migration.
   *
   * The field exists so a deliberate geometry pass, or an author of content
   * the SRD never printed, says it in data instead of in runtime logic. This
   * test is what makes that claim fail the day somebody changes it silently.
   */
  it('is declared by no spell in the catalogue', () => {
    expect(SPELL_DEFINITIONS.filter((d) => d.anchoring !== undefined).map((d) => d.id)).toEqual(
      [],
    );
  });
});
