import { describe, expect, it } from 'vitest';
import { asCharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { fold, historyOf, initialState, applyEvent, type GameEvent } from './events.js';

const id = (s: string) => asCharacterId(s);

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

const add = (name: string, maxHp: number, diesAtZero = false): GameEvent => ({
  type: 'creature-added',
  id: id(name),
  name,
  sheet: sheet(),
  maxHp,
  diesAtZero,
});

const party = (): GameEvent[] => [add('fighter', 30), add('goblin', 10, true)];

describe('folding a log', () => {
  it('starts empty', () => {
    const state = initialState('seed');
    expect(state.creatures).toEqual({});
    expect(state.combat).toBeNull();
    expect(state.scene).toBeNull();
  });

  it('adds a creature at full health', () => {
    const state = fold('seed', [add('fighter', 30)]);
    expect(state.creatures.fighter).toMatchObject({ name: 'fighter' });
    expect(state.creatures.fighter?.vitals).toMatchObject({ hp: 30, hpMax: 30 });
  });

  it('removes one', () => {
    const state = fold('seed', [add('fighter', 30), { type: 'creature-removed', id: id('fighter') }]);
    expect(state.creatures.fighter).toBeUndefined();
  });

  it('counts the events it applied', () => {
    expect(fold('seed', party()).eventCount).toBe(2);
  });
});

/**
 * The property the whole design rests on: the fold is a pure function of the
 * log. Replaying yesterday's campaign has to give yesterday's state, which is
 * only true because events carry resolved outcomes rather than intents that
 * get re-rolled through whatever the rules happen to say today.
 */
describe('replay is deterministic', () => {
  const log: GameEvent[] = [
    ...party(),
    { type: 'scene-set', extent: { width: 60, depth: 40, height: 15 } },
    { type: 'landmark-added', name: 'the bar', at: { x: 10, y: 20, z: 0 } },
    { type: 'creature-placed', id: id('fighter'), placement: { from: { landmark: 'the bar' }, feet: 5, bearing: 90 } },
    { type: 'creature-placed', id: id('goblin'), placement: { from: { creature: id('fighter') }, feet: 10, bearing: 90 } },
    { type: 'combat-started', combatants: [
      { id: id('fighter'), initiative: 18, speed: 30 },
      { id: id('goblin'), initiative: 9, speed: 30 },
    ] },
    { type: 'damage-taken', id: id('goblin'), amount: 4, source: 'Longsword' },
    { type: 'condition-applied', id: id('goblin'), condition: 'frightened', source: 'a spell' },
    { type: 'turn-advanced' },
  ];

  it('folds to the same state every time', () => {
    expect(fold('seed', log)).toEqual(fold('seed', log));
  });

  it('serialises identically, so two replays can be compared byte for byte', () => {
    expect(JSON.stringify(fold('seed', log))).toBe(JSON.stringify(fold('seed', log)));
  });

  it('reaches the same state whether folded at once or one event at a time', () => {
    const stepwise = log.reduce(applyEvent, initialState('seed'));
    expect(stepwise).toEqual(fold('seed', log));
  });

  it('is unaffected by the seed, since nothing is re-rolled', () => {
    // The seed is recorded so a *live* session resumes its generator, not so a
    // replay reproduces rolls. Rolls are already in the log.
    const a = { ...fold('one', log), seed: '' };
    const b = { ...fold('two', log), seed: '' };
    expect(a).toEqual(b);
  });
});

describe('vitals through the log', () => {
  it('applies damage', () => {
    const state = fold('seed', [...party(), { type: 'damage-taken', id: id('goblin'), amount: 4 }]);
    expect(state.creatures.goblin?.vitals.hp).toBe(6);
  });

  // SRD: "A monster dies the instant it drops to 0 Hit Points."
  it('kills a monster outright at zero', () => {
    const state = fold('seed', [...party(), { type: 'damage-taken', id: id('goblin'), amount: 10 }]);
    expect(state.creatures.goblin?.vitals.dead).toBe(true);
  });

  it('leaves a character unconscious rather than dead', () => {
    const state = fold('seed', [...party(), { type: 'damage-taken', id: id('fighter'), amount: 30 }]);
    expect(state.creatures.fighter?.vitals).toMatchObject({ hp: 0, dead: false });
  });

  // The SRD's worked example, arriving through the log rather than directly.
  it('applies Massive Damage', () => {
    const state = fold('seed', [
      add('scout', 12),
      { type: 'damage-taken', id: id('scout'), amount: 6 },
      { type: 'damage-taken', id: id('scout'), amount: 18 },
    ]);
    expect(state.creatures.scout?.vitals.dead).toBe(true);
  });

  it('spends temporary hit points first', () => {
    const state = fold('seed', [
      add('fighter', 30),
      { type: 'temporary-hp-granted', id: id('fighter'), amount: 5 },
      { type: 'damage-taken', id: id('fighter'), amount: 7 },
    ]);
    expect(state.creatures.fighter?.vitals).toMatchObject({ hp: 28, temporaryHp: 0 });
  });

  it('heals, clearing death save progress', () => {
    const state = fold('seed', [
      add('fighter', 30),
      { type: 'damage-taken', id: id('fighter'), amount: 30 },
      { type: 'death-save-recorded', id: id('fighter'), natural: 4 },
      { type: 'healed', id: id('fighter'), amount: 5 },
    ]);
    expect(state.creatures.fighter?.vitals).toMatchObject({ hp: 5, deathSaveFailures: 0 });
  });

  it('walks death saves through to stabilisation', () => {
    const state = fold('seed', [
      add('fighter', 30),
      { type: 'damage-taken', id: id('fighter'), amount: 30 },
      { type: 'death-save-recorded', id: id('fighter'), natural: 12 },
      { type: 'death-save-recorded', id: id('fighter'), natural: 15 },
      { type: 'death-save-recorded', id: id('fighter'), natural: 11 },
    ]);
    expect(state.creatures.fighter?.vitals).toMatchObject({ stable: true, dead: false });
  });

  it('walks death saves through to death, counting a natural 1 twice', () => {
    const state = fold('seed', [
      add('fighter', 30),
      { type: 'damage-taken', id: id('fighter'), amount: 30 },
      { type: 'death-save-recorded', id: id('fighter'), natural: 1 },
      { type: 'death-save-recorded', id: id('fighter'), natural: 5 },
    ]);
    expect(state.creatures.fighter?.vitals.dead).toBe(true);
  });

  it('brings a dying creature back on a natural 20', () => {
    const state = fold('seed', [
      add('fighter', 30),
      { type: 'damage-taken', id: id('fighter'), amount: 30 },
      { type: 'death-save-recorded', id: id('fighter'), natural: 2 },
      { type: 'death-save-recorded', id: id('fighter'), natural: 20 },
    ]);
    expect(state.creatures.fighter?.vitals).toMatchObject({ hp: 1, deathSaveFailures: 0 });
  });
});

describe('conditions through the log', () => {
  it('applies a condition and its implications', () => {
    const state = fold('seed', [...party(), { type: 'condition-applied', id: id('goblin'), condition: 'unconscious', source: 'a spell' }]);
    const conditions = state.creatures.goblin?.conditions.conditions ?? [];
    expect(conditions).toContain('unconscious');
    expect(conditions).toContain('incapacitated');
    expect(conditions).toContain('prone');
  });

  /**
   * Losing Unconscious lifts the Incapacitated it carried, but Prone persists —
   * SRD: "When this condition ends, you remain Prone."
   */
  it('drops what a condition implied, except Prone', () => {
    const state = fold('seed', [
      ...party(),
      { type: 'condition-applied', id: id('goblin'), condition: 'unconscious', source: 'a spell' },
      { type: 'condition-removed', id: id('goblin'), condition: 'unconscious', source: 'a spell' },
    ]);
    const conditions = state.creatures.goblin?.conditions.conditions ?? [];
    expect(conditions).not.toContain('unconscious');
    expect(conditions).not.toContain('incapacitated');
    expect(conditions).toContain('prone');
  });

  it('sets an exhaustion level', () => {
    const state = fold('seed', [...party(), { type: 'exhaustion-set', id: id('fighter'), level: 3 }]);
    expect(state.creatures.fighter?.conditions.exhaustion).toBe(3);
  });

  // Conditions are sorted on the way in, so a replay compares byte for byte
  // regardless of the order they were applied.
  it('stores conditions in a stable order', () => {
    const forwards = fold('seed', [
      add('a', 10),
      { type: 'condition-applied', id: id('a'), condition: 'blinded', source: 'a spell' },
      { type: 'condition-applied', id: id('a'), condition: 'poisoned', source: 'a spell' },
    ]);
    const backwards = fold('seed', [
      add('a', 10),
      { type: 'condition-applied', id: id('a'), condition: 'poisoned', source: 'a spell' },
      { type: 'condition-applied', id: id('a'), condition: 'blinded', source: 'a spell' },
    ]);
    expect(forwards.creatures.a?.conditions).toEqual(backwards.creatures.a?.conditions);
  });
});

describe('combat and the map through the log', () => {
  const inCombat = (): GameEvent[] => [
    ...party(),
    { type: 'combat-started', combatants: [
      { id: id('fighter'), initiative: 18, speed: 30 },
      { id: id('goblin'), initiative: 9, speed: 30 },
    ] },
  ];

  it('starts combat in initiative order', () => {
    const state = fold('seed', inCombat());
    expect(state.combat?.order.map((c) => c.id)).toEqual([id('fighter'), id('goblin')]);
    expect(state.combat?.round).toBe(1);
  });

  it('spends a turn budget', () => {
    const state = fold('seed', [...inCombat(), { type: 'action-spent', id: id('fighter') }]);
    expect(state.combat?.budgets.fighter?.action).toBe(false);
  });

  it('advances into the next round', () => {
    const state = fold('seed', [...inCombat(), { type: 'turn-advanced' }, { type: 'turn-advanced' }]);
    expect(state.combat?.round).toBe(2);
  });

  it('ends combat', () => {
    const state = fold('seed', [...inCombat(), { type: 'combat-ended' }]);
    expect(state.combat).toBeNull();
  });

  it('builds a scene and places a creature in it', () => {
    const state = fold('seed', [
      ...party(),
      { type: 'scene-set', extent: { width: 60, depth: 40, height: 15 } },
      { type: 'landmark-added', name: 'the bar', at: { x: 10, y: 20, z: 0 } },
      { type: 'creature-placed', id: id('fighter'), placement: { from: { landmark: 'the bar' }, feet: 10, bearing: 90 } },
    ]);
    expect(state.scene?.positions.fighter).toEqual({ x: 20, y: 20, z: 0 });
  });

  it('carries a rider when its mount moves', () => {
    const state = fold('seed', [
      add('rider', 20),
      add('horse', 20),
      { type: 'scene-set', extent: { width: 200, depth: 200, height: 50 } },
      { type: 'landmark-added', name: 'the road', at: { x: 50, y: 50, z: 0 } },
      { type: 'creature-placed', id: id('rider'), placement: { from: { landmark: 'the road' }, feet: 0 } },
      { type: 'creature-placed', id: id('horse'), placement: { from: { creature: id('rider') }, feet: 5, bearing: 90, size: 'large' } },
      { type: 'mounted', rider: id('rider'), mount: id('horse'), willing: true },
      { type: 'creature-moved', id: id('horse'), placement: { from: { landmark: 'the road' }, feet: 30, bearing: 90 } },
    ]);
    const horse = state.scene?.positions.horse;
    expect(state.scene?.positions.rider).toEqual({ ...horse!, z: horse!.z + 5 });
  });
});

describe('a corrupt log is loud', () => {
  /**
   * Rules-legal refusals never become events — the command layer asks the
   * engine first and emits nothing if the answer is no. So a failure here means
   * the log and the code disagree, which should never pass quietly.
   */
  it('throws on damage to a creature that is not in the game', () => {
    expect(() => fold('seed', [{ type: 'damage-taken', id: id('ghost'), amount: 3 }])).toThrow(
      /not in this game/,
    );
  });

  it('throws on a creature added twice', () => {
    expect(() => fold('seed', [add('fighter', 30), add('fighter', 30)])).toThrow(/already/);
  });

  it('throws on combat events with no combat running', () => {
    expect(() => fold('seed', [...party(), { type: 'turn-advanced' }])).toThrow(/no combat/);
  });

  it('throws on placement with no scene', () => {
    expect(() =>
      fold('seed', [...party(), { type: 'creature-placed', id: id('fighter'), placement: { from: { sceneCenter: true }, feet: 0 } }]),
    ).toThrow(/no scene/);
  });

  it('throws when an engine rule refuses the event', () => {
    // Spending two actions on one turn is not a rules dispute at this layer —
    // it means something emitted an event it should never have emitted.
    expect(() =>
      fold('seed', [
        ...party(),
        { type: 'combat-started', combatants: [{ id: id('fighter'), initiative: 18, speed: 30 }] },
        { type: 'action-spent', id: id('fighter') },
        { type: 'action-spent', id: id('fighter') },
      ]),
    ).toThrow(/already taken an action/);
  });
});

/**
 * The reason for keeping the log and not only the state. "Show me exactly why
 * the goblin died" should be a filter, not an investigation.
 */
describe('why the goblin died', () => {
  const log: GameEvent[] = [
    ...party(),
    { type: 'combat-started', combatants: [
      { id: id('fighter'), initiative: 18, speed: 30 },
      { id: id('goblin'), initiative: 9, speed: 30 },
    ] },
    { type: 'action-spent', id: id('fighter') },
    {
      type: 'roll-recorded',
      who: id('fighter'),
      label: 'Longsword attack',
      natural: 11,
      total: 18,
      contributions: [
        { source: 'Strength', amount: 3 },
        { source: 'proficiency', amount: 2 },
        { source: 'Bless', amount: 4 },
        { source: 'Cutting Words', amount: -2 },
      ],
      outcome: 'hit',
    },
    { type: 'damage-taken', id: id('goblin'), amount: 6, source: 'Longsword' },
    { type: 'turn-advanced' },
    { type: 'damage-taken', id: id('goblin'), amount: 5, source: 'Longsword' },
  ];

  it('kills the goblin', () => {
    expect(fold('seed', log).creatures.goblin?.vitals.dead).toBe(true);
  });

  it('filters to just what happened to it', () => {
    const history = historyOf(log, id('goblin'));
    expect(history.map((e) => e.type)).toEqual(['creature-added', 'combat-started', 'damage-taken', 'damage-taken']);
  });

  /**
   * The point of recording the roll separately: an intervention is visible with
   * its source and its sign, rather than vanishing into one unexplained total.
   */
  it('shows every hand that touched the attack roll', () => {
    const attack = log.find((e) => e.type === 'roll-recorded');
    expect(attack).toBeDefined();
    if (attack?.type !== 'roll-recorded') throw new Error('unreachable');

    expect(attack.natural).toBe(11);
    expect(attack.contributions.map((c) => c.source)).toContain('Cutting Words');
    expect(attack.contributions.find((c) => c.source === 'Cutting Words')?.amount).toBeLessThan(0);
    // The contributions account for the whole difference between die and total.
    const sum = attack.contributions.reduce((n, c) => n + c.amount, 0);
    expect(attack.natural + sum).toBe(attack.total);
  });

  it('records the roll without changing any state', () => {
    const before = fold('seed', log.slice(0, 4));
    const after = fold('seed', log.slice(0, 5));
    expect({ ...after, eventCount: before.eventCount }).toEqual(before);
  });
});

describe('resuming a session', () => {
  it('carries the generator state and the roll count forward', () => {
    const state = fold('seed', [
      ...party(),
      { type: 'rolls-issued', count: 3, rng: [1, 2, 3, 4] },
      { type: 'rolls-issued', count: 2, rng: [5, 6, 7, 8] },
    ]);
    expect(state.rollsIssued).toBe(5);
    expect(state.rng).toEqual([5, 6, 7, 8]);
  });

  it('starts with no generator state at all', () => {
    expect(fold('seed', party()).rng).toBeNull();
  });
});
