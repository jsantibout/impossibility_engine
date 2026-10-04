/**
 * Who can breathe water — M-HOLD.
 *
 * SRD Water Elemental's Whelm: "Until the grapple ends, the target … is
 * suffocating **unless it can breathe water**." The one rule in the engine
 * that asks, and so the one reader every way the book gives a creature gills
 * reaches: a stat block's Amphibious or Water Breathing, SRD *Water
 * Breathing* and *Alter Self* cast on it, a Potion of Water Breathing drunk,
 * a worn Cloak of the Manta Ray (`standing-readers.test.ts`), and SRD Gift of
 * the Depths (`eldritch-invocations.test.ts`). Each is driven here or there to
 * the answer `breathesWater` gives, and to its end.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { addCreature, advanceTime, resolveSpell, useItem } from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { breathesWater } from './hazards.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';

const id = (s: string): CharacterId => asCharacterId(s);
const DRUID = id('druid');
const FRIEND = id('friend');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: false, shields: true },
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
  side: 'party',
});

const SHORE: readonly GameEvent[] = [
  added(DRUID),
  added(FRIEND),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'druid', prepared: ['water-breathing'] }),
  },
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: 'spell-slot:3', label: 'level 3', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the shore', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the shore' }, feet: 0 } },
  { type: 'creature-placed', id: FRIEND, placement: { from: { creature: DRUID }, feet: 10, bearing: 90 } },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const run = (log: readonly GameEvent[], step: (s: GameState) => Result<readonly GameEvent[]>): readonly GameEvent[] => [
  ...log,
  ...unwrap(step(fold('seed', log)), 'step'),
];

describe('SRD Water Breathing', () => {
  it('lets each willing target breathe water until the spell ends, and no longer', () => {
    expect(breathesWater(fold('seed', SHORE), DRUID)).toBe(false);
    const cast = unwrap(
      resolveSpell(fold('seed', SHORE), DRUID, { spellId: 'water-breathing', targets: [DRUID, FRIEND], willing: [FRIEND] }, supply('gills')),
      'the casting',
    );
    const log = [...SHORE, ...cast.events];
    const state = fold('seed', log);
    expect(breathesWater(state, DRUID)).toBe(true);
    expect(breathesWater(state, FRIEND)).toBe(true);
    // "Duration: 24 hours": a day later the casting has run out, and the gills with it.
    const later = fold('seed', run(log, (s) => advanceTime(s, 86_400, 'a day')));
    expect(breathesWater(later, DRUID)).toBe(false);
    expect(breathesWater(later, FRIEND)).toBe(false);
  });
});

describe('SRD Potion of Water Breathing', () => {
  it('lets its drinker breathe water for 24 hours', () => {
    const stocked = [
      ...SHORE,
      { type: 'items-gained', id: FRIEND, items: [{ id: 'potion-of-water-breathing', quantity: 1 }], source: 'a chest' },
    ] as const satisfies readonly GameEvent[];
    const drunk = [
      ...stocked,
      ...unwrap(useItem(fold('seed', stocked), FRIEND, { item: 'potion-of-water-breathing' }, supply('drink')), 'drink').events,
    ];
    expect(breathesWater(fold('seed', drunk), FRIEND)).toBe(true);
    expect(breathesWater(fold('seed', run(drunk, (s) => advanceTime(s, 86_400, 'a day'))), FRIEND)).toBe(false);
  });
});

describe('a stat block that breathes water', () => {
  it('answers yes for Amphibious and for Water Breathing, and no for a knight', () => {
    let log: readonly GameEvent[] = [];
    for (const [who, block] of [
      ['sahuagin', 'sahuagin-warrior'],
      ['merfolk', 'merfolk-skirmisher'],
      ['octopus', 'giant-octopus'],
      ['knight', 'knight'],
    ] as const) {
      log = [...log, ...unwrap(addCreature(fold('seed', log), SRD_CONTENT, id(who), block), block).events];
    }
    const state = fold('seed', log);
    expect(breathesWater(state, id('sahuagin'))).toBe(true);
    expect(breathesWater(state, id('merfolk'))).toBe(true);
    expect(breathesWater(state, id('octopus'))).toBe(true);
    expect(breathesWater(state, id('knight'))).toBe(false);
  });
});
