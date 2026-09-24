import { describe, expect, it } from 'vitest';
import { ELDRITCH_INVOCATIONS, SRD_CONTENT } from '@ie/content';
import { checkCharacter, type CharacterChoices } from '@ie/engine';

/**
 * SRD Eldritch Invocations, the Warlock's level 1 feature.
 *
 * "You have unearthed Eldritch Invocations ... You gain one invocation of your
 * choice ... You gain more invocations at higher levels, as shown in the
 * Invocations column of the Warlock Features table. Whenever you gain a
 * Warlock level, you can replace one of your invocations with another one for
 * which you qualify."
 *
 * The shape is the plural choice Divine Order built plus one count that
 * scales: an `option` question whose count is a column, each option carrying
 * its own gated grants, and a prerequisite the validator and creation check.
 */

const base = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Kael',
  classId: 'warlock',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'deception'],
  languages: ['Draconic', 'Goblin'],
  alignment: 'Neutral Evil',
  subclassId: 'fiend-patron',
  cantrips: ['eldritch-blast', 'chill-touch', 'poison-spray'],
  spellbook: [],
  preparedSpells: ['hex', 'charm-person', 'hold-person', 'hypnotic-pattern', 'mind-spike', 'fear'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'warlock:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const codes = (choices: CharacterChoices): readonly string[] =>
  checkCharacter(SRD_CONTENT, choices).map((problem) => problem.code);

describe('the count the Invocations column prints', () => {
  it('asks a Warlock 5 for five', () => {
    expect(ELDRITCH_INVOCATIONS[4]).toBe(5);
    const five = base({
      featureChoices: {
        'human:skillful': ['perception'],
        'warlock:eldritch-invocations': [
          'Agonizing Blast',
          'Armor of Shadows',
          "Devil's Sight",
          'Eldritch Mind',
          'Fiendish Vigor',
        ],
        'warlock:eldritch-invocations:agonizing-blast': ['eldritch-blast'],
      },
    });
    expect(codes(five)).toEqual([]);
  });

  it('refuses a sixth', () => {
    const six = base({
      featureChoices: {
        'human:skillful': ['perception'],
        'warlock:eldritch-invocations': [
          'Agonizing Blast',
          'Armor of Shadows',
          "Devil's Sight",
          'Eldritch Mind',
          'Fiendish Vigor',
          'Misty Visions',
        ],
      },
    });
    expect(codes(six)).toContain('missing_feature_choice');
  });
});
