import { describe, expect, it } from 'vitest';
import { asCharacterId } from '@ie/shared';
import { abilityModifier } from './character.js';
import { fold, type GameEvent } from './events.js';
import { createCharacter, allClasses, allSubclasses, type CharacterChoices } from './creation.js';
import { FOCUS_POINTS } from './monk.js';

/**
 * A feature that *is* a named resource.
 *
 * Nine features were marked executed on the strength of a note saying
 * "declared as a pool", and no pool was ever declared — Bardic Inspiration,
 * both Channel Divinities, Wild Shape, Second Wind, Action Surge, Monk's
 * Focus, Lay On Hands and Sorcery Points. A Bard built by the engine had a Hit
 * Die, three spell-slot pools and a feat's free casting, and nowhere to spend
 * an inspiration from.
 *
 * That is the failure the coverage table exists to prevent, wearing the one
 * disguise it cannot see through: a feature declaring its own automation and
 * being believed. So the last test in this file is the guard — **a note that
 * claims a pool must be a feature that declares one** — and it is worth more
 * than the nine fixes it forced.
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
    'human:versatile': { featId: 'alert' },
  },
};

const poolsOf = (choices: CharacterChoices) => {
  const made = createCharacter(choices, WHO);
  if (!made.ok) throw new Error(`${choices.classId}: ${made.code} — ${made.reason}`);
  return fold('seed', made.value as GameEvent[]).creatures.who?.resources.pools ?? {};
};

const bard = (level: number, cha: number): CharacterChoices => ({
  ...common,
  name: 'Ilva',
  classId: 'bard',
  level,
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['performance', 'stealth', 'deception'],
  ...(level >= 3 ? { subclassId: 'college-of-lore' } : {}),
  cantrips: ['vicious-mockery', 'dancing-lights'],
  // A Bard *knows* rather than prepares: four at level 1, and all of them
  // level 1 spells until a level 2 slot exists to cast one with.
  preparedSpells: ['bane', 'charm-person', 'dissonant-whispers', 'heroism'],
  featureChoices: {
    'human:skillful': ['perception'],
    'bard:expertise': ['performance', 'stealth'],
    ...(level >= 3
      ? { 'college-of-lore:bonus-proficiencies': ['acrobatics', 'athletics', 'insight'] }
      : {}),
  },
});

const paladin = (level: number): CharacterChoices => ({
  ...common,
  name: 'Ser',
  classId: 'paladin',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['athletics', 'persuasion'],
  ...(level >= 3 ? { subclassId: 'oath-of-devotion' } : {}),
  cantrips: [],
  preparedSpells: ['cure-wounds', 'bless', 'heroism', 'divine-favor', 'shield-of-faith'].slice(
    0,
    level >= 4 ? 5 : 2,
  ),
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...common.feats,
    ...(level >= 2 ? { 'paladin:fighting-style': { featId: 'defense' } } : {}),
    ...(level >= 4 ? { 'paladin:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
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
  ...(level >= 3 ? { subclassId: 'warrior-of-the-open-hand' } : {}),
  cantrips: [],
  preparedSpells: [],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...common.feats,
    ...(level >= 4 ? { 'monk:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
  },
});

describe('a pool sized by an ability modifier', () => {
  /**
   * SRD Bardic Inspiration: "a number of times equal to your Charisma modifier
   * (minimum of once)". Three Charismas, three answers, and the floor is the
   * one a fixture would otherwise never reach.
   */
  it('reads the modifier, with the floor the SRD prints', () => {
    expect(poolsOf(bard(1, 17))['bardic-inspiration']?.max).toBe(abilityModifier(17));
    expect(poolsOf(bard(1, 14))['bardic-inspiration']?.max).toBe(abilityModifier(14));
    // Charisma 8 is a -1 modifier; the minimum is one use, not minus one.
    expect(poolsOf(bard(1, 8))['bardic-inspiration']?.max).toBe(1);
  });

  /** SRD: "you regain all expended uses when you finish a Long Rest." */
  it('refills on a Long Rest', () => {
    expect(poolsOf(bard(1, 16))['bardic-inspiration']?.recovers).toBe('long-rest');
  });
});

describe('a pool sized by a multiple of the class level', () => {
  /** SRD Lay On Hands: "five times your Paladin level". */
  it('multiplies the class level', () => {
    expect(poolsOf(paladin(1))['lay-on-hands']?.max).toBe(5);
    expect(poolsOf(paladin(4))['lay-on-hands']?.max).toBe(20);
  });

  /** It is a pool of hit points rather than of uses, which nothing cares about. */
  it('refills on a Long Rest', () => {
    expect(poolsOf(paladin(4))['lay-on-hands']?.recovers).toBe('long-rest');
  });
});

describe('a pool sized by a column of the class table', () => {
  /** SRD Monk's Focus: the Focus Points column, from level 2. */
  it('reads the column at the class’s own level', () => {
    expect(poolsOf(monk(1))['focus-points']).toBeUndefined();
    expect(poolsOf(monk(2))['focus-points']?.max).toBe(FOCUS_POINTS[1]);
    expect(poolsOf(monk(5))['focus-points']?.max).toBe(FOCUS_POINTS[4]);
  });

  /**
   * SRD: "unavailable until you finish a Short or Long Rest, at the end of
   * which you regain **all** your expended points." All-or-nothing, which is
   * what the pool system already says — unlike the Channel Divinities and Wild
   * Shape, which give back *one* on a Short Rest and are tagged Long Rest with
   * the gap named in their notes.
   */
  it('refills on a Short Rest, because this one really is all-or-nothing', () => {
    expect(poolsOf(monk(5))['focus-points']?.recovers).toBe('short-rest');
  });
});

describe('a feature that claims a pool declares one', () => {
  const everyFeature = () =>
    allClasses().flatMap((definition) => [
      ...definition.features,
      ...allSubclasses()
        .filter((s) => s.classId === definition.id)
        .flatMap((s) => s.features),
    ]);

  /**
   * The guard the nine fixes were worth writing.
   *
   * A feature declares its own automation, which is what makes the coverage
   * table readable rather than guessed — and it is also the one claim nothing
   * checked. Nine features said "declared as a pool" in a note, were counted
   * as executed on the strength of it, and declared nothing at all.
   *
   * A note is prose and cannot be parsed for meaning. What it *can* be checked
   * for is this: if it says the word, the feature has to have the thing.
   */
  it('has some, so the rule below is not vacuous', () => {
    const claiming = everyFeature().filter((f) => /\bpool\b/i.test(f.note ?? ''));
    expect(claiming.length).toBeGreaterThan(8);
  });

  it.each(
    everyFeature()
      .filter((f) => /\bdeclared as a pool\b|\bare declared as a pool\b/i.test(f.note ?? ''))
      .map((f) => [f.id, f] as const),
  )('%s declares the pool its note claims', (_id, feature) => {
    const grant = feature.grants;
    const declares =
      // The three routes by which a feature actually ends up with a pool, and
      // the reason the guard reads the grant rather than counting declarations
      // in one place: `activated` declares one for a feature you switch on,
      // `pool` for a feature that *is* a resource, and `spells` for a granted
      // spell's free daily casting, which `freeCastPoolKey` names and
      // `boundaries.test.ts` spends.
      grant?.kind === 'pool' ||
      (grant?.kind === 'activated' && grant.pool !== null) ||
      grant?.kind === 'spells';
    expect(declares).toBe(true);
  });

  /** And every pool grant says how big it is and when it comes back. */
  it.each(
    everyFeature()
      .filter((f) => f.grants?.kind === 'pool')
      .map((f) => [f.id, f] as const),
  )('%s says how big it is and when it refills', (_id, feature) => {
    const grant = feature.grants;
    if (grant?.kind !== 'pool') throw new Error('expected a pool');
    const sized =
      grant.usesByLevel !== undefined ||
      grant.fromAbilityModifier !== undefined ||
      grant.perClassLevel !== undefined ||
      grant.minimum !== undefined;
    expect(sized, `${feature.id} has no size`).toBe(true);
    expect(['short-rest', 'long-rest', 'dawn', 'special']).toContain(grant.recovers);
  });

  /** Nine of them, which is the measure of what was being counted for nothing. */
  it('declares a pool for every class resource the notes name', () => {
    const keys = everyFeature()
      .map((f) => (f.grants?.kind === 'pool' ? f.grants.key : null))
      .filter((k): k is string => k !== null)
      .sort();
    expect(keys).toEqual([
      'action-surge',
      'bardic-inspiration',
      'channel-divinity',
      'channel-divinity',
      'focus-points',
      'lay-on-hands',
      'second-wind',
      'sorcery-points',
      'wild-shape',
      'wizard:arcane-recovery',
    ]);
  });
});
