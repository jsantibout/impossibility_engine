/**
 * SRD Wild Shape keeps only what its retained list names (owner, 2026-09-27).
 *
 * > "Your game statistics are replaced by the Beast's stat block, but you
 * > retain your creature type; Hit Points; Hit Point Dice; Intelligence,
 * > Wisdom, and Charisma scores; class features; languages; and feats."
 *
 * W8-S25 read that sentence for senses alone: a Dwarf's Darkvision is replaced
 * by the wolf's. The owner read it whole, so **every** species trait's standing
 * effect is set aside in a form — Dwarven Resilience's Poison Resistance with
 * it — and comes back with the Druid's own sheet. What the list does name
 * stays: the Hit Points (Dwarven Toughness is a hit-point-maximum grant on the
 * creature's vitals, not a standing effect on the sheet, so nothing here
 * reaches it) and a feat, even one a species trait granted.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterChoices } from './creation.js';
import { createCharacter } from './creation.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { sheetAsItStands, standingDefenses } from './standing.js';
import { assumeShape, revertShape } from './commands.js';

const DRUID: CharacterId = asCharacterId('fenn');
const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

/** `wild-shape.test.ts`'s level 5 Druid, born a Dwarf. */
const dwarf = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Fenn',
  classId: 'druid',
  level: 5,
  subclassId: 'circle-of-the-land',
  speciesId: 'dwarf',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['nature', 'perception'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral',
  cantrips: ['druidcraft', 'guidance', 'shillelagh'],
  spellbook: [],
  preparedSpells: [
    'aid',
    'barkskin',
    'call-lightning',
    'cure-wounds',
    'dispel-magic',
    'faerie-fire',
    'fog-cloud',
    'goodberry',
    'healing-word',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'druid:primal-order': ['Magician'],
    'druid:primal-order:cantrip': ['mending'],
  },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
    'druid:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['wis', 'wis'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
  knownForms: ['wolf', 'rat', 'spider', 'riding-horse'],
  ...over,
});

/** The same Druid born Human, whose Versatile took Savage Attacker. */
const human = (): CharacterChoices => {
  const base = dwarf();
  return {
    ...base,
    speciesId: 'human',
    featureChoices: { ...base.featureChoices, 'human:skillful': ['acrobatics'] },
    feats: { ...base.feats, 'human:versatile': { featId: 'savage-attacker' } },
  };
};

const made = (choices: CharacterChoices): GameEvent[] => {
  const result = createCharacter(SRD_CONTENT, choices, DRUID);
  if (!result.ok) throw new Error(`${result.code} — ${result.reason}`);
  return [...result.value];
};

const shifted = (log: readonly GameEvent[]): GameEvent[] => [
  ...log,
  ...must(
    assumeShape(fold('retains', log) as GameState, DRUID, { feature: 'druid:wild-shape', form: 'wolf' }, SRD_CONTENT),
    'Wild Shape',
  ),
];

const reverted = (log: readonly GameEvent[]): GameEvent[] => [
  ...log,
  ...must(revertShape(fold('retains', log) as GameState, DRUID, {}), 'revert'),
];

const poisonResistant = (state: GameState): boolean =>
  standingDefenses(state, DRUID)['poison']?.resistant === true;

const standingFeatures = (state: GameState): readonly string[] =>
  (sheetAsItStands(state, DRUID)?.standing ?? []).map((effect) => effect.feature);

describe('a Dwarf Druid in a Wolf’s shape', () => {
  it('has no Poison Resistance in the form, and has it back on reverting', () => {
    const before = made(dwarf());
    expect(poisonResistant(fold('retains', before) as GameState)).toBe(true);

    const wolf = shifted(before);
    const inForm = fold('retains', wolf) as GameState;
    expect(poisonResistant(inForm)).toBe(false);
    // Nor the other half of Dwarven Resilience, nor anything else a species
    // trait gave the sheet.
    expect(standingFeatures(inForm).filter((feature) => feature.startsWith('dwarf:'))).toEqual([]);

    const back = fold('retains', reverted(wolf)) as GameState;
    expect(poisonResistant(back)).toBe(true);
    expect(standingFeatures(back)).toContain('dwarf:dwarven-resilience');
  });

  it('keeps its Hit Points, Dwarven Toughness and all, through the shape and back', () => {
    const before = made(dwarf());
    const hpOf = (state: GameState) => {
      const vitals = state.creatures[DRUID]!.vitals;
      return { hp: vitals.hp, hpMax: vitals.hpMax };
    };
    const own = hpOf(fold('retains', before) as GameState);
    // The trait is on the maximum: a Human Druid of the same scores has five
    // fewer, one a level.
    expect(own.hpMax - hpOf(fold('retains', made(human())) as GameState).hpMax).toBe(5);

    const wolf = shifted(before);
    expect(hpOf(fold('retains', wolf) as GameState)).toEqual(own);
    expect(hpOf(fold('retains', reverted(wolf)) as GameState)).toEqual(own);
  });
});

describe('a feat a species granted', () => {
  it('is a feat, and a feat is retained', () => {
    const before = made(human());
    expect(standingFeatures(fold('retains', before) as GameState)).toContain('savage-attacker');

    const inForm = fold('retains', shifted(before)) as GameState;
    expect(standingFeatures(inForm)).toContain('savage-attacker');
  });
});
