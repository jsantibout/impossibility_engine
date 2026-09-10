import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import {
  addLandmark,
  coverAcBonus,
  coverBetween,
  canBeTargeted,
  creaturesInArea,
  declareCover,
  distanceBetween,
  moveCreature,
  mostProtectiveCover,
  placeCreature,
  positionOf,
  removeCreature,
  scene,
  withinReach,
} from './positioning.js';

const id = (s: string) => asCharacterId(s);

/** A 60 x 40 foot tavern, 15 feet to the rafters. */
const tavern = () => scene({ width: 60, depth: 40, height: 15 });

const withBar = () => unwrap(addLandmark(tavern(), 'the bar', { x: 10, y: 20, z: 0 }), 'bar');

/** Fighter at the bar, ogre 15 feet away on a known bearing. */
const standoff = () => {
  let state = withBar();
  state = unwrap(placeCreature(state, id('fighter'), { from: { landmark: 'the bar' }, feet: 5, bearing: 90 }), 'fighter');
  state = unwrap(placeCreature(state, id('ogre'), { from: { creature: id('fighter') }, feet: 15, bearing: 90 }), 'ogre');
  return state;
};

describe('placement', () => {
  it('starts with nothing placed', () => {
    expect(positionOf(tavern(), id('ogre'))).toBeNull();
  });

  it('places a creature relative to a landmark', () => {
    const state = unwrap(
      placeCreature(withBar(), id('ogre'), { from: { landmark: 'the bar' }, feet: 10, bearing: 90 }),
      'placed',
    );
    expect(positionOf(state, id('ogre'))).toEqual({ x: 20, y: 20, z: 0 });
  });

  it('places a creature relative to another creature', () => {
    expect(positionOf(standoff(), id('ogre'))).toEqual({ x: 30, y: 20, z: 0 });
  });

  it('places at the scene centre when nothing is established yet', () => {
    const state = unwrap(placeCreature(tavern(), id('ogre'), { from: { sceneCenter: true }, feet: 0 }), 'centre');
    expect(positionOf(state, id('ogre'))).toEqual({ x: 30, y: 20, z: 0 });
  });

  // The model never types raw coordinates, so a placement cannot drift away
  // from what was just narrated.
  it('refuses an anchor that does not exist', () => {
    expect(isErr(placeCreature(tavern(), id('ogre'), { from: { landmark: 'the hearth' }, feet: 5 }))).toBe(true);
    expect(isErr(placeCreature(tavern(), id('ogre'), { from: { creature: id('nobody') }, feet: 5 }))).toBe(true);
  });

  /**
   * The bug this design exists to prevent: a monster narrated as appearing in
   * the tavern cannot end up 1000 feet away, because the tavern is not that
   * big. Inventing a position is fine; inventing one outside the fiction is not.
   */
  it('refuses a placement outside the scene', () => {
    expect(
      isErr(placeCreature(withBar(), id('ogre'), { from: { landmark: 'the bar' }, feet: 1000 })),
    ).toBe(true);
  });

  it('finds a bearing that fits when none is given', () => {
    // 1000 feet has nowhere to go, but 15 feet from a corner does — the engine
    // sweeps for a bearing that lands inside the room.
    let state = unwrap(addLandmark(tavern(), 'the corner', { x: 2, y: 2, z: 0 }), 'corner');
    state = unwrap(placeCreature(state, id('ogre'), { from: { landmark: 'the corner' }, feet: 15 }), 'swept');
    const at = positionOf(state, id('ogre'))!;
    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.y).toBeGreaterThanOrEqual(0);
    expect(at.x).toBeLessThanOrEqual(60);
    expect(at.y).toBeLessThanOrEqual(40);
  });

  it('picks the same bearing every time, so a scene replays identically', () => {
    const once = unwrap(placeCreature(withBar(), id('ogre'), { from: { landmark: 'the bar' }, feet: 12 }), 'a');
    const twice = unwrap(placeCreature(withBar(), id('ogre'), { from: { landmark: 'the bar' }, feet: 12 }), 'b');
    expect(positionOf(once, id('ogre'))).toEqual(positionOf(twice, id('ogre')));
  });

  it('does not stack two creatures in the same spot', () => {
    let state = standoff();
    state = unwrap(placeCreature(state, id('goblin'), { from: { creature: id('ogre') }, feet: 0 }), 'goblin');
    expect(positionOf(state, id('goblin'))).not.toEqual(positionOf(state, id('ogre')));
  });

  it('places a creature in the air', () => {
    const state = unwrap(
      placeCreature(withBar(), id('wyvern'), { from: { landmark: 'the bar' }, feet: 10, bearing: 90, elevation: 12 }),
      'flying',
    );
    expect(positionOf(state, id('wyvern'))?.z).toBe(12);
  });

  it('refuses to fly through the ceiling', () => {
    expect(
      isErr(
        placeCreature(withBar(), id('wyvern'), { from: { landmark: 'the bar' }, feet: 5, elevation: 40 }),
      ),
    ).toBe(true);
  });

  it('refuses a negative distance', () => {
    expect(isErr(placeCreature(withBar(), id('ogre'), { from: { landmark: 'the bar' }, feet: -5 }))).toBe(true);
  });
});

describe('distanceBetween', () => {
  it('measures between two placed creatures', () => {
    expect(unwrap(distanceBetween(standoff(), id('fighter'), id('ogre')), 'd')).toBe(15);
  });

  it('measures through the air, so a flyer overhead is genuinely distant', () => {
    let state = standoff();
    state = unwrap(
      placeCreature(state, id('wyvern'), { from: { creature: id('fighter') }, feet: 0, elevation: 15 }),
      'wyvern',
    );
    // Directly overhead at 15 feet up.
    expect(unwrap(distanceBetween(state, id('fighter'), id('wyvern')), 'd')).toBe(15);
  });

  it('is zero to itself', () => {
    expect(unwrap(distanceBetween(standoff(), id('ogre'), id('ogre')), 'd')).toBe(0);
  });

  /**
   * An unplaced creature is an engine-to-model signal, never player-facing:
   * Maestro places the ogre and carries on. Nothing here should ever reach a
   * player as "that creature has no position".
   */
  it('reports that a creature still needs placing', () => {
    const result = distanceBetween(standoff(), id('fighter'), id('ghost'));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('unplaced');
  });
});

describe('withinReach', () => {
  it('is true for a creature in melee', () => {
    let state = standoff();
    state = unwrap(placeCreature(state, id('thug'), { from: { creature: id('fighter') }, feet: 5, bearing: 270 }), 'thug');
    expect(unwrap(withinReach(state, id('fighter'), id('thug'), 5), 'reach')).toBe(true);
  });

  it('is false at 15 feet with a 5-foot reach', () => {
    expect(unwrap(withinReach(standoff(), id('fighter'), id('ogre'), 5), 'reach')).toBe(false);
  });

  it('is true at 15 feet with a 15-foot reach', () => {
    expect(unwrap(withinReach(standoff(), id('fighter'), id('ogre'), 15), 'reach')).toBe(true);
  });

  it('accounts for height, so a flyer can be out of reach directly overhead', () => {
    let state = standoff();
    state = unwrap(
      placeCreature(state, id('wyvern'), { from: { creature: id('fighter') }, feet: 0, elevation: 12 }),
      'wyvern',
    );
    expect(unwrap(withinReach(state, id('fighter'), id('wyvern'), 5), 'reach')).toBe(false);
  });
});

describe('movement', () => {
  it('reports the distance travelled', () => {
    const moved = unwrap(
      moveCreature(standoff(), id('fighter'), { from: { creature: id('ogre') }, feet: 5, bearing: 270 }),
      'moved',
    );
    expect(moved.distance).toBe(10);
  });

  it('updates the position', () => {
    const moved = unwrap(
      moveCreature(standoff(), id('fighter'), { from: { creature: id('ogre') }, feet: 5, bearing: 270 }),
      'moved',
    );
    expect(positionOf(moved.state, id('fighter'))).toEqual({ x: 25, y: 20, z: 0 });
  });

  // Once placed, binding: a creature does not relocate without moving.
  it('refuses to move a creature that was never placed', () => {
    expect(isErr(moveCreature(standoff(), id('ghost'), { from: { creature: id('ogre') }, feet: 5 }))).toBe(true);
  });

  it('refuses to move onto a spot another creature already holds', () => {
    const blocked = moveCreature(standoff(), id('fighter'), {
      from: { creature: id('ogre') },
      feet: 0,
      bearing: 90,
    });
    expect(isErr(blocked)).toBe(true);
    if (isErr(blocked)) expect(blocked.code).toBe('occupied');
  });

  it('refuses to move outside the scene', () => {
    expect(
      isErr(moveCreature(standoff(), id('fighter'), { from: { creature: id('ogre') }, feet: 500 })),
    ).toBe(true);
  });
});

describe('removeCreature', () => {
  it('takes a creature off the map', () => {
    const state = unwrap(removeCreature(standoff(), id('ogre')), 'removed');
    expect(positionOf(state, id('ogre'))).toBeNull();
  });

  it('refuses to remove one that was never there', () => {
    expect(isErr(removeCreature(standoff(), id('ghost')))).toBe(true);
  });
});

describe('cover', () => {
  // SRD: Half Cover (+2 AC and Dexterity saves), Three-Quarters Cover (+5),
  // Total Cover (can't be targeted directly).
  it.each([
    ['none', 0],
    ['half', 2],
    ['three-quarters', 5],
  ] as const)('gives %s cover a bonus of +%i', (degree, bonus) => {
    expect(coverAcBonus(degree)).toBe(bonus);
  });

  it('cannot be targeted through total cover', () => {
    expect(canBeTargeted('total')).toBe(false);
    expect(canBeTargeted('three-quarters')).toBe(true);
  });

  it('is none by default', () => {
    expect(coverBetween(standoff(), id('fighter'), id('ogre'))).toBe('none');
  });

  it('records a declared degree between two creatures', () => {
    const state = unwrap(declareCover(standoff(), id('fighter'), id('ogre'), 'three-quarters'), 'cover');
    expect(coverBetween(state, id('fighter'), id('ogre'))).toBe('three-quarters');
  });

  // Cover is directional: the bar shields the ogre from the fighter without
  // shielding the fighter from the ogre.
  it('applies in one direction only', () => {
    const state = unwrap(declareCover(standoff(), id('fighter'), id('ogre'), 'half'), 'cover');
    expect(coverBetween(state, id('ogre'), id('fighter'))).toBe('none');
  });

  // SRD: "If behind more than one degree of cover, a target benefits only from
  // the most protective degree."
  it('takes the most protective of several degrees', () => {
    expect(mostProtectiveCover(['half', 'three-quarters', 'none'])).toBe('three-quarters');
    expect(mostProtectiveCover(['half', 'total'])).toBe('total');
    expect(mostProtectiveCover([])).toBe('none');
  });
});

describe('areas of effect', () => {
  /** Three goblins in a line at 0, 15 and 40 feet east of the bar. */
  const goblins = () => {
    let state = withBar();
    for (const [name, feet] of [
      ['goblin-a', 5],
      ['goblin-b', 20],
      ['goblin-c', 45],
    ] as const) {
      state = unwrap(
        placeCreature(state, id(name), { from: { landmark: 'the bar' }, feet, bearing: 90 }),
        name,
      );
    }
    return state;
  };

  const at = (x: number, y = 20, z = 0) => ({ x, y, z });

  // SRD Sphere: "A Sphere's point of origin is included in the Sphere's area."
  it('catches everything inside a sphere', () => {
    const caught = unwrap(
      creaturesInArea(goblins(), { point: at(20) }, { kind: 'sphere', radius: 20 }),
      'fireball',
    );
    expect(caught.sort()).toEqual([id('goblin-a'), id('goblin-b')].sort());
  });

  it('is exact at the radius boundary', () => {
    // goblin-a stands exactly 5 feet from the bar.
    const onTheLine = unwrap(
      creaturesInArea(goblins(), { point: at(10) }, { kind: 'sphere', radius: 5 }),
      'on',
    );
    const justInside = unwrap(
      creaturesInArea(goblins(), { point: at(10) }, { kind: 'sphere', radius: 4 }),
      'off',
    );
    expect(onTheLine).toEqual([id('goblin-a')]);
    expect(justInside).toEqual([]);
  });

  // This is the whole reason positions are coordinates: whether Fireball
  // catches two goblins or three is the most consequential call in the game,
  // and it should not be a judgement.
  it('catches all three from a point that reaches them', () => {
    const caught = unwrap(
      creaturesInArea(goblins(), { point: at(25) }, { kind: 'sphere', radius: 30 }),
      'wide',
    );
    expect(caught).toHaveLength(3);
  });

  it('returns the same set when nothing has moved', () => {
    const state = goblins();
    const origin = { point: at(20) };
    const shape = { kind: 'sphere', radius: 20 } as const;
    expect(unwrap(creaturesInArea(state, origin, shape), 'a')).toEqual(
      unwrap(creaturesInArea(state, origin, shape), 'b'),
    );
  });

  it('changes only when something actually moves', () => {
    let state = goblins();
    const origin = { point: at(20) };
    const shape = { kind: 'sphere', radius: 20 } as const;
    const before = unwrap(creaturesInArea(state, origin, shape), 'before');

    state = unwrap(
      moveCreature(state, id('goblin-c'), { from: { landmark: 'the bar' }, feet: 25, bearing: 90 }),
      'closed',
    ).state;

    const after = unwrap(creaturesInArea(state, origin, shape), 'after');
    expect(before).toHaveLength(2);
    expect(after).toHaveLength(3);
  });

  // SRD Cylinder: radius plus height, origin included.
  it('respects a cylinder’s height', () => {
    let state = goblins();
    state = unwrap(
      placeCreature(state, id('bat'), { from: { landmark: 'the bar' }, feet: 5, bearing: 90, elevation: 12 }),
      'bat',
    );
    const low = unwrap(
      creaturesInArea(state, { point: at(15) }, { kind: 'cylinder', radius: 20, height: 10 }),
      'low',
    );
    const high = unwrap(
      creaturesInArea(state, { point: at(15) }, { kind: 'cylinder', radius: 20, height: 20 }),
      'high',
    );
    expect(low).not.toContain(id('bat'));
    expect(high).toContain(id('bat'));
  });

  // SRD Cone: "A Cone's width at any point along its length is equal to that
  // point's distance from the point of origin."
  it('narrows a cone toward its origin', () => {
    let state = withBar();
    // Directly ahead at 30 feet, and off to the side at the same distance.
    state = unwrap(placeCreature(state, id('ahead'), { from: { landmark: 'the bar' }, feet: 30, bearing: 90 }), 'ahead');
    state = unwrap(placeCreature(state, id('aside'), { from: { landmark: 'the bar' }, feet: 18, bearing: 0 }), 'aside');

    const caught = unwrap(
      creaturesInArea(state, { point: at(10) }, { kind: 'cone', length: 40, towards: at(60) }),
      'breath',
    );
    expect(caught).toContain(id('ahead'));
    expect(caught).not.toContain(id('aside'));
  });

  it('stops a cone at its length', () => {
    const caught = unwrap(
      creaturesInArea(goblins(), { point: at(10) }, { kind: 'cone', length: 20, towards: at(60) }),
      'short',
    );
    expect(caught).not.toContain(id('goblin-c'));
  });

  // SRD Line: length and width from the origin.
  it('catches only what is inside a line’s width', () => {
    let state = goblins();
    state = unwrap(placeCreature(state, id('offset'), { from: { landmark: 'the bar' }, feet: 20, bearing: 0 }), 'offset');
    const caught = unwrap(
      creaturesInArea(state, { point: at(0) }, { kind: 'line', length: 60, width: 5, towards: at(60) }),
      'lightning',
    );
    expect(caught).toContain(id('goblin-b'));
    expect(caught).not.toContain(id('offset'));
  });

  // SRD Emanation: extends from a creature, and that creature is not included.
  it('excludes the creature an emanation radiates from', () => {
    const caught = unwrap(
      creaturesInArea(goblins(), { creature: id('goblin-a') }, { kind: 'emanation', distance: 20 }),
      'aura',
    );
    expect(caught).not.toContain(id('goblin-a'));
    expect(caught).toContain(id('goblin-b'));
  });

  it('includes the origin creature when the caster says so', () => {
    const caught = unwrap(
      creaturesInArea(
        goblins(),
        { creature: id('goblin-a') },
        { kind: 'emanation', distance: 20 },
        { includeOrigin: true },
      ),
      'aura',
    );
    expect(caught).toContain(id('goblin-a'));
  });

  // SRD: a Sphere includes its origin point, a Cone does not.
  it('includes a creature standing on a sphere’s origin but not a cone’s', () => {
    const state = goblins();
    const onTheSpot = positionOf(state, id('goblin-a'))!;

    expect(
      unwrap(creaturesInArea(state, { point: onTheSpot }, { kind: 'sphere', radius: 10 }), 'sphere'),
    ).toContain(id('goblin-a'));

    expect(
      unwrap(
        creaturesInArea(state, { point: onTheSpot }, { kind: 'cone', length: 30, towards: at(60) }),
        'cone',
      ),
    ).not.toContain(id('goblin-a'));
  });

  it('reports that the emanation’s origin still needs placing', () => {
    const result = creaturesInArea(goblins(), { creature: id('ghost') }, { kind: 'emanation', distance: 10 });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('unplaced');
  });

  it('ignores unplaced creatures rather than guessing where they are', () => {
    const caught = unwrap(
      creaturesInArea(goblins(), { point: at(20) }, { kind: 'sphere', radius: 500 }),
      'huge',
    );
    expect(caught).toHaveLength(3);
  });
});
