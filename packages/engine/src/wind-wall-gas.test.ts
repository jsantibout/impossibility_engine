import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { obscurementAt, type Point } from './positioning.js';
import { resolveSpell } from './commands.js';

/**
 * SRD Wind Wall: "**The strong wind keeps fog, smoke, and other gases at
 * bay.**" (E-L2)
 *
 * The gases the engine holds are castings — SRD Fog Cloud and SRD Stinking
 * Cloud — and each prints its own answer to a strong wind: "It lasts for the
 * duration or until a strong wind (such as one created by _Gust of Wind_)
 * disperses it." The wall is "a wall of strong wind", so it carries the same
 * `disperses` clause Gust of Wind's Line carries, and the fold ends a cloud its
 * spaces meet — whichever of the two was there first. Smoke off a burning
 * barn is no casting and nothing the engine holds.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const MAGE = id('mage');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 12, int: 18, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const caster = (who: CharacterId, prepared: readonly string[]): readonly GameEvent[] => [
  {
    type: 'creature-added',
    id: who,
    name: who,
    sheet: sheet(),
    maxHp: 60,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'druid', prepared: [...prepared] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
];

const at = (x: number, y: number): Point => ({ x, y, z: 0 });

/** The wall runs east–west along y = 215, ten spaces long: 175 to 220. */
const WALL_PATH = Array.from({ length: 10 }, (_, i) => at(175 + i * 5, 215));

const SETUP: readonly GameEvent[] = [
  ...caster(DRUID, ['wind-wall']),
  ...caster(MAGE, ['fog-cloud', 'stinking-cloud']),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { point: at(190, 200) }, feet: 0 } },
  { type: 'creature-placed', id: MAGE, placement: { from: { point: at(200, 160) }, feet: 0 } },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('gale') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const cast = (log: GameEvent[], who: CharacterId, request: Record<string, unknown>): string => {
  const state = fold('gale', log);
  const out = unwrap(resolveSpell(state, who, request as never, supply(state)), String(request['spellId']));
  log.push(...out.events);
  return out.castingId!;
};

const wall = (log: GameEvent[]) =>
  cast(log, DRUID, { spellId: 'wind-wall', targets: [], path: WALL_PATH, slotLevel: 3 });

describe('SRD Wind Wall keeps fog and other gases at bay', () => {
  it('disperses a Fog Cloud laid across it', () => {
    const log = [...SETUP];
    wall(log);
    const fog = cast(log, MAGE, { spellId: 'fog-cloud', targets: [], at: at(200, 220), slotLevel: 1 });

    const state = fold('gale', log);
    expect(state.ongoing[fog]).toBeUndefined();
    expect(obscurementAt(state, at(200, 230)).degree).toBeNull();
  });

  it('disperses a Stinking Cloud already standing when the wall rises through it', () => {
    const log = [...SETUP];
    const cloud = cast(log, MAGE, { spellId: 'stinking-cloud', targets: [], at: at(200, 230), slotLevel: 3 });
    expect(fold('gale', log).ongoing[cloud]).toBeDefined();

    wall(log);

    expect(fold('gale', log).ongoing[cloud]).toBeUndefined();
  });

  it('leaves a Fog Cloud the wall does not reach', () => {
    const log = [...SETUP];
    wall(log);
    const fog = cast(log, MAGE, { spellId: 'fog-cloud', targets: [], at: at(300, 100), slotLevel: 1 });

    expect(fold('gale', log).ongoing[fog]).toBeDefined();
  });
});
