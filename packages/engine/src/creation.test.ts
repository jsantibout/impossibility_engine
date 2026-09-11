import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass, skillModifier, spellSaveDc } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { hitDieKey } from './rest.js';
import { countOf, levelGrantedSpells, type SpellbookEntry } from './spellbook.js';
import {
  advanceCharacter,
  checkCharacter,
  createCharacter,
  planCharacter,
  type CharacterChoices,
  type FeatChoice,
} from './creation.js';

const id = (s: string) => asCharacterId(s);

/** Level 1-2 Wizard spells, as many as levelling has granted by this level. */
const book = (level: number): SpellbookEntry[] => {
  const ids = [
    'magic-missile',
    'shield',
    'detect-magic',
    'feather-fall',
    'mage-armor',
    'sleep',
    'thunderwave',
    'charm-person',
    'misty-step',
    'web',
  ];
  return ids.slice(0, levelGrantedSpells(level)).map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  }));
};

type Overrides = Partial<CharacterChoices>;

/**
 * A complete, legal level 3 Wizard: Human, Sage, standard array, Evoker.
 * Every test either uses this or breaks exactly one thing in it, so a failure
 * names the rule it broke rather than a pile of unrelated problems.
 */
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
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: book(3),
  preparedSpells: [
    'magic-missile',
    'shield',
    'mage-armor',
    'sleep',
    'burning-hands',
    'scorching-ray',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
  dmGrants: {
    items: [],
    goldPieces: 0,
    magicItems: [],
    note: 'nothing beyond the standard package',
  },
  ...over,
});

const planned = (over: Overrides = {}) => unwrap(planCharacter(kessa(over)), 'plan');

const built = (over: Overrides = {}): GameState =>
  fold('seed', unwrap(createCharacter(kessa(over), id('kessa')), 'create'));

const rejects = (over: Overrides, code: string) => {
  const result = planCharacter(kessa(over));
  expect(isErr(result)).toBe(true);
  if (isErr(result)) expect(result.code).toBe(code);
};

/** A legal level 1 version, for the steps that differ below level 3. */
const novice = (over: Overrides = {}): Overrides => ({
  level: 1,
  subclassId: undefined,
  spellbook: book(1),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep'],
  featureChoices: { 'human:skillful': ['perception'] },
  dmGrants: undefined,
  ...over,
});

describe('steps 1-3: class, origin and ability scores', () => {
  it('derives the ability scores the background raised', () => {
    const sheet = planned().sheet;
    expect(sheet.abilities.int).toBe(17);
    expect(sheet.abilities.con).toBe(14);
    expect(sheet.abilities.dex).toBe(14);
  });

  it('carries the level, its Proficiency Bonus, and the XP the level needs', () => {
    expect(planned().sheet.level).toBe(3);
    expect(planned().proficiencyBonus).toBe(2);
    // SRD: "You begin with the minimum amount of XP required to reach your
    // starting level."
    expect(planned().experiencePoints).toBe(900);
    expect(planned(novice()).experiencePoints).toBe(0);
  });

  it('adds up hit points from the class hit die and Constitution', () => {
    expect(planned().hitPointMaximum).toBe(8 + 6 + 6);
    expect(built().creatures.kessa?.vitals.hpMax).toBe(20);
  });

  it('takes rolled hit points when they are supplied', () => {
    expect(planned({ hitPoints: { method: 'rolled', rolls: [1, 6] } }).hitPointMaximum).toBe(
      8 + 3 + 8,
    );
  });

  it('refuses an unknown class, species or background', () => {
    rejects({ classId: 'artificer' }, 'unknown_class');
    rejects({ speciesId: 'tabaxi' }, 'unknown_species');
    rejects({ backgroundId: 'pirate' }, 'unknown_background');
  });

  /** SRD: "Increase one by 2 and another one by 1, or increase all three by 1." */
  it('refuses a background increase that is not a legal shape', () => {
    rejects({ abilityIncreases: { int: 3 } }, 'bad_ability_increase');
    rejects({ abilityIncreases: { int: 2, con: 2 } }, 'bad_ability_increase');
  });

  it('accepts the plus-one-to-all-three shape', () => {
    expect(planned({ abilityIncreases: { con: 1, int: 1, wis: 1 } }).sheet.abilities.int).toBe(16);
  });

  it('refuses raising an ability the background does not offer, or past twenty', () => {
    rejects({ abilityIncreases: { dex: 2, str: 1 } }, 'ability_not_offered');
    rejects(
      {
        abilities: {
          method: 'manual',
          assignment: { str: 8, dex: 14, con: 13, int: 19, wis: 12, cha: 10 },
        },
      },
      'score_above_twenty',
    );
  });

  it('checks the standard array and the point-buy budget', () => {
    rejects(
      {
        abilities: {
          method: 'standard-array',
          assignment: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 },
        },
      },
      'not_standard_array',
    );
    rejects(
      {
        abilities: {
          method: 'point-buy',
          assignment: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 },
        },
      },
      'over_point_budget',
    );
  });
});

describe('skills, tools and languages', () => {
  it('gathers proficiencies from class, background, species and feat', () => {
    const sheet = planned().sheet;
    expect(Object.keys(sheet.skills).sort()).toEqual([
      'arcana',
      'history',
      'insight',
      'investigation',
      'nature',
      'perception',
      'stealth',
      'survival',
    ]);
    expect(planned().toolProficiencies).toEqual(["Calligrapher's Supplies"]);
  });

  it('enforces the class list and count', () => {
    rejects({ classSkills: ['stealth', 'arcana'] }, 'skill_not_offered');
    rejects({ classSkills: ['arcana'] }, 'wrong_skill_count');
    rejects({ classSkills: ['arcana', 'arcana'] }, 'duplicate_skill');
  });

  /**
   * SRD 5.2.1 has no rule letting a player re-pick a proficiency they already
   * have, so the engine will not invent one. Proficiency is binary: overlapping
   * grants union, the redundant pick is reported as a warning, and the table
   * decides what to do about it.
   */
  it('unions an overlapping proficiency and warns rather than doubling or refusing', () => {
    const plan = planned({
      featureChoices: { ...kessa().featureChoices, 'human:skillful': ['arcana'] },
    });
    expect(plan.sheet.skills.arcana).toBe('expertise');
    expect(plan.warnings.map((w) => w.code)).toContain('redundant_proficiency');
    expect(Object.keys(plan.sheet.skills).filter((s) => s === 'arcana')).toHaveLength(1);
  });

  it('applies Scholar expertise, and refuses it without proficiency', () => {
    const sheet = planned().sheet;
    expect(sheet.skills.arcana).toBe('expertise');
    expect(skillModifier(sheet, 'arcana')).toBe(3 + 4);
    expect(skillModifier(sheet, 'history')).toBe(3 + 2);
    rejects(
      { featureChoices: { ...kessa().featureChoices, 'wizard:scholar': ['medicine'] } },
      'expertise_without_proficiency',
    );
  });

  /** SRD: "Common plus two languages you roll or choose from the Standard Languages table." */
  it('knows Common plus two chosen languages', () => {
    expect(planned().languages).toEqual(['Common', 'Draconic', 'Elvish']);
  });

  /** SRD Step 4: a required choice, recorded, with nothing hanging off it. */
  it('records an alignment and refuses one that is not among the nine', () => {
    expect(planned().alignment).toBe('Chaotic Good');
    rejects({ alignment: 'Lawful Sarcastic' }, 'unknown_alignment');
    rejects({ alignment: '' }, 'unknown_alignment');
  });

  it('refuses the wrong number, a duplicate, or a language off the table', () => {
    rejects({ languages: ['Draconic'] }, 'wrong_language_count');
    rejects({ languages: ['Draconic', 'Draconic'] }, 'duplicate_language');
    rejects({ languages: ['Draconic', 'Ignan'] }, 'unknown_language');
  });
});

describe('spells are checked against the parsed SRD', () => {
  it('refuses a spell id that names nothing', () => {
    rejects({ cantrips: ['fire-bolt', 'light', 'firebolt-typo'] }, 'unknown_spell');
  });

  /** 218 Wizard spells are parsed; Guidance is not one of them. */
  it('refuses a spell that is not on the class list', () => {
    rejects({ cantrips: ['fire-bolt', 'light', 'guidance'] }, 'spell_not_on_class_list');
  });

  it('refuses a levelled spell where a cantrip belongs, and the reverse', () => {
    rejects({ cantrips: ['fire-bolt', 'light', 'magic-missile'] }, 'spell_level_not_allowed');
    rejects(
      { spellbook: [...book(3).slice(0, 9), { spellId: 'light', acquiredAt: 3, origin: 'level' }] },
      'spell_level_not_allowed',
    );
  });

  it('refuses a duplicate cantrip, spellbook entry or prepared spell', () => {
    rejects({ cantrips: ['fire-bolt', 'light', 'light'] }, 'duplicate_spell');
    rejects(
      { spellbook: [...book(3).slice(0, 9), { spellId: 'shield', acquiredAt: 3, origin: 'level' }] },
      'duplicate_spell',
    );
    rejects(
      {
        preparedSpells: [
          'magic-missile',
          'magic-missile',
          'shield',
          'sleep',
          'burning-hands',
          'web',
        ],
      },
      'duplicate_spell',
    );
  });

  it('refuses a prepared spell that is not in the book', () => {
    rejects(
      {
        preparedSpells: [
          'magic-missile',
          'shield',
          'mage-armor',
          'sleep',
          'burning-hands',
          'fireball',
        ],
      },
      'spell_not_in_spellbook',
    );
  });

  /** SRD: "The chosen spells must be of a level for which you have spell slots." */
  it('refuses a spellbook spell above the levels the character has slots for', () => {
    rejects(
      novice({
        spellbook: [
          ...book(1).slice(0, 5),
          { spellId: 'misty-step', acquiredAt: 1, origin: 'level' },
        ],
      }),
      'spell_level_not_allowed',
    );
  });

  it('refuses an acquisition level the character never reached', () => {
    rejects(
      { spellbook: [...book(3).slice(0, 9), { spellId: 'blur', acquiredAt: 7, origin: 'level' }] },
      'bad_acquisition_level',
    );
  });

  it('refuses the wrong number of cantrips, spellbook spells or prepared spells', () => {
    rejects({ cantrips: ['fire-bolt'] }, 'wrong_cantrip_count');
    rejects({ spellbook: book(2) }, 'wrong_spellbook_count');
    rejects({ preparedSpells: ['magic-missile'] }, 'wrong_prepared_count');
  });
});

describe('Evoker bonus spells are checked on their own terms', () => {
  const savant = (spells: readonly string[]) => ({
    featureChoices: { ...kessa().featureChoices, 'evoker:evocation-savant': spells },
  });

  it('adds the two free spells to the book as the feature grant they are', () => {
    const plan = planned();
    const free = plan.spellbook.filter((e) => e.origin === 'feature');
    expect(free.map((e) => e.spellId).sort()).toEqual(['burning-hands', 'scorching-ray']);
    expect(countOf(plan.spellbook, 'level')).toBe(10);
    expect(plan.spellbook).toHaveLength(12);
  });

  /** "two Wizard spells from the Evocation school ... no higher than level 2" */
  it('refuses a spell from the wrong school', () => {
    rejects(
      {
        ...savant(['shield', 'scorching-ray']),
        preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'scorching-ray', 'web'],
      },
      'spell_school_not_allowed',
    );
  });

  it('refuses a spell above level 2', () => {
    rejects(
      {
        ...savant(['fireball', 'scorching-ray']),
        preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'scorching-ray', 'web'],
      },
      'spell_level_not_allowed',
    );
  });

  it('refuses a spell already in the book, which would grant nothing', () => {
    rejects(
      {
        spellbook: [
          ...book(3).slice(0, 9),
          { spellId: 'burning-hands', acquiredAt: 3, origin: 'level' },
        ],
      },
      'spell_already_known',
    );
  });

  it('refuses the wrong number', () => {
    rejects(
      {
        ...savant(['burning-hands']),
        preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'burning-hands', 'web'],
      },
      'missing_feature_choice',
    );
  });
});

describe('Origin feats and the choices they demand', () => {
  const feats = (over: Record<string, FeatChoice>): Overrides => ({
    feats: { ...kessa().feats, ...over },
  });
  const initiate = kessa().feats['sage:magic-initiate-wizard'] as FeatChoice;

  it('records both feats, the background one and the species one', () => {
    expect(planned().feats).toEqual([
      'Magic Initiate (sage:magic-initiate-wizard)',
      'Skilled (human:versatile)',
    ]);
  });

  it('refuses a missing feat choice, naming every feature that wanted one', () => {
    const result = planCharacter(kessa({ feats: {} }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('missing_feat_choice');

    const reasons = checkCharacter(kessa({ feats: {} }))
      .filter((p) => p.code === 'missing_feat_choice')
      .map((p) => p.reason);
    expect(reasons.some((r) => r.includes('sage:magic-initiate-wizard'))).toBe(true);
    expect(reasons.some((r) => r.includes('human:versatile'))).toBe(true);
  });

  it('refuses a feat the background did not grant', () => {
    rejects(feats({ 'sage:magic-initiate-wizard': { featId: 'alert' } }), 'wrong_feat');
  });

  it('refuses a feat that is not an Origin feat', () => {
    rejects(feats({ 'human:versatile': { featId: 'grappler' } }), 'unknown_feat');
  });

  /** Magic Initiate: two cantrips and one level 1 spell, from the chosen list. */
  it('checks Magic Initiate spell selections against that list', () => {
    rejects(
      feats({
        'sage:magic-initiate-wizard': { ...initiate, cantrips: ['mage-hand', 'guidance'] },
      }),
      'spell_not_on_class_list',
    );
    rejects(
      feats({ 'sage:magic-initiate-wizard': { ...initiate, levelOneSpell: 'fireball' } }),
      'spell_level_not_allowed',
    );
    rejects(
      feats({ 'sage:magic-initiate-wizard': { ...initiate, cantrips: ['mage-hand'] } }),
      'wrong_cantrip_count',
    );
  });

  /** "Intelligence, Wisdom, or Charisma is your spellcasting ability for this feat's spells." */
  it('requires a spellcasting ability, and one of the three offered', () => {
    rejects(
      feats({ 'sage:magic-initiate-wizard': { ...initiate, spellcastingAbility: undefined } }),
      'missing_spellcasting_ability',
    );
    rejects(
      feats({ 'sage:magic-initiate-wizard': { ...initiate, spellcastingAbility: 'str' } }),
      'missing_spellcasting_ability',
    );
  });

  it('pins the spell list the background already chose', () => {
    rejects(
      feats({ 'sage:magic-initiate-wizard': { ...initiate, spellList: 'druid' } }),
      'wrong_spell_list',
    );
  });

  /** "You must choose a different spell list each time." */
  it('refuses Magic Initiate twice from the same list', () => {
    rejects(
      feats({
        'human:versatile': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int',
          cantrips: ['light', 'shocking-grasp'],
          levelOneSpell: 'thunderwave',
        },
      }),
      'repeated_spell_list',
    );
  });

  it('accepts Magic Initiate twice from different lists', () => {
    const plan = planned(
      feats({
        'human:versatile': {
          featId: 'magic-initiate',
          spellList: 'druid',
          spellcastingAbility: 'wis',
          cantrips: ['druidcraft', 'shillelagh'],
          levelOneSpell: 'entangle',
        },
      }),
    );
    expect(plan.feats).toContain('Magic Initiate (human:versatile)');
  });

  /** Skilled: "proficiency in any combination of three skills or tools." */
  it('checks the Skilled count and applies what it grants', () => {
    rejects(
      feats({ 'human:versatile': { featId: 'skilled', proficiencies: ['stealth'] } }),
      'wrong_proficiency_count',
    );
    expect(planned().sheet.skills.stealth).toBe('proficient');
  });

  it('takes a feat that asks for nothing', () => {
    expect(planned(feats({ 'human:versatile': { featId: 'alert' } })).feats).toContain(
      'Alert (human:versatile)',
    );
  });
});

describe('starting equipment, ownership and what is worn', () => {
  it('takes both packages, with quantities, details and coin', () => {
    const plan = planned();
    const names = plan.inventory.map((e) => e.name);
    expect(names).toContain('Spellbook');
    expect(names).toContain("Scholar's Pack");
    expect(names).toContain("Calligrapher's Supplies");
    expect(plan.inventory).toContainEqual({ name: 'Dagger', quantity: 2 });
    expect(plan.inventory).toContainEqual({ name: 'Parchment', quantity: 8, detail: 'sheets' });
    // 5 GP from the Wizard package, 8 from Sage.
    expect(plan.goldPieces).toBe(13);
  });

  it('takes the gold instead when B is chosen, and mixes the two freely', () => {
    expect(planned({ classEquipment: 'B', backgroundEquipment: 'B' }).goldPieces).toBe(105);
    const mixed = planned({ classEquipment: 'B', backgroundEquipment: 'A' });
    expect(mixed.inventory.map((e) => e.name)).toContain("Calligrapher's Supplies");
    expect(mixed.inventory.map((e) => e.name)).not.toContain('Spellbook');
    expect(mixed.goldPieces).toBe(63);
  });

  it('refuses an equipment package that is not on offer', () => {
    rejects({ classEquipment: 'C' }, 'unknown_equipment_option');
  });

  /**
   * Owning is not wearing. A Wizard's packages contain no armour, so nothing is
   * equipped and Armour Class is the unarmoured calculation.
   */
  it('derives Armour Class from what is worn, not what is carried', () => {
    const plan = planned();
    expect(plan.equipped).toEqual([]);
    expect(plan.sheet.armor).toBeNull();
    expect(armorClass(plan.sheet)).toBe(12);
  });

  it('refuses equipping something the character does not own', () => {
    rejects({ equipped: ['Plate Armor'] }, 'not_owned');
  });

  /**
   * A GM handing over a chain shirt is the only way a level 3 Wizard comes by
   * armour, and it makes the separation visible: owning it changes nothing
   * until it goes on.
   */
  it('derives a new Armour Class once granted armour is actually equipped', () => {
    const granted: Overrides = {
      dmGrants: {
        items: [{ name: 'Chain Shirt', quantity: 1 }],
        goldPieces: 0,
        magicItems: ['Potion of Healing'],
        note: 'salvaged from the vault',
      },
    };
    const owned = planned(granted);
    expect(owned.inventory.map((e) => e.name)).toContain('Chain Shirt');
    expect(armorClass(owned.sheet)).toBe(12);

    const worn = planned({ ...granted, equipped: ['Chain Shirt'] });
    expect(worn.sheet.armor?.name).toBe('Chain Shirt');
    // Chain Shirt is 13 + Dex, capped at +2.
    expect(armorClass(worn.sheet)).toBe(15);
    expect(worn.magicItems).toEqual(['Potion of Healing']);
  });
});

describe('creating above level 1 records what the GM decided', () => {
  /**
   * SRD "Starting at Higher Levels": "The GM decides whether your character
   * starts with more than the standard equipment." The engine cannot guess
   * that, and a silent default would be an invented answer.
   */
  it('refuses a level 2+ character with no GM decision recorded', () => {
    rejects({ dmGrants: undefined }, 'missing_dm_grants');
  });

  it('accepts an explicitly empty decision, but wants a reason', () => {
    expect(planned().magicItems).toEqual([]);
    rejects(
      { dmGrants: { items: [], goldPieces: 0, magicItems: [], note: '  ' } },
      'unexplained_dm_grants',
    );
  });

  it('asks nothing of a level 1 character', () => {
    expect(isErr(planCharacter(kessa(novice())))).toBe(false);
  });
});

describe('the resources a level 3 Wizard has', () => {
  it('declares slots, Hit Dice and Arcane Recovery', () => {
    const resources = built().creatures.kessa!.resources;
    expect(remaining(resources, spellSlotKey(1))).toBe(4);
    expect(remaining(resources, spellSlotKey(2))).toBe(2);
    expect(remaining(resources, spellSlotKey(3))).toBe(0);
    expect(remaining(resources, hitDieKey(6))).toBe(3);
    expect(resources.pools['wizard:arcane-recovery']).toMatchObject({
      max: 1,
      recovers: 'long-rest',
    });
  });

  it('gives a level 1 Wizard two slots and one Hit Die', () => {
    const low = built(novice());
    expect(remaining(low.creatures.kessa!.resources, spellSlotKey(1))).toBe(2);
    expect(remaining(low.creatures.kessa!.resources, spellSlotKey(2))).toBe(0);
    expect(remaining(low.creatures.kessa!.resources, hitDieKey(6))).toBe(1);
  });

  it('derives the spell save DC the sheet implies', () => {
    expect(spellSaveDc(planned().sheet)).toBe(13);
  });
});

describe('features are granted, and say what is not automated', () => {
  it('grants every feature from class, subclass, species and background', () => {
    const ids = planned().features.map((f) => f.id);
    for (const expected of [
      'wizard:spellcasting',
      'wizard:scholar',
      'wizard:subclass',
      'evoker:evocation-savant',
      'evoker:potent-cantrip',
      'human:resourceful',
      'sage:magic-initiate-wizard',
    ]) {
      expect(ids).toContain(expected);
    }
    expect(ids).not.toContain('wizard:ability-score-improvement');
    expect(ids).not.toContain('evoker:sculpt-spells');
  });

  it('says which granted features the engine does not execute', () => {
    const manual = planned().features.filter((f) => f.automation === 'manual');
    // Versatile and Magic Initiate left this list when their mechanics were
    // actually applied: the feat's proficiencies and spells reach the sheet,
    // and the free daily casting is a pool the engine spends. What is left is
    // genuinely unexecuted.
    expect(manual.map((f) => f.id)).toEqual([
      'wizard:ritual-adept',
      'evoker:potent-cantrip',
      'human:resourceful',
    ]);
    for (const feature of manual) expect(feature.note.length).toBeGreaterThan(0);
  });

  it('refuses a missing feature choice, naming the feature', () => {
    const result = planCharacter(kessa({ featureChoices: { 'human:skillful': ['perception'] } }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.reason).toContain('wizard:scholar');
  });

  it('refuses a subclass before its level and requires one at it', () => {
    rejects({ level: 2, subclassId: 'evoker' }, 'subclass_too_early');
    rejects({ subclassId: undefined }, 'subclass_required');
    rejects({ subclassId: 'necromancer' }, 'unknown_subclass');
  });
});

describe('every problem at once, for a caller building a form', () => {
  it('lists them all with the field each belongs to', () => {
    const problems = checkCharacter(
      kessa({ classSkills: ['stealth'], cantrips: [], subclassId: undefined, languages: [] }),
    );
    const codes = problems.map((p) => p.code);
    for (const expected of [
      'wrong_skill_count',
      'skill_not_offered',
      'wrong_cantrip_count',
      'subclass_required',
      'wrong_language_count',
    ]) {
      expect(codes).toContain(expected);
    }
    for (const p of problems) expect(p.field.length).toBeGreaterThan(0);
  });

  it('finds nothing wrong with a legal character', () => {
    expect(checkCharacter(kessa())).toEqual([]);
  });
});

describe('the character can be rebuilt and advanced', () => {
  it('keeps the choices that made it, and survives JSON', () => {
    const state = built();
    expect(state.creatures.kessa?.character?.choices).toEqual(kessa());

    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);
    const rebuilt = unwrap(planCharacter(revived.creatures.kessa!.character!.choices), 'replan');
    expect(rebuilt.sheet).toEqual(state.creatures.kessa!.sheet);
  });

  it('folds the same log to the same character twice', () => {
    const events = unwrap(createCharacter(kessa(), id('kessa')), 'create');
    expect(fold('seed', events)).toEqual(fold('seed', events));
  });

  /**
   * The one that matters. A Wizard who levels up mid-dungeon keeps their
   * wounds, their conditions, the slots they have spent — and the spells they
   * copied out of a scroll, which must not make the book "the wrong size".
   */
  it('advances a level, preserving copied spells and current state', () => {
    const start = unwrap(
      createCharacter(
        kessa({
          level: 2,
          subclassId: undefined,
          spellbook: [
            ...book(2),
            // Looted last session, and not counted against the table. Level 1,
            // because SRD lets a Wizard copy a spell only "if it's of a level
            // you can prepare" — and a level 2 Wizard has only level 1 slots.
            { spellId: 'comprehend-languages', acquiredAt: 2, origin: 'copied' },
          ],
          preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'detect-magic'],
          featureChoices: { 'wizard:scholar': ['arcana'], 'human:skillful': ['perception'] },
          dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
        }),
        id('kessa'),
      ),
      'create',
    );

    const log: GameEvent[] = [
      ...start,
      { type: 'damage-taken', id: id('kessa'), amount: 6 },
      { type: 'condition-applied', id: id('kessa'), condition: 'poisoned', source: 'a bad pie' },
      { type: 'resource-spent', id: id('kessa'), key: spellSlotKey(1), amount: 2 },
    ];
    const wounded = fold('seed', log);

    const advanced = fold('seed', [
      ...log,
      ...unwrap(
        advanceCharacter(wounded, id('kessa'), {
          subclassId: 'evoker',
          newSpells: ['misty-step', 'web'],
          copiedSpells: ['blur'],
          preparedSpells: [
            'magic-missile',
            'shield',
            'mage-armor',
            'sleep',
            'detect-magic',
            'burning-hands',
          ],
          featureChoices: { 'evoker:evocation-savant': ['burning-hands', 'scorching-ray'] },
        }),
        'advance',
      ),
    ]);

    const now = advanced.creatures.kessa!;
    expect(now.character?.level).toBe(3);
    expect(now.character?.subclassId).toBe('evoker');
    expect(now.name).toBe('Kessa');

    // Current state survived the level.
    expect(now.conditions.conditions).toContain('poisoned');
    expect(now.vitals.hpMax).toBe(20);
    expect(now.vitals.hp).toBe(14);
    expect(remaining(now.resources, spellSlotKey(2))).toBe(2);
    expect(remaining(now.resources, spellSlotKey(1))).toBe(2);
    expect(remaining(now.resources, hitDieKey(6))).toBe(3);

    // The copied spells are still there, and still not counted.
    const ids = now.character!.choices.spellbook.map((e) => e.spellId);
    expect(ids).toContain('comprehend-languages');
    expect(ids).toContain('blur');
    expect(countOf(now.character!.choices.spellbook, 'level')).toBe(levelGrantedSpells(3));
    expect(countOf(now.character!.choices.spellbook, 'copied')).toBe(2);
    // Twelve written pages, which is more than the table's ten, and legal.
    expect(now.character!.choices.spellbook).toHaveLength(12);
  });

  it('refuses to advance a creature that was never created from choices', () => {
    const plain = fold('seed', [
      { type: 'creature-added', id: id('goblin'), name: 'goblin', sheet: planned().sheet, maxHp: 7 },
    ]);
    const result = advanceCharacter(plain, id('goblin'), {});
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_a_character');
  });

  it('refuses an advance whose new spells are the wrong number', () => {
    const result = advanceCharacter(built(novice()), id('kessa'), {
      newSpells: ['misty-step'],
      preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'detect-magic'],
      featureChoices: { 'wizard:scholar': ['arcana'] },
      dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('wrong_spellbook_count');
  });
});
