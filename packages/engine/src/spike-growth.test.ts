import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  expect as unwrap,
  isErr,
  isNeedsContext,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { terrainAt, type Point } from './positioning.js';
import { resolveMove, resolveSpell } from './commands.js';

/**
 * SRD Spike Growth:
 *
 * > "The ground in a 20-foot-radius Sphere centered on a point within range
 * > sprouts hard spikes and thorns. The area becomes Difficult Terrain for the
 * > duration. **When a creature moves into or within the area, it takes 2d4
 * > Piercing damage for every 5 feet it travels.**"
 *
 * The first sentence was executed by `casting-terrain.test.ts`: the area is a
 * patch the casting keeps. This is the second — the dice are multiplied by a
 * distance travelled **inside** the area, and the only thing in the engine
 * that says which feet of a move were where is the route the mover states.
 * So a stated route is read space by space against the damaging patches, the
 * dice are summed into one roll (fifteen feet is 6d4), and a move that could
 * have crossed the spikes with no route stated is asked for one before
 * anything is spent — the `route_required` question terrain already asks,
 * asked now for a reason that is not a budget.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const GOBLIN = id('goblin');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 60,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === DRUID ? 'party' : 'foes',
});

/**
 * The Sphere is centred on `AT`, so it covers the spaces from x = 220 to
 * x = 260 along y = 200. `EDGE` is the first space beyond it, `FAR_EDGE` the
 * same distance along a line that never enters it.
 */
const HALL: Point = { x: 100, y: 200, z: 0 };
const AT: Point = { x: 240, y: 200, z: 0 };
const EDGE: Point = { x: 265, y: 200, z: 0 };
const FAR_EDGE: Point = { x: 265, y: 260, z: 0 };

const spot = (name: string, at: Point): GameEvent => ({ type: 'landmark-added', name, at });

const SETUP: readonly GameEvent[] = [
  added(DRUID),
  added(GOBLIN),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['spike-growth'] }),
  },
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 60 } },
  spot('the hall', HALL),
  spot('the edge', EDGE),
  spot('the far edge', FAR_EDGE),
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { landmark: 'the edge' }, feet: 0 } },
];

const FIGHT: GameEvent = {
  type: 'combat-started',
  combatants: [
    { id: GOBLIN, initiative: 20, speed: 60 },
    { id: DRUID, initiative: 10, speed: 60 },
  ],
};

const supply = (seed = 'spikes') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

/** The spikes conjured and the fight begun, with the goblin's turn first. */
const spiked = (): { log: readonly GameEvent[]; casting: string } => {
  const cast = unwrap(
    resolveSpell(state(SETUP), DRUID, { spellId: 'spike-growth', targets: [], at: AT, slotLevel: 2 }, supply()),
    'the spikes',
  );
  return { log: [...SETUP, ...cast.events, FIGHT], casting: cast.castingId! };
};

const west = (from: Point, spaces: number): Point[] =>
  Array.from({ length: spaces }, (_, i) => ({ x: from.x - 5 * (i + 1), y: from.y, z: from.z }));

const damageTaken = (events: readonly GameEvent[]) =>
  events.filter((event) => event.type === 'damage-taken' && event.id === GOBLIN);

describe('the definition prints the spikes', () => {
  const definition = () => SPELL_DEFINITIONS.find((one) => one.id === 'spike-growth')!;

  it('pins 2d4 Piercing for every 5 feet on the ground it makes difficult', () => {
    expect(definition().areaTerrain).toEqual({
      costPerFoot: 2,
      damagePerFeet: { feet: 5, dice: '2d4', damageType: 'piercing' },
    });
    expect(checkSpellDefinitionValue(definition())).toEqual([]);
  });

  it('refuses spikes with no dice, a bad type, or a distance that is not a whole number of feet', () => {
    const codes = (terrain: unknown): readonly string[] =>
      checkSpellDefinitionValue({ ...definition(), areaTerrain: terrain }).map((one) => one.code);
    expect(codes({ costPerFoot: 2, damagePerFeet: { feet: 5, dice: 'two dice', damageType: 'piercing' } })).toContain('bad_terrain_damage');
    expect(codes({ costPerFoot: 2, damagePerFeet: { feet: 5, dice: '2d4', damageType: 'spiky' } })).toContain('bad_terrain_damage');
    expect(codes({ costPerFoot: 2, damagePerFeet: { feet: 0, dice: '2d4', damageType: 'piercing' } })).toContain('bad_terrain_damage');
    // Ground made ordinary deals nothing: the two are one field's two answers.
    expect(codes({ clears: true, damagePerFeet: { feet: 5, dice: '2d4', damageType: 'piercing' } })).toContain('terrain_clears_and_charges');
  });
});

describe('a walk through the spikes', () => {
  it('lays a patch that charges double and carries the dice, pinned into the log', () => {
    const { log } = spiked();
    const declared = log.find((event) => event.type === 'difficult-terrain-declared');
    expect(declared).toMatchObject({
      costPerFoot: 2,
      damagePerFeet: { feet: 5, dice: '2d4', damageType: 'piercing' },
    });
    // The edge is outside and the next space in is not: the geometry the
    // routes below are written against.
    expect(terrainAt(state(log), EDGE).costPerFoot).toBe(1);
    expect(terrainAt(state(log), { x: 260, y: 200, z: 0 }).costPerFoot).toBe(2);
  });

  it('deals one roll of the summed dice — fifteen feet inside is 6d4 Piercing', () => {
    const { log, casting } = spiked();
    const route = west(EDGE, 3);
    const walked = unwrap(
      resolveMove(
        state(log),
        GOBLIN,
        { placement: { from: { landmark: 'the edge' }, feet: 15, bearing: 270 }, route },
        supply('walk'),
      ),
      'walking into the spikes',
    );
    expect(walked.feet).toBe(15);
    // Difficult Terrain still charges: fifteen feet of spikes costs thirty.
    expect(walked.cost).toBe(30);

    const dice = walked.events.find((event) => event.type === 'damage-dice-recorded');
    expect(dice).toBeDefined();
    if (dice?.type !== 'damage-dice-recorded') throw new Error('unreachable');
    expect(dice.target).toBe(GOBLIN);
    expect(dice.by).toBe(DRUID);
    expect(dice.source).toContain(casting);
    expect(dice.components).toHaveLength(1);
    expect(dice.components[0]?.type).toBe('piercing');
    // Six faces of a d4, one roll: the engine's number, bounded by the dice.
    expect(dice.components[0]?.dice).toHaveLength(6);
    for (const die of dice.components[0]!.dice) {
      expect(die.sides).toBe(4);
      expect(die.value).toBeGreaterThanOrEqual(1);
      expect(die.value).toBeLessThanOrEqual(4);
    }

    const taken = damageTaken(walked.events);
    expect(taken).toHaveLength(1);
    if (taken[0]?.type !== 'damage-taken') throw new Error('unreachable');
    expect(taken[0].amount).toBe(dice.rolled);
    expect(taken[0].by).toBe(DRUID);
    // And the dice the walk threw are counted, so the next command's roll ids
    // start after them.
    expect(walked.events.some((event) => event.type === 'rolls-issued')).toBe(true);
    // The whole batch folds: the goblin is down by what the spikes dealt.
    const after = state([...log, ...walked.events]);
    expect(after.creatures[GOBLIN]?.vitals.hp).toBe(200 - dice.rolled);
  });

  it('charges only the feet inside: two spaces in is 4d4', () => {
    const { log } = spiked();
    const walked = unwrap(
      resolveMove(
        state(log),
        GOBLIN,
        { placement: { from: { landmark: 'the edge' }, feet: 10, bearing: 270 }, route: west(EDGE, 2) },
        supply('walk'),
      ),
      'two spaces in',
    );
    const dice = walked.events.find((event) => event.type === 'damage-dice-recorded');
    if (dice?.type !== 'damage-dice-recorded') throw new Error('no dice were thrown');
    expect(dice.components[0]?.dice).toHaveLength(4);
  });

  it('deals nothing to a goblin skirting the area', () => {
    const { log } = spiked();
    const skirting = [...SETUP.slice(0, -1), { type: 'creature-placed', id: GOBLIN, placement: { from: { landmark: 'the far edge' }, feet: 0 } } as GameEvent];
    const relaid = [...skirting, ...log.slice(SETUP.length)];
    const walked = unwrap(
      resolveMove(
        state(relaid),
        GOBLIN,
        {
          placement: { from: { landmark: 'the far edge' }, feet: 15, bearing: 180 },
          route: [
            { x: 265, y: 255, z: 0 },
            { x: 265, y: 250, z: 0 },
            { x: 265, y: 245, z: 0 },
          ],
        },
        supply('walk'),
      ),
      'skirting the spikes',
    );
    expect(walked.cost).toBe(15);
    expect(damageTaken(walked.events)).toEqual([]);
    expect(walked.events.some((event) => event.type === 'damage-dice-recorded')).toBe(false);
  });

  it('asks for the route when a move into the area states none', () => {
    const { log } = spiked();
    const out = resolveMove(
      state(log),
      GOBLIN,
      { placement: { from: { landmark: 'the edge' }, feet: 15, bearing: 270 } },
      supply('walk'),
    );
    expect(isNeedsContext(out)).toBe(true);
    expect(out.ok ? 'ok' : out.code).toBe('route_required');
    expect(contextRequestsOf(out)[0]?.kind).toBe('route');
  });

  /**
   * And out of a fight too: terrain's own `route_required` is about a budget
   * and is reported rather than raised where there is none, but the spikes
   * are not a budget — a goblin walking through them between fights is still
   * cut, and the dice cannot be thrown without knowing which feet were inside.
   */
  it('asks for the route out of combat as well', () => {
    const { log } = spiked();
    const out = resolveMove(
      state(log.filter((event) => event.type !== 'combat-started')),
      GOBLIN,
      { placement: { from: { landmark: 'the edge' }, feet: 15, bearing: 270 } },
      supply('walk'),
    );
    expect(isNeedsContext(out)).toBe(true);
    expect(out.ok ? 'ok' : out.code).toBe('route_required');
  });

  it('charges a shove that states its path, and says so for one that does not', () => {
    const { log } = spiked();
    const stated = unwrap(
      resolveMove(
        state(log),
        GOBLIN,
        { placement: { from: { landmark: 'the edge' }, feet: 10, bearing: 270 }, forced: true, route: west(EDGE, 2) },
        supply('shove'),
      ),
      'a shove with its path stated',
    );
    expect(stated.cost).toBe(10);
    expect(damageTaken(stated.events)).toHaveLength(1);

    const unstated = unwrap(
      resolveMove(
        state(log),
        GOBLIN,
        { placement: { from: { landmark: 'the edge' }, feet: 10, bearing: 270 }, forced: true },
        supply('shove'),
      ),
      'a shove with no path',
    );
    expect(damageTaken(unstated.events)).toEqual([]);
    expect(unstated.unverified.some((line) => line.includes('Spike Growth'))).toBe(true);
  });

  it('a route is still a shortest path', () => {
    const { log } = spiked();
    const out = resolveMove(
      state(log),
      GOBLIN,
      { placement: { from: { landmark: 'the edge' }, feet: 10, bearing: 270 }, route: west(EDGE, 3) },
      supply('walk'),
    );
    expect(isErr(out) && out.code).toBe('bad_route');
  });
});
