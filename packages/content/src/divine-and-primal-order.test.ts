import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Skill } from '@ie/shared';
import { createCharacter, type CharacterChoices } from '@ie/engine';
import { createRng, createRollIssuer, fold, resolveTest, type GameState } from '@ie/engine';

/**
 * The Cleric's and the Druid's **level 1** feature, half executed.
 *
 * SRD Divine Order (Thaumaturge) and Primal Order (Magician) print the same
 * sentence over different skills: "you have a bonus to the Intelligence
 * (Arcana) and Intelligence (Religion) checks you make. The bonus equals your
 * Wisdom modifier (minimum of +1)." Two writers of one shape, which is what
 * made `check-bonus` a member of the standing vocabulary rather than one
 * class's quirk.
 *
 * What is asserted here is the number a player would see on the sheet: a
 * Wisdom of 17 is a +3, it reaches exactly the two skills each feature names,
 * and a character who took the **other** option of the same choice has none of
 * it — which is what `onlyIfChoice` means and why the whole grant hangs on it.
 *
 * The other halves are not executed and the features say so: neither Order's
 * proficiencies are conferred and neither extra cantrip is granted.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const BRANNOR = id('brannor');
const FENN = id('fenn');

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
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
};

/** Wisdom 15 and two points from the background: 17, a +3. */
const cleric = (option: string): CharacterChoices => ({
  ...common,
  name: 'Brannor',
  classId: 'cleric',
  level: 3,
  abilities: {
    method: 'standard-array',
    assignment: { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['insight', 'religion'],
  subclassId: 'life-domain',
  cantrips: ['sacred-flame', 'guidance', 'light'],
  preparedSpells: ['inflict-wounds', 'healing-word', 'bane', 'blindness-deafness', 'hold-person', 'guiding-bolt'],
  featureChoices: {
    'human:skillful': ['perception'],
    'cleric:divine-order': [option],
  },
});

const druid = (option: string): CharacterChoices => ({
  ...common,
  name: 'Fenn',
  classId: 'druid',
  level: 3,
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 13, con: 14, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['nature', 'survival'],
  subclassId: 'circle-of-the-land',
  cantrips: ['poison-spray', 'guidance'],
  preparedSpells: ['cure-wounds', 'charm-person', 'thunderwave', 'animal-friendship', 'healing-word', 'hold-person'],
  featureChoices: {
    'human:skillful': ['perception'],
    'druid:primal-order': [option],
  },
});

const built = (who: CharacterId, choices: CharacterChoices): GameState =>
  fold('seed', unwrap(createCharacter(SRD_CONTENT, choices, who), 'create'));

/**
 * What the log says contributed to one skill check.
 *
 * Through the command rather than through the reader, because what a player
 * gets is the number on the roll and the line that explains it.
 */
const bonusOn = (state: GameState, who: CharacterId, skill: Skill): number => {
  const rolled = unwrap(
    resolveTest(
      state,
      who,
      { kind: 'ability-check', ability: 'int', skill, dc: 10 },
      {
        issuer: createRollIssuer('r', state.rollsIssued),
        rng: createRng('seed'),
        content: SRD_CONTENT,
      },
    ),
    'check',
  );
  const record = rolled.events.find((event) => event.type === 'roll-recorded');
  if (record === undefined || record.type !== 'roll-recorded') return 0;
  return record.contributions
    .filter((one) => one.source === 'Divine Order' || one.source === 'Primal Order')
    .reduce((sum, one) => sum + one.amount, 0);
};

describe('Divine Order, Thaumaturge', () => {
  it('adds the Wisdom modifier to Arcana and Religion, and to nothing else', () => {
    const state = built(BRANNOR, cleric('Thaumaturge'));
    expect(bonusOn(state, BRANNOR, 'arcana')).toBe(3);
    expect(bonusOn(state, BRANNOR, 'religion')).toBe(3);
    expect(bonusOn(state, BRANNOR, 'nature')).toBe(0);
    expect(bonusOn(state, BRANNOR, 'history')).toBe(0);
  });

  it('grants a Cleric who took Protector nothing at all', () => {
    const state = built(BRANNOR, cleric('Protector'));
    expect(bonusOn(state, BRANNOR, 'arcana')).toBe(0);
    expect(bonusOn(state, BRANNOR, 'religion')).toBe(0);
    expect(
      (state.creatures[BRANNOR]?.sheet.standing ?? []).map((effect) => effect.feature),
    ).not.toContain('cleric:divine-order');
  });

  /** The half that is not executed, asserted rather than assumed. */
  it('confers neither the Protector training nor the extra cantrip', () => {
    const protector = built(BRANNOR, cleric('Protector')).creatures[BRANNOR];
    expect(protector?.sheet.armorTraining.heavy).toBe(false);
    expect(protector?.sheet.weaponProficiencies ?? []).not.toContain('martial');
    // The Cleric table allows three cantrips at level 3 and Thaumaturge's
    // fourth is not among them.
    const thaumaturge = built(BRANNOR, cleric('Thaumaturge')).creatures[BRANNOR];
    expect(thaumaturge?.spellcasting?.classes[0]?.cantrips.length).toBe(3);
  });
});

describe('Primal Order, Magician', () => {
  it('adds the Wisdom modifier to Arcana and Nature, and to nothing else', () => {
    const state = built(FENN, druid('Magician'));
    expect(bonusOn(state, FENN, 'arcana')).toBe(3);
    expect(bonusOn(state, FENN, 'nature')).toBe(3);
    expect(bonusOn(state, FENN, 'religion')).toBe(0);
  });

  it('grants a Druid who took Warden nothing at all', () => {
    const state = built(FENN, druid('Warden'));
    expect(bonusOn(state, FENN, 'arcana')).toBe(0);
    expect(
      (state.creatures[FENN]?.sheet.standing ?? []).map((effect) => effect.feature),
    ).not.toContain('druid:primal-order');
    expect(state.creatures[FENN]?.sheet.armorTraining.medium).toBe(false);
  });
});
