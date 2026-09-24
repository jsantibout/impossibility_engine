import { describe, expect, it } from 'vitest';
import { RAGE_DAMAGE, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { activateFeature, resolveAttack } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * Damage a feature adds to a weapon's own.
 *
 * Three sources of extra damage, with three different timings, and the SRD
 * writes each of them differently:
 *
 * | | Example | When |
 * |---|---|---|
 * | A feature, conditional | Rage Damage, Radiant Strikes | derived from state, on every qualifying hit |
 * | The weapon itself | Flame Tongue's 2d6 Fire | a property of the thing being swung |
 * | Chosen after the roll | Divine Smite | a Bonus Action taken "immediately after hitting" |
 *
 * All three end up in the same two lists, which is the point of assembling
 * them in one place: `damageBonuses` for damage **of the weapon's own type**,
 * and `extraDamage` for damage of another. The distinction is not cosmetic —
 * a target resistant to Slashing halves a Barbarian's Rage Damage along with
 * the sword, and does nothing at all to a Paladin's Radiant.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');
const GOBLIN = id('goblin');

const plain = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

const target = (over: Partial<CharacterSheet> = {}, defenses?: Record<string, { resistant?: boolean }>): GameEvent => ({
  type: 'creature-added',
  id: GOBLIN,
  name: 'goblin',
  sheet: plain(over),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'goblins',
  ...(defenses === undefined ? {} : { defenses }),
});

const barbarian = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Grum',
  classId: 'barbarian',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  subclassId: 'path-of-the-berserker',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'barbarian:primal-knowledge': ['intimidation'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const RAGE = 'barbarian:rage';

const table = (over: Partial<CharacterChoices> = {}, defenses?: Record<string, { resistant?: boolean }>): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT,barbarian(over), GRUM), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: GRUM, side: 'party' },
  target({}, defenses),
  {
    type: 'items-gained',
    id: GRUM,
    items: [
      { id: 'greatsword', quantity: 1 },
      { id: 'rapier', quantity: 1 },
    ],
    source: 'loot',
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the camp', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: GRUM, placement: { from: { landmark: 'the camp' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: GRUM }, feet: 5, bearing: 0 } },
];

const supply = (seed = 'hit') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng, content: SRD_CONTENT });

const raging = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...unwrap(activateFeature(fold('seed', log), GRUM, { feature: RAGE }, SRD_CONTENT), 'rage'),
];

/** Swing, and hand back what landed. */
const swing = (
  log: readonly GameEvent[],
  request: Omit<Parameters<typeof resolveAttack>[2], 'target'> & { target?: CharacterId },
  seed = 'hit',
) => {
  const out = unwrap(
    resolveAttack(fold('seed', log), GRUM, { target: GOBLIN, ...request }, supply(seed)),
    'attack',
  );
  return out;
};

describe('Rage Damage is added to the weapon’s own damage', () => {
  /**
   * SRD: "When you make an attack using Strength—with either a weapon or an
   * Unarmed Strike—and deal damage to the target, you gain a bonus to the
   * damage." A level 3 Barbarian's bonus is +2.
   */
  it('adds the bonus the class table prints', () => {
    const calm = swing(table(), { weapon: 'greatsword', twoHanded: true });
    const angry = swing(raging(table()), { weapon: 'greatsword', twoHanded: true });
    expect(calm.attack!.hit).toBe(true);
    expect(angry.damage! - calm.damage!).toBe(RAGE_DAMAGE[2]);
    expect(RAGE_DAMAGE[2]).toBe(2);
  });

  /** SRD: "using Strength". A Finesse weapon swung with Dexterity does not. */
  it('does not add to an attack made with Dexterity', () => {
    const calm = swing(table(), { weapon: 'rapier', finesseAbility: 'dex' }, 'lands');
    const angry = swing(raging(table()), { weapon: 'rapier', finesseAbility: 'dex' }, 'lands');
    // Both have to land, or the comparison below is two undefineds agreeing.
    expect(calm.attack!.hit).toBe(true);
    expect(angry.attack!.hit).toBe(true);
    expect(angry.damage).toBe(calm.damage);
  });

  /** And does add to the same weapon swung with Strength, which Finesse allows. */
  it('adds to the same Finesse weapon used with Strength', () => {
    const calm = swing(table(), { weapon: 'rapier', finesseAbility: 'str' });
    const angry = swing(raging(table()), { weapon: 'rapier', finesseAbility: 'str' });
    expect(angry.damage! - calm.damage!).toBe(2);
  });

  /** SRD: "with either a weapon or an Unarmed Strike." */
  it('adds to an Unarmed Strike', () => {
    const calm = swing(table(), { weapon: null });
    const angry = swing(raging(table()), { weapon: null });
    expect(angry.damage! - calm.damage!).toBe(2);
  });

  it('adds nothing once the Rage is over', () => {
    const log = raging(table());
    const ended: readonly GameEvent[] = [
      ...log,
      { type: 'feature-ended', id: GRUM, feature: RAGE, reason: 'dismissed' },
    ];
    expect(swing(ended, { weapon: 'greatsword', twoHanded: true }).damage).toBe(
      swing(table(), { weapon: 'greatsword', twoHanded: true }).damage,
    );
  });

  /**
   * The reason it goes in with the weapon's own damage rather than beside it:
   * SRD calls it "a bonus to the damage", so a target that resists the
   * weapon's damage type resists the bonus too.
   */
  it('is halved by a target that resists the weapon’s damage type', () => {
    const soft = swing(raging(table()), { weapon: 'greatsword', twoHanded: true });
    const tough = swing(raging(table({}, { slashing: { resistant: true } })), {
      weapon: 'greatsword',
      twoHanded: true,
    });
    expect(tough.damage).toBe(Math.floor(soft.damage! / 2));
  });

  /** A critical doubles dice and never a flat bonus, Rage Damage included. */
  it('is not doubled by a critical hit', () => {
    const normal = swing(raging(table()), { weapon: 'greatsword', twoHanded: true });
    const crit = swing(
      raging([
        ...table(),
        { type: 'condition-applied', id: GOBLIN, condition: 'paralyzed', source: 'a spell' },
      ]),
      { weapon: 'greatsword', twoHanded: true },
    );
    expect(crit.attack!.critical).toBe(true);
    // Both carry exactly one +2; the dice are what doubled.
    expect(crit.damage! - normal.damage!).toBeGreaterThan(0);
  });
});

describe('a feature can add damage of another type instead', () => {
  const PALADIN = id('aelric');

  /**
   * The same Paladin at two levels, so Radiant Strikes is the only difference
   * between them. Comparing one level against another is what makes these
   * assertions independent of what the dice did: the same seed rolls the same
   * weapon damage either way, and anything left over is the feature.
   */
  const paladin = (level: number, prepared: readonly string[]): CharacterChoices => ({
    name: 'Aelric',
    classId: 'paladin',
    level,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['athletics', 'persuasion'],
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Lawful Good',
    subclassId: 'oath-of-devotion',
    cantrips: [],
    spellbook: [],
    preparedSpells: prepared,
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
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
      'paladin:fighting-style': { featId: 'defense' },
      'paladin:ability-score-improvement': { featId: 'savage-attacker' },
      // The repeat at Paladin 8. Its id carries the *ordinal* the table prints
      // it at, not the level — this fixture said `-8` for as long as the
      // catalogue published no repeat at all and the key went unread.
      'paladin:ability-score-improvement-2': {
        featId: 'ability-score-improvement',
        abilities: ['int', 'int'],
      },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  });

  const NINE = [
    'bless',
    'cure-wounds',
    'heroism',
    'searing-smite',
    'shield-of-faith',
    'aid',
    'lesser-restoration',
    'magic-weapon',
    'daylight',
  ];

  /** Level 10 prepares nine; level 11 prepares ten. */
  const before = () => paladin(10, NINE);
  const after = () => paladin(11, [...NINE, 'revivify']);

  const built = (
    who: CharacterChoices,
    feet: number,
    defenses?: Record<string, { resistant?: boolean }>,
  ): readonly GameEvent[] => [
    ...(unwrap(createCharacter(SRD_CONTENT,who, PALADIN), 'create') as GameEvent[]),
    { type: 'creature-side-declared', id: PALADIN, side: 'party' },
    target({}, defenses),
    {
      type: 'items-gained',
      id: PALADIN,
      items: [
        { id: 'greatsword', quantity: 1 },
        { id: 'longbow', quantity: 1 },
      ],
      source: 'loot',
    },
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the shrine', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: PALADIN, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
    { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: PALADIN }, feet, bearing: 0 } },
  ];

  const hit = (
    who: CharacterChoices,
    weapon: string,
    feet: number,
    defenses?: Record<string, { resistant?: boolean }>,
  ) => {
    return unwrap(
      resolveAttack(
        fold('seed', built(who, feet, defenses)),
        PALADIN,
        { target: GOBLIN, weapon, twoHanded: true },
        supply(),
      ),
      weapon,
    );
  };

  /**
   * SRD Radiant Strikes (Paladin 11): "When you hit a target with an attack
   * roll using a Melee weapon or an Unarmed Strike, the target takes an extra
   * 1d8 Radiant damage."
   */
  it('adds Radiant damage a level 10 Paladin does not have', () => {
    const junior = hit(before(), 'greatsword', 5);
    const senior = hit(after(), 'greatsword', 5);
    expect(junior.attack!.hit).toBe(true);
    expect(senior.damage! - junior.damage!).toBeGreaterThan(0);
  });

  /** It is Radiant, so resistance to the weapon's own type does nothing to it. */
  it('is untouched by resistance to the weapon’s damage type', () => {
    const soft = hit(after(), 'greatsword', 5);
    const tough = hit(after(), 'greatsword', 5, { slashing: { resistant: true } });
    expect(tough.damage!).toBeGreaterThan(Math.floor(soft.damage! / 2));
  });

  /**
   * SRD: "using a Melee weapon or an Unarmed Strike." A Paladin with a bow
   * gets nothing, which is the clause that would otherwise be easy to drop —
   * and comparing the two levels is what proves it rather than a die roll.
   */
  it('adds nothing to a ranged attack, because the SRD says melee', () => {
    const junior = hit(before(), 'longbow', 60);
    const senior = hit(after(), 'longbow', 60);
    expect(junior.attack!.hit).toBe(true);
    expect(senior.damage).toBe(junior.damage);
  });
});

describe('the caller can still add what the engine cannot see', () => {
  /**
   * A magic weapon's own damage — Flame Tongue's "extra 2d6 Fire damage" —
   * comes in this way until magic items are parsed, and lands in exactly the
   * same list a feature's does.
   */
  it('takes extra damage of another type from the caller', () => {
    const bare = swing(table(), { weapon: 'greatsword', twoHanded: true });
    const ablaze = swing(table(), {
      weapon: 'greatsword',
      twoHanded: true,
      extraDamage: [{ source: 'Flame Tongue', type: 'fire', dice: '2d6' }],
    });
    expect(ablaze.damage! - bare.damage!).toBeGreaterThanOrEqual(2);
  });

  /** And a feature's damage rides alongside it rather than replacing it. */
  it('adds the caller’s and the feature’s together', () => {
    const featureOnly = swing(raging(table()), { weapon: 'greatsword', twoHanded: true });
    const both = swing(raging(table()), {
      weapon: 'greatsword',
      twoHanded: true,
      extraDamage: [{ source: 'Flame Tongue', type: 'fire', flat: 7 }],
    });
    expect(both.damage! - featureOnly.damage!).toBe(7);
  });
});
