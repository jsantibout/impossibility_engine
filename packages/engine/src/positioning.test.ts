import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import {
  addLandmark,
  canPassThrough,
  dismount,
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
    expect(positionOf(state, id('rider'))).toEqual({ ...horse, z: horse.z + 1 });
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
    expect(positionOf(state, id('rider'))).toEqual({ ...horse, z: horse.z + 1 });
  });

  it('carries the rider into the air', () => {
    let state = unwrap(mount(dragonfight(), id('rogue'), id('dragon'), { willing: false }), 'clung');
    state = unwrap(
      moveCreature(state, id('dragon'), { from: { landmark: 'the bar' }, feet: 10, bearing: 90, elevation: 12 }),
      'flew',
    ).state;
    expect(positionOf(state, id('rogue'))?.z).toBe(13);
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
