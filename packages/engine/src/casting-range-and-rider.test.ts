import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { checkContent } from './content.js';
import type { FeatureDefinition } from './progression.js';
import type { StandingGrant } from './standing.js';

/**
 * The two `casting-*` members a feature of the **caster** writes about one
 * named spell, held to their own rules on **both** paths that can carry them.
 *
 * SRD Eldritch Spear lengthens one cantrip's range by "30 times your Warlock
 * level" and SRD Repelling Blast hangs a shove on that cantrip's hit. Both are
 * on the item-conferral list beside `casting-damage` and `casting-healing`,
 * for that list's stated reason — the gatherers walk `standingFor`, which a
 * worn item's grants are already part of — so a rod that lengthened its
 * bearer's Eldritch Blast is executed rather than transcribed and ignored.
 *
 * **Which is exactly why the validator has to be on both doors.** The class
 * level is pinned by creation from the *character*; an item belongs to no
 * class and has the holder's own level read for it instead, so an item that
 * wrote a class level would be honoured as a number nobody could have known.
 * `castingHealingProblems` is the shape this follows, and it is validated on
 * both doors for the same reason.
 */

const codesOf = (problems: readonly { readonly code: string }[]): readonly string[] =>
  problems.map((problem) => problem.code);

/** A homebrew class whose one feature carries the grant under test. */
const classWith = (effect: StandingGrant): unknown => ({
  id: 'geomancer',
  name: 'Geomancer',
  primaryAbility: 'int',
  hitDie: 6,
  saveProficiencies: ['int', 'wis'],
  skillChoices: { choose: 2, from: ['arcana', 'nature'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: false, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    proficiencyBonus: 2 + Math.floor(index / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'dagger', quantity: 1 }], goldPieces: 5 }],
  multiclass: {
    weapons: [],
    armorTraining: { light: false, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'geomancer:far-working',
      name: 'Far Working',
      level: 1,
      automation: 'engine',
      note: 'The spell this feature names reaches further, or carries more, than the book prints for it.',
      grants: { kind: 'standing', reach: 'self', effects: [effect] },
    } satisfies FeatureDefinition as unknown,
  ],
});

/** A homebrew item conferring the same grant while it is worn. */
const itemWith = (effect: StandingGrant): unknown => ({
  id: 'rod-of-far-working',
  name: 'Rod of Far Working',
  kind: 'gear',
  priceCopper: 100_000,
  weightLb: 2,
  contents: [],
  grants: [{ kind: 'standing', reach: 'self', effects: [effect], requires: [{ kind: 'while-worn' }] }],
});

const featureCodes = (effect: StandingGrant): readonly string[] =>
  codesOf(checkContent({ classes: [classWith(effect) as never] }));

const itemCodes = (effect: StandingGrant): readonly string[] =>
  codesOf(checkContent({ items: [itemWith(effect) as never] }));

const RANGE = (over: Record<string, unknown> = {}): StandingGrant =>
  ({ kind: 'casting-range', when: { dealsDamage: true }, perClassLevel: 30, ...over }) as StandingGrant;

const RIDER = (rides: unknown): StandingGrant =>
  ({ kind: 'casting-rider', when: { dealsDamage: true }, rides }) as StandingGrant;

describe('a range a feature lengthens', () => {
  it('is accepted when it lengthens by whole feet a level', () => {
    expect(featureCodes(RANGE())).toEqual([]);
    expect(itemCodes(RANGE())).toEqual([]);
  });

  /**
   * A rate of nothing compiles onto the sheet and moves no range, which is the
   * benefit-nothing-reads failure the validator exists for — and it is `fall-
   * damage-reduction`'s own rule on the same arithmetic.
   */
  it('refuses a rate that lengthens nothing, on both doors', () => {
    expect(featureCodes(RANGE({ perClassLevel: 0 }))).toContain('bad_casting_range');
    expect(featureCodes(RANGE({ perClassLevel: 2.5 }))).toContain('bad_casting_range');
    expect(itemCodes(RANGE({ perClassLevel: 0 }))).toContain('bad_casting_range');
  });

  /**
   * The level is the character's. Content that wrote one would be a catalogue
   * stating a number only a sheet can know — and an **item** especially, which
   * belongs to no class at all and has the holder's own level read for it.
   */
  it('refuses a class level written by content, on both doors', () => {
    expect(featureCodes(RANGE({ classLevel: 5 }))).toContain('bad_casting_range');
    expect(itemCodes(RANGE({ classLevel: 5 }))).toContain('bad_casting_range');
  });
});

describe('a rider a feature hangs on a casting it does not make', () => {
  it('is accepted when it fills a slot', () => {
    expect(featureCodes(RIDER({ movement: { feet: 10, kind: 'push' } }))).toEqual([]);
    expect(itemCodes(RIDER({ movement: { feet: 10, kind: 'push' } }))).toEqual([]);
  });

  /**
   * Which slots a rider fills is the rider vocabulary's business and every one
   * of them lands on the outcome this grant reaches. A rider that fills none
   * hangs nothing at all, which is a grant promising a benefit no reader could
   * ever apply.
   */
  it('refuses a rider that fills no slot, on both doors', () => {
    expect(featureCodes(RIDER({}))).toContain('empty_casting_rider');
    expect(itemCodes(RIDER({}))).toContain('empty_casting_rider');
  });
});

/** Neither check is vacuous: the book's own catalogue passes both. */
describe('the catalogue this repository publishes', () => {
  it('writes no grant either rule refuses', () => {
    const codes = codesOf(checkContent(SRD_CONTENT));
    expect(codes).not.toContain('bad_casting_range');
    expect(codes).not.toContain('empty_casting_rider');
  });
});
