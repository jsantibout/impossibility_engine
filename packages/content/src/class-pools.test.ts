import { type Content } from '@ie/engine';
import { describe, expect, it } from 'vitest';
import { FOCUS_POINTS, SECOND_WIND_USES, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { abilityModifier } from '@ie/engine';
import { fold, type GameEvent } from '@ie/engine';
import { advanceCharacter, createCharacter, type CharacterChoices } from '@ie/engine';
import {
  declarePool,
  remaining,
  restoreOn,
  spend,
  type ResourcePool,
  type ResourceState,
} from '@ie/engine';
import { hitDieSides } from '@ie/engine';
import { expect as unwrapResource } from '@ie/shared';
import { createRng, type Rng } from '@ie/engine';
import { createRollIssuer, type RollIssuer } from '@ie/engine';
import { resolveTest, takeTestReaction } from '@ie/engine';

/**
 * The repeats of Ability Score Improvement this class's table has printed by
 * this level, answered.
 *
 * SRD prints the feature again at levels 8, 12 and 16 — and at 6 and 14 for
 * a Fighter, and at 10 for a Rogue — and each repeat is a grant of its own
 * with an id of its own. They are filled with the SRD's own Ability Score
 * Improvement feat because it is the only one of these that may be taken more
 * than once, and with Charisma and Intelligence because nothing in this file
 * reads either.
 */
const repeatImprovements = (classId: string, level: number) =>
  Object.fromEntries(
    (SRD_CONTENT.classById(classId)?.features ?? [])
      .filter(
        (one) =>
          one.id.startsWith(`${classId}:ability-score-improvement-`) && one.level <= level,
      )
      .map((one) => [one.id, { featId: 'ability-score-improvement', abilities: ['cha', 'int'] }]),
  );


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
  const made = createCharacter(SRD_CONTENT,choices, WHO);
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
    ...repeatImprovements('paladin', level),
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
    ...repeatImprovements('monk', level),
  },
});

const fighter = (level: number): CharacterChoices => ({
  ...common,
  name: 'Bram',
  classId: 'fighter',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['athletics', 'intimidation'],
  ...(level >= 3 ? { subclassId: 'champion' } : {}),
  cantrips: [],
  preparedSpells: [],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...common.feats,
    'fighter:fighting-style': { featId: 'defense' },
    ...(level >= 4 ? { 'fighter:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
    ...repeatImprovements('fighter', level),
    // SRD Champion, Additional Fighting Style at level 7 — a second style, and
    // it must be a different feat, because none may be taken twice.
    ...(level >= 7 ? { 'champion:additional-fighting-style': { featId: 'archery' } } : {}),
  },
});

/** Ordered by spell level, because the prepared list below is cut to length. */
const SORCERER_CANTRIPS: readonly string[] = [
  'fire-bolt',
  'ray-of-frost',
  'shocking-grasp',
  'acid-splash',
  'light',
];
const SORCERER_SPELLS: readonly string[] = [
  'magic-missile',
  'burning-hands',
  'charm-person',
  'thunderwave',
  'sleep',
  'shatter',
  'hold-person',
];

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
    SRD_CONTENT.classes.flatMap((definition) => [
      ...definition.features,
      ...SRD_CONTENT.subclasses
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
      // "is a pool" joined the two "declared as a pool" phrasings when the
      // recovery features arrived, because that is how their notes say it.
      // Deliberately not a bare "a pool": Instinctive Pounce's note says "Rage
      // itself is only a pool", which is a claim about a *different* feature.
      .filter((f) =>
        /\bdeclared as a pool\b|\bare declared as a pool\b|\b(?:is|are) a pool\b/i.test(
          f.note ?? '',
        ),
      )
      .map((f) => [f.id, f] as const),
  )('%s declares the pool its note claims', (_id, feature) => {
    const grant = feature.grants;
    const declares =
      // The routes by which a feature actually ends up with a pool, and the
      // reason the guard reads the grant rather than counting declarations in
      // one place: `activated` declares one for a feature you switch on, and
      // `pool` for a feature that *is* a resource.
      //
      // **`spells` was a fourth arm and it was wrong.** It stood for "a
      // granted spell's free daily casting, which `freeCastPoolKey` names",
      // and that is true of a **feat** — the loop that calls it reads
      // `choices.feats` and nothing else — so a class feature's `spells`
      // grant declares no pool whatever. The arm had one user, Favored Enemy,
      // whose note claimed a pool it did not have; the note is corrected and
      // the arm goes with it, because an allow-list entry nothing needs is
      // the hole this guard exists to be.
      grant?.kind === 'pool' ||
      (grant?.kind === 'activated' && grant.pool !== null) ||
      // And `recovery`, whose pool holds the one use the feature's own
      // sentence allows it before a Long Rest.
      grant?.kind === 'recovery' ||
      // And `reaction`, which either declares a pool of its own — Indomitable,
      // Dark One's Own Luck — or spends one another feature declared, as
      // Cutting Words spends Bardic Inspiration.
      (grant?.kind === 'reaction' && grant.pool !== undefined);
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

  /**
   * Nine of them when the guard was written, which was the measure of what was
   * being counted for nothing. Wholeness of Body joined them: it had a pool in
   * its note and none in its grant, in exactly the same way.
   */
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
      'wholeness-of-body',
      'wild-shape',
      'wizard:arcane-recovery',
    ]);
  });
});

describe('a Short Rest that gives back one use without emptying the pool', () => {
  /**
   * SRD writes this five times in the same words — Rage, both Channel
   * Divinities, Wild Shape, Second Wind:
   *
   * > "You regain **one** expended use when you finish a Short Rest, and you
   * > regain **all** expended uses when you finish a Long Rest."
   *
   * The `recovers` tag is the second half and is all-or-nothing; this is the
   * first half, and tagging these pools `short-rest` instead would hand a
   * level 1 Fighter their whole Second Wind back after every breather. Five
   * users is what made it a shape rather than Rage's private quirk.
   */
  const spendAll = (pools: ResourceState, key: string): ResourceState => {
    const max = pools.pools[key]?.max ?? 0;
    return unwrapResource(spend(pools, key, max), 'spend');
  };

  const poolsFrom = (choices: CharacterChoices): ResourceState => ({
    pools: poolsOf(choices),
  });

  it('gives back exactly one, not all', () => {
    const key = 'second-wind';
    const fighterAt5 = fighter(5);
    const full = poolsFrom(fighterAt5);
    // Off the class table, not a number this test remembers.
    expect(full.pools[key]?.max).toBe(SECOND_WIND_USES[4]);

    const empty = spendAll(full, key);
    expect(remaining(empty, key)).toBe(0);

    const rested = restoreOn(empty, 'short-rest');
    expect(remaining(rested, key)).toBe(1);
  });

  /** And a Long Rest still gives back all of them. */
  it('gives back all on a Long Rest', () => {
    const key = 'second-wind';
    const empty = spendAll(poolsFrom(fighter(5)), key);
    expect(remaining(restoreOn(empty, 'long-rest'), key)).toBe(SECOND_WIND_USES[4]);
  });

  /** It never overshoots: one back from one spent is a full pool, not more. */
  it('never restores past the maximum', () => {
    const key = 'second-wind';
    const full = poolsFrom(fighter(5));
    const one = unwrapResource(spend(full, key, 1), 'spend');
    const rested = restoreOn(one, 'short-rest');
    expect(remaining(rested, key)).toBe(SECOND_WIND_USES[4]);
    expect(rested.pools[key]?.spent).toBe(0);
  });

  /** A pool with no partial rule is untouched by a Short Rest. */
  it('leaves a plain Long Rest pool alone', () => {
    const key = 'lay-on-hands';
    const empty = spendAll(poolsFrom(paladin(4)), key);
    expect(remaining(restoreOn(empty, 'short-rest'), key)).toBe(0);
    expect(remaining(restoreOn(empty, 'long-rest'), key)).toBe(20);
  });

  /** And a Short Rest pool still empties completely rather than by one. */
  it('still refills an all-or-nothing Short Rest pool whole', () => {
    const key = 'focus-points';
    const empty = spendAll(poolsFrom(monk(5)), key);
    expect(remaining(empty, key)).toBe(0);
    expect(remaining(restoreOn(empty, 'short-rest'), key)).toBe(FOCUS_POINTS[4]);
  });

  /**
   * The rule at the level it is actually written, rather than through a class.
   *
   * Found by mutation: dropping the `short-rest` guard changed nothing, because
   * every feature that has a partial rule is also tagged `long-rest` and so
   * takes the whole-refill branch first. The guard was real and unreachable —
   * a pool that recovered on any *other* event would have been quietly emptied
   * by one on a Long Rest. A hand-built pool is the only way to stand in that
   * gap, and `restoreOn` is a pure function that will take one.
   */
  it('gives back one only on a Short Rest, whatever else the pool recovers on', () => {
    const dawn = unwrapResource(
      declarePool(
        { pools: {} },
        { key: 'moonlight', label: 'Moonlight', max: 3, recovers: 'dawn', regainsOnShortRest: 1 },
      ),
      'declare',
    );
    const empty = unwrapResource(spend(dawn, 'moonlight', 3), 'spend');

    expect(remaining(restoreOn(empty, 'short-rest'), 'moonlight')).toBe(1);
    // A Long Rest is not this pool's event and offers it no partial refill.
    expect(remaining(restoreOn(empty, 'long-rest'), 'moonlight')).toBe(0);
    expect(remaining(restoreOn(empty, 'dawn'), 'moonlight')).toBe(3);
  });

  /** And the amount is validated where it is declared. */
  it('refuses a partial refill that is not a positive whole number', () => {
    const bad = declarePool(
      { pools: {} },
      { key: 'x', label: 'X', max: 3, recovers: 'long-rest', regainsOnShortRest: 0 },
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('bad_partial_recovery');
  });

  /** Every feature the SRD writes this rule for has it, and no other does. */
  it('is declared by exactly the five features whose text says it', () => {
    const withPartial = SRD_CONTENT.classes
      .flatMap((definition) => [
        ...definition.features,
        ...SRD_CONTENT.subclasses
          .filter((s) => s.classId === definition.id)
          .flatMap((s) => s.features),
      ])
      .filter((f) => {
        const grant = f.grants;
        if (grant?.kind === 'pool') return grant.regainsOnShortRest !== undefined;
        if (grant?.kind === 'activated') return grant.regainsOnShortRest !== undefined;
        return false;
      })
      .map((f) => f.id)
      .sort();

    expect(withPartial).toEqual([
      'barbarian:rage',
      'cleric:channel-divinity',
      'druid:wild-shape',
      'fighter:second-wind',
      'paladin:channel-divinity',
    ]);
  });
});

/**
 * The other half of a pool's life: the level that grows it, and the level that
 * grants it in the first place.
 *
 * `poolEvents` has declared every kind of pool since the nine unreachable ones
 * were fixed, and `advanceCharacter` declared **two** of them — the Hit Die
 * pool and the spell slots — because it carried a second list of its own. So a
 * Paladin who reached level 4 in play laid on fifteen hit points where the SRD
 * prints twenty, a Sorcerer's Font of Magic stayed the size it was created at,
 * and a Fighter who reached level 9 in play had Indomitable on the sheet and
 * nothing to spend: `takeTestReaction` refused a Reaction the character was
 * entitled to.
 *
 * That is the failure this repository calls its worst — a wrong number in a
 * shipped path, which looks like a rules bug forever after — so the fix is one
 * derivation both callers reach rather than two lists kept in step by
 * remembering to.
 */
/**
 * SRD Multiclassing, Hit Dice: "If these dice are the same die type, you can
 * pool them together... If your classes give you Hit Dice of different types,
 * track them separately."
 *
 * `hitDicePools` has said exactly that since it was written and was reached by
 * nothing, so `poolsFor` declared a single pool, from the **starting** class,
 * sized at that class's level. That is wrong two different ways, and a
 * multiclassed character meets one or the other whatever they took: a second
 * class whose die differs got no pool at all, and a second class sharing the
 * die was simply not counted.
 */
describe('Hit Dice pool by die type, reached', () => {
  /** Just the Hit Dice, by key and maximum — the pools this rule governs. */
  const hitDiceOf = (pools: Readonly<Record<string, ResourcePool>>) =>
    Object.fromEntries(
      Object.entries(pools)
        .filter(([key]) => hitDieSides(key) !== null)
        .map(([key, pool]) => [key, pool.max]),
    );

  /**
   * A Fighter 4 / Barbarian 1. SRD prints "D10 per Fighter level" and "D12 per
   * Barbarian level" — different types, so tracked separately. Neither class
   * casts, which is what keeps the fixture clear of the one-casting-class rule.
   */
  const berserker = (): CharacterChoices => ({
    ...fighter(4),
    name: 'Hild',
    multiclass: [{ classId: 'barbarian', level: 1 }],
  });

  /**
   * A Paladin 4 / Fighter 1. SRD prints "D10 per Paladin level" and "D10 per
   * Fighter level" — the **same** type, so one pool of five.
   */
  const templar = (): CharacterChoices => ({
    ...paladin(4),
    multiclass: [{ classId: 'fighter', level: 1 }],
    feats: { ...paladin(4).feats, 'fighter:fighting-style': { featId: 'archery' } },
  });

  /** Different dice: two pools, each sized by its own classes' levels. */
  it('tracks two classes whose dice differ as two pools', () => {
    expect(hitDiceOf(poolsOf(berserker()))).toEqual({
      'hit-die:d10': 4,
      'hit-die:d12': 1,
    });
  });

  /**
   * The same die: one pool of the combined level, which is the case the
   * derivation most has to get right — two pools or one of the starting
   * class's level alone are both wrong, and both look plausible.
   */
  it('pools two classes that share a die into one', () => {
    expect(hitDiceOf(poolsOf(templar()))).toEqual({ 'hit-die:d10': 5 });
  });

  /**
   * The whole compatibility story, asserted rather than relied upon: a
   * single-class character's Hit Die pool is byte-identical to what it always
   * was — same key, same label, same maximum, same `recovers`. Both frozen
   * logs fold through this pool, so a change of any of the four moves them.
   */
  it('leaves a single-class character’s pool byte-identical', () => {
    const pools = poolsOf(fighter(9));

    expect(pools['hit-die:d10']).toEqual({
      key: 'hit-die:d10',
      label: 'Hit Die (d10)',
      max: 9,
      spent: 0,
      recovers: 'long-rest',
    });
    // And exactly one of them, so nobody gained a second pool of their own.
    expect(Object.keys(hitDiceOf(pools))).toEqual(['hit-die:d10']);
  });
});

describe('advancing a level moves every pool the level moves', () => {
  const sorcerer = (level: number): CharacterChoices => ({
    ...common,
    name: 'Veska',
    classId: 'sorcerer',
    level,
    abilities: {
      method: 'standard-array',
      assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
    },
    abilityIncreases: { con: 2, int: 1 },
    classSkills: ['arcana', 'persuasion'],
    ...(level >= 3 ? { subclassId: 'draconic-sorcery' } : {}),
    cantrips: SORCERER_CANTRIPS.slice(0, level >= 4 ? 5 : 4),
    preparedSpells: SORCERER_SPELLS.slice(0, level >= 4 ? 7 : 6),
    featureChoices: {
      'human:skillful': ['perception'],
      'sorcerer:metamagic': ['Empowered Spell', 'Quickened Spell'],
    },
    feats: {
      ...common.feats,
      ...(level >= 4 ? { 'sorcerer:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
      ...repeatImprovements('sorcerer', level),
    },
  });

  /** A Paladin 4 / Fighter 1: a level 5 character by two routes at once. */
  const knight = (): CharacterChoices => ({
    ...common,
    name: 'Ser',
    classId: 'paladin',
    level: 4,
    multiclass: [{ classId: 'fighter', level: 1 }],
    subclassId: 'oath-of-devotion',
    abilities: {
      method: 'standard-array',
      // Strength 15 clears the SRD minimum for both classes, in both
      // directions, which is what multiclassing checks.
      assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
    },
    abilityIncreases: { con: 2, int: 1 },
    classSkills: ['athletics', 'persuasion'],
    cantrips: [],
    preparedSpells: ['cure-wounds', 'bless', 'heroism', 'divine-favor', 'shield-of-faith'],
    featureChoices: { 'human:skillful': ['perception'] },
    feats: {
      ...common.feats,
      'paladin:fighting-style': { featId: 'defense' },
      'paladin:ability-score-improvement': { featId: 'savage-attacker' },
      // A different style, because a feat cannot be taken twice.
      'fighter:fighting-style': { featId: 'archery' },
    },
  });

  /** Create, optionally play a little, level up, and hand back both halves. */
  const levelled = (
    choices: CharacterChoices,
    advance: Parameters<typeof advanceCharacter>[3],
    played: readonly GameEvent[] = [],
  ) => {
    const log = [...unwrap(createCharacter(SRD_CONTENT,choices, WHO), 'create'), ...played];
    const gained = unwrap(advanceCharacter(fold('seed', log), SRD_CONTENT, WHO, advance), 'advance');
    return {
      gained,
      log: [...log, ...gained],
      pools: fold('seed', [...log, ...gained]).creatures.who?.resources.pools ?? {},
    };
  };

  const resized = (events: readonly GameEvent[]): readonly string[] =>
    events.filter((e) => e.type === 'resource-pool-resized').map((e) => e.key);

  const declared = (events: readonly GameEvent[]): readonly string[] =>
    events.filter((e) => e.type === 'resource-pool-declared').map((e) => e.pool.key);

  /**
   * SRD Font of Magic: Sorcery Points equal to your Sorcerer level. The
   * cleanest case there is, because the number *is* the level.
   */
  it('resizes a pool the new level grew', () => {
    const { gained, pools } = levelled(sorcerer(3), {
      cantrips: SORCERER_CANTRIPS,
      preparedSpells: SORCERER_SPELLS,
      feats: { 'sorcerer:ability-score-improvement': { featId: 'savage-attacker' } },
    });

    expect(pools['sorcery-points']?.max).toBe(4);
    expect(resized(gained)).toContain('sorcery-points');
    // And declared once, at creation — not a second time here.
    expect(declared(gained)).not.toContain('sorcery-points');
  });

  /**
   * SRD Indomitable arrives at Fighter 9 and not before, so a character who
   * reached 9 in play has no pool until the level declares one. Without it the
   * feature is on the sheet, the window opens, and the Reaction is refused.
   */
  it('declares a pool the new level grants', () => {
    const { gained, pools } = levelled(fighter(8), {
      feats: { 'fighter:ability-score-improvement': { featId: 'savage-attacker' } },
    });

    expect(declared(gained)).toContain('fighter:indomitable');
    expect(pools['fighter:indomitable']?.max).toBe(1);
  });

  /** And the Reaction that pool buys can actually be taken. */
  it('lets the Fighter who levelled into Indomitable spend it', () => {
    const { log } = levelled(fighter(8), {
      feats: { 'fighter:ability-score-improvement': { featId: 'savage-attacker' } },
    });

    const supply = (seed: string): { issuer: RollIssuer; rng: Rng; content: Content } => ({
      issuer: createRollIssuer('r'),
      rng: createRng(seed) as Rng,
      content: SRD_CONTENT,
    });

    // A DC nothing can reach, so the save fails and the window opens.
    const failed = unwrap(
      resolveTest(
        fold('seed', log),
        WHO,
        { kind: 'saving-throw', ability: 'dex', dc: 40 },
        supply('save'),
      ),
      'save',
    );
    expect(failed.offers.map((o) => o.feature)).toEqual(['fighter:indomitable']);

    const after = fold('seed', [...log, ...failed.events]);
    const reroll = takeTestReaction(
      after,
      WHO,
      { feature: 'fighter:indomitable' },
      supply('again'),
    );
    expect(isErr(reroll)).toBe(false);
  });

  /**
   * A resize to the number already stored is an event that says nothing, and
   * the log should not carry one per level per feature. Second Wind is three
   * uses at Fighter 8 and three at 9; Action Surge is one at both.
   */
  it('emits nothing for a pool whose maximum did not move', () => {
    const { gained } = levelled(fighter(8), {
      feats: { 'fighter:ability-score-improvement': { featId: 'savage-attacker' } },
    });

    expect(SECOND_WIND_USES[7]).toBe(SECOND_WIND_USES[8]);
    expect(resized(gained)).not.toContain('second-wind');
    expect(resized(gained)).not.toContain('action-surge');
    expect(declared(gained)).not.toContain('second-wind');
    // The Hit Die pool *did* move, from eight dice to nine.
    expect(resized(gained)).toContain('hit-die:d10');
  });

  /**
   * `resource-pool-resized` changes a maximum and leaves what has been spent
   * spent. A Sorcerer who has burned two points and levels up has four points
   * and has still burned two.
   */
  it('leaves what has been spent spent', () => {
    const { pools } = levelled(
      sorcerer(3),
      {
        cantrips: SORCERER_CANTRIPS,
        preparedSpells: SORCERER_SPELLS,
        feats: { 'sorcerer:ability-score-improvement': { featId: 'savage-attacker' } },
      },
      [{ type: 'resource-spent', id: WHO, key: 'sorcery-points', amount: 2 }],
    );

    expect(pools['sorcery-points']?.max).toBe(4);
    expect(pools['sorcery-points']?.spent).toBe(2);
  });

  /**
   * SRD Lay On Hands: "five times your **Paladin** level". A Paladin 4 /
   * Fighter 1 who takes a fifth level of Paladin is a level *six* character
   * with twenty-five hit points in the pool, not thirty — and a mutation that
   * reads the character level is exactly what this fixture exists to fail.
   */
  it('sizes a pool by its own class’s level, never the character’s', () => {
    const { pools } = levelled(knight(), {
      preparedSpells: ['cure-wounds', 'bless', 'heroism', 'divine-favor', 'shield-of-faith', 'aid'],
    });

    expect(pools['lay-on-hands']?.max).toBe(25);
  });

  /**
   * The other side of the same rule: a level taken in the *other* class moves
   * nothing the first one sized. A Paladin 4 / Fighter 1 who takes a second
   * level of Fighter is a level 6 character and still lays on twenty.
   */
  it('leaves another class’s pool alone when the level goes elsewhere', () => {
    const { gained, pools } = levelled(knight(), { classId: 'fighter' });

    expect(pools['lay-on-hands']?.max).toBe(20);
    expect(resized(gained)).not.toContain('lay-on-hands');
  });

  /**
   * Advancement follows the Hit Dice rule for free, through the same
   * declare-or-resize loop every other pool goes through: a level in a class
   * whose die the character does not yet have **declares** that pool, and the
   * pool they already had is untouched — including what has been spent out of
   * it, which a re-declaration would have reset.
   */
  it('declares a Hit Die pool when a level brings a die the character lacks', () => {
    const { gained, pools } = levelled(fighter(4), { classId: 'barbarian' }, [
      { type: 'resource-spent', id: WHO, key: 'hit-die:d10', amount: 2 },
    ]);

    expect(declared(gained)).toContain('hit-die:d12');
    expect(pools['hit-die:d12']?.max).toBe(1);
    expect(pools['hit-die:d10']?.max).toBe(4);
    expect(pools['hit-die:d10']?.spent).toBe(2);
  });

  /**
   * And the other half: a level in a class whose die they already have
   * **resizes** the one pool rather than declaring a second. A Paladin 4 /
   * Fighter 1 who takes a second Fighter level has six d10, and has still
   * spent the three they spent.
   */
  it('resizes the shared Hit Die pool when the level brings a die it has', () => {
    const { gained, pools } = levelled(knight(), { classId: 'fighter' }, [
      { type: 'resource-spent', id: WHO, key: 'hit-die:d10', amount: 3 },
    ]);

    expect(resized(gained)).toContain('hit-die:d10');
    expect(declared(gained)).not.toContain('hit-die:d10');
    expect(pools['hit-die:d10']?.max).toBe(6);
    expect(pools['hit-die:d10']?.spent).toBe(3);
  });

  /**
   * The refactor guard, and the reason it is an exact ordered list rather than
   * a set: the declarations reach the log, so their *order* is part of what a
   * frozen fixture folds. A derivation shared by two callers is where a
   * behaviour change hides, and this is the assertion that would have caught
   * one — a kind dropped, a kind reordered, a kind arriving twice.
   */
  it('declares the same pools in the same order it always did', () => {
    const built = unwrap(createCharacter(SRD_CONTENT,fighter(9), WHO), 'create');

    expect(declared(built)).toEqual([
      'hit-die:d10',
      'sage:magic-initiate-wizard:free-cast',
      'second-wind',
      'action-surge',
      'fighter:indomitable',
    ]);
  });

  /**
   * SRD progression never shrinks a pool, and this is what says so rather than
   * the code guessing. It is asserted over the *tables* rather than over built
   * characters, because a level moves a pool by exactly two routes — a column
   * of the class table and a multiple of the class level — and an ability
   * modifier does not fall as a character advances.
   *
   * If this ever fires, `advanceCharacter` would emit a `resource-pool-resized`
   * downward, and `resize` clamps `spent` to the new maximum — so a use already
   * spent would quietly come back. That is a rule to design, not a branch to
   * add on a guess, which is why the case is proven absent instead.
   */
  it('has no class table that shrinks a pool as the level rises', () => {
    /** Exactly the structural shape `poolSizeOf` reads a level out of. */
    type Sized = readonly [
      string,
      { readonly usesByLevel?: readonly number[]; readonly perClassLevel?: number },
    ];

    const sizings = SRD_CONTENT.classes
      .flatMap((definition) => [
        ...definition.features,
        ...SRD_CONTENT.subclasses
          .filter((s) => s.classId === definition.id)
          .flatMap((s) => s.features),
      ])
      .flatMap((feature): readonly Sized[] => {
        const grant = feature.grants;
        if (grant?.kind === 'pool') return [[feature.id, grant]];
        if (grant?.kind === 'activated' && grant.pool !== null) return [[feature.id, grant]];
        if (grant?.kind === 'reaction' && grant.declares !== undefined) {
          return [[feature.id, grant.declares]];
        }
        return [];
      });

    // Not vacuous: every pool-declaring feature in the twelve classes.
    expect(sizings.length).toBeGreaterThan(10);

    const falling: string[] = [];
    for (const [featureId, sizing] of sizings) {
      // A multiple of the class level rises with it by construction, so long
      // as the multiple is not negative.
      if (sizing.perClassLevel !== undefined && sizing.perClassLevel < 0) falling.push(featureId);

      const column = sizing.usesByLevel;
      if (column === undefined) continue;
      for (let level = 1; level < column.length; level += 1) {
        if ((column[level] ?? 0) < (column[level - 1] ?? 0)) {
          falling.push(`${featureId}@${level + 1}`);
        }
      }
    }
    expect(falling).toEqual([]);
  });
});
