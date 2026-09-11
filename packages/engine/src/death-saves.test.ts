import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { ZERO_HIT_POINTS, resolveTurn } from './commands.js';

/**
 * The death saving throw a turn owes.
 *
 * SRD: "Whenever you start your turn with 0 Hit Points, you must make a Death
 * Saving Throw." **Whenever** — nobody decides it, which by this engine's own
 * rule makes it derived rather than commanded, and puts it exactly where the
 * turn-boundary repeat saves already live.
 *
 * Every piece of it existed and none of it ran: `rollDeathSave` and
 * `resolveDeathSave` are correct and tested, `death-save-recorded` is in the
 * log union and the reducer applies it — and no command ever emitted one. A
 * character at 0 hit points could be left there for the rest of the fight and
 * never roll. That is the third instance this pass of a correct pure function
 * nothing called.
 *
 * The rules it has to get right, none of which are the ordinary save rules:
 *
 * - it is tied to no ability score, so the die stands alone
 * - a natural 1 costs two failures, a natural 20 restores 1 hit point
 * - three successes Stabilise; three failures kill
 * - a Stable creature does not roll at all, though it is still at 0
 */

const id = (s: string) => asCharacterId(s);
const KESS = id('kess');
const OGRE = id('ogre');

const sheet = (): CharacterSheet => ({
  level: 3,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const added = (who: CharacterId, diesAtZero: boolean): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 20,
  diesAtZero,
  creatureType: 'Humanoid',
});

/** Kess down at 0 hit points, the ogre next in the order. */
const DOWN: readonly GameEvent[] = [
  added(KESS, false),
  added(OGRE, true),
  {
    type: 'combat-started',
    combatants: [
      { id: OGRE, initiative: 20, speed: 30 },
      { id: KESS, initiative: 10, speed: 30 },
    ],
  },
  { type: 'damage-taken', id: KESS, amount: 20, source: 'the ogre' },
  { type: 'condition-applied', id: KESS, condition: 'unconscious', source: ZERO_HIT_POINTS },
];

/** A generator that rolls exactly what it is told to. */
const scripted = (values: readonly number[]): Rng => {
  let i = 0;
  return {
    int: () => values[i++ % values.length]!,
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const supply = (rolls: readonly number[]) => ({
  issuer: createRollIssuer('r'),
  rng: scripted(rolls),
});

/** Advance to Kess's turn, which is the moment the save is owed. */
const toKess = (log: readonly GameEvent[], rolls: readonly number[]) => {
  const out = unwrap(resolveTurn(fold('seed', log), supply(rolls)), 'turn');
  return { ...out, log: [...log, ...out.events] };
};

const kessOf = (state: GameState) => state.creatures.kess!;

describe('a turn beginning at 0 hit points owes a death saving throw', () => {
  it('rolls one without anybody asking', () => {
    const out = toKess(DOWN, [12]);
    expect(out.events.some((e) => e.type === 'death-save-recorded')).toBe(true);
  });

  /** SRD: "If the roll is 10 or higher, you succeed." */
  it('records a success on a 10', () => {
    const after = fold('seed', toKess(DOWN, [10]).log);
    expect(kessOf(after).vitals.deathSaveSuccesses).toBe(1);
    expect(kessOf(after).vitals.deathSaveFailures).toBe(0);
  });

  it('records a failure on a 9', () => {
    const after = fold('seed', toKess(DOWN, [9]).log);
    expect(kessOf(after).vitals.deathSaveFailures).toBe(1);
  });

  /** SRD: "When you roll a 1 ... you suffer two failures." */
  it('costs two failures on a natural 1', () => {
    const after = fold('seed', toKess(DOWN, [1]).log);
    expect(kessOf(after).vitals.deathSaveFailures).toBe(2);
  });

  /** SRD: "If you roll a 20 ... you regain 1 Hit Point." */
  it('brings the creature back on a natural 20', () => {
    const after = fold('seed', toKess(DOWN, [20]).log);
    expect(kessOf(after).vitals.hp).toBe(1);
    expect(kessOf(after).conditions.conditions).not.toContain('unconscious');
  });

  /** SRD: "On your third failure, you die." */
  it('kills on the third failure', () => {
    let log = DOWN;
    for (let n = 0; n < 3; n += 1) {
      // Two turns each round: the ogre's, then Kess's.
      log = toKess(log, [5]).log;
      log = toKess(log, [5]).log;
    }
    expect(kessOf(fold('seed', log)).vitals.dead).toBe(true);
  });

  /** SRD: "On your third success, you become Stable." */
  it('stabilises on the third success, and then stops rolling', () => {
    let log = DOWN;
    for (let n = 0; n < 3; n += 1) {
      log = toKess(log, [15]).log;
      log = toKess(log, [15]).log;
    }
    const after = fold('seed', log);
    expect(after.creatures.kess!.vitals.stable).toBe(true);

    // A Stable creature is still at 0 and still Unconscious, and rolls nothing.
    const quiet = toKess(log, [1]);
    expect(quiet.events.some((e) => e.type === 'death-save-recorded')).toBe(false);
    expect(fold('seed', quiet.log).creatures.kess!.vitals.dead).toBe(false);
  });

  /** A monster dies at 0 rather than making saves, so there is nothing to roll. */
  it('asks nothing of a creature that died outright', () => {
    const monsterDown: readonly GameEvent[] = [
      added(KESS, false),
      added(OGRE, true),
      {
        type: 'combat-started',
        combatants: [
          { id: KESS, initiative: 20, speed: 30 },
          { id: OGRE, initiative: 10, speed: 30 },
        ],
      },
      { type: 'damage-taken', id: OGRE, amount: 20, source: 'kess' },
    ];
    const out = toKess(monsterDown, [1]);
    expect(out.events.some((e) => e.type === 'death-save-recorded')).toBe(false);
  });

  /** And nothing of a creature that is simply upright. */
  it('asks nothing of a creature with hit points', () => {
    const upright: readonly GameEvent[] = DOWN.filter((e) => e.type !== 'damage-taken');
    const out = toKess(upright, [1]);
    expect(out.events.some((e) => e.type === 'death-save-recorded')).toBe(false);
  });
});

describe('the roll is recorded and replays', () => {
  it('writes the roll into the log so it can be read back', () => {
    const out = toKess(DOWN, [17]);
    const recorded = out.events.find((e) => e.type === 'death-save-recorded');
    expect(recorded).toMatchObject({ id: KESS, natural: 17 });
  });

  it('advances the generator exactly once', () => {
    const out = toKess(DOWN, [12]);
    const issued = out.events.filter((e) => e.type === 'rolls-issued');
    expect(issued.length).toBeGreaterThan(0);
  });

  it('replays prefix by prefix', () => {
    const { log } = toKess(DOWN, [12]);
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  /**
   * Without a generator the turn cannot roll, and a save that is owed and
   * unrolled is the leak this engine has torn out once already — so the turn
   * refuses rather than advancing past it.
   */
  it('refuses to advance into the turn with no way to roll', () => {
    const out = resolveTurn(fold('seed', DOWN));
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('death_save_owed');
  });
});
