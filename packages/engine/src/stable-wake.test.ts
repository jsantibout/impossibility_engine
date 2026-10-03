import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  contextRequestsOf,
  expect as unwrap,
  isErr,
  isNeedsContext,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { beginRest } from './rest.js';
import { timerKey } from './timers.js';
import {
  ZERO_HIT_POINTS,
  advanceTime,
  damageCreature,
  healCreature,
  resolveSpell,
  resolveTurn,
  stabiliseCreature,
} from './commands.js';

/**
 * The Stable creature's wake — E-STABLE.
 *
 * > SRD 5.2.1, Playing the Game, "Stabilizing a Character": "A Stable
 * > creature doesn't make Death Saving Throws even though it has 0 Hit
 * > Points, but it still has the Unconscious condition. If the creature takes
 * > damage, it stops being Stable and starts making Death Saving Throws
 * > again. **A Stable creature that isn't healed regains 1 Hit Point after
 * > 1d4 hours.**"
 * >
 * > "Falling Unconscious": "you have the Unconscious condition ... until you
 * > regain any Hit Points."
 *
 * Found by the app's I2-F: a Stable solo hero lay at 0 for ever, because the
 * last sentence had nowhere to live. The die is thrown the moment the creature
 * becomes Stable and pinned onto the deadline it sets, so a replay reads the
 * hours back and never throws them again; the clock arriving at the deadline
 * wakes the creature by the same derived expiry every other deadline uses.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const KESS = id('kess');
const OGRE = id('ogre');
const CLERIC = id('cleric');
const HOUR = 3600;

const sheet = (): CharacterSheet => ({
  level: 3,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId, diesAtZero = false): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 20,
  diesAtZero,
  creatureType: 'Humanoid',
});

/** Kess dropped to 0 by the ogre's club, and nobody fighting any more. */
const DOWN: readonly GameEvent[] = [
  added(KESS),
  { type: 'damage-taken', id: KESS, amount: 20, source: 'the ogre' },
  { type: 'condition-applied', id: KESS, condition: 'unconscious', source: ZERO_HIT_POINTS },
];

/** A generator that throws exactly what it is told to, in order, round and round. */
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
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what = 'the wake'): T => unwrap(result, what);
const then = (log: readonly GameEvent[], events: readonly GameEvent[]) => [...log, ...events];
const kessIn = (log: readonly GameEvent[]) => fold('seed', log).creatures[KESS]!;

/** Kess, stabilised by a DM's word after a Medicine check, on a d4 that shows `face`. */
const stabilised = (face: number, log: readonly GameEvent[] = DOWN) =>
  then(log, must(stabiliseCreature(fold('seed', log), KESS, {}, supply([face]))));

/** The deadline the stabilising pinned, read off the log rather than assumed. */
const pinnedWake = (log: readonly GameEvent[]): number => {
  const scheduled = log.filter(
    (event): event is Extract<GameEvent, { type: 'effect-scheduled' }> =>
      event.type === 'effect-scheduled' && event.target.kind === 'stable',
  );
  const last = scheduled[scheduled.length - 1];
  expect(last).toBeDefined();
  expect(last!.deadline.kind).toBe('elapsed');
  return (last!.deadline as { readonly at: number }).at;
};

const passing = (log: readonly GameEvent[], seconds: number) =>
  then(log, must(advanceTime(fold('seed', log), seconds, 'time passes'), 'the clock'));

const WAKE_KEY = timerKey({ kind: 'stable', on: KESS });

describe('a Stable creature regains 1 Hit Point after 1d4 hours', () => {
  it('throws the d4 when the creature becomes Stable, and pins the hours onto the deadline', () => {
    const log = stabilised(3);
    const batch = log.slice(DOWN.length);
    // The die is the engine's, recorded like any other, and the generator's
    // move is recorded beside it.
    expect(batch.map((event) => event.type)).toEqual([
      'stabilised',
      'roll-recorded',
      'effect-scheduled',
      'rolls-issued',
    ]);
    const thrown = batch.find((event) => event.type === 'roll-recorded') as Extract<
      GameEvent,
      { type: 'roll-recorded' }
    >;
    expect(thrown.who).toBe(KESS);
    expect(pinnedWake(log)).toBe(fold('seed', DOWN).elapsed + thrown.total * HOUR);
    expect(fold('seed', log).timers[WAKE_KEY]).toBeDefined();
  });

  it('stays at 0 and Unconscious until the pinned moment, then regains 1 Hit Point and wakes', () => {
    const log = stabilised(3);
    const wake = pinnedWake(log);

    const justBefore = passing(log, wake - 1);
    expect(kessIn(justBefore).vitals).toMatchObject({ hp: 0, stable: true });
    expect(kessIn(justBefore).conditions.conditions).toContain('unconscious');

    const arrived = passing(justBefore, 1);
    const kess = kessIn(arrived);
    expect(kess.vitals).toMatchObject({ hp: 1, stable: false, deathSaveSuccesses: 0, deathSaveFailures: 0 });
    // SRD: Unconscious "until you regain any Hit Points". Prone stays, as it
    // stays whenever Unconscious ends.
    expect(kess.conditions.conditions).not.toContain('unconscious');
    expect(fold('seed', arrived).timers[WAKE_KEY]).toBeUndefined();
  });

  it('wakes on a clock jump that carries it far past the deadline, with exactly 1 Hit Point', () => {
    const log = passing(stabilised(4), 24 * HOUR);
    expect(kessIn(log).vitals.hp).toBe(1);
  });

  /** "Whenever you start your turn with 0 Hit Points" — three successes. */
  it('is thrown for the third successful death save, the fight over, and the clock carries it', () => {
    const FIGHT: readonly GameEvent[] = [
      added(KESS),
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
    let log: readonly GameEvent[] = FIGHT;
    // Two boundaries a round — the ogre's start, then Kess's — each save a 15,
    // and the d4 after the third success a 2.
    for (let n = 0; n < 6; n += 1) {
      log = then(log, must(resolveTurn(fold('seed', log), supply([15, 2])), 'turn').events);
    }
    expect(kessIn(log).vitals.stable).toBe(true);
    const wake = pinnedWake(log);
    expect(fold('seed', log).timers[WAKE_KEY]).toBeDefined();

    const over = then(log, [{ type: 'combat-ended' }]);
    const woken = passing(over, wake - fold('seed', over).elapsed);
    expect(kessIn(woken).vitals.hp).toBe(1);
  });

  /** SRD Spare the Dying: "The creature becomes Stable." */
  it('is thrown when a spell makes the creature Stable', () => {
    const table: readonly GameEvent[] = [
      ...DOWN,
      added(CLERIC),
      {
        type: 'spellcasting-declared',
        id: CLERIC,
        spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', cantrips: ['spare-the-dying'] }),
      },
      { type: 'scene-set', extent: { width: 100, depth: 100, height: 20 } },
      { type: 'landmark-added', name: 'the yard', at: { x: 50, y: 50, z: 0 } },
      { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the yard' }, feet: 0 } },
      { type: 'creature-placed', id: KESS, placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 } },
      { type: 'sight-declared', from: CLERIC, to: KESS, seen: true },
    ];
    const cast = must(
      resolveSpell(fold('seed', table), CLERIC, { spellId: 'spare-the-dying', targets: [KESS] }, supply([2])),
      'Spare the Dying',
    );
    const log = then(table, cast.events);
    expect(kessIn(log).vitals.stable).toBe(true);
    const wake = pinnedWake(log);
    expect(kessIn(passing(log, wake - fold('seed', log).elapsed)).vitals.hp).toBe(1);
  });

  it('is not thrown again for a creature that is already Stable', () => {
    const log = stabilised(1);
    const again = must(stabiliseCreature(fold('seed', log), KESS, { commandId: 'twice' }, supply([4])));
    expect(again.some((event) => event.type === 'roll-recorded')).toBe(false);
    expect(pinnedWake(then(log, again))).toBe(pinnedWake(log));
  });

  it('refuses without a generator to throw the die', () => {
    // A stabilising is owed a die; a command handed none refuses rather than
    // writing a Stable nothing will ever wake.
    const refused = stabiliseCreature(fold('seed', DOWN), KESS);
    expect(isErr(refused) && refused.code).toBe('wake_die_owed');
  });
});

describe('the wake is cancelled by what the rules say ends it', () => {
  it('is cancelled by healing before the deadline', () => {
    const log = stabilised(3);
    const wake = pinnedWake(log);
    const halfHour = passing(log, 30 * 60);
    const healed = then(halfHour, must(healCreature(fold('seed', halfHour), KESS, 5), 'the heal'));
    expect(fold('seed', healed).timers[WAKE_KEY]).toBeUndefined();
    // And the deadline arriving adds nothing to the healing.
    const later = passing(healed, wake);
    expect(kessIn(later).vitals.hp).toBe(5);
  });

  /** SRD: "If the creature takes damage, it stops being Stable." */
  it('is cancelled by damage, which stops the creature being Stable', () => {
    const log = stabilised(3);
    const wake = pinnedWake(log);
    const hurt = then(log, must(damageCreature(fold('seed', log), KESS, { amount: 1 }), 'the blow'));
    expect(kessIn(hurt).vitals.stable).toBe(false);
    expect(fold('seed', hurt).timers[WAKE_KEY]).toBeUndefined();

    // Dying again, so the clock asks rather than running on — see below —
    // until something settles it. Stabilised afresh, the wake is thrown afresh
    // and measured from now.
    const again = stabilised(1, hurt);
    expect(pinnedWake(again)).toBe(fold('seed', hurt).elapsed + 1 * HOUR);
    expect(pinnedWake(again)).not.toBe(wake);
  });

  it('starts over after the creature is healed and dropped to 0 again', () => {
    const log = stabilised(4);
    const healed = then(log, must(healCreature(fold('seed', log), KESS, 3), 'the heal'));
    const hour = passing(healed, HOUR);
    const dropped = then(hour, must(damageCreature(fold('seed', hour), KESS, { amount: 3 }), 'the blow'));
    expect(kessIn(dropped).vitals).toMatchObject({ hp: 0, stable: false });
    expect(fold('seed', dropped).timers[WAKE_KEY]).toBeUndefined();

    const again = stabilised(2, dropped);
    expect(pinnedWake(again)).toBe(fold('seed', dropped).elapsed + 2 * HOUR);
  });

  it('goes with a creature that dies', () => {
    const log = then(stabilised(3), [{ type: 'creature-died', id: KESS, cause: 'a DM’s ruling' }]);
    expect(fold('seed', log).timers[WAKE_KEY]).toBeUndefined();
  });
});

describe('a rest', () => {
  /** SRD Short Rest and Long Rest: "you must have at least 1 Hit Point." */
  it('is still refused a Stable creature at 0, and taken once the wake has given it 1', () => {
    const log = stabilised(2);
    expect(isErr(beginRest(fold('seed', log), KESS, 'short'))).toBe(true);
    const woken = passing(log, pinnedWake(log));
    expect(beginRest(fold('seed', woken), KESS, 'short').ok).toBe(true);
  });
});

describe('the wake replays', () => {
  it('folds identically, and reads the hours off the log rather than throwing them again', () => {
    const log = passing(stabilised(3), 5 * HOUR);
    expect(JSON.stringify(fold('seed', log))).toBe(JSON.stringify(fold('seed', log)));
    // Stepped event by event is the same state as folded whole.
    const stepped = log.reduce((state: GameState, event) => applyEvent(state, event), fold('seed', []));
    expect(JSON.stringify(stepped)).toBe(JSON.stringify(fold('seed', log)));
    // A different seed moves no pinned number: the wake is in the log.
    expect(fold('another seed', log).creatures[KESS]!.vitals.hp).toBe(1);
  });
});

describe('dying outside a fight asks rather than guesses', () => {
  /**
   * SRD: "Whenever you start your turn with 0 Hit Points, you must make a
   * Death Saving Throw" — and "Outside combat, the GM ensures that every
   * character has a chance to act and decides how to resolve their activity.
   * In combat, the characters take turns." Outside a fight there is no turn
   * and the book prints no rate, so time passing over a dying creature is a
   * question for the table, not six seconds the engine invents.
   */
  it('refuses to pass time over a dying creature, naming the turn order that would roll its saves', () => {
    const asked = advanceTime(fold('seed', DOWN), 60, 'a minute passes');
    expect(isNeedsContext(asked)).toBe(true);
    expect(!asked.ok && asked.code).toBe('dying_outside_a_fight');
    const requests = contextRequestsOf(asked);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ kind: 'turn-order', subject: KESS });
    expect(requests[0]!.satisfyWith).toContain('beginCombat');
  });

  it('passes time over a Stable creature, a corpse and a creature that is upright', () => {
    expect(advanceTime(fold('seed', stabilised(2)), 60, 'a minute').ok).toBe(true);
    const dead = then(DOWN, [{ type: 'creature-died', id: KESS, cause: 'the club' }]);
    expect(advanceTime(fold('seed', dead), 60, 'a minute').ok).toBe(true);
    expect(advanceTime(fold('seed', [added(KESS)]), 60, 'a minute').ok).toBe(true);
  });

  it('passes no time at all without asking', () => {
    expect(advanceTime(fold('seed', DOWN), 0, 'a breath').ok).toBe(true);
  });
});
