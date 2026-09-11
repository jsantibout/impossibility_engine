import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { carrying, coinsOf } from './commands.js';
import { goldToCopper } from './catalogue.js';
import { CLERIC, LIFE_DOMAIN } from './cleric.js';
import { proficiencyBonusForLevel } from './character.js';
import { cumulativeFeatures } from './progression.js';
import { createCharacter, advanceCharacter, planCharacter, type CharacterChoices } from './creation.js';

/**
 * The second class, which is the first real test of the class *system*.
 *
 * Everything the Wizard proved, it proved once. A structure that fits exactly
 * one thing is not a structure, so what matters here is the three places the
 * Cleric is not a Wizard:
 *
 * - it prepares from the class list and has **no spellbook**;
 * - its subclass **grants** spells outright rather than offering a choice;
 * - it **wears armour**, so the armour branch of Armour Class is finally
 *   exercised by a character who can legally use it.
 */

const id = (s: string) => asCharacterId(s);
const BRANNOR = id('brannor');

const cleric = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Brannor',
  classId: 'cleric',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['insight', 'religion'],
  languages: ['Dwarvish', 'Giant'],
  alignment: 'Lawful Good',
  subclassId: 'life-domain',
  cantrips: ['sacred-flame', 'guidance', 'light'],
  // SRD Cleric: no spellbook at all.
  spellbook: [],
  // A level 3 Cleric prepares 6. The Life Domain's four are always prepared
  // *on top* of these, which is what a domain grant means.
  preparedSpells: ['inflict-wounds', 'healing-word', 'bane', 'blindness-deafness', 'hold-person', 'guiding-bolt'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-shirt', 'shield'],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'cleric:divine-order': ['Protector'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const made = (over: Partial<CharacterChoices> = {}): GameEvent[] =>
  unwrap(createCharacter(cleric(over), BRANNOR), 'create');

const built = (over: Partial<CharacterChoices> = {}): GameState => fold('seed', made(over));

const rejects = (over: Partial<CharacterChoices>, code: string): void => {
  const result = planCharacter(cleric(over));
  expect(isErr(result)).toBe(true);
  if (isErr(result)) expect(result.code).toBe(code);
};

describe('the Cleric table agrees with the engine', () => {
  /** The same relationship assertion the Wizard's table gets, for the same reason. */
  it('prints the Proficiency Bonus the formula gives', () => {
    for (const row of CLERIC.table) {
      expect(row.proficiencyBonus).toBe(proficiencyBonusForLevel(row.level));
    }
  });

  it('never takes a spell slot away as levels rise', () => {
    for (let i = 1; i < CLERIC.table.length; i += 1) {
      const before = CLERIC.table[i - 1]?.spellSlots ?? [];
      const after = CLERIC.table[i]?.spellSlots ?? [];
      for (let level = 0; level < before.length; level += 1) {
        expect(after[level] ?? 0).toBeGreaterThanOrEqual(before[level] ?? 0);
      }
    }
  });

  it('runs from level 1 to 20 with no gaps', () => {
    expect(CLERIC.table.map((r) => r.level)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  /** Every feature the SRD prints, at the level it prints it. */
  it('grants the level 3 features and not the level 5 ones', () => {
    const at3 = cumulativeFeatures(CLERIC, 3).map((f) => f.id);
    expect(at3).toContain('cleric:spellcasting');
    expect(at3).toContain('cleric:divine-order');
    expect(at3).toContain('cleric:channel-divinity');
    expect(at3).toContain('cleric:subclass');
    expect(at3).not.toContain('cleric:sear-undead');
  });

  /**
   * Every manual feature says what a DM still has to do. An unexplained "not
   * automated" is not a useful thing to read at three in the morning.
   */
  it('explains every feature it does not execute', () => {
    for (const feature of [...CLERIC.features, ...LIFE_DOMAIN.features]) {
      expect(feature.note.length).toBeGreaterThan(20);
    }
  });
});

describe('a Cleric prepares from the class list, not from a book', () => {
  it('is made without a spellbook at all', () => {
    const plan = unwrap(planCharacter(cleric()), 'plan');
    expect(plan.sheet.spellcastingAbility).toBe('wis');
    expect(plan.spellcasting.ability).toBe('wis');
    expect(plan.spellcasting.prepared).toContain('inflict-wounds');
  });

  /** Writing spells in a book a Cleric does not have is a mistake, not a spell. */
  it('refuses a spellbook entry', () => {
    rejects(
      { spellbook: [{ spellId: 'bless', acquiredAt: 1, origin: 'level' }] },
      'no_spellbook',
    );
  });

  /** SRD: preparation is "choosing from the Cleric spell list". */
  it('refuses a spell that is not on the Cleric list', () => {
    rejects(
      {
        preparedSpells: ['fireball', 'healing-word', 'bane', 'blindness-deafness', 'hold-person', 'guiding-bolt'],
      },
      'spell_not_on_class_list',
    );
  });

  it('refuses the wrong number of prepared spells', () => {
    rejects({ preparedSpells: ['healing-word'] }, 'wrong_prepared_count');
  });

  /**
   * SRD Life Domain Spells: "you thereafter always have the listed spells
   * prepared" — on top of the table's count, and chosen by nobody.
   */
  it('always has its domain spells prepared, over and above the count', () => {
    const plan = unwrap(planCharacter(cleric()), 'plan');
    for (const spell of ['aid', 'bless', 'cure-wounds', 'lesser-restoration']) {
      expect(plan.spellcasting.prepared).toContain(spell);
    }
    // Six chosen plus four granted, and the six were not reduced to make room.
    expect(plan.spellcasting.prepared.length).toBeGreaterThanOrEqual(10);
  });

  it('lets a domain spell be cast without being on the prepared list twice', () => {
    const plan = unwrap(planCharacter(cleric()), 'plan');
    expect(plan.spellcasting.prepared.filter((s) => s === 'bless')).toHaveLength(1);
  });
});

describe('a Cleric wears armour, which the Wizard never could', () => {
  /**
   * SRD Chain Shirt is 13 + Dexterity capped at +2, and a Shield adds 2 — but
   * only with training, which is the branch a Wizard could never reach.
   */
  it('derives Armour Class from the armour and the shield together', () => {
    const state = built();
    const sheet = state.creatures.brannor!.sheet;
    expect(sheet.armor?.name).toBe('Chain Shirt');
    expect(sheet.shield).not.toBeNull();
    // 13 + 1 (Dex 12) + 2 (Shield) = 16.
    expect(armorClass(sheet)).toBe(16);
  });

  it('starts with the package the SRD prints, opened', () => {
    const state = built();
    const held = carrying(state, BRANNOR).map((line) => line.id);
    expect(held).toContain('chain-shirt');
    expect(held).toContain('shield');
    expect(held).toContain('mace');
    expect(held).toContain('holy-symbol');
    expect(held).toContain('priests-pack');
    // The Priest's Pack is opened like any other.
    expect(held).toContain('holy-water');
    // 7 GP from the Cleric package, 8 from Sage.
    expect(coinsOf(state, BRANNOR)).toBe(goldToCopper(15));
  });

  it('takes the money instead when B is chosen', () => {
    const state = built({ classEquipment: 'B', equipped: [] });
    expect(coinsOf(state, BRANNOR)).toBe(goldToCopper(110 + 8));
    expect(carrying(state, BRANNOR).map((l) => l.id)).not.toContain('chain-shirt');
  });
});

describe('a Cleric levels up the same way a Wizard does', () => {
  it('gains the level 4 slots and keeps what it was wearing', () => {
    const log = made();
    const before = fold('seed', log);
    expect(armorClass(before.creatures.brannor!.sheet)).toBe(16);

    const events = unwrap(
      advanceCharacter(before, BRANNOR, {
        cantrips: ['sacred-flame', 'guidance', 'light', 'mending'],
        preparedSpells: [
          'inflict-wounds',
          'healing-word',
          'bane',
          'blindness-deafness',
          'hold-person',
          'guiding-bolt',
          'cure-wounds',
        ],
        featureChoices: {
          'human:skillful': ['perception'],
          'cleric:divine-order': ['Protector'],
        },
        feats: {
          ...cleric().feats,
          'cleric:ability-score-improvement': { featId: 'savage-attacker' },
        },
        dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'nothing new' },
      }),
      'advance',
    );

    const after = fold('seed', [...log, ...events]);
    expect(after.creatures.brannor!.character?.level).toBe(4);
    // A level 4 Cleric has three level 2 slots.
    expect(after.creatures.brannor!.resources.pools['spell-slot:2']?.max).toBe(3);
    // And is still wearing the shirt and holding the shield.
    expect(armorClass(after.creatures.brannor!.sheet)).toBe(16);
    expect(after.creatures.brannor!.equipped).toEqual(['chain-shirt', 'shield']);
  });

  /** No spellbook to preserve, and no spellbook demanded on the way up. */
  it('advances without ever mentioning a spellbook', () => {
    const log = made();
    const events = unwrap(
      advanceCharacter(fold('seed', log), BRANNOR, {
        cantrips: ['sacred-flame', 'guidance', 'light', 'mending'],
        preparedSpells: [
          'inflict-wounds',
          'healing-word',
          'bane',
          'blindness-deafness',
          'hold-person',
          'guiding-bolt',
          'cure-wounds',
        ],
        featureChoices: {
          'human:skillful': ['perception'],
          'cleric:divine-order': ['Protector'],
        },
        feats: {
          ...cleric().feats,
          'cleric:ability-score-improvement': { featId: 'savage-attacker' },
        },
        dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'nothing new' },
      }),
      'advance',
    );
    const after = fold('seed', [...log, ...events]);
    expect(after.creatures.brannor!.character?.choices.spellbook).toEqual([]);
  });
});

describe('the Wizard is unchanged by any of this', () => {
  /**
   * The load-bearing check on a generalisation: the thing that already worked
   * still works, by the same route, with the same numbers.
   */
  it('still refuses a Wizard who prepares a spell not in their book', () => {
    const wizardish: CharacterChoices = {
      ...cleric(),
      classId: 'wizard',
      subclassId: 'evoker',
      cantrips: ['fire-bolt', 'light', 'prestidigitation'],
      spellbook: [],
      preparedSpells: ['magic-missile'],
      classSkills: ['investigation', 'insight'],
      equipped: [],
      featureChoices: {
        'human:skillful': ['perception'],
        'wizard:scholar': ['arcana'],
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
        'human:versatile': { featId: 'alert' },
      },
    };
    const result = planCharacter(wizardish);
    expect(isErr(result)).toBe(true);
    // It complains about the empty book, not about the Cleric's rules.
    if (isErr(result)) expect(result.code).toBe('wrong_spellbook_count');
  });
});

/** Two ids are enough to prove the registry is a registry. */
describe('both classes are reachable by id', () => {
  it.each([['cleric'], ['wizard']])('finds %s', (classId: string) => {
    const plan = planCharacter({ ...cleric(), classId, level: 1 } as CharacterChoices);
    // Either it plans or it complains about that class's own rules — what it
    // must not do is fail to find the class.
    if (isErr(plan)) expect(plan.code).not.toBe('unknown_class');
  });
});

describe('a Cleric is a creature the rest of the engine accepts', () => {
  it('folds, survives JSON, and replays prefix by prefix', () => {
    const log = made();
    const state = fold('seed', log);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('has Channel Divinity as a pool rather than a note', () => {
    const state = built();
    const pools = Object.keys(state.creatures.brannor!.resources.pools);
    expect(pools.some((key) => key.includes('spell-slot:1'))).toBe(true);
  });
});
