import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { fold, type GameEvent, type GameState } from './events.js';
import { CorruptLogError } from './fold/common.js';
import { beginRest } from './rest.js';
import {
  attuneItem,
  attunedItems,
  chargesLeft,
  equipItem,
  expendCharges,
  loseItems,
  transferItem,
  unequipItem,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * Handing something over: the copy, and everything keyed to it.
 *
 * Step one gave a copy of an item an identity, and left the engine with no way
 * to move one — a wand could be bought, started with, put down and taken away,
 * and not given to the fighter standing next to you. `items-lost` and
 * `items-gained` written back to back would have been two facts where the
 * world has one, and worse: the pool the copy's charges live in belongs to the
 * creature that declared it, so a wand handed over that way would arrive full
 * however spent it left.
 *
 * So there is one event, and its reducer moves the line **and its pool record
 * whole** — `spent` and all, which is the whole of what a copy's identity was
 * for. It reads no catalogue and rolls nothing: what moves is what the giver
 * had, and a transfer is the only inventory command that needs to open no
 * book at all.
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');
const NYX = id('nyx');

/** 3 charges, no attunement, and "regains 1d3 expended charges daily at dawn". */
const WAND = 'wand-of-secrets';
/** Attunement, and Advantage on Stealth while it is worn. */
const CLOAK = 'cloak-of-elvenkind';

const character = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
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
  ...over,
});

const hoard = (items: readonly { id: string; quantity: number }[]): CharacterChoices['dmGrants'] => ({
  items: [...items],
  goldPieces: 0,
  magicItems: items.map((line) => line.id),
  note: 'found in the barrow',
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(state(log)), 'command')];

const creature = (log: readonly GameEvent[], who: CharacterId) => state(log).creatures[who]!;
const lines = (log: readonly GameEvent[], who: CharacterId, itemId: string) =>
  creature(log, who).inventory.filter((line) => line.id === itemId);
const poolKeys = (log: readonly GameEvent[], who: CharacterId) =>
  Object.keys(creature(log, who).resources.pools).filter((key) => key.includes(':charges'));

/** Two wands and a rope for Grum, and Nyx standing beside him with neither. */
const party = (grumGrants = hoard([{ id: WAND, quantity: 2 }])): readonly GameEvent[] => {
  const first = unwrap(createCharacter(SRD_CONTENT, character({ dmGrants: grumGrants }), GRUM), 'grum');
  const second = unwrap(
    createCharacter(SRD_CONTENT, character({ name: 'Nyx' }), NYX, fold('seed', first)),
    'nyx',
  );
  return [...first, ...second];
};

describe('a copy handed over is the copy that arrives', () => {
  it('leaves the giver, joins the taker, and keeps its own record', () => {
    const log = run(party(), (s) => transferItem(s, GRUM, NYX, 'item:1', 1, 'a gift'));

    expect(lines(log, GRUM, WAND).map((line) => line.instance)).toEqual(['item:2']);
    expect(lines(log, NYX, WAND).map((line) => line.instance)).toEqual(['item:1']);
    expect(state(log).itemsIssued).toBe(2);
  });

  /** The whole point of a copy having a record: the charges travel with it. */
  it('arrives as spent as it left', () => {
    let log = run(party(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:1'));
    log = run(log, (s) => expendCharges(s, SRD_CONTENT, GRUM, 'item:1', 2));
    expect(chargesLeft(state(log), SRD_CONTENT, GRUM, 'item:1')).toBe(1);

    // Out of the hand first, because a wand is not given away while it is held.
    log = run(log, (s) => unequipItem(s, SRD_CONTENT, GRUM, WAND));
    log = run(log, (s) => transferItem(s, GRUM, NYX, 'item:1', 1, 'a gift'));

    expect(chargesLeft(state(log), SRD_CONTENT, NYX, 'item:1')).toBe(1);
    expect(chargesLeft(state(log), SRD_CONTENT, GRUM, 'item:1')).toBe(0);
    expect(poolKeys(log, GRUM)).toEqual([`${WAND}:charges@item:2`]);
    expect(poolKeys(log, NYX)).toEqual([`${WAND}:charges@item:1`]);
  });

  it('gives part of a stack and keeps the rest', () => {
    const before = party();
    const had = { grum: lines(before, GRUM, 'rations')[0]!.quantity, nyx: lines(before, NYX, 'rations')[0]!.quantity };
    const log = run(before, (s) => transferItem(s, GRUM, NYX, 'rations', 3, 'lunch'));
    expect(lines(log, GRUM, 'rations')).toEqual([{ id: 'rations', quantity: had.grum - 3 }]);
    expect(lines(log, NYX, 'rations')).toEqual([{ id: 'rations', quantity: had.nyx + 3 }]);
  });

  it('reads no catalogue, so the same log folds the same either way', () => {
    const log = run(party(), (s) => transferItem(s, GRUM, NYX, 'item:2', 1, 'a gift'));
    expect(fold('seed', log)).toStrictEqual(fold('seed', log, SRD_CONTENT));
    expect(fold('seed', log)).toStrictEqual(
      fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]),
    );
  });
});

describe('what a transfer refuses', () => {
  it('refuses to give away what is in hand', () => {
    const log = run(party(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:1'));
    const out = transferItem(state(log), GRUM, NYX, 'item:1', 1, 'a gift');
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('equipped');
  });

  /**
   * And the spare goes, which is the rule `loseItems` had to grow in the same
   * breath: "worn or wielded" is a fact about a **copy**, and a creature
   * holding one wand may hand over the other.
   */
  it('hands over the spare while its twin is in hand', () => {
    const log = run(party(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:1'));
    const given = run(log, (s) => transferItem(s, GRUM, NYX, 'item:2', 1, 'a gift'));
    expect(lines(given, NYX, WAND).map((line) => line.instance)).toEqual(['item:2']);
    expect(creature(given, GRUM).equipped.map((held) => held.instance)).toEqual(['item:1']);
  });

  it('refuses to guess which copy', () => {
    const out = transferItem(state(party()), GRUM, NYX, WAND, 1, 'a gift');
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('ambiguous_copy');
    expect(isNeedsContext(out)).toBe(false);
  });

  it('refuses more than is carried, and a thing nobody has', () => {
    const tooMany = transferItem(state(party()), GRUM, NYX, 'rations', 500, 'lunch');
    expect(isErr(tooMany) && tooMany.code).toBe('not_owned');
    const none = transferItem(state(party()), GRUM, NYX, 'longbow', 1, 'a gift');
    expect(isErr(none) && none.code).toBe('not_owned');
  });

  it('refuses a creature nobody has heard of, and a gift to oneself', () => {
    const stranger = transferItem(state(party()), GRUM, id('nobody'), 'rations', 1, 'lunch');
    expect(isErr(stranger) && stranger.code).toBe('unknown_creature');
    const self = transferItem(state(party()), GRUM, GRUM, 'rations', 1, 'lunch');
    expect(isErr(self) && self.code).toBe('same_creature');
  });

  it('refuses a quantity that is not a positive whole number', () => {
    const out = transferItem(state(party()), GRUM, NYX, 'rations', 0, 'lunch');
    expect(isErr(out) && out.code).toBe('bad_quantity');
  });
});

/**
 * SRD: "Your attunement to an item ends if ... you no longer have the item."
 * Nobody decides that, so nothing is emitted for it: the derived pass that
 * already watches for a thief in the night watches a gift too.
 */
describe('attunement ends with the item, through the pass that already ends it', () => {
  const attuned = (): readonly GameEvent[] => {
    let log = party(hoard([{ id: CLOAK, quantity: 1 }]));
    log = run(log, (s) => beginRest(s, GRUM, 'short'));
    return run(log, (s) => attuneItem(s, SRD_CONTENT, GRUM, CLOAK));
  };

  it('leaves the giver attuned to nothing, and the taker attuned to nothing either', () => {
    const log = attuned();
    expect(attunedItems(state(log), GRUM)).toEqual([CLOAK]);

    const given = run(log, (s) => transferItem(s, GRUM, NYX, CLOAK, 1, 'a gift'));
    expect(attunedItems(state(given), GRUM)).toEqual([]);
    expect(attunedItems(state(given), NYX)).toEqual([]);
    // And no event said so: the pass derives it, as it does for a death.
    expect(given.filter((e) => e.type === 'attunement-ended')).toEqual([]);
  });
});

describe('the fold refuses a transfer the commands are careful not to write', () => {
  const handWritten = (event: GameEvent): readonly GameEvent[] => [...party(), event];

  it('refuses a copy the giver does not have', () => {
    const log = handWritten({
      type: 'item-transferred',
      from: GRUM,
      to: NYX,
      item: WAND,
      quantity: 1,
      instance: 'item:9',
      source: 'by hand',
    });
    expect(() => fold('seed', log)).toThrow(CorruptLogError);
    expect(() => fold('seed', log)).toThrow(/item:9/);
  });

  it('refuses a transfer that names the kind when every copy has a record', () => {
    const log = handWritten({
      type: 'item-transferred',
      from: GRUM,
      to: NYX,
      item: WAND,
      quantity: 1,
      source: 'by hand',
    });
    expect(() => fold('seed', log)).toThrow(/has to name which/);
  });

  /** A transfer of more than is carried would *make* items, which a loss cannot. */
  it('refuses to move more than the giver has', () => {
    const log = handWritten({
      type: 'item-transferred',
      from: GRUM,
      to: NYX,
      item: 'rations',
      quantity: 500,
      source: 'by hand',
    });
    expect(() => fold('seed', log)).toThrow(CorruptLogError);
  });

  it('refuses to move a pool the giver has not got', () => {
    const log = handWritten({
      type: 'item-transferred',
      from: GRUM,
      to: NYX,
      item: WAND,
      quantity: 1,
      instance: 'item:1',
      pools: ['nothing-of-the-sort'],
      source: 'by hand',
    });
    expect(() => fold('seed', log)).toThrow(/nothing-of-the-sort/);
  });

  /**
   * And one onto a creature that already claims it, which is the other half
   * of `attachPool`: two creatures holding one copy's charges is a world with
   * two of a thing there is one of.
   */
  it('refuses to move a pool the taker already claims', () => {
    const log: readonly GameEvent[] = [
      ...party(),
      {
        type: 'resource-pool-declared',
        id: NYX,
        pool: {
          key: `${WAND}:charges@item:1`,
          label: 'somebody else’s wand',
          max: 3,
          recovers: 'dawn',
          regainsAtDawn: '1d3',
        },
      },
      {
        type: 'item-transferred',
        from: GRUM,
        to: NYX,
        item: WAND,
        quantity: 1,
        instance: 'item:1',
        pools: [`${WAND}:charges@item:1`],
        source: 'by hand',
      },
    ];
    expect(() => fold('seed', log)).toThrow(CorruptLogError);
    expect(() => fold('seed', log)).toThrow(/already declared/);
  });

  /**
   * The two the command refuses first, and which the fold would otherwise let
   * through as arithmetic rather than as a contradiction.
   *
   * A gift to oneself reads the giver and the taker out of the world *before*
   * the event, so writing both back would put the second read's inventory
   * over the first's — the copy given away and still owned, which is an item
   * made out of nothing.
   */
  it('refuses a creature handing something to itself', () => {
    const log = handWritten({
      type: 'item-transferred',
      from: GRUM,
      to: GRUM,
      item: 'rations',
      quantity: 1,
      source: 'by hand',
    });
    expect(() => fold('seed', log)).toThrow(CorruptLogError);
    expect(() => fold('seed', log)).toThrow(/itself/);
  });

  it('refuses a quantity that is not a count', () => {
    for (const quantity of [0, -2, 1.5]) {
      const log = handWritten({
        type: 'item-transferred',
        from: GRUM,
        to: NYX,
        item: 'rations',
        quantity,
        source: 'by hand',
      });
      expect(() => fold('seed', log)).toThrow(CorruptLogError);
      expect(() => fold('seed', log)).toThrow(/whole number/);
    }
  });
});

/**
 * The old rule, newly reachable: "worn or wielded" was asked of the **kind**
 * of thing, which was the only question an inventory could answer before a
 * copy had a record. A creature holding one wand could not drop the other.
 */
describe('a loss is refused for the copy in hand and allowed for the spare', () => {
  it('drops the spare while the twin is held', () => {
    const log = run(party(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:1'));
    const dropped = run(log, (s) =>
      loseItems(s, GRUM, [{ id: WAND, quantity: 1, instance: 'item:2' }], 'left in the grease'),
    );
    expect(lines(dropped, GRUM, WAND).map((line) => line.instance)).toEqual(['item:1']);
  });

  it('still refuses the one in hand', () => {
    const log = run(party(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'item:1'));
    const out = loseItems(
      state(log),
      GRUM,
      [{ id: WAND, quantity: 1, instance: 'item:1' }],
      'left in the grease',
    );
    expect(isErr(out)).toBe(true);
    expect(isErr(out) && out.code).toBe('equipped');
  });

  /** An unlabelled line is the stack it always was, and the kind is all there is to ask. */
  it('refuses an unlabelled kind that is in hand', () => {
    const log = run(party(), (s) => equipItem(s, SRD_CONTENT, GRUM, 'greataxe'));
    const out = loseItems(state(log), GRUM, [{ id: 'greataxe', quantity: 1 }], 'a thief');
    expect(isErr(out) && out.code).toBe('equipped');
  });
});
