import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { areaPointAt, type Point, type TerrainRegion } from './positioning.js';
import { movementLeftFor } from './standing.js';
import { declareDifficultTerrain, resolveMove } from './commands.js';

/**
 * Ground that costs more to cross.
 *
 * SRD: "If a space is Difficult Terrain, every foot of movement in that space
 * costs 1 extra foot. For example, moving 5 feet through Difficult Terrain
 * costs 10 feet of movement. **Difficult Terrain isn't cumulative; either a
 * space is Difficult Terrain or it isn't.**"
 *
 * Before this the rule reached the ruler only as `MoveCommand.difficultFeet`,
 * a number the mover declared — so a Web was invisible to it, and so were the
 * rubble and the undergrowth the SRD's own examples are made of. What is
 * declared now is the **patch**: where the expensive ground is, what a foot of
 * it costs, and — optionally — the casting that made it so. The rate is a
 * number rather than a flag because two SRD spells print their own: Plant
 * Growth and Wall of Thorns both cost four feet per foot, which no boolean
 * can say.
 *
 * Where each half of the answer falls, since that is the whole of the design:
 *
 * | | Declared by the table | Computed by the engine |
 * |---|---|---|
 * | which ground is expensive, and how expensive | ✓ | |
 * | which spaces a patch covers | | ✓ |
 * | which spaces a move crossed | ✓ (`MoveCommand.route`) | |
 * | what the crossing cost | | ✓ |
 * | whether a patch is still there | | ✓ (its casting is, or it never had one) |
 */

const id = (s: string) => asCharacterId(s);
const WALKER = id('walker');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  // Sixty, so a move can cost double and still be affordable — the tests are
  // about what the ground charges, not about what a Medium humanoid can do.
  baseSpeed: 60,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
});

/** One creature, on its own turn, standing at a landmark with room around it. */
const SETUP: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: WALKER,
    name: 'walker',
    sheet: sheet(),
    maxHp: 40,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WALKER, placement: { from: { landmark: 'the ford' }, feet: 0 } },
  { type: 'combat-started', combatants: [{ id: WALKER, initiative: 20, speed: 60 }] },
];

const supply = (seed = 'terrain') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A patch shaped like a Sphere, which on the lattice is a Chebyshev ball. */
const ball = (at: Point, radius: number): TerrainRegion => ({
  origin: areaPointAt(at),
  shape: { kind: 'sphere', radius },
});

/** The ford itself and everything for two hundred feet around it. */
const EVERYWHERE = ball({ x: 100, y: 100, z: 0 }, 200);

/** Bearing 90 is +x, so east is where the walker goes. */
const east = (feet: number, route?: readonly Point[]) => ({
  placement: { from: { landmark: 'the ford' }, feet, bearing: 90 },
  ...(route === undefined ? {} : { route }),
});

const west = (feet: number) => ({
  placement: { from: { landmark: 'the ford' }, feet, bearing: 270 },
});

/** The spaces of a straight eastward walk, which is what a route is. */
const eastwards = (from: number, to: number): readonly Point[] => {
  const spaces: Point[] = [];
  for (let x = from + 5; x <= to; x += 5) spaces.push({ x, y: 100, z: 0 });
  return spaces;
};

const declare = (
  log: readonly GameEvent[],
  patch: string,
  region: TerrainRegion,
  over: { costPerFoot?: number; source?: string } = {},
): readonly GameEvent[] => [
  ...log,
  ...unwrap(declareDifficultTerrain(fold('seed', log), patch, { region, ...over }), patch),
];

const move = (log: readonly GameEvent[], request: Parameters<typeof resolveMove>[2]) => {
  const out = unwrap(resolveMove(fold('seed', log), WALKER, request, supply()), 'move');
  return { ...out, log: [...log, ...out.events] };
};

describe('a patch of Difficult Terrain charges the extra foot', () => {
  /**
   * **Proved by how far the budget reaches, not by a number this test wrote
   * down.** A Speed of 60 is 60 feet of open ground and 30 feet of mire; the
   * assertion is that the walker gets exactly half as far, and that the foot
   * beyond it is refused.
   */
  it('halves how far a fixed budget reaches', () => {
    const mired = declare(SETUP, 'the mire', EVERYWHERE);

    const far = move(mired, east(30));
    expect(far.feet).toBe(30);
    expect(movementLeftFor(fold('seed', far.log), WALKER)).toBe(0);

    const further = resolveMove(fold('seed', mired), WALKER, east(35), supply());
    expect(isErr(further)).toBe(true);

    // The same budget on open ground reaches the whole sixty.
    const dry = move(SETUP, east(60));
    expect(movementLeftFor(fold('seed', dry.log), WALKER)).toBe(0);
  });

  /** A patch may print its own rate: Plant Growth and Wall of Thorns do. */
  it('charges the rate the patch was declared at', () => {
    const thorns = declare(SETUP, 'the thorns', EVERYWHERE, { costPerFoot: 4 });
    const out = move(thorns, east(15));
    expect(out.cost).toBe(60);
    expect(movementLeftFor(fold('seed', out.log), WALKER)).toBe(0);
  });

  it('names the patch it is charging for', () => {
    const mired = declare(SETUP, 'the mire', EVERYWHERE);
    expect(move(mired, east(10)).terrain).toEqual(['the mire']);
  });
});

describe('only the feet inside it cost extra', () => {
  /** A ball of radius 5 around x=115 is the three spaces 110, 115 and 120. */
  const PUDDLE = ball({ x: 115, y: 100, z: 0 }, 5);

  /**
   * The engine records where a move began and where it ended and nothing in
   * between, so a walk that clips the corner of a patch has a cost the
   * endpoints cannot answer. It asks rather than inferring a line nobody took.
   */
  it('asks which spaces were crossed, rather than guessing', () => {
    const out = resolveMove(fold('seed', declare(SETUP, 'the puddle', PUDDLE)), WALKER, east(25), supply());
    expect(isErr(out)).toBe(true);
    if (!isErr(out)) return;
    expect(out.kind).toBe('needs-context');
    expect(out.code).toBe('route_required');
    expect(out.requests?.[0]?.kind).toBe('route');
    expect(out.requests?.[0]?.satisfyWith).toContain('route');
  });

  /**
   * Twenty-five feet, three of whose five spaces are puddle: 5 + 10 + 10 + 10
   * + 5. Charging the whole move double would be 50 and charging none of it
   * 25, so the number can only come from reading the route space by space.
   */
  it('charges the crossed spaces and no others', () => {
    const out = move(declare(SETUP, 'the puddle', PUDDLE), east(25, eastwards(100, 125)));
    expect(out.feet).toBe(25);
    expect(out.cost).toBe(40);
    expect(movementLeftFor(fold('seed', out.log), WALKER)).toBe(20);
  });

  /**
   * A shove is not the creature's movement, so it spends none of it and the
   * ground charges nothing — the reading `relocateOrigin` already records for
   * a spell's own point. Asking a shove for its route would be asking the
   * table to itemise a cost nobody pays.
   */
  it('charges nothing for movement somebody else is doing to you', () => {
    const shoved = move(declare(SETUP, 'the puddle', PUDDLE), {
      placement: { from: { landmark: 'the ford' }, feet: 25, bearing: 90 },
      forced: true,
    });
    expect(shoved.cost).toBe(25);
    expect(shoved.terrain).toEqual([]);
  });

  /**
   * **A shortest path can leave the straight line between the endpoints, and
   * the question has to follow it there.** Chebyshev distance is the longer
   * axis alone, so a move of 5 feet across and 15 along has 10 feet of slack
   * sideways: (100, 100) to (105, 115) is three steps, and (110, 110) is on
   * one of them. Asking only about the box between the endpoints would charge
   * that walk as open floor while accepting a route through the snag that
   * costs five feet more.
   */
  const SNAG = ball({ x: 110, y: 110, z: 0 }, 0);
  const CORNER = { placement: { from: { point: { x: 105, y: 115, z: 0 } }, feet: 0 } };

  it('asks about ground a shortest path could reach off the straight line', () => {
    const out = resolveMove(fold('seed', declare(SETUP, 'the snag', SNAG)), WALKER, CORNER, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('route_required');
  });

  it('charges that route what its own spaces cost', () => {
    const out = move(declare(SETUP, 'the snag', SNAG), {
      ...CORNER,
      route: [
        { x: 105, y: 105, z: 0 },
        { x: 110, y: 110, z: 0 },
        { x: 105, y: 115, z: 0 },
      ],
    });
    expect(out.feet).toBe(15);
    expect(out.cost).toBe(20);
  });

  /** A patch the walk never reaches costs nothing and is not even asked about. */
  it('leaves a creature walking the other way alone', () => {
    const out = move(declare(SETUP, 'the puddle', PUDDLE), west(30));
    expect(out.cost).toBe(30);
    expect(out.terrain).toEqual([]);
  });

  /**
   * The space you start in is one you are leaving, not one you move in. A
   * walker standing in the puddle and stepping clear of it pays open-ground
   * cost for every space it enters.
   */
  it('does not charge for the space the move began in', () => {
    const inside = declare(SETUP, 'the puddle', ball({ x: 100, y: 100, z: 0 }, 0));
    expect(move(inside, east(20)).cost).toBe(20);
  });
});

describe('Difficult Terrain is not cumulative', () => {
  it('costs the same under two patches as under one', () => {
    const one = declare(SETUP, 'the webs', EVERYWHERE);
    const two = declare(one, 'the vines', EVERYWHERE);
    expect(move(two, east(20)).cost).toBe(move(one, east(20)).cost);
  });

  /**
   * Where two patches disagree the dearer one governs — the same shape SRD
   * gives overlapping cover, where a target "benefits only from the most
   * protective degree".
   */
  it('charges the more expensive of two that disagree', () => {
    const both = declare(declare(SETUP, 'the webs', EVERYWHERE), 'the thorns', EVERYWHERE, {
      costPerFoot: 4,
    });
    expect(move(both, east(10)).cost).toBe(40);
    expect(move(both, east(10)).terrain).toEqual(['the thorns', 'the webs']);
  });
});

/**
 * The ground charges what the budget pays, and where there is no budget there
 * is nothing for it to charge.
 *
 * Two cases, one rule. Forced movement is not the creature's movement at all,
 * and outside combat there is no action economy to spend from — `resolveMove`
 * has said so since it landed. Putting a question to the table about a number
 * nobody collects is the same mistake in both.
 */
describe('a move that spends nothing', () => {
  const PUDDLE = ball({ x: 115, y: 100, z: 0 }, 5);
  const PEACE = SETUP.filter((e) => e.type !== 'combat-started');

  it('is not asked for its route outside combat', () => {
    const out = move(declare(PEACE, 'the puddle', PUDDLE), east(25));
    expect(out.cost).toBe(25);
    expect(out.terrain).toEqual([]);
  });

  it('spends nothing at all outside combat', () => {
    const out = move(declare(PEACE, 'the mire', EVERYWHERE), east(25));
    expect(out.events.some((e) => e.type === 'movement-spent')).toBe(false);
  });
});

describe('a move nobody can pay for', () => {
  it('is refused, and says what made the ground expensive', () => {
    const mired = declare(SETUP, 'the mire', EVERYWHERE);
    const out = resolveMove(fold('seed', mired), WALKER, east(35), supply());
    expect(isErr(out)).toBe(true);
    if (!isErr(out)) return;
    expect(out.code).toBe('not_enough_movement');
    expect(out.kind).toBe('refusal');
    expect(out.reason).toContain('the mire');
    expect(out.reason).toContain('2 feet per foot');
  });

  it('leaves the walker standing where they were', () => {
    const mired = declare(SETUP, 'the mire', EVERYWHERE);
    resolveMove(fold('seed', mired), WALKER, east(35), supply());
    expect(movementLeftFor(fold('seed', mired), WALKER)).toBe(60);
  });
});

describe('a patch a casting made', () => {
  const CASTING = 'casting-of-the-webs';

  /**
   * A hand-written ongoing record, because what the patch needs from a
   * casting is only that it is still running. No definition is involved and
   * none could be: this is the table saying "the webs are here", not a spell
   * printing an area.
   */
  const CAST: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spell-ongoing',
      casting: {
        castingId: CASTING,
        caster: WALKER,
        spellId: 'homebrew-mire',
        spell: 'Mire',
        level: 2,
        version: 3,
        numbers: { saveDc: 13, attackModifier: 5, spellcastingModifier: 3, casterLevel: 5 },
        on: [],
      },
    },
  ];

  const WEBBED = declare(CAST, 'the webs', EVERYWHERE, { source: CASTING });

  it('charges while the casting runs', () => {
    expect(move(WEBBED, east(20)).cost).toBe(40);
  });

  it('charges nothing once the casting has ended', () => {
    const ended: readonly GameEvent[] = [
      ...WEBBED,
      { type: 'spell-ended', castingId: CASTING, on: null, reason: 'dispelled' },
    ];
    const out = move(ended, east(20));
    expect(out.cost).toBe(20);
    expect(out.terrain).toEqual([]);
  });

  it('refuses a patch hung on a casting nobody is running', () => {
    const out = declareDifficultTerrain(fold('seed', SETUP), 'the webs', {
      region: EVERYWHERE,
      source: 'no-such-casting',
    });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('unknown_casting');
  });
});

describe('declaring a patch', () => {
  it('refuses a rate that is not Difficult Terrain at all', () => {
    const out = declareDifficultTerrain(fold('seed', SETUP), 'the lawn', {
      region: EVERYWHERE,
      costPerFoot: 1,
    });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('bad_terrain_cost');
  });

  it('refuses a rate that is not a whole number of feet', () => {
    const out = declareDifficultTerrain(fold('seed', SETUP), 'the slush', {
      region: EVERYWHERE,
      costPerFoot: 2.5,
    });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('bad_terrain_cost');
  });

  /** A refusal quotes the patch back, so a patch with no name has nothing to quote. */
  it('refuses a patch with no name', () => {
    const out = declareDifficultTerrain(fold('seed', SETUP), '   ', { region: EVERYWHERE });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('bad_patch');
  });

  it('happens once under one command id', () => {
    const first = unwrap(
      declareDifficultTerrain(fold('seed', SETUP), 'the mire', { region: EVERYWHERE, commandId: 'd1' }),
      'declare',
    );
    expect(first).toHaveLength(1);
    const again = unwrap(
      declareDifficultTerrain(fold('seed', [...SETUP, ...first]), 'the mire', {
        region: EVERYWHERE,
        commandId: 'd1',
      }),
      'again',
    );
    expect(again).toHaveLength(0);
  });

  /** Ground changes: a mire that freezes over is declared again, not argued with. */
  it('lets a later declaration replace an earlier one', () => {
    const mired = declare(SETUP, 'the mire', EVERYWHERE);
    const frozen = declare(mired, 'the mire', EVERYWHERE, { costPerFoot: 4 });
    expect(move(frozen, east(10)).cost).toBe(40);
  });
});

describe('a route is the table’s to state', () => {
  const PUDDLE = ball({ x: 115, y: 100, z: 0 }, 5);

  it('refuses a route that does not arrive where the move ends', () => {
    const out = resolveMove(
      fold('seed', declare(SETUP, 'the puddle', PUDDLE)),
      WALKER,
      east(25, eastwards(100, 120)),
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('bad_route');
  });

  it('refuses a route with a gap in it', () => {
    const gappy = [
      { x: 105, y: 100, z: 0 },
      { x: 120, y: 100, z: 0 },
      { x: 125, y: 100, z: 0 },
      { x: 130, y: 100, z: 0 },
      { x: 125, y: 100, z: 0 },
    ];
    const out = resolveMove(
      fold('seed', declare(SETUP, 'the puddle', PUDDLE)),
      WALKER,
      east(25, gappy),
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('bad_route');
  });

  /**
   * A route is a **shortest** path, and a wandering one is refused rather than
   * charged. Two reasons, and both are rules rather than convenience: the
   * distance the ruler measured is what the budget is charged, and an
   * Opportunity Attack is offered by comparing where the mover was with where
   * they ended — a detour through somebody's reach is a move that should have
   * been sent in segments.
   */
  it('refuses a route longer than the move it describes', () => {
    const wandering = [
      { x: 100, y: 105, z: 0 },
      { x: 105, y: 105, z: 0 },
      { x: 110, y: 105, z: 0 },
      { x: 115, y: 100, z: 0 },
      { x: 120, y: 100, z: 0 },
      { x: 125, y: 100, z: 0 },
    ];
    const out = resolveMove(
      fold('seed', declare(SETUP, 'the puddle', PUDDLE)),
      WALKER,
      east(25, wandering),
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('bad_route');
  });
});

describe('the log still folds the way it folded', () => {
  const CROSSED = (() => {
    const mired = declare(SETUP, 'the mire', EVERYWHERE);
    return move(mired, east(20)).log;
  })();

  it('folds byte-identically twice', () => {
    expect(fold('seed', CROSSED)).toStrictEqual(fold('seed', CROSSED));
    expect(JSON.stringify(fold('seed', CROSSED))).toBe(JSON.stringify(fold('seed', CROSSED)));
  });

  it('survives a round trip through JSON', () => {
    const through = JSON.parse(JSON.stringify(CROSSED)) as GameEvent[];
    expect(fold('seed', through)).toStrictEqual(fold('seed', CROSSED));
  });

  /** The cost is pinned in the event, so no fold ever recomputes it. */
  it('writes the cost into the log rather than deriving it again', () => {
    const spent = CROSSED.filter((e) => e.type === 'movement-spent');
    expect(spent).toHaveLength(1);
    expect(spent[0]).toMatchObject({ feet: 40 });
  });
});

/**
 * The declared number the mover carries has not gone anywhere. It is for
 * ground no patch covers — the snow and the slope and the narrow opening —
 * and it adds to what the patches charge rather than replacing it.
 */
describe('the feet a mover declares', () => {
  it('still cost a foot each', () => {
    expect(move(SETUP, { ...east(20), difficultFeet: 5 }).cost).toBe(25);
  });

  it('adds to what a patch charges', () => {
    const mired = declare(SETUP, 'the mire', EVERYWHERE);
    expect(move(mired, { ...east(20), difficultFeet: 5 }).cost).toBe(45);
  });
});
