import { describe, expect, it } from 'vitest';
import { createRng, restoreRng, roll, rollD20, parseNotation } from './dice.js';
import { isErr, isOk, expect as unwrap } from '@ie/shared';

describe('createRng', () => {
  it('produces an identical sequence for the same seed', () => {
    const a = createRng('goblin-ambush');
    const b = createRng('goblin-ambush');
    const seqA = Array.from({ length: 50 }, () => a.int(20));
    const seqB = Array.from({ length: 50 }, () => b.int(20));
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const values = Array.from({ length: 50 }, (_, i) => createRng('seed-' + i).int(1000));
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it('accepts a numeric seed', () => {
    expect(Array.from({ length: 10 }, () => createRng(42).int(6))).toEqual(
      Array.from({ length: 10 }, () => createRng(42).int(6)),
    );
  });

  it('stays within [1, sides] over many samples', () => {
    const rng = createRng('range-check');
    for (let i = 0; i < 10_000; i++) {
      const v = rng.int(20);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('covers every face of a d20', () => {
    const rng = createRng('coverage');
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) seen.add(rng.int(20));
    expect(seen.size).toBe(20);
  });

  it('restores the full forward sequence from a snapshot', () => {
    // This is what lets a session resume mid-combat without re-rolling.
    const rng = createRng('resume');
    for (let i = 0; i < 17; i++) rng.int(12);

    const restored = restoreRng(rng.snapshot());
    const original = Array.from({ length: 30 }, () => rng.int(12));
    const replayed = Array.from({ length: 30 }, () => restored.int(12));

    expect(replayed).toEqual(original);
  });

  it('snapshots are plain data, safe to persist as JSON', () => {
    const rng = createRng('json');
    rng.int(20);
    const state = rng.snapshot();
    const roundTripped = restoreRng(JSON.parse(JSON.stringify(state)));
    expect(roundTripped.int(20)).toBe(restoreRng(state).int(20));
  });
});

describe('parseNotation', () => {
  it('parses a plain die', () => {
    expect(unwrap(parseNotation('d20'), 'd20')).toEqual({
      count: 1,
      sides: 20,
      modifier: 0,
      keep: null,
    });
  });

  it('parses count, sides and a positive modifier', () => {
    expect(unwrap(parseNotation('2d6+3'), '2d6+3')).toEqual({
      count: 2,
      sides: 6,
      modifier: 3,
      keep: null,
    });
  });

  it('parses a negative modifier', () => {
    expect(unwrap(parseNotation('1d8-1'), '1d8-1')).toEqual({
      count: 1,
      sides: 8,
      modifier: -1,
      keep: null,
    });
  });

  it('parses keep-highest and keep-lowest', () => {
    expect(unwrap(parseNotation('4d6kh3'), 'kh')).toMatchObject({
      keep: { mode: 'highest', n: 3 },
    });
    expect(unwrap(parseNotation('2d20kl1'), 'kl')).toMatchObject({
      keep: { mode: 'lowest', n: 1 },
    });
  });

  it('is whitespace and case insensitive', () => {
    expect(unwrap(parseNotation(' 2D6 + 3 '), 'loose')).toMatchObject({
      count: 2,
      sides: 6,
      modifier: 3,
    });
  });

  it('rejects malformed notation', () => {
    for (const bad of ['', 'd', '2d', 'x2d6', '2d6+', '2d0', '0d6', '-1d6', '2d6kh']) {
      expect(isErr(parseNotation(bad)), 'expected rejection: ' + JSON.stringify(bad)).toBe(true);
    }
  });

  it('rejects keeping more dice than are rolled', () => {
    expect(isErr(parseNotation('2d6kh3'))).toBe(true);
  });

  it('rejects absurd dice counts rather than hanging', () => {
    expect(isErr(parseNotation('100000d6'))).toBe(true);
  });
});

describe('roll', () => {
  it('rolls the right number of dice and applies the modifier', () => {
    const rng = createRng('roll-basic');
    const out = unwrap(roll(rng, '2d6+3'), '2d6+3');
    expect(out.dice).toHaveLength(2);
    expect(out.modifier).toBe(3);
    const sum = out.dice.reduce((n, d) => n + d.value, 0);
    expect(out.total).toBe(sum + 3);
  });

  it('marks dropped dice as not kept and excludes them from the total', () => {
    const rng = createRng('roll-keep');
    const out = unwrap(roll(rng, '4d6kh3'), '4d6kh3');
    expect(out.dice).toHaveLength(4);

    const kept = out.dice.filter((d) => d.kept);
    const dropped = out.dice.filter((d) => !d.kept);
    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(1);

    const lowest = Math.min(...out.dice.map((d) => d.value));
    expect(dropped[0]!.value).toBe(lowest);
    expect(out.total).toBe(kept.reduce((n, d) => n + d.value, 0));
  });

  it('stays within the arithmetic bounds of the notation', () => {
    const rng = createRng('roll-floor');
    for (let i = 0; i < 500; i++) {
      const out = unwrap(roll(rng, '3d8-2'), '3d8-2');
      expect(out.total).toBeGreaterThanOrEqual(3 - 2);
      expect(out.total).toBeLessThanOrEqual(24 - 2);
    }
  });

  it('is reproducible from a seed', () => {
    const one = unwrap(roll(createRng('same'), '5d10+2'), 'a');
    const two = unwrap(roll(createRng('same'), '5d10+2'), 'b');
    expect(one).toEqual(two);
  });

  it('propagates a parse failure instead of throwing', () => {
    expect(isErr(roll(createRng('x'), 'nonsense'))).toBe(true);
  });
});

describe('rollD20', () => {
  it('rolls one die at normal', () => {
    const out = rollD20(createRng('n'), 'normal', 5);
    expect(out.rolls).toHaveLength(1);
    expect(out.total).toBe(out.natural + 5);
  });

  it('takes the higher die on advantage', () => {
    const rng = createRng('adv');
    for (let i = 0; i < 200; i++) {
      const out = rollD20(rng, 'advantage', 0);
      expect(out.rolls).toHaveLength(2);
      expect(out.natural).toBe(Math.max(...out.rolls));
    }
  });

  it('takes the lower die on disadvantage', () => {
    const rng = createRng('dis');
    for (let i = 0; i < 200; i++) {
      const out = rollD20(rng, 'disadvantage', 0);
      expect(out.rolls).toHaveLength(2);
      expect(out.natural).toBe(Math.min(...out.rolls));
    }
  });

  it('flags a natural 20 and a natural 1 off the die that was used', () => {
    const rng = createRng('crit-scan');
    let sawCrit = false;
    let sawFumble = false;
    for (let i = 0; i < 2_000; i++) {
      const out = rollD20(rng, 'normal', 3);
      expect(out.isCriticalHit).toBe(out.natural === 20);
      expect(out.isCriticalMiss).toBe(out.natural === 1);
      sawCrit ||= out.isCriticalHit;
      sawFumble ||= out.isCriticalMiss;
    }
    expect(sawCrit && sawFumble).toBe(true);
  });

  it('applies the modifier to the total but never to the crit check', () => {
    const rng = createRng('mod');
    for (let i = 0; i < 500; i++) {
      const out = rollD20(rng, 'normal', -4);
      expect(out.total).toBe(out.natural - 4);
      expect(out.isCriticalHit).toBe(out.natural === 20);
    }
  });

  it('is reproducible from a seed', () => {
    expect(rollD20(createRng('rep'), 'advantage', 2)).toEqual(
      rollD20(createRng('rep'), 'advantage', 2),
    );
  });
});

describe('result shape', () => {
  it('returns Ok for valid notation', () => {
    expect(isOk(roll(createRng('ok'), '1d4'))).toBe(true);
  });
});
