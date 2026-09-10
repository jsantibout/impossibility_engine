import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEquipment, type Armor } from '@ie/srd';
import type { AbilityScores, CharacterSheet } from './character.js';
import {
  abilityModifier,
  armorClass,
  initiativeModifier,
  passivePerception,
  proficiencyBonus,
  proficiencyBonusForLevel,
  saveModifier,
  skillModifier,
  speed,
  spellAttackModifier,
  spellSaveDc,
  stealthRollMode,
  untrainedArmorPenalty,
} from './character.js';

const scores = (overrides: Partial<AbilityScores> = {}): AbilityScores => ({
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
  ...overrides,
});

const armorFixture = (over: Partial<Armor> = {}): Armor => ({
  id: 'test-armor',
  name: 'Test Armor',
  category: 'light',
  baseAc: 11,
  acBonus: null,
  addsDexModifier: true,
  maxDexBonus: null,
  strengthRequirement: null,
  stealthDisadvantage: false,
  weightLb: 10,
  cost: { amount: 10, currency: 'gp' },
  ...over,
});

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 1,
  abilities: scores(),
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

describe('abilityModifier', () => {
  // Verified against the "Ability Scores and Modifiers" table in the SRD:
  // every score from 3 to 20 matches floor((score - 10) / 2).
  it.each([
    [1, -5],
    [3, -4],
    [8, -1],
    [9, -1],
    [10, 0],
    [11, 0],
    [12, 1],
    [15, 2],
    [20, 5],
    [30, 10],
  ])('score %i has modifier %i', (score, expected) => {
    expect(abilityModifier(score)).toBe(expected);
  });

  it('rounds down for odd scores, including negatives', () => {
    expect(abilityModifier(7)).toBe(-2);
    expect(abilityModifier(6)).toBe(-2);
    expect(abilityModifier(5)).toBe(-3);
  });
});

describe('proficiencyBonusForLevel', () => {
  it.each([
    [1, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [12, 4],
    [13, 5],
    [16, 5],
    [17, 6],
    [20, 6],
  ])('level %i has bonus +%i', (level, expected) => {
    expect(proficiencyBonusForLevel(level)).toBe(expected);
  });

  it('never drops below +2 or exceeds +6 across the whole range', () => {
    for (let level = 1; level <= 20; level++) {
      const bonus = proficiencyBonusForLevel(level);
      expect(bonus).toBeGreaterThanOrEqual(2);
      expect(bonus).toBeLessThanOrEqual(6);
    }
  });

  it('reads the level off the sheet', () => {
    expect(proficiencyBonus(sheet({ level: 9 }))).toBe(4);
  });
});

describe('saveModifier', () => {
  it('is the bare ability modifier without proficiency', () => {
    expect(saveModifier(sheet({ abilities: scores({ con: 16 }) }), 'con')).toBe(3);
  });

  it('adds the proficiency bonus when proficient', () => {
    const s = sheet({
      level: 5,
      abilities: scores({ con: 16 }),
      saveProficiencies: ['con'],
    });
    expect(saveModifier(s, 'con')).toBe(3 + 3);
  });

  it('does not add proficiency to a save the character lacks', () => {
    const s = sheet({ level: 5, saveProficiencies: ['con'] });
    expect(saveModifier(s, 'dex')).toBe(0);
  });
});

describe('skillModifier', () => {
  it('uses the ability that governs the skill', () => {
    // Athletics is Strength, Stealth is Dexterity.
    const s = sheet({ abilities: scores({ str: 18, dex: 8 }) });
    expect(skillModifier(s, 'athletics')).toBe(4);
    expect(skillModifier(s, 'stealth')).toBe(-1);
  });

  it('adds the proficiency bonus once when proficient', () => {
    const s = sheet({
      level: 5,
      abilities: scores({ dex: 16 }),
      skills: { stealth: 'proficient' },
    });
    expect(skillModifier(s, 'stealth')).toBe(3 + 3);
  });

  it('adds the proficiency bonus twice for expertise', () => {
    const s = sheet({
      level: 5,
      abilities: scores({ dex: 16 }),
      skills: { stealth: 'expertise' },
    });
    expect(skillModifier(s, 'stealth')).toBe(3 + 6);
  });

  it('treats an explicit "none" the same as being absent', () => {
    const s = sheet({ level: 5, abilities: scores({ dex: 16 }), skills: { stealth: 'none' } });
    expect(skillModifier(s, 'stealth')).toBe(3);
  });
});

describe('armorClass', () => {
  it('is 10 + Dex with no armor', () => {
    expect(armorClass(sheet({ abilities: scores({ dex: 16 }) }))).toBe(13);
  });

  it('can drop below 10 with a negative Dex modifier', () => {
    expect(armorClass(sheet({ abilities: scores({ dex: 6 }) }))).toBe(8);
  });

  it('adds the full Dex modifier in light armor', () => {
    const s = sheet({
      abilities: scores({ dex: 18 }),
      armor: armorFixture({ category: 'light', baseAc: 12 }),
    });
    expect(armorClass(s)).toBe(12 + 4);
  });

  it('caps the Dex modifier in medium armor', () => {
    const s = sheet({
      abilities: scores({ dex: 18 }),
      armor: armorFixture({ category: 'medium', baseAc: 14, maxDexBonus: 2 }),
    });
    expect(armorClass(s)).toBe(14 + 2);
  });

  it('does not apply the cap when the Dex modifier is under it', () => {
    const s = sheet({
      abilities: scores({ dex: 12 }),
      armor: armorFixture({ category: 'medium', baseAc: 14, maxDexBonus: 2 }),
    });
    expect(armorClass(s)).toBe(14 + 1);
  });

  it('still applies a negative Dex modifier under a cap', () => {
    const s = sheet({
      abilities: scores({ dex: 6 }),
      armor: armorFixture({ category: 'medium', baseAc: 14, maxDexBonus: 2 }),
    });
    expect(armorClass(s)).toBe(14 - 2);
  });

  it('ignores Dex entirely in heavy armor', () => {
    const s = sheet({
      abilities: scores({ dex: 18 }),
      armor: armorFixture({ category: 'heavy', baseAc: 18, addsDexModifier: false }),
    });
    expect(armorClass(s)).toBe(18);
  });

  it('adds a shield on top', () => {
    const s = sheet({
      abilities: scores({ dex: 14 }),
      shield: armorFixture({ category: 'shield', baseAc: null, acBonus: 2, addsDexModifier: false }),
    });
    expect(armorClass(s)).toBe(10 + 2 + 2);
  });

  it('grants no shield bonus without shield training', () => {
    const s = sheet({
      shield: armorFixture({ category: 'shield', baseAc: null, acBonus: 2, addsDexModifier: false }),
      armorTraining: { light: true, medium: true, heavy: true, shields: false },
    });
    expect(armorClass(s)).toBe(10);
  });

  it('rejects body armor in the shield slot as programmer error', () => {
    const s = sheet({ shield: armorFixture({ category: 'light' }) });
    expect(() => armorClass(s)).toThrow(/shield/i);
  });

  it('rejects a shield in the body armor slot as programmer error', () => {
    const s = sheet({ armor: armorFixture({ category: 'shield', baseAc: null, acBonus: 2 }) });
    expect(() => armorClass(s)).toThrow(/armor/i);
  });
});

describe('speed', () => {
  it('is the base speed with no armor', () => {
    expect(speed(sheet())).toBe(30);
  });

  it('drops by 10 when Strength is below the armor requirement', () => {
    const s = sheet({
      abilities: scores({ str: 13 }),
      armor: armorFixture({ category: 'heavy', strengthRequirement: 15 }),
    });
    expect(speed(s)).toBe(20);
  });

  it('is unreduced when Strength exactly meets the requirement', () => {
    const s = sheet({
      abilities: scores({ str: 15 }),
      armor: armorFixture({ category: 'heavy', strengthRequirement: 15 }),
    });
    expect(speed(s)).toBe(30);
  });

  it('compares the score, not the modifier', () => {
    // Str 14 and 15 share a +2 modifier but differ against a Str 15 requirement.
    const armor = armorFixture({ category: 'heavy', strengthRequirement: 15 });
    expect(speed(sheet({ abilities: scores({ str: 14 }), armor }))).toBe(20);
    expect(speed(sheet({ abilities: scores({ str: 15 }), armor }))).toBe(30);
  });

  it('never goes negative', () => {
    const s = sheet({
      baseSpeed: 5,
      abilities: scores({ str: 8 }),
      armor: armorFixture({ category: 'heavy', strengthRequirement: 15 }),
    });
    expect(speed(s)).toBe(0);
  });
});

describe('stealthRollMode', () => {
  it('is normal without armor', () => {
    expect(stealthRollMode(sheet())).toBe('normal');
  });

  it('is disadvantage in armor that says so', () => {
    const s = sheet({ armor: armorFixture({ stealthDisadvantage: true }) });
    expect(stealthRollMode(s)).toBe('disadvantage');
  });
});

describe('untrainedArmorPenalty', () => {
  it('is false when trained in the armor being worn', () => {
    expect(untrainedArmorPenalty(sheet({ armor: armorFixture({ category: 'heavy' }) }))).toBe(false);
  });

  it('is true when wearing armor the character lacks training in', () => {
    const s = sheet({
      armor: armorFixture({ category: 'heavy' }),
      armorTraining: { light: true, medium: true, heavy: false, shields: true },
    });
    expect(untrainedArmorPenalty(s)).toBe(true);
  });

  it('is false when wearing nothing, whatever the training', () => {
    const s = sheet({
      armorTraining: { light: false, medium: false, heavy: false, shields: false },
    });
    expect(untrainedArmorPenalty(s)).toBe(false);
  });
});

describe('passivePerception', () => {
  it('matches the SRD worked example: Wis 15 with proficiency at level 1 is 14', () => {
    const s = sheet({ abilities: scores({ wis: 15 }), skills: { perception: 'proficient' } });
    expect(passivePerception(s)).toBe(14);
  });

  it('is 10 plus the bare Wisdom modifier without proficiency', () => {
    expect(passivePerception(sheet({ abilities: scores({ wis: 15 }) }))).toBe(12);
  });

  it('adds 5 with advantage and subtracts 5 with disadvantage', () => {
    const s = sheet({ abilities: scores({ wis: 15 }), skills: { perception: 'proficient' } });
    expect(passivePerception(s, 'advantage')).toBe(19);
    expect(passivePerception(s, 'disadvantage')).toBe(9);
  });
});

describe('spellcasting', () => {
  it('has no save DC or attack bonus without a spellcasting ability', () => {
    expect(spellSaveDc(sheet())).toBeNull();
    expect(spellAttackModifier(sheet())).toBeNull();
  });

  it('computes the save DC as 8 + proficiency + ability modifier', () => {
    const s = sheet({ level: 5, abilities: scores({ int: 18 }), spellcastingAbility: 'int' });
    expect(spellSaveDc(s)).toBe(8 + 3 + 4);
  });

  it('computes the attack modifier as proficiency + ability modifier', () => {
    const s = sheet({ level: 5, abilities: scores({ int: 18 }), spellcastingAbility: 'int' });
    expect(spellAttackModifier(s)).toBe(3 + 4);
  });
});

describe('initiativeModifier', () => {
  it('is the Dexterity modifier', () => {
    expect(initiativeModifier(sheet({ abilities: scores({ dex: 18 }) }))).toBe(4);
  });
});

// Proves the engine and the SRD parser agree on shape and values end to end.
// A schema drift between the two packages would show up here first.
describe('against real SRD armor', () => {
  const markdown = readFileSync(
    fileURLToPath(new URL('../../srd/raw/equipment.md', import.meta.url)),
    'utf8',
  );
  const { armor } = parseEquipment(markdown, 'equipment.md');
  const find = (id: string): Armor => {
    const found = armor.find((a) => a.id === id);
    if (!found) throw new Error(`fixture missing: ${id}`);
    return found;
  };

  it('gives Plate Armor AC 18 regardless of Dexterity', () => {
    const s = sheet({ abilities: scores({ dex: 18, str: 15 }), armor: find('plate-armor') });
    expect(armorClass(s)).toBe(18);
  });

  it('gives Plate Armor plus a Shield AC 20', () => {
    const s = sheet({
      abilities: scores({ str: 15 }),
      armor: find('plate-armor'),
      shield: find('shield'),
    });
    expect(armorClass(s)).toBe(20);
  });

  it('caps Half Plate at 15 + 2 for a high-Dex character', () => {
    const s = sheet({ abilities: scores({ dex: 20 }), armor: find('half-plate-armor') });
    expect(armorClass(s)).toBe(17);
  });

  it('gives Leather Armor the full Dex modifier', () => {
    const s = sheet({ abilities: scores({ dex: 16 }), armor: find('leather-armor') });
    expect(armorClass(s)).toBe(14);
  });

  it('slows a Strength 12 character wearing Plate', () => {
    const s = sheet({ abilities: scores({ str: 12 }), armor: find('plate-armor') });
    expect(speed(s)).toBe(20);
  });

  it('gives disadvantage on Stealth in Plate but not in Leather', () => {
    expect(stealthRollMode(sheet({ armor: find('plate-armor') }))).toBe('disadvantage');
    expect(stealthRollMode(sheet({ armor: find('leather-armor') }))).toBe('normal');
  });
});
