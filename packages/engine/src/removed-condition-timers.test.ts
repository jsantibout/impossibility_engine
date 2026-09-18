import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  expect as unwrap,
  type CharacterId,
  type ConditionName,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { conditionInstanceId } from './conditions.js';
import { timerKey } from './duration.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import {
  advanceTime,
  applyConditionTo,
  applySpellEffect,
  castSpell,
  pendingSavesOf,
  resolveTurn,
} from './commands.js';
import { endConditionsOn } from './commands/conditions.js';

/**
 * A condition removed takes its timer with it.
 *
 * `applyConditionTo` hangs an `effect-scheduled` on the condition *instance*
 * whenever there is a duration, a repeat save or a check, and
 * `endConditionsOn` lifts the condition by **name** — every instance of it,
 * which is what SRD Lesser Restoration and Lay On Hands both mean. The
 * instances went and the timers stayed: a deadline waiting to end something
 * already ended, and — worse — a repeat save the next turn boundary raised
 * against a condition that is gone.
 *
 * Nothing new is written for it. A timer is a deadline on an instance, so an
 * instance that no longer exists has no deadline, and the fold can see that
 * from the removal it is already reducing. The removal stays one event.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');
const OGRE = id('ogre');
const SPECTRE = id('spectre');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const add = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
});

/** Order: wizard, goblin, ogre. */
const fight = (): GameEvent[] => [
  add(WIZARD),
  add(GOBLIN),
  add(OGRE),
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: spellSlotKey(2), label: 'l2', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      { id: OGRE, initiative: 5, speed: 30 },
    ],
  },
];

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

const supplyFor = (state: GameState, flat: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  content: SRD_CONTENT,
  bonuses: [{ source: 'the test insists', flat }],
});

/** Low enough that a repeat save, if one is ever raised, is failed. */
const DOOMED = -40;

/** Hold Person on the goblin, repeating its save at the end of its own turns. */
const held = (): GameEvent[] => {
  const cast = run(fight(), (s) =>
    castSpell(s, WIZARD, {
      spell: 'Hold Person',
      level: 2,
      concentration: true,
      slotLevel: 2,
    }),
  );
  return run(cast, (s) =>
    applySpellEffect(s, GOBLIN, 'paralyzed', WIZARD, {
      repeatSave: {
        at: 'end-of-turn',
        of: GOBLIN,
        ability: 'wis',
        dc: 13,
        onSuccess: 'end-on-target',
        label: 'Wisdom save vs Hold Person',
      },
    }),
  );
};

/** The casting the wizard is holding in the log above. */
const castingOf = (log: readonly GameEvent[]): string => {
  const held = fold('seed', log).creatures[WIZARD]?.concentration?.castingId;
  if (held === undefined) throw new Error('the fixture opened no casting');
  return held;
};

/** Advance one turn at a time, settling whatever the boundary raises. */
const advance = (log: GameEvent[], turns: number): GameEvent[] => {
  let current = log;
  for (let n = 0; n < turns; n += 1) {
    const state = fold('seed', current);
    const outcome = unwrap(resolveTurn(state, supplyFor(state, DOOMED)), 'turn');
    current = [...current, ...outcome.events];
  }
  return current;
};

const keyFor = (who: CharacterId, condition: ConditionName, source: string): string =>
  timerKey({ kind: 'condition', on: who, instance: conditionInstanceId(condition, source) });

const conditionsOf = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]?.conditions.conditions ?? [];

describe('a repeat save is not raised against a condition that is gone', () => {
  /**
   * The bug, reproduced: Hold Person paralyses the goblin and hangs a repeat
   * save at the end of each of its turns; Lesser Restoration's removal lifts
   * the Paralyzed; the goblin's turn ends and the boundary raises the save
   * anyway, against nothing.
   */
  it('raises no save at the boundary after the condition was removed', () => {
    const cured = [...held(), ...endConditionsOn(GOBLIN, ['paralyzed'])];
    expect(conditionsOf(fold('seed', cured), GOBLIN)).toEqual([]);

    // The wizard acts first; the goblin's turn is the one that ends next.
    const afterWizard = advance(cured, 1);
    const state = fold('seed', afterWizard);
    const outcome = unwrap(resolveTurn(state, supplyFor(state, DOOMED)), 'turn');

    expect(outcome.saves).toEqual([]);
    expect(pendingSavesOf(fold('seed', [...afterWizard, ...outcome.events]))).toEqual([]);
  });

  /**
   * And it is gone rather than merely unraised. A timer left standing is a
   * deadline waiting to end something that has already ended, and the next
   * reader of `state.timers` would find it.
   */
  it('takes the timer out of state, not just out of the boundary', () => {
    const before = fold('seed', held());
    const key = keyFor(GOBLIN, 'paralyzed', `Hold Person#${castingOf(held())}`);
    expect(Object.keys(before.timers)).toContain(key);

    const after = fold('seed', [...held(), ...endConditionsOn(GOBLIN, ['paralyzed'])]);
    expect(Object.keys(after.timers)).not.toContain(key);
  });

  /**
   * And a save the boundary raised **before** the cure arrived goes with it.
   *
   * Nothing here is new — `dropOrphanedSaves` has always dropped a debt whose
   * effect is gone, and a save nobody can settle is what wedges the turn order
   * — but it only ever saw the timer. Taking the timer away is what lets the
   * pass it was already reaching for do its job, so the cure clears an
   * outstanding save as well as a future one, and `resolveTurn` is not left
   * refusing `saves_pending` on behalf of a condition nobody has.
   */
  it('drops a save already raised, rather than leaving the turn owing it', () => {
    // No supply, so the boundary raises the save and nothing rolls it.
    const raise = (s: GameState): Result<GameEvent[]> => {
      const outcome = resolveTurn(s);
      return outcome.ok ? { ok: true, value: [...outcome.value.events] } : outcome;
    };
    const owing = run(run(held(), raise), raise);
    expect(pendingSavesOf(fold('seed', owing)).map((p) => p.target)).toEqual([GOBLIN]);

    const cured = [...owing, ...endConditionsOn(GOBLIN, ['paralyzed'])];
    expect(pendingSavesOf(fold('seed', cured))).toEqual([]);
  });
});

describe('a removal by name takes every instance and every timer', () => {
  const twiceParalyzed = (): GameEvent[] => {
    const first = run(fight(), (s) =>
      applyConditionTo(s, GOBLIN, 'paralyzed', 'a ghoul', [], { kind: 'seconds', seconds: 60 }),
    );
    return run(first, (s) =>
      applyConditionTo(s, GOBLIN, 'paralyzed', 'a basilisk', [], { kind: 'seconds', seconds: 120 }),
    );
  };

  /**
   * `endConditionsOn`'s doc comment argues the reading already: the SRD ends
   * *the condition*, so a creature paralysed twice over is not half-cured.
   * Every instance goes, and so does every deadline those instances owned.
   */
  it('lifts both instances and both of their deadlines', () => {
    const log = twiceParalyzed();
    const before = fold('seed', log);
    expect(Object.keys(before.timers)).toEqual([
      keyFor(GOBLIN, 'paralyzed', 'a basilisk'),
      keyFor(GOBLIN, 'paralyzed', 'a ghoul'),
    ]);

    const after = fold('seed', [...log, ...endConditionsOn(GOBLIN, ['paralyzed'])]);
    expect(after.creatures[GOBLIN]?.conditions.instances).toEqual([]);
    expect(after.timers).toEqual({});
  });

  /**
   * A removal that *does* name a source lifts that cause and no other, and
   * its deadline goes with it while the other creature's stays.
   */
  it('lifts one cause and one deadline when the removal names a source', () => {
    const log = twiceParalyzed();
    const after = fold('seed', [
      ...log,
      { type: 'condition-removed', id: GOBLIN, condition: 'paralyzed', source: 'a ghoul' },
    ]);

    expect(after.creatures[GOBLIN]?.conditions.instances.map((i) => i.source)).toEqual([
      'a basilisk',
      'a basilisk',
    ]);
    expect(Object.keys(after.timers)).toEqual([keyFor(GOBLIN, 'paralyzed', 'a basilisk')]);
  });
});

describe('a removal touches nothing else that is waiting', () => {
  /**
   * The other condition's deadline and the casting's own are two different
   * timers on the same fight, and neither is about the condition that was
   * lifted. SRD does not end a Grease because somebody was cured of poison.
   */
  it('leaves another condition deadline and a casting deadline standing', () => {
    const castingId = castingOf(held());
    const cluttered = run(
      [
        ...held(),
        {
          type: 'effect-scheduled',
          target: { kind: 'casting', castingId },
          deadline: { kind: 'elapsed', at: 60 },
        },
      ],
      (s) => applyConditionTo(s, GOBLIN, 'poisoned', 'a bite', [], { kind: 'seconds', seconds: 90 }),
    );

    const after = fold('seed', [...cluttered, ...endConditionsOn(GOBLIN, ['paralyzed'])]);

    expect(Object.keys(after.timers).sort()).toEqual(
      [keyFor(GOBLIN, 'poisoned', 'a bite'), timerKey({ kind: 'casting', castingId })].sort(),
    );
    expect(conditionsOf(after, GOBLIN)).toEqual(['poisoned']);
  });
});

describe('a condition reapplied after a removal starts its own clock', () => {
  const haunted = (): GameEvent[] =>
    run([add(SPECTRE)], (s) =>
      applyConditionTo(s, SPECTRE, 'frightened', 'a spectre', [], { kind: 'seconds', seconds: 60 }),
    );

  /**
   * The stale deadline was not merely untidy: it would end the **next**
   * Frightened early, at a moment measured from a condition nobody has any
   * more. The same sentence `endLostFeatures` already writes about a Rage.
   */
  it('does not inherit the deadline the removed one owned', () => {
    let log: GameEvent[] = [...haunted(), ...endConditionsOn(SPECTRE, ['frightened'])];
    log = run(log, (s) => advanceTime(s, 30, 'the party regroups'));
    log = run(log, (s) => applyConditionTo(s, SPECTRE, 'frightened', 'a spectre'));

    // Half a minute in, with the removed condition's deadline at sixty
    // seconds and the new one carrying none of its own.
    expect(conditionsOf(fold('seed', log), SPECTRE)).toEqual(['frightened']);
    expect(fold('seed', log).timers).toEqual({});

    const later = run(log, (s) => advanceTime(s, 40, 'and walks on'));
    expect(fold('seed', later).elapsed).toBe(70);
    expect(conditionsOf(fold('seed', later), SPECTRE)).toEqual(['frightened']);
  });
});

describe('the ordinary path does not move', () => {
  /** A condition nobody removed still ends on its own deadline, and only then. */
  it('ends a timed condition exactly when its deadline arrives', () => {
    const log = run([add(SPECTRE)], (s) =>
      applyConditionTo(s, SPECTRE, 'poisoned', 'a bad oyster', [], {
        kind: 'seconds',
        seconds: 60,
      }),
    );

    const nearly = run(log, (s) => advanceTime(s, 59, 'the hour turns'));
    expect(conditionsOf(fold('seed', nearly), SPECTRE)).toEqual(['poisoned']);
    expect(Object.keys(fold('seed', nearly).timers)).toEqual([
      keyFor(SPECTRE, 'poisoned', 'a bad oyster'),
    ]);

    const done = run(nearly, (s) => advanceTime(s, 1, 'and turns again'));
    expect(conditionsOf(fold('seed', done), SPECTRE)).toEqual([]);
    expect(fold('seed', done).timers).toEqual({});
  });
});
