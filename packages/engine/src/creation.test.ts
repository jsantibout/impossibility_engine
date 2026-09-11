import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass, skillModifier, spellSaveDc } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { hitDieKey } from './rest.js';
import {
  advanceCharacter,
  checkCharacter,
  createCharacter,
  planCharacter,
  type CharacterChoices,
} from './creation.js';

const id = (s: string) => asCharacterId(s);

/** Ten spells: six written at level 1, two more for each level after. */
const BOOK = [
  'Magic Missile',
  'Shield',
  'Detect Magic',
  'Feather Fall',
  'Mage Armor',
  'Sleep',
  'Thunderwave',
  'Charm Person',
  'Misty Step',
  'Web',
] as const;

/**
 * A complete, legal level 3 Wizard: Human, Sage, standard array, Evoker.
 * Every test below either uses this or breaks exactly one thing in it, so a
 * failure names the rule it broke rather than a pile of unrelated problems.
 */
type Overrides = Partial<CharacterChoices>;

const kessa = (over: Overrides = {}): CharacterChoices => ({
  name: 'Kessa',
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  // Sage offers Constitution, Intelligence and Wisdom.
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  subclassId: 'evoker',
  cantrips: ['Fire Bolt', 'Light', 'Prestidigitation'],
  spellbook: [
    'Magic Missile',
    'Shield',
    'Detect Magic',
    'Feather Fall',
    'Mage Armor',
    'Sleep',
    'Thunderwave',
    'Charm Person',
    'Misty Step',
    'Web',
  ],
  preparedSpells: ['Magic Missile', 'Shield', 'Mage Armor', 'Sleep', 'Burning Hands', 'Scorching Ray'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'human:versatile': ['Skilled'],
    'evoker:evocation-savant': ['Burning Hands', 'Scorching Ray'],
  },
  ...over,
});

const planned = (over: Overrides = {}) =>
  unwrap(planCharacter(kessa(over)), 'plan');

const built = (over: Overrides = {}): GameState => {
  const events = unwrap(createCharacter(kessa(over), id('kessa')), 'create');
  return fold('seed', events);
};

describe('a level 3 Wizard, made from choices', () => {
  it('derives the ability scores the origin raised', () => {
    const sheet = planned().sheet;
    // 15 base, +2 from Sage.
    expect(sheet.abilities.int).toBe(17);
    expect(sheet.abilities.con).toBe(14);
    // Untouched by the background.
    expect(sheet.abilities.dex).toBe(14);
    expect(sheet.abilities.str).toBe(8);
  });

  it('carries the level and its Proficiency Bonus', () => {
    expect(planned().sheet.level).toBe(3);
    expect(planned().proficiencyBonus).toBe(2);
  });

  /** SRD: level 1 gives the maximum die; later levels the fixed value or a roll. */
  it('adds up hit points from the class hit die and Constitution', () => {
    // d6 Wizard, Con +2: 6+2 at level 1, then 4+2 twice.
    expect(planned().hitPointMaximum).toBe(8 + 6 + 6);
    expect(built().creatures.kessa?.vitals.hpMax).toBe(20);
    expect(built().creatures.kessa?.vitals.hp).toBe(20);
  });

  it('takes rolled hit points when they are supplied', () => {
    const rolled = planned({ hitPoints: { method: 'rolled', rolls: [1, 6] } });
    // Level 1 is always maximum; the rolls cover levels 2 and 3.
    expect(rolled.hitPointMaximum).toBe(8 + (1 + 2) + (6 + 2));
  });

  /** SRD: "add the total (minimum of 1) to your Hit Point maximum." */
  it('never adds less than one hit point for a level', () => {
    const frail = planned({
      abilities: {
        method: 'manual',
        assignment: { str: 8, dex: 14, con: 3, int: 15, wis: 12, cha: 10 },
      },
      abilityIncreases: { int: 2, wis: 1 },
      hitPoints: { method: 'rolled', rolls: [1, 1] },
    });
    // Con -4: level 1 is 6-4, then two levels of max(1, 1-4).
    expect(frail.hitPointMaximum).toBe(2 + 1 + 1);
  });

  it('gathers proficiencies from class, background and species', () => {
    const sheet = planned().sheet;
    expect(sheet.saveProficiencies).toEqual(['int', 'wis']);
    // Two from the class, two from Sage, one from Human's Skillful.
    expect(Object.keys(sheet.skills).sort()).toEqual([
      'arcana',
      'history',
      'insight',
      'investigation',
      'perception',
    ]);
  });

  /** SRD Scholar: "You have Expertise in the chosen skill." */
  it('applies Scholar expertise to the chosen skill only', () => {
    const sheet = planned().sheet;
    expect(sheet.skills.arcana).toBe('expertise');
    expect(sheet.skills.history).toBe('proficient');
    // Expertise doubles the Proficiency Bonus: Int +3, PB 2.
    expect(skillModifier(sheet, 'arcana')).toBe(3 + 4);
    expect(skillModifier(sheet, 'history')).toBe(3 + 2);
  });

  it('derives the spell save DC and armour class the sheet implies', () => {
    const sheet = planned().sheet;
    // 8 + PB 2 + Int 3.
    expect(spellSaveDc(sheet)).toBe(13);
    // No armour and no training: 10 + Dex 2.
    expect(armorClass(sheet)).toBe(12);
    expect(sheet.spellcastingAbility).toBe('int');
  });

  it('records the tool proficiency the background grants', () => {
    expect(planned().toolProficiencies).toEqual(["Calligrapher's Supplies"]);
  });
});

describe('the resources a level 3 Wizard has', () => {
  it('declares the spell slots the table prints', () => {
    const resources = built().creatures.kessa!.resources;
    expect(remaining(resources, spellSlotKey(1))).toBe(4);
    expect(remaining(resources, spellSlotKey(2))).toBe(2);
    expect(remaining(resources, spellSlotKey(3))).toBe(0);
  });

  it('declares one Hit Die per level, of the class die', () => {
    expect(remaining(built().creatures.kessa!.resources, hitDieKey(6))).toBe(3);
  });

  /** Arcane Recovery: "Once you use this feature, you can't do so again until you finish a Long Rest." */
  it('declares Arcane Recovery as a single use', () => {
    const pool = built().creatures.kessa!.resources.pools['wizard:arcane-recovery'];
    expect(pool).toMatchObject({ max: 1, spent: 0, recovers: 'long-rest' });
  });

  it('gives a level 1 Wizard two slots and no more', () => {
    const low = built({
      level: 1,
      subclassId: undefined,
      spellbook: BOOK.slice(0, 6),
      preparedSpells: ['Magic Missile', 'Shield', 'Mage Armor', 'Sleep'],
      featureChoices: { 'human:skillful': ['perception'], 'human:versatile': ['Skilled'] },
    });
    expect(remaining(low.creatures.kessa!.resources, spellSlotKey(1))).toBe(2);
    expect(remaining(low.creatures.kessa!.resources, spellSlotKey(2))).toBe(0);
    expect(remaining(low.creatures.kessa!.resources, hitDieKey(6))).toBe(1);
  });
});

describe('spells, the spellbook and what is prepared', () => {
  it('keeps the spellbook and the prepared list apart', () => {
    const plan = planned();
    expect(plan.spellbook).toContain('Magic Missile');
    // The Evoker's two free Evocation spells joined the book.
    expect(plan.spellbook).toContain('Burning Hands');
    expect(plan.spellbook).toContain('Scorching Ray');
    expect(plan.spellbook).toHaveLength(12);
    expect(plan.preparedSpells).toHaveLength(6);
  });

  it('refuses a prepared spell that is not in the book', () => {
    const result = planCharacter(
      kessa({
        preparedSpells: ['Magic Missile', 'Shield', 'Mage Armor', 'Sleep', 'Fireball', 'Web'],
      }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('spell_not_in_spellbook');
  });

  it('refuses the wrong number of prepared spells', () => {
    const short = planCharacter(kessa({ preparedSpells: ['Magic Missile'] }));
    expect(isErr(short)).toBe(true);
    if (isErr(short)) expect(short.code).toBe('wrong_prepared_count');
  });

  it('refuses the wrong number of cantrips', () => {
    const result = planCharacter(kessa({ cantrips: ['Fire Bolt'] }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('wrong_cantrip_count');
  });

  /** SRD: the spellbook "starts with six level 1 Wizard spells of your choice." */
  it('refuses a spellbook that does not start with six spells', () => {
    const result = planCharacter(kessa({ spellbook: ['Magic Missile'] }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('wrong_spellbook_count');
  });
});

describe('choices that are missing, wrong, or not on offer', () => {
  const rejects = (over: Overrides, code: string) => {
    const result = planCharacter(kessa(over));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe(code);
  };

  it('refuses an unknown class, species or background', () => {
    rejects({ classId: 'artificer' }, 'unknown_class');
    rejects({ speciesId: 'tabaxi' }, 'unknown_species');
    rejects({ backgroundId: 'pirate' }, 'unknown_background');
  });

  it('refuses a level outside the table', () => {
    rejects({ level: 0 }, 'bad_level');
    rejects({ level: 21 }, 'bad_level');
  });

  it('refuses a class skill the class does not offer', () => {
    rejects({ classSkills: ['stealth', 'arcana'] }, 'skill_not_offered');
  });

  it('refuses the wrong number of class skills', () => {
    rejects({ classSkills: ['arcana'] }, 'wrong_skill_count');
  });

  it('refuses the same class skill twice', () => {
    rejects({ classSkills: ['arcana', 'arcana'] }, 'duplicate_skill');
  });

  /** SRD: "Increase one by 2 and another one by 1, or increase all three by 1." */
  it('refuses a background increase that is not a legal shape', () => {
    rejects({ abilityIncreases: { int: 3 } }, 'bad_ability_increase');
    rejects({ abilityIncreases: { int: 2, con: 2 } }, 'bad_ability_increase');
    rejects({ abilityIncreases: { int: 1 } }, 'bad_ability_increase');
  });

  it('accepts the plus-one-to-all-three shape', () => {
    const spread = planned({ abilityIncreases: { con: 1, int: 1, wis: 1 } });
    expect(spread.sheet.abilities.int).toBe(16);
    expect(spread.sheet.abilities.wis).toBe(13);
  });

  it('refuses raising an ability the background does not offer', () => {
    rejects({ abilityIncreases: { dex: 2, str: 1 } }, 'ability_not_offered');
  });

  /** SRD: "None of these increases can raise a score above 20." */
  it('refuses an increase that would pass twenty', () => {
    rejects(
      {
        abilities: {
          method: 'manual',
          assignment: { str: 8, dex: 14, con: 13, int: 19, wis: 12, cha: 10 },
        },
        abilityIncreases: { int: 2, con: 1 },
      },
      'score_above_twenty',
    );
  });

  it('refuses a standard array that is not the standard array', () => {
    rejects(
      {
        abilities: {
          method: 'standard-array',
          assignment: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 },
        },
      },
      'not_standard_array',
    );
  });

  /** SRD Point Cost: 27 points, and no score above 15 before origin increases. */
  it('checks a point-buy spread against its budget', () => {
    const legal = planCharacter(
      kessa({
        abilities: {
          method: 'point-buy',
          assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
        },
      }),
    );
    expect(isErr(legal)).toBe(false);

    rejects(
      {
        abilities: {
          method: 'point-buy',
          assignment: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 },
        },
      },
      'over_point_budget',
    );
    rejects(
      {
        abilities: {
          method: 'point-buy',
          assignment: { str: 8, dex: 8, con: 8, int: 16, wis: 8, cha: 8 },
        },
      },
      'score_out_of_range',
    );
  });

  it('refuses a subclass before its level and requires one at it', () => {
    rejects({ level: 2, subclassId: 'evoker' }, 'subclass_too_early');
    rejects({ subclassId: undefined }, 'subclass_required');
    rejects({ subclassId: 'necromancer' }, 'unknown_subclass');
  });

  it('refuses a missing feature choice, naming the feature', () => {
    const result = planCharacter(
      kessa({ featureChoices: { 'human:skillful': ['perception'], 'human:versatile': ['Skilled'] } }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.code).toBe('missing_feature_choice');
      expect(result.reason).toContain('wizard:scholar');
    }
  });

  it('refuses a Scholar skill the character is not proficient in', () => {
    rejects({ featureChoices: { ...kessa().featureChoices, 'wizard:scholar': ['nature'] } },
      'expertise_without_proficiency');
  });

  it('refuses an equipment package that is not on offer', () => {
    rejects({ classEquipment: 'C' }, 'unknown_equipment_option');
  });

  /** Every problem at once, for a caller building a form rather than a character. */
  it('lists every problem, not only the first', () => {
    const problems = checkCharacter(
      kessa({ classSkills: ['stealth'], cantrips: [], subclassId: undefined }),
    );
    expect(problems.map((p) => p.code)).toContain('wrong_skill_count');
    expect(problems.map((p) => p.code)).toContain('skill_not_offered');
    expect(problems.map((p) => p.code)).toContain('wrong_cantrip_count');
    expect(problems.map((p) => p.code)).toContain('subclass_required');
    expect(checkCharacter(kessa())).toEqual([]);
  });
});

describe('starting equipment', () => {
  it('takes the package the choice names, from class and background alike', () => {
    const plan = planned();
    const names = plan.equipment.map((e) => e.name);
    expect(names).toContain('Spellbook');
    expect(names).toContain("Scholar's Pack");
    expect(names).toContain("Calligrapher's Supplies");
    // 5 GP from the Wizard package, 8 from Sage.
    expect(plan.goldPieces).toBe(13);
  });

  it('keeps quantities and the details the SRD prints', () => {
    const plan = planned();
    expect(plan.equipment).toContainEqual({ name: 'Dagger', quantity: 2 });
    expect(plan.equipment).toContainEqual({ name: 'Parchment', quantity: 8, detail: 'sheets' });
  });

  it('takes the gold instead when B is chosen', () => {
    const plan = planned({ classEquipment: 'B', backgroundEquipment: 'B' });
    expect(plan.equipment).toEqual([]);
    expect(plan.goldPieces).toBe(105);
  });

  it('mixes the two options freely', () => {
    const plan = planned({ classEquipment: 'B', backgroundEquipment: 'A' });
    expect(plan.equipment.map((e) => e.name)).toContain("Calligrapher's Supplies");
    expect(plan.equipment.map((e) => e.name)).not.toContain('Spellbook');
    expect(plan.goldPieces).toBe(55 + 8);
  });
});

describe('features are granted, and say what is not automated', () => {
  it('grants every feature from class, subclass, species and background', () => {
    const ids = planned().features.map((f) => f.id);
    expect(ids).toContain('wizard:spellcasting');
    expect(ids).toContain('wizard:scholar');
    expect(ids).toContain('wizard:subclass');
    expect(ids).toContain('evoker:evocation-savant');
    expect(ids).toContain('evoker:potent-cantrip');
    expect(ids).toContain('human:resourceful');
    expect(ids).toContain('sage:magic-initiate-wizard');
  });

  it('grants nothing from above the character level', () => {
    const ids = planned().features.map((f) => f.id);
    expect(ids).not.toContain('wizard:ability-score-improvement');
    expect(ids).not.toContain('evoker:sculpt-spells');
  });

  /**
   * The honest half. A character sheet that silently claims Potent Cantrip
   * would be worse than one that says the engine is not applying it.
   */
  it('says which granted features the engine does not execute', () => {
    const manual = planned().features.filter((f) => f.automation === 'manual');
    expect(manual.map((f) => f.id)).toEqual([
      'wizard:ritual-adept',
      'evoker:potent-cantrip',
      'human:resourceful',
      'human:versatile',
      'sage:magic-initiate-wizard',
    ]);
    for (const feature of manual) expect(feature.note.length).toBeGreaterThan(0);
  });

  it('records the feat names without pretending to execute them', () => {
    expect(planned().feats).toEqual(['Magic Initiate (Wizard)', 'Skilled']);
  });
});

describe('the character can be rebuilt and advanced', () => {
  it('keeps the choices that made it', () => {
    const state = built();
    expect(state.creatures.kessa?.character).toMatchObject({
      classId: 'wizard',
      level: 3,
      speciesId: 'human',
      backgroundId: 'sage',
      subclassId: 'evoker',
    });
    expect(state.creatures.kessa?.character?.choices).toEqual(kessa());
  });

  it('survives JSON and rebuilds to the same sheet', () => {
    const state = built();
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);

    const rebuilt = unwrap(planCharacter(revived.creatures.kessa!.character!.choices), 'replan');
    expect(rebuilt.sheet).toEqual(state.creatures.kessa!.sheet);
    expect(rebuilt.hitPointMaximum).toBe(state.creatures.kessa!.vitals.hpMax);
  });

  it('folds the same log to the same character twice', () => {
    const events = unwrap(createCharacter(kessa(), id('kessa')), 'create');
    expect(fold('seed', events)).toEqual(fold('seed', events));
  });

  /**
   * Advancing must not rebuild the creature. A wizard who levels up mid-dungeon
   * keeps their wounds, their conditions and the slots they have already spent.
   */
  it('advances a level without losing current state', () => {
    const start = built({
      level: 2,
      subclassId: undefined,
      spellbook: BOOK.slice(0, 8),
      preparedSpells: ['Magic Missile', 'Shield', 'Mage Armor', 'Sleep', 'Detect Magic'],
      featureChoices: {
        'wizard:scholar': ['arcana'],
        'human:skillful': ['perception'],
        'human:versatile': ['Skilled'],
      },
    });

    const log: GameEvent[] = [
      ...unwrap(
        createCharacter(
          kessa({
            level: 2,
            subclassId: undefined,
            spellbook: BOOK.slice(0, 8),
            preparedSpells: ['Magic Missile', 'Shield', 'Mage Armor', 'Sleep', 'Detect Magic'],
            featureChoices: {
              'wizard:scholar': ['arcana'],
              'human:skillful': ['perception'],
              'human:versatile': ['Skilled'],
            },
          }),
          id('kessa'),
        ),
        'create',
      ),
      { type: 'damage-taken', id: id('kessa'), amount: 6 },
      { type: 'condition-applied', id: id('kessa'), condition: 'poisoned', source: 'a bad pie' },
      { type: 'resource-spent', id: id('kessa'), key: spellSlotKey(1), amount: 2 },
    ];
    const wounded = fold('seed', log);
    expect(wounded.creatures.kessa?.vitals.hp).toBe(start.creatures.kessa!.vitals.hpMax - 6);

    const advanced = fold('seed', [
      ...log,
      ...unwrap(
        advanceCharacter(wounded, id('kessa'), {
          subclassId: 'evoker',
          preparedSpells: [
            'Magic Missile',
            'Shield',
            'Mage Armor',
            'Sleep',
            'Detect Magic',
            'Burning Hands',
          ],
          featureChoices: { 'evoker:evocation-savant': ['Burning Hands', 'Scorching Ray'] },
        }),
        'advance',
      ),
    ]);

    const kessaNow = advanced.creatures.kessa!;
    expect(kessaNow.character?.level).toBe(3);
    expect(kessaNow.character?.subclassId).toBe('evoker');
    // Identity and current state survived.
    expect(kessaNow.name).toBe('Kessa');
    expect(kessaNow.conditions.conditions).toContain('poisoned');
    // The hit point maximum grew; the damage taken did not heal.
    expect(kessaNow.vitals.hpMax).toBe(20);
    expect(kessaNow.vitals.hp).toBe(20 - 6);
    // The new level 2 slots arrived; the level 1 slots stayed spent.
    expect(remaining(kessaNow.resources, spellSlotKey(2))).toBe(2);
    expect(remaining(kessaNow.resources, spellSlotKey(1))).toBe(4 - 2);
    expect(remaining(kessaNow.resources, hitDieKey(6))).toBe(3);
  });

  it('refuses to advance past the table or into another class', () => {
    const state = built();
    expect(isErr(advanceCharacter(state, id('nobody'), {}))).toBe(true);
  });

  it('refuses to advance a creature that was never created from choices', () => {
    const plain = fold('seed', [
      {
        type: 'creature-added',
        id: id('goblin'),
        name: 'goblin',
        sheet: planned().sheet,
        maxHp: 7,
      },
    ]);
    const result = advanceCharacter(plain, id('goblin'), {});
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_a_character');
  });
});
