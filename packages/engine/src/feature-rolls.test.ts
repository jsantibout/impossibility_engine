import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { rollInitiativeFor } from './commands.js';
import { planCharacter, type CharacterChoices } from './creation.js';

/**
 * Features that change a roll the engine already makes.
 *
 * Three of them, and what they have in common is that none adds a *number*:
 * Feral Instinct and Remarkable Athlete grant Advantage on Initiative, and
 * Slippery Mind and Disciplined Survivor add saving-throw proficiencies. Each
 * is read off the creature's own features at the moment of the roll, because
 * a modifier somebody has to remember is one a character silently stops
 * having — the rule Alert's Initiative bonus already established.
 *
 * Advantage rather than a bonus matters: it cancels rather than stacks, so a
 * Barbarian with Disadvantage from somewhere else rolls normally rather than
 * rolling twice and adding.
 */

const id = (s: string) => asCharacterId(s);
const WHO = id('who');

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
    // Deliberately **not** Alert: its Initiative Proficiency is a flat bonus,
    // and mixing it in would blur a test about Advantage with one about a
    // number.
    'human:versatile': { featId: 'skilled', proficiencies: ['arcana', 'history', 'nature'] },
  },
};

const barbarian = (level: number): CharacterChoices => ({
  ...common,
  name: 'Korr',
  classId: 'barbarian',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  ...(level >= 3 ? { subclassId: 'path-of-the-berserker' } : {}),
  cantrips: [],
  preparedSpells: [],
  featureChoices: {
    'human:skillful': ['perception'],
    ...(level >= 3 ? { 'barbarian:primal-knowledge': ['intimidation'] } : {}),
  },
  feats: {
    ...common.feats,
    ...(level >= 4 ? { 'barbarian:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
  },
});

const rogue = (level: number): CharacterChoices => ({
  ...common,
  name: 'Nyx',
  classId: 'rogue',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  subclassId: 'thief',
  cantrips: [],
  preparedSpells: [],
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
    ...(level >= 6 ? { 'rogue:second-expertise': ['acrobatics', 'investigation'] } : {}),
  },
  feats: {
    ...common.feats,
    ...(level >= 4 ? { 'rogue:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
    ...(level >= 8 ? { 'rogue:ability-score-improvement-2': { featId: 'alert' } } : {}),
    ...(level >= 10 ? { 'rogue:ability-score-improvement-3': { featId: 'skilled', proficiencies: ['medicine', 'religion', 'survival'] } } : {}),
    ...(level >= 12 ? { 'rogue:ability-score-improvement-4': { featId: 'savage-attacker' } } : {}),
  },
});

const monk = (level: number): CharacterChoices => ({
  ...common,
  name: 'Tam',
  classId: 'monk',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 15, con: 13, int: 8, wis: 14, cha: 12 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['acrobatics', 'stealth'],
  subclassId: 'warrior-of-the-open-hand',
  cantrips: [],
  preparedSpells: [],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...common.feats,
    ...(level >= 4 ? { 'monk:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
    ...(level >= 8 ? { 'monk:ability-score-improvement-2': { featId: 'alert' } } : {}),
    ...(level >= 12 ? { 'monk:ability-score-improvement-3': { featId: 'savage-attacker' } } : {}),
  },
});

/** Built, or the refusal — so a broken fixture says which rule it broke. */
const sheetOf = (choices: CharacterChoices): CharacterSheet => {
  const plan = planCharacter(choices);
  if (!plan.ok) throw new Error(`${choices.classId} ${choices.level}: ${plan.code} — ${plan.reason}`);
  return plan.value.sheet;
};

const table = (character: CharacterSheet): readonly GameEvent[] => [
  {
    type: 'creature-added',
    id: WHO,
    name: 'who',
    sheet: character,
    maxHp: 60,
    diesAtZero: false,
    creatureType: 'Humanoid',
  },
];

const roll = (character: CharacterSheet, modes: readonly { source: string; mode: 'advantage' | 'disadvantage' }[] = []) =>
  unwrap(
    rollInitiativeFor(
      fold('seed', table(character)),
      WHO,
      createRollIssuer('r'),
      createRng('init') as Rng,
      modes.length === 0 ? {} : { modes },
    ),
    'initiative',
  );

describe('a feature that grants Advantage on Initiative', () => {
  /** SRD Feral Instinct: "you have Advantage on Initiative rolls." */
  it('rolls twice for a Barbarian who has it and once for one who does not', () => {
    expect(roll(sheetOf(barbarian(6))).roll.rolls).toHaveLength(1);
    expect(roll(sheetOf(barbarian(7))).roll.rolls).toHaveLength(2);
  });

  it('names the feature that granted it, so a log can explain the roll', () => {
    const out = roll(sheetOf(barbarian(7)));
    expect(out.modeSources.map((m) => m.source)).toContain('Feral Instinct');
    expect(out.mode).toBe('advantage');
  });

  /**
   * SRD: "Advantage and Disadvantage on the same roll cancel each other." It
   * is presence, not arithmetic — so a Barbarian with one of each rolls a
   * single die, and the feature still appears in the record that says why.
   */
  it('cancels against Disadvantage rather than stacking', () => {
    const out = roll(sheetOf(barbarian(7)), [{ source: 'a swamp', mode: 'disadvantage' }]);
    expect(out.mode).toBe('normal');
    expect(out.roll.rolls).toHaveLength(1);
    expect(out.modeSources.map((m) => m.source).sort()).toEqual(['Feral Instinct', 'a swamp']);
  });

  /** A caller who also knows about the feature must not apply it twice. */
  it('applies once when the caller supplies it too', () => {
    const out = roll(sheetOf(barbarian(7)), [{ source: 'Feral Instinct', mode: 'advantage' }]);
    expect(out.modeSources.filter((m) => m.source === 'Feral Instinct')).toHaveLength(1);
  });

  /** SRD Remarkable Athlete grants the same thing to a Champion at level 3. */
  it('is the same grant on the Champion', () => {
    const champion = sheetOf({
      ...common,
      name: 'Bram',
      classId: 'fighter',
      level: 3,
      abilities: {
        method: 'standard-array',
        assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
      },
      abilityIncreases: { int: 2, wis: 1 },
      classSkills: ['athletics', 'intimidation'],
      subclassId: 'champion',
      cantrips: [],
      preparedSpells: [],
      featureChoices: { 'human:skillful': ['perception'] },
      feats: { ...common.feats, 'fighter:fighting-style': { featId: 'defense' } },
    });
    expect(roll(champion).roll.rolls).toHaveLength(2);
    expect(
      (champion.standing ?? []).filter(
        (e) => e.grant.kind === 'advantage' && e.grant.on === 'skill',
      ),
    ).toHaveLength(1);
  });
});

describe('a feature that adds saving throw proficiencies', () => {
  /** SRD Slippery Mind: "proficiency in Wisdom and Charisma saving throws." */
  it('adds the two the Rogue’s feature names, at the level it names them', () => {
    expect([...sheetOf(rogue(14)).saveProficiencies].sort()).toEqual(['dex', 'int']);
    expect([...sheetOf(rogue(15)).saveProficiencies].sort()).toEqual(['cha', 'dex', 'int', 'wis']);
  });

  /** SRD Disciplined Survivor: "proficiency in all saving throws." */
  it('adds all six for the Monk', () => {
    expect([...sheetOf(monk(13)).saveProficiencies].sort()).toEqual(['dex', 'str']);
    expect([...sheetOf(monk(14)).saveProficiencies].sort()).toEqual([
      'cha',
      'con',
      'dex',
      'int',
      'str',
      'wis',
    ]);
  });

  /**
   * Proficiency is binary, so a feature naming one the class already had is a
   * no-op rather than a doubling — the same rule overlapping skill
   * proficiencies follow, and the reason the union is a `Set`.
   */
  it('unions rather than counts', () => {
    const all = sheetOf(monk(14)).saveProficiencies;
    expect(new Set(all).size).toBe(all.length);
    // Strength and Dexterity were the Monk's from level 1 and appear once.
    expect(all.filter((a) => a === 'str')).toHaveLength(1);
  });
});
