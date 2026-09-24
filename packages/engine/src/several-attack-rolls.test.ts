import { describe, expect, it } from 'vitest';
import { ELDRITCH_INVOCATIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { levelGrantedSpells } from './spellbook.js';
import {
  attackRollsFor,
  aimedRollsIn,
  rollsDealtTo,
  type SpellDefinition,
} from './spell-definitions.js';
import { checkSpellDefinition } from './spell-schema.js';
import { extendContent } from './content.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { releaseReady, resolveDeclaredCast, resolveSpell, takeReady } from './commands.js';

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

/**
 * The invocations the Invocations column asks for at this level, taken from
 * those that ask no second question — SRD Eldritch Invocations.
 */
const invocations = (level: number): readonly string[] =>
  [
    'Armor of Shadows',
    'Eldritch Mind',
    "Devil's Sight",
    'Fiendish Vigor',
    'Misty Visions',
    'Mask of Many Faces',
    'Otherworldly Leap',
    'Ascendant Step',
    'Master of Myriad Forms',
  ].slice(0, ELDRITCH_INVOCATIONS[level - 1] ?? 0);

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
  featureChoices: {
    'human:skillful': ['perception'],
    'warlock:eldritch-invocations': invocations(level),
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
   * And a list with no attack in it throws none, which is the honest answer
   * rather than the convenient one: a floor of 1 here would have this function
   * saying every spell in the book rolls an attack, and the one caller that
   * wants a floor — the target bound in `namedTargets` — says so itself.
   */
  it('counts no rolls in a list that makes no attack', () => {
    expect(aimedRollsIn([], 2, 20, 9)).toBe(0);
    expect(
      aimedRollsIn(
        [
          { kind: 'heal', healing: { dice: '2d8' }, addSpellcastingModifier: false },
          { kind: 'temp-hp', amount: { flat: 5 }, addSpellcastingModifier: false },
        ],
        2,
        20,
        9,
      ),
    ).toBe(0);
  });

  it('counts the longest attack of a list that makes several', () => {
    expect(
      aimedRollsIn(
        [
          { kind: 'attack', attack: 'ranged', damage: { dice: '1d6' }, damageType: 'fire' },
          {
            kind: 'attack',
            attack: 'melee',
            damage: { dice: '1d6' },
            damageType: 'fire',
            rolls: { count: 3, extraPerSlotLevelAbove: 1 },
          },
        ],
        2,
        20,
        4,
      ),
    ).toBe(5);
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

/**
 * **An uneven split of the rolls, said by the caster.**
 *
 * SRD prints the two ends — "You can hurl them at one target within range or
 * at several", "you can direct the beams at the same target or at different
 * ones" — and the middle it leaves open is the lopsided one: three rays at the
 * goblin and one at the ogre. The deal round the named creatures says every
 * even split and none of those, so four rays at two creatures went two and two
 * and never three and one.
 *
 * The caster says it outright now, with a count beside each creature they
 * named. **Counts beside the list rather than repeats inside it**: a target
 * named twice would be a target every *other* effect kind ran on twice, and
 * `duplicate_target` still refuses that spelling.
 */
describe('an uneven split of the rolls', () => {
  /**
   * The discriminating case. Four rays out of a level 3 slot, two creatures,
   * and the split the deal could never produce.
   */
  it('sends three rays at one creature and one at the other', () => {
    const log = raying();
    const { events, outcome } = cast(KESSA, log, {
      spellId: 'scorching-ray',
      targets: [GOBLIN, OGRE],
      slotLevel: 3,
      rollsAt: [
        { target: GOBLIN, count: 3 },
        { target: OGRE, count: 1 },
      ],
    });
    expect(attacksIn(events, 'Scorching Ray')).toHaveLength(4);
    expect(outcome.outcomes.map((o) => o.target)).toEqual([GOBLIN, GOBLIN, GOBLIN, OGRE]);
    // Each ray keeps its own 2d6: four rays are four damage rolls, never one
    // 8d6 divided between them.
    for (const hit of outcome.outcomes) {
      expect(hit.affected).toBe(true);
      expect(hit.damage).toBeGreaterThanOrEqual(2);
      expect(hit.damage).toBeLessThanOrEqual(12);
    }
  });

  /** And the same casting, with nothing said, still deals two and two. */
  it('still deals evenly when the caster says nothing', () => {
    const log = raying();
    const { outcome } = cast(KESSA, log, {
      spellId: 'scorching-ray',
      targets: [GOBLIN, OGRE],
      slotLevel: 3,
    });
    expect(outcome.outcomes.map((o) => o.target)).toEqual([GOBLIN, GOBLIN, OGRE, OGRE]);
  });

  /** The other direction: the creature named second takes the most. */
  it('sends the surplus wherever the caster put it', () => {
    const log = raying();
    const { outcome } = cast(KESSA, log, {
      spellId: 'scorching-ray',
      targets: [GOBLIN, OGRE],
      slotLevel: 3,
      rollsAt: [
        { target: GOBLIN, count: 1 },
        { target: OGRE, count: 3 },
      ],
    });
    expect(outcome.outcomes.map((o) => o.target)).toEqual([GOBLIN, OGRE, OGRE, OGRE]);
  });

  /**
   * A cantrip's beams are counted off the **caster's level** rather than a
   * slot, and the split is measured against that count: a level 5 Warlock has
   * two beams to place and three is not a split of them.
   */
  it('measures a cantrip’s split against the beams the caster has', () => {
    const log = blasting(5);
    const { outcome } = cast(KAEL, log, {
      spellId: 'eldritch-blast',
      targets: [GOBLIN, OGRE],
      rollsAt: [
        { target: GOBLIN, count: 1 },
        { target: OGRE, count: 1 },
      ],
    });
    expect(outcome.outcomes.map((o) => o.target)).toEqual([GOBLIN, OGRE]);
    expect(
      refusal(KAEL, log, {
        spellId: 'eldritch-blast',
        targets: [GOBLIN, OGRE],
        rollsAt: [
          { target: GOBLIN, count: 1 },
          { target: OGRE, count: 2 },
        ],
      }),
    ).toBe('wrong_roll_count');
  });

  /** A split said twice is the same casting; the rays are still the seed's. */
  it('replays byte-identically', () => {
    const log = raying();
    const request = {
      spellId: 'scorching-ray',
      targets: [GOBLIN, OGRE],
      slotLevel: 3,
      rollsAt: [
        { target: GOBLIN, count: 3 },
        { target: OGRE, count: 1 },
      ],
    } as const;
    const first = cast(KESSA, log, request);
    const second = cast(KESSA, log, request);
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events));
  });

  /**
   * A casting held open for a Counterspell settles the split it was declared
   * with. Settlement takes no fresh request, so the distribution is pinned
   * beside the targets it is aligned to.
   */
  it('settles a declared casting with the split it was declared with', () => {
    const log = raying();
    const state = fold('seed', log);
    const declared = unwrap(
      resolveSpell(
        state,
        KESSA,
        {
          spellId: 'scorching-ray',
          targets: [GOBLIN, OGRE],
          slotLevel: 3,
          hold: true,
          rollsAt: [
            { target: GOBLIN, count: 3 },
            { target: OGRE, count: 1 },
          ],
        },
        supply(state, CERTAIN),
      ),
      'declare',
    );
    const open = fold('seed', [...log, ...declared.events]);
    const settled = unwrap(
      resolveDeclaredCast(open, declared.castingId!, supply(open, CERTAIN)),
      'settle',
    );
    expect(settled.outcomes.map((o) => o.target)).toEqual([GOBLIN, GOBLIN, GOBLIN, OGRE]);
  });

  /**
   * **And a readied casting settles the split too**, which is the third road a
   * casting takes and the one where the split is stated latest: SRD Ready
   * casts the spell now and releases it later, and the creatures it lands on
   * are chosen at the release rather than at the Ready. So the split is stated
   * there, beside the targets it divides between.
   */
  it('releases a readied casting with the split the release states', () => {
    const log = [
      ...raying(),
      {
        type: 'combat-started',
        combatants: [
          { id: KESSA, initiative: 20, speed: 30 },
          { id: GOBLIN, initiative: 10, speed: 30 },
          { id: OGRE, initiative: 5, speed: 30 },
        ],
      } satisfies GameEvent,
    ];
    const readied = [
      ...log,
      ...unwrap(
        takeReady(
          fold('seed', log),
          KESSA,
          {
            trigger: 'if the goblin breaks cover',
            response: { kind: 'spell', spellId: 'scorching-ray', slotLevel: 3 },
          },
          SRD_CONTENT,
        ),
        'ready',
      ),
    ];
    const open = fold('seed', readied);
    const released = unwrap(
      releaseReady(
        open,
        KESSA,
        {
          targets: [GOBLIN, OGRE],
          rollsAt: [
            { target: GOBLIN, count: 3 },
            { target: OGRE, count: 1 },
          ],
        },
        supply(open, CERTAIN),
      ),
      'release',
    );
    expect(released.spell?.outcomes.map((o) => o.target)).toEqual([
      GOBLIN,
      GOBLIN,
      GOBLIN,
      OGRE,
    ]);
  });

  /**
   * **The spelling that was rejected stays rejected.** A duplicate in the
   * target list would be a creature every other effect kind ran on twice, so
   * the counts are said beside the list and the list itself is still a set.
   */
  it('still refuses the same creature named twice', () => {
    expect(
      refusal(KESSA, raying(), {
        spellId: 'scorching-ray',
        targets: [GOBLIN, GOBLIN],
        slotLevel: 3,
      }),
    ).toBe('duplicate_target');
  });

  it('refuses a count that is not a whole number of rolls, at least one', () => {
    const at = (count: number) => [
      { target: GOBLIN, count },
      { target: OGRE, count: 4 - count },
    ];
    for (const bad of [0, -1, 1.5]) {
      expect(
        refusal(KESSA, raying(), {
          spellId: 'scorching-ray',
          targets: [GOBLIN, OGRE],
          slotLevel: 3,
          rollsAt: at(bad),
        }),
      ).toBe('not_a_roll_count');
    }
  });

  /** More rays than the casting has, and fewer: a ray unthrown is not a split. */
  it('refuses a split that is not the number of rolls the casting makes', () => {
    expect(
      refusal(KESSA, raying(), {
        spellId: 'scorching-ray',
        targets: [GOBLIN, OGRE],
        slotLevel: 3,
        rollsAt: [
          { target: GOBLIN, count: 4 },
          { target: OGRE, count: 1 },
        ],
      }),
    ).toBe('wrong_roll_count');
    expect(
      refusal(KESSA, raying(), {
        spellId: 'scorching-ray',
        targets: [GOBLIN, OGRE],
        slotLevel: 3,
        rollsAt: [
          { target: GOBLIN, count: 2 },
          { target: OGRE, count: 1 },
        ],
      }),
    ).toBe('wrong_roll_count');
  });

  it('refuses a split that aims at somebody the casting never named', () => {
    expect(
      refusal(KESSA, raying(), {
        spellId: 'scorching-ray',
        targets: [GOBLIN, OGRE],
        slotLevel: 3,
        rollsAt: [
          { target: GOBLIN, count: 3 },
          { target: BOAR, count: 1 },
        ],
      }),
    ).toBe('not_a_target');
  });

  it('refuses a split that names one creature twice', () => {
    expect(
      refusal(KESSA, raying(), {
        spellId: 'scorching-ray',
        targets: [GOBLIN, OGRE],
        slotLevel: 3,
        rollsAt: [
          { target: GOBLIN, count: 2 },
          { target: GOBLIN, count: 1 },
          { target: OGRE, count: 1 },
        ],
      }),
    ).toBe('duplicate_target');
  });

  /** A creature named for no roll is a creature named for nothing. */
  it('refuses a split that leaves a named creature with no roll', () => {
    expect(
      refusal(KESSA, raying(), {
        spellId: 'scorching-ray',
        targets: [GOBLIN, OGRE],
        slotLevel: 3,
        rollsAt: [{ target: GOBLIN, count: 4 }],
      }),
    ).toBe('missing_roll_count');
  });

  /**
   * **Two spellings of one request are one command.** A split is a *mapping*
   * from creature to share, so the order the caller happened to write the
   * pairs in says nothing about the casting, and `castingIdentity` sorts it
   * away — which is sound for any definition, because two lists of the same
   * pairs are the same mapping whatever spell they are aimed at.
   *
   * **A split that spells out the deal is a different question**, and the
   * fingerprint deliberately declines it: see the two tests below, and
   * `castingIdentity`'s own docstring for why the line falls there.
   */
  it('takes a re-ordered split as the same command', () => {
    const log = raying();
    const state = fold('seed', log);
    const first = unwrap(
      resolveSpell(
        state,
        KESSA,
        {
          spellId: 'scorching-ray',
          targets: [GOBLIN, OGRE],
          slotLevel: 3,
          commandId: 'one',
          rollsAt: [
            { target: GOBLIN, count: 3 },
            { target: OGRE, count: 1 },
          ],
        },
        supply(state, CERTAIN),
      ),
      'first',
    );
    const after = fold('seed', [...log, ...first.events]);
    // The same pairs, written the other way round, under the same id.
    const retry = resolveSpell(
      after,
      KESSA,
      {
        spellId: 'scorching-ray',
        targets: [GOBLIN, OGRE],
        slotLevel: 3,
        commandId: 'one',
        rollsAt: [
          { target: OGRE, count: 1 },
          { target: GOBLIN, count: 3 },
        ],
      },
      supply(after, CERTAIN),
    );
    expect(isErr(retry)).toBe(false);
    if (!retry.ok) return;
    // A retry that lands is the casting that already happened, reported again
    // and charged for nothing.
    expect(retry.value.events).toEqual([]);
    expect(retry.value.castingId).toBe(first.castingId);
  });

  /**
   * **And the same of the other door.** A release states its own split,
   * because it chooses its own creatures, so it owes the same normalisation:
   * `releaseReady` fingerprints its command too, and a re-ordered mapping is
   * the same release.
   */
  it('takes a re-ordered split as the same release', () => {
    const log = [
      ...raying(),
      {
        type: 'combat-started',
        combatants: [
          { id: KESSA, initiative: 20, speed: 30 },
          { id: GOBLIN, initiative: 10, speed: 30 },
          { id: OGRE, initiative: 5, speed: 30 },
        ],
      } satisfies GameEvent,
    ];
    const readied = [
      ...log,
      ...unwrap(
        takeReady(
          fold('seed', log),
          KESSA,
          {
            trigger: 'if the goblin breaks cover',
            response: { kind: 'spell', spellId: 'scorching-ray', slotLevel: 3 },
          },
          SRD_CONTENT,
        ),
        'ready',
      ),
    ];
    const open = fold('seed', readied);
    const released = unwrap(
      releaseReady(
        open,
        KESSA,
        {
          targets: [GOBLIN, OGRE],
          commandId: 'let-it-go',
          rollsAt: [
            { target: GOBLIN, count: 3 },
            { target: OGRE, count: 1 },
          ],
        },
        supply(open, CERTAIN),
      ),
      'release',
    );
    const after = fold('seed', [...readied, ...released.events]);
    const retry = releaseReady(
      after,
      KESSA,
      {
        targets: [GOBLIN, OGRE],
        commandId: 'let-it-go',
        rollsAt: [
          { target: OGRE, count: 1 },
          { target: GOBLIN, count: 3 },
        ],
      },
      supply(after, CERTAIN),
    );
    expect(isErr(retry)).toBe(false);
    if (!retry.ok) return;
    expect(retry.value.events).toEqual([]);
  });

  /**
   * **What a fingerprint may normalise, and what it may not.** Two spellings of
   * one mapping are one command, because that is true of the request alone.
   * Whether a split is *this casting's* default is not: it depends on how many
   * rolls the casting makes, which the fingerprint cannot see and which is
   * looked up on the far side of the duplicate check. A fingerprint that
   * guessed would hand a caller `ok` for a casting the engine would have
   * refused — the id already landed, so the body that does the refusing never
   * runs.
   */
  it('does not take an illegal split as the casting that stated none', () => {
    const log = raying();
    const state = fold('seed', log);
    const landed = unwrap(
      resolveSpell(
        state,
        KESSA,
        {
          spellId: 'scorching-ray',
          targets: [GOBLIN, OGRE],
          slotLevel: 3,
          commandId: 'once-only',
        },
        supply(state, CERTAIN),
      ),
      'cast',
    );
    const after = fold('seed', [...log, ...landed.events]);
    // Three rays' worth of split on a four-ray casting — `wrong_roll_count`
    // when it is validated, and it must not slip past as a retry of the
    // casting that named the same creatures and stated nothing.
    const smuggled = resolveSpell(
      after,
      KESSA,
      {
        spellId: 'scorching-ray',
        targets: [GOBLIN, OGRE],
        slotLevel: 3,
        commandId: 'once-only',
        rollsAt: [
          { target: GOBLIN, count: 2 },
          { target: OGRE, count: 1 },
        ],
      },
      supply(after, CERTAIN),
    );
    expect(isErr(smuggled)).toBe(true);
    if (!isErr(smuggled)) return;
    expect(smuggled.code).toBe('command_id_reused');
  });

  /**
   * **And the price of that, pinned rather than left to be discovered.**
   *
   * The refusal above is the same refusal a caller gets for spelling out the
   * split the engine would have dealt anyway: the fingerprint cannot tell the
   * two apart without the definition, so it tells neither apart and says no to
   * both. That is the conservative direction — a retry refused is a caller
   * told, where a retry wrongly accepted is a caster silently charged nothing
   * for a casting they did not make — and it is here so that anybody making
   * this symmetric with the record has to delete a test to do it.
   */
  it('refuses a retry that spells out the deal, because it cannot know it is the deal', () => {
    const log = raying();
    const state = fold('seed', log);
    const landed = unwrap(
      resolveSpell(
        state,
        KESSA,
        {
          spellId: 'scorching-ray',
          targets: [GOBLIN, OGRE],
          slotLevel: 3,
          commandId: 'spelled-out',
        },
        supply(state, CERTAIN),
      ),
      'cast',
    );
    const after = fold('seed', [...log, ...landed.events]);
    const retry = resolveSpell(
      after,
      KESSA,
      {
        spellId: 'scorching-ray',
        targets: [GOBLIN, OGRE],
        slotLevel: 3,
        commandId: 'spelled-out',
        // Exactly what the deal would have thrown, and the fingerprint has no
        // way to know it: how many rays there are is the definition's answer.
        rollsAt: [
          { target: GOBLIN, count: 2 },
          { target: OGRE, count: 2 },
        ],
      },
      supply(after, CERTAIN),
    );
    expect(isErr(retry)).toBe(true);
    if (!isErr(retry)) return;
    expect(retry.code).toBe('command_id_reused');
  });

  /** And the deal, spelled out, is the casting that said nothing. */
  it('takes a split that is only the deal as the casting that stated none', () => {
    const log = raying();
    const said = cast(KESSA, log, {
      spellId: 'scorching-ray',
      targets: [GOBLIN, OGRE],
      slotLevel: 3,
      rollsAt: [
        { target: GOBLIN, count: 2 },
        { target: OGRE, count: 2 },
      ],
    });
    const silent = cast(KESSA, log, {
      spellId: 'scorching-ray',
      targets: [GOBLIN, OGRE],
      slotLevel: 3,
    });
    expect(JSON.stringify(said.events)).toBe(JSON.stringify(silent.events));

    // And the same of a declaration, which is where it would have been
    // written down: two records meaning one casting must fold to one record.
    const state = fold('seed', log);
    const held = (rollsAt?: readonly { target: CharacterId; count: number }[]) =>
      unwrap(
        resolveSpell(
          state,
          KESSA,
          {
            spellId: 'scorching-ray',
            targets: [GOBLIN, OGRE],
            slotLevel: 3,
            hold: true,
            ...(rollsAt === undefined ? {} : { rollsAt }),
          },
          supply(state, CERTAIN),
        ),
        'declare',
      );
    expect(
      JSON.stringify(
        held([
          { target: GOBLIN, count: 2 },
          { target: OGRE, count: 2 },
        ]).events,
      ),
    ).toBe(JSON.stringify(held().events));
  });

  /** A field quietly ignored is a caller who thinks they said something. */
  it('refuses a split on a casting that makes one attack roll', () => {
    expect(
      refusal(KESSA, raying(), {
        spellId: 'fire-bolt',
        targets: [GOBLIN],
        rollsAt: [{ target: GOBLIN, count: 1 }],
      }),
    ).toBe('no_rolls_to_aim');
  });

  it('refuses a split on a casting that rolls no attack at all', () => {
    expect(
      refusal(KESSA, raying(), {
        spellId: 'hold-person',
        targets: [GOBLIN],
        slotLevel: 2,
        rollsAt: [{ target: GOBLIN, count: 1 }],
      }),
    ).toBe('no_rolls_to_aim');
  });
});

/**
 * **A split is measured against the longest attack in the list**, because
 * `aimedRollsIn` is what bounds the target list and what the caller is told
 * they may divide. A definition whose two attacks throw *different* numbers of
 * rolls therefore has no single split to state, and the shorter one falls back
 * to the deal rather than spending rays it never had.
 *
 * No SRD spell has two attack effects at all, so this is reached the way
 * `content.test.ts` reaches everything else the format allows and the
 * catalogue does not write: through the homebrew door, which is the same door.
 */
describe('a definition whose two attacks throw different numbers of rolls', () => {
  /** Three bolts and one splinter, out of one cantrip. */
  const FORKED: SpellDefinition = {
    id: 'forked-bolt',
    name: 'Forked Bolt',
    level: 0,
    school: 'evocation',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 120 },
    targets: { count: 1 },
    effects: [
      {
        kind: 'attack',
        attack: 'ranged',
        damage: { dice: '1d6' },
        damageType: 'force',
        rolls: { count: 3 },
      },
      { kind: 'attack', attack: 'ranged', damage: { dice: '1d4' }, damageType: 'force' },
    ],
  };

  const homebrew = unwrap(
    extendContent(SRD_CONTENT, {
      spells: [FORKED],
      spellEntries: [
        {
          id: 'forked-bolt',
          name: 'Forked Bolt',
          level: 0,
          school: 'evocation',
          classes: ['wizard'],
          castingTime: 'Action',
          ritual: false,
          concentration: false,
        },
      ],
    }),
    'homebrew content',
  );

  const forking = (): GameEvent[] => {
    const choices = wizard();
    return [
      ...unwrap(
        createCharacter(
          homebrew,
          { ...choices, cantrips: [...choices.cantrips.slice(0, 3), 'forked-bolt'] },
          KESSA,
        ),
        'wizard',
      ),
      ...scene(KESSA),
    ];
  };

  /**
   * The split spends the three bolts and the splinter is dealt as it always
   * was: four rolls, not six. A resolver that read the split without checking
   * whose rolls it was would throw the splinter three times as well.
   */
  it('spends the stated split on the attack it was counted from, and deals the other', () => {
    const log = forking();
    const state = fold('seed', log);
    const outcome = unwrap(
      resolveSpell(
        state,
        KESSA,
        {
          spellId: 'forked-bolt',
          targets: [GOBLIN, OGRE],
          rollsAt: [
            { target: GOBLIN, count: 1 },
            { target: OGRE, count: 2 },
          ],
        },
        { ...supply(state, CERTAIN), content: homebrew },
      ),
      'cast',
    );
    expect(attacksIn(outcome.events, 'Forked Bolt')).toHaveLength(4);
    // The goblin takes one bolt and the splinter; the ogre takes two bolts and
    // nothing else, because `rollsDealtTo(1, 2, 1)` is nought.
    expect(outcome.outcomes.map((o) => o.target)).toEqual([GOBLIN, GOBLIN, OGRE, OGRE]);
  });
});
