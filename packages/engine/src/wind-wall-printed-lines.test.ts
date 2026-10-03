import { describe, expect, it } from 'vitest';
import { SRD_CONTENT, SRD_CONTENT_INPUT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { createContent } from './content.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { type Point } from './positioning.js';
import { addCreature, resolveAttack, resolveSpell } from './commands.js';

/**
 * SRD Wind Wall: "Arrows, bolts, and other ordinary projectiles launched at
 * targets behind the wall are deflected upward and miss automatically.
 * Boulders hurled by Giants or siege engines, and similar projectiles, are
 * unaffected." (E-L2)
 *
 * A catalogue weapon's ranged attack was already deflected; a stat block's
 * printed line was only reported, because the line does not say what it
 * looses. **A line named after a catalogue weapon looses that weapon** — a
 * Scout's Longbow is a longbow, an Ogre's Javelin a javelin — so it is read as
 * the weapon and deflected as the weapon is. A line named after nothing in the
 * catalogue is read off the **projectile table** content holds (the owner's
 * ruling of 2026-10-03: "a content table, decided once"): a Manticore's Tail
 * Spike is an ordinary projectile and is deflected; a Barbed Devil's Hurl
 * Flame is fire and a Stone Giant's Boulder is a boulder, and neither is
 * touched or reported. The SRD's table decides every printed line; a line a
 * homebrew table leaves out is still the table's to say, and is still
 * reported.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const FIGHTER = id('fighter');
const SCOUT = id('scout');
const OGRE = id('ogre');
const MANTICORE = id('manticore');
const DEVIL = id('barbed-devil');
const STONE_GIANT = id('stone-giant');
const FROST_GIANT = id('frost-giant');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 18, cha: 10 },
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
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const at = (x: number, y: number): Point => ({ x, y, z: 0 });

/** The wall runs east–west along y = 215, ten spaces long: 175 to 220. */
const WALL_PATH = Array.from({ length: 10 }, (_, i) => at(175 + i * 5, 215));

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('wind') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

/** The fighter south of the wall, three shooters north of it, and the wall up. */
const field = (): GameState => {
  const log: GameEvent[] = [
    added(DRUID),
    added(FIGHTER),
    {
      type: 'spellcasting-declared',
      id: DRUID,
      spellcasting: declaredCasting({ ability: 'wis', classId: 'druid', prepared: ['wind-wall'] }),
    },
    {
      type: 'resource-pool-declared',
      id: DRUID,
      pool: { key: 'spell-slot:3', label: 'level 3', max: 2, recovers: 'long-rest' },
    },
    { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
    { type: 'creature-placed', id: DRUID, placement: { from: { point: at(190, 200) }, feet: 0 } },
    { type: 'creature-placed', id: FIGHTER, placement: { from: { point: at(200, 200) }, feet: 0 } },
  ];
  for (const [who, block, x] of [
    [SCOUT, 'scout', 190],
    [OGRE, 'ogre', 200],
    [MANTICORE, 'manticore', 210],
    [DEVIL, 'barbed-devil', 180],
    [STONE_GIANT, 'stone-giant', 150],
    [FROST_GIANT, 'frost-giant', 225],
  ] as const) {
    log.push(...unwrap(addCreature(fold('wind', log), SRD_CONTENT, who, block), block).events);
    log.push(
      { type: 'creature-placed', id: who, placement: { from: { point: at(x, 240) }, feet: 0 } },
      { type: 'sight-declared', from: who, to: FIGHTER, seen: true },
    );
  }
  const state = fold('wind', log);
  const wall = unwrap(
    resolveSpell(state, DRUID, { spellId: 'wind-wall', targets: [], path: WALL_PATH, slotLevel: 3 }, supply(state)),
    'wind wall',
  );
  return fold('wind', [...log, ...wall.events]);
};

const shoot = (state: GameState, who: CharacterId, line: string, thrown = false) =>
  unwrap(
    resolveAttack(
      state,
      who,
      { target: FIGHTER, weapon: null, action: line, ...(thrown ? { thrown: true } : {}) },
      supply(state),
    ),
    line,
  );

describe('SRD Wind Wall and a stat block’s printed ranged line', () => {
  it('deflects a printed Longbow, which looses the longbow’s arrows', () => {
    const shot = shoot(field(), SCOUT, 'Longbow');
    expect(shot.attack?.hit).toBe(false);
    expect(shot.attack?.autoMissed).toContain('Wind Wall');
  });

  it('deflects a printed Javelin thrown across it', () => {
    const shot = shoot(field(), OGRE, 'Javelin', true);
    expect(shot.attack?.autoMissed).toContain('Wind Wall');
  });

  it('deflects a line the projectile table calls ordinary: a Manticore’s Tail Spike', () => {
    const shot = shoot(field(), MANTICORE, 'Tail Spike');
    expect(shot.attack?.hit).toBe(false);
    expect(shot.attack?.autoMissed).toContain('Wind Wall');
    expect(shot.unverified.some((line) => line.includes('Wind Wall'))).toBe(false);
  });

  it('lets fire and a giant’s boulder through, and reports neither', () => {
    for (const [who, line] of [
      [DEVIL, 'Hurl Flame'],
      [STONE_GIANT, 'Boulder'],
    ] as const) {
      const shot = shoot(field(), who, line);
      expect(shot.attack?.autoMissed ?? null, line).toBeNull();
      expect(shot.unverified.some((said) => said.includes('Wind Wall')), line).toBe(false);
    }
  });

  it('deflects a Giant’s arrow: the table calls a Frost Giant’s Great Bow ordinary', () => {
    const shot = shoot(field(), FROST_GIANT, 'Great Bow');
    expect(shot.attack?.hit).toBe(false);
    expect(shot.attack?.autoMissed).toContain('Wind Wall');
    expect(shot.unverified.some((line) => line.includes('Wind Wall'))).toBe(false);
  });

  it('still reports a line a table leaves out, and rolls it', () => {
    const state = field();
    const short = unwrap(
      createContent({
        ...SRD_CONTENT_INPUT,
        rangedLines: SRD_CONTENT_INPUT.rangedLines.filter((row) => row.id !== 'great-bow'),
      }),
      'a table without the Great Bow',
    );
    const shot = unwrap(
      resolveAttack(
        state,
        FROST_GIANT,
        { target: FIGHTER, weapon: null, action: 'Great Bow' },
        { ...supply(state), content: short },
      ),
      'Great Bow',
    );
    expect(shot.attack?.autoMissed ?? null).toBeNull();
    expect(shot.unverified.some((line) => line.includes('Wind Wall'))).toBe(true);
  });
});
