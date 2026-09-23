import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { HOUR, ROUND, hours, minutes } from './time.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { beginRest, endRest, LONG_REST } from './rest.js';
import { hitDieKey } from './resources.js';
import { grantTemporaryHpTo } from './commands.js';
// The low-level half beneath `resolveSpell`, a module export rather than a
// command — see the barrel's own note about why it is not published.
import { resolveCast } from './commands/casting.js';

/**
 * Sequences reported from direct probing, each reproduced before it was fixed.
 *
 * These live together rather than in the module each one blames, because every
 * one of them is a seam: two subsystems that were individually right and
 * disagreed at the join. A test filed under one of them would not have caught
 * it, which is why none of them did.
 */

const id = (s: string) => asCharacterId(s);

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const add = (name: string, maxHp = 40): GameEvent => ({
  type: 'creature-added',
  id: id(name),
  name,
  sheet: sheet(),
  maxHp,
});

const pool = (who: string, key: string, max: number): GameEvent => ({
  type: 'resource-pool-declared',
  id: id(who),
  pool: { key, label: key, max, recovers: 'long-rest' },
});

const cast = (): GameEvent[] => [
  add('wizard'),
  add('goblin'),
  pool('wizard', spellSlotKey(1), 2),
  pool('wizard', hitDieKey(6), 5),
];

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): { log: GameEvent[]; state: GameState } => {
  const events = unwrap(command(fold('seed', log)), 'command');
  const next = [...log, ...events];
  return { log: next, state: fold('seed', next) };
};

const clock = (seconds: number): GameEvent => ({ type: 'time-advanced', seconds, reason: 'time' });
const hurt = (who: string, amount: number): GameEvent => ({
  type: 'damage-taken',
  id: id(who),
  amount,
});

describe('1. a Long Rest broken early is not rescued by waiting', () => {
  /**
   * SRD: "If you rested at least 1 hour **before the interruption**, you gain
   * the benefits of a Short Rest." Time spent lying there afterwards is not
   * rest — the rest was over the moment it broke.
   *
   * The bug read total elapsed time at the moment `endRest` happened, so ten
   * minutes of sleep plus an hour of standing around counted as seventy
   * minutes and paid out a Short Rest nobody had taken.
   */
  const broken = (restedFor: number, thenWaited: number): GameEvent[] => {
    const begun = run([...cast(), hurt('wizard', 20)], (s) => beginRest(s, id('wizard'), 'long'));
    return [...begun.log, clock(restedFor), hurt('wizard', 1), clock(thenWaited)];
  };

  it('earns nothing when the interruption came inside the hour', () => {
    const log = broken(minutes(10), HOUR);
    const result = unwrap(endRest(fold('seed', log), id('wizard')), 'rest');
    expect(result.benefit).toBe('none');
  });

  it('still earns a Short Rest when the hour was actually served', () => {
    const log = broken(hours(2), hours(5));
    const result = unwrap(endRest(fold('seed', log), id('wizard')), 'rest');
    expect(result.benefit).toBe('short');
  });

  it('measures from the interruption, not from the call', () => {
    const log = broken(minutes(59), hours(10));
    expect(unwrap(endRest(fold('seed', log), id('wizard')), 'rest').benefit).toBe('none');

    const justOver = broken(HOUR, hours(10));
    expect(unwrap(endRest(fold('seed', justOver), id('wizard')), 'rest').benefit).toBe('short');
  });

  it('records when the interruption happened', () => {
    const log = broken(minutes(10), HOUR);
    expect(fold('seed', log).creatures.wizard!.resting).toMatchObject({
      interruptedBy: 'damage',
      interruptedAt: minutes(10),
    });
  });

  /** An interruption the engine cannot see happens when it is reported. */
  it('dates a caller-reported interruption to the moment it is reported', () => {
    const begun = run(cast(), (s) => beginRest(s, id('wizard'), 'long'));
    const log = [...begun.log, clock(hours(3))];
    const result = unwrap(
      endRest(fold('seed', log), id('wizard'), { interrupted: 'an hour of hard walking' }),
      'rest',
    );
    expect(result.benefit).toBe('short');
  });
});

describe('2. a rest command id is checked, not merely remembered', () => {
  /**
   * `beginRest` returned an empty success for *any* id that had been used
   * before — a different creature, a different kind of rest, anything. That is
   * the silent no-op the casting commands already refuse: the second command
   * never runs and nobody is told.
   */
  const first = () => run(cast(), (s) => beginRest(s, id('wizard'), 'short', 'r1'));

  it('is a no-op for the identical rest', () => {
    const started = first();
    expect(unwrap(beginRest(started.state, id('wizard'), 'short', 'r1'), 'retry')).toEqual([]);
  });

  it('refuses the same id for a different creature', () => {
    const result = beginRest(first().state, id('goblin'), 'short', 'r1');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('command_id_reused');
  });

  it('refuses the same id for a different kind of rest', () => {
    const result = beginRest(first().state, id('wizard'), 'long', 'r1');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('command_id_reused');
  });

  /** And it does not collide with ids spent on other kinds of command. */
  it('refuses an id already spent on a casting', () => {
    const spell = run(cast(), (s) =>
      resolveCast(s, id('wizard'), {
        spell: 'Magic Missile',
        level: 1,
        slotLevel: 1,
        commandId: 'x',
      }),
    );
    const result = beginRest(spell.state, id('wizard'), 'short', 'x');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('command_id_reused');
  });
});

describe('3. Temporary Hit Points do not survive a Long Rest', () => {
  /**
   * SRD: "Temporary Hit Points last until they're depleted or you finish a
   * Long Rest." The rest restored hit points, Hit Dice, slots and Exhaustion
   * and left the buffer sitting there.
   */
  const rested = () => {
    const granted = run([...cast(), hurt('wizard', 20)], (s) =>
      grantTemporaryHpTo(s, id('wizard'), 8),
    );
    const begun = run(granted.log, (s) => beginRest(s, id('wizard'), 'long'));
    const log = [...begun.log, clock(LONG_REST)];
    const result = unwrap(endRest(fold('seed', log), id('wizard')), 'rest');
    return fold('seed', [...log, ...result.events]);
  };

  it('clears them when the Long Rest finishes', () => {
    const state = rested();
    expect(state.creatures.wizard!.vitals.temporaryHp).toBe(0);
    expect(state.creatures.wizard!.vitals.hp).toBe(40);
  });

  /** A Short Rest is not a Long Rest, and leaves the buffer alone. */
  it('leaves them alone after a Short Rest', () => {
    const granted = run(cast(), (s) => grantTemporaryHpTo(s, id('wizard'), 8));
    const begun = run(granted.log, (s) => beginRest(s, id('wizard'), 'short'));
    const log = [...begun.log, clock(HOUR)];
    const result = unwrap(endRest(fold('seed', log), id('wizard')), 'rest');

    expect(fold('seed', [...log, ...result.events]).creatures.wizard!.vitals.temporaryHp).toBe(8);
  });

  it('leaves them alone when the Long Rest earned nothing', () => {
    const granted = run(cast(), (s) => grantTemporaryHpTo(s, id('wizard'), 8));
    const begun = run(granted.log, (s) => beginRest(s, id('wizard'), 'long'));
    const log = [...begun.log, clock(minutes(10)), hurt('wizard', 1)];
    const result = unwrap(endRest(fold('seed', log), id('wizard')), 'rest');

    expect(result.benefit).toBe('none');
    expect(fold('seed', [...log, ...result.events]).creatures.wizard!.vitals.temporaryHp).toBe(7);
  });
});

describe('4. a round is six seconds however the turn changed hands', () => {
  const two = (): GameEvent[] => [
    ...cast(),
    {
      type: 'combat-started',
      combatants: [
        { id: id('wizard'), initiative: 20, speed: 30 },
        { id: id('goblin'), initiative: 10, speed: 30 },
      ],
    },
  ];

  /**
   * Removing the combatant who was acting, and who was last in the order,
   * wraps the Initiative order to the top and starts a new round — exactly as
   * `advanceTurn` does. The clock only moved for one of those two paths, so a
   * fight where enemies died on their own turns ran fast: rounds ticked by and
   * game time did not.
   */
  it('advances the clock when a removal wraps the round', () => {
    const onGoblin = [...two(), { type: 'turn-advanced' as const }];
    expect(fold('seed', onGoblin).combat?.turnIndex).toBe(1);

    const removed = fold('seed', [...onGoblin, { type: 'combatant-removed', id: id('goblin') }]);
    expect(removed.combat?.round).toBe(2);
    expect(removed.elapsed).toBe(ROUND);
  });

  it('matches what advancing the turn normally would have cost', () => {
    const onGoblin = [...two(), { type: 'turn-advanced' as const }];
    const byAdvancing = fold('seed', [...onGoblin, { type: 'turn-advanced' }]);
    const byRemoval = fold('seed', [...onGoblin, { type: 'combatant-removed', id: id('goblin') }]);

    expect(byRemoval.elapsed).toBe(byAdvancing.elapsed);
    expect(byRemoval.combat?.round).toBe(byAdvancing.combat?.round);
  });

  /** A removal that does not wrap the round costs no time, same as mid-round. */
  it('costs nothing when the removal does not end the round', () => {
    const removed = fold('seed', [...two(), { type: 'combatant-removed', id: id('goblin') }]);
    expect(removed.combat?.round).toBe(1);
    expect(removed.elapsed).toBe(0);
  });

  it('never double-counts a single round', () => {
    const log: GameEvent[] = [...two()];
    for (let i = 0; i < 4; i += 1) log.push({ type: 'turn-advanced' });
    const state = fold('seed', log);
    expect(state.combat?.round).toBe(3);
    expect(state.elapsed).toBe(2 * ROUND);
  });
});

describe('5. casting spends the action it costs', () => {
  const fight = (): GameEvent[] => [
    ...cast(),
    {
      type: 'combat-started',
      combatants: [
        { id: id('wizard'), initiative: 20, speed: 30 },
        { id: id('goblin'), initiative: 10, speed: 30 },
      ],
    },
  ];

  const bolt = { spell: 'Fire Bolt', level: 0, slotless: 'cantrip' } as const;

  /**
   * SRD: "Most spells require the Magic action to cast." Two Magic actions on
   * one turn is not a thing, and the slot-per-turn rule does not catch it,
   * because a cantrip expends no slot.
   */
  it('refuses a second action cantrip on the same turn', () => {
    const first = run(fight(), (s) => resolveCast(s, id('wizard'), bolt));
    expect(first.state.combat?.budgets.wizard?.action).toBe(false);

    const second = resolveCast(first.state, id('wizard'), bolt);
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.code).toBe('no_action');
  });

  it('leaves everything untouched when it refuses', () => {
    const first = run(fight(), (s) => resolveCast(s, id('wizard'), bolt));
    expect(resolveCast(first.state, id('wizard'), bolt).ok).toBe(false);
    expect(fold('seed', first.log)).toEqual(first.state);
  });

  /** A Bonus Action spell is a different budget, and still available. */
  it('spends the budget the casting time names', () => {
    const first = run(fight(), (s) => resolveCast(s, id('wizard'), bolt));
    const bonus = run(first.log, (s) =>
      resolveCast(s, id('wizard'), {
        spell: 'Healing Word',
        level: 1,
        slotLevel: 1,
        castingTime: 'bonus-action',
      }),
    );
    expect(bonus.state.combat?.budgets.wizard?.bonusAction).toBe(false);
    expect(bonus.state.combat?.budgets.wizard?.action).toBe(false);
  });

  /** SRD: a Reaction may be taken on another creature's turn. */
  it('spends a Reaction on somebody else turn', () => {
    const onGoblin = [...fight(), { type: 'turn-advanced' as const }];
    const shielded = run(onGoblin, (s) =>
      resolveCast(s, id('wizard'), {
        spell: 'Shield',
        level: 1,
        slotLevel: 1,
        castingTime: 'reaction',
      }),
    );
    expect(shielded.state.combat?.budgets.wizard?.reaction).toBe(false);
  });

  it('refuses an action on somebody else turn', () => {
    const onGoblin = [...fight(), { type: 'turn-advanced' as const }];
    const result = resolveCast(fold('seed', onGoblin), id('wizard'), bolt);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_their_turn');
  });

  /** A refused casting costs no slot either — the economy is checked first. */
  it('spends no slot when the action is already gone', () => {
    const first = run(fight(), (s) => resolveCast(s, id('wizard'), bolt));
    const result = resolveCast(first.state, id('wizard'), {
      spell: 'Magic Missile',
      level: 1,
      slotLevel: 1,
    });
    expect(isErr(result)).toBe(true);
    expect(first.state.creatures.wizard!.resources.pools[spellSlotKey(1)]?.spent).toBe(0);
  });

  /** Out of combat there is no economy to spend, and casting still works. */
  it('casts freely with no combat running', () => {
    const first = run(cast(), (s) => resolveCast(s, id('wizard'), bolt));
    expect(isErr(resolveCast(first.state, id('wizard'), bolt))).toBe(false);
  });

  it('refreshes on the next turn', () => {
    const first = run(fight(), (s) => resolveCast(s, id('wizard'), bolt));
    const round = fold('seed', [
      ...first.log,
      { type: 'turn-advanced' },
      { type: 'turn-advanced' },
    ]);
    expect(isErr(resolveCast(round, id('wizard'), bolt))).toBe(false);
  });
});
