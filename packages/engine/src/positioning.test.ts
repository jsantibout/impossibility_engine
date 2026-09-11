import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import {
  addLandmark,
  canPassThrough,
  dismount,
  footprintOf,
  heightOf,
  isHeightDeclared,
  endsProne,
  isRidingUnwilling,
  mount,
  mountOf,
  mountingCost,
  ridersOf,
  isDifficultTerrain,
  sizeOf,
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
    // Twelve feet is not a cube boundary, so it snaps to ten.
    expect(positionOf(state, id('wyvern'))?.z).toBe(10);
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
  // SRD: range is counted "from a square adjacent to one of them" and stops
  // "in the space of the other one" — so the two creatures' own spaces are not
  // part of the distance. Two Medium creatures whose centres are 15 feet apart
  // have 10 feet between their spaces.
  it('counts squares between two creatures, never centres', () => {
    // Cubes three apart. SRD counts "from a square adjacent to one of them"
    // and stops "in the space of the other one": three squares, 15 feet.
    expect(unwrap(distanceBetween(standoff(), id('fighter'), id('ogre')), 'd')).toBe(15);
  });

  it('measures through the air, so a flyer overhead is genuinely distant', () => {
    let state = standoff();
    state = unwrap(
      placeCreature(state, id('wyvern'), { from: { creature: id('fighter') }, feet: 0, elevation: 15 }),
      'wyvern',
    );
    // Three cubes up, counted the same way as any other direction.
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

  it('is exact at the radius boundary, counted in cubes', () => {
    // From the bar's cube: goblin-a is the adjacent cube (5 feet) and goblin-b
    // is four squares on (20 feet). Every boundary lands on a multiple of 5,
    // and a radius is a square under the same metric distance uses.
    const shortOfB = unwrap(
      creaturesInArea(goblins(), { point: at(10) }, { kind: 'sphere', radius: 15 }),
      'short',
    );
    const reachesB = unwrap(
      creaturesInArea(goblins(), { point: at(10) }, { kind: 'sphere', radius: 20 }),
      'reaches',
    );
    expect(shortOfB).toEqual([id('goblin-a')]);
    expect(reachesB.sort()).toEqual([id('goblin-a'), id('goblin-b')].sort());
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

describe('moving around other creatures', () => {
  /**
   * SRD: "During your move, you can pass through the space of an ally, a
   * creature that has the Incapacitated condition, a Tiny creature, or a
   * creature that is two sizes larger or smaller than you."
   */
  describe('canPassThrough', () => {
    it('lets you through an ally', () => {
      expect(canPassThrough('medium', 'medium', { allied: true })).toBe(true);
    });

    it('stops you at a hostile creature of similar size', () => {
      expect(canPassThrough('medium', 'medium', {})).toBe(false);
      expect(canPassThrough('medium', 'large', {})).toBe(false);
    });

    it('lets you through anything two sizes larger or smaller', () => {
      expect(canPassThrough('medium', 'huge', {})).toBe(true);
      expect(canPassThrough('huge', 'medium', {})).toBe(true);
      expect(canPassThrough('small', 'large', {})).toBe(true);
    });

    it('lets anything through a Tiny creature', () => {
      // Tiny is a blanket exception, not just a size-difference case: a Small
      // creature is only one step larger, but still gets through.
      expect(canPassThrough('small', 'tiny', {})).toBe(true);
      expect(canPassThrough('gargantuan', 'tiny', {})).toBe(true);
    });

    it('lets a Tiny creature through anything', () => {
      expect(canPassThrough('tiny', 'small', {})).toBe(true);
      expect(canPassThrough('tiny', 'medium', {})).toBe(true);
    });

    it('lets you through an Incapacitated creature whatever its size', () => {
      expect(canPassThrough('medium', 'medium', { occupantIncapacitated: true })).toBe(true);
    });
  });

  /**
   * SRD: "Another creature's space is Difficult Terrain for you unless that
   * creature is Tiny or your ally." Note this is a different list from the
   * pass-through one — squeezing past a helpless ogre is allowed but costly.
   */
  describe('isDifficultTerrain', () => {
    it('costs extra through a hostile creature', () => {
      expect(isDifficultTerrain('medium', {})).toBe(true);
    });

    it('is free through an ally or a Tiny creature', () => {
      expect(isDifficultTerrain('medium', { allied: true })).toBe(false);
      expect(isDifficultTerrain('tiny', {})).toBe(false);
    });

    it('still costs extra through an Incapacitated creature', () => {
      // Passable, but not free — the two rules have different exception lists.
      expect(canPassThrough('medium', 'medium', { occupantIncapacitated: true })).toBe(true);
      expect(isDifficultTerrain('medium', { occupantIncapacitated: true })).toBe(true);
    });
  });

  /**
   * SRD: "If you somehow end a turn in a space with another creature, you have
   * the Prone condition unless you are Tiny or are of a larger size than the
   * other creature."
   */
  describe('endsProne', () => {
    it('knocks over a creature sharing a space with an equal', () => {
      expect(endsProne('medium', 'medium')).toBe(true);
    });

    it('spares a larger creature', () => {
      expect(endsProne('large', 'medium')).toBe(false);
    });

    it('does not spare a smaller one', () => {
      expect(endsProne('small', 'medium')).toBe(true);
    });

    it('always spares a Tiny creature', () => {
      expect(endsProne('tiny', 'gargantuan')).toBe(false);
    });
  });

  describe('ending a move in an occupied space', () => {
    const shoulderToShoulder = () => {
      let state = withBar();
      state = unwrap(
        placeCreature(state, id('fighter'), { from: { landmark: 'the bar' }, feet: 10, bearing: 90 }),
        'fighter',
      );
      return state;
    };

    // SRD: "You can't willingly end a move in a space occupied by another
    // creature."
    it('refuses a willing move onto another creature', () => {
      let state = shoulderToShoulder();
      state = unwrap(
        placeCreature(state, id('ogre'), { from: { landmark: 'the bar' }, feet: 20, bearing: 90 }),
        'ogre',
      );
      const blocked = moveCreature(state, id('ogre'), {
        from: { creature: id('fighter') },
        feet: 0,
        bearing: 90,
      });
      expect(isErr(blocked)).toBe(true);
      if (isErr(blocked)) expect(blocked.code).toBe('occupied');
    });

    // Forced movement is exactly the "somehow" the rule allows for.
    it('allows forced movement into an occupied space', () => {
      let state = shoulderToShoulder();
      state = unwrap(
        placeCreature(state, id('ogre'), { from: { landmark: 'the bar' }, feet: 20, bearing: 90 }),
        'ogre',
      );
      const shoved = unwrap(
        moveCreature(
          state,
          id('ogre'),
          { from: { creature: id('fighter') }, feet: 0, bearing: 90 },
          { forced: true },
        ),
        'shoved',
      );
      expect(positionOf(shoved.state, id('ogre'))).toEqual(positionOf(shoved.state, id('fighter')));
    });

    it('reports who ends up Prone from sharing a space', () => {
      let state = shoulderToShoulder();
      state = unwrap(
        placeCreature(state, id('goblin'), { from: { landmark: 'the bar' }, feet: 20, bearing: 90, size: 'small' }),
        'goblin',
      );
      const shoved = unwrap(
        moveCreature(
          state,
          id('goblin'),
          { from: { creature: id('fighter') }, feet: 0, bearing: 90 },
          { forced: true },
        ),
        'shoved',
      );
      // Small shoved into a Medium's space: not Tiny, not larger, so Prone.
      expect(shoved.prone).toBe(true);
      expect(shoved.sharingWith).toEqual([id('fighter')]);
    });

    it('leaves a larger creature standing', () => {
      let state = shoulderToShoulder();
      state = unwrap(
        placeCreature(state, id('ogre'), { from: { landmark: 'the bar' }, feet: 20, bearing: 90, size: 'large' }),
        'ogre',
      );
      const shoved = unwrap(
        moveCreature(
          state,
          id('ogre'),
          { from: { creature: id('fighter') }, feet: 0, bearing: 90 },
          { forced: true },
        ),
        'shoved',
      );
      expect(shoved.prone).toBe(false);
    });

    it('reports no sharing for an ordinary move', () => {
      const moved = unwrap(
        moveCreature(standoff(), id('fighter'), { from: { creature: id('ogre') }, feet: 5, bearing: 270 }),
        'moved',
      );
      expect(moved.prone).toBe(false);
      expect(moved.sharingWith).toEqual([]);
    });
  });

  describe('sizes', () => {
    it('defaults a creature to Medium', () => {
      expect(sizeOf(standoff(), id('fighter'))).toBe('medium');
    });

    it('remembers a declared size', () => {
      const state = unwrap(
        placeCreature(withBar(), id('wyrm'), { from: { landmark: 'the bar' }, feet: 20, bearing: 90, size: 'huge' }),
        'wyrm',
      );
      expect(sizeOf(state, id('wyrm'))).toBe('huge');
    });

    it('forgets it when the creature leaves', () => {
      const state = unwrap(removeCreature(standoff(), id('ogre')), 'gone');
      expect(sizeOf(state, id('ogre'))).toBeNull();
    });
  });
});

describe('riding a creature', () => {
  const stable = () => {
    let state = withBar();
    state = unwrap(
      placeCreature(state, id('rider'), { from: { landmark: 'the bar' }, feet: 5, bearing: 90 }),
      'rider',
    );
    state = unwrap(
      placeCreature(state, id('horse'), { from: { creature: id('rider') }, feet: 5, bearing: 90, size: 'large' }),
      'horse',
    );
    return state;
  };

  const dragonfight = () => {
    let state = withBar();
    state = unwrap(
      placeCreature(state, id('rogue'), { from: { landmark: 'the bar' }, feet: 5, bearing: 90 }),
      'rogue',
    );
    state = unwrap(
      placeCreature(state, id('dragon'), { from: { creature: id('rogue') }, feet: 5, bearing: 90, size: 'huge' }),
      'dragon',
    );
    return state;
  };

  // SRD: "During your move, you can mount a creature that is within 5 feet of
  // you... Doing so costs an amount of movement equal to half your Speed."
  it('costs half the rider’s speed, rounded down', () => {
    expect(mountingCost(30)).toBe(15);
    expect(mountingCost(25)).toBe(12);
  });

  it('puts the rider just above the mount', () => {
    const state = unwrap(mount(stable(), id('rider'), id('horse'), { willing: true }), 'mounted');
    const horse = positionOf(state, id('horse'))!;
    expect(positionOf(state, id('rider'))).toEqual({ ...horse, z: horse.z + 5 });
  });

  /**
   * The offset is deliberately small. Deriving it from the mount's size would
   * be more realistic and would break the thing that makes this fun: at 15 feet
   * above a dragon's point you could not melee the dragon you are clinging to.
   */
  it('leaves the rider in reach of the mount', () => {
    const state = unwrap(mount(dragonfight(), id('rogue'), id('dragon'), { willing: false }), 'clung');
    expect(unwrap(withinReach(state, id('rogue'), id('dragon'), 5), 'reach')).toBe(true);
  });

  it('does not count as sharing a space', () => {
    const state = unwrap(mount(stable(), id('rider'), id('horse'), { willing: true }), 'mounted');
    // A separate point, so nothing treats the rider as standing on the horse.
    expect(positionOf(state, id('rider'))).not.toEqual(positionOf(state, id('horse')));
  });

  it('reports the relationship in both directions', () => {
    const state = unwrap(mount(stable(), id('rider'), id('horse'), { willing: true }), 'mounted');
    expect(mountOf(state, id('rider'))).toBe(id('horse'));
    expect(ridersOf(state, id('horse'))).toEqual([id('rider')]);
  });

  // The whole reason this is a relationship and not just a z-offset.
  it('carries the rider along when the mount moves', () => {
    let state = unwrap(mount(stable(), id('rider'), id('horse'), { willing: true }), 'mounted');
    state = unwrap(
      moveCreature(state, id('horse'), { from: { landmark: 'the bar' }, feet: 30, bearing: 90 }),
      'galloped',
    ).state;

    const horse = positionOf(state, id('horse'))!;
    expect(horse.x).toBe(40);
    expect(positionOf(state, id('rider'))).toEqual({ ...horse, z: horse.z + 5 });
  });

  it('carries the rider into the air', () => {
    let state = unwrap(mount(dragonfight(), id('rogue'), id('dragon'), { willing: false }), 'clung');
    state = unwrap(
      moveCreature(state, id('dragon'), { from: { landmark: 'the bar' }, feet: 10, bearing: 90, elevation: 12 }),
      'flew',
    ).state;
    // Twelve feet of climb snaps to ten; the rider rides one cube above that.
    expect(positionOf(state, id('rogue'))?.z).toBe(15);
  });

  // SRD: a mount must be "at least one size larger than a rider".
  it('refuses a mount that is not larger', () => {
    let state = withBar();
    state = unwrap(placeCreature(state, id('a'), { from: { landmark: 'the bar' }, feet: 5, bearing: 90 }), 'a');
    state = unwrap(placeCreature(state, id('b'), { from: { creature: id('a') }, feet: 5, bearing: 90 }), 'b');
    expect(isErr(mount(state, id('a'), id('b'), { willing: true }))).toBe(true);
  });

  // SRD: "you can mount a creature that is within 5 feet of you".
  it('refuses a mount out of reach', () => {
    let state = withBar();
    state = unwrap(placeCreature(state, id('rider'), { from: { landmark: 'the bar' }, feet: 5, bearing: 90 }), 'r');
    state = unwrap(
      placeCreature(state, id('horse'), { from: { creature: id('rider') }, feet: 20, bearing: 90, size: 'large' }),
      'h',
    );
    expect(isErr(mount(state, id('rider'), id('horse'), { willing: true }))).toBe(true);
  });

  it('refuses to ride an unplaced creature', () => {
    expect(isErr(mount(stable(), id('rider'), id('ghost'), { willing: true }))).toBe(true);
  });

  it('refuses to ride two things at once', () => {
    const state = unwrap(mount(stable(), id('rider'), id('horse'), { willing: true }), 'mounted');
    expect(isErr(mount(state, id('rider'), id('horse'), { willing: true }))).toBe(true);
  });

  /**
   * The SRD only covers a *willing* mount. Clinging to a hostile dragon is not
   * in the rules, and it is one of the most-attempted moves at any table, so it
   * is allowed and recorded as unwilling rather than refused. Whether the rogue
   * got up there at all is a check the DM calls for — the engine only tracks
   * that they did.
   */
  it('allows clinging to an unwilling creature, and records that it was unwilling', () => {
    const state = unwrap(mount(dragonfight(), id('rogue'), id('dragon'), { willing: false }), 'clung');
    expect(mountOf(state, id('dragon'))).toBeNull();
    expect(isRidingUnwilling(state, id('rogue'))).toBe(true);
  });

  it('records a willing mount as willing', () => {
    const state = unwrap(mount(stable(), id('rider'), id('horse'), { willing: true }), 'mounted');
    expect(isRidingUnwilling(state, id('rider'))).toBe(false);
  });

  describe('dismount', () => {
    it('sets the rider down beside the mount', () => {
      let state = unwrap(mount(stable(), id('rider'), id('horse'), { willing: true }), 'mounted');
      state = unwrap(
        dismount(state, id('rider'), { from: { creature: id('horse') }, feet: 5, bearing: 270 }),
        'down',
      );
      expect(mountOf(state, id('rider'))).toBeNull();
      expect(ridersOf(state, id('horse'))).toEqual([]);
      expect(positionOf(state, id('rider'))?.z).toBe(0);
    });

    it('refuses to dismount someone who is not riding', () => {
      expect(
        isErr(dismount(stable(), id('rider'), { from: { creature: id('horse') }, feet: 5 })),
      ).toBe(true);
    });

    it('leaves the rider behind when the mount is removed', () => {
      let state = unwrap(mount(stable(), id('rider'), id('horse'), { willing: true }), 'mounted');
      state = unwrap(removeCreature(state, id('horse')), 'gone');
      expect(mountOf(state, id('rider'))).toBeNull();
      expect(positionOf(state, id('rider'))).not.toBeNull();
    });
  });
});

describe('creatures occupy volume', () => {
  const arena = () => scene({ width: 200, depth: 200, height: 200 });

  const withDragon = (over: { size?: 'huge' | 'gargantuan'; height?: number } = {}) => {
    let state = unwrap(addLandmark(arena(), 'centre', { x: 100, y: 100, z: 0 }), 'centre');
    state = unwrap(
      placeCreature(state, id('dragon'), {
        from: { landmark: 'centre' },
        feet: 0,
        size: over.size ?? 'huge',
        ...(over.height === undefined ? {} : { height: over.height }),
      }),
      'dragon',
    );
    return state;
  };

  describe('footprint and height', () => {
    // SRD Creature Size and Space.
    it.each([
      // SRD gives Tiny a 2.5-foot space, four to a square, but the lattice has
      // no half cubes. The rules that care about Tiny read the size category.
      ['tiny', 5],
      ['small', 5],
      ['medium', 5],
      ['large', 10],
      ['huge', 15],
      ['gargantuan', 20],
    ] as const)('gives %s a %i foot footprint', (size, width) => {
      expect(footprintOf(size)).toBe(width);
    });

    // The SRD defines no creature height anywhere, so a cube is the default.
    it('defaults height to the footprint', () => {
      expect(heightOf(withDragon(), id('dragon'))).toBe(15);
    });

    it('accepts a declared height', () => {
      expect(heightOf(withDragon({ height: 30 }), id('dragon'))).toBe(30);
    });
  });

  describe('areas of effect meet the whole creature', () => {
    /**
     * The case this exists for: a 30-foot dragon is not a flat token. A
     * Fireball centred well above the ground still catches its upper body.
     */
    it('catches a tall creature with a blast above the ground', () => {
      const state = withDragon({ height: 30 });
      // A 20-foot Sphere centred 40 feet up reaches down to 20 feet, which is
      // inside a 30-foot dragon standing on the floor.
      const caught = unwrap(
        creaturesInArea(state, { point: { x: 100, y: 100, z: 40 } }, { kind: 'sphere', radius: 20 }),
        'high',
      );
      expect(caught).toContain(id('dragon'));
    });

    it('misses when the blast is genuinely out of reach overhead', () => {
      const state = withDragon({ height: 30 });
      // Centred 60 feet up, a 20-foot Sphere reaches down to 40 — clear of a
      // 30-foot dragon.
      const caught = unwrap(
        creaturesInArea(state, { point: { x: 100, y: 100, z: 60 } }, { kind: 'sphere', radius: 20 }),
        'clear',
      );
      expect(caught).toEqual([]);
    });

    it('would have missed both if creatures were points', () => {
      // The same dragon modelled flat: its only point is on the floor, so a
      // blast 40 feet up misses it entirely.
      const flat = withDragon({ height: 0 });
      const caught = unwrap(
        creaturesInArea(flat, { point: { x: 100, y: 100, z: 40 } }, { kind: 'sphere', radius: 20 }),
        'flat',
      );
      expect(caught).toEqual([]);
    });

    // Volume cuts horizontally too: a Huge creature is 15 feet across, so a
    // blast beside it still clips its flank.
    it('catches the edge of a wide creature', () => {
      const state = withDragon();
      const caught = unwrap(
        creaturesInArea(state, { point: { x: 112, y: 100, z: 0 } }, { kind: 'sphere', radius: 5 }),
        'flank',
      );
      expect(caught).toContain(id('dragon'));
    });

    it('still misses when the blast clears the whole footprint', () => {
      const state = withDragon();
      const caught = unwrap(
        creaturesInArea(state, { point: { x: 130, y: 100, z: 0 } }, { kind: 'sphere', radius: 5 }),
        'wide',
      );
      expect(caught).toEqual([]);
    });

    it('respects a cylinder’s vertical span against a tall creature', () => {
      const state = withDragon({ height: 30 });
      const low = unwrap(
        creaturesInArea(
          state,
          { point: { x: 100, y: 100, z: 50 } },
          { kind: 'cylinder', radius: 20, height: 5 },
        ),
        'low',
      );
      const tall = unwrap(
        creaturesInArea(
          state,
          { point: { x: 100, y: 100, z: 20 } },
          { kind: 'cylinder', radius: 20, height: 40 },
        ),
        'tall',
      );
      expect(low).toEqual([]);
      expect(tall).toContain(id('dragon'));
    });

    it('leaves a Medium creature behaving as before', () => {
      let state = unwrap(addLandmark(arena(), 'centre', { x: 100, y: 100, z: 0 }), 'c');
      state = unwrap(placeCreature(state, id('fighter'), { from: { landmark: 'centre' }, feet: 0 }), 'f');
      // 5-foot footprint, so a blast 10 feet away still misses with radius 5.
      expect(
        unwrap(
          creaturesInArea(state, { point: { x: 110, y: 100, z: 0 } }, { kind: 'sphere', radius: 5 }),
          'near',
        ),
      ).toEqual([]);
    });
  });

  describe('reach measures to a creature’s space', () => {
    /**
     * Without this a fighter could not melee a Huge dragon at all: its centre
     * point is 7.5 feet inside its own body, beyond a 5-foot reach.
     */
    it('lets a fighter melee a Huge dragon from outside its space', () => {
      let state = withDragon();
      // The dragon fills three cubes, so 15 feet from its anchor is the first
      // spot outside it — and from there its flank is within reach.
      state = unwrap(
        placeCreature(state, id('fighter'), { from: { creature: id('dragon') }, feet: 15, bearing: 90 }),
        'fighter',
      );
      expect(unwrap(withinReach(state, id('fighter'), id('dragon'), 5), 'reach')).toBe(true);
    });

    it('still refuses a reach that genuinely falls short', () => {
      let state = withDragon();
      state = unwrap(
        placeCreature(state, id('fighter'), { from: { creature: id('dragon') }, feet: 30, bearing: 90 }),
        'fighter',
      );
      expect(unwrap(withinReach(state, id('fighter'), id('dragon'), 5), 'reach')).toBe(false);
    });

    // The whole point of measuring space to space: a Huge creature's centre is
    // seven and a half feet inside its own body, so a centre measurement would
    // report both melee reach and spell ranges as longer than they are.
    it('discounts the dragon’s own bulk from the distance', () => {
      let state = withDragon();
      state = unwrap(
        placeCreature(state, id('fighter'), { from: { creature: id('dragon') }, feet: 30, bearing: 90 }),
        'fighter',
      );
      // Centres 30 apart; the dragon's flank is 7.5 nearer and the fighter's
      // own space accounts for 2.5 more.
      expect(unwrap(distanceBetween(state, id('fighter'), id('dragon')), 'spaces')).toBe(20);
    });

    it('is zero when one creature is inside another’s space', () => {
      // Placement will not put one creature inside another, so the only way to
      // get there is the way the rules allow: being forced.
      let state = withDragon();
      state = unwrap(
        placeCreature(state, id('imp'), { from: { creature: id('dragon') }, feet: 20, bearing: 90, size: 'tiny' }),
        'imp',
      );
      state = unwrap(
        moveCreature(
          state,
          id('imp'),
          { from: { creature: id('dragon') }, feet: 0 },
          { forced: true },
        ),
        'shoved',
      ).state;
      expect(unwrap(distanceBetween(state, id('imp'), id('dragon')), 'inside')).toBe(0);
    });
  });
});

describe('height is declared, not inferred', () => {
  const plain = () => scene({ width: 200, depth: 200, height: 200 });

  const beast = (name: string, size: 'large' | 'huge', height?: number) => {
    const state = unwrap(addLandmark(plain(), 'field', { x: 100, y: 100, z: 0 }), 'field');
    return unwrap(
      placeCreature(state, id(name), {
        from: { landmark: 'field' },
        feet: 0,
        size,
        ...(height === undefined ? {} : { height }),
      }),
      name,
    );
  };

  /**
   * Size category is a poor proxy for height: a giraffe and a hippopotamus are
   * both Large and nothing about the category separates them. Height is part of
   * the fiction, so Maestro says.
   */
  it('lets two creatures of the same size have very different heights', () => {
    // Eighteen feet snaps to four cubes, like every other measurement.
    expect(heightOf(beast('giraffe', 'large', 18), id('giraffe'))).toBe(20);
    expect(heightOf(beast('hippo', 'large', 5), id('hippo'))).toBe(5);
  });

  it('catches the giraffe overhead but not the hippo', () => {
    const overhead = { point: { x: 100, y: 100, z: 15 } };
    const shape = { kind: 'sphere', radius: 3 } as const;

    expect(unwrap(creaturesInArea(beast('giraffe', 'large', 18), overhead, shape), 'g')).toEqual([
      id('giraffe'),
    ]);
    expect(unwrap(creaturesInArea(beast('hippo', 'large', 5), overhead, shape), 'h')).toEqual([]);
  });

  it('reports whether a height was actually declared', () => {
    expect(isHeightDeclared(beast('giraffe', 'large', 18), id('giraffe'))).toBe(true);
    expect(isHeightDeclared(beast('unknown', 'large'), id('unknown'))).toBe(false);
  });

  // The fallback exists so the geometry keeps working, not because the engine
  // knows how tall anything is.
  it('falls back to the footprint when nobody has said', () => {
    expect(heightOf(beast('unknown', 'large'), id('unknown'))).toBe(footprintOf('large'));
  });
});

describe('an emanation starts at the creature’s boundary', () => {
  /**
   * SRD: an Emanation "extends in straight lines from a creature or an object
   * in all directions" — from the creature itself, not from a point inside it.
   * So the same spell covers far more ground around something enormous.
   */
  const auraAround = (size: 'medium' | 'gargantuan') => {
    let state = scene({ width: 400, depth: 400, height: 100 });
    state = unwrap(addLandmark(state, 'field', { x: 100, y: 100, z: 0 }), 'field');
    state = unwrap(placeCreature(state, id('source'), { from: { landmark: 'field' }, feet: 0, size }), 'source');
    // A bystander 25 feet east of the source's anchor cube.
    state = unwrap(
      placeCreature(state, id('bystander'), { from: { landmark: 'field' }, feet: 25, bearing: 90 }),
      'bystander',
    );
    return state;
  };

  const caughtBy = (size: 'medium' | 'gargantuan', distance: number) =>
    unwrap(
      creaturesInArea(auraAround(size), { creature: id('source') }, { kind: 'emanation', distance }),
      'aura',
    );

  it('reaches further from a Gargantuan creature than a Medium one', () => {
    // The Gargantuan creature's own 20-foot body closes most of the gap, so
    // the bystander is within ten feet of its flank but nowhere near a
    // Medium creature's.
    expect(caughtBy('gargantuan', 10)).toContain(id('bystander'));
    expect(caughtBy('medium', 10)).not.toContain(id('bystander'));
  });

  it('still has a boundary of its own', () => {
    // Ten feet past the Gargantuan creature's edge is out.
    let state = scene({ width: 400, depth: 400, height: 100 });
    state = unwrap(addLandmark(state, 'field', { x: 100, y: 100, z: 0 }), 'field');
    state = unwrap(
      placeCreature(state, id('source'), { from: { landmark: 'field' }, feet: 0, size: 'gargantuan' }),
      'source',
    );
    state = unwrap(
      placeCreature(state, id('far'), { from: { landmark: 'field' }, feet: 40, bearing: 90 }),
      'far',
    );
    expect(
      unwrap(creaturesInArea(state, { creature: id('source') }, { kind: 'emanation', distance: 10 }), 'aura'),
    ).not.toContain(id('far'));
  });

  it('leaves a Sphere centred on a point unaffected by the caster’s bulk', () => {
    // A Sphere is centred on a point, so a Gargantuan creature standing at
    // that point does not widen it.
    const state = auraAround('gargantuan');
    const sphere = unwrap(
      creaturesInArea(state, { creature: id('source') }, { kind: 'sphere', radius: 10 }),
      'sphere',
    );
    expect(sphere).not.toContain(id('bystander'));
  });
});

describe('placement agrees with measurement', () => {
  const field = () => {
    let s = scene({ width: 400, depth: 400, height: 200 });
    s = unwrap(addLandmark(s, 'o', { x: 200, y: 200, z: 0 }), 'o');
    return unwrap(placeCreature(s, id('anchor'), { from: { landmark: 'o' }, feet: 0 }), 'anchor');
  };

  const placedAt = (feet: number, bearing: number, size?: 'medium' | 'large' | 'huge') => {
    const state = unwrap(
      placeCreature(field(), id('subject'), {
        from: { creature: id('anchor') },
        feet,
        bearing,
        ...(size === undefined ? {} : { size }),
      }),
      'subject',
    );
    return unwrap(distanceBetween(state, id('anchor'), id('subject')), 'measured');
  };

  /**
   * Distance is Chebyshev, so placement has to be too. Projecting
   * trigonometrically put a creature asked for at 30 feet on a diagonal only
   * 20 feet away by the engine's own measure — the placement and the ruler
   * disagreed.
   */
  it.each([0, 45, 90, 135, 180, 225, 270, 315])(
    'places a creature exactly as far away as asked, on bearing %i',
    (bearing) => {
      expect(placedAt(30, bearing)).toBe(30);
    },
  );

  it.each([5, 10, 15, 30, 60])('holds at %i feet on a diagonal', (feet) => {
    expect(placedAt(feet, 45)).toBe(feet);
  });

  it('holds for bearings that are not multiples of 45', () => {
    for (const bearing of [20, 30, 70, 110]) {
      expect(placedAt(30, bearing), `bearing ${bearing}`).toBe(30);
    }
  });

  // A larger creature's own bulk is not part of the distance, so asking for 30
  // feet still means 30 feet whatever is standing there.
  it.each(['medium', 'large', 'huge'] as const)('holds for a %s creature', (size) => {
    expect(placedAt(30, 45, size)).toBe(30);
  });

  it('holds when measuring from a landmark rather than a creature', () => {
    let state = field();
    state = unwrap(
      placeCreature(state, id('subject'), { from: { landmark: 'o' }, feet: 30, bearing: 45 }),
      'subject',
    );
    // The landmark sits in the anchor creature's own cube, so the measurement
    // between the two creatures is the one that matters.
    expect(unwrap(distanceBetween(state, id('anchor'), id('subject')), 'd')).toBe(30);
  });

  it('counts elevation in the same measure, never as extra distance', () => {
    let state = field();
    state = unwrap(
      placeCreature(state, id('subject'), {
        from: { creature: id('anchor') },
        feet: 30,
        bearing: 90,
        elevation: 15,
      }),
      'subject',
    );
    // Chebyshev takes the largest axis: 30 across beats 15 up.
    expect(unwrap(distanceBetween(state, id('anchor'), id('subject')), 'd')).toBe(30);
  });

  it('measures a purely vertical placement by its height', () => {
    let state = field();
    state = unwrap(
      placeCreature(state, id('subject'), { from: { creature: id('anchor') }, feet: 0, elevation: 20 }),
      'subject',
    );
    expect(unwrap(distanceBetween(state, id('anchor'), id('subject')), 'd')).toBe(20);
  });
});

describe('occupied volumes cannot overlap', () => {
  const withLarge = () => {
    let s = scene({ width: 400, depth: 400, height: 200 });
    s = unwrap(addLandmark(s, 'o', { x: 200, y: 200, z: 0 }), 'o');
    return unwrap(placeCreature(s, id('ogre'), { from: { landmark: 'o' }, feet: 0, size: 'large' }), 'ogre');
  };

  /**
   * Occupancy compared anchor coordinates while ranges used volumes, so a
   * Medium creature could be placed *inside* a Large creature's space simply
   * by having a different anchor cube.
   */
  it('will not place a creature inside a larger one', () => {
    // The ogre holds 200-210 on both axes; 5 feet east is still inside it.
    const inside = placeCreature(withLarge(), id('scout'), {
      from: { landmark: 'o' },
      feet: 5,
      bearing: 90,
    });
    expect(isErr(inside)).toBe(true);
    if (isErr(inside)) expect(inside.code).toBe('occupied');
  });

  it('places it clear of the volume when no bearing is named', () => {
    const state = unwrap(
      placeCreature(withLarge(), id('scout'), { from: { landmark: 'o' }, feet: 5 }),
      'swept',
    );
    expect(unwrap(distanceBetween(state, id('ogre'), id('scout')), 'd')).toBeGreaterThan(0);
  });

  it('will not move a creature into an occupied volume either', () => {
    let state = withLarge();
    state = unwrap(
      placeCreature(state, id('scout'), { from: { landmark: 'o' }, feet: 40, bearing: 90 }),
      'scout',
    );
    const blocked = moveCreature(state, id('scout'), {
      from: { creature: id('ogre') },
      feet: 5,
      bearing: 90,
    });
    expect(isErr(blocked)).toBe(true);
  });

  // Forced movement is the deliberate exception, and riding is its own path.
  it('still allows forced movement into an occupied volume', () => {
    let state = withLarge();
    state = unwrap(
      placeCreature(state, id('scout'), { from: { landmark: 'o' }, feet: 40, bearing: 90 }),
      'scout',
    );
    const shoved = moveCreature(
      state,
      id('scout'),
      { from: { creature: id('ogre') }, feet: 0 },
      { forced: true },
    );
    expect(isErr(shoved)).toBe(false);
  });
});

describe('placement is not relocation', () => {
  /**
   * placeCreature silently moved a creature that already had a position, which
   * meant a stray placement could teleport something mid-combat without any
   * movement being spent. Placing is for creatures entering a scene; moving is
   * its own, explicit operation.
   */
  it('refuses to place a creature that is already placed', () => {
    let state = scene({ width: 400, depth: 400, height: 200 });
    state = unwrap(addLandmark(state, 'o', { x: 200, y: 200, z: 0 }), 'o');
    state = unwrap(placeCreature(state, id('ogre'), { from: { landmark: 'o' }, feet: 0 }), 'first');

    const again = placeCreature(state, id('ogre'), { from: { landmark: 'o' }, feet: 50, bearing: 90 });
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.code).toBe('already_placed');
  });

  it('allows placing again once the creature has left the scene', () => {
    let state = scene({ width: 400, depth: 400, height: 200 });
    state = unwrap(addLandmark(state, 'o', { x: 200, y: 200, z: 0 }), 'o');
    state = unwrap(placeCreature(state, id('ogre'), { from: { landmark: 'o' }, feet: 0 }), 'first');
    state = unwrap(removeCreature(state, id('ogre')), 'gone');
    expect(isErr(placeCreature(state, id('ogre'), { from: { landmark: 'o' }, feet: 0 }))).toBe(false);
  });
});
