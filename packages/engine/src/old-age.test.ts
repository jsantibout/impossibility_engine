import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { extendContent, loadContent } from './content.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { declareCreatureDead, resolveSpell } from './commands.js';

/**
 * A death of old age, and the revival that reads it.
 *
 * > SRD Revivify: "This spell can't revive a creature that has died of old
 * > age, nor does it restore any missing body parts."
 * > SRD Resurrection: "a dead creature that … didn't die of old age"
 * > SRD True Resurrection: "died for any reason except old age"
 *
 * **How a creature died is the table's fact, and the revival reads it** — the
 * book refuses the spell on it — so it is a debt rather than a handover. No
 * engine road kills a creature of age: damage, a third failed death save and
 * Exhaustion 6 are all something else, so the only death that can be one is a
 * DM's ruling (`creature-died`), and the ruling says so in the one field
 * `declareCreatureDead` writes. A `revive` that prints the refusal
 * (`notOfOldAge`) reads it before a slot is spent.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const ELDER = id('elder');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 20,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(ELDER),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['revivify', 'homebrew-quickening'] }),
  },
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the bedside', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the bedside' }, feet: 0 } },
  { type: 'creature-placed', id: ELDER, placement: { from: { creature: CLERIC }, feet: 5 } },
  { type: 'sight-declared', from: CLERIC, to: ELDER, seen: true },
];

const supply = (content = SRD_CONTENT) => ({
  issuer: createRollIssuer('r'),
  rng: createRng('old-age') as Rng,
  content,
});

/** The elder dies by the DM's word, of age or not, and then thirty seconds go by. */
const died = (oldAge: boolean): GameState => {
  const before = fold('seed', SETUP);
  const ruling = unwrap(
    declareCreatureDead(before, ELDER, 'a long life', {}, oldAge ? { oldAge: true } : {}),
    'the ruling',
  );
  return [...ruling, { type: 'time-advanced', seconds: 30, reason: 'the fixture waits' } as GameEvent].reduce(
    applyEvent,
    before,
  );
};

const revivify = (state: GameState, content = SRD_CONTENT, spellId = 'revivify') =>
  resolveSpell(state, CLERIC, { spellId, targets: [ELDER], slotLevel: 3 }, supply(content));

describe('a death the DM rules was of old age', () => {
  it('is written on the death and held on the vitals', () => {
    const state = died(true);
    expect(state.creatures[ELDER]?.vitals.dead).toBe(true);
    expect(state.creatures[ELDER]?.vitals.diedOfOldAge).toBe(true);
  });

  it('is absent from every other death, so no log written before it moves', () => {
    const state = died(false);
    expect(state.creatures[ELDER]?.vitals.dead).toBe(true);
    expect('diedOfOldAge' in (state.creatures[ELDER]?.vitals ?? {})).toBe(false);
  });

  it('is part of what the ruling was, so the same id with another answer is refused', () => {
    const before = fold('seed', SETUP);
    const first = unwrap(
      declareCreatureDead(before, ELDER, 'a long life', { commandId: 'end' }, { oldAge: true }),
      'first',
    );
    const after = first.reduce(applyEvent, before);
    const again = declareCreatureDead(after, ELDER, 'a long life', { commandId: 'end' }, {});
    expect(isErr(again)).toBe(true);
  });
});

describe('SRD Revivify on a creature that died of old age', () => {
  it('refuses it, before the slot is spent', () => {
    const state = died(true);
    const out = revivify(state);
    expect(isErr(out) && out.code).toBe('died_of_old_age');
    expect(state.creatures[CLERIC]?.resources.pools[spellSlotKey(3)]?.spent ?? 0).toBe(0);
  });

  it('still revives a creature the same ruling killed of something else', () => {
    const state = died(false);
    const out = unwrap(revivify(state), 'the revival');
    const after = out.events.reduce(applyEvent, state);
    expect(after.creatures[ELDER]?.vitals.dead).toBe(false);
  });

  it('prints the refusal on the definition, and a revival that prints none reads nothing', () => {
    const quickening = {
      id: 'homebrew-quickening',
      name: 'Homebrew Quickening',
      level: 3,
      school: 'necromancy',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'touch' },
      targets: { count: 1 },
      effects: [{ kind: 'revive', within: 60, hitPoints: 1 }],
    };
    const content = unwrap(
      extendContent(SRD_CONTENT, {
        spells: [...unwrap(loadContent(JSON.parse(JSON.stringify({ spells: [quickening] }))), 'load').spells],
      }),
      'the homebrew',
    );
    const out = unwrap(revivify(died(true), content, 'homebrew-quickening'), 'a revival that ignores age');
    expect(out.events.some((event) => event.type === 'creature-revived')).toBe(true);
  });

  it('clears the mark on the way back, so a second death is judged afresh', () => {
    const state = died(false);
    const out = unwrap(revivify(state), 'the revival');
    const after = out.events.reduce(applyEvent, state);
    expect('diedOfOldAge' in (after.creatures[ELDER]?.vitals ?? {})).toBe(false);
  });
});

describe('what a definition may say about old age', () => {
  const codes = (effect: unknown): readonly string[] =>
    checkSpellDefinitionValue({
      id: 'homebrew-quickening',
      name: 'Homebrew Quickening',
      level: 3,
      school: 'necromancy',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'touch' },
      targets: { count: 1 },
      effects: [effect],
    }).map((one) => one.code);

  it('accepts the refusal written as true', () => {
    expect(codes({ kind: 'revive', within: 60, hitPoints: 1, notOfOldAge: true })).toEqual([]);
  });

  it('refuses it written as anything else', () => {
    expect(codes({ kind: 'revive', within: 60, hitPoints: 1, notOfOldAge: false })).toContain('bad_old_age_clause');
  });
});
