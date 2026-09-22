import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { levelGrantedSpells } from './spellbook.js';
import {
  attackRollsFor,
  rollsDealtTo,
  type SpellDefinition,
} from './spell-definitions.js';
import { checkSpellDefinition } from './spell-schema.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { resolveSpell } from './commands.js';

/**
 * Several attack rolls out of one casting.
 *
 * SRD prints the sentence twice and means the same thing both times: Eldritch
 * Blast's "two beams at level 5" and Scorching Ray's "Make a ranged spell
 * attack for each ray". Each roll hits or misses on its own, each may be aimed
 * at a different creature, and the engine throws every one of them — a caller
 * names creatures and never a face.
 */

const id = (s: string) => asCharacterId(s);
const KAEL = id('kael');
const KESSA = id('kessa');
const GOBLIN = id('goblin');
const OGRE = id('ogre');
const BOAR = id('boar');

const warlock = (level: number): CharacterChoices => ({
  name: 'Kael',
  classId: 'warlock',
  level,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'deception'],
  languages: ['Draconic', 'Goblin'],
  alignment: 'Neutral Evil',
  ...(level >= 3 ? { subclassId: 'fiend-patron' } : {}),
  cantrips:
    level >= 4
      ? ['eldritch-blast', 'chill-touch', 'poison-spray']
      : ['eldritch-blast', 'chill-touch'],
  spellbook: [],
  preparedSpells: (level >= 5
    ? ['hex', 'charm-person', 'hold-person', 'hypnotic-pattern', 'mind-spike', 'fear']
    : ['hex', 'charm-person', 'hold-person', 'mind-spike']),
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
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
    ...(level >= 4 ? { 'warlock:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const wizard = (): CharacterChoices => ({
  name: 'Kessa',
  classId: 'wizard',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation', 'shocking-grasp'],
  spellbook: [
    'magic-missile',
    'shield',
    'detect-magic',
    'feather-fall',
    'mage-armor',
    'hold-person',
    'thunderwave',
    'charm-person',
    'misty-step',
    'web',
    'fireball',
    'fly',
    'counterspell',
    'fear',
    'ice-storm',
    'greater-invisibility',
    'cone-of-cold',
    'hold-monster',
  ]
    .slice(0, levelGrantedSpells(5))
    .map((spellId, index) => ({
      spellId,
      acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
      origin: 'level' as const,
    })),
  preparedSpells: [
    'magic-missile',
    'shield',
    'mage-armor',
    'hold-person',
    'burning-hands',
    'scorching-ray',
    'misty-step',
    'fireball',
    'fly',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
    'wizard:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['int', 'int'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const dummy = (who: CharacterId, name: string, maxHp = 60): GameEvent => ({
  type: 'creature-added',
  id: who,
  name,
  maxHp,
  creatureType: 'Humanoid',
  sheet: {
    level: 1,
    abilities: { str: 10, dex: 12, con: 12, int: 8, wis: 8, cha: 8 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    baseSpeed: 30,
    spellcastingAbility: null,
    stated: { armorClass: 13, proficiencyBonus: 2, initiative: 1 },
  },
});

const scene = (caster: CharacterId): GameEvent[] => [
  dummy(GOBLIN, 'Goblin'),
  dummy(OGRE, 'Ogre'),
  dummy(BOAR, 'Boar'),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 20, y: 20, z: 0 } },
  { type: 'creature-placed', id: caster, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: caster }, feet: 20, bearing: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: caster }, feet: 20, bearing: 90 } },
  { type: 'creature-placed', id: BOAR, placement: { from: { creature: caster }, feet: 20, bearing: 180 } },
  { type: 'sight-declared', from: caster, to: GOBLIN, seen: true },
  { type: 'sight-declared', from: caster, to: OGRE, seen: true },
  { type: 'sight-declared', from: caster, to: BOAR, seen: true },
];

const blasting = (level: number): GameEvent[] => [
  ...unwrap(createCharacter(SRD_CONTENT, warlock(level), KAEL), 'warlock'),
  ...scene(KAEL),
];

const raying = (): GameEvent[] => [
  ...unwrap(createCharacter(SRD_CONTENT, wizard(), KESSA), 'wizard'),
  ...scene(KESSA),
];

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

/** High enough that every attack roll in the casting lands. */
const CERTAIN = 40;

const cast = (
  who: CharacterId,
  log: readonly GameEvent[],
  request: Parameters<typeof resolveSpell>[2],
  flat = CERTAIN,
) => {
  const state = fold('seed', log);
  const result = unwrap(resolveSpell(state, who, request, supply(state, flat)), 'cast');
  return {
    events: result.events,
    outcome: result,
    state: fold('seed', [...log, ...result.events]),
  };
};

const refusal = (
  who: CharacterId,
  log: readonly GameEvent[],
  request: Parameters<typeof resolveSpell>[2],
) => {
  const state = fold('seed', log);
  const out = resolveSpell(state, who, request, supply(state, CERTAIN));
  if (!isErr(out)) throw new Error('expected a refusal');
  return out.code;
};

const attacksIn = (events: readonly GameEvent[], label: string) =>
  events.filter((e) => e.type === 'roll-recorded' && e.label === `${label} attack`);

describe('how many rolls a casting makes', () => {
  /**
   * SRD Eldritch Blast: "The spell creates two beams at level 5, three beams
   * at level 11, and four beams at level 17." The beam count is read off the
   * caster exactly as a Cantrip Upgrade's extra die is, because it *is* the
   * Cantrip Upgrade — the cantrip simply spends it on rolls rather than dice.
   */
  it('reads a cantrip beam count off the caster level', () => {
    const beams = { count: 1, cantripUpgradesAt: [5, 11, 17] };
    expect(attackRollsFor(beams, 0, 1, 0)).toBe(1);
    expect(attackRollsFor(beams, 0, 4, 0)).toBe(1);
    expect(attackRollsFor(beams, 0, 5, 0)).toBe(2);
    expect(attackRollsFor(beams, 0, 11, 0)).toBe(3);
    expect(attackRollsFor(beams, 0, 17, 0)).toBe(4);
    expect(attackRollsFor(beams, 0, 20, 0)).toBe(4);
  });

  /** SRD Scorching Ray: "one additional ray for each spell slot level above 2." */
  it('reads a levelled ray count off the slot', () => {
    const rays = { count: 3, extraPerSlotLevelAbove: 1 };
    expect(attackRollsFor(rays, 2, 20, 2)).toBe(3);
    expect(attackRollsFor(rays, 2, 1, 3)).toBe(4);
    expect(attackRollsFor(rays, 2, 1, 5)).toBe(6);
  });

  /** An attack that says nothing about a count makes the one roll it always did. */
  it('makes one roll where the effect states no count', () => {
    expect(attackRollsFor(undefined, 0, 17, 0)).toBe(1);
  });

  /**
   * The deal: one roll each in the order the caster named them, round again
   * for the surplus. Naming one creature sends every ray at it, naming as
   * many creatures as there are rays sends one each, and the order the caller
   * wrote is what decides where an odd ray goes.
   */
  it('deals the rolls over the creatures named, in order', () => {
    expect([0].map((i) => rollsDealtTo(3, 1, i))).toEqual([3]);
    expect([0, 1].map((i) => rollsDealtTo(3, 2, i))).toEqual([2, 1]);
    expect([0, 1, 2].map((i) => rollsDealtTo(3, 3, i))).toEqual([1, 1, 1]);
    expect([0, 1].map((i) => rollsDealtTo(4, 2, i))).toEqual([2, 2]);
    expect([0, 1, 2].map((i) => rollsDealtTo(4, 3, i))).toEqual([2, 1, 1]);
  });
});

describe("Eldritch Blast's beams", () => {
  it('throws one beam below level 5', () => {
    const log = blasting(3);
    const { events, outcome } = cast(KAEL, log, { spellId: 'eldritch-blast', targets: [GOBLIN] });
    expect(attacksIn(events, 'Eldritch Blast')).toHaveLength(1);
    expect(outcome.outcomes).toHaveLength(1);
  });

  it('throws two beams at level 5, each its own roll', () => {
    const log = blasting(5);
    const { events, outcome } = cast(KAEL, log, { spellId: 'eldritch-blast', targets: [GOBLIN] });
    const rolls = attacksIn(events, 'Eldritch Blast');
    expect(rolls).toHaveLength(2);
    expect(outcome.outcomes).toHaveLength(2);
    expect(outcome.outcomes.every((o) => o.target === GOBLIN)).toBe(true);
    // Two rolls, not one roll counted twice: the issuer moved for each.
    const issued = events.filter((e) => e.type === 'rolls-issued');
    expect(issued).toHaveLength(1);
  });

  /** "You can direct the beams at the same target or at different ones." */
  it('lets each beam take its own target at level 5', () => {
    const log = blasting(5);
    const { outcome } = cast(KAEL, log, {
      spellId: 'eldritch-blast',
      targets: [GOBLIN, OGRE],
    });
    expect(outcome.outcomes.map((o) => o.target)).toEqual([GOBLIN, OGRE]);
  });

  /** One beam is one creature, and the target rule never outran the beams. */
  it('refuses a second creature while there is only one beam', () => {
    expect(refusal(KAEL, blasting(3), { spellId: 'eldritch-blast', targets: [GOBLIN, OGRE] })).toBe(
      'too_many_targets',
    );
  });

  it('refuses a third creature at level 5', () => {
    expect(
      refusal(KAEL, blasting(5), { spellId: 'eldritch-blast', targets: [GOBLIN, OGRE, BOAR] }),
    ).toBe('too_many_targets');
  });

  /** The damage stays 1d10 a beam; the upgrade buys rolls, not dice. */
  it('keeps each beam at one die', () => {
    const log = blasting(5);
    const { outcome } = cast(KAEL, log, { spellId: 'eldritch-blast', targets: [GOBLIN] });
    for (const hit of outcome.outcomes) {
      expect(hit.affected).toBe(true);
      expect(hit.damage).toBeGreaterThanOrEqual(1);
      expect(hit.damage).toBeLessThanOrEqual(10);
    }
  });
});

describe("Scorching Ray's rays", () => {
  it('hurls three rays at one creature', () => {
    const log = raying();
    const { events, outcome } = cast(KESSA, log, {
      spellId: 'scorching-ray',
      targets: [GOBLIN],
      slotLevel: 2,
    });
    expect(attacksIn(events, 'Scorching Ray')).toHaveLength(3);
    expect(outcome.outcomes.map((o) => o.target)).toEqual([GOBLIN, GOBLIN, GOBLIN]);
  });

  it('hurls one ray at each of three creatures', () => {
    const log = raying();
    const { outcome } = cast(KESSA, log, {
      spellId: 'scorching-ray',
      targets: [GOBLIN, OGRE, BOAR],
      slotLevel: 2,
    });
    expect(outcome.outcomes.map((o) => o.target)).toEqual([GOBLIN, OGRE, BOAR]);
  });

  it('deals the odd ray to the creature named first', () => {
    const log = raying();
    const { outcome } = cast(KESSA, log, {
      spellId: 'scorching-ray',
      targets: [GOBLIN, OGRE],
      slotLevel: 2,
    });
    expect(outcome.outcomes.map((o) => o.target)).toEqual([GOBLIN, GOBLIN, OGRE]);
  });

  /** "You create one additional ray for each spell slot level above 2." */
  it('creates a fourth ray out of a level 3 slot', () => {
    const log = raying();
    const { events } = cast(KESSA, log, {
      spellId: 'scorching-ray',
      targets: [GOBLIN],
      slotLevel: 3,
    });
    expect(attacksIn(events, 'Scorching Ray')).toHaveLength(4);
  });

  /**
   * Each ray is its own roll and its own damage: three rays that all land deal
   * three separate 2d6, never one 6d6 that hits or misses together.
   */
  it('rolls each ray separately and hurts separately', () => {
    const log = raying();
    const { outcome } = cast(KESSA, log, {
      spellId: 'scorching-ray',
      targets: [GOBLIN],
      slotLevel: 2,
    });
    expect(outcome.outcomes).toHaveLength(3);
    for (const hit of outcome.outcomes) {
      expect(hit.affected).toBe(true);
      expect(hit.damage).toBeGreaterThanOrEqual(2);
      expect(hit.damage).toBeLessThanOrEqual(12);
    }
  });

  /** A miss is one ray's own; the rest are still thrown. */
  it('throws every ray whatever the first one did', () => {
    const log = raying();
    const { events } = cast(
      KESSA,
      log,
      { spellId: 'scorching-ray', targets: [GOBLIN, OGRE], slotLevel: 2 },
      -40,
    );
    const rolls = attacksIn(events, 'Scorching Ray');
    expect(rolls).toHaveLength(3);
    expect(rolls.every((r) => r.type === 'roll-recorded' && r.outcome === 'miss')).toBe(true);
  });

  it('refuses a fourth creature out of a level 2 slot', () => {
    expect(
      refusal(KESSA, raying(), {
        spellId: 'scorching-ray',
        targets: [GOBLIN, OGRE, BOAR, KESSA],
        slotLevel: 2,
      }),
    ).toBe('too_many_targets');
  });
});

describe('the same seed makes the same rays', () => {
  it('replays byte-identically', () => {
    const log = raying();
    const first = cast(KESSA, log, { spellId: 'scorching-ray', targets: [GOBLIN], slotLevel: 2 });
    const second = cast(KESSA, log, { spellId: 'scorching-ray', targets: [GOBLIN], slotLevel: 2 });
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events));
  });
});

describe('the validator on a roll count', () => {
  const RAY: SpellDefinition = {
    id: 'test-ray',
    name: 'Test Ray',
    level: 2,
    school: 'evocation',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 120 },
    targets: { count: 1 },
    effects: [{ kind: 'attack', attack: 'ranged', damage: { dice: '2d6' }, damageType: 'fire' }],
  };

  const codes = (over: Partial<SpellDefinition>): readonly string[] =>
    checkSpellDefinition({ ...RAY, ...over } as SpellDefinition).map((problem) => problem.code);

  /** The same definition with a roll count on its one attack. */
  const counting = (rolls: unknown, level = 2): Partial<SpellDefinition> =>
    ({
      level,
      effects: [
        {
          kind: 'attack',
          attack: 'ranged',
          damage: level === 0 ? { dice: '1d10' } : { dice: '2d6' },
          damageType: 'fire',
          rolls,
        },
      ],
    }) as unknown as Partial<SpellDefinition>;

  it('accepts a slot-scaled count on a levelled spell', () => {
    expect(codes(counting({ count: 3, extraPerSlotLevelAbove: 1 }))).toEqual([]);
  });

  it('accepts a caster-scaled count on a cantrip', () => {
    expect(codes(counting({ count: 1, cantripUpgradesAt: [5, 11, 17] }, 0))).toEqual([]);
  });

  /** A casting that rolls no attack at all is not an attack effect. */
  it('refuses a count that is not a whole number of rolls, at least one', () => {
    expect(codes(counting({ count: 0 }))).toEqual(['bad_roll_count']);
    expect(codes(counting({ count: 2.5 }))).toEqual(['bad_roll_count']);
    expect(codes(counting({ count: 'three' }))).toEqual(['bad_roll_count']);
  });

  it('refuses an extra per slot level that is not a whole number of rolls', () => {
    expect(codes(counting({ count: 3, extraPerSlotLevelAbove: -1 }))).toEqual(['bad_roll_count']);
    expect(codes(counting({ count: 3, extraPerSlotLevelAbove: '1' }))).toEqual(['bad_roll_count']);
  });

  it('refuses upgrade levels that are not character levels', () => {
    expect(codes(counting({ count: 1, cantripUpgradesAt: [0, 25] }, 0))).toEqual([
      'bad_roll_count',
      'bad_roll_count',
    ]);
    expect(codes(counting({ count: 1, cantripUpgradesAt: 5 }, 0))).toEqual(['malformed_field']);
  });

  /**
   * The mistake `checkScaling` already refuses on dice, made on rolls: a
   * cantrip has no slot and a levelled spell has no Cantrip Upgrade, and
   * `attackRollsFor` takes one branch or the other and silently ignores the
   * field belonging to the one it did not take.
   */
  it('refuses slot scaling on a cantrip', () => {
    expect(codes(counting({ count: 1, extraPerSlotLevelAbove: 1 }, 0))).toEqual([
      'slot_scaling_on_cantrip',
    ]);
  });

  it('refuses a Cantrip Upgrade on a levelled spell', () => {
    expect(codes(counting({ count: 3, cantripUpgradesAt: [5] }))).toEqual([
      'cantrip_scaling_on_spell',
    ]);
  });
});
