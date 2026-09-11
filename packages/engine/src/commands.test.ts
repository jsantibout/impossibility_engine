import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { applyCondition, conditionState, removeCondition, reasonsFor } from './conditions.js';
import { fold, type GameEvent, type GameState } from './events.js';
import {
  ZERO_HIT_POINTS,
  applyConditionTo,
  damageCreature,
  healCreature,
  removeCreatureEverywhere,
  setExhaustionLevel,
  whyCondition,
} from './commands.js';

const id = (s: string) => asCharacterId(s);

const sheet = (): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const add = (name: string, maxHp: number, diesAtZero = false): GameEvent => ({
  type: 'creature-added',
  id: id(name),
  name,
  sheet: sheet(),
  maxHp,
  diesAtZero,
});

/** Fold a log, then run a command against it and fold the result too. */
const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => ReturnType<typeof damageCreature>,
): GameState => {
  const before = fold('seed', log);
  const events = unwrap(command(before), 'command');
  return fold('seed', [...log, ...events]);
};

describe('conditions remember why', () => {
  /**
   * The scenario from the review, and the reason instances exist. Two effects
   * independently make a creature Incapacitated; lifting one must not lift the
   * other. A flat list of names could not tell them apart.
   */
  it('keeps an independent Incapacitated when Unconscious is removed', () => {
    let state = conditionState();
    state = applyCondition(state, 'incapacitated', 'Hold Person');
    state = applyCondition(state, 'unconscious', 'Sleep');

    expect(state.conditions).toContain('incapacitated');
    expect(state.conditions).toContain('unconscious');

    state = removeCondition(state, 'unconscious', 'Sleep');

    expect(state.conditions).not.toContain('unconscious');
    // Hold Person is still running.
    expect(state.conditions).toContain('incapacitated');
    expect(reasonsFor(state, 'incapacitated').map((i) => i.source)).toEqual(['Hold Person']);
  });

  it('still drops the Incapacitated that Unconscious itself carried', () => {
    let state = applyCondition(conditionState(), 'unconscious', 'Sleep');
    expect(state.conditions).toContain('incapacitated');
    state = removeCondition(state, 'unconscious', 'Sleep');
    expect(state.conditions).not.toContain('incapacitated');
  });

  // SRD Unconscious: "When this condition ends, you remain Prone."
  it('leaves Prone behind', () => {
    let state = applyCondition(conditionState(), 'unconscious', 'Sleep');
    state = removeCondition(state, 'unconscious', 'Sleep');
    expect(state.conditions).toContain('prone');
  });

  it('survives two parents that both imply Incapacitated', () => {
    let state = applyCondition(conditionState(), 'stunned', 'Shocking Grasp');
    state = applyCondition(state, 'paralyzed', 'Hold Monster');
    expect(reasonsFor(state, 'incapacitated')).toHaveLength(2);

    state = removeCondition(state, 'stunned', 'Shocking Grasp');
    expect(state.conditions).toContain('incapacitated');

    state = removeCondition(state, 'paralyzed', 'Hold Monster');
    expect(state.conditions).not.toContain('incapacitated');
  });

  it('lifts every instance when no source is named', () => {
    let state = applyCondition(conditionState(), 'poisoned', 'a bite');
    state = applyCondition(state, 'poisoned', 'bad ale');
    expect(reasonsFor(state, 'poisoned')).toHaveLength(2);

    state = removeCondition(state, 'poisoned');
    expect(state.conditions).not.toContain('poisoned');
  });

  it('is idempotent for the same condition from the same source', () => {
    let state = applyCondition(conditionState(), 'poisoned', 'a bite');
    state = applyCondition(state, 'poisoned', 'a bite');
    expect(reasonsFor(state, 'poisoned')).toHaveLength(1);
  });

  it('serialises identically however it was reached', () => {
    const forwards = applyCondition(
      applyCondition(conditionState(), 'blinded', 'ash'),
      'poisoned',
      'a bite',
    );
    const backwards = applyCondition(
      applyCondition(conditionState(), 'poisoned', 'a bite'),
      'blinded',
      'ash',
    );
    expect(JSON.stringify(forwards)).toBe(JSON.stringify(backwards));
  });
});

describe('damageCreature keeps hit points and conditions coherent', () => {
  const party = (): GameEvent[] => [add('fighter', 20), add('goblin', 8, true)];

  /**
   * SRD: "If you reach 0 Hit Points and don't die instantly, you have the
   * Unconscious condition." Damage alone left a character at 0 hit points and
   * fully conscious, because the follow-up was left to the caller.
   */
  it('knocks a character unconscious at zero', () => {
    const state = run(party(), (s) => damageCreature(s, id('fighter'), { amount: 20 }));
    expect(state.creatures.fighter?.vitals.hp).toBe(0);
    expect(state.creatures.fighter?.conditions.conditions).toContain('unconscious');
    expect(whyCondition(state, id('fighter'), 'unconscious')).toEqual([ZERO_HIT_POINTS]);
  });

  it('does not knock out a creature that merely took a hit', () => {
    const state = run(party(), (s) => damageCreature(s, id('fighter'), { amount: 5 }));
    expect(state.creatures.fighter?.conditions.conditions).toEqual([]);
  });

  // A monster dies at zero rather than falling unconscious.
  it('leaves a dead monster without the condition', () => {
    const state = run(party(), (s) => damageCreature(s, id('goblin'), { amount: 8 }));
    expect(state.creatures.goblin?.vitals.dead).toBe(true);
    expect(state.creatures.goblin?.conditions.conditions).not.toContain('unconscious');
  });

  it('refuses damage that is not a number', () => {
    const before = fold('seed', party());
    expect(isErr(damageCreature(before, id('fighter'), { amount: NaN }))).toBe(true);
  });

  it('refuses a creature that is not in the game', () => {
    const before = fold('seed', party());
    expect(isErr(damageCreature(before, id('ghost'), { amount: 5 }))).toBe(true);
  });
});

describe('healCreature lifts only what the hit points caused', () => {
  const downed = (): GameEvent[] => [
    add('fighter', 20),
    { type: 'damage-taken', id: id('fighter'), amount: 20 },
    { type: 'condition-applied', id: id('fighter'), condition: 'unconscious', source: ZERO_HIT_POINTS },
  ];

  it('wakes a character healed from zero', () => {
    const state = run(downed(), (s) => healCreature(s, id('fighter'), 5));
    expect(state.creatures.fighter?.vitals.hp).toBe(5);
    expect(state.creatures.fighter?.conditions.conditions).not.toContain('unconscious');
  });

  /**
   * The reason unconsciousness is attributed. A character put to sleep and
   * *then* dropped to 0 has two reasons to be unconscious; healing lifts only
   * the hit points one, and they stay asleep.
   */
  it('leaves unconsciousness from another source in place', () => {
    const log: GameEvent[] = [
      ...downed(),
      { type: 'condition-applied', id: id('fighter'), condition: 'unconscious', source: 'Sleep' },
    ];
    const state = run(log, (s) => healCreature(s, id('fighter'), 5));

    expect(state.creatures.fighter?.vitals.hp).toBe(5);
    expect(state.creatures.fighter?.conditions.conditions).toContain('unconscious');
    expect(whyCondition(state, id('fighter'), 'unconscious')).toEqual(['Sleep']);
  });

  it('leaves unrelated conditions alone entirely', () => {
    const log: GameEvent[] = [
      ...downed(),
      { type: 'condition-applied', id: id('fighter'), condition: 'poisoned', source: 'a bite' },
    ];
    const state = run(log, (s) => healCreature(s, id('fighter'), 5));
    expect(state.creatures.fighter?.conditions.conditions).toContain('poisoned');
  });

  it('refuses to heal the dead', () => {
    const dead = fold('seed', [
      add('scout', 10),
      { type: 'damage-taken', id: id('scout'), amount: 10 },
      { type: 'damage-taken', id: id('scout'), amount: 10 },
    ]);
    expect(isErr(healCreature(dead, id('scout'), 5))).toBe(true);
  });
});

describe('setExhaustionLevel', () => {
  const one = (): GameEvent[] => [add('fighter', 20)];

  it('sets a level', () => {
    const state = run(one(), (s) => setExhaustionLevel(s, id('fighter'), 3));
    expect(state.creatures.fighter?.conditions.exhaustion).toBe(3);
  });

  // SRD: "You die if your Exhaustion level is 6."
  it('kills at level 6 without the caller remembering to', () => {
    const state = run(one(), (s) => setExhaustionLevel(s, id('fighter'), 6));
    expect(state.creatures.fighter?.vitals.dead).toBe(true);
  });

  it('refuses a level outside 0 to 6', () => {
    const before = fold('seed', one());
    expect(isErr(setExhaustionLevel(before, id('fighter'), 7))).toBe(true);
    expect(isErr(setExhaustionLevel(before, id('fighter'), -1))).toBe(true);
  });
});

describe('removeCreatureEverywhere', () => {
  const onTheBoard = (): GameEvent[] => [
    add('fighter', 20),
    add('goblin', 8, true),
    { type: 'scene-set', extent: { width: 100, depth: 100, height: 20 } },
    { type: 'landmark-added', name: 'the door', at: { x: 10, y: 10, z: 0 } },
    { type: 'creature-placed', id: id('fighter'), placement: { from: { landmark: 'the door' }, feet: 0 } },
    { type: 'creature-placed', id: id('goblin'), placement: { from: { creature: id('fighter') }, feet: 15, bearing: 90 } },
    { type: 'combat-started', combatants: [
      { id: id('fighter'), initiative: 15, speed: 30 },
      { id: id('goblin'), initiative: 8, speed: 30 },
    ] },
  ];

  /**
   * A creature removed from the cast but left standing on the map and sitting
   * in the initiative order is a dangling reference waiting to be tripped over.
   */
  it('clears the map and the initiative order as well as the cast', () => {
    const state = run(onTheBoard(), (s) => removeCreatureEverywhere(s, id('goblin')));
    expect(state.creatures.goblin).toBeUndefined();
    expect(state.scene?.positions.goblin).toBeUndefined();
    expect(state.combat?.order.some((c) => c.id === id('goblin'))).toBe(false);
  });

  it('ends the fight rather than emptying it', () => {
    const log: GameEvent[] = [
      add('fighter', 20),
      { type: 'combat-started', combatants: [{ id: id('fighter'), initiative: 15, speed: 30 }] },
    ];
    const state = run(log, (s) => removeCreatureEverywhere(s, id('fighter')));
    expect(state.combat).toBeNull();
  });

  it('copes with a creature that was never placed or in combat', () => {
    const state = run([add('fighter', 20)], (s) => removeCreatureEverywhere(s, id('fighter')));
    expect(state.creatures.fighter).toBeUndefined();
  });
});

describe('applyConditionTo', () => {
  const one = (): GameEvent[] => [add('zombie', 15)];

  it('emits the condition with its cause', () => {
    const before = fold('seed', one());
    const events = unwrap(applyConditionTo(before, id('zombie'), 'frightened', 'Fear'), 'applied');
    expect(events).toEqual([
      { type: 'condition-applied', id: id('zombie'), condition: 'frightened', source: 'Fear' },
    ]);
  });

  // Immunity is a rules-legal refusal the DM narrates around — the spell lands
  // and does nothing — rather than a silent no-op.
  it('refuses a condition the creature is immune to', () => {
    const before = fold('seed', one());
    const result = applyConditionTo(before, id('zombie'), 'poisoned', 'venom', ['poisoned']);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('immune');
  });
});
