/**
 * A fight ends.
 *
 * `combat-ended` had exactly one producer in the whole engine — the branch in
 * `removeCreatureEverywhere` that fires when a removal takes the *last*
 * combatant out of the order — and no tool removes a creature. So a session
 * that rolled Initiative once could never close the fight, and with the clock
 * refusal beside it (`clock-in-combat.test.ts`) could never rest either: the
 * two are one decision and ship together.
 *
 * The owner's ruling is the whole of the rule:
 *
 * > A fight ends when no hostile combatant remains or the hostiles surrender.
 * > A flight is a prompt, not an end: the players are offered the choice to
 * > let the enemy go before combat closes, because many tables want to finish
 * > them.
 *
 * Which is three endings and one refusal, and the file is laid out as them.
 */
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { beginRest, endRest, SHORT_REST } from './rest.js';
import {
  advanceTime,
  damageCreature,
  declareCreatureSide,
  endCombat,
  removeCreatureEverywhere,
} from './commands.js';

const id = (s: string) => asCharacterId(s);
const KNIGHT = id('knight');
const GOBLIN = id('goblin');
const HOBGOBLIN = id('hobgoblin');

const PARTY = 'the party';
const RAIDERS = 'the raiders';

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const add = (who: CharacterId, side: string | undefined): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  ...(side === undefined ? {} : { side }),
});

/** A knight and two raiders, with Initiative rolled and everybody on a side. */
const fight = (): readonly GameEvent[] => [
  add(KNIGHT, PARTY),
  add(GOBLIN, RAIDERS),
  add(HOBGOBLIN, RAIDERS),
  {
    type: 'combat-started',
    combatants: [
      { id: KNIGHT, initiative: 20, speed: 30 },
      { id: HOBGOBLIN, initiative: 12, speed: 30 },
      { id: GOBLIN, initiative: 8, speed: 30 },
    ],
  },
];

const run = (
  log: readonly GameEvent[],
  command: (state: GameState) => Result<readonly GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

/** Everything that drops a creature to 0, which is what "falling" means here. */
const felled = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] =>
  run(log, (s) => damageCreature(s, who, { amount: 40, source: 'the knight’s sword' }));

const codeOf = (out: Result<unknown>): string => (isErr(out) ? out.code : 'ok');

describe('a fight ends when no hostile combatant remains', () => {
  it('refuses when there is no fight to end', () => {
    const peace = fold('seed', [add(KNIGHT, PARTY), add(GOBLIN, RAIDERS)]);
    expect(codeOf(endCombat(peace, { kind: 'defeated' }))).toBe('not_in_combat');
  });

  /**
   * And that refusal is the reducer's, which is the discipline `commands/
   * scene.ts` holds itself to: a command here declines to write exactly what
   * the fold would call corrupt. A fight that was never running cannot end,
   * and a log saying it did contradicts itself.
   *
   * Its *other* refusals are deliberately not the reducer's and cannot be —
   * `removeCreatureEverywhere` writes a `combat-ended` without asking whose
   * side anybody was on, so a fold that demanded it would refuse an event the
   * engine itself emits.
   */
  it('and the fold calls the forged event corrupt', () => {
    const forged: readonly GameEvent[] = [add(KNIGHT, PARTY), { type: 'combat-ended' }];
    expect(() => fold('seed', forged)).toThrow();
    // Twice over is the same claim: the second one has no fight either.
    const twice: readonly GameEvent[] = [...fight(), { type: 'combat-ended' }, { type: 'combat-ended' }];
    expect(() => fold('seed', twice)).toThrow();
  });

  it('refuses while a hostile is still on its feet, and names who', () => {
    const half = felled(fight(), GOBLIN);
    const refused = endCombat(fold('seed', half), { kind: 'defeated' });
    expect(codeOf(refused)).toBe('hostiles_remain');
    expect(isErr(refused) ? refused.reason : '').toContain(HOBGOBLIN);
  });

  it('ends when the last one falls', () => {
    const over = felled(felled(fight(), GOBLIN), HOBGOBLIN);
    const ended = run(over, (s) => endCombat(s, { kind: 'defeated' }));

    expect(fold('seed', over).combat).not.toBeNull();
    expect(fold('seed', ended).combat).toBeNull();
  });

  /**
   * And what it concluded is **pinned into the event**, so a reader of the log
   * is told why the fight closed rather than left to work it out from the hit
   * points of whoever happened to still be in the order.
   */
  it('pins how the fight ended into the event it writes', () => {
    const over = felled(felled(fight(), GOBLIN), HOBGOBLIN);
    const events = unwrap(endCombat(fold('seed', over), { kind: 'defeated' }), 'end');
    expect(events.map((e) => e.type)).toEqual(['combat-ended']);
    expect(events[0]).toMatchObject({ type: 'combat-ended', ending: { kind: 'defeated' } });
  });

  /**
   * A creature nobody has put on a side is nobody's enemy and nobody's ally —
   * `side` is declared, exactly as cover and sight are. So a fight holding one
   * cannot be *known* to be over, and the engine asks rather than deciding a
   * missing fact either way.
   */
  it('asks when nobody has said whose side a standing combatant is on', () => {
    const unsided: readonly GameEvent[] = [
      add(KNIGHT, PARTY),
      add(GOBLIN, undefined),
      {
        type: 'combat-started',
        combatants: [
          { id: KNIGHT, initiative: 20, speed: 30 },
          { id: GOBLIN, initiative: 8, speed: 30 },
        ],
      },
    ];
    const asked = endCombat(fold('seed', unsided), { kind: 'defeated' });
    expect(codeOf(asked)).toBe('undeclared_side');
    expect(isErr(asked) ? asked.kind : 'ok').toBe('needs-context');
    expect(isErr(asked) ? asked.reason : '').toContain('declareCreatureSide');

    // And the answer settles it: the same fight, with the fact supplied.
    const said = run(unsided, (s) => declareCreatureSide(s, GOBLIN, RAIDERS));
    expect(codeOf(endCombat(fold('seed', said), { kind: 'defeated' }))).toBe('hostiles_remain');
  });

  /**
   * Bodies cleared off the board are the other way a side stops standing, and
   * it is the same question asked of a shorter order: `removeCreatureEverywhere`
   * ends the fight itself only when it takes the *last* combatant, so a party
   * that tidies up after itself still needs this command.
   */
  it('ends once the last hostile has been carried out of the order', () => {
    const cleared = run(felled(felled(fight(), GOBLIN), HOBGOBLIN), (s) =>
      removeCreatureEverywhere(s, GOBLIN),
    );
    const andTheOther = run(cleared, (s) => removeCreatureEverywhere(s, HOBGOBLIN));
    expect(fold('seed', andTheOther).combat).not.toBeNull();

    const ended = run(andTheOther, (s) => endCombat(s, { kind: 'defeated' }));
    expect(fold('seed', ended).combat).toBeNull();
  });
});

describe('or when the hostiles surrender', () => {
  it('ends on a stated surrender, with nobody hurt', () => {
    const ended = run(fight(), (s) => endCombat(s, { kind: 'surrender', side: RAIDERS }));
    const after = fold('seed', ended);
    expect(after.combat).toBeNull();
    // Nothing happened to them: a surrender is a fact about the fight, not
    // damage, and the engine writes exactly the one event.
    expect(after.creatures[GOBLIN]!.vitals.hp).toBe(40);
    expect(ended.at(-1)).toMatchObject({ ending: { kind: 'surrender', side: RAIDERS } });
  });

  /**
   * A surrender by nobody is not a surrender. Without this the command is a
   * back door: any fight could be closed by naming a side that was never in it.
   */
  it('refuses a surrender from a side nobody standing here is on', () => {
    const refused = endCombat(fold('seed', fight()), { kind: 'surrender', side: 'the watch' });
    expect(codeOf(refused)).toBe('no_such_side');
  });

  it('refuses a surrender from a side that has already fallen', () => {
    const over = felled(felled(fight(), GOBLIN), HOBGOBLIN);
    expect(codeOf(endCombat(fold('seed', over), { kind: 'surrender', side: RAIDERS }))).toBe(
      'no_such_side',
    );
  });

  /**
   * And a yielding side does not close a fight the rest of the room is still
   * having: the surrender takes those combatants out of the reckoning, and the
   * same question is then asked of who is left.
   */
  it('does not end a three-cornered fight because one side yielded', () => {
    const threeWays: readonly GameEvent[] = [
      ...fight(),
      add(id('cultist'), 'the cult'),
      { type: 'combatant-joined', combatant: { id: id('cultist'), initiative: 4, speed: 30 } },
    ];
    expect(codeOf(endCombat(fold('seed', threeWays), { kind: 'surrender', side: RAIDERS }))).toBe(
      'hostiles_remain',
    );
  });
});

describe('a flight is a prompt, not an end', () => {
  /**
   * The owner's ruling, and the reason it is a refusal rather than an end:
   * many tables want to finish them. The engine has no opinion about which,
   * and says exactly what would settle it.
   */
  it('does not close the fight because the hostiles ran', () => {
    const refused = endCombat(fold('seed', fight()), { kind: 'flight', side: RAIDERS });
    expect(codeOf(refused)).toBe('flight_not_elected');
    expect(isErr(refused) ? refused.reason : '').toContain('letThemGo');
    // A refused command emits nothing, so the fight is exactly where it was.
    expect(fold('seed', fight()).combat).not.toBeNull();
  });

  it('closes it once the party elects to let them go', () => {
    const ended = run(fight(), (s) =>
      endCombat(s, { kind: 'flight', side: RAIDERS, letThemGo: true }),
    );
    expect(fold('seed', ended).combat).toBeNull();
    expect(ended.at(-1)).toMatchObject({ ending: { kind: 'flight', side: RAIDERS } });
  });

  /** And the election is not a skeleton key: the rest of the room still counts. */
  it('refuses an election over a side nobody standing here is on', () => {
    const refused = endCombat(fold('seed', fight()), {
      kind: 'flight',
      side: 'the watch',
      letThemGo: true,
    });
    expect(codeOf(refused)).toBe('no_such_side');
  });

  /**
   * `letThemGo: false` is the table having been asked and having said no,
   * which is not an ending at all — and it must not read as one.
   */
  it('treats a refused election as no election', () => {
    const refused = endCombat(fold('seed', fight()), {
      kind: 'flight',
      side: RAIDERS,
      letThemGo: false,
    });
    expect(codeOf(refused)).toBe('flight_not_elected');
  });
});

describe('the round trip the two rules open together', () => {
  /**
   * The whole point of shipping the refusal and the door in one review. A
   * session that rolls Initiative once can move the clock only six seconds at
   * a time through `resolveTurn` until something ends the fight — and a Short
   * Rest is an hour.
   */
  it('a rest is impossible inside the fight and reachable once it is over', () => {
    const hurt = run(fight(), (s) =>
      damageCreature(s, KNIGHT, { amount: 12, source: 'a spear' }),
    );

    // Inside the fight: the clock belongs to the turn order.
    expect(codeOf(advanceTime(fold('seed', hurt), SHORT_REST, 'catching our breath'))).toBe(
      'in_combat',
    );

    const over = run(hurt, (s) => endCombat(s, { kind: 'surrender', side: RAIDERS }));
    const lying = run(over, (s) => beginRest(s, KNIGHT, 'short'));
    const anHour = run(lying, (s) => advanceTime(s, SHORT_REST, 'an hour in the vestry'));

    const settled = unwrap(endRest(fold('seed', anHour), KNIGHT), 'rest');
    expect(settled.benefit).toBe('short');
    expect(fold('seed', [...anHour, ...settled.events]).elapsed).toBe(SHORT_REST);
  });
});

describe('ending a fight is idempotent under its command id', () => {
  it('a retry under the same id changes nothing the first did not', () => {
    const first = unwrap(
      endCombat(fold('seed', fight()), { kind: 'surrender', side: RAIDERS }, { commandId: 'q' }),
      'first',
    );
    const after = fold('seed', [...fight(), ...first]);

    const retry = unwrap(
      endCombat(after, { kind: 'surrender', side: RAIDERS }, { commandId: 'q' }),
      'retry',
    );
    expect(retry).toEqual([]);
    expect(fold('seed', [...fight(), ...first, ...retry])).toEqual(after);
  });

  /** A duplicate is answered as one; a *different* ending under that id is not. */
  it('refuses the same id sent with a different ending', () => {
    const first = unwrap(
      endCombat(fold('seed', fight()), { kind: 'surrender', side: RAIDERS }, { commandId: 'q' }),
      'first',
    );
    const after = fold('seed', [...fight(), ...first]);
    const other = endCombat(
      after,
      { kind: 'flight', side: RAIDERS, letThemGo: true },
      { commandId: 'q' },
    );
    expect(isErr(other)).toBe(true);
  });
});
