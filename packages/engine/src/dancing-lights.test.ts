import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { lightAt, type Point } from './positioning.js';
import { activateSpell, resolveSpell } from './commands.js';

/**
 * SRD Dancing Lights: "You create **up to four torch-size lights within
 * range** … Whichever form you choose, **each light** sheds Dim Light in a
 * 10-foot radius." / "As a Bonus Action, you can move the lights up to 60
 * feet to a space within range. **A light must be within 20 feet of another
 * light created by this spell, and a light vanishes if it exceeds the spell's
 * range.**" (E-L2)
 *
 * Several templates in one casting: each light is its own Sphere of Dim Light
 * at a point the caster names — the first by `at`, the others by `alsoAt` —
 * held to the Range, and to the twenty feet that tie each light to another.
 * The Bonus Action moves them (`to` for the first, `alsoTo` for the others),
 * sixty feet each, under the same two rules; and a light that ends up beyond
 * the Range of its caster — the caster walked away — is gone, and stays gone.
 */

const id = (s: string) => asCharacterId(s);
const BARD = id('bard');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 18 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
});

const at = (x: number, y: number): Point => ({ x, y, z: 0 });

const SETUP: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: BARD,
    name: BARD,
    sheet: sheet(),
    maxHp: 30,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  {
    type: 'spellcasting-declared',
    id: BARD,
    spellcasting: declaredCasting({ ability: 'cha', classId: 'bard', cantrips: ['dancing-lights'], prepared: [] }),
  },
  { type: 'scene-set', extent: { width: 800, depth: 400, height: 40 } },
  { type: 'creature-placed', id: BARD, placement: { from: { point: at(100, 100) }, feet: 0 } },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('motes') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

/** Four lights in a row, fifteen feet apart: east of the bard, and well within the 120 feet. */
const FOUR = [at(150, 100), at(165, 100), at(180, 100), at(195, 100)];

const cast = (log: readonly GameEvent[], points: readonly Point[]) => {
  const state = fold('motes', log);
  return resolveSpell(
    state,
    BARD,
    {
      spellId: 'dancing-lights',
      targets: [],
      at: points[0]!,
      ...(points.length > 1 ? { alsoAt: points.slice(1) } : {}),
    } as never,
    supply(state),
  );
};

const lit = (): { readonly log: GameEvent[]; readonly castingId: string } => {
  const out = unwrap(cast(SETUP, FOUR), 'four lights');
  return { log: [...SETUP, ...out.events], castingId: out.castingId! };
};

const dimAt = (log: readonly GameEvent[], where: Point): boolean =>
  lightAt(fold('motes', log), where).level === 'dim';

describe('SRD Dancing Lights: up to four lights within range', () => {
  it('sheds Dim Light in a 10-foot radius around each of four lights', () => {
    const { log } = lit();
    for (const point of FOUR) expect(dimAt(log, point)).toBe(true);
    // Twenty feet past the last light is outside every one of them.
    expect(dimAt(log, at(220, 100))).toBe(false);
    expect(dimAt(log, at(150, 130))).toBe(false);
  });

  it('casts a single light — "one glowing Medium form" — as it always did', () => {
    const out = unwrap(cast(SETUP, [at(150, 100)]), 'one light');
    expect(dimAt([...SETUP, ...out.events], at(150, 100))).toBe(true);
  });

  it('refuses a fifth light', () => {
    expect(codeOf(cast(SETUP, [...FOUR, at(210, 100)]))).toBe('too_many_copies');
  });

  it('refuses a light beyond the Range', () => {
    expect(codeOf(cast(SETUP, [at(200, 100), at(215, 100), at(230, 100)]))).toBe('out_of_range');
  });

  it('refuses a light more than 20 feet from every other light', () => {
    expect(codeOf(cast(SETUP, [at(150, 100), at(165, 100), at(200, 100)]))).toBe('copies_apart');
  });

  it('refuses a second light on a spell that makes only one', () => {
    const state = fold('motes', [
      ...SETUP,
      {
        type: 'spellcasting-declared',
        id: BARD,
        spellcasting: declaredCasting({ ability: 'cha', classId: 'bard', cantrips: ['dancing-lights', 'fire-bolt'], prepared: [] }),
      },
    ]);
    // Fire Bolt is no casting with copies; the field is the caller's mistake.
    const refused = resolveSpell(
      state,
      BARD,
      { spellId: 'fire-bolt', targets: [], alsoAt: [at(150, 100)] } as never,
      supply(state),
    );
    expect(codeOf(refused)).toBe('no_copies');
  });
});

describe('SRD Dancing Lights: "As a Bonus Action, you can move the lights up to 60 feet"', () => {
  const move = (log: readonly GameEvent[], castingId: string, extra: Record<string, unknown>) => {
    const state = fold('motes', log);
    return activateSpell(state, BARD, { castingId, targets: [], ...extra } as never, supply(state));
  };

  it('moves the first light and another together, and lays their light where they land', () => {
    const { log, castingId } = lit();
    const moved = unwrap(
      move(log, castingId, { to: at(150, 130), alsoTo: [{ light: 2, to: at(165, 130) }] }),
      'two lights move',
    );
    const after = [...log, ...moved.events];
    expect(dimAt(after, at(150, 130))).toBe(true);
    expect(dimAt(after, at(165, 130))).toBe(true);
    // The two that did not move are where they were.
    expect(dimAt(after, at(180, 100))).toBe(true);
    expect(dimAt(after, at(195, 100))).toBe(true);
  });

  it('moves one of the other lights alone', () => {
    const { log, castingId } = lit();
    expect(dimAt(log, at(200, 100))).toBe(true);
    const moved = unwrap(move(log, castingId, { alsoTo: [{ light: 4, to: at(195, 115) }] }), 'one light');
    const after = [...log, ...moved.events];
    expect(dimAt(after, at(195, 115))).toBe(true);
    // Where it was is dark again, and light 1 has not moved.
    expect(dimAt(after, at(200, 100))).toBe(false);
    expect(dimAt(after, at(150, 100))).toBe(true);
  });

  it('refuses a move of more than 60 feet', () => {
    const { log, castingId } = lit();
    expect(codeOf(move(log, castingId, { alsoTo: [{ light: 4, to: at(195, 165) }] }))).toBe(
      'too_far',
    );
  });

  it('refuses a move that leaves a light more than 20 feet from every other', () => {
    const { log, castingId } = lit();
    expect(codeOf(move(log, castingId, { alsoTo: [{ light: 4, to: at(195, 140) }] }))).toBe(
      'copies_apart',
    );
  });

  it('refuses a light the spell never made', () => {
    const { log, castingId } = lit();
    expect(codeOf(move(log, castingId, { alsoTo: [{ light: 5, to: at(195, 110) }] }))).toBe(
      'no_such_copy',
    );
  });
});

describe('SRD Dancing Lights: "a light vanishes if it exceeds the spell\'s range"', () => {
  it('puts out the lights the caster walks more than 120 feet from, and they stay out', () => {
    const { log } = lit();
    // Seventy feet west: the first light is 120 feet off and stays; the second
    // is 135 feet off and goes, and so do the two beyond it.
    const walked: GameEvent[] = [
      ...log,
      { type: 'creature-moved', id: BARD, placement: { from: { point: at(30, 100) }, feet: 0 } },
    ];
    expect(dimAt(walked, at(150, 100))).toBe(true);
    expect(dimAt(walked, at(165, 100))).toBe(false);
    expect(dimAt(walked, at(195, 100))).toBe(false);

    const back: GameEvent[] = [
      ...walked,
      { type: 'creature-moved', id: BARD, placement: { from: { point: at(100, 100) }, feet: 0 } },
    ];
    expect(dimAt(back, at(165, 100))).toBe(false);
  });

  it('will not move a light that has vanished', () => {
    const { log, castingId } = lit();
    const walked: GameEvent[] = [
      ...log,
      { type: 'creature-moved', id: BARD, placement: { from: { point: at(30, 100) }, feet: 0 } },
    ];
    const state = fold('motes', walked);
    const refused = activateSpell(
      state,
      BARD,
      { castingId, targets: [], alsoTo: [{ light: 3, to: at(140, 110) }] } as never,
      supply(state),
    );
    expect(codeOf(refused)).toBe('copy_vanished');
  });
});
