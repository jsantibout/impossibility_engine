import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import { createCharacter, type CharacterChoices } from '@ie/engine';
import { createRng, createRollIssuer, fold, resolveSpell, type GameEvent, type GameState } from '@ie/engine';

/**
 * SRD Disciple of Life, the Life Domain's level 3 feature:
 *
 * > "Whenever a spell you cast with a spell slot restores Hit Points to a
 * > creature, that creature regains additional Hit Points on the turn you cast
 * > the spell. The additional Hit Points equal 2 plus the spell slot's level."
 *
 * The numbers here are the ones a player would check on the sheet: a level 1
 * slot is +3 and a level 2 slot is +4, whatever the dice did, and the same
 * Cleric without the subclass gets neither. The comparison is a Cleric of the
 * other printed domain — same seed, same dice, one feature apart.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const BRANNOR = id('brannor');
const HURT = id('hurt');

/**
 * A Cleric of the Life Domain at level 3, or the same Cleric one level below
 * it — which is the only Cleric in this catalogue who has no domain at all,
 * since the SRD prints one subclass and a level 3 Cleric must take it. Neither
 * the Wisdom modifier nor Cure Wounds' dice move between the two levels, so
 * the pair differ in exactly the feature under test.
 */
const cleric = (subclassId: string | undefined): CharacterChoices => ({
  name: 'Brannor',
  classId: 'cleric',
  level: subclassId === undefined ? 2 : 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['insight', 'religion'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  ...(subclassId === undefined ? {} : { subclassId }),
  cantrips: ['sacred-flame', 'guidance', 'light'],
  spellbook: [],
  preparedSpells:
    subclassId === undefined
      ? ['cure-wounds', 'healing-word', 'bane', 'shield-of-faith', 'guiding-bolt']
      : ['cure-wounds', 'healing-word', 'bane', 'blindness-deafness', 'hold-person', 'guiding-bolt'],
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
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const hurt = (): GameEvent[] => [
  {
    type: 'creature-added',
    id: HURT,
    name: 'Hurt',
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    sheet: {
      level: 1,
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      skills: {},
      saveProficiencies: [],
      armor: null,
      shield: null,
      armorTraining: { light: true, medium: true, heavy: true, shields: true },
      baseSpeed: 30,
      spellcastingAbility: null,
      stated: { armorClass: 12, proficiencyBonus: 2, initiative: 0 },
    },
  },
  { type: 'damage-taken', id: HURT, amount: 200 },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: BRANNOR, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: HURT,
    placement: { from: { creature: BRANNOR }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: BRANNOR, to: HURT, seen: true },
];

const built = (subclassId: string | undefined): GameState =>
  fold('seed', [
    ...unwrap(createCharacter(SRD_CONTENT, cleric(subclassId), BRANNOR), 'create'),
    ...hurt(),
  ]);

const healedBy = (subclassId: string | undefined, slotLevel: number): number => {
  const state = built(subclassId);
  const cast = unwrap(
    resolveSpell(
      state,
      BRANNOR,
      { spellId: 'cure-wounds', targets: [HURT], slotLevel },
      {
        issuer: createRollIssuer('r', state.rollsIssued),
        rng: createRng('seed'),
        content: SRD_CONTENT,
      },
    ),
    'cure wounds',
  );
  return cast.outcomes.find((one) => one.target === HURT)?.healed ?? -1;
};

/** What the feature contributed to the healing the log recorded. */
const contributed = (slotLevel: number): number => {
  const state = built('life-domain');
  const cast = unwrap(
    resolveSpell(
      state,
      BRANNOR,
      { spellId: 'cure-wounds', targets: [HURT], slotLevel },
      {
        issuer: createRollIssuer('r', state.rollsIssued),
        rng: createRng('seed'),
        content: SRD_CONTENT,
      },
    ),
    'cure wounds',
  );
  const record = cast.events.find(
    (event) => event.type === 'roll-recorded' && event.outcome === 'healed',
  );
  if (record === undefined || record.type !== 'roll-recorded') return -1;
  return record.contributions
    .filter((one) => one.source === 'Disciple of Life')
    .reduce((sum, one) => sum + one.amount, 0);
};

describe('Disciple of Life', () => {
  it('adds 2 plus the slot level to a healing spell the slot paid for', () => {
    expect(healedBy('life-domain', 1) - healedBy(undefined, 1)).toBe(3);
  });

  /** And the number it adds is the slot's, which is the half a level cannot show. */
  it('reads the slot the casting expended rather than the spell’s own level', () => {
    expect(contributed(1)).toBe(3);
    expect(contributed(2)).toBe(4);

  });
});
