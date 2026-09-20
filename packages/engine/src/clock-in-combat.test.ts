/**
 * The clock in a fight is derived, and `advanceTime` is a declaration.
 *
 * `time.ts` and `docs/design/time-and-turns.md` both say it in as many words:
 * a round is six seconds, a round ends when the Initiative order wraps, and
 * `withCombat` charges the clock for every round crossed — "time is not a
 * decision anybody makes, so it is derived rather than commanded". Out of
 * combat there is no order to derive it from, so how long the party spent
 * searching the vault is narration and arrives as an event.
 *
 * Nothing refused the second one during the first. A session holding
 * `advance_time` could say "eight hours pass" on the goblin's turn: every span
 * hung on the clock expires at once, the turn order does not move, and the
 * fight's own six seconds are then charged **on top** of an hour the fold
 * never counted. A rest measured against that clock is a rest nobody took.
 *
 * So the refusal is outright rather than selective — see `advanceTime` for
 * why the alternative ("refuse only what would cross a deadline") is not a
 * rule about the clock at all.
 */
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { forSeconds, HOUR, minutes, ROUND } from './time.js';
import { advanceTime, applyConditionTo, declareCreatureSide, endCombat } from './commands.js';

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');

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

const add = (who: string): GameEvent => ({
  type: 'creature-added',
  id: id(who),
  name: who,
  sheet: sheet(),
  maxHp: 40,
});

/** Two creatures and no fight: the world `advanceTime` was written for. */
const hall = (): readonly GameEvent[] => [add('wizard'), add('goblin')];

/** The same two, with Initiative rolled. */
const fight = (): readonly GameEvent[] => [
  ...hall(),
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

const run = (
  log: readonly GameEvent[],
  command: (state: GameState) => Result<readonly GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

const conditionsOf = (state: GameState, who: string) =>
  state.creatures[who]?.conditions.conditions ?? [];

describe('advancing the clock is a declaration, and a fight does not take one', () => {
  it('moves the clock when there is no fight to derive it from', () => {
    const later = run(hall(), (s) => advanceTime(s, 600, 'searching the vault'));
    expect(fold('seed', later).elapsed).toBe(600);
  });

  it('refuses while a fight is running', () => {
    const refused = advanceTime(fold('seed', fight()), 600, 'searching the vault');
    expect(isErr(refused) ? refused.code : 'ok').toBe('in_combat');
  });

  /**
   * And it refuses the small ones too, because the rule is about who owns the
   * clock rather than about how much of it was asked for. Six seconds declared
   * inside a fight is the round's own cost charged twice.
   */
  it('refuses a round, and refuses no time at all', () => {
    for (const seconds of [0, ROUND]) {
      const refused = advanceTime(fold('seed', fight()), seconds, 'a moment');
      expect(isErr(refused) ? refused.code : 'ok').toBe('in_combat');
    }
  });

  /**
   * The harm, made concrete: the Web the wizard is standing in lasts ten
   * minutes, and a declaration of ten minutes on the goblin's turn would end
   * it without a single turn having been taken.
   */
  it('so a session cannot expire the deadlines of the fight it is in', () => {
    const snared = run(fight(), (s) =>
      applyConditionTo(s, GOBLIN, 'restrained', 'a web', [], forSeconds(minutes(10))),
    );
    expect(conditionsOf(fold('seed', snared), 'goblin')).toContain('restrained');

    // What the refusal stands in front of, forged by hand: the fold knows
    // nothing about who owns the clock, so the declaration really would end
    // the web without a turn having been taken. The command is the only thing
    // between a session and that log.
    const forged = fold('seed', [
      ...snared,
      { type: 'time-advanced', seconds: minutes(10), reason: 'the web frays' },
    ]);
    expect(conditionsOf(forged, 'goblin')).not.toContain('restrained');

    const refused = advanceTime(fold('seed', snared), minutes(10), 'the web frays');
    expect(isErr(refused)).toBe(true);
  });

  /** The fight's own clock still runs: a round that wraps costs six seconds. */
  it('leaves the turn order charging the clock it owns', () => {
    const round: readonly GameEvent[] = [
      ...fight(),
      { type: 'turn-advanced' },
      { type: 'turn-advanced' },
    ];
    expect(fold('seed', round).elapsed).toBe(ROUND);
  });

  /**
   * And the reducer is **not** taught it, which is the one place this module
   * departs from "a command refuses exactly what the reducer would call
   * corrupt". `golden-log-2.json` advances the clock five times inside a fight
   * nothing ever ended, so a fold that threw would be a migration of a frozen
   * log. The rule is about which author may write the event; the fold's
   * business is whether an event can be applied at all.
   */
  it('leaves a log that already holds one folding exactly as it did', () => {
    const forged: readonly GameEvent[] = [
      ...fight(),
      { type: 'time-advanced', seconds: HOUR, reason: 'an hour in the vestry' },
    ];
    expect(() => fold('seed', forged)).not.toThrow();
    expect(fold('seed', forged).elapsed).toBe(HOUR);
  });

  /**
   * And the refusal is about the fight, not about the creatures in it — so the
   * hour is there the moment the fight is over.
   *
   * **Through `endCombat` rather than a forged event**, because that is the
   * half of this decision that makes the other half a rule instead of a wedge:
   * a session that rolled Initiative once could not close a fight at all until
   * the command landed, and a refusal with no door out is a session that can
   * never rest. The two shipped in one review.
   */
  it('lets the clock be declared again once the fight is over', () => {
    const sided = run(
      run(fight(), (s) => declareCreatureSide(s, WIZARD, 'the party')),
      (s) => declareCreatureSide(s, GOBLIN, 'the goblins'),
    );
    const over = run(sided, (s) =>
      endCombat(s, { kind: 'flight', side: 'the goblins', letThemGo: true }),
    );
    const later = run(over, (s) => advanceTime(s, HOUR, 'the party binds its wounds'));
    expect(fold('seed', later).elapsed).toBe(HOUR);
  });
});
