import { describe, expect, it } from 'vitest';
import { isErr, expect as unwrap } from '@ie/shared';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import {
  applyDamageToVitals,
  concentrationSaveDc,
  grantTemporaryHp,
  heal,
  isDown,
  rollDeathSave,
  stabilize,
  vitals,
} from './vitals.js';

const scriptedRng = (values: readonly number[]): Rng => {
  let i = 0;
  return {
    int: () => values[i++ % values.length]!,
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const issuer = () => createRollIssuer('t');

describe('vitals', () => {
  it('starts at full health', () => {
    expect(vitals(20)).toMatchObject({
      hp: 20,
      hpMax: 20,
      temporaryHp: 0,
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      stable: false,
      dead: false,
    });
  });

  it('accepts a starting state', () => {
    expect(vitals(20, { hp: 6 }).hp).toBe(6);
  });
});

describe('applyDamageToVitals', () => {
  it('subtracts from hit points', () => {
    const out = applyDamageToVitals(vitals(20), 7);
    expect(out.vitals.hp).toBe(13);
    expect(out.hpLost).toBe(7);
    expect(out.droppedToZero).toBe(false);
  });

  it('never drops below zero', () => {
    expect(applyDamageToVitals(vitals(20), 50).vitals.hp).toBe(0);
  });

  it('ignores zero damage', () => {
    expect(applyDamageToVitals(vitals(20), 0).vitals.hp).toBe(20);
  });

  // SRD: "If you have Temporary Hit Points and take damage, those points are
  // lost first, and any leftover damage carries over to your Hit Points."
  it('spends temporary hit points first, carrying the remainder over', () => {
    const start = grantTemporaryHp(vitals(20), 5);
    const out = applyDamageToVitals(start, 7);
    expect(out.temporaryAbsorbed).toBe(5);
    expect(out.hpLost).toBe(2);
    expect(out.vitals.temporaryHp).toBe(0);
    expect(out.vitals.hp).toBe(18);
  });

  it('absorbs the whole hit when temporary points cover it', () => {
    const out = applyDamageToVitals(grantTemporaryHp(vitals(20), 10), 4);
    expect(out.vitals.hp).toBe(20);
    expect(out.vitals.temporaryHp).toBe(6);
    expect(out.hpLost).toBe(0);
  });

  it('reports dropping to zero', () => {
    const out = applyDamageToVitals(vitals(20, { hp: 5 }), 5);
    expect(out.droppedToZero).toBe(true);
    expect(out.died).toBe(false);
  });

  /**
   * SRD Massive Damage, with the manual's own worked example: "if your
   * character has a Hit Point maximum of 12, currently has 6 Hit Points, and
   * takes 18 damage, the character drops to 0 Hit Points, but 12 damage
   * remains. The character then dies, since 12 equals their Hit Point maximum."
   */
  it('kills outright when the remainder equals the hit point maximum', () => {
    const out = applyDamageToVitals(vitals(12, { hp: 6 }), 18);
    expect(out.vitals.hp).toBe(0);
    expect(out.died).toBe(true);
    expect(out.cause).toMatch(/massive/i);
  });

  it('does not kill when the remainder is one short of the maximum', () => {
    const out = applyDamageToVitals(vitals(12, { hp: 6 }), 17);
    expect(out.died).toBe(false);
    expect(out.vitals.hp).toBe(0);
  });

  it('measures the remainder after temporary hit points are spent', () => {
    // 5 temporary absorbs first, so only 18 reaches hit points: 6 to zero,
    // 12 remaining — exactly lethal.
    const start = grantTemporaryHp(vitals(12, { hp: 6 }), 5);
    expect(applyDamageToVitals(start, 23).died).toBe(true);
    expect(applyDamageToVitals(start, 22).died).toBe(false);
  });

  // SRD: "A monster dies the instant it drops to 0 Hit Points."
  it('kills a monster outright at zero', () => {
    const out = applyDamageToVitals(vitals(7, { diesAtZero: true }), 7);
    expect(out.died).toBe(true);
    expect(out.cause).toMatch(/0 hit points/i);
  });

  it('leaves a character unconscious at zero instead', () => {
    const out = applyDamageToVitals(vitals(7), 7);
    expect(out.died).toBe(false);
    expect(isDown(out.vitals)).toBe(true);
  });

  // SRD: "If you take any damage while you have 0 Hit Points, you suffer a
  // Death Saving Throw failure. If the damage is from a Critical Hit, you
  // suffer two failures instead."
  it('adds a death save failure when damaged at zero', () => {
    const out = applyDamageToVitals(vitals(20, { hp: 0 }), 3);
    expect(out.deathSaveFailuresAdded).toBe(1);
    expect(out.vitals.deathSaveFailures).toBe(1);
  });

  it('adds two failures when that damage is a critical hit', () => {
    const out = applyDamageToVitals(vitals(20, { hp: 0 }), 3, { critical: true });
    expect(out.deathSaveFailuresAdded).toBe(2);
  });

  it('kills on the third failure accrued from damage', () => {
    const out = applyDamageToVitals(vitals(20, { hp: 0, deathSaveFailures: 2 }), 3);
    expect(out.vitals.dead).toBe(true);
  });

  // SRD: "If the damage equals or exceeds your Hit Point maximum, you die."
  it('kills instantly when damage at zero meets the hit point maximum', () => {
    const out = applyDamageToVitals(vitals(12, { hp: 0 }), 12);
    expect(out.died).toBe(true);
  });

  // SRD: "If the creature takes damage, it stops being Stable."
  it('ends stability', () => {
    const out = applyDamageToVitals(vitals(20, { hp: 0, stable: true }), 2);
    expect(out.vitals.stable).toBe(false);
  });

  it('leaves the dead alone', () => {
    const out = applyDamageToVitals(vitals(20, { dead: true, hp: 0 }), 10);
    expect(out.hpLost).toBe(0);
  });

  it('refuses negative damage', () => {
    expect(() => applyDamageToVitals(vitals(20), -5)).toThrow();
  });
});

describe('heal', () => {
  it('restores hit points', () => {
    expect(heal(vitals(20, { hp: 5 }), 7).hp).toBe(12);
  });

  it('does not exceed the maximum', () => {
    expect(heal(vitals(20, { hp: 18 }), 10).hp).toBe(20);
  });

  // SRD: "The number of both is reset to zero when you regain any Hit Points."
  it('clears death save progress and stability', () => {
    const revived = heal(
      vitals(20, { hp: 0, deathSaveSuccesses: 2, deathSaveFailures: 2, stable: true }),
      1,
    );
    expect(revived).toMatchObject({
      hp: 1,
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      stable: false,
    });
  });

  it('cannot revive the dead', () => {
    expect(heal(vitals(20, { hp: 0, dead: true }), 10).hp).toBe(0);
  });
});

describe('grantTemporaryHp', () => {
  // SRD: Temporary Hit Points don't stack — you keep one set or the other.
  it('keeps the larger pool rather than adding them', () => {
    expect(grantTemporaryHp(vitals(20, { temporaryHp: 8 }), 5).temporaryHp).toBe(8);
    expect(grantTemporaryHp(vitals(20, { temporaryHp: 3 }), 5).temporaryHp).toBe(5);
  });

  it('does not touch hit points', () => {
    expect(grantTemporaryHp(vitals(20, { hp: 12 }), 5).hp).toBe(12);
  });
});

describe('rollDeathSave', () => {
  // SRD: "Roll 1d20. If the roll is 10 or higher, you succeed."
  it('succeeds on a 10', () => {
    const out = unwrap(rollDeathSave(issuer(), scriptedRng([10]), vitals(20, { hp: 0 })), 'save');
    expect(out.success).toBe(true);
    expect(out.vitals.deathSaveSuccesses).toBe(1);
  });

  it('fails on a 9', () => {
    const out = unwrap(rollDeathSave(issuer(), scriptedRng([9]), vitals(20, { hp: 0 })), 'save');
    expect(out.success).toBe(false);
    expect(out.vitals.deathSaveFailures).toBe(1);
  });

  it('is not tied to an ability score', () => {
    // A monstrous Constitution changes nothing: the roll stands alone.
    const out = unwrap(rollDeathSave(issuer(), scriptedRng([10]), vitals(20, { hp: 0 })), 'save');
    expect(out.roll.total).toBe(10);
  });

  // SRD: "On your third success, you become Stable."
  it('stabilises on the third success', () => {
    const out = unwrap(
      rollDeathSave(issuer(), scriptedRng([15]), vitals(20, { hp: 0, deathSaveSuccesses: 2 })),
      'save',
    );
    expect(out.vitals.stable).toBe(true);
    expect(out.vitals.deathSaveSuccesses).toBe(0);
  });

  // SRD: "On your third failure, you die."
  it('kills on the third failure', () => {
    const out = unwrap(
      rollDeathSave(issuer(), scriptedRng([4]), vitals(20, { hp: 0, deathSaveFailures: 2 })),
      'save',
    );
    expect(out.vitals.dead).toBe(true);
  });

  // SRD: "When you roll a 1 ... you suffer two failures."
  it('counts a natural 1 as two failures', () => {
    const out = unwrap(rollDeathSave(issuer(), scriptedRng([1]), vitals(20, { hp: 0 })), 'save');
    expect(out.vitals.deathSaveFailures).toBe(2);
  });

  it('kills on a natural 1 at one failure already', () => {
    const out = unwrap(
      rollDeathSave(issuer(), scriptedRng([1]), vitals(20, { hp: 0, deathSaveFailures: 1 })),
      'save',
    );
    expect(out.vitals.dead).toBe(true);
  });

  // SRD: "If you roll a 20 on the d20, you regain 1 Hit Point."
  it('regains a hit point on a natural 20', () => {
    const out = unwrap(
      rollDeathSave(issuer(), scriptedRng([20]), vitals(20, { hp: 0, deathSaveFailures: 2 })),
      'save',
    );
    expect(out.vitals.hp).toBe(1);
    expect(out.vitals.deathSaveFailures).toBe(0);
    expect(out.vitals.dead).toBe(false);
  });

  it('records the roll with engine provenance', () => {
    const out = unwrap(rollDeathSave(issuer(), scriptedRng([12]), vitals(20, { hp: 0 })), 'save');
    expect(out.roll.provenance.source).toBe('engine');
  });

  it('refuses a creature that is not dying', () => {
    expect(isErr(rollDeathSave(issuer(), scriptedRng([12]), vitals(20)))).toBe(true);
  });

  // SRD: "A Stable creature doesn't make Death Saving Throws."
  it('refuses a stable creature', () => {
    expect(
      isErr(rollDeathSave(issuer(), scriptedRng([12]), vitals(20, { hp: 0, stable: true }))),
    ).toBe(true);
  });

  it('refuses the dead', () => {
    expect(
      isErr(rollDeathSave(issuer(), scriptedRng([12]), vitals(20, { hp: 0, dead: true }))),
    ).toBe(true);
  });
});

describe('stabilize', () => {
  it('stabilises and clears death save progress', () => {
    const out = stabilize(vitals(20, { hp: 0, deathSaveFailures: 2, deathSaveSuccesses: 1 }));
    expect(out).toMatchObject({ stable: true, deathSaveFailures: 0, deathSaveSuccesses: 0 });
  });

  it('leaves hit points at zero', () => {
    expect(stabilize(vitals(20, { hp: 0 })).hp).toBe(0);
  });
});

describe('concentrationSaveDc', () => {
  // SRD: "The DC equals 10 or half the damage taken (round down), whichever
  // number is higher, up to a maximum DC of 30."
  it('is 10 for light damage', () => {
    expect(concentrationSaveDc(9)).toBe(10);
    expect(concentrationSaveDc(20)).toBe(10);
  });

  it('is half the damage once that exceeds 10', () => {
    expect(concentrationSaveDc(21)).toBe(10);
    expect(concentrationSaveDc(22)).toBe(11);
    expect(concentrationSaveDc(45)).toBe(22);
  });

  it('rounds down', () => {
    expect(concentrationSaveDc(23)).toBe(11);
  });

  it('caps at 30', () => {
    expect(concentrationSaveDc(200)).toBe(30);
  });
});

describe('isDown', () => {
  it('is true at zero hit points', () => {
    expect(isDown(vitals(20, { hp: 0 }))).toBe(true);
  });

  it('is false above zero and false when dead', () => {
    expect(isDown(vitals(20, { hp: 1 }))).toBe(false);
    expect(isDown(vitals(20, { hp: 0, dead: true }))).toBe(false);
  });
});

describe('death saves can be modified', () => {
  const dying = () => vitals(20, { hp: 0 });

  /**
   * "Not tied to an ability score" is not the same as "unmodifiable". Beacon of
   * Hope grants advantage on death saves explicitly, and the earlier
   * implementation hardcoded a normal d20 at zero, so no effect could reach it.
   */
  it('takes advantage, as Beacon of Hope grants', () => {
    const out = unwrap(
      rollDeathSave(issuer(), scriptedRng([4, 17]), dying(), { modes: ['advantage'] }),
      'save',
    );
    expect(out.roll.natural).toBe(17);
    expect(out.success).toBe(true);
  });

  it('takes disadvantage', () => {
    const out = unwrap(
      rollDeathSave(issuer(), scriptedRng([17, 4]), dying(), { modes: ['disadvantage'] }),
      'save',
    );
    expect(out.roll.natural).toBe(4);
    expect(out.success).toBe(false);
  });

  it('takes a flat bonus, which can turn a failure into a success', () => {
    const bare = unwrap(rollDeathSave(issuer(), scriptedRng([8]), dying()), 'bare');
    expect(bare.success).toBe(false);

    const helped = unwrap(
      rollDeathSave(issuer(), scriptedRng([8]), dying(), {
        bonuses: [{ source: 'a blessing', flat: 2 }],
      }),
      'helped',
    );
    expect(helped.success).toBe(true);
  });

  it('takes a dice bonus', () => {
    const out = unwrap(
      rollDeathSave(issuer(), scriptedRng([7, 4]), dying(), {
        bonuses: [{ source: 'Bless', dice: '1d4' }],
      }),
      'bless',
    );
    expect(out.success).toBe(true);
  });

  /**
   * The natural results are decided by the die, not the modified total: a
   * natural 1 still costs two failures however much was added to it.
   */
  it('keeps natural 1 special regardless of bonuses', () => {
    const out = unwrap(
      rollDeathSave(issuer(), scriptedRng([1]), dying(), {
        bonuses: [{ source: 'a blessing', flat: 20 }],
      }),
      'fumble',
    );
    expect(out.vitals.deathSaveFailures).toBe(2);
    expect(out.success).toBe(false);
  });

  it('keeps natural 20 special regardless of penalties', () => {
    const out = unwrap(
      rollDeathSave(issuer(), scriptedRng([20]), dying(), {
        bonuses: [{ source: 'a curse', flat: -20 }],
      }),
      'crit',
    );
    expect(out.vitals.hp).toBe(1);
    expect(out.revived).toBe(true);
  });
});

describe('numeric validation at the entry points', () => {
  /**
   * A non-finite amount silently turned hit points into NaN, which then
   * compares false against every threshold — a creature neither alive nor dead.
   */
  it.each([NaN, Infinity, -Infinity])('refuses to heal by %s', (amount) => {
    expect(() => heal(vitals(10), amount)).toThrow(/finite/);
  });

  it.each([NaN, Infinity])('refuses temporary hit points of %s', (amount) => {
    expect(() => grantTemporaryHp(vitals(10), amount)).toThrow(/finite/);
  });

  it.each([NaN, 0, -5, Infinity])('refuses a hit point maximum of %s', (hpMax) => {
    expect(() => vitals(hpMax)).toThrow();
  });

  it('still allows ordinary values', () => {
    expect(heal(vitals(10, { hp: 1 }), 4).hp).toBe(5);
    expect(grantTemporaryHp(vitals(10), 0).temporaryHp).toBe(0);
  });
});

/**
 * What counts as *taking* damage when Temporary Hit Points soak it.
 *
 * The engine already rules on this once, for Concentration: "Temporary Hit
 * Points absorb damage; they do not stop it being taken", which is why a
 * Warlock behind Armor of Agathys who soaks 30 still rolls a DC 15 save.
 *
 * SRD keys the death-save rule on the same trigger — "If you take **any**
 * damage while you have 0 Hit Points, you suffer a Death Saving Throw failure"
 * — and Temporary Hit Points are explicitly a buffer against losing *Hit
 * Points*, not against taking damage. A downed character can hold them: "If
 * you have 0 Hit Points, receiving Temporary Hit Points doesn't restore you to
 * consciousness."
 *
 * So the two rules have to answer the same way, and the engine used to answer
 * them differently: a blow entirely soaked cost a Concentration save and no
 * death save failure.
 */
describe('temporary hit points do not stop damage being taken', () => {
  const downed = (temporaryHp: number) =>
    vitals(20, { hp: 0, temporaryHp, stable: false });

  it('costs a death saving throw failure even when the pool soaks it all', () => {
    const hit = applyDamageToVitals(downed(10), 6);
    expect(hit.temporaryAbsorbed).toBe(6);
    expect(hit.vitals.temporaryHp).toBe(4);
    expect(hit.vitals.hp).toBe(0);
    expect(hit.deathSaveFailuresAdded).toBe(1);
  });

  /** SRD: "If the damage is from a Critical Hit, you suffer two failures." */
  it('costs two on a critical, soaked or not', () => {
    expect(applyDamageToVitals(downed(10), 6, { critical: true }).deathSaveFailuresAdded).toBe(2);
  });

  /** SRD: "If the creature takes damage, it stops being Stable." */
  it('breaks Stable even when the pool soaks it all', () => {
    const stableWithBuffer = { ...downed(10), stable: true };
    expect(applyDamageToVitals(stableWithBuffer, 6).vitals.stable).toBe(false);
  });

  /** Zero is still not damage, and neither is a blow against an empty pool. */
  it('costs nothing for no damage at all', () => {
    expect(applyDamageToVitals(downed(10), 0).deathSaveFailuresAdded).toBe(0);
    expect(applyDamageToVitals({ ...downed(10), stable: true }, 0).vitals.stable).toBe(true);
  });

  /**
   * And the instant-death rule reads the damage, not what got through: SRD
   * says "If the damage equals or exceeds your Hit Point maximum, you die",
   * and the damage is what was dealt.
   */
  it('kills outright on damage equalling the maximum, however much was soaked', () => {
    const hit = applyDamageToVitals(downed(50), 20);
    expect(hit.died).toBe(true);
  });
});
