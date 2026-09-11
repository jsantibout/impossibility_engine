import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass, proficiencyBonusForLevel } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { carrying, coinsOf } from './commands.js';
import { goldToCopper, itemFor } from './catalogue.js';
import { CHAMPION, FIGHTER } from './fighter.js';
import { cumulativeFeatures } from './progression.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';

/**
 * A class that does not cast, which nothing had ever been.
 *
 * Two casters proved the spell rules; neither proved what happens without
 * them. `spellcasting?: undefined` was a branch the types allowed and no test
 * had walked — no cantrips, no prepared list, no slots, no spellbook, and a
 * table with no spell columns at all.
 *
 * The other two firsts: three equipment packages rather than two, and a
 * Fighting Style feat, whose category had existed on `FeatDefinition` since it
 * was written with nothing in it.
 */

const id = (s: string) => asCharacterId(s);
const ROENA = id('roena');

const fighter = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Roena',
  classId: 'fighter',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  // Sage offers Constitution, Intelligence and Wisdom — not Strength.
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'intimidation'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral Good',
  subclassId: 'champion',
  // A Fighter has none of these, and says so by having none.
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-mail'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const made = (over: Partial<CharacterChoices> = {}): GameEvent[] =>
  unwrap(createCharacter(fighter(over), ROENA), 'create');

const built = (over: Partial<CharacterChoices> = {}): GameState => fold('seed', made(over));

const rejects = (over: Partial<CharacterChoices>, code: string): void => {
  const result = planCharacter(fighter(over));
  expect(isErr(result)).toBe(true);
  if (isErr(result)) expect(result.code).toBe(code);
};

describe('the Fighter table agrees with the engine', () => {
  it('prints the Proficiency Bonus the formula gives', () => {
    for (const row of FIGHTER.table) {
      expect(row.proficiencyBonus).toBe(proficiencyBonusForLevel(row.level));
    }
  });

  it('runs from level 1 to 20 with no gaps', () => {
    expect(FIGHTER.table.map((r) => r.level)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  /**
   * A Fighter does not know zero cantrips: a Fighter has no cantrips. Absent
   * rather than zero, so nothing can read a count off a class that has none.
   */
  it('has no spell columns at all', () => {
    for (const row of FIGHTER.table) {
      expect(row.cantripsKnown).toBeUndefined();
      expect(row.preparedSpells).toBeUndefined();
      expect(row.spellSlots).toBeUndefined();
    }
    expect(FIGHTER.spellcasting).toBeUndefined();
  });

  it('explains every feature it does not execute', () => {
    for (const feature of [...FIGHTER.features, ...CHAMPION.features]) {
      expect(feature.note.length).toBeGreaterThan(20);
    }
  });

  it('grants the level 3 features and not the level 5 ones', () => {
    const at3 = cumulativeFeatures(FIGHTER, 3).map((f) => f.id);
    expect(at3).toContain('fighter:fighting-style');
    expect(at3).toContain('fighter:second-wind');
    expect(at3).toContain('fighter:action-surge');
    expect(at3).toContain('fighter:subclass');
    expect(at3).not.toContain('fighter:extra-attack');
  });
});

describe('a Fighter is made without any spellcasting at all', () => {
  it('plans with no cantrips, no prepared spells and no slots', () => {
    const plan = unwrap(planCharacter(fighter()), 'plan');
    expect(plan.spellcasting.classes).toEqual([]);
    
    expect(plan.spellSlots).toEqual({});
  });

  /**
   * The feat still grants what it grants. Magic Initiate on a Fighter is a
   * character who can cast two cantrips and knows no class spells at all,
   * which is exactly the case the granted-spell route was built for.
   */
  it('still carries a feat’s granted spells', () => {
    const plan = unwrap(planCharacter(fighter()), 'plan');
    expect(plan.spellcasting.granted.map((g) => g.spellId)).toContain('ray-of-frost');
    // And the feat brings its own ability, not the class's — a Fighter has none.
    expect(plan.spellcasting.granted[0]?.ability).toBe('int');
    expect(plan.sheet.spellcastingAbility).toBeNull();
  });

  it('refuses a cantrip a Fighter cannot know', () => {
    rejects({ cantrips: ['fire-bolt'] }, 'no_spellcasting');
  });

  it('refuses a spellbook, which no Fighter has', () => {
    rejects(
      { spellbook: [{ spellId: 'magic-missile', acquiredAt: 1, origin: 'level' }] },
      'no_spellbook',
    );
  });
});

describe('three equipment packages, not two', () => {
  it('takes package A, opened', () => {
    const state = built();
    const held = carrying(state, ROENA).map((line) => line.id);
    expect(held).toContain('chain-mail');
    expect(held).toContain('greatsword');
    expect(carrying(state, ROENA)).toContainEqual({ id: 'javelin', quantity: 8 });
    // The Dungeoneer's Pack is opened like any other.
    expect(held).toContain('crowbar');
    // 4 GP from the Fighter package, 8 from Sage.
    expect(coinsOf(state, ROENA)).toBe(goldToCopper(12));
  });

  it('takes package B, with its ammunition counted as arrows', () => {
    const state = built({ classEquipment: 'B', equipped: ['studded-leather-armor'] });
    expect(carrying(state, ROENA)).toContainEqual({ id: 'arrows', quantity: 20 });
    expect(coinsOf(state, ROENA)).toBe(goldToCopper(11 + 8));
  });

  it('takes package C, which is money and nothing else', () => {
    const state = built({ classEquipment: 'C', equipped: [] });
    expect(coinsOf(state, ROENA)).toBe(goldToCopper(155 + 8));
    expect(carrying(state, ROENA).map((l) => l.id)).not.toContain('chain-mail');
  });

  it('refuses a package that is not on offer', () => {
    rejects({ classEquipment: 'D', equipped: [] }, 'unknown_equipment_option');
  });

  /** SRD prices Arrows at 1 GP for 20, so one arrow is 5 copper. */
  it('prices ammunition by the round rather than by the bundle', () => {
    const arrows = itemFor('arrows');
    expect(arrows?.kind).toBe('ammunition');
    expect(arrows?.costCp).toBe(5);
    expect(arrows?.bundleSize).toBe(20);
  });
});

describe('a Fighter wears the heaviest armour in the book', () => {
  /** SRD Chain Mail is a flat 16, adding no Dexterity at all. */
  it('derives Armour Class from Chain Mail with no Dexterity', () => {
    const sheet = built().creatures.roena!.sheet;
    expect(sheet.armor?.name).toBe('Chain Mail');
    expect(armorClass(sheet)).toBe(16);
  });

  /**
   * SRD Chain Mail requires Strength 13, and this Fighter has 17 after their
   * origin increase — so no Speed penalty. The rule reads the *score*.
   */
  it('meets the armour’s Strength requirement', () => {
    const sheet = built().creatures.roena!.sheet;
    expect(sheet.abilities.str).toBeGreaterThanOrEqual(sheet.armor?.strengthRequirement ?? 0);
  });
});

describe('a Fighting Style is a feat, from the Fighting Style list', () => {
  it('takes one of the four the SRD publishes', () => {
    const plan = unwrap(planCharacter(fighter()), 'plan');
    expect(plan.feats).toContain('Defense (fighter:fighting-style)');
  });

  /** The category is what the prerequisite comes to: Alert is not a Style. */
  it('refuses an Origin feat as a Fighting Style', () => {
    rejects(
      {
        feats: {
          ...fighter().feats,
          'fighter:fighting-style': { featId: 'alert' },
        },
      },
      'wrong_feat_category',
    );
  });

  it('refuses a Fighting Style nobody has heard of', () => {
    rejects(
      {
        feats: {
          ...fighter().feats,
          'fighter:fighting-style': { featId: 'blade-dancing' },
        },
      },
      'unknown_feat',
    );
  });
});

describe('a Fighter is a creature the rest of the engine accepts', () => {
  it('folds, survives JSON, and replays prefix by prefix', () => {
    const log = made();
    const state = fold('seed', log);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('has hit points from a d10 rather than a d6', () => {
    const plan = unwrap(planCharacter(fighter()), 'plan');
    // Level 3, d10, Constitution 16 (+3): 10 + 6 + 6 + 3×3 = 31.
    expect(plan.hitPointMaximum).toBe(31);
  });
});
