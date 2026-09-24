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
import { resolveSpell } from './commands.js';

/**
 * A duration the slot changes.
 *
 * > SRD Major Image, _Using a Higher-Level Spell Slot._: "The spell lasts
 * > until dispelled, without requiring Concentration, if cast with a level 4+
 * > spell slot."
 *
 * Two halves of one sentence and two fields, because the SRD moves them
 * independently: `concentrationEndsAtSlot` was built for SRD Bestow Curse's
 * level 5, and this is the other half — a slot that changes what **kind** of
 * ending a casting has, which a table of seconds cannot say.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CASTER = id('bard');

const sheet = (): CharacterSheet => ({
  level: 7,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 18 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
});

const SETUP: readonly GameEvent[] = [
  { type: 'creature-added', id: CASTER, name: CASTER, sheet: sheet(), maxHp: 30, diesAtZero: false },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'cha',
      classId: 'bard',
      prepared: ['major-image'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: CASTER,
    pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: CASTER,
    pool: { key: spellSlotKey(4), label: 'level 4 spell slot', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the hall' }, feet: 0 } },
];

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('major-image') as Rng,
  content: SRD_CONTENT,
});

const castAt = (slotLevel: number): { readonly state: GameState; readonly castingId: string } => {
  const before = fold('seed', SETUP);
  const out = unwrap(
    resolveSpell(before, CASTER, { spellId: 'major-image', targets: [], slotLevel }, supply()),
    `Major Image at level ${slotLevel}`,
  );
  return { state: out.events.reduce(applyEvent, before), castingId: out.castingId! };
};

const castingTimers = (state: GameState): readonly string[] =>
  Object.keys(state.timers).filter((key) => state.timers[key]?.target.kind === 'casting');

describe('Major Image at the slot the book prints', () => {
  it('runs on Concentration with a deadline at level 3', () => {
    const { state, castingId } = castAt(3);
    expect(state.creatures[CASTER]?.concentration?.castingId).toBe(castingId);
    expect(castingTimers(state)).toHaveLength(1);
    expect(state.ongoing[castingId]).toBeDefined();
  });

  it('runs until dispelled and takes no Concentration at level 4', () => {
    const { state, castingId } = castAt(4);
    expect(state.creatures[CASTER]?.concentration ?? null).toBeNull();
    expect(castingTimers(state)).toEqual([]);
    // Still running, and still findable: "until dispelled" is the absence of a
    // deadline rather than the absence of a casting.
    expect(state.ongoing[castingId]).toBeDefined();
  });

  it('says the check it could not offer, because the check rides on a timer', () => {
    const before = fold('seed', SETUP);
    const out = unwrap(
      resolveSpell(before, CASTER, { spellId: 'major-image', targets: [], slotLevel: 4 }, supply()),
      'Major Image at level 4',
    );
    expect(out.unverified.some((line) => line.includes('Intelligence (investigation)'))).toBe(true);

    const printed = unwrap(
      resolveSpell(before, CASTER, { spellId: 'major-image', targets: [], slotLevel: 3 }, supply()),
      'Major Image at level 3',
    );
    expect(printed.unverified.some((line) => line.includes('Intelligence (investigation)'))).toBe(false);
  });
});

describe('what a definition may say about a slot that changes the ending', () => {
  const definition = (over: Record<string, unknown>): unknown => ({
    id: 'homebrew-mirage',
    name: 'Homebrew Mirage',
    level: 3,
    school: 'illusion',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'ranged', feet: 120 },
    targets: { count: 0 },
    effects: [],
    durationSeconds: 600,
    unmodelled: ['what the mirage looks like is the DM’s'],
    ...over,
  });

  const codes = (over: Record<string, unknown>): readonly string[] =>
    checkSpellDefinitionValue(definition(over)).map((one) => one.code);

  it('accepts a band above the spell’s own level', () => {
    expect(codes({ untilDispelledAtSlot: 4, concentrationEndsAtSlot: 4 })).toEqual([]);
  });

  it('refuses a band at or below the spell’s own level', () => {
    expect(codes({ untilDispelledAtSlot: 3 })).toContain('bad_slot_level');
  });

  it('refuses a band that is not one of the nine slot levels', () => {
    expect(codes({ untilDispelledAtSlot: 12 })).toContain('bad_slot_level');
  });

  it('refuses it on a spell that already runs until dispelled', () => {
    expect(
      codes({ untilDispelledAtSlot: 4, untilDispelled: true, durationSeconds: undefined }),
    ).toContain('already_until_dispelled');
  });

  it('refuses it on a spell with no printed duration to replace', () => {
    expect(
      codes({ untilDispelledAtSlot: 4, durationSeconds: undefined, concentration: false }),
    ).toContain('ending_without_duration');
  });
});
