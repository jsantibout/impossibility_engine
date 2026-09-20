import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { checkContent, extendContent, parseClassDefinition } from './content.js';
import { resolveSpell } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { castingHealingBonus } from './standing.js';

/**
 * Healing a feature of the **caster's** reaches into.
 *
 * Everything a spell restores is the definition's and is settled when the
 * casting is written, exactly as its damage is — and `casting-damage` is the
 * member that says otherwise about damage. SRD Disciple of Life says it about
 * healing: "When a spell you cast with a spell slot restores Hit Points to a
 * creature, that creature regains additional Hit Points ... equal to 2 plus
 * the spell slot's level."
 *
 * The class below is not the Life Domain: it is loaded from JSON text through
 * the public door, its addend is a different number, it is gated on one option
 * of a choice, and nothing in the engine names it. The two characters are the
 * same character with the other option taken, so the two castings differ in
 * exactly one grant and throw exactly the same dice.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WARDEN = id('warden');
const HURT = id('hurt');

const TIDEMENDER = {
  id: 'tidemender',
  name: 'Tidemender',
  primaryAbility: 'wis',
  hitDie: 8,
  saveProficiencies: ['wis', 'cha'],
  skillChoices: { choose: 2, from: ['athletics', 'arcana', 'survival', 'insight'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    proficiencyBonus: 2 + Math.floor(index / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'quarterstaff', quantity: 1 }], goldPieces: 5 }],
  multiclass: {
    weapons: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'tidemender:tidal-mercy',
      name: 'Tidal Mercy',
      level: 1,
      automation: 'engine',
      note: 'Mercy: when a spell you cast with a spell slot restores Hit Points to a creature, that creature regains an extra 1 plus the slot level. Tide grants nothing this engine reads.',
      choice: { kind: 'option', choose: 1, from: ['Mercy', 'Tide'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        onlyIfChoice: 'Mercy',
        effects: [
          {
            kind: 'casting-healing',
            when: { withSlot: true },
            alters: { kind: 'flat', flat: 1, plusSlotLevel: true },
          },
        ],
      },
    },
  ],
};

const parsed = unwrap(parseClassDefinition(JSON.parse(JSON.stringify(TIDEMENDER))), 'parse');
const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');

const tidemender = (option: string): CharacterChoices => ({
  name: 'Ilka',
  classId: 'tidemender',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 15, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'tidemender:tidal-mercy': [option] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'medicine'] },
  },
});

const dummy = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
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
  } satisfies CharacterSheet,
});

/** A caster with slots, a badly wounded ally beside them, and nothing else. */
const table = (option: string): GameEvent[] => [
  ...unwrap(createCharacter(content, tidemender(option), WARDEN), 'create'),
  dummy(HURT),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WARDEN, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: HURT,
    placement: { from: { creature: WARDEN }, feet: 5, bearing: 0 },
  },
  { type: 'damage-taken', id: HURT, amount: 200 },
  { type: 'sight-declared', from: WARDEN, to: HURT, seen: true },
  {
    type: 'spellcasting-declared',
    id: WARDEN,
    spellcasting: {
      classes: [
        {
          classId: 'tidemender',
          ability: 'wis',
          cantrips: [],
          prepared: ['cure-wounds', 'healing-word'],
          slotKind: 'spell',
        },
      ],
      granted: [],
    },
  },
  ...[1, 2].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WARDEN,
      pool: {
        key: `spell-slot:${level}`,
        label: `level ${level} spell slot`,
        max: 9,
        recovers: 'long-rest',
      },
    }),
  ),
];

const cast = (
  option: string,
  slotLevel: number,
): { readonly healed: number; readonly events: readonly GameEvent[] } => {
  const state = fold('seed', table(option));
  const result = unwrap(
    resolveSpell(
      state,
      WARDEN,
      { spellId: 'cure-wounds', targets: [HURT], slotLevel },
      {
        issuer: createRollIssuer('r', state.rollsIssued),
        rng: createRng('seed'),
        content,
      },
    ),
    'cast',
  );
  return {
    healed: result.outcomes.find((one) => one.target === HURT)?.healed ?? -1,
    events: result.events,
  };
};

const built = (option: string): GameState => fold('seed', table(option));

describe('healing modified by an effect', () => {
  it('is validated beside the printed classes and adds no problem', () => {
    expect(checkContent({ classes: [parsed] })).toEqual([]);
  });

  /** "2 plus the spell slot's level", with this class's own number. */
  it('adds the feature’s flat and the slot’s level to what the spell restored', () => {
    expect(cast('Mercy', 1).healed - cast('Tide', 1).healed).toBe(2);
    expect(cast('Mercy', 2).healed - cast('Tide', 2).healed).toBe(3);
  });

  /** And the log says why the number was what it was. */
  it('names the feature in the healing it added', () => {
    const record = cast('Mercy', 1).events.find(
      (event) => event.type === 'roll-recorded' && event.outcome === 'healed',
    );
    expect(record && record.type === 'roll-recorded' && record.contributions).toContainEqual({
      source: 'Tidal Mercy',
      amount: 2,
    });
  });

  /**
   * **A casting no slot paid for gets nothing**, which is the clause the SRD
   * writes and the one a reader could most easily lose: an item's casting, a
   * Ritual and a free casting from a feature all restore Hit Points and none
   * of them expends a slot.
   */
  it('says nothing about a casting no slot paid for', () => {
    expect(castingHealingBonus(built('Mercy'), WARDEN, { slotLevel: null })).toEqual([]);
    expect(castingHealingBonus(built('Mercy'), WARDEN, { slotLevel: 3 })).toEqual([
      { source: 'Tidal Mercy', flat: 4 },
    ]);
    expect(castingHealingBonus(built('Tide'), WARDEN, { slotLevel: 3 })).toEqual([]);
  });
});
