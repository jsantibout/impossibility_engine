import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { terrainAt } from './positioning.js';
import { declaredCasting } from './spellcasting.js';
import { addCreature, advanceTime, resolveSpell } from './commands.js';

/**
 * SRD Speak with Plants, the one sentence in the middle of a conversation.
 *
 * > "You imbue plants in an immobile 30-foot Emanation with limited sentience
 * > and animation … You can also turn Difficult Terrain caused by plant growth
 * > (such as thickets and undergrowth) into ordinary terrain that lasts for
 * > the duration. Or you can turn ordinary terrain where plants are present
 * > into Difficult Terrain that lasts for the duration."
 *
 * Two things this spell waited on. **An Emanation that does not move**: an
 * Emanation is stored as the creature it comes from and re-read against where
 * that creature stands, and "immobile" pins the caster's own square at the
 * casting instead, so the ground stays cleared when the druid walks off. And
 * **ground made cheaper**: the lattice took the dearest rate lying over a
 * space and nothing subtracted, so `AreaTerrain.clears` is a patch that
 * overrides whatever else lies there — the Mouther's carried ground and a
 * declared thicket alike — for as long as the casting runs. Which direction
 * is the caster's, so it is a branch; the conversation is the table's.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const DRUID = id('druid');
const MOUTHER = id('mouther');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

/** The druid at the stone, the mouther twenty-five feet north, its ground charging. */
const GLADE: readonly GameEvent[] = (() => {
  const log: GameEvent[] = [
    {
      type: 'creature-added',
      id: DRUID,
      name: DRUID,
      sheet: sheet(),
      maxHp: 40,
      diesAtZero: false,
      creatureType: 'Humanoid',
      side: 'party',
    },
    {
      type: 'spellcasting-declared',
      id: DRUID,
      spellcasting: declaredCasting({
        ability: 'wis',
        classId: 'druid',
        prepared: ['speak-with-plants'],
      }),
    },
    {
      type: 'resource-pool-declared',
      id: DRUID,
      pool: { key: 'spell-slot:3', label: 'level 3', max: 2, recovers: 'long-rest' },
    },
  ];
  log.push(
    ...must(addCreature(fold('seed', log), SRD_CONTENT, MOUTHER, 'gibbering-mouther'), 'mouther')
      .events,
  );
  log.push(
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the stone', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the stone' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: MOUTHER,
      placement: { from: { landmark: 'the stone' }, feet: 25, bearing: 0 },
    },
  );
  return log;
})();

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** Five feet short of the mouther: inside its ground and inside the druid's thirty feet. */
const NEAR = { x: 100, y: 120, z: 0 };
/** Ten feet past the mouther: inside its ground and outside the druid's thirty feet. */
const BEYOND = { x: 100, y: 135, z: 0 };
/** Ten feet from the druid, where nothing grows. */
const CLOSE = { x: 100, y: 110, z: 0 };

const speak = (log: readonly GameEvent[], option: 'clear' | 'overgrow') => {
  const out = must(
    resolveSpell(
      fold('seed', log),
      DRUID,
      { spellId: 'speak-with-plants', targets: [], option },
      supply('leaf'),
    ),
    option,
  );
  return [...log, ...out.events];
};

const cost = (state: GameState, at: { x: number; y: number; z: number }): number =>
  terrainAt(state, at).costPerFoot;

describe('SRD Speak with Plants clears plant-grown Difficult Terrain', () => {
  it('starts with the mouther’s ground charging double on both sides of it', () => {
    const state = fold('seed', GLADE);
    expect(cost(state, NEAR)).toBe(2);
    expect(cost(state, BEYOND)).toBe(2);
  });

  it('makes the ground inside thirty feet ordinary and leaves the ground beyond it', () => {
    const state = fold('seed', speak(GLADE, 'clear'));
    expect(cost(state, NEAR)).toBe(1);
    expect(cost(state, BEYOND)).toBe(2);
  });

  it('pins the Emanation to the druid’s square rather than to the druid', () => {
    const state = fold('seed', speak(GLADE, 'clear'));
    const patch = Object.values(state.scene!.terrain).find((one) => one.clears === true);
    expect(patch?.region.origin).toEqual({ space: { x: 100, y: 100, z: 0 } });
  });

  it('gives the ground back when the ten minutes are up', () => {
    const log = speak(GLADE, 'clear');
    const later = fold('seed', [...log, ...must(advanceTime(fold('seed', log), 600, 'the wait'), 'time')]);
    expect(cost(later, NEAR)).toBe(2);
  });
});

describe('SRD Speak with Plants overgrows ordinary ground', () => {
  it('makes the ground inside thirty feet Difficult Terrain', () => {
    const state = fold('seed', speak(GLADE, 'overgrow'));
    expect(cost(state, CLOSE)).toBe(2);
    expect(cost(fold('seed', GLADE), CLOSE)).toBe(1);
  });
});
