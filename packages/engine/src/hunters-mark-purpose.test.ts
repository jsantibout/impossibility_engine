/**
 * SRD Hunter's Mark: "You also have Advantage on any Wisdom (Perception or
 * Survival) check you make **to find it**."
 *
 * **The narrowing is not on the roll.** A `RollModifier` selects a check by
 * ability and by skill, so Wisdom (Perception) and Wisdom (Survival) are each
 * perfectly expressible — two grants, one sentence. What no selector could say
 * is *which* of those checks is the one being made to find the quarry, and that
 * is a fact about the **attempt**: a ranger tracking her mark and a ranger
 * listening at a door roll the same Perception check. Granted unconditionally
 * the mode would have handed her Advantage on every Perception check she rolled
 * for the hour.
 *
 * So the purpose is stated by whoever asks for the check — `TestCommand.purpose`,
 * the shape `senses` and `fought` already have — and the *mark* is the engine's,
 * looked up in `attackRiders` by the same reading `knowledge.ts` takes. A caller
 * states which creature the attempt is about and cannot assert the mark.
 *
 * And the grant hangs on the **caster**: Hunter's Mark is cast at a quarry
 * ninety feet away and the check is the ranger's, which is the asymmetry
 * `attack-rider` beside it already has.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { endConcentration, resolveSpell, resolveTest } from './commands.js';

const id = (s: string) => asCharacterId(s);
const RANGER = id('ranger');
const QUARRY = id('quarry');
const OTHER = id('other');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 12, dex: 16, con: 14, int: 10, wis: 16, cha: 10 },
  skills: { perception: 'proficient', survival: 'proficient', insight: 'proficient' },
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === RANGER ? 'party' : 'foes',
});

const SETUP: readonly GameEvent[] = [
  added(RANGER),
  added(QUARRY),
  added(OTHER),
  {
    type: 'spellcasting-declared',
    id: RANGER,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['hunters-mark'] }),
  },
  {
    type: 'resource-pool-declared',
    id: RANGER,
    pool: { key: spellSlotKey(1), label: 'level 1', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the trail', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: RANGER, placement: { from: { landmark: 'the trail' }, feet: 0 } },
  { type: 'creature-placed', id: QUARRY, placement: { from: { creature: RANGER }, feet: 30, bearing: 0 } },
  { type: 'creature-placed', id: OTHER, placement: { from: { creature: RANGER }, feet: 30, bearing: 180 } },
  { type: 'sight-declared', from: RANGER, to: QUARRY, seen: true },
  { type: 'sight-declared', from: RANGER, to: OTHER, seen: true },
];

const supply = (state: GameState, seed = 'mark') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const mark = (log: readonly GameEvent[], on: CharacterId): readonly GameEvent[] => {
  const state = fold('seed', log);
  return [
    ...log,
    ...unwrap(
      resolveSpell(state, RANGER, { spellId: 'hunters-mark', targets: [on] }, supply(state)),
      'hunters-mark',
    ).events,
  ];
};

/** One check, with whatever purpose the caller states, and the mode it rolled at. */
const check = (
  log: readonly GameEvent[],
  skill: 'perception' | 'survival' | 'insight',
  finding?: CharacterId,
): string => {
  const state = fold('seed', log);
  const out = unwrap(
    resolveTest(
      state,
      RANGER,
      {
        kind: 'ability-check',
        ability: 'wis',
        skill,
        dc: 15,
        commandId: `${skill}:${finding ?? 'nobody'}`,
        ...(finding === undefined ? {} : { purpose: { find: finding } }),
      },
      supply(state, 'check'),
    ),
    `${skill} check`,
  );
  return out.test!.roll.mode;
};

describe('SRD Hunter’s Mark: a check made to find the quarry', () => {
  it('rolls a Perception check to find the quarry at Advantage', () => {
    expect(check(mark(SETUP, QUARRY), 'perception', QUARRY)).toBe('advantage');
  });

  it('rolls a Survival check to find the quarry at Advantage too', () => {
    // "Perception **or** Survival": a selector names one skill and the book
    // names two, so the definition writes two grants of one sentence.
    expect(check(mark(SETUP, QUARRY), 'survival', QUARRY)).toBe('advantage');
  });

  it('leaves an ordinary Perception check alone', () => {
    // The ranger listening at a door: the same skill, the same ability, no
    // purpose stated — and a check nobody said the purpose of is a miss rather
    // than a guess.
    expect(check(mark(SETUP, QUARRY), 'perception', undefined)).toBe('normal');
  });

  it('leaves a check to find somebody else alone', () => {
    expect(check(mark(SETUP, QUARRY), 'perception', OTHER)).toBe('normal');
  });

  it('withholds it from a Wisdom check of a skill the sentence does not name', () => {
    expect(check(mark(SETUP, QUARRY), 'insight', QUARRY)).toBe('normal');
  });

  it('grants nothing to a ranger who has marked nobody', () => {
    expect(check(SETUP, 'perception', QUARRY)).toBe('normal');
  });

  it('lets go of the mode when the Concentration does', () => {
    const marked = mark(SETUP, QUARRY);
    const dropped = [
      ...marked,
      ...unwrap(endConcentration(fold('seed', marked), RANGER, 'let go'), 'end'),
    ];
    expect(check(dropped, 'perception', QUARRY)).toBe('normal');
  });
});
