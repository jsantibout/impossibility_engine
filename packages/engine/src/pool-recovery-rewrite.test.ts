import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, type CharacterId } from '@ie/shared';
import { fold, type GameEvent } from './events.js';
import type { CharacterSheet } from './character.js';
import { remaining, resourceState, rewriteRecovery } from './resources.js';

/**
 * A pool's recovery tag changing after the pool was declared.
 *
 * The SRD writes a later feature that rewrites an earlier one's recovery, and
 * `recovers` is pinned into `resource-pool-declared` — so moving it is a
 * change to a folded value and needs an event of its own. What it is *not* is
 * a re-declaration: the pool keeps its maximum and keeps what has been spent,
 * because a character who levels up mid-adventure has not rested.
 *
 * The event is also the shape a log written before it has to survive: it is
 * new, nothing that came before emits it, and a pool nothing rewrites recovers
 * exactly as the day it was declared.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WHO = id('who');

const sheet: CharacterSheet = {
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
};

const ADDED: GameEvent = {
  type: 'creature-added',
  id: WHO,
  name: 'who',
  sheet,
  maxHp: 30,
  diesAtZero: false,
  creatureType: 'Humanoid',
};

/** A pool the book gives back on a Long Rest, with two of its three spent. */
const DECLARED: GameEvent = {
  type: 'resource-pool-declared',
  id: WHO,
  pool: { key: 'dice', label: 'Dice', max: 3, recovers: 'long-rest' },
};

const SPENT: GameEvent = { type: 'resource-spent', id: WHO, key: 'dice', amount: 2 };

const REWRITTEN: GameEvent = {
  type: 'resource-pool-recovery-changed',
  id: WHO,
  key: 'dice',
  recovers: 'short-rest',
};

const restored = (recovers: 'short-rest' | 'long-rest'): GameEvent => ({
  type: 'resources-restored',
  id: WHO,
  recovers,
});

const left = (log: readonly GameEvent[]): number =>
  remaining(fold('seed', log).creatures[WHO]!.resources, 'dice');

const poolIn = (log: readonly GameEvent[]) =>
  fold('seed', log).creatures[WHO]!.resources.pools['dice'];

describe('the rewrite moves the tag and nothing else', () => {
  it('keeps the maximum and what has been spent', () => {
    const before = poolIn([ADDED, DECLARED, SPENT]);
    const after = poolIn([ADDED, DECLARED, SPENT, REWRITTEN]);

    expect(before?.recovers).toBe('long-rest');
    expect(after?.recovers).toBe('short-rest');
    expect(after?.max).toBe(3);
    // Not a re-declaration: levelling up is not a rest.
    expect(after?.spent).toBe(2);
  });

  it('is what a Short Rest then answers for', () => {
    expect(left([ADDED, DECLARED, SPENT, restored('short-rest')])).toBe(1);
    expect(left([ADDED, DECLARED, SPENT, REWRITTEN, restored('short-rest')])).toBe(3);
  });

  /**
   * And a **Long Rest** still gives it back, which is why one tag is the whole
   * answer and nothing declares the pool twice.
   *
   * The tag itself is exact — a `long-rest` restoration alone does not touch a
   * short-rest pool, and the line below says so rather than leaving it to be
   * assumed — but no rest ever emits that alone: `endRest` emits both tags for
   * a Long Rest, precisely so that a pool moved to the Short needs no second
   * declaration.
   */
  it('leaves the Long Rest giving everything back too', () => {
    expect(left([ADDED, DECLARED, SPENT, REWRITTEN, restored('long-rest')])).toBe(1);
    expect(
      left([ADDED, DECLARED, SPENT, REWRITTEN, restored('short-rest'), restored('long-rest')]),
    ).toBe(3);
  });

  it('refuses a key this creature has no pool for', () => {
    const missing = rewriteRecovery(resourceState(), 'nothing', 'short-rest');
    expect(isErr(missing) && missing.code).toBe('unknown_pool');
  });
});

describe('a log written before the event is untouched by it', () => {
  /** The pool recovers as it was declared, which is the old behaviour exactly. */
  it('gives a long-rest pool back on a Long Rest and not a Short', () => {
    expect(left([ADDED, DECLARED, SPENT, restored('short-rest')])).toBe(1);
    expect(left([ADDED, DECLARED, SPENT, restored('long-rest')])).toBe(3);
  });

  /** And neither frozen log carries one, so neither fold can have moved. */
  it('is absent from both frozen fixtures', () => {
    const here = fileURLToPath(new URL('../fixtures/', import.meta.url));
    for (const file of ['golden-log.json', 'golden-log-2.json']) {
      expect(readFileSync(`${here}${file}`, 'utf8')).not.toContain(
        'resource-pool-recovery-changed',
      );
    }
  });
});
