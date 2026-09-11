import { describe, expect, it } from 'vitest';
import { asCharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { fold, type GameEvent } from './events.js';
import { DAY, HOUR, MINUTE, ROUND, days, describeElapsed, hours, minutes, rounds } from './clock.js';

const id = (s: string) => asCharacterId(s);

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const add = (name: string, maxHp = 30): GameEvent => ({
  type: 'creature-added',
  id: id(name),
  name,
  sheet: sheet(),
  maxHp,
});

describe('the clock counts seconds', () => {
  /** SRD: "A round represents about 6 seconds in the game world." */
  it('knows how long the units of play are', () => {
    expect(ROUND).toBe(6);
    expect(MINUTE).toBe(60);
    expect(HOUR).toBe(3600);
    expect(DAY).toBe(86_400);
  });

  it('builds durations from units', () => {
    expect(rounds(10)).toBe(MINUTE);
    expect(minutes(60)).toBe(HOUR);
    expect(hours(24)).toBe(DAY);
    expect(days(1)).toBe(DAY);
  });

  /** Everything divides into rounds, so no duration lands between two of them. */
  it('keeps every unit a whole number of rounds', () => {
    for (const seconds of [ROUND, MINUTE, HOUR, DAY]) {
      expect(seconds % ROUND).toBe(0);
    }
  });

  it('refuses a duration that is not a whole number of seconds', () => {
    expect(() => rounds(1.5)).toThrow();
    expect(() => hours(-1)).toThrow();
    expect(() => minutes(NaN)).toThrow();
  });

  it('says an elapsed span out loud', () => {
    expect(describeElapsed(0)).toBe('no time');
    expect(describeElapsed(ROUND)).toBe('1 round');
    expect(describeElapsed(rounds(3))).toBe('3 rounds');
    expect(describeElapsed(MINUTE)).toBe('1 minute');
    expect(describeElapsed(HOUR)).toBe('1 hour');
    expect(describeElapsed(hours(8))).toBe('8 hours');
    expect(describeElapsed(days(2))).toBe('2 days');
  });
});

describe('time passes', () => {
  it('starts at zero', () => {
    expect(fold('seed', []).elapsed).toBe(0);
  });

  it('advances when something says it did', () => {
    const state = fold('seed', [
      add('fighter'),
      { type: 'time-advanced', seconds: hours(4), reason: 'travelling to the pass' },
    ]);
    expect(state.elapsed).toBe(hours(4));
  });

  it('accumulates', () => {
    const state = fold('seed', [
      { type: 'time-advanced', seconds: MINUTE, reason: 'searching' },
      { type: 'time-advanced', seconds: MINUTE, reason: 'searching' },
    ]);
    expect(state.elapsed).toBe(minutes(2));
  });

  it('refuses to run backwards', () => {
    expect(() =>
      fold('seed', [{ type: 'time-advanced', seconds: -60, reason: 'nope' }]),
    ).toThrow();
  });
});

describe('a combat round is six seconds', () => {
  const two = (): GameEvent[] => [
    add('fighter'),
    add('goblin'),
    {
      type: 'combat-started',
      combatants: [
        { id: id('fighter'), initiative: 20, speed: 30 },
        { id: id('goblin'), initiative: 5, speed: 30 },
      ],
    },
  ];

  /**
   * Time is not a decision anybody makes, so it is derived rather than
   * commanded: a round ends when the initiative order wraps, and six seconds
   * have passed. A caller that had to remember to advance the clock would
   * eventually forget, and a spell would outlive its duration.
   */
  it('does not advance mid-round', () => {
    const state = fold('seed', [...two(), { type: 'turn-advanced' }]);
    expect(state.combat?.round).toBe(1);
    expect(state.elapsed).toBe(0);
  });

  it('advances when the order wraps', () => {
    const state = fold('seed', [...two(), { type: 'turn-advanced' }, { type: 'turn-advanced' }]);
    expect(state.combat?.round).toBe(2);
    expect(state.elapsed).toBe(ROUND);
  });

  it('counts a full minute of combat as ten rounds', () => {
    const log: GameEvent[] = [...two()];
    for (let i = 0; i < 20; i += 1) log.push({ type: 'turn-advanced' });
    const state = fold('seed', log);
    expect(state.combat?.round).toBe(11);
    expect(state.elapsed).toBe(MINUTE);
  });

  it('is the same however the log is folded', () => {
    const log: GameEvent[] = [...two(), { type: 'turn-advanced' }, { type: 'turn-advanced' }];
    expect(fold('seed', log).elapsed).toBe(fold('seed', log).elapsed);
  });
});
