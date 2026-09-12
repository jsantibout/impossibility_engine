import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng } from './dice.js';
import { fold, type GameEvent } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import { declareCreatureType, resolveSpell } from './commands.js';

/**
 * Facts the fiction supplies, and what the engine does with them.
 *
 * docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md draws the line: fiction may **supply** facts and may not
 * **overwrite** established truth. A creature's type is the clearest case in
 * the engine. Nobody derives it — a stat block prints it, a species grants
 * it, or the DM says — and once it is in state, Hold Person has been cast on
 * the strength of it. A second declaration that changes it would make that
 * casting retroactively illegitimate with nothing in the log saying so.
 *
 * Until now that is exactly what happened: `creature-type-declared` went
 * through the reducer unvalidated, and *nothing emitted it* — `resolveSpell`
 * asked for the event by name, and the layer above assembled one by hand and
 * wrote it into the authoritative log. That is narration writing directly to
 * truth. This file gives the request an authoritative provider and makes the
 * contradiction a refusal.
 *
 * The distinction that keeps this small: **type is durable** (what a thing
 * *is*), where sight and cover are **momentary** (what is true *now*). A
 * re-declared sight line is an update; a re-declared type is a contradiction.
 * Only the durable fact gets a guard, and a transformation that legitimately
 * changes a type — Wild Shape, Polymorph — will be its own event when it
 * lands, not a declaration.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const THUG = id('thug');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: ['wis'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId, creatureType: string | null): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 30,
  diesAtZero: false,
  ...(creatureType === null ? {} : { creatureType }),
});

/** A cleric who can see a thug of no declared type, ready to hold them. */
const TABLE: readonly GameEvent[] = [
  added(CLERIC, 'Humanoid'),
  added(THUG, null),
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: spellSlotKey(2), label: 'l2', max: 2, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['hold-person'] }),
  },
  { type: 'scene-set', extent: { width: 100, depth: 100, height: 20 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { sceneCenter: true }, feet: 0 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: CLERIC }, feet: 20, bearing: 0 } },
  { type: 'sight-declared', from: CLERIC, to: THUG, seen: true },
];

const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng('facts') });

const hold = (log: readonly GameEvent[]) =>
  resolveSpell(
    fold('s', log),
    CLERIC,
    { spellId: 'hold-person', targets: [THUG], slotLevel: 2 },
    supply(),
  );

describe('declaring a fact the engine asked for', () => {
  /**
   * The whole loop, for one D&D case: a rule inspects known state, finds a
   * factual requirement missing, names it; an authoritative provider supplies
   * it; the same action, asked again exactly as before, resolves.
   *
   * The request is what a tool surface branches on. `kind` is the field that
   * says which fact; `satisfyWith` is prose for whoever is reading. Both are
   * asserted, because the point of the request is that the caller need not
   * match an error code to know what to do.
   */
  it('names the missing fact, and the same cast resolves once it is declared', () => {
    const asked = hold(TABLE);
    expect(isNeedsContext(asked)).toBe(true);

    const requests = contextRequestsOf(asked);
    expect(requests.map((r) => r.kind)).toEqual(['creature-type']);
    expect(requests[0]?.subject).toBe(THUG);
    expect(requests[0]?.satisfyWith).toContain('declareCreatureType');

    const declared = unwrap(declareCreatureType(fold('s', TABLE), THUG, 'Humanoid'), 'declare');
    expect(declared.map((e) => e.type)).toEqual(['creature-type-declared']);

    const resolved = hold([...TABLE, ...declared]);
    expect(resolved.ok).toBe(true);
  });

  /** Completing the record adds a fact; it does not restate the world. */
  it('emits nothing when the fact is already established', () => {
    const declared = unwrap(declareCreatureType(fold('s', TABLE), THUG, 'Humanoid'), 'declare');
    const again = unwrap(
      declareCreatureType(fold('s', [...TABLE, ...declared]), THUG, 'Humanoid'),
      'again',
    );
    expect(again).toEqual([]);
  });

  it('accepts a declaration that agrees with the stat block it was added with', () => {
    const agreed = unwrap(declareCreatureType(fold('s', TABLE), CLERIC, 'Humanoid'), 'agree');
    expect(agreed).toEqual([]);
  });

  it('asks, rather than refuses, for a creature nobody has added', () => {
    const out = declareCreatureType(fold('s', TABLE), id('the-innkeeper'), 'Humanoid');
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.kind)).toEqual(['creature']);
  });
});

describe('a declared fact is not overwritten by a later one', () => {
  /**
   * docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md 6. The thug was held as a Humanoid; a declaration that they
   * were a Fey all along is not new information, it is a contradiction of
   * established truth — and Hold Person cannot touch a Fey, so honouring it
   * would leave a paralysis in state that the rules never permitted.
   */
  it('refuses a different type once one is established, and changes nothing', () => {
    const declared = unwrap(declareCreatureType(fold('s', TABLE), THUG, 'Humanoid'), 'declare');
    const before = fold('s', [...TABLE, ...declared]);

    const contradicted = declareCreatureType(before, THUG, 'Fey');
    expect(isErr(contradicted)).toBe(true);
    if (isErr(contradicted)) {
      expect(contradicted.code).toBe('type_established');
      // A contradiction is a verdict, not homework: the fact is *known*.
      expect(contradicted.kind).toBe('refusal');
    }
    expect(before.creatures.thug?.creatureType).toBe('Humanoid');
  });

  it('refuses to contradict the type a stat block printed', () => {
    const out = declareCreatureType(fold('s', TABLE), CLERIC, 'Undead');
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('type_established');
  });

  /**
   * And the log agrees. Rules-legal refusals never become events, so a
   * contradicting declaration in the record means the command layer was
   * bypassed — which is the corrupt-log case, and it throws rather than
   * quietly picking whichever declaration came last.
   */
  it('treats a log that contradicts itself as corrupt', () => {
    const log: GameEvent[] = [
      ...TABLE,
      { type: 'creature-type-declared', id: THUG, creatureType: 'Humanoid' },
      { type: 'creature-type-declared', id: THUG, creatureType: 'Fey' },
    ];
    expect(() => fold('s', log)).toThrow(/established/);
  });

  /**
   * Restating the same fact in the log is harmless. The event is counted, as
   * every event is, and changes nothing else.
   */
  it('folds a restated fact to the state it already had', () => {
    const once: GameEvent[] = [
      ...TABLE,
      { type: 'creature-type-declared', id: THUG, creatureType: 'Humanoid' },
    ];
    const twice: GameEvent[] = [
      ...once,
      { type: 'creature-type-declared', id: THUG, creatureType: 'Humanoid' },
    ];
    const before = fold('s', once);
    const after = fold('s', twice);
    expect(after.eventCount).toBe(before.eventCount + 1);
    expect({ ...after, eventCount: 0 }).toEqual({ ...before, eventCount: 0 });
  });
});
