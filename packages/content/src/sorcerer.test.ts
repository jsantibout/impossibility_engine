import { describe, expect, it } from 'vitest';
import { DRACONIC_SORCERY, METAMAGIC_OPTIONS, SORCERER, SRD_CONTENT } from '@ie/content';
import { classCasting, type SpellcastingState } from '@ie/engine';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass, armorClassCalculation, proficiencyBonusForLevel } from '@ie/engine';
import { fold, type GameEvent, type GameState } from '@ie/engine';
import { cumulativeFeatures } from '@ie/engine';
import { createCharacter, planCharacter, type CharacterChoices } from '@ie/engine';

/**
 * The third and last spellcasting style: a Sorcerer **knows** their spells.
 *
 * SRD's 2024 tables head the column "Prepared Spells" for every caster, which
 * is exactly the sort of thing that makes three different rules look like one.
 * A Wizard's list is drawn from a book they had to fill; a Cleric's is chosen
 * fresh every morning from the whole class list; a Sorcerer's changes only on
 * levelling or by swapping one on a Long Rest. The engine records which, and
 * the difference shows up in what it refuses.
 *
 * Two other firsts here:
 *
 * - **Metamagic**, the `option` choice kind picking two of ten named things —
 *   the same shape as Divine Order and not a feat, which is why that kind had
 *   to exist.
 * - **A subclass grant that is not on the class list at all.** Draconic
 *   Sorcery gives Command, which is a Cleric spell. A grant that had to pass
 *   the class-list check would refuse the SRD.
 */

const id = (s: string) => asCharacterId(s);
const VESKA = id('veska');

const sorcerer = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Veska',
  classId: 'sorcerer',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'persuasion'],
  languages: ['Draconic', 'Giant'],
  alignment: 'Chaotic Neutral',
  subclassId: 'draconic-sorcery',
  cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash'],
  // No book: a Sorcerer never had one.
  spellbook: [],
  // A level 3 Sorcerer knows 6. The four Draconic Spells ride on top.
  preparedSpells: [
    'burning-hands',
    'charm-person',
    'thunderwave',
    'hold-person',
    'shatter',
    'mind-spike',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'sorcerer:metamagic': ['Empowered Spell', 'Quickened Spell'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

/** The sorcerer half of the sheet, which is the only half this class has. */
const casting = (plan: { spellcasting: SpellcastingState }) =>
  classCasting(plan.spellcasting, 'sorcerer')!;

const made = (over: Partial<CharacterChoices> = {}): GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT,sorcerer(over), VESKA), 'create');

const built = (over: Partial<CharacterChoices> = {}): GameState => fold('seed', made(over));

const rejects = (over: Partial<CharacterChoices>, code: string): void => {
  const result = planCharacter(SRD_CONTENT,sorcerer(over));
  expect(isErr(result)).toBe(true);
  if (isErr(result)) expect(result.code).toBe(code);
};

describe('the Sorcerer table agrees with the engine', () => {
  it('prints the Proficiency Bonus the formula gives', () => {
    for (const row of SORCERER.table) {
      expect(row.proficiencyBonus).toBe(proficiencyBonusForLevel(row.level));
    }
  });

  it('never takes a spell slot away as levels rise', () => {
    for (let i = 1; i < SORCERER.table.length; i += 1) {
      const before = SORCERER.table[i - 1]?.spellSlots ?? [];
      const after = SORCERER.table[i]?.spellSlots ?? [];
      for (let level = 0; level < before.length; level += 1) {
        expect(after[level] ?? 0).toBeGreaterThanOrEqual(before[level] ?? 0);
      }
    }
  });

  it('runs from level 1 to 20 with no gaps', () => {
    expect(SORCERER.table.map((r) => r.level)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('explains every feature it does not execute', () => {
    for (const feature of [...SORCERER.features, ...DRACONIC_SORCERY.features]) {
      expect(feature.note.length).toBeGreaterThan(20);
    }
  });

  it('grants the level 3 features and not the level 5 ones', () => {
    const at3 = cumulativeFeatures(SORCERER, 3).map((f) => f.id);
    expect(at3).toContain('sorcerer:font-of-magic');
    expect(at3).toContain('sorcerer:metamagic');
    expect(at3).toContain('sorcerer:subclass');
    expect(at3).not.toContain('sorcerer:sorcerous-restoration');
  });
});

describe('a Sorcerer knows their spells rather than preparing them', () => {
  it('is made with no spellbook and a known list', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,sorcerer()), 'plan');
    expect(casting(plan).ability).toBe('cha');
    expect(casting(plan).prepared).toContain('thunderwave');
    expect(SORCERER.spellcasting?.style).toBe('known');
  });

  it('refuses a spellbook entry, which a Sorcerer has nowhere to put', () => {
    rejects(
      { spellbook: [{ spellId: 'burning-hands', acquiredAt: 1, origin: 'level' }] },
      'no_spellbook',
    );
  });

  /** The count is what the class table prints, and it is a *known* count. */
  it('refuses the wrong number of known spells', () => {
    rejects({ preparedSpells: ['burning-hands'] }, 'wrong_prepared_count');
  });

  it('refuses a spell that is not on the Sorcerer list', () => {
    rejects(
      {
        preparedSpells: [
          'cure-wounds',
          'charm-person',
          'thunderwave',
          'hold-person',
          'shatter',
          'mind-spike',
        ],
      },
      'spell_not_on_class_list',
    );
  });

  /**
   * SRD Draconic Spells: "you thereafter always have the listed spells
   * prepared" — including Command, which is not a Sorcerer spell at all.
   */
  it('carries a subclass grant that is not on the class list', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,sorcerer()), 'plan');
    for (const spell of ['alter-self', 'chromatic-orb', 'command', 'dragons-breath']) {
      expect(casting(plan).prepared).toContain(spell);
    }
    // Six known plus four granted, and the six were not reduced to make room.
    expect(casting(plan).prepared.length).toBe(10);
  });
});

describe('Metamagic is a set of named options, not a set of feats', () => {
  it('takes two of the ten the SRD publishes', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,sorcerer()), 'plan');
    expect(plan.features.map((f) => f.id)).toContain('sorcerer:metamagic');
    expect(METAMAGIC_OPTIONS).toHaveLength(10);
  });

  it('refuses an option nobody published', () => {
    rejects(
      {
        featureChoices: {
          'human:skillful': ['perception'],
          'sorcerer:metamagic': ['Empowered Spell', 'Devastating Spell'],
        },
      },
      'option_not_offered',
    );
  });

  it('refuses taking the same option twice', () => {
    rejects(
      {
        featureChoices: {
          'human:skillful': ['perception'],
          'sorcerer:metamagic': ['Empowered Spell', 'Empowered Spell'],
        },
      },
      'duplicate_option',
    );
  });

  it('refuses the wrong number of options', () => {
    rejects(
      {
        featureChoices: {
          'human:skillful': ['perception'],
          'sorcerer:metamagic': ['Empowered Spell'],
        },
      },
      'missing_feature_choice',
    );
  });
});

describe('a Sorcerer is a creature the rest of the engine accepts', () => {
  /**
   * SRD Draconic Resilience: "Parts of you are also covered by dragon-like
   * scales. While you aren't wearing armor, your base Armor Class equals 10
   * plus your Dexterity and Charisma modifiers." The third feature to want an
   * alternative Armour Class calculation, and the one that proves the shape is
   * not a Barbarian-and-Monk thing: it arrives at level 3, from a *subclass*.
   */
  it('wears no armour, and has scales instead', () => {
    const sheet = built().creatures.veska!.sheet;
    expect(sheet.armor).toBeNull();
    // 10 + Dexterity 14 (+2) + Charisma 15 (+2).
    expect(armorClass(sheet)).toBe(14);
    expect(armorClassCalculation(sheet).source).toBe('draconic-sorcery:draconic-resilience');
  });

  it('has hit points from a d6', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,sorcerer()), 'plan');
    // Level 3, d6, Constitution 15 (+2): 6 + 4 + 4 + 3×2 = 20.
    expect(plan.hitPointMaximum).toBe(20);
  });

  it('folds, survives JSON, and replays prefix by prefix', () => {
    const log = made();
    const state = fold('seed', log);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });
});
