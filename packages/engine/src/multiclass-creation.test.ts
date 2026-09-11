import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass, proficiencyBonus } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { classCasting } from './spellcasting.js';
import {
  checkCharacter,
  createCharacter,
  planCharacter,
  type CharacterChoices,
} from './creation.js';

/**
 * Multiclassing, built rather than merely computed.
 *
 * `multiclass.ts` holds the rules and `multiclass.test.ts` proves them against
 * the SRD's own worked examples. This is the other half: that a multiclassed
 * character can actually be *made*, and that everything derived from a level
 * reads the right one.
 *
 * The shape follows the SRD's own framing — you begin as one class and "gain a
 * level in a new class whenever you advance" — so `classId` and `level` stay
 * the starting class, which is the one granting full proficiencies, and
 * `multiclass` is the rest. A character with none is single-classed and every
 * rule behaves exactly as it did before, which is what the other 1,973 tests
 * are holding this to.
 */

const id = (s: string) => asCharacterId(s);
const VEX = id('vex');

/** A Fighter 3 / Wizard 2: martial armour, arcane slots, level 5 in total. */
const gish = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Vex',
  classId: 'fighter',
  level: 3,
  multiclass: [{ classId: 'wizard', level: 2 }],
  // A Fighter chooses its subclass at 3, and this Fighter is level 3.
  subclassId: 'champion',
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    // Strength 13 for the Fighter, Intelligence 13 for the Wizard — the SRD
    // minimum, in both directions.
    assignment: { str: 13, dex: 12, con: 14, int: 15, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['athletics', 'perception'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: ['fire-bolt', 'ray-of-frost', 'light'],
  spellbook: [
    'magic-missile',
    'shield',
    'burning-hands',
    'thunderwave',
    'charm-person',
    'chromatic-orb',
    'ray-of-sickness',
    'grease',
  ].map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const })),
  preparedSpells: ['magic-missile', 'burning-hands', 'thunderwave', 'grease', 'charm-person'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-mail'],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['insight'],
    // The Wizard's level 2 Scholar, which a Wizard 2 has however it was reached.
    'wizard:scholar': ['arcana'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'prestidigitation'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const plan = (over: Partial<CharacterChoices> = {}) => unwrap(planCharacter(gish(over)), 'plan');

const built = (over: Partial<CharacterChoices> = {}): GameState =>
  fold('seed', unwrap(createCharacter(gish(over), VEX), 'create') as GameEvent[]);

const rejects = (over: Partial<CharacterChoices>, code: string): void => {
  const result = planCharacter(gish(over));
  expect(isErr(result)).toBe(true);
  if (isErr(result)) expect(result.code).toBe(code);
};

describe('a multiclassed character is a level 5 character', () => {
  /** SRD: "your character level is the total of all your class levels." */
  it('adds the class levels together on the sheet', () => {
    expect(plan().sheet.level).toBe(5);
  });

  /** SRD's own example, in the same arithmetic: +3 at level 5. */
  it('derives the Proficiency Bonus from the total, not from either class', () => {
    expect(proficiencyBonus(plan().sheet)).toBe(3);
  });

  it('refuses a total past level 20', () => {
    rejects({ level: 19, multiclass: [{ classId: 'wizard', level: 5 }] }, 'bad_level');
  });
});

describe('prerequisites are checked before anything is derived', () => {
  /** SRD: 13 in the primary ability of the new class *and* the current one. */
  it('refuses when the new class’s ability is short', () => {
    rejects(
      {
        abilities: {
          method: 'standard-array',
          assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
        },
        abilityIncreases: { con: 2, wis: 1 },
      },
      'multiclass_prerequisite',
    );
  });

  it('refuses the same class listed twice', () => {
    rejects({ multiclass: [{ classId: 'wizard', level: 1 }, { classId: 'wizard', level: 1 }] }, 'duplicate_class');
  });

  it('refuses a class nobody registered', () => {
    rejects({ multiclass: [{ classId: 'artificer', level: 2 }] }, 'unknown_class');
  });

  it('refuses a subclass chosen before its level', () => {
    rejects(
      { multiclass: [{ classId: 'wizard', level: 2, subclassId: 'evoker' }] },
      'subclass_too_early',
    );
  });

  it('refuses a subclass that belongs to another class', () => {
    rejects(
      { multiclass: [{ classId: 'wizard', level: 3, subclassId: 'champion' }] },
      'wrong_subclass',
    );
  });
});

describe('every class contributes its own features at its own level', () => {
  /** SRD: "When you gain a new level in a class, you get its features for that level." */
  it('grants the Fighter’s level 3 features and the Wizard’s level 2 ones', () => {
    const ids = plan().features.map((f) => f.id);
    expect(ids).toContain('fighter:second-wind');
    expect(ids).toContain('fighter:action-surge');
    expect(ids).toContain('wizard:spellcasting');
    expect(ids).toContain('wizard:scholar');
  });

  /** Neither class is treated as though it were level 5. */
  it('does not grant a level 3 feature of the second class', () => {
    const ids = plan().features.map((f) => f.id);
    // The Wizard chooses a subclass at 3, and this Wizard is level 2.
    expect(ids).not.toContain('wizard:subclass');
    // The Fighter gets Extra Attack at 5, and this Fighter is level 3.
    expect(ids).not.toContain('fighter:extra-attack');
  });
});

describe('a later class grants only some of its proficiencies', () => {
  /**
   * A Wizard has no armour training at all, so a Fighter/Wizard keeps the
   * Fighter's — including Heavy, which the *starting* class grants in full.
   */
  it('keeps the starting class’s full armour training', () => {
    const sheet = plan().sheet;
    expect(sheet.armorTraining.heavy).toBe(true);
    expect(sheet.armor?.name).toBe('Chain Mail');
    expect(armorClass(sheet)).toBe(16);
  });

  /**
   * The other direction is the interesting one: a Wizard who took Fighter
   * levels gains Light and Medium armour and Shields — but **not Heavy**,
   * which a Fighter grants to its own students and not to a multiclasser.
   */
  it('adds only the subset a second class grants', () => {
    const sheet = plan({
      classId: 'wizard',
      level: 3,
      multiclass: [{ classId: 'fighter', level: 2 }],
      subclassId: 'evoker',
      classSkills: ['investigation', 'insight'],
      equipped: [],
      spellbook: [
        'magic-missile',
        'shield',
        'burning-hands',
        'thunderwave',
        'charm-person',
        'chromatic-orb',
        'ray-of-sickness',
        'grease',
        'mage-armor',
        'detect-magic',
      ].map((spellId, index) => ({
        spellId,
        acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
        origin: 'level' as const,
      })),
      preparedSpells: ['magic-missile', 'burning-hands', 'thunderwave', 'grease', 'charm-person', 'mage-armor'],
      featureChoices: {
        'human:skillful': ['insight'],
        'wizard:scholar': ['arcana'],
        'evoker:evocation-savant': ['shatter', 'acid-arrow'],
      },
      feats: {
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int',
          cantrips: ['mage-hand', 'prestidigitation'],
          levelOneSpell: 'find-familiar',
        },
        'human:versatile': { featId: 'alert' },
        'fighter:fighting-style': { featId: 'defense' },
      },
    }).sheet;

    expect(sheet.armorTraining).toEqual({
      light: true,
      medium: true,
      heavy: false,
      shields: true,
    });
  });
});

describe('spell slots come from the combined rule only when two classes cast', () => {
  /**
   * SRD: "If you multiclass but have the Spellcasting feature from only one
   * class, follow the rules for that class." A Fighter casts nothing, so this
   * character reads the Wizard's own table at Wizard level 2.
   */
  it('uses one class’s own table when only one class casts', () => {
    expect(plan().spellSlots).toEqual({ 1: 3 });
  });

  /**
   * SRD: "You determine what spells you can prepare for each class
   * individually, as if you were a single-classed member of that class."
   *
   * This was a refusal until per-class spellcasting landed, on the honest
   * grounds that a creature carried one prepared list and one spellcasting
   * ability. It carries one per class now, and `multiclass-spells.test.ts`
   * works the SRD's own example through. What survives here is the half this
   * file is about: that the *slots* come from the combined table only when two
   * classes actually have the Spellcasting feature.
   */
  it('is made, with each class’s spells answering to that class', () => {
    const both = gish({
      classId: 'wizard',
      level: 3,
      multiclass: [{ classId: 'cleric', level: 2 }],
      subclassId: 'evoker',
      classSkills: ['investigation', 'insight'],
      // A Wizard's package has no chain mail; the starting class changed here.
      equipped: [],
      abilities: {
        method: 'standard-array',
        assignment: { str: 8, dex: 12, con: 13, int: 15, wis: 14, cha: 10 },
      },
      abilityIncreases: { wis: 2, con: 1 },
      featureChoices: {
        'human:skillful': ['insight'],
        'wizard:scholar': ['arcana'],
        'evoker:evocation-savant': ['burning-hands', 'thunderwave'],
        'cleric:divine-order': ['Thaumaturge'],
      },
      cantrips: ['fire-bolt', 'ray-of-frost', 'light'],
      spellbook: [
        'magic-missile',
        'shield',
        'charm-person',
        'chromatic-orb',
        'ray-of-sickness',
        'grease',
        'misty-step',
        'mirror-image',
        'web',
        'invisibility',
      ].map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const })),
      preparedSpells: ['magic-missile', 'shield', 'grease', 'misty-step', 'web', 'invisibility'],
      spellsByClass: {
        cleric: {
          cantrips: ['sacred-flame', 'guidance', 'thaumaturgy'],
          preparedSpells: ['bless', 'cure-wounds', 'healing-word', 'guiding-bolt', 'shield-of-faith'],
        },
      },
    });

    expect(checkCharacter(both)).toEqual([]);

    const plan = unwrap(planCharacter(both), 'plan');
    expect(classCasting(plan.spellcasting, 'wizard')?.ability).toBe('int');
    expect(classCasting(plan.spellcasting, 'cleric')?.ability).toBe('wis');
    // Wizard 3 plus Cleric 2 is a level 5 caster: 4 / 3 / 2.
    expect(plan.spellSlots).toEqual({ 1: 4, 2: 3, 3: 2 });
  });
});

describe('hit points come from each class’s own die', () => {
  /**
   * SRD: "You gain the level 1 Hit Points for a class only when your total
   * character level is 1." So the Fighter pays d10 once at level 1, its two
   * further levels take the d10 average, and the Wizard's two take the d6's.
   *
   * Constitution 16 is +3. 10+3, then 6+3 twice for the Fighter, then 4+3
   * twice for the Wizard: 13 + 18 + 14 = 45.
   */
  it('pays the maximum die once, for the starting class', () => {
    expect(plan().hitPointMaximum).toBe(45);
  });

  /** And a single-classed Fighter 5 with the same Constitution is more. */
  it('is fewer hit points than five levels of the bigger die', () => {
    const pureFighter = planCharacter({
      ...gish(),
      level: 5,
      multiclass: [],
      cantrips: [],
      spellbook: [],
      preparedSpells: [],
      featureChoices: { 'human:skillful': ['insight'] },
      feats: {
        ...gish().feats,
        // A Fighter owes an Ability Score Improvement at level 4.
        'fighter:ability-score-improvement': { featId: 'savage-attacker' },
      },
    });
    expect(isErr(pureFighter)).toBe(false);
    if (isErr(pureFighter)) return;
    expect(pureFighter.value.hitPointMaximum).toBeGreaterThan(45);
  });
});

describe('a multiclassed character is a creature the engine accepts', () => {
  it('is created, folds, and survives JSON', () => {
    const state = built();
    expect(state.creatures.vex?.character?.level).toBe(3);
    expect(state.creatures.vex?.sheet.level).toBe(5);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('declares the slots the plan worked out', () => {
    const pools = built().creatures.vex!.resources.pools;
    expect(pools[spellSlotKey(1)]?.max).toBe(3);
    expect(pools[spellSlotKey(2)]).toBeUndefined();
  });

  it('replays prefix by prefix', () => {
    const log = unwrap(createCharacter(gish(), VEX), 'create');
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });
});
