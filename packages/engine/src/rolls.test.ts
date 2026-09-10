import { describe, expect, it } from 'vitest';
import { isErr, expect as unwrap } from '@ie/shared';
import { createRng, type Rng, type RngState } from './dice.js';
import {
  createRollIssuer,
  recordExternalD20,
  recordExternalDamage,
  rollD20Recorded,
  rollRecorded,
} from './rolls.js';

const scriptedRng = (values: readonly number[]): Rng => {
  let i = 0;
  return {
    int: () => values[i++ % values.length]!,
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

describe('createRollIssuer', () => {
  it('issues sequential ids', () => {
    const issuer = createRollIssuer('s1');
    expect(issuer.issue('engine').id).toBe('s1:1');
    expect(issuer.issue('engine').id).toBe('s1:2');
    expect(issuer.issue('engine').id).toBe('s1:3');
  });

  // Ids must be reproducible: replaying the same log has to reproduce the same
  // ids, or a RollId recorded in an event stops resolving after a restart.
  it('reproduces the same ids for the same prefix and order', () => {
    const a = createRollIssuer('combat-7');
    const b = createRollIssuer('combat-7');
    for (let i = 0; i < 5; i++) expect(a.issue('engine').id).toBe(b.issue('engine').id);
  });

  it('separates ids issued under different prefixes', () => {
    expect(createRollIssuer('a').issue('engine').id).not.toBe(
      createRollIssuer('b').issue('engine').id,
    );
  });

  it('can resume from a count, so a session picks up where it left off', () => {
    const issuer = createRollIssuer('s1', 12);
    expect(issuer.issue('engine').id).toBe('s1:13');
  });

  it('reports how many it has issued', () => {
    const issuer = createRollIssuer('s1');
    issuer.issue('engine');
    issuer.issue('engine');
    expect(issuer.count).toBe(2);
  });

  it('carries a note when one is given', () => {
    const p = createRollIssuer('s1').issue('dm-override', 'softening the TPK');
    expect(p).toMatchObject({ source: 'dm-override', note: 'softening the TPK' });
  });

  it('defaults the note to null', () => {
    expect(createRollIssuer('s1').issue('engine').note).toBeNull();
  });
});

describe('rollD20Recorded', () => {
  it('stamps the roll as engine-generated', () => {
    const out = rollD20Recorded(createRollIssuer('s'), scriptedRng([14]), 'normal', 3);
    expect(out.provenance).toMatchObject({ id: 's:1', source: 'engine', note: null });
    expect(out.natural).toBe(14);
    expect(out.total).toBe(17);
  });

  it('keeps the underlying d20 behaviour', () => {
    const out = rollD20Recorded(createRollIssuer('s'), scriptedRng([7, 19]), 'advantage', 0);
    expect(out.rolls).toEqual([7, 19]);
    expect(out.natural).toBe(19);
  });
});

describe('rollRecorded', () => {
  it('stamps a damage roll as engine-generated', () => {
    const out = unwrap(rollRecorded(createRollIssuer('s'), scriptedRng([4]), '1d8+2'), 'roll');
    expect(out.provenance.source).toBe('engine');
    expect(out.total).toBe(6);
  });

  it('propagates a bad notation instead of issuing an id', () => {
    const issuer = createRollIssuer('s');
    expect(isErr(rollRecorded(issuer, createRng('x'), 'nonsense'))).toBe(true);
    expect(issuer.count).toBe(0);
  });
});

describe('recordExternalD20', () => {
  it('accepts a die read off a real table', () => {
    const out = unwrap(
      recordExternalD20(createRollIssuer('s'), {
        natural: 17,
        modifier: 4,
        source: 'physical-dice',
      }),
      'external',
    );
    expect(out.natural).toBe(17);
    expect(out.total).toBe(21);
    expect(out.rolls).toEqual([17]);
    expect(out.provenance).toMatchObject({ source: 'physical-dice' });
  });

  it('records a DM override with its reason', () => {
    const out = unwrap(
      recordExternalD20(createRollIssuer('s'), {
        natural: 20,
        modifier: 0,
        source: 'dm-override',
        note: 'let the bard have this one',
      }),
      'override',
    );
    expect(out.provenance).toMatchObject({
      source: 'dm-override',
      note: 'let the bard have this one',
    });
  });

  it('still flags criticals on an external roll', () => {
    const crit = unwrap(
      recordExternalD20(createRollIssuer('s'), { natural: 20, modifier: 0, source: 'physical-dice' }),
      'crit',
    );
    expect(crit.isCriticalHit).toBe(true);
    const fumble = unwrap(
      recordExternalD20(createRollIssuer('s'), { natural: 1, modifier: 0, source: 'physical-dice' }),
      'fumble',
    );
    expect(fumble.isCriticalMiss).toBe(true);
  });

  // A d20 has twenty faces whoever is holding it. Even an override has to name
  // a face the die could actually show.
  it.each([0, 21, -1, 2.5])('rejects %s as a d20 face', (natural) => {
    expect(
      isErr(
        recordExternalD20(createRollIssuer('s'), { natural, modifier: 0, source: 'physical-dice' }),
      ),
    ).toBe(true);
  });

  // Only the engine's own roll functions may claim engine provenance.
  // Otherwise the audit trail can be forged by the layer above.
  it('refuses to stamp an external roll as engine-generated', () => {
    const result = recordExternalD20(createRollIssuer('s'), {
      natural: 15,
      modifier: 0,
      source: 'engine',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.reason).toMatch(/engine/i);
  });

  it('issues no id when the roll is rejected', () => {
    const issuer = createRollIssuer('s');
    recordExternalD20(issuer, { natural: 99, modifier: 0, source: 'physical-dice' });
    expect(issuer.count).toBe(0);
  });
});

describe('recordExternalDamage', () => {
  it('accepts a total the dice could have produced', () => {
    const out = unwrap(
      recordExternalDamage(createRollIssuer('s'), {
        total: 7,
        notation: '1d8+2',
        source: 'physical-dice',
      }),
      'damage',
    );
    expect(out.total).toBe(7);
    expect(out.provenance.source).toBe('physical-dice');
  });

  it('accepts the exact bounds of the notation', () => {
    const min = recordExternalDamage(createRollIssuer('s'), {
      total: 3,
      notation: '1d8+2',
      source: 'physical-dice',
    });
    const max = recordExternalDamage(createRollIssuer('s'), {
      total: 10,
      notation: '1d8+2',
      source: 'physical-dice',
    });
    expect(isErr(min)).toBe(false);
    expect(isErr(max)).toBe(false);
  });

  // You cannot roll 30 on a d4. A physical roll outside the notation's range
  // is a transcription error, and silently trusting it corrupts the log.
  it('rejects a physical total the dice could not produce', () => {
    expect(
      isErr(
        recordExternalDamage(createRollIssuer('s'), {
          total: 30,
          notation: '1d4',
          source: 'physical-dice',
        }),
      ),
    ).toBe(true);
    expect(
      isErr(
        recordExternalDamage(createRollIssuer('s'), {
          total: 0,
          notation: '1d4',
          source: 'physical-dice',
        }),
      ),
    ).toBe(true);
  });

  // A DM overriding damage is not reporting a die, they are making a ruling.
  // Fudging is a legitimate part of running a table, so this is not bounded —
  // but it is recorded as an override so the log stays honest.
  it('allows a DM override outside the notation bounds', () => {
    const out = unwrap(
      recordExternalDamage(createRollIssuer('s'), {
        total: 1,
        notation: '8d6',
        source: 'dm-override',
        note: 'the dragon is toying with them',
      }),
      'override',
    );
    expect(out.total).toBe(1);
    expect(out.provenance).toMatchObject({ source: 'dm-override' });
  });

  it('still refuses a negative override', () => {
    expect(
      isErr(
        recordExternalDamage(createRollIssuer('s'), {
          total: -5,
          notation: '1d6',
          source: 'dm-override',
        }),
      ),
    ).toBe(true);
  });

  it('refuses engine provenance', () => {
    expect(
      isErr(
        recordExternalDamage(createRollIssuer('s'), {
          total: 4,
          notation: '1d6',
          source: 'engine',
        }),
      ),
    ).toBe(true);
  });

  it('rejects an unparsable notation', () => {
    expect(
      isErr(
        recordExternalDamage(createRollIssuer('s'), {
          total: 4,
          notation: 'nonsense',
          source: 'physical-dice',
        }),
      ),
    ).toBe(true);
  });
});
