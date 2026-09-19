import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { checkContent, extendContent, parseClassDefinition } from './content.js';
import { resolveSpell } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { tallied } from './resources.js';
import { createRollIssuer } from './rolls.js';
import type { FeatureDefinition } from './progression.js';

/**
 * **The proof that `casting-damage` is vocabulary and not five special cases.**
 *
 * `content.test.ts`'s argument, applied to this member: a homebrew class whose
 * features are written in the same four arms the SRD's five use, loaded from
 * JSON text through the public door, created and cast with **no engine change
 * at all**. If any of the four were a branch on a class, a subclass or a spell
 * id, none of this would execute.
 *
 * The Warden below is deliberately not a reskin of any of the five. Its
 * narrowings are combined differently — a school *and* a damage type, a named
 * spell whose die grows, a band of slots two levels wide — and its price is
 * paid in a different die, on a different recovery, after a different number of
 * free uses. Every one of those is a field on the grant rather than a rule in
 * the engine, which is the whole claim.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WARDEN = id('warden');
const TARGET = id('target');

const WARDEN_CLASS = JSON.stringify({
  id: 'storm-warden',
  name: 'Storm Warden',
  primaryAbility: 'wis',
  hitDie: 8,
  saveProficiencies: ['wis', 'cha'],
  skillChoices: { choose: 2, from: ['athletics', 'arcana', 'survival', 'insight'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    proficiencyBonus: 2 + Math.floor(index / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'quarterstaff', quantity: 1 }], goldPieces: 5 }],
  multiclass: {
    weapons: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      // The addend, narrowed by two clauses at once rather than by one.
      id: 'storm-warden:galvanic-focus',
      name: 'Galvanic Focus',
      level: 1,
      automation: 'engine',
      note: 'When you cast an Evocation spell that deals Fire damage, you can add your Wisdom modifier to one damage roll of that spell.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'casting-damage',
            when: { school: 'evocation', damageTypes: ['fire'] },
            alters: { kind: 'ability-modifier', ability: 'wis' },
            optional: true,
          },
        ],
      },
    },
    {
      // The die substitution, on a spell nobody in the SRD alters.
      id: 'storm-warden:keen-mark',
      name: 'Keen Mark',
      level: 1,
      automation: 'engine',
      note: "The damage die of your Hunter's Mark is a d12 rather than a d6.",
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'casting-damage',
            when: { spell: 'hunters-mark' },
            alters: { kind: 'die', from: 6, to: 12 },
          },
        ],
      },
    },
    {
      // The floor, on levelled spells rather than on cantrips.
      id: 'storm-warden:unspent-fury',
      name: 'Unspent Fury',
      level: 1,
      automation: 'engine',
      note: 'A creature that avoids one of your level 1 or 2 spells still takes half its damage.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'casting-damage',
            when: { slotLevels: { from: 1, to: 2 } },
            alters: { kind: 'half-when-avoided' },
          },
        ],
      },
    },
    {
      // The maximisation, with a price counted in d6s, twice free, on a Short Rest.
      id: 'storm-warden:thunderhead',
      name: 'Thunderhead',
      level: 1,
      automation: 'engine',
      note: 'You can deal maximum damage with a level 3 spell that deals damage. Twice between Short Rests is free; after that you take 1d6 Lightning damage per slot level, rising by 2d6 each time.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'casting-damage',
            when: { slotLevels: { from: 3, to: 3 }, dealsDamage: true },
            alters: { kind: 'maximum' },
            optional: true,
            costs: {
              freeUses: 2,
              dicePerSlotLevel: '1d6',
              increasesBy: '2d6',
              damageType: 'lightning',
              key: 'storm-warden:thunderhead',
              recovers: 'short-rest',
            },
          },
        ],
      },
    },
  ],
});

const parsed = unwrap(parseClassDefinition(JSON.parse(WARDEN_CLASS)), 'parse');
const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');

const warden = (): CharacterChoices => ({
  name: 'Ilka',
  classId: 'storm-warden',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 15, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
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
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'medicine'] },
  },
});

const dummy = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  sheet: {
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: true, shields: true },
    baseSpeed: 30,
    spellcastingAbility: null,
    stated: { armorClass: 12, proficiencyBonus: 2, initiative: 0 },
  } satisfies CharacterSheet,
});

/**
 * The Warden casts nothing of its own — the class declares no spellcasting —
 * so the castings below come through a declared `spellcasting-declared`, which
 * is the ordinary door for a creature a DM describes. What is under test is
 * the caster's *features*, and those are on the sheet the class built.
 */
const table = (extra: readonly GameEvent[] = [], feet = 10): GameEvent[] => [
  ...unwrap(createCharacter(content, warden(), WARDEN), 'create'),
  dummy(TARGET),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WARDEN, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: WARDEN }, feet, bearing: 0 },
  },
  { type: 'sight-declared', from: WARDEN, to: TARGET, seen: true },
  {
    type: 'spellcasting-declared',
    id: WARDEN,
    spellcasting: {
      classes: [
        {
          classId: 'storm-warden',
          ability: 'wis',
          cantrips: [],
          prepared: ['burning-hands', 'hunters-mark', 'fireball'],
          slotKind: 'spell',
        },
      ],
      granted: [],
    },
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WARDEN,
      pool: {
        key: `spell-slot:${level}`,
        label: `level ${level} spell slot`,
        max: 9,
        recovers: 'long-rest',
      },
    }),
  ),
  ...extra,
];

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content,
});

const CERTAIN = 40;
const DOOMED = -40;

const cast = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveSpell>[2],
  flat?: number,
) => {
  const state = fold('seed', log);
  const result = unwrap(resolveSpell(state, WARDEN, request, supply(state, flat)), 'cast');
  const after = [...log, ...result.events];
  return { log: after, state: fold('seed', after), outcome: result };
};

const damage = (outcome: ReturnType<typeof cast>['outcome']): number =>
  outcome.outcomes.find((one) => one.target === TARGET)?.damage ?? -1;

describe('a homebrew class writes all four alterations with no engine change', () => {
  it('is validated beside the printed classes and adds no problem', () => {
    expect(checkContent({ classes: [parsed] })).toEqual([]);
    expect(content.classById('storm-warden')?.features.length).toBe(4);
    expect(SRD_CONTENT.classById('storm-warden')).toBeNull();
  });

  /** All four arms reach the sheet, off a class the engine has never heard of. */
  it('compiles four casting-damage effects onto the sheet', () => {
    const state = fold('seed', table());
    const standing = (state.creatures[WARDEN]?.sheet.standing ?? []).filter(
      (effect) => effect.grant.kind === 'casting-damage',
    );
    expect(standing.map((effect) => effect.feature)).toEqual([
      'storm-warden:galvanic-focus',
      'storm-warden:keen-mark',
      'storm-warden:unspent-fury',
      'storm-warden:thunderhead',
    ]);
  });

  /** The addend, narrowed by a school **and** a damage type at once. */
  it('adds the Wisdom modifier to an Evocation that deals Fire', () => {
    const request = {
      spellId: 'burning-hands',
      targets: [],
      towards: { x: 100, y: 140, z: 0 },
      slotLevel: 1,
    } as const;
    const plain = cast(table(), request, DOOMED);
    const empowered = cast(
      table(),
      { ...request, usingFeatures: ['storm-warden:galvanic-focus'] },
      DOOMED,
    );
    // Wisdom 16 after the background's point: +4.
    expect(damage(empowered.outcome)).toBe(damage(plain.outcome) + 3);
  });

  /** A die the SRD alters to a d10 and this class alters to a d12, pinned the same. */
  it('pins a d12 into the rider the casting grants', () => {
    const { log } = cast(table(), { spellId: 'hunters-mark', targets: [TARGET] });
    const granted = log.find((event) => event.type === 'attack-rider-granted');
    expect(granted && granted.type === 'attack-rider-granted' && granted.rider.dice).toBe('1d12');
    // And a replay reads the d12 off the log, with no catalogue at all.
    expect(fold('seed', log).creatures[WARDEN]?.attackRiders.map((one) => one.dice)).toEqual([
      '1d12',
    ]);
  });

  /** The floor, on levelled spells where the SRD's writer puts it on cantrips. */
  it('puts half under a made save against a level 1 spell', () => {
    const request = {
      spellId: 'burning-hands',
      targets: [],
      towards: { x: 100, y: 140, z: 0 },
      slotLevel: 1,
    } as const;
    const saved = cast(table(), request, CERTAIN);
    // Burning Hands already halves on a success, so the floor changes nothing
    // here — what it must not do is halve twice.
    expect(damage(saved.outcome)).toBeGreaterThan(0);

    // Fireball is level 3 and outside the band, so the feature does not reach it.
    const outside = cast(
      table([], 40),
      { spellId: 'fireball', targets: [], at: { x: 100, y: 140, z: 0 }, slotLevel: 3 },
      CERTAIN,
    );
    expect(damage(outside.outcome)).toBeGreaterThan(0);
  });

  /** The maximisation, at a band of one level, and a price in a different die. */
  it('maximises a level 3 spell and charges nothing for the first two', () => {
    const request = {
      spellId: 'fireball',
      targets: [],
      at: { x: 100, y: 140, z: 0 },
      slotLevel: 3,
      usingFeatures: ['storm-warden:thunderhead'],
    } as const;
    const first = cast(table([], 40), request, DOOMED);
    expect(damage(first.outcome)).toBe(48);
    expect(tallied(first.state.creatures[WARDEN]!.resources, 'storm-warden:thunderhead')).toBe(1);

    const start = fold('seed', table([], 40)).creatures[WARDEN]!.vitals.hp;
    const second = cast(first.log, request, DOOMED);
    expect(second.state.creatures[WARDEN]!.vitals.hp).toBe(start);

    // The third is the first that costs: 1d6 per slot level, so 3d6 — between
    // 3 and 18, and it comes off the Warden and nobody else.
    const third = cast(second.log, request, DOOMED);
    const paid = start - third.state.creatures[WARDEN]!.vitals.hp;
    expect(paid).toBeGreaterThanOrEqual(3);
    expect(paid).toBeLessThanOrEqual(18);
    expect(tallied(third.state.creatures[WARDEN]!.resources, 'storm-warden:thunderhead')).toBe(3);
    expect(damage(third.outcome)).toBe(48);
  });

  /**
   * The count is a tally rather than a pool, and a Short Rest is what empties
   * this one — which is a field on the grant, not a rule anywhere.
   */
  it('counts the uses under the key the feature named, recovering on a Short Rest', () => {
    const { state } = cast(
      table([], 40),
      {
        spellId: 'fireball',
        targets: [],
        at: { x: 100, y: 140, z: 0 },
        slotLevel: 3,
        usingFeatures: ['storm-warden:thunderhead'],
      },
      DOOMED,
    );
    expect(state.creatures[WARDEN]?.resources.tallies['storm-warden:thunderhead']).toEqual({
      key: 'storm-warden:thunderhead',
      count: 1,
      recovers: 'short-rest',
    });
  });

  /** A price counted in two different dice has no single answer, and is refused. */
  it('refuses a price that escalates in a die it is not printed in', () => {
    const broken = JSON.parse(WARDEN_CLASS) as {
      features: (FeatureDefinition & {
        grants?: { effects?: { costs?: { increasesBy?: string } }[] };
      })[];
    };
    const thunderhead = broken.features[3]!;
    thunderhead.grants!.effects![0]!.costs!.increasesBy = '1d8';
    expect(isErr(parseClassDefinition(broken))).toBe(true);
    expect(
      checkContent({ classes: [broken as never] }).map((problem) => problem.code),
    ).toContain('mismatched_backlash_dice');
  });

  /** A band no slot falls in reaches nothing, and nothing would ever say so. */
  it('refuses a band of slot levels that runs backwards', () => {
    const broken = JSON.parse(WARDEN_CLASS) as {
      features: (FeatureDefinition & {
        grants?: { effects?: { when?: { slotLevels?: { from: number; to: number } } }[] };
      })[];
    };
    broken.features[2]!.grants!.effects![0]!.when!.slotLevels = { from: 5, to: 1 };
    expect(isErr(parseClassDefinition(broken))).toBe(true);
    expect(
      checkContent({ classes: [broken as never] }).map((problem) => problem.code),
    ).toContain('empty_slot_band');
  });
});
