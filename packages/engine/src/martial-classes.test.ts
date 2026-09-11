import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { carrying } from './commands.js';
import { BARBARIAN, RAGES_PER_REST, RAGE_DAMAGE } from './barbarian.js';
import { FOCUS_POINTS, MARTIAL_ARTS_DIE, MONK, UNARMORED_MOVEMENT } from './monk.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';

/**
 * The Barbarian and the Monk, which are the same class twice in the one place
 * the engine cannot yet go.
 *
 * Both have **Unarmoured Defense** and both compute Armour Class a way the
 * engine has no room for — 10 + Dexterity + Constitution for one, 10 +
 * Dexterity + Wisdom for the other. Two classes wanting the same missing hook
 * is worth more than one wanting it: it says the gap is a *shape*, a class
 * feature that replaces the Armour Class calculation, rather than a quirk of
 * whichever class arrived first.
 *
 * Everything else about them is transcription onto structures with several
 * users each, so what is tested here is the growth tables — the part a
 * transcription actually gets wrong — and that the shared suite in
 * `progression.test.ts` covers the rest.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');
const SHAN = id('shan');

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  backgroundEquipment: 'A' as const,
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
};

const originFeats = {
  'sage:magic-initiate-wizard': {
    featId: 'magic-initiate',
    spellList: 'wizard',
    spellcastingAbility: 'int' as const,
    cantrips: ['mage-hand', 'light'],
    levelOneSpell: 'find-familiar',
  },
  'human:versatile': { featId: 'alert' },
};

const barbarian = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Grum',
  classId: 'barbarian',
  level: 3,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  subclassId: 'path-of-the-berserker',
  classEquipment: 'A',
  equipped: [],
  featureChoices: {
    'human:skillful': ['perception'],
    'barbarian:primal-knowledge': ['intimidation'],
  },
  feats: originFeats,
  ...over,
});

const monk = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Shan',
  classId: 'monk',
  level: 5,
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['acrobatics', 'stealth'],
  subclassId: 'warrior-of-the-open-hand',
  classEquipment: 'A',
  equipped: [],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: { ...originFeats, 'monk:ability-score-improvement': { featId: 'savage-attacker' } },
  ...over,
});

const built = (choices: CharacterChoices, who: ReturnType<typeof id>): GameState =>
  fold('seed', unwrap(createCharacter(choices, who), 'create') as GameEvent[]);

describe('the Barbarian', () => {
  /** SRD: 2 Rages at level 1, rising to 6 at 17; damage +2 to +4. */
  it('grows its Rage table the way the SRD prints it', () => {
    expect(RAGES_PER_REST[0]).toBe(2);
    expect(RAGES_PER_REST[19]).toBe(6);
    expect(RAGE_DAMAGE[0]).toBe(2);
    expect(RAGE_DAMAGE[19]).toBe(4);
    for (let i = 1; i < RAGES_PER_REST.length; i += 1) {
      expect(RAGES_PER_REST[i] ?? 0).toBeGreaterThanOrEqual(RAGES_PER_REST[i - 1] ?? 0);
      expect(RAGE_DAMAGE[i] ?? 0).toBeGreaterThanOrEqual(RAGE_DAMAGE[i - 1] ?? 0);
    }
  });

  it('casts nothing and has the biggest hit die in the game', () => {
    expect(BARBARIAN.spellcasting).toBeUndefined();
    expect(BARBARIAN.hitDie).toBe(12);
    const plan = unwrap(planCharacter(barbarian()), 'plan');
    // Level 3, d12, Constitution 16 (+3): 12 + 7 + 7 + 3×3 = 35.
    expect(plan.hitPointMaximum).toBe(35);
  });

  /** SRD Primal Knowledge: one more skill from the class's own list. */
  it('takes an extra skill proficiency at level 3', () => {
    const plan = unwrap(planCharacter(barbarian()), 'plan');
    expect(plan.sheet.skills.intimidation).toBe('proficient');
  });

  it('refuses a Primal Knowledge skill the class does not offer', () => {
    const result = planCharacter(
      barbarian({
        featureChoices: {
          'human:skillful': ['perception'],
          'barbarian:primal-knowledge': ['arcana'],
        },
      }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('skill_not_offered');
  });

  it('starts with the package the SRD prints', () => {
    const held = carrying(built(barbarian(), GRUM), GRUM).map((line) => line.id);
    expect(held).toContain('greataxe');
    expect(carrying(built(barbarian(), GRUM), GRUM)).toContainEqual({
      id: 'handaxe',
      quantity: 4,
    });
  });
});

describe('the Monk', () => {
  /** SRD Martial Arts: 1d6 to 1d12, stepping at levels 5, 11 and 17. */
  it('grows its Martial Arts die at the levels the SRD prints', () => {
    expect(MARTIAL_ARTS_DIE[0]).toBe('1d6');
    expect(MARTIAL_ARTS_DIE[4]).toBe('1d8');
    expect(MARTIAL_ARTS_DIE[10]).toBe('1d10');
    expect(MARTIAL_ARTS_DIE[16]).toBe('1d12');
  });

  /** SRD: Focus Points equal Monk level, and there are none before level 2. */
  it('has no Focus Points at level 1 and its level thereafter', () => {
    expect(FOCUS_POINTS[0]).toBe(0);
    for (let level = 2; level <= 20; level += 1) {
      expect(FOCUS_POINTS[level - 1]).toBe(level);
    }
  });

  /** SRD Unarmored Movement: nothing at 1, +10 at 2, rising to +30 at 18. */
  it('grows Unarmoured Movement the way the SRD prints it', () => {
    expect(UNARMORED_MOVEMENT[0]).toBe(0);
    expect(UNARMORED_MOVEMENT[1]).toBe(10);
    expect(UNARMORED_MOVEMENT[19]).toBe(30);
  });

  it('casts nothing, and wears nothing', () => {
    expect(MONK.spellcasting).toBeUndefined();
    expect(MONK.armorTraining).toEqual({
      light: false,
      medium: false,
      heavy: false,
      shields: false,
    });
  });

  it('starts with the package the SRD prints', () => {
    const carried = carrying(built(monk(), SHAN), SHAN);
    expect(carried).toContainEqual({ id: 'dagger', quantity: 5 });
    expect(carried.map((l) => l.id)).toContain('spear');
  });
});

describe('two classes want the same missing hook', () => {
  /**
   * Neither Unarmoured Defense is applied, and the two formulas differ, which
   * is what makes this a shape rather than a quirk. Both characters end up on
   * the plain unarmoured Armour Class: 10 + Dexterity.
   */
  it('leaves both on 10 + Dexterity, and says so in the feature', () => {
    const grum = built(barbarian(), GRUM).creatures.grum!.sheet;
    const shan = built(monk(), SHAN).creatures.shan!.sheet;

    expect(grum.armor).toBeNull();
    expect(shan.armor).toBeNull();
    // Dexterity 13 is +1; Dexterity 15 is +2.
    expect(armorClass(grum)).toBe(11);
    expect(armorClass(shan)).toBe(12);

    const barbarianFeature = BARBARIAN.features.find((f) => f.id === 'barbarian:unarmored-defense');
    const monkFeature = MONK.features.find((f) => f.id === 'monk:unarmored-defense');
    expect(barbarianFeature?.automation).toBe('manual');
    expect(monkFeature?.automation).toBe('manual');
    expect(barbarianFeature?.note).toContain('Constitution');
    expect(monkFeature?.note).toContain('Wisdom');
  });
});
