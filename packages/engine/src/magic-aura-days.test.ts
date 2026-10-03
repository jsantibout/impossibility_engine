import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { advanceTime, resolveSpell } from './commands.js';
import { typeMagicSees } from './creature-type.js';

/**
 * SRD Arcanist's Magic Aura, cast every day.
 *
 * > "The effect lasts for the duration. If you cast the spell on the same
 * > target every day for 30 days, the illusion lasts until dispelled."
 *
 * **A duration earlier castings lengthen.** Each casting pins the moment its
 * unbroken run of daily castings began (`OngoingSpell.dailySince`): a casting
 * made by the same caster on the same target while that caster's previous one
 * still runs carries the run on, and any other starts one. The Mask lasts a
 * day, so "every day" is never letting it lapse — and the engine has a clock
 * and no calendar, so a day is each twenty-four hours from the run's start: a
 * casting made on the run's thirtieth day lasts until dispelled. Two castings
 * on one day are one day.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const RIVAL = id('rival');
const GOBLIN = id('goblin');

const DAY = 86_400;

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId, creatureType: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 30,
  diesAtZero: false,
  creatureType,
});

const caster = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['arcanists-magic-aura'] }),
  },
  {
    type: 'resource-pool-declared',
    id: who,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 60, recovers: 'long-rest' },
  },
];

const SETUP: readonly GameEvent[] = [
  added(WIZARD, 'Humanoid'),
  added(RIVAL, 'Humanoid'),
  added(GOBLIN, 'Fey'),
  ...caster(WIZARD),
  ...caster(RIVAL),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the study', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the study' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 5 } },
  { type: 'creature-placed', id: RIVAL, placement: { from: { creature: GOBLIN }, feet: 5 } },
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
  { type: 'sight-declared', from: RIVAL, to: GOBLIN, seen: true },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** One casting of the Mask, by whoever, on the goblin. */
const mask = (state: GameState, by: CharacterId = WIZARD): { state: GameState; castingId: string } => {
  const out = unwrap(
    resolveSpell(
      state,
      by,
      { spellId: 'arcanists-magic-aura', targets: [GOBLIN], slotLevel: 2, willing: [GOBLIN], choice: 'Humanoid' },
      supply('mask'),
    ),
    'the mask',
  );
  return { state: out.events.reduce(applyEvent, state), castingId: out.castingId! };
};

const wait = (state: GameState, seconds: number): GameState =>
  unwrap(advanceTime(state, seconds, 'a day goes by'), 'wait').reduce(applyEvent, state);

const castingTimer = (state: GameState, castingId: string) =>
  Object.values(state.timers).find((one) => one.target.kind === 'casting' && one.target.castingId === castingId);

/** The Mask cast once and then again `times` more, each `gap` seconds after the last. */
const daily = (times: number, gap = DAY - 1) => {
  let { state, castingId } = mask(fold('seed', SETUP));
  for (let i = 0; i < times; i += 1) {
    state = wait(state, gap);
    ({ state, castingId } = mask(state));
  }
  return { state, castingId };
};

describe('SRD Arcanist’s Magic Aura cast every day', () => {
  it('starts a run with the first casting', () => {
    const { state, castingId } = daily(0);
    expect(state.ongoing[castingId]?.dailySince).toBe(0);
    expect(castingTimer(state, castingId)?.deadline).toEqual({ kind: 'elapsed', at: DAY });
  });

  it('carries the run on with a casting made while the last still runs', () => {
    const { state, castingId } = daily(1);
    expect(state.ongoing[castingId]?.dailySince).toBe(0);
  });

  it('starts it again once the last has lapsed', () => {
    let { state } = mask(fold('seed', SETUP));
    state = wait(state, DAY);
    const again = mask(state);
    expect(again.state.ongoing[again.castingId]?.dailySince).toBe(DAY);
  });

  it('is not carried on by somebody else’s casting', () => {
    let { state } = mask(fold('seed', SETUP));
    state = wait(state, 3600);
    const theirs = mask(state, RIVAL);
    expect(theirs.state.ongoing[theirs.castingId]?.dailySince).toBe(3600);
  });

  it('still lasts a day on the twenty-ninth day of the run', () => {
    // Thirty castings a second short of a day apart: the last is on day 29
    // and 23:59:31 — the run's twenty-ninth day, not its thirtieth.
    const { state, castingId } = daily(29);
    expect(castingTimer(state, castingId)?.deadline.kind).toBe('elapsed');
  });

  it('lasts until dispelled when cast on the run’s thirtieth day', () => {
    const { state, castingId } = daily(30);
    expect(state.ongoing[castingId]).toBeDefined();
    expect(castingTimer(state, castingId)).toBeUndefined();
    // And the Mask it lays is still there a year on.
    const later = wait(state, 365 * DAY);
    expect(later.ongoing[castingId]).toBeDefined();
    expect(typeMagicSees(later.creatures[GOBLIN]!)).toBe('Humanoid');
  });

  it('counts days, not castings: two a day for fifteen days is fifteen days', () => {
    const { state, castingId } = daily(29, DAY / 2);
    expect(castingTimer(state, castingId)?.deadline.kind).toBe('elapsed');
  });
});

describe('what a definition may say', () => {
  const codes = (days: unknown): readonly string[] =>
    checkSpellDefinitionValue({ ...SRD_CONTENT.spell('arcanists-magic-aura')!, untilDispelledAfterDays: days }).map(
      (one) => one.code,
    );

  it('accepts a whole number of days', () => {
    expect(codes(30)).toEqual([]);
  });

  it('refuses a run of less than two days, which no casting lengthens', () => {
    expect(codes(1)).toContain('bad_daily_run');
    expect(codes(2.5)).toContain('bad_daily_run');
  });
});
