import { describe, expect, it } from 'vitest';
import { BARBARIAN, FOCUS_POINTS, MARTIAL_ARTS_DIE, MONK, RAGE_DAMAGE, RAGES_PER_REST, SRD_CONTENT, UNARMORED_MOVEMENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { armorClass, armorClassCalculation } from '@ie/engine';
import { fold, type GameEvent, type GameState } from '@ie/engine';
import { carrying } from '@ie/engine';
import { createCharacter, planCharacter, type CharacterChoices } from '@ie/engine';
import { createRng, createRollIssuer, useRecovery } from '@ie/engine';
import { repeatImprovements } from './advancement-slots.js';

/**
 * The Barbarian and the Monk, which are the same class twice in the one place
 * the engine cannot yet go.
 *
 * Both have **Unarmoured Defense** and both compute Armour Class a way the
 * engine has no room for — 10 + Dexterity + Constitution for one, 10 +
 * Dexterity + Wisdom for the other. Two classes wanting the same missing hook
 * is worth more than one wanting it: it says the gap is a *shape*, a class
 * feature that replaces the Armour Class calculation, rather than a quirk of
 * whichever class arrived first.
 *
 * Everything else about them is transcription onto structures with several
 * users each, so what is tested here is the growth tables — the part a
 * transcription actually gets wrong — and that the shared suite in
 * `progression.test.ts` covers the rest.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');
const SHAN = id('shan');

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  backgroundEquipment: 'A' as const,
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
};

const originFeats = {
  'sage:magic-initiate-wizard': {
    featId: 'magic-initiate',
    spellList: 'wizard',
    spellcastingAbility: 'int' as const,
    cantrips: ['mage-hand', 'light'],
    levelOneSpell: 'find-familiar',
  },
  'human:versatile': { featId: 'alert' },
};

const barbarian = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Grum',
  classId: 'barbarian',
  level: 3,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  subclassId: 'path-of-the-berserker',
  classEquipment: 'A',
  equipped: [],
  featureChoices: {
    'human:skillful': ['perception'],
    'barbarian:primal-knowledge': ['intimidation'],
  },
  feats: originFeats,
  ...over,
});

const monk = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Shan',
  classId: 'monk',
  level: 5,
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['acrobatics', 'stealth'],
  subclassId: 'warrior-of-the-open-hand',
  classEquipment: 'A',
  equipped: [],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: { ...originFeats, 'monk:ability-score-improvement': { featId: 'savage-attacker' } },
  ...over,
});

const built = (choices: CharacterChoices, who: ReturnType<typeof id>): GameState =>
  fold('seed', unwrap(createCharacter(SRD_CONTENT,choices, who), 'create') as GameEvent[]);

describe('the Barbarian', () => {
  /** SRD: 2 Rages at level 1, rising to 6 at 17; damage +2 to +4. */
  it('grows its Rage table the way the SRD prints it', () => {
    expect(RAGES_PER_REST[0]).toBe(2);
    expect(RAGES_PER_REST[19]).toBe(6);
    expect(RAGE_DAMAGE[0]).toBe(2);
    expect(RAGE_DAMAGE[19]).toBe(4);
    for (let i = 1; i < RAGES_PER_REST.length; i += 1) {
      expect(RAGES_PER_REST[i] ?? 0).toBeGreaterThanOrEqual(RAGES_PER_REST[i - 1] ?? 0);
      expect(RAGE_DAMAGE[i] ?? 0).toBeGreaterThanOrEqual(RAGE_DAMAGE[i - 1] ?? 0);
    }
  });

  it('casts nothing and has the biggest hit die in the game', () => {
    expect(BARBARIAN.spellcasting).toBeUndefined();
    expect(BARBARIAN.hitDie).toBe(12);
    const plan = unwrap(planCharacter(SRD_CONTENT,barbarian()), 'plan');
    // Level 3, d12, Constitution 16 (+3): 12 + 7 + 7 + 3×3 = 35.
    expect(plan.hitPointMaximum).toBe(35);
  });

  /** SRD Primal Knowledge: one more skill from the class's own list. */
  it('takes an extra skill proficiency at level 3', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT,barbarian()), 'plan');
    expect(plan.sheet.skills.intimidation).toBe('proficient');
  });

  it('refuses a Primal Knowledge skill the class does not offer', () => {
    const result = planCharacter(
      SRD_CONTENT,
      barbarian({
        featureChoices: {
          'human:skillful': ['perception'],
          'barbarian:primal-knowledge': ['arcana'],
        },
      }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('skill_not_offered');
  });

  it('starts with the package the SRD prints', () => {
    const held = carrying(built(barbarian(), GRUM), GRUM).map((line) => line.id);
    expect(held).toContain('greataxe');
    expect(carrying(built(barbarian(), GRUM), GRUM)).toContainEqual({
      id: 'handaxe',
      quantity: 4,
    });
  });
});

describe('the Monk', () => {
  /** SRD Martial Arts: 1d6 to 1d12, stepping at levels 5, 11 and 17. */
  it('grows its Martial Arts die at the levels the SRD prints', () => {
    expect(MARTIAL_ARTS_DIE[0]).toBe('1d6');
    expect(MARTIAL_ARTS_DIE[4]).toBe('1d8');
    expect(MARTIAL_ARTS_DIE[10]).toBe('1d10');
    expect(MARTIAL_ARTS_DIE[16]).toBe('1d12');
  });

  /**
   * SRD Martial Arts, and the two sentences that had to stay apart.
   *
   * The Core Monk Traits table prints "Simple weapons and Martial weapons that
   * have the Light property" as the *proficiencies*; the feature prints "Simple
   * Melee weapons" and "Martial Melee weapons that have the Light property" as
   * the **Monk weapons** its benefits read. They are different sets — a Monk is
   * proficient with a Light Crossbow and it is not a Monk weapon — so the
   * feature declares its own rather than pointing at the class's.
   */
  it('declares its Monk weapons on the feature and not on the class', () => {
    expect(MONK.weaponProficiencies).toEqual(['simple', 'martial-light']);

    const martialArts = MONK.features.find((one) => one.id === 'monk:martial-arts');
    expect(martialArts?.automation).toBe('engine');
    expect(martialArts?.grants).toEqual({
      kind: 'strike-style',
      weapons: [
        { category: 'simple', kind: 'melee' },
        { category: 'martial', kind: 'melee', properties: ['light'] },
      ],
      dieByLevel: MARTIAL_ARTS_DIE,
      ability: 'dex',
      bonusUnarmedStrike: true,
      whileWieldingOnly: true,
      requires: [{ kind: 'unarmored' }],
    });
  });

  /** And a Monk's sheet carries the die of the level they were built at. */
  it('compiles the style onto the sheet at that class’s own level', () => {
    const shan = built(monk(), SHAN).creatures.shan!.sheet;
    expect(shan.strikeStyles?.map((style) => style.source)).toEqual(['monk:martial-arts']);
    // The fixture is a Monk 5, whose Martial Arts column reads 1d8.
    expect(shan.strikeStyles?.[0]?.die).toBe(MARTIAL_ARTS_DIE[4]);
  });

  /** SRD: Focus Points equal Monk level, and there are none before level 2. */
  it('has no Focus Points at level 1 and its level thereafter', () => {
    expect(FOCUS_POINTS[0]).toBe(0);
    for (let level = 2; level <= 20; level += 1) {
      expect(FOCUS_POINTS[level - 1]).toBe(level);
    }
  });

  /** SRD Unarmored Movement: nothing at 1, +10 at 2, rising to +30 at 18. */
  it('grows Unarmoured Movement the way the SRD prints it', () => {
    expect(UNARMORED_MOVEMENT[0]).toBe(0);
    expect(UNARMORED_MOVEMENT[1]).toBe(10);
    expect(UNARMORED_MOVEMENT[19]).toBe(30);
  });

  it('casts nothing, and wears nothing', () => {
    expect(MONK.spellcasting).toBeUndefined();
    expect(MONK.armorTraining).toEqual({
      light: false,
      medium: false,
      heavy: false,
      shields: false,
    });
  });

  it('starts with the package the SRD prints', () => {
    const carried = carrying(built(monk(), SHAN), SHAN);
    expect(carried).toContainEqual({ id: 'dagger', quantity: 5 });
    expect(carried.map((l) => l.id)).toContain('spear');
  });
});

describe('two classes want the same hook, with two different rules', () => {
  /**
   * Unarmoured Defense was the first class feature to need somewhere to reach
   * the Armour Class calculation, and two classes wanting it with *different*
   * abilities is what made it a shape rather than one class's quirk. It is
   * applied now, and the two differ in both halves — Constitution against
   * Wisdom, and a Shield allowed against a Shield forbidden.
   */
  it('gives each class its own ability', () => {
    const grum = built(barbarian(), GRUM).creatures.grum!.sheet;
    const shan = built(monk(), SHAN).creatures.shan!.sheet;

    expect(grum.armor).toBeNull();
    expect(shan.armor).toBeNull();
    // Dexterity 13 (+1) and Constitution 16 (+3); Dexterity 15 (+2) and Wisdom 15 (+2).
    expect(armorClass(grum)).toBe(14);
    expect(armorClass(shan)).toBe(14);
    expect(armorClassCalculation(grum).source).toBe('barbarian:unarmored-defense');
    expect(armorClassCalculation(shan).source).toBe('monk:unarmored-defense');

    const barbarianFeature = BARBARIAN.features.find((f) => f.id === 'barbarian:unarmored-defense');
    const monkFeature = MONK.features.find((f) => f.id === 'monk:unarmored-defense');
    expect(barbarianFeature?.automation).toBe('engine');
    expect(monkFeature?.automation).toBe('engine');
    expect(barbarianFeature?.grants).toMatchObject({ ability: 'con', shieldAllowed: true });
    expect(monkFeature?.grants).toMatchObject({ ability: 'wis', shieldAllowed: false });
  });

  /**
   * SRD Barbarian: "You can use a Shield and still gain this benefit." SRD
   * Monk: "while you aren't wearing armor **or wielding a Shield**". So the
   * same Shield helps one of them and costs the other their whole feature.
   */
  it('reads the Shield clause each class actually prints', () => {
    const grum = built(barbarian(), GRUM).creatures.grum!.sheet;
    const shan = built(monk(), SHAN).creatures.shan!.sheet;
    const shield = SRD_CONTENT.item('shield')?.armor ?? null;

    expect(armorClass({ ...grum, shield })).toBe(16);

    // The Monk falls back to 10 + Dexterity — and gains nothing from the
    // Shield either, because a Monk has no Shield training. Picking one up
    // costs them two points of Armour Class and buys nothing.
    expect(armorClass({ ...shan, shield })).toBe(12);
    expect(shan.armorTraining.shields).toBe(false);
    expect(armorClassCalculation({ ...shan, shield }).source).toBeNull();
  });
});

/**
 * SRD Persistent Rage, whose first sentence is Uncanny Metabolism's with the
 * Monk's pool swapped out.
 *
 * > "When you roll Initiative, you can regain all expended uses of Rage.
 * > After you regain uses of Rage in this way, you can't do so again until
 * > you finish a Long Rest."
 *
 * Half a feature, which is why it keeps its note: the ten-minute Rage that
 * needs no extending, and the ending on Unconscious rather than Incapacitated,
 * are a feature rewriting another feature's activation and have no shape.
 * What the grant does carry is driven here, because a recovery that reaches
 * the sheet and refills nothing is exactly the failure `class-pools.test.ts`
 * was written for.
 */
describe("a Barbarian's Persistent Rage gives the Rages back", () => {
  const atLevel = (level: number): CharacterChoices =>
    barbarian({
      level,
      feats: {
        ...originFeats,
        ...(level >= 4 ? { 'barbarian:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
        ...repeatImprovements('barbarian', level),
      },
    });

  const logAt = (level: number): readonly GameEvent[] =>
    unwrap(createCharacter(SRD_CONTENT, atLevel(level), GRUM), 'create') as GameEvent[];

  const recoveries = (level: number) =>
    (fold('seed', logAt(level)).creatures.grum?.sheet.recoveries ?? []).map((r) => r.feature);

  it('arrives at the level the Barbarian table prints it, and not before', () => {
    expect(recoveries(14)).not.toContain('barbarian:persistent-rage');
    expect(recoveries(15)).toContain('barbarian:persistent-rage');
  });

  /** "regain **all** expended uses of Rage" — the whole pool, at Initiative. */
  it('refills the Rage pool at the first turn of a fight, once per Long Rest', () => {
    const log: GameEvent[] = [
      ...logAt(15),
      { type: 'combat-started', combatants: [{ id: GRUM, initiative: 20, speed: 30 }] },
      { type: 'resource-spent', id: GRUM, key: 'rage', amount: 5 },
    ];
    const before = fold('seed', log);
    const rage = before.creatures.grum!.resources.pools['rage']!;
    expect(rage.max - rage.spent).toBe(0);

    const supply = { issuer: createRollIssuer('r'), rng: createRng('seed') };
    const used = unwrap(
      useRecovery(before, GRUM, { feature: 'barbarian:persistent-rage' }, supply),
      'recovery',
    );
    const after = fold('seed', [...log, ...used]);
    const back = after.creatures.grum!.resources.pools['rage']!;
    expect(back.spent).toBe(0);

    // Its own limit is a pool of one, spent by the use and refilling on a
    // Long Rest — which is what "you can't do so again until" means.
    const own = after.creatures.grum!.resources.pools['barbarian:persistent-rage']!;
    expect(own.max).toBe(1);
    expect(own.spent).toBe(1);
    expect(own.recovers).toBe('long-rest');

    expect(
      isErr(useRecovery(after, GRUM, { feature: 'barbarian:persistent-rage' }, supply)),
    ).toBe(true);
  });
});
