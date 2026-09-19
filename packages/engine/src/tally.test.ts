import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent } from './events.js';
import { declarePool, resourceState, restoreOn, tallied, tally } from './resources.js';
import { createRollIssuer, type RollIssuer } from './rolls.js';
import { declareDawn } from './commands.js';

/**
 * A tally: a pool's sibling with no size.
 *
 * The SRD counts two different things and the engine had only one of them. A
 * **pool** is a count with a ceiling, and running out of it is a refusal — "you
 * are out of third-level slots". A **tally** is a count with no ceiling at all,
 * and what multiplies it is a chance rather than a permission: SRD Wind Fan's
 * "each subsequent time the fan is used before the next dawn, it has a
 * cumulative 20 percent chance of not working", and Augury's "if you cast the
 * spell more than once before finishing a Long Rest, there is a cumulative 25
 * percent chance for each casting after the first".
 *
 * A pool of six would refuse the seventh use of the fan; the book has the sixth
 * one roll at 100 percent and tear the fan in half. **A pool refuses; a tally
 * only counts**, and the thing that reads it decides what the number means.
 *
 * Everything else is the pool's own machinery reused: the same `Recovery` tag,
 * the same `resources-restored` event a rest and a declared dawn already emit,
 * and the same `resource-spent` event a pool is spent through — which is what
 * keeps a count of uses out of the `GameEvent` union as a member of its own.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');

const sheet = (): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const added: GameEvent = {
  type: 'creature-added',
  id: GRUM,
  name: 'Grum',
  sheet: sheet(),
  maxHp: 20,
  diesAtZero: false,
};

/** One use, counted. The event a pool is spent through, saying which it is. */
const used = (key: string, recovers: 'dawn' | 'long-rest' | 'short-rest' | 'special'): GameEvent => ({
  type: 'resource-spent',
  id: GRUM,
  key,
  amount: 1,
  tally: recovers,
});

const FAN = 'wind-fan:uses';

const counted = (log: readonly GameEvent[], key = FAN): number =>
  tallied(fold('seed', log).creatures[GRUM]!.resources, key);

const supply = (seed = 'dawn-seed'): { issuer: RollIssuer; rng: Rng } => ({
  issuer: createRollIssuer('roll'),
  rng: createRng(seed) as Rng,
});

describe('a tally counts and has no size', () => {
  it('is nothing until something is counted', () => {
    expect(tallied(resourceState(), FAN)).toBe(0);
    expect(counted([added])).toBe(0);
  });

  it('counts up, with no maximum to run into', () => {
    const log = [added, ...Array.from({ length: 9 }, () => used(FAN, 'dawn'))];
    expect(counted(log)).toBe(9);
  });

  /**
   * The whole of the argument for building this rather than declaring a pool
   * of six: a pool refuses, and what the fan does on the sixth use is roll at
   * 100 percent and tear.
   */
  it('never refuses, however high it goes', () => {
    let state = resourceState();
    for (let use = 0; use < 50; use += 1) {
      state = unwrap(tally(state, FAN, 'dawn'), 'tally');
    }
    expect(tallied(state, FAN)).toBe(50);
  });

  it('folds to the same state on replay', () => {
    const log = [added, used(FAN, 'dawn'), used(FAN, 'dawn')];
    expect(JSON.stringify(fold('seed', log))).toBe(JSON.stringify(fold('seed', log)));
    expect(counted(log)).toBe(2);
  });

  it('keeps two keys apart, so two copies are two counts', () => {
    const log = [added, used(`${FAN}@item:1`, 'dawn'), used(`${FAN}@item:2`, 'dawn'), used(`${FAN}@item:1`, 'dawn')];
    expect(counted(log, `${FAN}@item:1`)).toBe(2);
    expect(counted(log, `${FAN}@item:2`)).toBe(1);
  });

  /**
   * A key is a name and nothing reads inside one — but a name may only mean one
   * thing at a time. A count under a pool's key would be a spend nobody could
   * tell from a use, and the log that wrote it is a log contradicting itself.
   */
  it('refuses a key that is already a pool', () => {
    const pooled = unwrap(
      declarePool(resourceState(), { key: FAN, label: 'charges', max: 3, recovers: 'dawn' }),
      'declare',
    );
    const out = tally(pooled, FAN, 'dawn');
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('pool_not_a_tally');
  });

  /** And the same rule from the other side, so neither door can blur the name. */
  it('refuses a pool declared over a key that is already counted', () => {
    const counted = unwrap(tally(resourceState(), FAN, 'dawn'), 'tally');
    const out = declarePool(counted, { key: FAN, label: 'charges', max: 3, recovers: 'dawn' });
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('tally_not_a_pool');
  });

  it('refuses an amount that is not a positive whole number', () => {
    expect(isErr(tally(resourceState(), FAN, 'dawn', 0))).toBe(true);
    expect(isErr(tally(resourceState(), FAN, 'dawn', 1.5))).toBe(true);
  });

  /**
   * A tally that answered to two tags would be zeroed by whichever came first,
   * which is a rule nobody wrote. The tag is the tally's, stated when it is
   * first counted and restated by every use after.
   */
  it('refuses a second tag for one key', () => {
    const dawn = unwrap(tally(resourceState(), FAN, 'dawn'), 'tally');
    const out = tally(dawn, FAN, 'long-rest');
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('tally_recovers_otherwise');
  });
});

describe('a tally is zeroed by the recovery it carries', () => {
  for (const recovers of ['dawn', 'long-rest', 'short-rest'] as const) {
    it(`is zeroed on a ${recovers}`, () => {
      const once = unwrap(tally(resourceState(), FAN, recovers), 'tally');
      expect(tallied(restoreOn(once, recovers), FAN)).toBe(0);
    });

    it(`is left alone by anything that is not its ${recovers}`, () => {
      const once = unwrap(tally(resourceState(), FAN, recovers), 'tally');
      const others = (['dawn', 'long-rest', 'short-rest', 'special'] as const).filter(
        (other) => other !== recovers,
      );
      for (const other of others) {
        expect(tallied(restoreOn(once, other), FAN)).toBe(1);
      }
    });
  }

  /**
   * SRD Potion of Longevity's 10 percent is cumulative over a *life*, so
   * `special` is the tag `resources.ts` already gives a count no rest and no
   * morning touches.
   */
  it("'special' answers to no rest and no morning", () => {
    const once = unwrap(tally(resourceState(), FAN, 'special'), 'tally');
    for (const recovers of ['dawn', 'long-rest', 'short-rest', 'special'] as const) {
      expect(tallied(restoreOn(once, recovers), FAN)).toBe(recovers === 'special' ? 0 : 1);
    }
  });

  it('is zeroed through the log by the event a rest already emits', () => {
    const log: GameEvent[] = [
      added,
      used(FAN, 'long-rest'),
      used(FAN, 'long-rest'),
      { type: 'resources-restored', id: GRUM, recovers: 'long-rest' },
    ];
    expect(counted(log)).toBe(0);
  });
});

/**
 * The bug this would otherwise ship: `declareDawn` walked a creature's *pools*
 * and skipped anybody holding no dawn pool — which is every holder of a Wind
 * Fan, since the fan has no charges at all. A tally that a dawn zeroes has to
 * be a reason for the dawn to reach that creature.
 */
describe('a declared dawn reaches a tally', () => {
  const holder = (): readonly GameEvent[] => [added, used(FAN, 'dawn'), used(FAN, 'dawn')];

  it('zeroes a dawn tally on a creature holding no dawn pool', () => {
    const before = holder();
    expect(counted(before)).toBe(2);

    const dawn = unwrap(declareDawn(fold('seed', before), supply()), 'dawn');
    expect(dawn.some((event) => event.type === 'resources-restored')).toBe(true);
    expect(counted([...before, ...dawn])).toBe(0);
  });

  it('leaves a tally that no dawn answers for alone', () => {
    const before: readonly GameEvent[] = [added, used(FAN, 'long-rest')];
    const dawn = unwrap(declareDawn(fold('seed', before), supply()), 'dawn');
    expect(counted([...before, ...dawn])).toBe(1);
  });

  /**
   * A dawn over a world with nothing to give back writes nothing, which is
   * what makes it a no-op however many times it is declared.
   */
  it('writes nothing for a creature with neither a dawn pool nor a dawn tally', () => {
    const dawn = unwrap(declareDawn(fold('seed', [added]), supply()), 'dawn');
    expect(dawn).toEqual([]);
  });
});
