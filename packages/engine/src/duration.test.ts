import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { HOUR, ROUND, hours, minutes, rounds } from './clock.js';
import { conditionInstanceId } from './conditions.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { castingSource } from './spells.js';
import {
  endOfNextTurn,
  forSeconds,
  indefinite,
  resolveDuration,
  startOfNextTurn,
  timeView,
} from './duration.js';
import {
  applyConditionTo,
  applySpellEffect,
  castSpell,
  endConcentration,
  nextCastingId,
} from './commands.js';

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

const table = (): GameEvent[] => [
  add('wizard'),
  add('cleric'),
  add('goblin'),
  {
    type: 'resource-pool-declared',
    id: id('wizard'),
    pool: { key: spellSlotKey(2), label: 'l2', max: 2, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: id('cleric'),
    pool: { key: spellSlotKey(2), label: 'l2', max: 1, recovers: 'long-rest' },
  },
];

const fight = (): GameEvent[] => [
  ...table(),
  {
    type: 'combat-started',
    combatants: [
      { id: id('wizard'), initiative: 20, speed: 30 },
      { id: id('goblin'), initiative: 10, speed: 30 },
      { id: id('cleric'), initiative: 5, speed: 30 },
    ],
  },
];

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): { log: GameEvent[]; state: GameState } => {
  const events = unwrap(command(fold('seed', log)), 'command');
  const next = [...log, ...events];
  return { log: next, state: fold('seed', next) };
};

const tick = (n: number): GameEvent[] => Array.from({ length: n }, () => ({ type: 'turn-advanced' }));
const clock = (seconds: number): GameEvent => ({ type: 'time-advanced', seconds, reason: 'time' });

const conditionsOf = (state: GameState, who: string) =>
  state.creatures[who]?.conditions.conditions ?? [];

describe('elapsed deadlines and turn deadlines are different things', () => {
  /**
   * A round is six seconds, so it is tempting to read "until the start of your
   * next turn" as "six seconds". It is not. Where that moment falls depends on
   * where the anchor sits in the Initiative order and on whose turn the effect
   * began — an effect created on the goblin's turn ends at the wizard's next
   * turn start, which may be one second of game time away or five. And outside
   * combat there are no turns at all, so the question has no answer.
   *
   * Two types rather than one, with a conversion that can refuse, is what keeps
   * the two from being quietly swapped.
   */
  it('refuses a turn deadline outside combat', () => {
    const view = timeView(fold('seed', table()));
    const result = resolveDuration(view, startOfNextTurn(id('wizard')));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('no_turns');

    expect(isErr(resolveDuration(view, endOfNextTurn(id('wizard'))))).toBe(true);
    // Elapsed time needs no combat.
    expect(isErr(resolveDuration(view, forSeconds(minutes(1))))).toBe(false);
  });

  it('refuses a turn deadline anchored to a creature outside the fight', () => {
    const log: GameEvent[] = [
      ...table(),
      { type: 'combat-started', combatants: [{ id: id('goblin'), initiative: 10, speed: 30 }] },
    ];
    const result = resolveDuration(timeView(fold('seed', log)), startOfNextTurn(id('wizard')));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_in_combat');
  });

  it('reads an elapsed deadline off the clock', () => {
    const state = fold('seed', [...table(), clock(hours(2))]);
    const deadline = unwrap(resolveDuration(timeView(state), forSeconds(minutes(10))), 'd');
    expect(deadline).toEqual({ kind: 'elapsed', at: hours(2) + minutes(10) });
  });

  it('never expires an indefinite duration', () => {
    const state = fold('seed', [...table(), clock(hours(500))]);
    expect(unwrap(resolveDuration(timeView(state), indefinite), 'd')).toEqual({
      kind: 'indefinite',
    });
  });

  it('refuses a duration that is not a whole number of seconds', () => {
    const view = timeView(fold('seed', table()));
    expect(isErr(resolveDuration(view, forSeconds(-1)))).toBe(true);
    expect(isErr(resolveDuration(view, forSeconds(1.5)))).toBe(true);
  });
});

describe('an effect that lasts a span of time', () => {
  const hexed = (seconds: number) =>
    run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'a slow venom', [], forSeconds(seconds)),
    );

  it('stands until its moment arrives', () => {
    const { log } = hexed(minutes(1));
    expect(conditionsOf(fold('seed', [...log, clock(minutes(1) - 1)]), 'goblin')).toContain(
      'poisoned',
    );
  });

  it('ends the instant it does', () => {
    const { log } = hexed(minutes(1));
    expect(conditionsOf(fold('seed', [...log, clock(minutes(1))]), 'goblin')).not.toContain(
      'poisoned',
    );
  });

  it('ends when combat carries the clock past it', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'a slow venom', [], forSeconds(rounds(2))),
    );
    // Three combatants, so a round is three turns.
    expect(conditionsOf(fold('seed', [...log, ...tick(3)]), 'goblin')).toContain('poisoned');
    expect(conditionsOf(fold('seed', [...log, ...tick(6)]), 'goblin')).not.toContain('poisoned');
  });

  it('leaves an undated effect standing forever', () => {
    const { log } = run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'blinded', 'a curse'),
    );
    expect(conditionsOf(fold('seed', [...log, clock(hours(500))]), 'goblin')).toContain('blinded');
  });
});

describe('an effect that lasts until a turn', () => {
  /**
   * SRD Dodge: "until the start of your next turn". Created on the wizard's own
   * turn, so it survives everyone else's turns and ends when the wizard's comes
   * round again.
   */
  it('ends at the start of the anchor next turn', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], startOfNextTurn(id('wizard'))),
    );

    // Goblin's turn, then cleric's: still running.
    expect(conditionsOf(fold('seed', [...log, ...tick(2)]), 'goblin')).toContain('restrained');
    // Back round to the wizard: gone.
    expect(conditionsOf(fold('seed', [...log, ...tick(3)]), 'goblin')).not.toContain('restrained');
  });

  /**
   * SRD Chill Touch: "until the end of your next turn". A full round longer
   * than the start-of-turn version, and the difference is exactly why the two
   * are separate deadlines rather than one with a flag.
   */
  it('ends at the end of the anchor next turn', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], endOfNextTurn(id('wizard'))),
    );

    // The wizard's next turn begins: still running, unlike the start version.
    expect(conditionsOf(fold('seed', [...log, ...tick(3)]), 'goblin')).toContain('restrained');
    // It ends when that turn does.
    expect(conditionsOf(fold('seed', [...log, ...tick(4)]), 'goblin')).not.toContain('restrained');
  });

  /**
   * Anchored to someone else, and created on *their* turn rather than the
   * caster's — a Reaction. "Your next turn" is still the anchor's next turn.
   */
  it('anchors to the creature named, not the one affected', () => {
    const onGoblinTurn = [...fight(), ...tick(1)];
    const { log } = run(onGoblinTurn, (s) =>
      applyConditionTo(s, id('wizard'), 'frightened', 'a shriek', [], startOfNextTurn(id('cleric'))),
    );

    // Cleric acts next; the effect ends as their turn begins.
    expect(conditionsOf(fold('seed', log), 'wizard')).toContain('frightened');
    expect(conditionsOf(fold('seed', [...log, ...tick(1)]), 'wizard')).not.toContain('frightened');
  });

  /**
   * Two effects laid down at the same instant with different anchors end at
   * different moments. Order is wizard, goblin, cleric, and both are created
   * on the wizard's turn: the cleric's next turn is two turns away, the
   * wizard's is a full round.
   */
  it('does not confuse the two anchors', () => {
    const a = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], startOfNextTurn(id('cleric'))),
    );
    const b = run(a.log, (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'a fume', [], startOfNextTurn(id('wizard'))),
    );

    // The cleric's turn comes round first and ends only what it anchors.
    const midway = fold('seed', [...b.log, ...tick(2)]);
    expect(conditionsOf(midway, 'goblin')).not.toContain('restrained');
    expect(conditionsOf(midway, 'goblin')).toContain('poisoned');

    // Then the wizard's, which ends the other.
    expect(conditionsOf(fold('seed', [...b.log, ...tick(3)]), 'goblin')).not.toContain('poisoned');
  });

  /**
   * Turn-anchored timing is combat-scoped: with no turns left there is no
   * moment for the effect to end at, and an effect that can never expire is
   * worse than one that ends when the fight does.
   */
  it('ends when the fight does', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], startOfNextTurn(id('wizard'))),
    );
    const after = fold('seed', [...log, { type: 'combat-ended' }]);
    expect(conditionsOf(after, 'goblin')).not.toContain('restrained');
  });

  it('ends when its anchor leaves the fight', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'restrained', 'a snare', [], startOfNextTurn(id('cleric'))),
    );
    const after = fold('seed', [...log, { type: 'combatant-removed', id: id('cleric') }]);
    expect(conditionsOf(after, 'goblin')).not.toContain('restrained');
  });

  /** An elapsed deadline has nothing to do with the fight and survives it. */
  it('leaves an elapsed deadline alone when combat ends', () => {
    const { log } = run(fight(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(HOUR)),
    );
    const after = fold('seed', [...log, { type: 'combat-ended' }]);
    expect(conditionsOf(after, 'goblin')).toContain('poisoned');
  });
});

describe('expiry ends one effect, not every effect like it', () => {
  /**
   * The point of expiring by instance. Two castings of the same spell on the
   * same target, with different durations: the first to run out takes its own
   * paralysis and leaves the other standing.
   */
  it('expires one casting and leaves the other running', () => {
    const a = run(table(), (s) =>
      castSpell(s, id('wizard'), {
        spell: 'Hold Person',
        level: 2,
        concentration: true,
        slotLevel: 2,
      }),
    );
    const b = run(a.log, (s) =>
      castSpell(s, id('cleric'), {
        spell: 'Hold Person',
        level: 2,
        concentration: true,
        slotLevel: 2,
      }),
    );

    const ea = run(b.log, (s) =>
      applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard'), [], forSeconds(minutes(1))),
    );
    const eb = run(ea.log, (s) =>
      applySpellEffect(s, id('goblin'), 'paralyzed', id('cleric'), [], forSeconds(hours(1))),
    );

    const after = fold('seed', [...eb.log, clock(minutes(1))]);
    const reasons = after.creatures.goblin!.conditions.instances
      .filter((i) => i.condition === 'paralyzed')
      .map((i) => i.source);

    expect(reasons).toEqual([castingSource('Hold Person', 'cast:2')]);
  });

  it('leaves an unrelated effect on the same creature alone', () => {
    const a = run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(minutes(1))),
    );
    const b = run(a.log, (s) => applyConditionTo(s, id('goblin'), 'blinded', 'ash'));

    const after = fold('seed', [...b.log, clock(minutes(1))]);
    expect(conditionsOf(after, 'goblin')).not.toContain('poisoned');
    expect(conditionsOf(after, 'goblin')).toContain('blinded');
  });

  it('drops what an expiring condition carried with it', () => {
    const { log } = run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'stunned', 'a bell', [], forSeconds(rounds(1))),
    );
    expect(conditionsOf(fold('seed', log), 'goblin')).toContain('incapacitated');

    const after = fold('seed', [...log, clock(rounds(1))]);
    expect(conditionsOf(after, 'goblin')).not.toContain('stunned');
    expect(conditionsOf(after, 'goblin')).not.toContain('incapacitated');
  });

  /** Reapplying from the same source refreshes the deadline rather than adding one. */
  it('replaces the deadline when the same effect is reapplied', () => {
    const first = run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(rounds(1))),
    );
    const again = run(first.log, (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(hours(1))),
    );

    expect(Object.keys(again.state.timers)).toHaveLength(1);
    expect(conditionsOf(fold('seed', [...again.log, clock(minutes(1))]), 'goblin')).toContain(
      'poisoned',
    );
  });
});

describe('a casting with a maximum duration', () => {
  /** SRD: "Concentration, up to 1 minute" is a cap as well as a Concentration. */
  const held = () =>
    run(table(), (s) =>
      castSpell(s, id('wizard'), {
        spell: 'Hold Person',
        level: 2,
        concentration: true,
        slotLevel: 2,
        duration: forSeconds(minutes(1)),
      }),
    );

  it('ends the whole casting when the cap is reached', () => {
    const first = held();
    const effect = run(first.log, (s) =>
      applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard')),
    );

    const during = fold('seed', [...effect.log, clock(minutes(1) - ROUND)]);
    expect(during.creatures.wizard!.concentration).not.toBeNull();

    const after = fold('seed', [...effect.log, clock(minutes(1))]);
    expect(after.creatures.wizard!.concentration).toBeNull();
    expect(conditionsOf(after, 'goblin')).not.toContain('paralyzed');
  });

  it('forgets the cap once Concentration is broken early', () => {
    const first = held();
    const dropped = run(first.log, (s) => endConcentration(s, id('wizard'), 'voluntary'));
    expect(Object.keys(dropped.state.timers)).toHaveLength(0);
  });
});

describe('a casting nobody is concentrating on', () => {
  /**
   * SRD Blindness/Deafness runs for a minute and needs no Concentration. Its
   * effects still belong to their casting, and the casting still has a moment
   * to stop at — the deadline does the ending that a broken Concentration
   * would otherwise have done.
   */
  it('still ends its effects when its minute runs out', () => {
    const before = fold('seed', table());
    const castingId = nextCastingId(before);

    const cast = run(table(), (s) =>
      castSpell(s, id('wizard'), {
        spell: 'Blindness/Deafness',
        level: 2,
        slotLevel: 2,
        duration: forSeconds(minutes(1)),
      }),
    );
    const blinded = run(cast.log, (s) =>
      applyConditionTo(
        s,
        id('goblin'),
        'blinded',
        castingSource('Blindness/Deafness', castingId),
      ),
    );
    const unrelated = run(blinded.log, (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'a bad mushroom'),
    );

    expect(unrelated.state.creatures.wizard!.concentration).toBeNull();
    expect(conditionsOf(unrelated.state, 'goblin')).toContain('blinded');

    const after = fold('seed', [...unrelated.log, clock(minutes(1))]);
    expect(conditionsOf(after, 'goblin')).not.toContain('blinded');
    expect(conditionsOf(after, 'goblin')).toContain('poisoned');
    expect(Object.keys(after.timers)).toHaveLength(0);
  });
});

describe('durations survive a round trip', () => {
  const played = (): GameEvent[] => {
    const cast = run(fight(), (s) =>
      castSpell(s, id('wizard'), {
        spell: 'Hold Person',
        level: 2,
        concentration: true,
        slotLevel: 2,
        duration: forSeconds(minutes(1)),
      }),
    );
    const held = run(cast.log, (s) =>
      applySpellEffect(s, id('goblin'), 'paralyzed', id('wizard')),
    );
    const dodge = run(held.log, (s) =>
      applyConditionTo(s, id('cleric'), 'restrained', 'a snare', [], startOfNextTurn(id('wizard'))),
    );
    return [...dodge.log, ...tick(1)];
  };

  it('folds to the same state twice', () => {
    const log = played();
    expect(fold('seed', log)).toEqual(fold('seed', log));
  });

  it('survives JSON with its deadlines intact', () => {
    const state = fold('seed', played());
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);
    expect(Object.keys(revived.timers).sort()).toEqual(Object.keys(state.timers).sort());
  });

  it('expires correctly after a restore', () => {
    const log = played();
    const restored = JSON.parse(JSON.stringify(log)) as GameEvent[];
    const after = fold('seed', [...restored, ...tick(2), clock(minutes(1))]);

    expect(after.creatures.cleric!.conditions.conditions).not.toContain('restrained');
    expect(after.creatures.wizard!.concentration).toBeNull();
    expect(after.creatures.goblin!.conditions.conditions).not.toContain('paralyzed');
    expect(Object.keys(after.timers)).toHaveLength(0);
  });

  it('replays prefix by prefix to the same place', () => {
    const log = played();
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('keeps the timer keys stable however the effects were ordered', () => {
    const a = run(table(), (s) => applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(HOUR)));
    const b = run(a.log, (s) => applyConditionTo(s, id('cleric'), 'blinded', 'ash', [], forSeconds(HOUR)));

    const x = run(table(), (s) => applyConditionTo(s, id('cleric'), 'blinded', 'ash', [], forSeconds(HOUR)));
    const y = run(x.log, (s) => applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(HOUR)));

    expect(JSON.stringify(b.state.timers)).toBe(JSON.stringify(y.state.timers));
  });

  it('names the instance it will end', () => {
    const { state } = run(table(), (s) =>
      applyConditionTo(s, id('goblin'), 'poisoned', 'venom', [], forSeconds(HOUR)),
    );
    const timer = Object.values(state.timers)[0];
    expect(timer?.target).toEqual({
      kind: 'condition',
      on: id('goblin'),
      instance: conditionInstanceId('poisoned', 'venom'),
    });
  });
});
