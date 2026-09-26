import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  contextRequestsOf,
  expect as unwrap,
  isErr,
  isNeedsContext,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { positionOf } from './positioning.js';
import { elsewhereOf } from './elsewhere.js';
import {
  endOngoingSpell,
  resolveAttack,
  resolveSpell,
  resolveTurn,
  returnFromElsewhere,
} from './commands.js';

/**
 * SRD Blink:
 *
 * > "Roll 1d6 at the end of each of your turns. On a roll of 4–6, you vanish
 * > from your current plane of existence and appear in the Ethereal Plane …
 * > At the start of your next turn and when the spell ends if you are on the
 * > Ethereal Plane, you return to an unoccupied space of your choice that you
 * > can see within 10 feet of the space you vanished from. If no unoccupied
 * > space is available within that range, you appear in the nearest unoccupied
 * > space."
 *
 * The die is thrown by the boundary and recorded like every other; the
 * vanishing is `creature-sent-elsewhere` with the return rule pinned; the
 * return at the start of the next turn asks for the space unless exactly one
 * qualifies.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');
const HOBGOBLIN = id('hobgoblin');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 16, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

const DOOR = { x: 100, y: 100, z: 0 };

const FIELD: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(GOBLIN, 'foes'),
  added(HOBGOBLIN, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['blink'] }),
  },
  {
    type: 'spellcasting-declared',
    id: HOBGOBLIN,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['fireball'] }),
  },
  ...slots(WIZARD),
  ...slots(HOBGOBLIN),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: DOOR },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  {
    type: 'creature-placed',
    id: HOBGOBLIN,
    placement: { from: { creature: WIZARD }, feet: 40, bearing: 0 },
  },
  ...[GOBLIN, HOBGOBLIN].flatMap((who): readonly GameEvent[] => [
    { type: 'sight-declared', from: WIZARD, to: who, seen: true },
    { type: 'sight-declared', from: who, to: WIZARD, seen: true },
  ]),
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      { id: HOBGOBLIN, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (state: GameState, seed: string) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

/** The wizard casts Blink and ends the turn; whether they vanished is the die's. */
const blinked = (seed: string) => {
  const log: GameEvent[] = [...FIELD];
  const cast = unwrap(
    resolveSpell(fold(seed, log), WIZARD, { spellId: 'blink', targets: [WIZARD], slotLevel: 3 }, supply(fold(seed, log), seed)),
    'the casting',
  );
  log.push(...cast.events);
  const ended = unwrap(resolveTurn(fold(seed, log), supply(fold(seed, log), seed)), 'the turn ends');
  log.push(...ended.events);
  return { log, castingId: cast.castingId!, state: fold(seed, log), seed };
};

/** The first seed on which the d6 lands on the vanishing half, and the first on which it does not. */
const SEEDS = 'abcdefghijklmnopqrstuvwxyz'.split('').map((letter) => `blink-${letter}`);
const vanishing = SEEDS.find((seed) => elsewhereOf(blinked(seed).state, WIZARD) !== null)!;
const staying = SEEDS.find((seed) => elsewhereOf(blinked(seed).state, WIZARD) === null)!;

describe('Blink at the end of the caster’s turn', () => {
  it('throws the book’s d6 and records it', () => {
    const { log } = blinked(staying);
    const rolls = log.filter(
      (event) => event.type === 'roll-recorded' && /Blink/.test(event.label),
    );
    expect(rolls).toHaveLength(1);
    expect(rolls[0]!.type === 'roll-recorded' && rolls[0]!.natural).toBeGreaterThanOrEqual(1);
    expect(rolls[0]!.type === 'roll-recorded' && rolls[0]!.natural).toBeLessThanOrEqual(6);
  });

  it('both halves of the die are reachable', () => {
    expect(vanishing).toBeDefined();
    expect(staying).toBeDefined();
  });

  it('on 4–6 the caster is in the Ethereal Plane, with the space they left recorded', () => {
    const { state } = blinked(vanishing);
    const record = elsewhereOf(state, WIZARD);
    expect(record?.kind).toBe('ethereal');
    expect(record?.from).toEqual(DOOR);
    expect(record?.returns).toEqual({ within: 10, requiresSight: true, at: 'start-of-turn' });
    expect(positionOf(state.scene!, WIZARD)).toBeNull();
  });

  it('on 1–3 the caster stands where they were', () => {
    const { state } = blinked(staying);
    expect(elsewhereOf(state, WIZARD)).toBeNull();
    expect(positionOf(state.scene!, WIZARD)).toEqual(DOOR);
  });
});

describe('while the caster is away', () => {
  it('a goblin’s attack is refused, and the placement it asks for names the wizard', () => {
    const { state, seed } = blinked(vanishing);
    const swing = resolveAttack(state, GOBLIN, { target: WIZARD, weapon: null }, supply(state, seed));
    expect(swing.ok).toBe(false);
    if (!swing.ok && isNeedsContext(swing)) {
      expect(contextRequestsOf(swing).map((request) => request.subject)).toEqual([WIZARD]);
    }
  });

  it('a Fireball centred on their old space catches nothing of them', () => {
    const { log, seed } = blinked(vanishing);
    const goblinDone = unwrap(resolveTurn(fold(seed, log), supply(fold(seed, log), seed)), 'the goblin’s turn');
    const state = fold(seed, [...log, ...goblinDone.events]);
    const fire = unwrap(
      resolveSpell(
        state,
        HOBGOBLIN,
        { spellId: 'fireball', targets: [], at: DOOR, slotLevel: 3 },
        supply(state, seed),
      ),
      'the fireball',
    );
    expect(fire.outcomes.map((outcome) => outcome.target)).not.toContain(WIZARD);
    expect(fire.outcomes.map((outcome) => outcome.target)).toContain(GOBLIN);
  });
});

describe('the return at the start of the caster’s next turn', () => {
  /**
   * The goblin's turn ends; the boundary that ends the hobgoblin's is the
   * one that begins the wizard's, and that is where the return falls.
   */
  const roundLater = () => {
    const { log, seed, castingId } = blinked(vanishing);
    const done = unwrap(
      resolveTurn(fold(seed, log), supply(fold(seed, log), seed), { commandId: 'the goblin’s turn' }),
      'the goblin’s turn',
    );
    log.push(...done.events);
    return { log, seed, castingId, state: fold(seed, log) };
  };

  it('asks for the space when several qualify', () => {
    const { state, seed } = roundLater();
    const back = resolveTurn(state, supply(state, seed));
    expect(!back.ok && back.code === 'return_space_required').toBe(true);
    if (!back.ok) {
      expect(contextRequestsOf(back)[0]?.subject).toBe(WIZARD);
      expect(contextRequestsOf(back)[0]?.satisfyWith).toContain('returns');
    }
  });

  it('refuses a space 15 feet from the one they vanished from', () => {
    const { state, seed } = roundLater();
    const back = resolveTurn(state, supply(state, seed), {
      returns: [{ who: WIZARD, to: { from: { landmark: 'the door' }, feet: 15, bearing: 180 } }],
    });
    expect(isErr(back) && back.code === 'return_too_far').toBe(true);
  });

  it('refuses an occupied space', () => {
    const { state, seed } = roundLater();
    const back = resolveTurn(state, supply(state, seed), {
      returns: [{ who: WIZARD, to: { from: { creature: GOBLIN }, feet: 0, bearing: 0 } }],
    });
    expect(isErr(back) && back.code === 'occupied').toBe(true);
  });

  it('stands them where they said', () => {
    const { log, state, seed } = roundLater();
    const back = unwrap(
      resolveTurn(state, supply(state, seed), {
        returns: [{ who: WIZARD, to: { from: { landmark: 'the door' }, feet: 10, bearing: 180 } }],
      }),
      'the return',
    );
    const after = fold(seed, [...log, ...back.events]);
    expect(elsewhereOf(after, WIZARD)).toBeNull();
    expect(positionOf(after.scene!, WIZARD)).toEqual({ x: 100, y: 90, z: 0 });
  });

  it('returns the same way when the spell ends while they are away', () => {
    const { log, state, seed, castingId } = blinked(vanishing);
    const ended = unwrap(endOngoingSpell(state, WIZARD, castingId, null), 'the spell ends');
    const stranded = fold(seed, [...log, ...ended]);
    expect(elsewhereOf(stranded, WIZARD)).not.toBeNull();
    const advanced = resolveTurn(stranded, supply(stranded, seed));
    expect(isErr(advanced) && advanced.code === 'elsewhere_stranded').toBe(true);

    const tooFar = returnFromElsewhere(stranded, WIZARD, {
      to: { from: { landmark: 'the door' }, feet: 15, bearing: 180 },
    });
    expect(isErr(tooFar) && tooFar.code === 'return_too_far').toBe(true);

    const back = unwrap(
      returnFromElsewhere(stranded, WIZARD, {
        to: { from: { landmark: 'the door' }, feet: 5, bearing: 180 },
      }),
      'the return',
    );
    const after = fold(seed, [...log, ...ended, ...back.events]);
    expect(positionOf(after.scene!, WIZARD)).toEqual({ x: 100, y: 95, z: 0 });
    expect(resolveTurn(after, supply(after, seed)).ok).toBe(true);
  });
});
