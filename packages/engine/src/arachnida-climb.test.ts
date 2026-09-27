import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { itemStandingEffects } from './catalogue.js';
import { fold, type GameEvent } from './events.js';
import { speedOf } from './standing.js';
import { equipItem } from './commands.js';

/**
 * SRD Cloak of Arachnida: "_Spider Climb._ You have a Climb Speed equal to
 * your Speed and can move up, down, and across vertical surfaces and along
 * ceilings, while leaving your hands free." (W9-T)
 *
 * The Slippers of Spider Climbing's sentence, without the slippers' slippery
 * surface: a `match-walk` climb, read through the attunement bracket the
 * cloak's Poison Resistance already sits behind. The walls and ceilings stay
 * the debt they are for the slippers and for SRD Spider Climb.
 */

const WEARER = asCharacterId('wearer');
const CLOAK = 'cloak-of-arachnida';

const sheet: CharacterSheet = {
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
};

const TABLE: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: WEARER,
    name: 'wearer',
    sheet,
    maxHp: 30,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  { type: 'items-gained', id: WEARER, items: [{ id: CLOAK, quantity: 1 }], source: 'the test' },
];

const worn: readonly GameEvent[] = [
  ...TABLE,
  ...unwrap(equipItem(fold('seed', TABLE), SRD_CONTENT, WEARER, CLOAK), 'the cloak'),
];

const attuned: readonly GameEvent[] = [
  ...worn,
  { type: 'attuned', id: WEARER, item: CLOAK, grants: itemStandingEffects(SRD_CONTENT.item(CLOAK)!) },
];

describe('SRD Cloak of Arachnida’s Spider Climb', () => {
  it('climbs at the walking Speed, worn and attuned', () => {
    expect(speedOf(fold('seed', attuned), WEARER, 'climb')).toBe(30);
    expect(speedOf(fold('seed', attuned), WEARER, 'swim')).toBe(0);
  });

  it('climbs at nothing while worn and not attuned', () => {
    expect(speedOf(fold('seed', worn), WEARER, 'climb')).toBe(0);
  });

  it('owes the walls and ceilings and no longer the Climb Speed', () => {
    const owed = SRD_CONTENT.item(CLOAK)?.unmodelled ?? [];
    expect(owed.some((note) => note.includes('vertical surfaces and along ceilings'))).toBe(true);
    expect(owed.some((note) => note.includes('not yet written on this cloak'))).toBe(false);
  });
});
