import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { eligibleTargets, resolveSpell } from './commands.js';

/**
 * SRD Spare the Dying, whole:
 *
 * > _Necromancy Cantrip (Cleric, Druid)._ **Range:** 15 feet.
 * > "Choose a creature within range that has 0 Hit Points and isn't dead. The
 * > creature becomes Stable."
 * > _Cantrip Upgrade._ "The range doubles when you reach levels 5 (30 feet),
 * > 11 (60 feet), and 17 (120 feet)."
 *
 * Three sentences and three mechanisms: the `stabilise` effect, which writes
 * the event a DM's `stabiliseCreature` already declares; the target rule that
 * selects by a fact about vitals rather than by a creature type; and the one
 * range in the book that grows with the caster rather than with the slot.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const DYING = id('dying');
const HALE = id('hale');
const FALLEN = id('fallen');

const sheet = (level: number): CharacterSheet => ({
  level,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId, level = 1): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(level),
  maxHp: 20,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/** The cleric, three neighbours, and a scene the twenty feet can be measured in. */
const table = (casterLevel: number, feet: number): readonly GameEvent[] => [
  added(CLERIC, casterLevel),
  added(DYING),
  added(HALE),
  added(FALLEN),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      cantrips: ['spare-the-dying'],
    }),
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the field', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the field' }, feet: 0 } },
  { type: 'creature-placed', id: DYING, placement: { from: { creature: CLERIC }, feet, bearing: 0 } },
  { type: 'creature-placed', id: HALE, placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 } },
  {
    type: 'creature-placed',
    id: FALLEN,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 180 },
  },
  { type: 'sight-declared', from: CLERIC, to: DYING, seen: true },
  { type: 'sight-declared', from: CLERIC, to: HALE, seen: true },
  { type: 'sight-declared', from: CLERIC, to: FALLEN, seen: true },
  // One at 0 Hit Points and still making death saves, one hale, one a corpse.
  { type: 'hit-points-dropped-to-zero', id: DYING, source: 'an ogre’s club' },
  { type: 'creature-died', id: FALLEN, cause: 'the same club' },
];

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('spare') as Rng,
  content: SRD_CONTENT,
});

const cast = (state: GameState, at: CharacterId) =>
  resolveSpell(state, CLERIC, { spellId: 'spare-the-dying', targets: [at] }, supply());

describe('Spare the Dying', () => {
  it('stabilises a creature at 0 Hit Points', () => {
    const before = fold('seed', table(1, 5));
    expect(before.creatures[DYING]?.vitals.stable).toBe(false);
    const out = unwrap(cast(before, DYING), 'the stabilising');
    expect(out.events.some((e) => e.type === 'stabilised')).toBe(true);
    const after = out.events.reduce(applyEvent, before);
    expect(after.creatures[DYING]?.vitals.stable).toBe(true);
    expect(out.outcomes).toContainEqual({ target: DYING, affected: true });
  });

  it('refuses a creature that still has Hit Points', () => {
    const out = cast(fold('seed', table(1, 5)), HALE);
    expect(isErr(out) && out.code).toBe('target_not_dying');
  });

  it('refuses a creature that is already dead', () => {
    const out = cast(fold('seed', table(1, 5)), FALLEN);
    expect(isErr(out) && out.code).toBe('target_not_dying');
  });

  it('leaves the dying off no shortlist and the hale and the dead off it', () => {
    const shortlist = eligibleTargets(
      fold('seed', table(1, 5)),
      SRD_CONTENT,
      CLERIC,
      'spare-the-dying',
      0,
    );
    expect(shortlist.eligible).toEqual([DYING]);
    expect(shortlist.excluded.map((one) => one.target)).toContain(HALE);
    expect(shortlist.excluded.map((one) => one.target)).toContain(FALLEN);
  });
});

describe('the range that doubles with the caster', () => {
  it('reaches thirty feet for a level 5 cleric', () => {
    const before = fold('seed', table(5, 30));
    const out = unwrap(cast(before, DYING), 'the stabilising at thirty feet');
    expect(out.events.some((e) => e.type === 'stabilised')).toBe(true);
  });

  it('refuses thirty feet for a level 4 cleric, whose range is the printed fifteen', () => {
    const out = cast(fold('seed', table(4, 30)), DYING);
    expect(isErr(out) && out.code).toBe('out_of_range');
  });

  it('reaches fifteen feet for a level 4 cleric', () => {
    const before = fold('seed', table(4, 15));
    const out = unwrap(cast(before, DYING), 'the stabilising at fifteen feet');
    expect(out.events.some((e) => e.type === 'stabilised')).toBe(true);
  });

  it('bounds the shortlist by the band the caster has reached', () => {
    const shortlist = (level: number) =>
      eligibleTargets(fold('seed', table(level, 30)), SRD_CONTENT, CLERIC, 'spare-the-dying', 0);
    expect(shortlist(5).eligible).toEqual([DYING]);
    expect(shortlist(4).eligible).toEqual([]);
  });
});

describe('what a definition may say about stabilising and about a growing range', () => {
  const definition = (over: Record<string, unknown>): unknown => ({
    id: 'homebrew-mercy',
    name: 'Homebrew Mercy',
    level: 0,
    school: 'necromancy',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 15 },
    targets: { count: 1, mustBeDying: true },
    effects: [{ kind: 'stabilise' }],
    ...over,
  });

  const codes = (over: Record<string, unknown>): readonly string[] =>
    checkSpellDefinitionValue(definition(over)).map((one) => one.code);

  it('accepts a stabilising cantrip with a range that grows', () => {
    expect(codes({ rangeAtLevel: { 5: 30, 11: 60, 17: 120 } })).toEqual([]);
  });

  it('refuses a band at a level that is not a character level', () => {
    expect(codes({ rangeAtLevel: { 0: 30 } })).toContain('bad_caster_level');
  });

  it('refuses a band whose reach is not a distance', () => {
    expect(codes({ rangeAtLevel: { 5: 0 } })).toContain('bad_range');
  });

  it('refuses a growing range on a levelled spell', () => {
    expect(codes({ level: 2, rangeAtLevel: { 5: 30 } })).toContain('cantrip_scaling_on_spell');
  });

  it('refuses a growing range on a spell whose Range is not a distance', () => {
    expect(codes({ range: { kind: 'touch' }, rangeAtLevel: { 5: 30 } })).toContain(
      'range_without_a_distance',
    );
  });
});
