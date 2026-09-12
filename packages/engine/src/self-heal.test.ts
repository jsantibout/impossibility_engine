import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer, type RollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { useSelfHeal } from './commands.js';
import { remaining } from './resources.js';
import { MARTIAL_ARTS_DIE } from './monk.js';

/**
 * Spend a use, roll a die, heal yourself.
 *
 * Second Wind and Wholeness of Body are one sentence apart, and both of their
 * pools have existed — declared, sized off the class table, refilling on the
 * right rest — while the hit points they exist to give did not arrive. Second
 * Wind's own note said so out loud: *"healCreature exists and nothing ties the
 * two together."* That is the ninth time in this repo that a rule turned out
 * to be a pure function nothing called.
 *
 * | | Second Wind | Wholeness of Body |
 * |---|---|---|
 * | Die | 1d10 | your Martial Arts die |
 * | Plus | your Fighter level | your Wisdom modifier |
 * | Minimum | — | 1 |
 *
 * The die is a printed number for one and a column of the class table for the
 * other, so it is resolved at that class's own level — the rule Sneak Attack's
 * dice and Rage Damage's flat bonus already follow.
 */

const id = (s: string) => asCharacterId(s);
const BRAM = id('bram');
const TAM = id('tam');

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
  cantrips: [],
  preparedSpells: [],
};

const FEATS = {
  'sage:magic-initiate-wizard': {
    featId: 'magic-initiate',
    spellList: 'wizard',
    spellcastingAbility: 'int' as const,
    cantrips: ['mage-hand', 'light'],
    levelOneSpell: 'find-familiar',
  },
  'human:versatile': { featId: 'alert' },
};

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
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...FEATS,
    'fighter:fighting-style': { featId: 'defense' },
    ...(level >= 10 ? { 'champion:additional-fighting-style': { featId: 'archery' } } : {}),
    ...(level >= 8 ? { 'fighter:ability-score-improvement-2': { featId: 'alert' } } : {}),
    // No Epic Boon feat is defined, so nothing above Fighter 18 is buildable;
    // three levels is enough to pin an addend that is the level itself.
    ...(level >= 4 ? { 'fighter:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
  },
});

const monk = (level: number, wis: number): CharacterChoices => ({
  ...common,
  name: 'Tam',
  classId: 'monk',
  level,
  abilities: {
    method: 'manual',
    assignment: { str: 10, dex: 15, con: 13, int: 8, wis, cha: 12 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['acrobatics', 'stealth'],
  subclassId: 'warrior-of-the-open-hand',
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...FEATS,
    ...(level >= 4 ? { 'monk:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
  },
});

/** Built, or the refusal — so a broken fixture says which rule it broke. */
const eventsFor = (choices: CharacterChoices, who: string): readonly GameEvent[] => {
  const out = createCharacter(choices, id(who));
  if (!out.ok) throw new Error(`${choices.classId} ${choices.level}: ${out.code} — ${out.reason}`);
  return out.value;
};

interface Supply {
  readonly issuer: RollIssuer;
  readonly rng: Rng;
}

const supply = (seed = 'heal'): Supply => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
});

class Game {
  private events: GameEvent[];

  constructor(initial: readonly GameEvent[]) {
    this.events = [...initial];
  }

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  creature(who: string) {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return creature;
  }

  hp(who: string): number {
    return this.creature(who).vitals.hp;
  }

  left(who: string, key: string): number {
    return remaining(this.creature(who).resources, key);
  }
}

/** In combat, so there is an economy to spend a Bonus Action out of. */
const inCombat = (who: CharacterId): GameEvent => ({
  type: 'combat-started',
  combatants: [{ id: who, initiative: 20, speed: 30 }],
});

const rollOf = (events: readonly GameEvent[]) => {
  const roll = events.find((e) => e.type === 'roll-recorded');
  if (roll === undefined || roll.type !== 'roll-recorded') throw new Error('no roll was recorded');
  return roll;
};

const healedBy = (events: readonly GameEvent[]): number => {
  const healed = events.find((e) => e.type === 'healed');
  if (healed === undefined || healed.type !== 'healed') throw new Error('nothing was healed');
  return healed.amount;
};

describe('Second Wind', () => {
  const built = (level = 5, hurt = 30) =>
    new Game([
      ...eventsFor(fighter(level), 'bram'),
      { type: 'damage-taken', id: BRAM, amount: hurt, source: 'a trap' },
    ]);

  /**
   * SRD: "As a Bonus Action, you can use it to regain Hit Points equal to 1d10
   * plus your Fighter level."
   *
   * Asserted against the die the log recorded rather than against a number a
   * seed happened to produce — the arithmetic is the claim, not the roll.
   */
  it('heals the die plus the Fighter level, and the log says which is which', () => {
    const g = built(5);
    const before = g.hp('bram');
    const events = unwrap(useSelfHeal(g.state, BRAM, { feature: 'fighter:second-wind' }, supply()), 'heal');

    const roll = rollOf(events);
    expect(roll.label).toBe('Second Wind (1d10)');
    expect(roll.contributions).toEqual([{ source: 'Fighter level', amount: 5 }]);
    expect(healedBy(events)).toBe(roll.natural + 5);

    g.push(events);
    expect(g.hp('bram')).toBe(before + roll.natural + 5);
  });

  /** The die is 1d10 at every level; only the addend climbs. */
  it('adds the Fighter level, which is the half that changes', () => {
    for (const level of [1, 5, 11]) {
      // Enough to hurt a level 1 Fighter and not enough to kill one.
      const g = built(level, 5);
      const events = unwrap(
        useSelfHeal(g.state, BRAM, { feature: 'fighter:second-wind' }, supply(`s${level}`)),
        'heal',
      );
      expect(rollOf(events).contributions).toEqual([{ source: 'Fighter level', amount: level }]);
    }
  });

  it('spends a use of its own pool', () => {
    const g = built(5);
    expect(g.left('bram', 'second-wind')).toBe(3);
    g.push(unwrap(useSelfHeal(g.state, BRAM, { feature: 'fighter:second-wind' }, supply()), 'heal'));
    expect(g.left('bram', 'second-wind')).toBe(2);
  });

  /** SRD: "As a Bonus Action" — and in combat that is a thing to be out of. */
  it('spends the Bonus Action in combat', () => {
    const g = built(5).push([inCombat(BRAM)]);
    const events = unwrap(useSelfHeal(g.state, BRAM, { feature: 'fighter:second-wind' }, supply()), 'heal');
    expect(events.map((e) => e.type)).toContain('bonus-action-spent');

    g.push(events);
    const again = useSelfHeal(g.state, BRAM, { feature: 'fighter:second-wind' }, supply('b'));
    expect(isErr(again) && again.code).toBe('no_bonus_action');
  });

  /** Outside combat there is no economy to spend, exactly as a casting finds. */
  it('costs no Bonus Action outside combat', () => {
    const g = built(5);
    const events = unwrap(useSelfHeal(g.state, BRAM, { feature: 'fighter:second-wind' }, supply()), 'heal');
    expect(events.map((e) => e.type)).not.toContain('bonus-action-spent');
  });

  /**
   * Validate before rolling: a refusal must cost neither a use nor a turn of
   * the generator, or a replay diverges from the session that produced it.
   */
  it('refuses an empty pool without moving the generator', () => {
    const g = built(5);
    g.push([{ type: 'resource-spent', id: BRAM, key: 'second-wind', amount: 3 }]);

    const rolls = supply();
    const out = useSelfHeal(g.state, BRAM, { feature: 'fighter:second-wind' }, rolls);
    expect(isErr(out) && out.code).toBe('exhausted');
    expect(rolls.issuer.count).toBe(0);
  });

  /** "Hit points alone will not bring them back" — and the refusal is free. */
  it('refuses a dead Fighter without spending a use or a die', () => {
    const g = built(5);
    g.push([{ type: 'creature-died', id: BRAM, cause: 'a very large rock' }]);

    const rolls = supply();
    const out = useSelfHeal(g.state, BRAM, { feature: 'fighter:second-wind' }, rolls);
    expect(isErr(out) && out.code).toBe('dead');
    expect(rolls.issuer.count).toBe(0);
    expect(g.left('bram', 'second-wind')).toBe(3);
  });

  /** Healing is capped at the hit point maximum, which is `healCreature`'s job. */
  it('does not overshoot the hit point maximum', () => {
    const g = built(5, 1);
    const max = g.creature('bram').vitals.hpMax;
    g.push(unwrap(useSelfHeal(g.state, BRAM, { feature: 'fighter:second-wind' }, supply()), 'heal'));
    expect(g.hp('bram')).toBe(max);
  });

  it('refuses a feature this creature does not have', () => {
    const out = useSelfHeal(built(5).state, BRAM, { feature: 'open-hand:wholeness-of-body' }, supply());
    expect(isErr(out) && out.code).toBe('no_such_feature');
  });

  /** A retry with the same id is a no-op, not a second helping. */
  it('is idempotent under a repeated command id', () => {
    const g = built(5);
    const first = unwrap(
      useSelfHeal(g.state, BRAM, { feature: 'fighter:second-wind', commandId: 'c1' }, supply()),
      'first',
    );
    g.push(first);
    const hp = g.hp('bram');

    const second = unwrap(
      useSelfHeal(g.state, BRAM, { feature: 'fighter:second-wind', commandId: 'c1' }, supply('other')),
      'second',
    );
    expect(second).toEqual([]);
    expect(g.hp('bram')).toBe(hp);
    expect(g.left('bram', 'second-wind')).toBe(2);
  });
});

describe('Wholeness of Body', () => {
  const built = (level = 6, wis = 14) =>
    new Game([
      ...eventsFor(monk(level, wis), 'tam'),
      { type: 'damage-taken', id: TAM, amount: 20, source: 'a trap' },
    ]);

  it('arrives at the level the Open Hand table prints it', () => {
    const names = (g: Game) => (g.creature('tam').sheet.selfHeals ?? []).map((s) => s.feature);
    expect(names(built(5))).toEqual([]);
    expect(names(built(6))).toEqual(['open-hand:wholeness-of-body']);
  });

  /**
   * SRD: "roll your Martial Arts die. You regain a number of Hit Points equal
   * to the number rolled plus your Wisdom modifier."
   *
   * The die is a column of the Monk table, so it is read at the Monk's own
   * level — 1d8 at level 6 and 1d10 at 11, and a number written into the
   * feature could be neither.
   */
  it('rolls the Martial Arts die for the level it is read at', () => {
    expect(MARTIAL_ARTS_DIE[5]).toBe('1d8');
    expect(MARTIAL_ARTS_DIE[10]).toBe('1d10');

    for (const level of [6, 11]) {
      const g = built(level);
      const events = unwrap(
        useSelfHeal(g.state, TAM, { feature: 'open-hand:wholeness-of-body' }, supply(`m${level}`)),
        'heal',
      );
      expect(rollOf(events).label).toBe(`Wholeness of Body (${MARTIAL_ARTS_DIE[level - 1]})`);
    }
  });

  it('adds the Wisdom modifier, and heals by the total', () => {
    const g = built(6, 16);
    const events = unwrap(
      useSelfHeal(g.state, TAM, { feature: 'open-hand:wholeness-of-body' }, supply()),
      'heal',
    );
    expect(rollOf(events).contributions).toEqual([{ source: 'Wisdom', amount: 3 }]);
    expect(healedBy(events)).toBe(rollOf(events).natural + 3);
  });

  /** SRD: the pool is "a number of times equal to your Wisdom modifier (minimum of once)". */
  it('has as many uses as the Wisdom modifier allows', () => {
    expect(built(6, 16).left('tam', 'wholeness-of-body')).toBe(3);
    expect(built(6, 8).left('tam', 'wholeness-of-body')).toBe(1);
  });
});

/**
 * The minimum, which no Monk the engine can build will ever reach.
 *
 * SRD writes "(minimum of 1 Hit Point regained)", and on a d8 that bites only
 * at a Wisdom modifier of -1 or worse with a low roll. `useSelfHeal` is
 * ordinary over a sheet, so a sheet that reaches it can simply be written —
 * the same move a dawn-recovering pool made for a rest branch no class could
 * get to. On a 1d2 with a -2 modifier, both faces land under the floor.
 */
describe('a self-heal whose arithmetic falls below its floor', () => {
  const WHO = id('meagre');
  const sheet: CharacterSheet = {
    level: 3,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 6, cha: 10 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: false, medium: false, heavy: false, shields: false },
    baseSpeed: 30,
    spellcastingAbility: null,
    weaponProficiencies: [],
    selfHeals: [
      {
        feature: 'test:wisp',
        name: 'A Wisp Of Vigour',
        action: 'bonus-action',
        pool: 'test:wisp',
        dice: '1d2',
        plus: { kind: 'ability', ability: 'wis', label: 'Wisdom' },
        minimum: 1,
      },
    ],
  };

  it('heals the floor rather than nothing, whichever face comes up', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const g = new Game([
        { type: 'creature-added', id: WHO, name: 'meagre', sheet, maxHp: 30, diesAtZero: true },
        {
          type: 'resource-pool-declared',
          id: WHO,
          pool: { key: 'test:wisp', label: 'wisps', max: 9, recovers: 'long-rest' },
        },
        { type: 'damage-taken', id: WHO, amount: 20, source: 'a trap' },
      ]);

      const events = unwrap(useSelfHeal(g.state, WHO, { feature: 'test:wisp' }, supply(seed)), 'heal');
      const roll = rollOf(events);
      // 1 or 2 on the die, minus 2 for the modifier, is -1 or 0 — and the
      // SRD's floor makes both of them 1.
      expect(roll.natural - 2).toBeLessThan(1);
      expect(healedBy(events)).toBe(1);
    }
  });
});
