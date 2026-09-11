import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import {
  applyConditionTo,
  applySpellEffect,
  castSpell,
  endConcentration,
  pendingSavesOf,
  resolvePendingSaves,
  resolveTurn,
} from './commands.js';

/**
 * Turn-boundary hooks: effects that get a saving throw when a turn begins or
 * ends, resolved by the engine rather than remembered by the caller.
 *
 * The hard part is that a roll cannot happen in the reducer — randomness
 * enters the log once, at the point of the roll, and the fold has to stay a
 * pure function of what is written down. So turn advancement raises the save
 * as a **pending resolution in state**, and an engine-owned operation rolls
 * it.
 *
 * That sounds like the pending Concentration save that had to be torn out, and
 * it is the opposite of it in the way that matters. That one lived only in a
 * return value: it did not survive a reload, nothing consumed it, and the
 * command id was already spent so there was no way back to it. This one is
 * derived from `turn-advanced` by the fold, so it survives anything the log
 * survives — and the engine **refuses to advance another turn** while one is
 * outstanding, so forgetting it stops the game rather than losing a rule.
 */

const id = (s: string) => asCharacterId(s);

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

const add = (name: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: id(name),
  name,
  sheet: sheet(over),
  maxHp: 40,
});

/** Order: wizard, goblin, ogre. */
const fight = (): GameEvent[] => [
  add('wizard'),
  add('goblin'),
  add('ogre'),
  {
    type: 'resource-pool-declared',
    id: id('wizard'),
    pool: { key: spellSlotKey(2), label: 'l2', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'combat-started',
    combatants: [
      { id: id('wizard'), initiative: 20, speed: 30 },
      { id: id('goblin'), initiative: 10, speed: 30 },
      { id: id('ogre'), initiative: 5, speed: 30 },
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
  bonuses: [{ source: 'the test insists', flat }],
});

const CERTAIN = 40;
const DOOMED = -40;

/** Hold Person on the goblin, repeating its save at the end of its own turns. */
const held = (): GameEvent[] => {
  const cast = run(fight(), (s) =>
    castSpell(s, id('wizard'), {
      spell: 'Hold Person',
      level: 2,
      concentration: true,
      slotLevel: 2,
    }),
  );
  return run(cast, (s) =>
    applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard'), {
      repeatSave: {
        at: 'end-of-turn',
        of: id('goblin'),
        ability: 'wis',
        dc: 13,
        onSuccess: 'end-on-target',
        label: 'Wisdom save vs Hold Person',
      },
    }),
  );
};

const conditionsOf = (state: GameState, who: string) =>
  state.creatures[who]?.conditions.conditions ?? [];

/** Advance until the named creature's turn has just ended. */
const advanceTo = (log: GameEvent[], turns: number, flat = DOOMED): GameEvent[] => {
  let current = log;
  for (let n = 0; n < turns; n += 1) {
    const state = fold('seed', current);
    const outcome = unwrap(resolveTurn(state, supplyFor(state, flat)), 'turn');
    current = [...current, ...outcome.events];
  }
  return current;
};

describe('a turn boundary raises the saves it owes', () => {
  it('raises nothing when no effect asks for one', () => {
    const state = fold('seed', run(fight(), (s) => applyConditionTo(s, id('goblin'), 'poisoned', 'a bite')));
    const outcome = unwrap(resolveTurn(state), 'turn');
    expect(outcome.saves).toEqual([]);
    expect(pendingSavesOf(fold('seed', [...run(fight(), (s) => applyConditionTo(s, id('goblin'), 'poisoned', 'a bite')), ...outcome.events]))).toEqual([]);
  });

  /**
   * SRD Hold Person: "At the end of each of its turns, the target repeats the
   * save." The end of *its* turns, so the wizard's turn ending raises nothing.
   */
  it('raises nothing at the end of somebody else turn', () => {
    const state = fold('seed', held());
    const outcome = unwrap(resolveTurn(state, supplyFor(state, DOOMED)), 'turn');
    expect(outcome.saves).toEqual([]);
  });

  it('raises the save at the end of the turn it names', () => {
    // The wizard acts first; the goblin's turn ends on the second advance.
    const afterWizard = advanceTo(held(), 1);
    const state = fold('seed', afterWizard);
    const outcome = unwrap(resolveTurn(state, supplyFor(state, DOOMED)), 'turn');

    expect(outcome.saves).toHaveLength(1);
    expect(outcome.saves[0]).toMatchObject({
      target: id('goblin'),
      ability: 'wis',
      dc: 13,
      success: false,
    });
  });

  it('records the roll it made, so the log can explain it', () => {
    const state = fold('seed', advanceTo(held(), 1));
    const outcome = unwrap(resolveTurn(state, supplyFor(state, DOOMED)), 'turn');
    const recorded = outcome.events.find((e) => e.type === 'roll-recorded');
    expect(recorded).toMatchObject({ who: id('goblin'), label: 'Wisdom save vs Hold Person' });
    expect(outcome.events.some((e) => e.type === 'rolls-issued')).toBe(true);
  });
});

describe('what the save does', () => {
  it('keeps the effect when the save fails', () => {
    const after = advanceTo(held(), 2, DOOMED);
    const state = fold('seed', after);
    expect(conditionsOf(state, 'goblin')).toContain('paralyzed');
    expect(state.creatures.wizard!.concentration).not.toBeNull();
  });

  /** SRD: "ending the spell on itself on a success" — on itself, not on everyone. */
  it('ends the effect on that target when the save succeeds', () => {
    const after = advanceTo(held(), 2, CERTAIN);
    const state = fold('seed', after);
    expect(conditionsOf(state, 'goblin')).not.toContain('paralyzed');
    expect(conditionsOf(state, 'goblin')).not.toContain('incapacitated');
    // The caster keeps concentrating: the spell ended on the target, not on them.
    expect(state.creatures.wizard!.concentration).toMatchObject({ spell: 'Hold Person' });
  });

  it('leaves a second target held', () => {
    const both = run(held(), (s) =>
      applySpellEffect(s, id('ogre'), 'paralyzed', id('wizard'), {
        repeatSave: {
          at: 'end-of-turn',
          of: id('ogre'),
          ability: 'wis',
          dc: 13,
          onSuccess: 'end-on-target',
          label: 'Wisdom save vs Hold Person',
        },
      }),
    );
    // Two advances: the wizard's turn, then the goblin's, which frees it.
    const state = fold('seed', advanceTo(both, 2, CERTAIN));
    expect(conditionsOf(state, 'goblin')).not.toContain('paralyzed');
    expect(conditionsOf(state, 'ogre')).toContain('paralyzed');
  });

  it('leaves an independent effect on the same creature alone', () => {
    const also = run(held(), (s) => applyConditionTo(s, id('goblin'), 'poisoned', 'a bad mushroom'));
    const state = fold('seed', advanceTo(also, 2, CERTAIN));
    expect(conditionsOf(state, 'goblin')).not.toContain('paralyzed');
    expect(conditionsOf(state, 'goblin')).toContain('poisoned');
  });

  /** The other outcome the hook supports: some effects end outright. */
  it('ends the whole casting when the outcome says so', () => {
    const cast = run(fight(), (s) =>
      castSpell(s, id('wizard'), {
        spell: 'Dominate Person',
        level: 2,
        concentration: true,
        slotLevel: 2,
      }),
    );
    const dominated = run(cast, (s) =>
      applySpellEffect(s, id('goblin'), 'charmed', id('wizard'), {
        repeatSave: {
          at: 'end-of-turn',
          of: id('goblin'),
          ability: 'wis',
          dc: 13,
          onSuccess: 'end-casting',
          label: 'Wisdom save vs Dominate Person',
        },
      }),
    );

    const state = fold('seed', advanceTo(dominated, 2, CERTAIN));
    expect(conditionsOf(state, 'goblin')).not.toContain('charmed');
    expect(state.creatures.wizard!.concentration).toBeNull();
  });

  it('takes the save at the start of a turn when the trigger says so', () => {
    const cast = run(fight(), (s) =>
      castSpell(s, id('wizard'), {
        spell: 'Ensnaring Strike',
        level: 1,
        concentration: true,
        slotless: 'innate',
      }),
    );
    const snared = run(cast, (s) =>
      applySpellEffect(s, id('goblin'), 'restrained', id('wizard'), {
        repeatSave: {
          at: 'start-of-turn',
          of: id('goblin'),
          ability: 'str',
          dc: 13,
          onSuccess: 'end-on-target',
          label: 'Strength save vs Ensnaring Strike',
        },
      }),
    );

    // One advance moves from the wizard to the goblin, whose turn now begins.
    const state = fold('seed', advanceTo(snared, 1, CERTAIN));
    expect(conditionsOf(state, 'goblin')).not.toContain('restrained');
  });
});

describe('the pending save cannot be forgotten', () => {
  /**
   * The whole point. Advancing without a generator leaves the save in state
   * rather than skipping it, and the engine will not advance again until it is
   * resolved — so forgetting stops the game rather than quietly losing a rule.
   */
  it('persists the save when no generator is supplied', () => {
    const after = [...advanceTo(held(), 1), ...unwrap(resolveTurn(fold('seed', advanceTo(held(), 1))), 'turn').events];
    const pending = pendingSavesOf(fold('seed', after));

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      target: id('goblin'),
      ability: 'wis',
      dc: 13,
      label: 'Wisdom save vs Hold Person',
    });
    // And the effect is untouched until somebody rolls.
    expect(conditionsOf(fold('seed', after), 'goblin')).toContain('paralyzed');
  });

  it('refuses to advance another turn while a save is outstanding', () => {
    const first = advanceTo(held(), 1);
    const deferred = [...first, ...unwrap(resolveTurn(fold('seed', first)), 'turn').events];

    const result = resolveTurn(fold('seed', deferred));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('saves_pending');
  });

  it('resolves a deferred save later, with the same outcome', () => {
    const first = advanceTo(held(), 1);
    const deferred = [...first, ...unwrap(resolveTurn(fold('seed', first)), 'turn').events];

    const state = fold('seed', deferred);
    const resolved = unwrap(resolvePendingSaves(state, supplyFor(state, CERTAIN)), 'resolve');
    const after = fold('seed', [...deferred, ...resolved.events]);

    expect(resolved.saves).toHaveLength(1);
    expect(conditionsOf(after, 'goblin')).not.toContain('paralyzed');
    expect(pendingSavesOf(after)).toEqual([]);
    // And the turn may now advance.
    expect(isErr(resolveTurn(after, supplyFor(after, DOOMED)))).toBe(false);
  });

  it('survives a reload, because it is derived from the log', () => {
    const first = advanceTo(held(), 1);
    const deferred = [...first, ...unwrap(resolveTurn(fold('seed', first)), 'turn').events];

    const revived = fold('seed', JSON.parse(JSON.stringify(deferred)) as GameEvent[]);
    expect(pendingSavesOf(revived)).toHaveLength(1);

    const resolved = unwrap(resolvePendingSaves(revived, supplyFor(revived, CERTAIN)), 'resolve');
    expect(conditionsOf(fold('seed', [...deferred, ...resolved.events]), 'goblin')).not.toContain(
      'paralyzed',
    );
  });

  it('has nothing to resolve when nothing is pending', () => {
    const state = fold('seed', held());
    const resolved = unwrap(resolvePendingSaves(state, supplyFor(state, CERTAIN)), 'resolve');
    expect(resolved.events).toEqual([]);
    expect(resolved.saves).toEqual([]);
  });
});

describe('a trigger fires once', () => {
  it('raises one save per turn, not one per advance of the log', () => {
    const state = fold('seed', advanceTo(held(), 1));
    const outcome = unwrap(resolveTurn(state, supplyFor(state, DOOMED)), 'turn');
    expect(outcome.saves).toHaveLength(1);
    expect(outcome.events.filter((e) => e.type === 'effect-save-resolved')).toHaveLength(1);
  });

  it('raises it again on the next turn, because the SRD repeats it', () => {
    // Three more advances brings the goblin's turn round again.
    const twice = advanceTo(held(), 5, DOOMED);
    const labels = twice
      .filter((e) => e.type === 'roll-recorded')
      .map((e) => (e.type === 'roll-recorded' ? e.label : ''));
    expect(labels.filter((l) => l === 'Wisdom save vs Hold Person')).toHaveLength(2);
  });

  it('stops raising it once the effect is gone', () => {
    const freed = advanceTo(held(), 2, CERTAIN);
    const later = advanceTo(freed, 3, DOOMED);
    const labels = later
      .filter((e) => e.type === 'roll-recorded')
      .map((e) => (e.type === 'roll-recorded' ? e.label : ''));
    expect(labels.filter((l) => l === 'Wisdom save vs Hold Person')).toHaveLength(1);
  });

  /** Concentration ending takes the effect and its hook with it. */
  it('drops a pending save when the casting ends first', () => {
    const first = advanceTo(held(), 1);
    const deferred = [...first, ...unwrap(resolveTurn(fold('seed', first)), 'turn').events];
    expect(pendingSavesOf(fold('seed', deferred))).toHaveLength(1);

    const dropped = run(deferred, (s) => endConcentration(s, id('wizard'), 'voluntary'));
    expect(pendingSavesOf(fold('seed', dropped))).toEqual([]);
    expect(conditionsOf(fold('seed', dropped), 'goblin')).not.toContain('paralyzed');
  });
});

describe('turn hooks replay', () => {
  const played = () => advanceTo(held(), 4, DOOMED);

  it('folds to the same state twice', () => {
    const log = played();
    expect(fold('seed', log)).toEqual(fold('seed', log));
  });

  it('survives JSON with its hooks and pendings intact', () => {
    const log = played();
    const state = fold('seed', log);
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);
  });

  it('replays prefix by prefix without diverging', () => {
    const log = played();
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('produces the same log when the script is replayed', () => {
    expect(JSON.stringify(played())).toBe(JSON.stringify(played()));
  });
});
