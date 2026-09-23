import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type Ability } from '@ie/shared';
import {
  beginRest,
  checkCharacter,
  createCharacter,
  createRng,
  createRollIssuer,
  endRest,
  fold,
  LONG_REST,
  planCharacter,
  remaining,
  resolveSpell,
  spellSaveDcWith,
  spellSlotKey,
  type CharacterChoices,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';

/**
 * A spell a source that does not cast grants.
 *
 * SRD prints the sentence on four origin traits — Elven Lineage, Gnomish
 * Lineage, Fiendish Legacy and Otherworldly Presence — and every one of them
 * reached nothing: `classFeatureSpells` walks a **casting class's** features,
 * so a species trait granting a cantrip granted it to nobody, and the
 * spellcasting ability the trait asks the player to choose had nowhere to be
 * recorded.
 *
 * **The mechanism was already there and the gatherer was not.** The feat route
 * — Magic Initiate — has done all three things since it landed: an ability
 * chosen at creation, a spell granted, and a once-per-Long-Rest casting that
 * may also spend a slot. `GrantedSpell`, the `granted` route, the payment fork
 * and the surface's report are the same ones. What this adds is a third
 * gatherer beside the feat loop and the class loop, a place on
 * `CharacterChoices` for the ability, and two fields the SRD's own sentences
 * need: which abilities a trait offers, and the character level a staged spell
 * arrives at.
 *
 * Driven through the printed Tiefling, because a species trait that only
 * worked for homebrew would be a mechanism nobody in the book could use.
 */

const WHO = asCharacterId('wren');
const TARGET = asCharacterId('goblin');

const LEGACY = 'tiefling:fiendish-legacy';

/**
 * A Tiefling Fighter — a character who casts nothing at all, which is the
 * whole point of the shape.
 */
const tiefling = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Wren',
  classId: 'fighter',
  level: 1,
  speciesId: 'tiefling',
  size: 'Medium',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { str: 2, dex: 1 },
  classSkills: ['acrobatics', 'animal-handling'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { [LEGACY]: ['Abyssal'] },
  // SRD: "Intelligence, Wisdom, or Charisma is your spellcasting ability for
  // the spells you cast with this trait (choose the ability when you select
  // the legacy)."
  featureSpellcasting: { [LEGACY]: 'cha' },
  feats: {
    'fighter:fighting-style': { featId: 'defense' },
    'soldier:savage-attacker': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

/** The same Tiefling at level 3, where the legacy's first levelled spell arrives. */
const atThree = (over: Partial<CharacterChoices> = {}): CharacterChoices =>
  tiefling({ level: 3, subclassId: 'champion', ...over });

const plan = (choices: CharacterChoices) => unwrap(planCharacter(SRD_CONTENT, choices), 'plan');

const routes = (choices: CharacterChoices) => plan(choices).spellcasting.granted;

const supply = (seed: string) => ({
  issuer: createRollIssuer(seed),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A creature to point the spell at, so a casting has somewhere to go. */
const withTarget = (choices: CharacterChoices): GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, choices, WHO), 'creation') as GameEvent[]),
  {
    type: 'creature-added',
    id: TARGET,
    name: 'a goblin',
    sheet: {
      level: 1,
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
      skills: {},
      saveProficiencies: [],
      armor: null,
      shield: null,
      armorTraining: { light: false, medium: false, heavy: false, shields: false },
      baseSpeed: 30,
      spellcastingAbility: null,
    },
    maxHp: 12,
    diesAtZero: true,
    creatureType: 'Humanoid',
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: WHO, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: TARGET, placement: { from: { creature: WHO }, feet: 20, bearing: 90 } },
  { type: 'sight-declared', from: WHO, to: TARGET, seen: true },
  // In a fight, because SRD Ray of Sickness leaves its target Poisoned "until
  // the end of your next turn" and a rider anchored to a turn has none outside
  // one.
  {
    type: 'combat-started',
    combatants: [
      { id: WHO, initiative: 20, speed: 30 },
      { id: TARGET, initiative: 10, speed: 30 },
    ],
  },
];

describe('a Tiefling who casts nothing still holds what the legacy grants', () => {
  /** SRD Otherworldly Presence: "You know the Thaumaturgy cantrip." */
  it('knows Thaumaturgy and the legacy’s own cantrip at level 1', () => {
    expect(routes(tiefling()).map((one) => one.spellId).sort()).toEqual([
      'poison-spray',
      'thaumaturgy',
    ]);
  });

  /**
   * And on the ability the *legacy* chose, which is what Otherworldly Presence
   * says in as many words: "the spell uses the same spellcasting ability you
   * use for your Fiendish Legacy trait."
   */
  it('casts both off the ability the legacy chose', () => {
    for (const route of routes(tiefling())) expect(route.ability).toBe('cha');
    for (const route of routes(tiefling({ featureSpellcasting: { [LEGACY]: 'wis' } }))) {
      expect(route.ability).toBe('wis');
    }
  });

  /** A cantrip needs no slot and spends no pool. */
  it('gives the cantrips no pool and no slot route', () => {
    for (const route of routes(tiefling())) {
      expect(route.freeCastPool).toBeNull();
      expect(route.slotCasting).toBe(false);
    }
  });

  /**
   * SRD: "When you reach character levels 3 and 5, you learn a higher-level
   * spell... You can cast it once without a spell slot, and you regain the
   * ability to cast it in that way when you finish a Long Rest. You can also
   * cast the spell using any spell slots you have of the appropriate level."
   */
  it('learns the level 3 spell at character level 3 and not before', () => {
    expect(routes(tiefling()).map((one) => one.spellId)).not.toContain('ray-of-sickness');

    const levelled = routes(atThree()).find((one) => one.spellId === 'ray-of-sickness');
    expect(levelled).toBeDefined();
    expect(levelled?.freeCastPool).not.toBeNull();
    expect(levelled?.slotCasting).toBe(true);
  });

  /** The legacy the player did not take grants nothing. */
  it('grants the other legacies’ spells to nobody', () => {
    const chthonic = routes(atThree({ featureChoices: { [LEGACY]: ['Chthonic'] } })).map(
      (one) => one.spellId,
    );
    expect(chthonic).toContain('chill-touch');
    expect(chthonic).toContain('false-life');
    expect(chthonic).not.toContain('poison-spray');
    expect(chthonic).not.toContain('ray-of-sickness');
  });
});

describe('the free casting a trait pays for', () => {
  const pool = (state: GameState): number => {
    const route = routes(atThree()).find((one) => one.spellId === 'ray-of-sickness');
    return remaining(state.creatures[WHO]!.resources, route!.freeCastPool!);
  };

  it('is one use, and spending it leaves none', () => {
    const log = withTarget(atThree());
    const before = fold('seed', log);
    expect(pool(before)).toBe(1);

    const cast = unwrap(
      resolveSpell(before, WHO, { spellId: 'ray-of-sickness', targets: [TARGET], payment: 'free-casting' }, supply('one')),
      'cast',
    );
    const after = fold('seed', [...log, ...cast.events]);
    expect(pool(after)).toBe(0);

    // And a second casting has nothing left to spend and no slot to fall back
    // on, because a Fighter holds none.
    const again = resolveSpell(
      after,
      WHO,
      { spellId: 'ray-of-sickness', targets: [TARGET], payment: 'free-casting' },
      supply('two'),
    );
    expect(isErr(again)).toBe(true);
  });

  /** And a Long Rest gives it back, which is what the sentence promises. */
  it('comes back on a Long Rest', () => {
    const log = withTarget(atThree());
    const before = fold('seed', log);
    const cast = unwrap(
      resolveSpell(before, WHO, { spellId: 'ray-of-sickness', targets: [TARGET], payment: 'free-casting' }, supply('one')),
      'cast',
    );
    const spent = fold('seed', [...log, ...cast.events]);
    const begun = unwrap(beginRest(spent, WHO, 'long'), 'rest');
    const slept: GameEvent[] = [
      ...log,
      ...cast.events,
      ...begun,
      { type: 'time-advanced', seconds: LONG_REST, reason: 'resting' },
    ];
    const ended = unwrap(endRest(fold('seed', slept), WHO), 'end');
    expect(pool(fold('seed', [...slept, ...ended.events]))).toBe(1);
  });

  /** The DC the save is rolled against is the one the chosen ability gives. */
  it('rolls the save against the ability the trait chose', () => {
    const sheet = plan(atThree()).sheet;
    expect(spellSaveDcWith(sheet, 'cha')).not.toBe(spellSaveDcWith(sheet, 'wis'));
    const route = routes(atThree()).find((one) => one.spellId === 'ray-of-sickness');
    expect(route?.ability).toBe('cha');
  });
});

/**
 * "You can also cast the spell using any spell slots you have of the
 * appropriate level" — the half the class feature's free casting deliberately
 * does not have, and the reason `withSlots` is a field rather than an
 * assumption.
 */
describe('the same spell out of a slot, for a holder who has one', () => {
  /** The same Tiefling, in a class that casts. */
  const wizard = (): CharacterChoices => ({
    ...atThree(),
    classId: 'wizard',
    subclassId: 'evoker',
    abilities: {
      method: 'standard-array',
      assignment: { str: 8, dex: 13, con: 14, int: 15, wis: 12, cha: 10 },
    },
    abilityIncreases: { con: 2, str: 1 },
    classSkills: ['arcana', 'investigation'],
    cantrips: ['fire-bolt', 'light', 'prestidigitation'],
    spellbook: ['magic-missile', 'shield', 'detect-magic', 'feather-fall', 'mage-armor', 'sleep', 'burning-hands', 'thunderwave', 'charm-person', 'grease']
      .map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const })),
    preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'grease', 'thunderwave'],
    featureChoices: { [LEGACY]: ['Abyssal'], 'wizard:scholar': ['arcana'], 'evoker:evocation-savant': ['shatter', 'scorching-ray'] },
    feats: { 'soldier:savage-attacker': { featId: 'savage-attacker' } },
  });

  it('spends the slot rather than the trait’s one free casting', () => {
    const log = withTarget(wizard());
    const before = fold('seed', log);
    const route = routes(wizard()).find((one) => one.spellId === 'ray-of-sickness');
    expect(route?.slotCasting).toBe(true);

    const cast = unwrap(
      resolveSpell(
        before,
        WHO,
        { spellId: 'ray-of-sickness', targets: [TARGET], payment: 'slot' },
        supply('slot'),
      ),
      'cast',
    );
    const after = fold('seed', [...log, ...cast.events]);
    expect(remaining(after.creatures[WHO]!.resources, spellSlotKey(1))).toBe(
      remaining(before.creatures[WHO]!.resources, spellSlotKey(1)) - 1,
    );
    // And the free casting is still there, unspent.
    expect(remaining(after.creatures[WHO]!.resources, route!.freeCastPool!)).toBe(1);
  });
});

describe('what the door refuses', () => {
  it('refuses an ability the trait does not offer', () => {
    const codes = checkCharacter(SRD_CONTENT, tiefling({
      featureSpellcasting: { [LEGACY]: 'str' as Ability },
    })).map((problem) => problem.code);
    expect(codes).toContain('unknown_ability');
  });

  it('refuses a trait whose ability nobody chose', () => {
    const codes = checkCharacter(SRD_CONTENT, tiefling({ featureSpellcasting: {} })).map(
      (problem) => problem.code,
    );
    expect(codes).toContain('missing_feature_spellcasting');
  });

  /**
   * And the refusal that must **not** fire: a Fighter still has no cantrips of
   * their own, and a species trait granting one is not the character writing
   * spells down under a class that cannot hold them.
   */
  it('leaves the no-spellcasting refusal alone', () => {
    expect(checkCharacter(SRD_CONTENT, tiefling()).map((problem) => problem.code)).toEqual([]);
  });
});
