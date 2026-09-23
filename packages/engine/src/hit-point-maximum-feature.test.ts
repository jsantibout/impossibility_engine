import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import { checkContent, extendContent, loadContent } from './content.js';
import { fold, type GameEvent } from './events.js';
import {
  advanceCharacter,
  createCharacter,
  planCharacter,
  type CharacterChoices,
} from './creation.js';

/**
 * A feature that raises the hit point maximum.
 *
 * The *spell* half of this has been built since Aid: a `hit-point-maximum`
 * effect hangs a sourced grant on the creature, `settleHitPointMaxima`
 * reconciles `Vitals.hpMax` in the fold's derived pass, and every ending gives
 * it back. **A feature's maximum is the other lifetime and must not go through
 * that path**: SRD Dwarven Toughness is not a loan that a source match
 * releases, it is part of what the class table says the maximum *is* — the
 * number `hpMax - hpMaxAdjustment` denotes, recomputed by every level-up.
 *
 * So the grant feeds `planCharacter`'s own arithmetic, which is what makes
 * `advanceCharacter` right for free: it already subtracts the *unadjusted*
 * maximum before asking what the level was worth, so a Dwarf who levels up
 * under an Aid gets the level's hit points and the trait's one, and the
 * spell's five are still the spell's.
 *
 * Driven through a homebrew class for `content.test.ts`'s reason — a mechanic
 * proved only against the book's own catalogue might be reading the book — and
 * through the printed Dwarf for the other half of the same argument: the SRD
 * trait this shape was built for has to really arrive on a sheet.
 */

const id = (s: string) => asCharacterId(s);
const WHO = id('thrain');

/**
 * A class with a d10 and nothing else to say.
 *
 * Every choice a printed class asks — a subclass, a Fighting Style, an Ability
 * Score Improvement, a spellbook — is noise against the one number these tests
 * are about, so the class asks none of them and the species is the only thing
 * that moves.
 */
const WARDEN = {
  id: 'warden',
  name: 'Warden',
  primaryAbility: 'con',
  hitDie: 10,
  saveProficiencies: ['str', 'con'],
  skillChoices: { choose: 2, from: ['athletics', 'survival', 'insight', 'perception'] },
  weaponProficiencies: ['simple', 'martial'],
  armorTraining: { light: true, medium: true, heavy: false, shields: true },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    proficiencyBonus: 2 + Math.floor(i / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'longsword', quantity: 1 }], goldPieces: 10 }],
  multiclass: {
    weapons: ['martial'],
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    tools: [],
  },
  features: [
    {
      id: 'warden:subclass',
      name: 'Warden’s Charge',
      level: 3,
      automation: 'engine',
      note: 'The charge is chosen at level 3, as every class chooses a subclass.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
  ],
};

const CHARGE = { id: 'warden-of-stone', name: 'Warden of Stone', classId: 'warden', features: [] };

const CONTENT = unwrap(
  extendContent(SRD_CONTENT, { classes: [WARDEN as never], subclasses: [CHARGE as never] }),
  'extend',
);

/**
 * A level `level` Warden of whichever species, with every other choice made.
 *
 * Constitution is 13 from the array and 15 after the background's two points,
 * so the modifier is +2 at every level and the arithmetic below is one sum.
 */
const warden = (
  level: number,
  speciesId: string,
  over: Partial<CharacterChoices> = {},
): CharacterChoices => ({
  name: 'Thrain',
  classId: 'warden',
  level,
  speciesId,
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, int: 1 },
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
  ...(level >= 3 ? { subclassId: 'warden-of-stone' } : {}),
  featureChoices: speciesId === 'human' ? { 'human:skillful': ['perception'] } : {},
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    ...(speciesId === 'human' ? { 'human:versatile': { featId: 'alert' } } : {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'none' },
  ...over,
});

const maximumOf = (level: number, speciesId: string): number =>
  unwrap(planCharacter(CONTENT, warden(level, speciesId)), 'plan').hitPointMaximum;

/** The d10 and the +2, as the class table alone writes it. */
const fromTheTable = (level: number): number => 12 + (level - 1) * 8;

describe('a species trait that raises the hit point maximum', () => {
  /**
   * SRD Dwarven Toughness: "Your Hit Point maximum increases by 1, and it
   * increases by 1 again whenever you gain a level."
   *
   * Three readings of that sentence are available and two of them are wrong.
   * At level 1 the trait is worth **1**, not 2 — no level has been gained yet,
   * so the "again" has not happened — and at level 5 it is worth **5**, not 1
   * (the flat alone) and not 6 (the flat plus one for every level including
   * the first).
   */
  it('is worth one hit point at level 1', () => {
    expect(maximumOf(1, 'dwarf')).toBe(fromTheTable(1) + 1);
    expect(maximumOf(1, 'human')).toBe(fromTheTable(1));
  });

  it('is worth five at level 5, which is the "again" and not a second flat', () => {
    expect(maximumOf(5, 'dwarf')).toBe(fromTheTable(5) + 5);
    expect(maximumOf(5, 'dwarf')).not.toBe(fromTheTable(5) + 1);
    expect(maximumOf(5, 'dwarf')).not.toBe(fromTheTable(5) + 6);
    expect(maximumOf(5, 'human')).toBe(fromTheTable(5));
  });

  /**
   * And the level-up is the level's hit points and the trait's one hit point
   * and nothing else — the difference between two maxima rather than a number
   * anybody writes down twice.
   */
  it('raises the maximum by the level’s hit points and one more when a level is gained', () => {
    const log = unwrap(createCharacter(CONTENT, warden(4, 'dwarf'), WHO), 'create');
    const raised = unwrap(
      advanceCharacter(fold('seed', log), CONTENT, WHO, {}),
      'advance',
    ).filter((event) => event.type === 'hit-point-maximum-raised');

    expect(raised).toHaveLength(1);
    expect(raised[0]).toEqual({ type: 'hit-point-maximum-raised', id: WHO, amount: 9 });

    const human = unwrap(createCharacter(CONTENT, warden(4, 'human'), WHO), 'create');
    expect(
      unwrap(advanceCharacter(fold('seed', human), CONTENT, WHO, {}), 'advance').filter(
        (event) => event.type === 'hit-point-maximum-raised',
      ),
    ).toEqual([{ type: 'hit-point-maximum-raised', id: WHO, amount: 8 }]);
  });

  /**
   * The two numbers are different lifetimes and the test that says so: a
   * Dwarf under SRD Aid has five hit points of maximum that a source match
   * will take away, and one per level that nothing ever will.
   */
  it('leaves a running spell’s adjustment alone, and is left alone by it', () => {
    const log: GameEvent[] = [
      ...unwrap(createCharacter(CONTENT, warden(4, 'dwarf'), WHO), 'create'),
      {
        type: 'hit-point-maximum-adjusted',
        id: WHO,
        adjustment: { source: 'Aid#cast:1', amount: 5 },
      },
    ];

    const under = fold('seed', log);
    expect(under.creatures[WHO]?.vitals.hpMax).toBe(fromTheTable(4) + 4 + 5);
    expect(under.creatures[WHO]?.vitals.hpMaxAdjustment).toBe(5);

    const after = fold('seed', [
      ...log,
      ...unwrap(advanceCharacter(under, CONTENT, WHO, {}), 'advance'),
    ]);
    expect(after.creatures[WHO]?.vitals.hpMax).toBe(fromTheTable(5) + 5 + 5);
    expect(after.creatures[WHO]?.vitals.hpMaxAdjustment).toBe(5);
  });
});

/**
 * And the level a trait that belongs to no class is read at.
 *
 * A class table is read at that class's own level; a species has no table and
 * its sentences are written in character levels, so a column on an origin
 * feature is read at the **character's**. The fallback used to be the starting
 * class's level, which is the same number for everybody who never
 * multiclassed and quietly wrong for everybody who did.
 */
describe('a column on a feature that belongs to no class', () => {
  const STONEBORN = {
    id: 'stoneborn',
    name: 'Stoneborn',
    creatureType: 'Humanoid',
    sizes: ['Medium'],
    speed: 30,
    features: [
      {
        id: 'stoneborn:enduring',
        name: 'Enduring',
        level: 1,
        automation: 'engine',
        note: 'One use per character level, which is the only level a species has.',
        grants: {
          kind: 'pool',
          key: 'enduring',
          label: 'Enduring',
          usesByLevel: Array.from({ length: 20 }, (_, index) => index + 1),
          recovers: 'long-rest',
          heals: { dice: '1d4', plus: 'class-level', action: 'bonus-action' },
        },
      },
    ],
  };

  const world = unwrap(extendContent(CONTENT, { species: [STONEBORN as never] }), 'extend');

  const uses = (choices: CharacterChoices): number | undefined =>
    unwrap(createCharacter(world, choices, WHO), 'create')
      .flatMap((event) =>
        event.type === 'resource-pool-declared' ? [event.pool as { key: string; max: number }] : [],
      )
      .find((pool) => pool.key === 'enduring')?.max;

  it('is read at the character’s level, whichever class came first', () => {
    expect(uses(warden(5, 'stoneborn'))).toBe(5);
    // A Warden 3 / Fighter 2 is a level 5 character, and the trait is the
    // character's rather than either class's.
    expect(
      uses(
        warden(3, 'stoneborn', {
          multiclass: [{ classId: 'fighter', level: 2 }],
          feats: {
            'sage:magic-initiate-wizard': {
              featId: 'magic-initiate',
              spellList: 'wizard',
              spellcastingAbility: 'int',
              cantrips: ['mage-hand', 'ray-of-frost'],
              levelOneSpell: 'find-familiar',
            },
            'fighter:fighting-style': { featId: 'defense' },
          },
        }),
      ),
    ).toBe(5);
  });
});

/**
 * The vocabulary is the engine's and the trait is content's, so a world that
 * is not the SRD says the same sentence through the same door — and is
 * refused the two ways of writing a number that is not one.
 */
describe('a homebrew species says it through loadContent', () => {
  const species = (grants: unknown) => ({
    id: 'stoneborn',
    name: 'Stoneborn',
    creatureType: 'Humanoid',
    sizes: ['Medium'],
    speed: 30,
    features: [
      {
        id: 'stoneborn:granite-heart',
        name: 'Granite Heart',
        level: 1,
        automation: 'engine',
        note: 'Your Hit Point maximum increases by 2, and by 2 again at every level.',
        grants,
      },
    ],
  });

  const sound = { kind: 'hit-point-maximum', flat: 2, perLevel: 'character' };

  it('loads from JSON text and raises the maximum it was given', () => {
    const text = JSON.stringify({ species: [species(sound)] });
    const loaded = unwrap(loadContent(JSON.parse(text)), 'load');
    const whole = unwrap(extendContent(CONTENT, { species: [...loaded.species] }), 'extend');

    const plan = unwrap(planCharacter(whole, warden(5, 'stoneborn')), 'plan');
    expect(plan.hitPointMaximum).toBe(fromTheTable(5) + 2 + 4);
  });

  it('refuses a flat that grants nothing', () => {
    const problems = checkContent({ species: [species({ ...sound, flat: 0 }) as never] });
    expect(problems.map((one) => one.code)).toContain('bad_hit_point_maximum');
    expect(problems.map((one) => one.field)).toContain('species[stoneborn].features[0].grants.flat');
  });

  it('refuses a flat that is not a whole number of hit points', () => {
    expect(
      checkContent({ species: [species({ ...sound, flat: 1.5 }) as never] }).map((one) => one.code),
    ).toContain('bad_hit_point_maximum');
  });

  it('refuses a per-level term the engine has no level to read', () => {
    expect(
      checkContent({ species: [species({ ...sound, perLevel: 'epoch' }) as never] }).map(
        (one) => one.code,
      ),
    ).toContain('bad_hit_point_maximum');
  });
});
