import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  createCharacter,
  createRng,
  createRollIssuer,
  fold,
  resolveAttack,
  rollUnder,
  type CharacterChoices,
  type CharacterSheet,
  type GameEvent,
  type Rng,
  type RngState,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';

/**
 * **SRD Savage Attacker, and the scope a rule about a hit can have.**
 *
 * > Once per turn when you hit a target with a weapon, you can roll the
 * > weapon's damage dice twice and use either roll against the target.
 *
 * Great Weapon Fighting is the sentence next door and it is a different shape:
 * it reads *a die* — "any 1 or 2 on a damage die" — and reaches every die the
 * swing throws, riders included. This one reads *the roll*, compares two
 * totals, and reaches the weapon's own dice and nothing else. `DieEffect`
 * could never have said it, because every member of that interface is handed
 * one face at a time; `RollRule` and `rollUnder` are where it lives.
 *
 * What this file pins is the arithmetic, the scope, the limit and the log.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const GOBLIN = id('goblin');

const choices = (feats: CharacterChoices['feats']): CharacterChoices => ({
  name: 'Bren',
  classId: 'fighter',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'champion',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats,
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const COMMON: CharacterChoices['feats'] = {
  'sage:magic-initiate-wizard': {
    featId: 'magic-initiate',
    spellList: 'wizard',
    spellcastingAbility: 'int',
    cantrips: ['mage-hand', 'light'],
    levelOneSpell: 'find-familiar',
  },
  'human:versatile': { featId: 'alert' },
  'fighter:fighting-style': { featId: 'archery' },
};

/** The same character twice: once with the feat, once spending the slot on scores. */
const WITH_FEAT: CharacterChoices['feats'] = {
  ...COMMON,
  'fighter:ability-score-improvement': { featId: 'savage-attacker' },
};

const WITHOUT_FEAT: CharacterChoices['feats'] = {
  ...COMMON,
  'fighter:ability-score-improvement': {
    featId: 'ability-score-improvement',
    abilities: ['dex', 'dex'],
  },
};

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

const field = (feats: CharacterChoices['feats']): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, choices(feats), BREN), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: BREN, side: 'party' },
  {
    type: 'creature-added',
    id: GOBLIN,
    name: 'goblin',
    sheet: plain(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'goblins',
  },
  {
    type: 'items-gained',
    id: BREN,
    items: [{ id: 'greatsword', quantity: 1 }],
    source: 'the quartermaster',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: BREN, placement: { from: { landmark: 'the road' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: BREN }, feet: 5, bearing: 0 },
  },
];

/** A generator scripted by die size, so a d20 and a d6 cannot get in each other's way. */
const scripted = (faces: Readonly<Record<number, readonly number[]>>): Rng => {
  const queues = new Map<number, number[]>(
    Object.entries(faces).map(([sides, values]) => [Number(sides), [...values]]),
  );
  return {
    int: (sides: number): number => {
      const queue = queues.get(sides);
      if (queue === undefined || queue.length === 0) {
        throw new Error(`the script has no d${sides} left to throw`);
      }
      return queue.shift()!;
    },
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const supply = (rng: Rng) => ({ issuer: createRollIssuer('r'), rng, content: SRD_CONTENT });

interface LoggedDie {
  readonly rolled: number;
  readonly disposition: string;
  readonly cause: string | null;
}

/** The weapon's own component, as the log recorded it. */
const weaponDice = (events: readonly GameEvent[], source: string): readonly LoggedDie[] => {
  const record = events.find((e) => e.type === 'damage-dice-recorded');
  if (record?.type !== 'damage-dice-recorded') throw new Error('no damage dice were recorded');
  const component = record.components.find((one) => one.source === source);
  if (component === undefined) throw new Error(`no ${source} component in the log`);
  return component.dice.map((die) => ({
    rolled: die.rolled,
    disposition: die.disposition,
    cause: die.cause,
  }));
};

const damageTaken = (events: readonly GameEvent[]): number => {
  const hit = events.find((e) => e.type === 'damage-taken');
  if (hit?.type !== 'damage-taken') throw new Error('nothing was damaged');
  return hit.amount;
};

/**
 * A swing with a Greatsword, on a script that lands a hit and then throws the
 * damage. A 2d6 Greatsword under the feat throws four d6, in order.
 */
const swing = (
  log: readonly GameEvent[],
  faces: Readonly<Record<number, readonly number[]>>,
  command: { readonly extraDamage?: readonly { readonly source: string; readonly type: string; readonly dice: string }[] } = {},
) => {
  const out = unwrap(
    resolveAttack(
      fold('seed', log),
      BREN,
      { target: GOBLIN, weapon: 'greatsword', twoHanded: true, free: true, ...command },
      supply(scripted(faces)),
    ),
    'attack',
  );
  return { ...out, log: [...log, ...out.events] };
};

describe('SRD Savage Attacker rolls the weapon’s dice twice and keeps the better total', () => {
  it('throws the weapon’s dice a second time and counts the higher of the two', () => {
    // A Greatsword is 2d6. The script throws 1 and 2 first (three), then 5 and
    // 6 (eleven), so the second throw is the one that counts.
    const out = swing(field(WITH_FEAT), { 20: [15], 6: [1, 2, 5, 6] });
    const dice = weaponDice(out.events, 'Greatsword');

    expect(dice.map((d) => d.rolled)).toEqual([1, 2, 5, 6]);
    expect(dice.map((d) => d.disposition)).toEqual(['dropped', 'dropped', 'counted', 'counted']);
    // Both throws are in the log, and the one that was given up says whose
    // second throw it was.
    expect(dice.map((d) => d.cause)).toEqual([null, null, 'Savage Attacker', 'Savage Attacker']);
    // Eleven on the dice, plus a Strength modifier of +2.
    expect(damageTaken(out.events)).toBe(11 + 2);
  });

  it('keeps the first throw when it is the better one', () => {
    const out = swing(field(WITH_FEAT), { 20: [15], 6: [6, 6, 1, 1] });
    const dice = weaponDice(out.events, 'Greatsword');
    expect(dice.map((d) => d.disposition)).toEqual(['counted', 'counted', 'dropped', 'dropped']);
    expect(damageTaken(out.events)).toBe(12 + 2);
  });

  it('leaves a creature without the feat with one throw', () => {
    const out = swing(field(WITHOUT_FEAT), { 20: [15], 6: [1, 2] });
    const dice = weaponDice(out.events, 'Greatsword');
    expect(dice.map((d) => d.rolled)).toEqual([1, 2]);
    expect(damageTaken(out.events)).toBe(3 + 2);
  });

  /**
   * **The scope, which is the whole reason this is not `damageEffects`.** SRD
   * says "the weapon's damage dice"; a rider's dice are not the weapon's, so
   * they are thrown once even though the feature and the rider ride on one hit.
   */
  it('throws extra damage of another type once', () => {
    const out = swing(
      field(WITH_FEAT),
      { 20: [15], 6: [1, 1, 6, 6], 8: [3] },
      { extraDamage: [{ source: 'Sneak Attack', type: 'piercing', dice: '1d8' }] },
    );
    expect(weaponDice(out.events, 'Greatsword').map((d) => d.rolled)).toEqual([1, 1, 6, 6]);
    expect(weaponDice(out.events, 'Sneak Attack').map((d) => d.rolled)).toEqual([3]);
    expect(damageTaken(out.events)).toBe(12 + 2 + 3);
  });

  /**
   * **One roll, not two.** The second throw is the other half of the same
   * damage roll — it shares an id, and the command issues the rolls it always
   * issued.
   */
  it('records the two throws as one roll inside one rolls-issued', () => {
    const out = swing(field(WITH_FEAT), { 20: [15], 6: [1, 2, 5, 6] });
    expect(out.events.filter((e) => e.type === 'rolls-issued')).toHaveLength(1);
    const record = out.events.find((e) => e.type === 'damage-dice-recorded');
    if (record?.type !== 'damage-dice-recorded') throw new Error('no dice recorded');
    const weapon = record.components.filter((one) => one.source === 'Greatsword');
    expect(weapon).toHaveLength(1);
    expect(weapon[0]!.dice).toHaveLength(4);
  });
});

describe('SRD Savage Attacker is once per turn', () => {
  const inCombat = (feats: CharacterChoices['feats']): readonly GameEvent[] => [
    ...field(feats),
    {
      type: 'combat-started',
      combatants: [
        { id: BREN, initiative: 20, speed: 30 },
        { id: GOBLIN, initiative: 1, speed: 30 },
      ],
    },
  ];

  it('rolls once on the second hit of the same turn', () => {
    const first = swing(inCombat(WITH_FEAT), { 20: [15], 6: [1, 1, 6, 6] });
    expect(weaponDice(first.events, 'Greatsword')).toHaveLength(4);
    expect(
      first.events.some((e) => e.type === 'feature-used' && e.feature === 'savage-attacker'),
    ).toBe(true);

    const second = swing(first.log, { 20: [15], 6: [1, 1] });
    expect(weaponDice(second.events, 'Greatsword').map((d) => d.rolled)).toEqual([1, 1]);
    expect(damageTaken(second.events)).toBe(2 + 2);
  });

  it('gives the allowance back on the next turn', () => {
    const first = swing(inCombat(WITH_FEAT), { 20: [15], 6: [1, 1, 6, 6] });
    const next: readonly GameEvent[] = [
      ...first.log,
      { type: 'turn-advanced' },
      { type: 'turn-advanced' },
    ];
    expect(weaponDice(swing(next, { 20: [15], 6: [1, 1, 6, 6] }).events, 'Greatsword')).toHaveLength(
      4,
    );
  });
});

describe('a critical throws the doubled set twice', () => {
  /**
   * SRD's Critical Hit doubles the weapon's damage dice; the feat then rolls
   * "the weapon's damage dice", which by that point is the doubled set. So a
   * critical Greatsword under the feat throws eight d6 and counts four.
   */
  it('doubles first and throws the doubled notation twice', () => {
    const out = swing(field(WITH_FEAT), { 20: [20], 6: [1, 1, 1, 1, 6, 6, 6, 6] });
    const dice = weaponDice(out.events, 'Greatsword');
    expect(dice).toHaveLength(8);
    expect(dice.slice(0, 4).every((d) => d.disposition === 'dropped')).toBe(true);
    expect(damageTaken(out.events)).toBe(24 + 2);
  });
});

describe('rollUnder is deterministic', () => {
  it('throws the same eight faces from the same seed, whichever half it counts', () => {
    const once = unwrap(
      rollUnder(createRng('savage') as Rng, '2d6', { kind: 'roll-twice-keep-either', name: 'x' }),
      'first',
    );
    const again = unwrap(
      rollUnder(createRng('savage') as Rng, '2d6', { kind: 'roll-twice-keep-either', name: 'x' }),
      'second',
    );
    expect(again.dice.map((d) => d.rolled)).toEqual(once.dice.map((d) => d.rolled));
    expect(again.total).toBe(once.total);
    // The generator moved by two throws either way, which is what keeps a
    // replay of the rest of the log on the same faces.
    expect(once.dice).toHaveLength(4);
  });

  it('is the ordinary roll when no rule was gathered', () => {
    const plainRoll = unwrap(rollUnder(createRng('savage') as Rng, '2d6', null), 'none');
    expect(plainRoll.dice).toHaveLength(2);
  });
});
