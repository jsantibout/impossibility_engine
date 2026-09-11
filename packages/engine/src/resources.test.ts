import { describe, expect, it } from 'vitest';
import { isErr, expect as unwrap } from '@ie/shared';
import {
  declarePool,
  remaining,
  resourceState,
  restore,
  restoreOn,
  slotLevelsAvailable,
  spellSlotKey,
  spellSlotLevel,
  spend,
  type ResourceState,
} from './resources.js';

const slots = (...levels: readonly (readonly [number, number])[]): ResourceState =>
  levels.reduce(
    (state, [level, max]) =>
      unwrap(
        declarePool(state, {
          key: spellSlotKey(level),
          label: `level ${level} spell slot`,
          max,
          recovers: 'long-rest',
        }),
        'declare',
      ),
    resourceState(),
  );

describe('resource pools are generic', () => {
  it('starts empty, and an undeclared pool has nothing in it', () => {
    const state = resourceState();
    expect(state.pools).toEqual({});
    expect(remaining(state, 'channel-divinity')).toBe(0);
  });

  /**
   * The pool is the mechanism; what fills it is somebody else's business. The
   * engine does not know that a level 3 Wizard has four level 1 slots — that
   * is a class table, and class progression is not modelled. Pools are
   * declared, never derived.
   */
  it('declares any named pool, not just spell slots', () => {
    const state = unwrap(
      declarePool(resourceState(), {
        key: 'channel-divinity',
        label: 'Channel Divinity',
        max: 2,
        recovers: 'short-rest',
      }),
      'declare',
    );
    expect(remaining(state, 'channel-divinity')).toBe(2);
  });

  it('refuses a pool with a negative or non-integer maximum', () => {
    const base = resourceState();
    const bad = (max: number) =>
      declarePool(base, { key: 'k', label: 'k', max, recovers: 'long-rest' });
    expect(isErr(bad(-1))).toBe(true);
    expect(isErr(bad(1.5))).toBe(true);
    expect(isErr(bad(NaN))).toBe(true);
  });

  it('refuses to redeclare a pool that already exists', () => {
    const state = slots([1, 4]);
    const again = declarePool(state, {
      key: spellSlotKey(1),
      label: 'level 1 spell slot',
      max: 9,
      recovers: 'long-rest',
    });
    expect(isErr(again)).toBe(true);
  });

  it('spends and reports what is left', () => {
    let state = slots([1, 4]);
    state = unwrap(spend(state, spellSlotKey(1)), 'spend');
    expect(remaining(state, spellSlotKey(1))).toBe(3);
    state = unwrap(spend(state, spellSlotKey(1), 2), 'spend');
    expect(remaining(state, spellSlotKey(1))).toBe(1);
  });

  /** A rules-legal refusal the DM narrates around, not an exception. */
  it('refuses to overspend, leaving the pool untouched', () => {
    const state = slots([1, 1]);
    const result = spend(state, spellSlotKey(1), 2);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('exhausted');
    expect(remaining(state, spellSlotKey(1))).toBe(1);
  });

  it('refuses to spend from a pool nobody declared', () => {
    const result = spend(resourceState(), spellSlotKey(9));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('unknown_pool');
  });

  it('restores, never above the maximum', () => {
    let state = slots([2, 3]);
    state = unwrap(spend(state, spellSlotKey(2), 3), 'spend');
    state = unwrap(restore(state, spellSlotKey(2), 10), 'restore');
    expect(remaining(state, spellSlotKey(2))).toBe(3);
  });

  it('restores every pool with a matching recovery, and no others', () => {
    let state = slots([1, 2]);
    state = unwrap(
      declarePool(state, {
        key: 'second-wind',
        label: 'Second Wind',
        max: 2,
        recovers: 'short-rest',
      }),
      'declare',
    );
    state = unwrap(spend(state, spellSlotKey(1), 2), 'spend');
    state = unwrap(spend(state, 'second-wind', 2), 'spend');

    state = restoreOn(state, 'short-rest');
    expect(remaining(state, 'second-wind')).toBe(2);
    expect(remaining(state, spellSlotKey(1))).toBe(0);

    state = restoreOn(state, 'long-rest');
    expect(remaining(state, spellSlotKey(1))).toBe(2);
  });

  it('serialises identically however it was reached', () => {
    const forwards = slots([1, 4], [2, 2]);
    const backwards = slots([2, 2], [1, 4]);
    expect(JSON.stringify(forwards)).toBe(JSON.stringify(backwards));
  });
});

describe('spell slot keys', () => {
  it('round-trips a level', () => {
    for (let level = 1; level <= 9; level += 1) {
      expect(spellSlotLevel(spellSlotKey(level))).toBe(level);
    }
  });

  it('does not mistake another pool for a slot', () => {
    expect(spellSlotLevel('channel-divinity')).toBeNull();
    expect(spellSlotLevel('spell-slot:zero')).toBeNull();
  });

  /** Cantrips are level 0 and never take a slot, so there is no level 0 pool. */
  it('has no slot key for a cantrip', () => {
    expect(() => spellSlotKey(0)).toThrow();
    expect(() => spellSlotKey(10)).toThrow();
  });

  it('lists the levels with a slot left, lowest first', () => {
    let state = slots([1, 2], [2, 1], [3, 1]);
    expect(slotLevelsAvailable(state)).toEqual([1, 2, 3]);
    state = unwrap(spend(state, spellSlotKey(2)), 'spend');
    expect(slotLevelsAvailable(state)).toEqual([1, 3]);
  });
});
