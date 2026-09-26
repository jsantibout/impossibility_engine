import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isNeedsContext, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { terrainAt, type Point } from './positioning.js';
import { resolveMove, resolveSpell } from './commands.js';

/**
 * SRD Gust of Wind:
 *
 * > "Any creature in the Line must spend **2 feet of movement for every 1 foot
 * > it moves when moving closer to you**."
 *
 * Difficult Terrain by another name, with one word the ground cannot say: a
 * patch is a property of the square and charges whoever crosses it, and this
 * rate applies only to a step that ends nearer the caster than it began. So
 * the patch carries the narrowing and the ruler reads it **per step of the
 * stated route**, against where the caster stands now — which is why a move
 * inside the Line with no route stated is asked for one: the rate depends on
 * which way each step went, and the endpoints do not say.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const FIGHTER = id('fighter');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === DRUID ? 'party' : 'foes',
});

/** The druid at the hall; the Line blows due east; the fighter stands forty feet down it. */
const HALL: Point = { x: 100, y: 100, z: 0 };
const EAST: Point = { x: 200, y: 100, z: 0 };
const FIGHTER_AT: Point = { x: 140, y: 100, z: 0 };

const SETUP: readonly GameEvent[] = [
  added(DRUID),
  added(FIGHTER),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['gust-of-wind'] }),
  },
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: spellSlotKey(2), label: 'level 2', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: HALL },
  { type: 'landmark-added', name: 'down the line', at: FIGHTER_AT },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'down the line' }, feet: 0 } },
  {
    type: 'combat-started',
    combatants: [
      { id: DRUID, initiative: 20, speed: 30 },
      { id: FIGHTER, initiative: 10, speed: 30 },
    ],
  },
];

/** A flat bonus that settles the opening save, so nobody is pushed before walking. */
const supply = (seed = 'wind', flat = 40) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  bonuses: [{ source: 'the fixture', flat }],
  content: SRD_CONTENT,
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

/** The Line blown and the druid's turn ended, so the fighter may move. */
const blowing = (): readonly GameEvent[] => {
  const cast = unwrap(
    resolveSpell(state(SETUP), DRUID, { spellId: 'gust-of-wind', targets: [], towards: EAST, slotLevel: 2 }, supply()),
    'the gust',
  );
  return [...SETUP, ...cast.events, { type: 'turn-advanced' }];
};

const along = (from: Point, dx: number, spaces: number): Point[] =>
  Array.from({ length: spaces }, (_, i) => ({ x: from.x + dx * (i + 1), y: from.y, z: from.z }));

describe('the definition prints the wind', () => {
  const definition = () => SPELL_DEFINITIONS.find((one) => one.id === 'gust-of-wind')!;

  it('makes the Line Difficult Terrain only for a step towards the caster', () => {
    expect(definition().areaTerrain).toEqual({ costPerFoot: 2, onlyTowards: 'caster' });
    expect(checkSpellDefinitionValue(definition())).toEqual([]);
  });

  it('refuses a narrowing that names anything but the caster, or one on ground made ordinary', () => {
    const codes = (terrain: unknown): readonly string[] =>
      checkSpellDefinitionValue({ ...definition(), areaTerrain: terrain }).map((one) => one.code);
    expect(codes({ costPerFoot: 2, onlyTowards: 'target' })).toContain('malformed_field');
    expect(codes({ clears: true, onlyTowards: 'caster' })).toContain('terrain_clears_and_charges');
  });
});

describe('walking in the wind', () => {
  it('lays the patch with the narrowing pinned, over the Line the druid blew', () => {
    const log = blowing();
    expect(log.find((event) => event.type === 'difficult-terrain-declared')).toMatchObject({
      costPerFoot: 2,
      onlyTowards: 'caster',
    });
    expect(terrainAt(state(log), FIGHTER_AT).patches).toHaveLength(1);
  });

  it('charges two feet per foot walking towards the druid', () => {
    const walked = unwrap(
      resolveMove(
        state(blowing()),
        FIGHTER,
        { placement: { from: { landmark: 'down the line' }, feet: 15, bearing: 270 }, route: along(FIGHTER_AT, -5, 3) },
        supply('walk'),
      ),
      'into the wind',
    );
    expect(walked.feet).toBe(15);
    expect(walked.cost).toBe(30);
    expect(walked.terrain).toHaveLength(1);
  });

  it('charges one foot per foot walking away from the druid', () => {
    const walked = unwrap(
      resolveMove(
        state(blowing()),
        FIGHTER,
        { placement: { from: { landmark: 'down the line' }, feet: 15, bearing: 90 }, route: along(FIGHTER_AT, 5, 3) },
        supply('walk'),
      ),
      'down the wind',
    );
    expect(walked.feet).toBe(15);
    expect(walked.cost).toBe(15);
    expect(walked.terrain).toEqual([]);
  });

  it('asks for the route when a move inside the Line states none', () => {
    const out = resolveMove(
      state(blowing()),
      FIGHTER,
      { placement: { from: { landmark: 'down the line' }, feet: 15, bearing: 270 } },
      supply('walk'),
    );
    expect(isNeedsContext(out) && out.code).toBe('route_required');
  });

  /**
   * The narrowing is read against where the caster stands *now*: a druid who
   * has since stepped east of the fighter turns the same westward walk into
   * one away from them, and the Line — carried by the druid — has moved on
   * with them.
   */
  it('reads "closer to you" from where the caster stands at the step', () => {
    const log = [
      ...blowing(),
      // The druid has walked to the far end of the row: the Line now blows
      // east from x = 180, and the fighter at x = 140 is behind the druid.
      { type: 'creature-moved', id: DRUID, placement: { from: { landmark: 'down the line' }, feet: 40, bearing: 90 }, forced: true } as GameEvent,
    ];
    expect(terrainAt(state(log), FIGHTER_AT).patches).toEqual([]);
    const walked = unwrap(
      resolveMove(
        state(log),
        FIGHTER,
        { placement: { from: { landmark: 'down the line' }, feet: 15, bearing: 270 }, route: along(FIGHTER_AT, -5, 3) },
        supply('walk'),
      ),
      'a walk outside the Line',
    );
    expect(walked.cost).toBe(15);
  });
});
