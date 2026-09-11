import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import { armorClass, armorClassCalculation, type CharacterSheet } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { advanceCharacter, createCharacter, planCharacter, type CharacterChoices } from './creation.js';
import { itemFor } from './catalogue.js';

/**
 * A class feature that replaces the Armour Class calculation.
 *
 * The first of the recurring class-feature blockers to be built, and it is a
 * shape rather than a quirk: three features want it, with three different
 * abilities and two different rules about Shields.
 *
 * | Feature | SRD text | Ability | Shield |
 * |---|---|---|---|
 * | Barbarian Unarmored Defense | "While you aren't wearing any armor... You can use a Shield and still gain this benefit." | Constitution | allowed |
 * | Monk Unarmored Defense | "While you aren't wearing armor **or wielding a Shield**" | Wisdom | forbidden |
 * | Draconic Resilience | "While you aren't wearing armor" | Charisma | allowed |
 *
 * The Monk's is the one that names a Shield, and it is the half that gets
 * dropped: a Monk holding a Shield does not lose the Shield's bonus, they lose
 * the whole alternative calculation and fall back to 10 + Dexterity.
 */

const id = (s: string) => asCharacterId(s);
const KRUG = id('krug');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 14, con: 16, int: 8, wis: 12, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

const shield = () => itemFor('shield')?.armor ?? null;
const chainMail = () => itemFor('chain-mail')?.armor ?? null;

const barbarian = { source: 'barbarian:unarmored-defense', ability: 'con' as const, shieldAllowed: true };
const monk = { source: 'monk:unarmored-defense', ability: 'wis' as const, shieldAllowed: false };

describe('an alternative Armour Class calculation', () => {
  /** SRD Barbarian: 10 + Dexterity + Constitution. Dex +2, Con +3. */
  it('replaces 10 + Dexterity while unarmoured', () => {
    expect(armorClass(sheet())).toBe(12);
    expect(armorClass(sheet({ unarmoredDefense: [barbarian] }))).toBe(15);
  });

  /** "While you aren't wearing any armor" — armour wins, as it always did. */
  it('does not apply to a creature in armour', () => {
    const armoured = sheet({ armor: chainMail(), unarmoredDefense: [barbarian] });
    expect(armorClass(armoured)).toBe(armorClass(sheet({ armor: chainMail() })));
  });

  /** SRD Barbarian: "You can use a Shield and still gain this benefit." */
  it('keeps the Barbarian’s calculation when a Shield is held', () => {
    expect(armorClass(sheet({ shield: shield(), unarmoredDefense: [barbarian] }))).toBe(17);
  });

  /**
   * SRD Monk: "while you aren't wearing armor **or wielding a Shield**". The
   * Shield does not merely fail to help — it takes the whole calculation away.
   */
  it('takes the Monk’s calculation away entirely when a Shield is held', () => {
    // Unshielded: 10 + 2 Dexterity + 1 Wisdom.
    expect(armorClass(sheet({ unarmoredDefense: [monk] }))).toBe(13);
    // Shielded: back to 10 + Dexterity, plus the Shield.
    expect(armorClass(sheet({ shield: shield(), unarmoredDefense: [monk] }))).toBe(14);
  });

  /**
   * SRD Multiclassing: "If you have multiple ways to calculate your Armor
   * Class, you can benefit from only one at a time." Which is a choice with
   * exactly one sensible answer — a higher AC costs nothing and gives up
   * nothing — so the engine takes the best *applicable* one and records which,
   * rather than asking a question whose answer is arithmetic.
   */
  it('benefits from the best of several, and only from applicable ones', () => {
    const both = sheet({ unarmoredDefense: [barbarian, monk] });
    // Constitution +3 beats Wisdom +1.
    expect(armorClassCalculation(both).source).toBe('barbarian:unarmored-defense');
    expect(armorClass(both)).toBe(15);

    // With a Shield the Monk's is not on offer at all, so the Barbarian's is
    // the only alternative and the Shield adds on top of it.
    const shielded = sheet({ shield: shield(), unarmoredDefense: [barbarian, monk] });
    expect(armorClassCalculation(shielded).source).toBe('barbarian:unarmored-defense');
    expect(armorClass(shielded)).toBe(17);
  });

  /**
   * The default 10 + Dexterity is itself one of the ways, so a feature that
   * would *lower* the number never takes effect — which matters for exactly
   * one character, the Barbarian with a Constitution penalty, and is the
   * reading that never makes a feature a drawback.
   */
  it('never lowers Armour Class', () => {
    const frail = sheet({ abilities: { str: 16, dex: 14, con: 8, int: 8, wis: 12, cha: 10 } });
    expect(armorClass({ ...frail, unarmoredDefense: [barbarian] })).toBe(12);
    expect(armorClassCalculation({ ...frail, unarmoredDefense: [barbarian] }).source).toBeNull();
  });

  /** A stat block's printed Armour Class still wins over every derivation. */
  it('is beaten by a stated Armour Class', () => {
    const printed = sheet({ unarmoredDefense: [barbarian], stated: { armorClass: 19 } });
    expect(armorClass(printed)).toBe(19);
  });
});

const krug = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Krug',
  classId: 'barbarian',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  ...over,
});

describe('creation hands the calculation to the sheet', () => {
  /** Dexterity 14 is +2; Constitution 13 raised by 2 is 15, so +2. */
  it('gives a level 1 Barbarian 10 + Dexterity + Constitution', () => {
    const plan = unwrap(planCharacter(krug()), 'plan');
    expect(plan.sheet.unarmoredDefense).toEqual([
      { source: 'barbarian:unarmored-defense', ability: 'con', shieldAllowed: true },
    ]);
    expect(armorClass(plan.sheet)).toBe(14);
  });

  it('gives a class without the feature nothing at all', () => {
    const plan = unwrap(
      planCharacter(
        krug({
          classId: 'fighter',
          classSkills: ['athletics', 'survival'],
          feats: { ...krug().feats, 'fighter:fighting-style': { featId: 'archery' } },
          featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
        }),
      ),
      'fighter',
    );
    expect(plan.sheet.unarmoredDefense ?? []).toEqual([]);
  });

  it('reaches the creature, and survives a level in another class', () => {
    const log = unwrap(createCharacter(krug(), KRUG), 'create') as GameEvent[];
    const before: GameState = fold('seed', log);
    expect(armorClass(before.creatures.krug!.sheet)).toBe(14);

    const levelled = unwrap(
      advanceCharacter(before, KRUG, {
        classId: 'monk',
        featureChoices: { ...krug().featureChoices, 'monk:weapon-mastery': [] },
      }),
      'advance',
    );
    const after = fold('seed', [...log, ...levelled]);
    const both = after.creatures.krug!.sheet.unarmoredDefense ?? [];
    expect(both.map((entry) => entry.ability).sort()).toEqual(['con', 'wis']);
    // Constitution +2 still beats Wisdom +1, so the number is unchanged.
    expect(armorClass(after.creatures.krug!.sheet)).toBe(14);
  });
});
