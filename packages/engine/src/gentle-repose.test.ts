import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { advanceTime, resolveSpell } from './commands.js';

/**
 * A window another casting widens.
 *
 * > SRD Gentle Repose: "The spell also effectively extends the time limit on
 * > raising the target from the dead, since **days spent under the influence of
 * > this spell don't count against the time limit** of spells such as _Raise
 * > Dead_."
 *
 * `revive.within` is subtraction over `Vitals.diedAt` and `state.elapsed`, and
 * this is the one sentence in the book that changes that arithmetic from
 * outside: a second casting, running on the same body, that takes its own span
 * back out of the total. So the corpse under Gentle Repose is still "within the
 * last minute" a day later if it died a minute before the repose began.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const FALLEN = id('fallen');
const HALE = id('hale');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
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
  added(FALLEN),
  added(HALE),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      prepared: ['revivify', 'gentle-repose'],
    }),
  },
  ...[2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 3,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the chapel', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the chapel' }, feet: 0 } },
  { type: 'creature-placed', id: FALLEN, placement: { from: { creature: CLERIC }, feet: 5 } },
  { type: 'creature-placed', id: HALE, placement: { from: { creature: CLERIC }, feet: 5 } },
  { type: 'sight-declared', from: CLERIC, to: FALLEN, seen: true },
  { type: 'sight-declared', from: CLERIC, to: HALE, seen: true },
  { type: 'creature-died', id: FALLEN, cause: 'an ogre’s club' },
];

const supply = (seed = 'repose') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const cast = (state: GameState, spellId: string, at: CharacterId, slotLevel: number) =>
  resolveSpell(state, CLERIC, { spellId, targets: [at], slotLevel }, supply(spellId));

/** Waits `seconds`, applying the events the clock writes. */
const wait = (state: GameState, seconds: number): GameState =>
  unwrap(advanceTime(state, seconds, 'the vigil'), 'the vigil').reduce(applyEvent, state);

/**
 * Ten seconds after the death, the repose is laid — or is not — and eighty
 * seconds more go by. Ninety seconds since the death either way, which is
 * thirty more than Revivify reaches.
 */
const vigil = (withRepose: boolean): GameState => {
  const opened = wait(fold('seed', SETUP), 10);
  const reposed = withRepose
    ? unwrap(cast(opened, 'gentle-repose', FALLEN, 2), 'the repose')
        .events.reduce(applyEvent, opened)
    : opened;
  return wait(reposed, 80);
};

describe('Gentle Repose widens the window Revivify reaches through', () => {
  it('raises a corpse ninety seconds dead that has lain eighty of them under the repose', () => {
    const before = vigil(true);
    expect(before.elapsed).toBe(90);
    const out = unwrap(cast(before, 'revivify', FALLEN, 3), 'the revival');
    const after = out.events.reduce(applyEvent, before);
    expect(after.creatures[FALLEN]?.vitals.dead).toBe(false);
    expect(after.creatures[FALLEN]?.vitals.hp).toBe(1);
  });

  it('refuses the same corpse where no repose was laid', () => {
    const out = cast(vigil(false), 'revivify', FALLEN, 3);
    expect(isErr(out) && out.code).toBe('died_too_long_ago');
  });

  /**
   * And the sentence really is about the span the repose has run, not about
   * the repose existing: a body that lay dead for its whole minute before
   * anybody said the words is still past saving.
   */
  it('takes back only the span the casting has actually run', () => {
    const late = wait(fold('seed', SETUP), 70);
    const reposed = unwrap(cast(late, 'gentle-repose', FALLEN, 2), 'the late repose')
      .events.reduce(applyEvent, late);
    const out = cast(wait(reposed, 600), 'revivify', FALLEN, 3);
    expect(isErr(out) && out.code).toBe('died_too_long_ago');
  });

  it('refuses a repose laid on somebody who is alive', () => {
    const out = cast(fold('seed', SETUP), 'gentle-repose', HALE, 2);
    expect(isErr(out) && out.code).toBe('target_not_dead');
  });

  it('is on the corpse, so a Dispel Magic aimed there finds it', () => {
    const before = wait(fold('seed', SETUP), 10);
    const out = unwrap(cast(before, 'gentle-repose', FALLEN, 2), 'the repose');
    const after = out.events.reduce(applyEvent, before);
    const record = after.ongoing[out.castingId!];
    expect(record?.aimed).toEqual([FALLEN]);
    expect(record?.preserving).toBe(10);
  });
});

describe('what a definition may say about preserving a body', () => {
  const definition = (over: Record<string, unknown>): unknown => ({
    id: 'homebrew-vigil',
    name: 'Homebrew Vigil',
    level: 2,
    school: 'necromancy',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'touch' },
    targets: { count: 1, mustBeDead: true },
    effects: [{ kind: 'preserves' }],
    durationSeconds: 864_000,
    ...over,
  });

  const codes = (over: Record<string, unknown>): readonly string[] =>
    checkSpellDefinitionValue(definition(over)).map((one) => one.code);

  it('accepts a preserving spell that leaves a casting running', () => {
    expect(codes({})).toEqual([]);
  });

  it('refuses one whose casting leaves nothing running', () => {
    expect(codes({ durationSeconds: undefined })).toContain('preserves_without_a_casting');
  });
});
