import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { ranged } from './spell-definitions.js';
import { resolveSpell } from './commands.js';

/**
 * SRD Sending, defined on the owner's ruling of 2026-09-25:
 *
 * > "You can send the message across any distance and even to other planes of
 * > existence, but **if the target is on a different plane than you, there is
 * > a 5 percent chance that the message doesn't arrive**. You know if the
 * > delivery fails."
 *
 * The one die in the spell is the `chance` effect Augury is written on, gated
 * on a fact only the table can declare — that the recipient is on another
 * plane — and thrown by the engine, because a model deciding whether a message
 * arrived would be a number the model produced. Its Range is the fourth kind:
 * Unlimited, which measures nothing and asks nothing. The message, the reply
 * and the eight-hour block are the table's.
 */

const id = (s: string) => asCharacterId(s);
const BARD = id('bard');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 18 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
});

const SETUP: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: BARD,
    name: BARD,
    sheet: sheet(),
    maxHp: 40,
    diesAtZero: false,
    creatureType: 'Humanoid',
  },
  {
    type: 'spellcasting-declared',
    id: BARD,
    spellcasting: declaredCasting({ ability: 'cha', prepared: ['sending', 'blink'] }),
  },
  {
    type: 'resource-pool-declared',
    id: BARD,
    pool: { key: spellSlotKey(3), label: 'level 3', max: 4, recovers: 'long-rest' },
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const send = (seed: string, otherPlane?: true) =>
  resolveSpell(
    state(SETUP),
    BARD,
    { spellId: 'sending', targets: [BARD], slotLevel: 3, ...(otherPlane === undefined ? {} : { otherPlane }) },
    supply(seed),
  );

const dieThrown = (events: readonly GameEvent[]) =>
  events.find((event) => event.type === 'roll-recorded' && event.label.includes('1d100'));

describe('the definition is written to the book', () => {
  const definition = () => SPELL_DEFINITIONS.find((one) => one.id === 'sending')!;

  it('prints an Unlimited Range that measures nothing, and one die gated on the plane', () => {
    expect(definition().range).toEqual({ kind: 'unlimited' });
    expect(ranged(definition().range)).toBeNull();
    expect(definition().effects).toEqual([
      { kind: 'chance', percent: 5, onlyIf: 'other-plane', onFailure: 'no-answer' },
    ]);
    expect(definition().dmDecides).toHaveLength(4);
    expect(checkSpellDefinitionValue(definition())).toEqual([]);
  });

  it('refuses a gate the book does not print', () => {
    const codes = checkSpellDefinitionValue({
      ...definition(),
      effects: [{ kind: 'chance', percent: 5, onlyIf: 'other-continent', onFailure: 'no-answer' }],
    }).map((one) => one.code);
    expect(codes).toContain('malformed_field');
  });
});

describe('a message across the planes', () => {
  it('throws the die when the recipient is on another plane, and both faces are reached across seeds', () => {
    const outcomes = new Set<boolean>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj', 'kk', 'll', 'mm', 'nn', 'oo', 'pp', 'qq', 'rr', 'ss', 'tt', 'uu', 'vv', 'ww', 'xx', 'yy', 'zz', 'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'i1', 'j1', 'k1', 'l1', 'm1', 'n1', 'o1', 'p1', 'q1', 'r1', 's1', 't1', 'u1', 'v1', 'w1', 'x1', 'y1', 'z1', 'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2', 'i2', 'j2', 'k2', 'l2', 'm2', 'n2', 'o2', 'p2', 'q2', 'r2', 's2', 't2', 'u2', 'v2', 'w2', 'x2', 'y2', 'z2']) {
      const out = unwrap(send(seed, true), `sending under ${seed}`);
      const thrown = dieThrown(out.events);
      expect(thrown, seed).toBeDefined();
      if (thrown?.type !== 'roll-recorded') throw new Error('unreachable');
      expect(thrown.label).toContain('against 5%');
      const failed = out.outcomes.some((one) => one.target === BARD && one.affected);
      expect(failed).toBe(thrown.natural <= 5);
      // A message that did not arrive hands nothing to the table; one that did
      // hands the book's own words over.
      expect(out.unverified.some((line) => line.includes('no answer'))).toBe(failed);
      expect(out.unverified.some((line) => line.includes('25 words or fewer'))).toBe(!failed);
      outcomes.add(failed);
    }
    expect(outcomes).toEqual(new Set([true, false]));
  });

  it('throws no die for a recipient on this plane, and hands the message to the table', () => {
    const out = unwrap(send('home'), 'sending at home');
    expect(dieThrown(out.events)).toBeUndefined();
    expect(out.events.some((event) => event.type === 'rolls-issued')).toBe(false);
    expect(out.outcomes).toEqual([{ target: BARD, affected: false }]);
    expect(out.unverified.some((line) => line.includes('25 words or fewer'))).toBe(true);
    expect(out.unverified.some((line) => line.includes('for 8 hours'))).toBe(true);
    // The slot went either way: the casting happened.
    expect(remaining(state([...SETUP, ...out.events]).creatures[BARD]!.resources, spellSlotKey(3))).toBe(3);
  });

  it('refuses the plane on a spell that prints no such clause, with nothing spent', () => {
    const before = state(SETUP);
    const out = resolveSpell(
      before,
      BARD,
      { spellId: 'blink', targets: [BARD], slotLevel: 3, otherPlane: true },
      supply('blink'),
    );
    expect(isErr(out) && out.code).toBe('no_plane_clause');
    expect(remaining(before.creatures[BARD]!.resources, spellSlotKey(3))).toBe(4);
  });
});
