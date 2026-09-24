import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  activateFeature,
  checkContent,
  createCharacter,
  createRng,
  createRollIssuer,
  fold,
  remaining,
  resolveAttack,
  type CharacterChoices,
  type CharacterSheet,
  type GameEvent,
  type GameState,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';

/**
 * SRD Oath of Devotion, Sacred Weapon:
 *
 * > "When you take the Attack action, you can expend one use of your Channel
 * > Divinity to imbue one Melee weapon that you are holding with positive
 * > energy. For 10 minutes or until you use this feature again, you add your
 * > Charisma modifier to attack rolls you make with that weapon (minimum bonus
 * > of +1)."
 *
 * The bonus was a number the caller passed in, because the only ability-sized
 * bonuses the engine had were a saving throw's and a named skill's. The third
 * family is `attack-bonus`, and this drives the Paladin's own sentence through
 * it: the use comes out of the Channel Divinity pool the class feature
 * declares, the ten minutes are on the clock, and the number is read off the
 * Paladin's Charisma as it stands.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const ARDAN = id('ardan');
const MARIS = id('maris');
const GHOUL = id('ghoul');

/** `dim` leaves the Charisma modifier at 0, so the printed floor has work to do. */
const paladin = (dim: boolean): CharacterChoices =>
  ({
    name: dim ? 'Maris' : 'Ardan',
    classId: 'paladin',
    level: 3,
    subclassId: 'oath-of-devotion',
    speciesId: 'human',
    backgroundId: 'acolyte',
    abilities: {
      method: 'standard-array',
      assignment: dim
        ? { str: 15, dex: 12, con: 14, int: 13, wis: 10, cha: 8 }
        : { str: 14, dex: 12, con: 13, int: 8, wis: 10, cha: 15 },
    },
    abilityIncreases: dim ? { int: 2, wis: 1 } : { cha: 2, wis: 1 },
    classSkills: ['athletics', 'persuasion'],
    languages: ['Draconic', 'Elvish'],
    alignment: 'Lawful Good',
    cantrips: [],
    spellbook: [],
    preparedSpells: ['cure-wounds', 'heroism', 'divine-favor', 'bless'],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'] },
    feats: {
      'human:versatile': { featId: 'alert' },
      // A Fighting Style whose benefit is not an attack roll's, so nothing it
      // grants could be mistaken for Sacred Weapon's number.
      'paladin:fighting-style': { featId: 'defense' },
      'acolyte:magic-initiate-cleric': {
        featId: 'magic-initiate',
        spellList: 'cleric',
        spellcastingAbility: 'wis',
        cantrips: ['guidance', 'sacred-flame'],
        levelOneSpell: 'bless',
      },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  }) as CharacterChoices;

const plain = (): CharacterSheet => ({
  level: 3,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const field = (who: CharacterId, dim: boolean): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, paladin(dim), who), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: who, side: 'party' },
  {
    type: 'creature-added',
    id: GHOUL,
    name: 'a ghoul',
    sheet: plain(),
    maxHp: 60,
    diesAtZero: false,
    creatureType: 'Undead',
    side: 'undead',
  },
  {
    type: 'items-gained',
    id: who,
    items: [
      { id: 'longsword', quantity: 1 },
      { id: 'shortbow', quantity: 1 },
      { id: 'arrow', quantity: 20 },
    ],
    source: 'the temple armoury',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: who, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  { type: 'creature-placed', id: GHOUL, placement: { from: { creature: who }, feet: 5, bearing: 0 } },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng('shrine'),
  content: SRD_CONTENT,
});

const contributionsOf = (events: readonly GameEvent[]): Record<string, number> => {
  const record = events.find((e) => e.type === 'roll-recorded');
  if (record?.type !== 'roll-recorded') throw new Error('no roll was recorded');
  return Object.fromEntries(record.contributions.map((c) => [c.source, c.amount]));
};

const imbued = (who: CharacterId, dim = false): GameState => {
  const before = fold('seed', field(who, dim));
  const events = unwrap(
    activateFeature(before, who, { feature: 'oath-of-devotion:sacred-weapon' }, SRD_CONTENT),
    'activate',
  );
  return fold('seed', [...field(who, dim), ...events]);
};

const swing = (state: GameState, who: CharacterId, weapon: string): readonly GameEvent[] =>
  unwrap(resolveAttack(state, who, { target: GHOUL, weapon, free: true }, supply(state)), 'attack')
    .events;

describe('SRD Sacred Weapon: "you add your Charisma modifier to attack rolls"', () => {
  it('declares the bonus rather than describing it', () => {
    const oath = SRD_CONTENT.subclasses.find((one) => one.id === 'oath-of-devotion');
    const feature = oath?.features.find((one) => one.id === 'oath-of-devotion:sacred-weapon');
    // A feature may declare one grant or a list of them; this one declares one.
    const declared = feature?.grants;
    const grant = Array.isArray(declared) ? declared[0] : declared;
    expect(grant?.kind).toBe('activated');
    if (grant === undefined || grant.kind !== 'activated') throw new Error('unreachable');
    // SRD's "For 10 minutes", and the use out of the pool the class declares.
    expect(grant.pool).toBe('channel-divinity');
    expect(grant.lastsSeconds).toBe(600);
    expect(grant.whileActive?.[0]).toMatchObject({
      kind: 'attack-bonus',
      fromAbility: 'cha',
      minimum: 1,
      onlyWithWeapon: { weapons: [{ kind: 'melee' }] },
    });
  });

  it('adds nothing until the Paladin spends the Channel Divinity', () => {
    const out = swing(fold('seed', field(ARDAN, false)), ARDAN, 'longsword');
    expect(contributionsOf(out)['Sacred Weapon']).toBeUndefined();
  });

  it('adds the Charisma modifier once the feature is on, named in the roll', () => {
    const out = swing(imbued(ARDAN), ARDAN, 'longsword');
    expect(contributionsOf(out)['Sacred Weapon']).toBe(3);
  });

  /** SRD's "(minimum bonus of +1)": a floor, not a default. */
  it('gives a Paladin with no Charisma to spare the printed +1', () => {
    const out = swing(imbued(MARIS, true), MARIS, 'longsword');
    expect(contributionsOf(out)['Sacred Weapon']).toBe(1);
  });

  /** "one **Melee** weapon": the Shortbow is not one. */
  it('is withheld from a ranged weapon', () => {
    const out = swing(imbued(ARDAN), ARDAN, 'shortbow');
    expect(contributionsOf(out)['Sacred Weapon']).toBeUndefined();
  });

  /**
   * The flag is a claim about *another* feature's pool, so the two ways of
   * writing it that mean nothing are refused at the door.
   */
  it('refuses an activation that spends nobody’s pool, and one that sizes another’s', () => {
    const rewritten = (over: Record<string, unknown>): readonly string[] => {
      const oath = JSON.parse(
        JSON.stringify(SRD_CONTENT.subclasses.find((one) => one.id === 'oath-of-devotion')),
      ) as { features: { id: string; grants: Record<string, unknown> }[] };
      const feature = oath.features.find((one) => one.id === 'oath-of-devotion:sacred-weapon')!;
      feature.grants = { ...feature.grants, ...over };
      return checkContent({ subclasses: [oath as never] }).map(
        (problem) => `${problem.code} @ ${problem.field}`,
      );
    };
    expect(rewritten({ pool: null })).toContain(
      'spends_no_pool @ subclasses[oath-of-devotion].features[1].grants.spendsOnly',
    );
    expect(rewritten({ minimum: 2 })).toContain(
      'sizes_anothers_pool @ subclasses[oath-of-devotion].features[1].grants.minimum',
    );
  });

  it('spends a use of Channel Divinity to switch on', () => {
    const before = fold('seed', field(ARDAN, false));
    const after = imbued(ARDAN);
    const left = (state: GameState): number =>
      remaining(state.creatures[ARDAN]!.resources, 'channel-divinity');
    expect(left(after)).toBe(left(before) - 1);
    expect(after.creatures[ARDAN]?.activeFeatures).toContain('oath-of-devotion:sacred-weapon');
  });
});
