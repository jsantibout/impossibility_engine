import { describe, expect, it } from 'vitest';
import { isErr, expect as unwrap } from '@ie/shared';
import type { Rng, RngState } from './dice.js';
import { explodeOnMax, rerollDice, roll, treatLowRollsAs } from './dice.js';

/** A generator returning a scripted sequence, so a test can pin exact faces. */
const scriptedRng = (values: readonly number[]): Rng => {
  let i = 0;
  return {
    int: () => values[i++ % values.length]!,
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const counted = (dice: readonly { disposition: string }[]) =>
  dice.filter((d) => d.disposition === 'counted');

describe('individual dice are addressable', () => {
  it('records what each die showed, its index and its origin', () => {
    const out = unwrap(roll(scriptedRng([3, 5]), '2d6'), '2d6');
    expect(out.dice).toHaveLength(2);
    expect(out.dice[0]).toMatchObject({
      index: 0,
      sides: 6,
      rolled: 3,
      value: 3,
      disposition: 'counted',
      origin: 'initial',
      cause: null,
      replaces: null,
    });
    expect(out.dice[1]).toMatchObject({ index: 1, rolled: 5 });
  });
});

describe('treatLowRollsAs — Great Weapon Fighting', () => {
  /**
   * SRD 2024: "you can treat any 1 or 2 on a damage die as a 3."
   *
   * Note this substitutes rather than rerolling. The 2014 rules rerolled 1s and
   * 2s; the 2024 rules do not, so no extra dice are rolled and the generator is
   * not advanced.
   */
  const gwf = treatLowRollsAs(2, 3, 'Great Weapon Fighting');

  it('counts a 1 as a 3 while recording the 1', () => {
    const out = unwrap(roll(scriptedRng([1]), '1d6', [gwf]), 'gwf');
    expect(out.dice[0]).toMatchObject({ rolled: 1, value: 3 });
    expect(out.total).toBe(3);
  });

  it('counts a 2 as a 3', () => {
    expect(unwrap(roll(scriptedRng([2]), '1d6', [gwf]), 'gwf').total).toBe(3);
  });

  it('leaves a 3 or higher alone', () => {
    expect(unwrap(roll(scriptedRng([3]), '1d6', [gwf]), 'gwf').total).toBe(3);
    expect(unwrap(roll(scriptedRng([6]), '1d6', [gwf]), 'gwf').total).toBe(6);
  });

  it('applies to every die of a multi-die roll independently', () => {
    // 2d6 for a greatsword: 1 and 5 becomes 3 and 5.
    const out = unwrap(roll(scriptedRng([1, 5]), '2d6', [gwf]), 'greatsword');
    expect(out.dice.map((d) => d.rolled)).toEqual([1, 5]);
    expect(out.dice.map((d) => d.value)).toEqual([3, 5]);
    expect(out.total).toBe(8);
  });

  it('rolls no extra dice, unlike the 2014 reroll version', () => {
    const rng = scriptedRng([1, 1, 1, 6]);
    const out = unwrap(roll(rng, '2d6', [gwf]), 'no-reroll');
    expect(out.dice).toHaveLength(2);
    expect(out.total).toBe(6);
  });

  it('still adds the notation modifier', () => {
    expect(unwrap(roll(scriptedRng([1]), '1d6+4', [gwf]), 'mod').total).toBe(7);
  });
});

describe('explodeOnMax — Sorcerous Burst', () => {
  /**
   * SRD: "If you roll an 8 on a d8 for this spell, you can roll another d8, and
   * add it to the damage. When you cast this spell, the maximum number of these
   * d8s you can add to the spell's damage equals your spellcasting ability
   * modifier."
   */
  const burst = (cap: number) => explodeOnMax(cap, 'Sorcerous Burst');

  it('adds a die when one shows its maximum', () => {
    // 8 explodes into a 5.
    const out = unwrap(roll(scriptedRng([8, 5]), '1d8', [burst(3)]), 'burst');
    expect(out.dice).toHaveLength(2);
    expect(out.dice[1]).toMatchObject({ rolled: 5, origin: 'bonus', cause: 'Sorcerous Burst' });
    expect(out.total).toBe(13);
  });

  it('adds nothing when no die shows its maximum', () => {
    const out = unwrap(roll(scriptedRng([7]), '1d8', [burst(3)]), 'no-trigger');
    expect(out.dice).toHaveLength(1);
    expect(out.total).toBe(7);
  });

  it('lets a bonus die trigger a further one', () => {
    // 8 -> 8 -> 2, all for the spell, so both 8s trigger.
    const out = unwrap(roll(scriptedRng([8, 8, 2]), '1d8', [burst(3)]), 'chain');
    expect(out.dice.map((d) => d.rolled)).toEqual([8, 8, 2]);
    expect(out.total).toBe(18);
  });

  it('stops at the cap even on an unbroken run of maximums', () => {
    // A cap of 2 with every die showing 8: one initial plus two bonuses.
    const out = unwrap(roll(scriptedRng([8]), '1d8', [burst(2)]), 'capped');
    expect(out.dice).toHaveLength(3);
    expect(out.total).toBe(24);
  });

  it('adds nothing at all when the cap is zero', () => {
    // A sorcerer with a +0 modifier adds no dice, however many 8s they roll.
    const out = unwrap(roll(scriptedRng([8]), '1d8', [burst(0)]), 'zero-cap');
    expect(out.dice).toHaveLength(1);
    expect(out.total).toBe(8);
  });

  it('shares one cap across all the dice of an upcast roll', () => {
    // 4d8 at level 17, every die an 8, cap 2: four initial plus two bonuses.
    const out = unwrap(roll(scriptedRng([8]), '4d8', [burst(2)]), 'upcast');
    expect(out.dice).toHaveLength(6);
    expect(out.dice.filter((d) => d.origin === 'bonus')).toHaveLength(2);
  });

  it('marks which effect added each bonus die', () => {
    const out = unwrap(roll(scriptedRng([8, 3]), '1d8', [burst(1)]), 'cause');
    expect(out.dice[1]!.cause).toBe('Sorcerous Burst');
  });
});

describe('effects compose', () => {
  it('substitutes and explodes on the same roll without interfering', () => {
    const effects = [
      treatLowRollsAs(2, 3, 'Great Weapon Fighting'),
      explodeOnMax(1, 'Sorcerous Burst'),
    ];
    // 1 becomes 3 and does not trigger; 8 triggers and adds a 1, itself a 3.
    const out = unwrap(roll(scriptedRng([1, 8, 1]), '2d8', effects), 'both');
    expect(out.dice.map((d) => d.rolled)).toEqual([1, 8, 1]);
    expect(out.dice.map((d) => d.value)).toEqual([3, 8, 3]);
    expect(out.total).toBe(14);
  });

  it('triggers a bonus off what the die showed, not its substituted value', () => {
    // Substituting 1 to 8 must not make it count as a maximum.
    const effects = [treatLowRollsAs(1, 8, 'Substitute'), explodeOnMax(5, 'Explode')];
    const out = unwrap(roll(scriptedRng([1]), '1d8', effects), 'no-false-trigger');
    expect(out.dice).toHaveLength(1);
    expect(out.total).toBe(8);
  });
});

describe('rerollDice — Empowered Spell', () => {
  /**
   * SRD Empowered Spell: "reroll a number of the damage dice up to your
   * Charisma modifier (minimum of one), and you must use the new rolls."
   * The player chooses which dice, so the caller names them.
   */
  it('replaces a named die and uses the new roll', () => {
    const first = unwrap(roll(scriptedRng([1, 6, 2]), '3d6'), 'first');
    expect(first.total).toBe(9);

    const after = unwrap(rerollDice(scriptedRng([5]), first, [0], 'Empowered Spell'), 'reroll');
    expect(after.total).toBe(13);
  });

  it('keeps the discarded die in the record', () => {
    const first = unwrap(roll(scriptedRng([1, 6]), '2d6'), 'first');
    const after = unwrap(rerollDice(scriptedRng([4]), first, [0], 'Empowered Spell'), 'reroll');

    expect(after.dice[0]).toMatchObject({ rolled: 1, disposition: 'rerolled' });
    expect(after.dice[2]).toMatchObject({
      rolled: 4,
      origin: 'reroll',
      cause: 'Empowered Spell',
      replaces: 0,
    });
  });

  it('must use the new roll even when it is worse', () => {
    const first = unwrap(roll(scriptedRng([6, 6]), '2d6'), 'first');
    const after = unwrap(rerollDice(scriptedRng([1]), first, [0], 'Empowered Spell'), 'worse');
    expect(after.total).toBe(7);
  });

  it('rerolls several dice at once', () => {
    const first = unwrap(roll(scriptedRng([1, 1, 6]), '3d6'), 'first');
    const after = unwrap(rerollDice(scriptedRng([5, 4]), first, [0, 1], 'Empowered Spell'), 'many');
    expect(counted(after.dice)).toHaveLength(3);
    expect(after.total).toBe(15);
  });

  it('applies effects to the replacement die', () => {
    const gwf = treatLowRollsAs(2, 3, 'Great Weapon Fighting');
    const first = unwrap(roll(scriptedRng([6]), '1d6', [gwf]), 'first');
    const after = unwrap(rerollDice(scriptedRng([1]), first, [0], 'Savage Attacker', [gwf]), 'sub');
    expect(after.dice[1]).toMatchObject({ rolled: 1, value: 3 });
    expect(after.total).toBe(3);
  });

  it('does not resurrect a die a keep clause had dropped', () => {
    const first = unwrap(roll(scriptedRng([1, 6, 6, 6]), '4d6kh3'), 'first');
    const dropped = first.dice.find((d) => d.disposition === 'dropped')!;
    const after = unwrap(rerollDice(scriptedRng([6]), first, [dropped.index], 'x'), 'dropped');

    expect(after.total).toBe(first.total);
    expect(after.dice.at(-1)).toMatchObject({ origin: 'reroll', disposition: 'dropped' });
  });

  it('refuses to reroll a die that is not there', () => {
    const first = unwrap(roll(scriptedRng([3]), '1d6'), 'first');
    expect(isErr(rerollDice(scriptedRng([5]), first, [9], 'x'))).toBe(true);
  });

  it('refuses to reroll the same die twice', () => {
    const first = unwrap(roll(scriptedRng([3, 3]), '2d6'), 'first');
    const once = unwrap(rerollDice(scriptedRng([5]), first, [0], 'x'), 'once');
    expect(isErr(rerollDice(scriptedRng([5]), once, [0], 'x'))).toBe(true);
  });

  it('leaves the modifier untouched', () => {
    const first = unwrap(roll(scriptedRng([1]), '1d6+3'), 'first');
    const after = unwrap(rerollDice(scriptedRng([5]), first, [0], 'x'), 'mod');
    expect(after.modifier).toBe(3);
    expect(after.total).toBe(8);
  });
});
