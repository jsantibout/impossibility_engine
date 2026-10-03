import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { positionOf, type Point } from './positioning.js';
import { declineOpportunity, resolveMove, resolveSpell } from './commands.js';
import { checkSpellDefinitionValue } from './spell-schema.js';

/**
 * SRD Gaseous Form: "**The target can enter and occupy the space of another
 * creature.**" (E-L2)
 *
 * Occupancy is a rule the engine owns outright — "You can't willingly end a
 * move in a space occupied by another creature", and a hostile's space cannot
 * be passed through — and the cloud is the one creature the book lets past
 * both. It rides on the grant that makes the target a cloud: the Fly Speed
 * that is its only method of movement carries `occupiesOthers`, so the move
 * command lets that movement through and into anybody's space, and the
 * creature-moved event says it ended in an occupied space so the fold agrees.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ALLY = id('ally');
const FOE = id('foe');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const at = (x: number, y: number): Point => ({ x, y, z: 0 });

const SETUP: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(ALLY, 'party'),
  added(FOE, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['gaseous-form'] }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: 'spell-slot:3', label: 'level 3', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { point: at(100, 100) }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { point: at(105, 100) }, feet: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { point: at(100, 105) }, feet: 0 } },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('mist') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

/** The wizard turned to mist, on their own touch. */
const clouded = (): GameEvent[] => {
  const state = fold('mist', SETUP);
  const cast = unwrap(
    resolveSpell(
      state,
      WIZARD,
      { spellId: 'gaseous-form', targets: [WIZARD], slotLevel: 3, willing: [WIZARD] },
      supply(state),
    ),
    'gaseous form',
  );
  return [...SETUP, ...cast.events];
};

const move = (log: readonly GameEvent[], who: CharacterId, to: Point, extra: Record<string, unknown> = {}) => {
  const state = fold('mist', log);
  return resolveMove(
    state,
    who,
    // A bearing named, so a taken space is refused rather than swept past.
    { placement: { from: { point: to }, feet: 0, bearing: 0 }, ...extra } as never,
    supply(state),
  );
};

describe('SRD Gaseous Form: the cloud enters and occupies another creature’s space', () => {
  it('refuses an ordinary creature the space somebody is standing in', () => {
    expect(codeOf(move(SETUP, WIZARD, at(105, 100)))).toBe('occupied');
  });

  it('lets the cloud end its move in an ally’s space', () => {
    const log = clouded();
    const moved = unwrap(move(log, WIZARD, at(105, 100), { mode: 'fly' }), 'into the ally');
    const after = fold('mist', [...log, ...moved.events]);

    expect(positionOf(after.scene!, WIZARD)).toEqual(at(105, 100));
    expect(positionOf(after.scene!, ALLY)).toEqual(at(105, 100));
    const step = moved.events.find((event) => event.type === 'creature-moved');
    expect(step?.type === 'creature-moved' && step.intoOccupied).toBe(true);
  });

  it('lets the cloud end its move in a hostile creature’s space', () => {
    const log = clouded();
    const moved = unwrap(move(log, WIZARD, at(100, 105), { mode: 'fly' }), 'into the foe');
    expect(positionOf(fold('mist', [...log, ...moved.events]).scene!, WIZARD)).toEqual(at(100, 105));
  });

  /**
   * "enter … the space of another creature": a hostile's space is no wall to
   * the cloud on the way through either, where an ordinary creature stating the
   * same route is `blocked_by_creature`.
   */
  it('passes through a hostile creature’s space, where an ordinary walker is stopped', () => {
    const route = [at(100, 105), at(100, 110)];
    expect(codeOf(move(SETUP, WIZARD, at(100, 110), { route }))).toBe('blocked_by_creature');

    const log = clouded();
    const moved = move(log, WIZARD, at(100, 110), { mode: 'fly', route });
    expect(moved.ok).toBe(true);
  });

  /**
   * A cloud leaving a hostile's reach is still owed the Opportunity Attack, so
   * the move is held — and when the foe passes, it completes into the ally's
   * space as the cloud's own move would have, saying so for the fold.
   */
  it('completes a held move into an occupied space', () => {
    const near = id('near ally');
    const log = [
      ...clouded(),
      added(near, 'party'),
      { type: 'creature-placed', id: near, placement: { from: { point: at(100, 90) }, feet: 0 } },
      { type: 'sight-declared', from: FOE, to: WIZARD, seen: true },
      {
        type: 'combat-started',
        combatants: [
          { id: WIZARD, initiative: 20, speed: 30 },
          { id: ALLY, initiative: 15, speed: 30 },
          { id: FOE, initiative: 10, speed: 30 },
          { id: near, initiative: 5, speed: 30 },
        ],
      },
    ] as GameEvent[];
    const declared = unwrap(
      move(log, WIZARD, at(100, 90), { mode: 'fly', route: [at(100, 95), at(100, 90)] }),
      'away from the foe',
    );
    const held = [...log, ...declared.events];
    expect(fold('mist', held).pendingMove?.occupiesOthers).toBe(true);

    const state = fold('mist', held);
    const passed = unwrap(declineOpportunity(state, FOE, {}), 'the foe passes');
    const after = fold('mist', [...held, ...passed]);
    expect(positionOf(after.scene!, WIZARD)).toEqual(at(100, 90));
    const arrival = passed.find((event) => event.type === 'creature-moved');
    expect(arrival?.type === 'creature-moved' && arrival.intoOccupied).toBe(true);
  });

  /** A fact about a movement the grant gives, and so beside one or nowhere. */
  it('is refused on a speed grant that gives no movement in a mode', () => {
    const cloud = SRD_CONTENT.spell('gaseous-form')!;
    expect(checkSpellDefinitionValue(cloud)).toEqual([]);
    const loose = {
      ...cloud,
      effects: [{ kind: 'speed', change: 'halve', occupiesOthers: true }],
    };
    expect(checkSpellDefinitionValue(loose).map((problem) => problem.code)).toContain(
      'bad_speed_change',
    );
  });

  it('writes an ordinary step into an empty space as an ordinary step', () => {
    const log = clouded();
    const moved = unwrap(move(log, WIZARD, at(95, 100), { mode: 'fly' }), 'a step west');
    const step = moved.events.find((event) => event.type === 'creature-moved');
    expect(step?.type === 'creature-moved' && step.intoOccupied).toBeUndefined();
  });
});
