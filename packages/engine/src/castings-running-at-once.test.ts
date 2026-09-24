import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { resolveSpell } from './commands.js';

/**
 * A cap on how many castings of one spell run at once.
 *
 * > SRD Prestidigitation: "If you cast this spell multiple times, you can have
 * > up to **three** of its non-instantaneous effects active at a time."
 *
 * `replacesPriorCasting` is the same sentence with the number one in it — SRD
 * Mage Hand's "The hand vanishes … if you cast this spell again" — applied by
 * ending the prior casting. This is that field with a number, and the
 * application is the same: the oldest running castings end so that the new one
 * is the last that fits.
 *
 * **Ending the oldest is the only reading that lets the fourth be cast at
 * all.** The book says a caster "can have up to three … active", not that a
 * fourth casting is refused; refusing one would be a rule the sentence does
 * not print, and it would make the cantrip unusable rather than capped. So the
 * cap is applied the way the cap of one already is — `spell-ended` with a
 * reason of `recast` — and the fourth Prestidigitation puts out the first.
 *
 * The three wonders that are Instantaneous are not told from the three that
 * are not, because the engine models none of the six: the definition gives
 * every casting the hour the two lasting ones print, so counting castings is
 * counting the non-instantaneous effects under the engine's own reading of the
 * spell. That is written down rather than glossed over.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const MAGE = id('mage');

const sheet: CharacterSheet = {
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
};

const SETUP: readonly GameEvent[] = [
  { type: 'creature-added', id: MAGE, name: 'mage', sheet, maxHp: 30, diesAtZero: false },
  {
    type: 'spellcasting-declared',
    id: MAGE,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: ['prestidigitation'],
    }),
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** Cast it once more, folding what came back, and hand back the new world. */
const castAgain = (state: GameState, n: number): GameState => {
  const out = unwrap(
    resolveSpell(
      state,
      MAGE,
      { spellId: 'prestidigitation', targets: [], commandId: `trick-${n}` },
      supply(`trick-${n}`),
    ),
    `casting ${n}`,
  );
  return out.events.reduce(applyEvent, state);
};

const running = (state: GameState): readonly string[] =>
  Object.values(state.ongoing)
    .filter((record) => record.spellId === 'prestidigitation')
    .map((record) => record.castingId)
    .sort();

describe('what a definition may say about a cap on its own castings', () => {
  const definition = (over: Record<string, unknown>): unknown => ({
    id: 'homebrew-trick',
    name: 'Homebrew Trick',
    level: 0,
    school: 'transmutation',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 10 },
    targets: { count: 0 },
    effects: [],
    durationSeconds: 3600,
    unmodelled: ['the wonders are the DM’s'],
    ...over,
  });

  const codes = (over: Record<string, unknown>): readonly string[] =>
    checkSpellDefinitionValue(definition(over)).map((one) => one.code);

  it('accepts a whole number of castings above one', () => {
    expect(codes({ maxRunning: 3 })).toEqual([]);
  });

  it('refuses a cap of one, which is the field beside it', () => {
    expect(codes({ maxRunning: 1 })).toContain('cap_of_one');
  });

  it('refuses a cap that is not a whole number of castings', () => {
    expect(codes({ maxRunning: 2.5 })).toContain('bad_cap');
  });

  it('refuses a cap on a casting that never runs', () => {
    expect(codes({ maxRunning: 3, durationSeconds: undefined })).toContain('cap_without_a_casting');
  });

  it('refuses a cap beside the cap of one', () => {
    expect(codes({ maxRunning: 3, replacesPriorCasting: true })).toContain('two_caps');
  });
});

describe('Prestidigitation, three at a time', () => {
  it('lets three castings run beside each other', () => {
    let state = fold('seed', SETUP);
    for (const n of [1, 2, 3]) state = castAgain(state, n);
    expect(running(state)).toHaveLength(3);
  });

  it('ends the oldest when a fourth is cast', () => {
    let state = fold('seed', SETUP);
    for (const n of [1, 2, 3]) state = castAgain(state, n);
    const first = running(state)[0]!;
    state = castAgain(state, 4);
    const after = running(state);
    expect(after).toHaveLength(3);
    expect(after).not.toContain(first);
  });

  it('leaves another caster’s castings alone', () => {
    const OTHER = id('other');
    let state = fold('seed', [
      ...SETUP,
      { type: 'creature-added', id: OTHER, name: 'other', sheet, maxHp: 30, diesAtZero: false },
      {
        type: 'spellcasting-declared',
        id: OTHER,
        spellcasting: declaredCasting({
          ability: 'int',
          classId: 'wizard',
          cantrips: ['prestidigitation'],
        }),
      },
    ]);
    const theirs = unwrap(
      resolveSpell(
        state,
        OTHER,
        { spellId: 'prestidigitation', targets: [], commandId: 'theirs' },
        supply('theirs'),
      ),
      'the other caster',
    );
    state = theirs.events.reduce(applyEvent, state);
    for (const n of [1, 2, 3, 4]) state = castAgain(state, n);
    expect(running(state)).toHaveLength(4);
  });
});
