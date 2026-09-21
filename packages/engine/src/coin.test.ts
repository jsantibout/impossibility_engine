import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, isNeedsContext, type Result, expect as unwrap } from '@ie/shared';
import { fold, type GameEvent, type GameState } from './events.js';
import { changeCoins, coinsOf, purchaseItem } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { CorruptLogError } from './fold/common.js';

/**
 * A purse that can be filled.
 *
 * `coins-changed` has existed since creation had a starting purse, and the
 * fold has always accepted a delta in either direction — but the only two
 * things that ever wrote one were `createCharacter` and `purchaseItem`, and
 * the second only ever wrote a **negative** one. So the money in the game was
 * whatever a character was born with, monotonically decreasing, and the shops
 * the engine prices in full were reachable exactly once.
 *
 * The evidence that this was a hole rather than a choice is in the test suite
 * itself: `invariants.test.ts` and `item-instances.test.ts` each hand-write a
 * raw positive `coins-changed` into a log, because no command would produce
 * one and a test that needed a rich character had no other way to get one.
 *
 * **One command, signed, because the log has one signed event.** "Money in or
 * out, in copper. Negative spends" is the event's own comment, and splitting
 * the directions at the command would invent an asymmetry the log does not
 * have. A toll buys no item, a bribe has no catalogue row and a thief leaves
 * no receipt, so `purchaseItem` cannot stand in for the other direction: it
 * refuses an id the catalogue does not hold, and there is no fiction to buy.
 *
 * **The overdraw is the command's refusal and never the fold's.** The reducer
 * throws `CorruptLogError` on a purse below zero, which is the right answer to
 * a corrupt log and the wrong answer to a DM who asked for a bigger bribe than
 * the party can pay. `not_enough_coin` is a value, exactly as
 * `purchaseItem`'s `cannot_afford` is.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');
const NOBODY = id('nobody');

const barbarian = (): CharacterChoices => ({
  name: 'Grum',
  classId: 'barbarian',
  level: 3,
  speciesId: 'human',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, str: 1 },
  classSkills: ['nature', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  subclassId: 'path-of-the-berserker',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'barbarian:primal-knowledge': ['intimidation'],
  },
  feats: {
    'human:versatile': { featId: 'alert' },
    'soldier:savage-attacker': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const SETUP: readonly GameEvent[] = unwrap(
  createCharacter(SRD_CONTENT, barbarian(), GRUM),
  'create',
);

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(state(log)), 'command')];

/** What the character was born with, which is the only money there has been. */
const BORN_WITH = coinsOf(state(SETUP), GRUM);

describe('a party can be paid', () => {
  it('fills a purse that nothing on either surface could fill', () => {
    const paid = run(SETUP, (s) => changeCoins(s, GRUM, 5_000, 'the reward for the caravan'));
    expect(coinsOf(state(paid), GRUM)).toBe(BORN_WITH + 5_000);
  });

  it('writes the event the fold already had, with the reason the DM gave', () => {
    const emitted = unwrap(
      changeCoins(state(SETUP), GRUM, 5_000, 'the reward for the caravan'),
      'grant',
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: 'coins-changed',
      id: GRUM,
      copper: 5_000,
      source: 'the reward for the caravan',
    });
  });

  /**
   * The point of the whole brief: a purse filled here is spendable there.
   * `purchaseItem` prices the bundle the SRD prints, so the item is a real
   * catalogue row at its real price rather than a fixture.
   */
  it('buys a real item at the price the book prints', () => {
    const chain = SRD_CONTENT.item('chain-mail')!;
    expect(chain.costCp).toBeGreaterThan(BORN_WITH);

    // Too poor, before anybody paid them.
    const broke = purchaseItem(state(SETUP), SRD_CONTENT, GRUM, 'chain-mail');
    expect(isErr(broke) && broke.code).toBe('cannot_afford');

    const paid = run(SETUP, (s) => changeCoins(s, GRUM, chain.costCp!, 'the reward'));
    const bought = run(paid, (s) => purchaseItem(s, SRD_CONTENT, GRUM, 'chain-mail'));

    expect(
      state(bought).creatures.grum!.inventory.some((line) => line.id === 'chain-mail'),
    ).toBe(true);
    expect(coinsOf(state(bought), GRUM)).toBe(BORN_WITH);
  });
});

describe('a party can be robbed', () => {
  it('takes coin away for a toll that buys nothing', () => {
    const tolled = run(SETUP, (s) => changeCoins(s, GRUM, -100, 'the toll at the bridge'));
    expect(coinsOf(state(tolled), GRUM)).toBe(BORN_WITH - 100);
  });

  it('refuses an overdraw as a value, naming what is held', () => {
    const refused = changeCoins(state(SETUP), GRUM, -(BORN_WITH + 1), 'a bribe they cannot pay');
    expect(isErr(refused)).toBe(true);
    if (!isErr(refused)) return;
    expect(refused.code).toBe('not_enough_coin');
    expect(refused.reason).toContain(String(BORN_WITH));
  });

  /**
   * And the refusal is the command's rather than the reducer's. A log that
   * took the purse below zero is a *corrupt* log and the fold is right to
   * throw; a DM asking for more than the party has has made no such mistake,
   * and must not be handed an exception.
   */
  it('never lets the fold be the one to say no', () => {
    const below: readonly GameEvent[] = [
      ...SETUP,
      { type: 'coins-changed', id: GRUM, copper: -(BORN_WITH + 1), source: 'a corrupt log' },
    ];
    expect(() => state(below)).toThrow(CorruptLogError);

    const refused = changeCoins(state(SETUP), GRUM, -(BORN_WITH + 1), 'a bribe');
    expect(isErr(refused)).toBe(true);
  });

  it('allows a purse emptied exactly to nothing', () => {
    const cleaned = run(SETUP, (s) => changeCoins(s, GRUM, -BORN_WITH, 'the thief in the night'));
    expect(coinsOf(state(cleaned), GRUM)).toBe(0);
  });
});

describe('a coin command refuses as a value', () => {
  it('asks rather than refuses for a creature it has never been told about', () => {
    const asked = changeCoins(state(SETUP), NOBODY, 500, 'a patron');
    expect(isNeedsContext(asked)).toBe(true);
    expect(isErr(asked) && asked.code).toBe('unknown_creature');
  });

  it.each([
    ['nothing at all', 0],
    ['a fraction of a copper piece', 12.5],
    ['a number that is not one', Number.NaN],
    ['an infinity', Number.POSITIVE_INFINITY],
  ])('refuses %s', (_why, amount) => {
    const refused = changeCoins(state(SETUP), GRUM, amount, 'a patron');
    expect(isErr(refused)).toBe(true);
    if (!isErr(refused)) return;
    expect(refused.code).toBe('bad_amount');
  });

  it('names the amount it was given, so the caller can see what it sent', () => {
    const refused = changeCoins(state(SETUP), GRUM, 0, 'a patron');
    expect(isErr(refused) && refused.reason).toContain('0');
  });
});

describe('a retried payment pays once', () => {
  it('emits nothing the second time under the same command id', () => {
    const first = unwrap(
      changeCoins(state(SETUP), GRUM, 5_000, 'the reward', 'one-reward'),
      'first',
    );
    const after = state([...SETUP, ...first]);
    const second = unwrap(changeCoins(after, GRUM, 5_000, 'the reward', 'one-reward'), 'second');

    expect(second).toEqual([]);
    expect(coinsOf(after, GRUM)).toBe(BORN_WITH + 5_000);
    expect(coinsOf(state([...SETUP, ...first, ...second]), GRUM)).toBe(BORN_WITH + 5_000);
  });

  /**
   * The stamp is what makes that true, and it is on the `coins-changed` event
   * itself — this command's whole batch is that one event, so there is no
   * sibling to carry it the way `purchaseItem`'s `items-gained` does.
   */
  it('stamps the event, so the fold remembers the command landed', () => {
    const first = unwrap(
      changeCoins(state(SETUP), GRUM, 5_000, 'the reward', 'one-reward'),
      'first',
    );
    expect(first[0]).toMatchObject({ command: { id: 'one-reward' } });
    expect(Object.keys(state([...SETUP, ...first]).appliedCommands)).toContain('one-reward');
  });

  it('refuses a command id sent again with different inputs', () => {
    const first = unwrap(
      changeCoins(state(SETUP), GRUM, 5_000, 'the reward', 'one-reward'),
      'first',
    );
    const recycled = changeCoins(
      state([...SETUP, ...first]),
      GRUM,
      9_000,
      'the reward',
      'one-reward',
    );
    expect(isErr(recycled) && recycled.code).toBe('command_id_reused');
  });

  /** Two different payments are two payments, which is the other half. */
  it('pays twice under two ids', () => {
    const once = run(SETUP, (s) => changeCoins(s, GRUM, 5_000, 'the reward', 'first-reward'));
    const twice = run(once, (s) => changeCoins(s, GRUM, 5_000, 'the reward', 'second-reward'));
    expect(coinsOf(state(twice), GRUM)).toBe(BORN_WITH + 10_000);
  });
});
