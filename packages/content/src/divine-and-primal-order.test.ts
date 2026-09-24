import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Skill } from '@ie/shared';
import {
  checkCharacter,
  createCharacter,
  proficientWith,
  routesFor,
  untrainedArmorPenalty,
  type CharacterChoices,
} from '@ie/engine';
import { createRng, createRollIssuer, fold, resolveTest, type GameState } from '@ie/engine';

/**
 * The Cleric's and the Druid's **level 1** feature, both options executed.
 *
 * SRD Divine Order and Primal Order print one heading over two named options,
 * and between them they ask the two questions a feature can ask: which order,
 * and — of one of the two orders — which extra cantrip from the class list.
 * That second question is why they were half-executed for as long as they
 * were: a feature had one question, and this one had already spent it on the
 * order.
 *
 * What is asserted here is what a player would see on the sheet. A Protector
 * swings a longsword and wears plate with no penalty. A Thaumaturge casts the
 * cantrip they named, off the cantrip route rather than a slot, and has the
 * check bonus their Wisdom sizes — a 17 is a +3, over exactly the two skills
 * the feature names. And each order has none of the other's: the gate is on
 * every grant, so a Protector has no bonus and no cantrip and a Thaumaturge no
 * training.
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
  hitPoints: { method: 'fixed' as const },
  // The plate and the longsword the Protector and the Warden are trained with,
  // handed over by the DM: the training is the feature's and what it is
  // training *for* has to be in the character's hands to be asserted about.
  dmGrants: {
    items: [
      { id: 'plate-armor', quantity: 1 },
      { id: 'longsword', quantity: 1 },
    ],
    goldPieces: 0,
    magicItems: [],
    note: 'standard',
  },
  equipped: ['plate-armor'],
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
const cleric = (
  option: string,
  featureChoices: Record<string, readonly string[]> = {},
): CharacterChoices => ({
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
    ...featureChoices,
  },
});

const druid = (
  option: string,
  featureChoices: Record<string, readonly string[]> = {},
): CharacterChoices => ({
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
    ...featureChoices,
  },
});

const built = (who: CharacterId, choices: CharacterChoices): GameState =>
  fold('seed', unwrap(createCharacter(SRD_CONTENT, choices, who), 'create'));

/** The codes `checkCharacter` reports, which is what a form would show. */
const refusals = (choices: CharacterChoices): readonly string[] =>
  checkCharacter(SRD_CONTENT, choices).map((problem) => problem.code);

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

/** How this character would pay for a spell, if they can cast it at all. */
const routeKinds = (state: GameState, who: CharacterId, spellId: string): readonly string[] => {
  const spellcasting = state.creatures[who]?.spellcasting;
  return spellcasting === undefined ? [] : routesFor(spellcasting, spellId).map((one) => one.kind);
};

const LONGSWORD = SRD_CONTENT.item('longsword')?.weapon ?? null;

describe('Divine Order, Protector', () => {
  const choices = cleric('Protector');

  it('is proficient with Martial weapons and wears Heavy armour without the penalty', () => {
    const sheet = built(BRANNOR, choices).creatures[BRANNOR]?.sheet;
    expect(sheet?.weaponProficiencies).toContain('martial');
    expect(proficientWith(sheet!, LONGSWORD)).toBe(true);
    expect(sheet?.armorTraining.heavy).toBe(true);
    expect(sheet?.armor?.category).toBe('heavy');
    expect(untrainedArmorPenalty(sheet!)).toBe(false);
  });

  /** The other order's half, which a Protector has none of. */
  it('has neither the check bonus nor an extra cantrip', () => {
    const state = built(BRANNOR, choices);
    expect(bonusOn(state, BRANNOR, 'arcana')).toBe(0);
    expect(bonusOn(state, BRANNOR, 'religion')).toBe(0);
    expect(state.creatures[BRANNOR]?.spellcasting?.classes[0]?.cantrips.length).toBe(3);
  });

  it('is refused a cantrip it was never asked for', () => {
    expect(refusals(cleric('Protector', { 'cleric:divine-order:cantrip': ['thaumaturgy'] }))).toContain(
      'choice_not_asked',
    );
  });
});

describe('Divine Order, Thaumaturge', () => {
  const choices = cleric('Thaumaturge', { 'cleric:divine-order:cantrip': ['thaumaturgy'] });

  it('knows the cantrip it named, as a cantrip', () => {
    const state = built(BRANNOR, choices);
    expect(state.creatures[BRANNOR]?.spellcasting?.classes[0]?.cantrips).toContain('thaumaturgy');
    // A cantrip route and nothing else: a granted spell filed with the
    // prepared ones would be a cantrip that costs a slot.
    expect(routeKinds(state, BRANNOR, 'thaumaturgy')).toEqual(['cantrip']);
  });

  it('adds the Wisdom modifier to Arcana and Religion, and to nothing else', () => {
    const state = built(BRANNOR, choices);
    expect(bonusOn(state, BRANNOR, 'arcana')).toBe(3);
    expect(bonusOn(state, BRANNOR, 'religion')).toBe(3);
    expect(bonusOn(state, BRANNOR, 'nature')).toBe(0);
    expect(bonusOn(state, BRANNOR, 'history')).toBe(0);
  });

  it('has none of the Protector training, and wears plate at a penalty', () => {
    const sheet = built(BRANNOR, choices).creatures[BRANNOR]?.sheet;
    expect(sheet?.weaponProficiencies ?? []).not.toContain('martial');
    expect(sheet?.armorTraining.heavy).toBe(false);
    expect(untrainedArmorPenalty(sheet!)).toBe(true);
  });

  it('is asked for the cantrip, and refused without one', () => {
    expect(refusals(cleric('Thaumaturge'))).toContain('missing_feature_choice');
  });

  /** The list is the feature's own class, at the one level a cantrip is. */
  it('refuses a cantrip off another list and a spell that is not one', () => {
    expect(
      refusals(cleric('Thaumaturge', { 'cleric:divine-order:cantrip': ['fire-bolt'] })),
    ).toContain('spell_not_on_class_list');
    expect(
      refusals(cleric('Thaumaturge', { 'cleric:divine-order:cantrip': ['bless'] })),
    ).toContain('spell_level_not_allowed');
  });
});

describe('Primal Order, Warden', () => {
  const choices = druid('Warden');

  it('is proficient with Martial weapons and trained with Medium armour', () => {
    const sheet = built(FENN, choices).creatures[FENN]?.sheet;
    expect(sheet?.weaponProficiencies).toContain('martial');
    expect(proficientWith(sheet!, LONGSWORD)).toBe(true);
    expect(sheet?.armorTraining.medium).toBe(true);
    // And not a step further: the Warden's sentence stops at Medium, so the
    // plate this Druid is wearing is still armour they are untrained in.
    expect(sheet?.armorTraining.heavy).toBe(false);
    expect(untrainedArmorPenalty(sheet!)).toBe(true);
  });

  it('has neither the check bonus nor an extra cantrip', () => {
    const state = built(FENN, choices);
    expect(bonusOn(state, FENN, 'arcana')).toBe(0);
    expect(state.creatures[FENN]?.spellcasting?.classes[0]?.cantrips.length).toBe(2);
  });

  it('is refused a cantrip it was never asked for', () => {
    expect(refusals(druid('Warden', { 'druid:primal-order:cantrip': ['druidcraft'] }))).toContain(
      'choice_not_asked',
    );
  });
});

describe('Primal Order, Magician', () => {
  const choices = druid('Magician', { 'druid:primal-order:cantrip': ['druidcraft'] });

  it('knows the cantrip it named, as a cantrip', () => {
    const state = built(FENN, choices);
    expect(state.creatures[FENN]?.spellcasting?.classes[0]?.cantrips).toContain('druidcraft');
    expect(routeKinds(state, FENN, 'druidcraft')).toEqual(['cantrip']);
  });

  it('adds the Wisdom modifier to Arcana and Nature, and to nothing else', () => {
    const state = built(FENN, choices);
    expect(bonusOn(state, FENN, 'arcana')).toBe(3);
    expect(bonusOn(state, FENN, 'nature')).toBe(3);
    expect(bonusOn(state, FENN, 'religion')).toBe(0);
  });

  it('has none of the Warden training', () => {
    const sheet = built(FENN, choices).creatures[FENN]?.sheet;
    expect(sheet?.weaponProficiencies ?? []).not.toContain('martial');
    expect(sheet?.armorTraining.medium).toBe(false);
  });

  it('is asked for the cantrip, and refused without one', () => {
    expect(refusals(druid('Magician'))).toContain('missing_feature_choice');
  });
});

describe('both features are executed rather than recorded', () => {
  it('declares engine, and the note says what each order applies', () => {
    for (const [classId, featureId] of [
      ['cleric', 'cleric:divine-order'],
      ['druid', 'druid:primal-order'],
    ] as const) {
      const feature = SRD_CONTENT.classById(classId)?.features.find((one) => one.id === featureId);
      expect(feature?.automation, featureId).toBe('engine');
      // Two questions, the second keyed and gated on the first.
      expect(feature?.choices?.length, featureId).toBe(2);
      expect(feature?.choices?.[1]?.key, featureId).toBe('cantrip');
    }
  });
});
