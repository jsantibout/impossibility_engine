/**
 * What a character owns, wears, attunes to, buys, hands over and loses —
 * through `surface.call` and nothing else.
 *
 * Seven inventory commands landed in the engine and reached no tool. The
 * consequence was not subtle: `award_items` could put chain mail in a
 * backpack and nothing could put it on, so armour a party found protected
 * nobody; a magic item could be held and never attuned, which is the sentence
 * that switches its benefit on; coins were spent by nothing and a shop was a
 * thing the engine could price and no caller could buy from.
 *
 * **The split between the two surfaces is the one the design note already
 * made.** "Handing out what a party found is the DM's, and what a character
 * does with what it holds is the character's." So wearing, attuning, buying
 * and handing to an ally are the model's, beside `use_item`; **losing** is the
 * DM's, beside `award_items`, because a thief in the night and a mimic that
 * swallowed the sword are the table adjudicating the world rather than a
 * character deciding anything.
 *
 * **Not one of them carries a mechanical number.** A quantity is a count of
 * things, exactly as `award_items`' is; a price is the book's and the engine
 * refuses what the coins do not cover; an Armour Class is derived from what is
 * worn, which is the whole reason equipping has to be a separate fact from
 * owning.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  type ToolOutcome,
} from '@ie/tools';

const fighter = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'dwarf',
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, dex: 1 },
  classSkills: ['athletics', 'perception'],
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  // B is the option that is all coin, which is what a shop needs.
  classEquipment: 'B',
  backgroundEquipment: 'B',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
  feats: { 'criminal:alert': { featId: 'alert' }, 'fighter:fighting-style': { featId: 'defense' } },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;

  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

  /** The DM's door, for what a party finds and what a thief takes. */
  const rule = (tool: string, input: unknown = {}): ToolOutcome =>
    dm.call({ tool, input, commandId: `dm_${(calls += 1)}` });

  return { campaign, surface, call, rule };
}

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

const expectRefused = (outcome: ToolOutcome) => {
  if (outcome.status !== 'refused') {
    throw new Error(
      `expected refused, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

interface Line {
  readonly id: string;
  readonly quantity: number;
  readonly instance?: string;
}

/** What is in a pair of hands: a kind, and the copy where copies differ. */
interface Worn {
  readonly id: string;
  readonly instance?: string;
}

const sheetOf = (t: ReturnType<typeof table>, who: string) =>
  expectOk(t.call('sheet', { who })).resolution;

const coins = (t: ReturnType<typeof table>, who: string): number =>
  sheetOf(t, who)['coins'] as number;

const carrying = (t: ReturnType<typeof table>, who: string): readonly Line[] =>
  sheetOf(t, who)['carrying'] as readonly Line[];

const owns = (t: ReturnType<typeof table>, who: string, item: string): number =>
  carrying(t, who).find((line) => line.id === item)?.quantity ?? 0;

const equipped = (t: ReturnType<typeof table>, who: string): readonly Worn[] =>
  sheetOf(t, who)['equipped'] as readonly Worn[];

const wearing = (t: ReturnType<typeof table>, who: string): readonly string[] =>
  equipped(t, who).map((worn) => worn.id);

const attuned = (t: ReturnType<typeof table>, who: string): readonly string[] =>
  sheetOf(t, who)['attuned'] as readonly string[];

const armorClass = (t: ReturnType<typeof table>, who: string): number =>
  sheetOf(t, who)['armorClass'] as number;

function party(seed = 'inventory') {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
  expectOk(t.call('create_character', { id: 'orin', choices: fighter('Orin') }));
  return t;
}

// — buying ————————————————————————————————————————————————————————————————

describe('a character can buy what the book prices', () => {
  it('pays the price out of its own coin and gets the thing', () => {
    const t = party();
    const before = coins(t, 'bram');
    expect(before).toBeGreaterThan(0);

    const bought = expectOk(t.call('purchase_item', { who: 'bram', item: 'shield' }));
    expect(bought.resolution['bought']).toBe('shield');
    expect(owns(t, 'bram', 'shield')).toBe(1);
    // The price is the book's: what changed is a number nobody typed.
    expect(coins(t, 'bram')).toBeLessThan(before);
  });

  it('buys several, which is a count of things and not a price', () => {
    const t = party();
    const had = owns(t, 'bram', 'rope');
    expectOk(t.call('purchase_item', { who: 'bram', item: 'rope', quantity: 3 }));
    expect(owns(t, 'bram', 'rope')).toBe(had + 3);
  });

  /**
   * And a bundle is opened on the way in, which is the engine reading the
   * catalogue rather than the caller counting: the SRD prices Torches in
   * threes, so five purchases are fifteen torches and nobody typed either
   * number.
   */
  it('unpacks what the book sells as a bundle', () => {
    const t = party();
    expectOk(t.call('purchase_item', { who: 'bram', item: 'torch', quantity: 5 }));
    expect(owns(t, 'bram', 'torch')).toBe(15);
  });

  it('refuses what the coins do not cover, and the refusal is readable off the sheet', () => {
    const t = party();
    const purse = coins(t, 'bram');
    const out = expectRefused(t.call('purchase_item', { who: 'bram', item: 'plate-armor' }));
    expect(out.code).toBe('cannot_afford');
    // Nothing was spent and nothing arrived.
    expect(coins(t, 'bram')).toBe(purse);
    expect(owns(t, 'bram', 'plate-armor')).toBe(0);
  });

  it('refuses a thing the catalogue does not list, naming what it was sent', () => {
    const t = party();
    const out = expectRefused(t.call('purchase_item', { who: 'bram', item: 'vorpal-toothpick' }));
    expect(out.code).toBe('unknown_item');
    expect(out.reason).toContain('vorpal-toothpick');
  });
});

// — wearing ———————————————————————————————————————————————————————————————

describe('owning something is not wearing it', () => {
  const armed = (seed = 'inventory') => {
    const t = party(seed);
    expectOk(
      t.rule('award_items', {
        who: 'bram',
        items: [{ id: 'chain-mail' }, { id: 'rope' }],
        because: 'the quartermaster',
      }),
    );
    return t;
  };

  it('changes the Armour Class only when the armour goes on', () => {
    const t = armed();
    const bare = armorClass(t, 'bram');
    expect(equipped(t, 'bram')).toEqual([]);

    expectOk(t.call('equip_item', { who: 'bram', item: 'chain-mail' }));
    expect(wearing(t, 'bram')).toContain('chain-mail');
    const worn = armorClass(t, 'bram');
    expect(worn).toBeGreaterThan(bare);

    // And taking it off is a decision that looks like one in the log.
    expectOk(t.call('unequip_item', { who: 'bram', item: 'chain-mail' }));
    expect(equipped(t, 'bram')).toEqual([]);
    expect(armorClass(t, 'bram')).toBe(bare);
    // Still owned: taking armour off is not selling it.
    expect(owns(t, 'bram', 'chain-mail')).toBe(1);
  });

  /**
   * And **which** copy is in hand, where the engine tells the copies apart.
   * A wand's charges are its own, so a caller shown a kind and not a copy
   * cannot say which wand it is holding — the argument `carrying` already
   * makes about a pack, one hand further in.
   */
  it('says which copy is in hand, where the copies are told apart', () => {
    const t = party();
    expectOk(
      t.rule('award_items', {
        who: 'bram',
        items: [{ id: 'wand-of-secrets', quantity: 2 }],
        because: 'two wands in the same chest',
      }),
    );
    const copies = carrying(t, 'bram').filter((line) => line.id === 'wand-of-secrets');
    expect(copies).toHaveLength(2);
    expect(copies[0]!.instance).toBeDefined();
    expect(copies[0]!.instance).not.toBe(copies[1]!.instance);

    expectOk(t.call('equip_item', { who: 'bram', item: copies[1]!.instance! }));
    expect(equipped(t, 'bram')).toHaveLength(1);
    expect(equipped(t, 'bram')[0]).toMatchObject({
      id: 'wand-of-secrets',
      instance: copies[1]!.instance,
    });
  });

  it('refuses to wear what is not owned', () => {
    const t = armed();
    const out = expectRefused(t.call('equip_item', { who: 'bram', item: 'plate-armor' }));
    expect(out.code).toBe('not_owned');
  });

  it('refuses to wear a sack of rope, which is carried rather than worn', () => {
    const t = armed();
    const out = expectRefused(t.call('equip_item', { who: 'bram', item: 'rope' }));
    expect(out.code).toBe('not_equippable');
  });

  it('refuses to take off what is not on', () => {
    const t = armed();
    const out = expectRefused(t.call('unequip_item', { who: 'bram', item: 'chain-mail' }));
    expect(out.code).toBe('not_equipped');
  });
});

// — attunement ————————————————————————————————————————————————————————————

describe('attunement is the sentence that switches a magic item on', () => {
  const found = (seed = 'inventory') => {
    const t = party(seed);
    expectOk(
      t.rule('award_items', {
        who: 'bram',
        items: [{ id: 'bracers-of-defense' }],
        because: 'the barrow',
      }),
    );
    return t;
  };

  it('takes the Short Rest the SRD asks for, and then holds', () => {
    const t = found();
    // Outside a rest it is refused, which is the rule and not a formality.
    const early = expectRefused(t.call('attune_item', { who: 'bram', item: 'bracers-of-defense' }));
    expect(early.code).toBe('not_resting');

    expectOk(t.call('begin_rest', { who: 'bram', kind: 'short' }));
    expectOk(t.call('attune_item', { who: 'bram', item: 'bracers-of-defense' }));
    expect(attuned(t, 'bram')).toContain('bracers-of-defense');

    // And it can be given up, which SRD lists among the ways it ends.
    expectOk(t.call('end_attunement', { who: 'bram', item: 'bracers-of-defense' }));
    expect(attuned(t, 'bram')).toEqual([]);
  });

  it('refuses an item that works for anybody holding it', () => {
    const t = found();
    expectOk(
      t.rule('award_items', { who: 'bram', items: [{ id: 'shield' }], because: 'the rack' }),
    );
    expectOk(t.call('begin_rest', { who: 'bram', kind: 'short' }));
    const out = expectRefused(t.call('attune_item', { who: 'bram', item: 'shield' }));
    expect(out.code).toBe('no_attunement');
  });

  it('refuses to give up an attunement nobody has', () => {
    const t = found();
    const out = expectRefused(t.call('end_attunement', { who: 'bram', item: 'bracers-of-defense' }));
    expect(out.code).toBe('not_attuned');
  });
});

// — handing over ——————————————————————————————————————————————————————————

describe('one character can hand something to another', () => {
  const stocked = (seed = 'inventory') => {
    const t = party(seed);
    expectOk(
      t.rule('award_items', {
        who: 'bram',
        items: [{ id: 'potion-of-healing', quantity: 2 }, { id: 'chain-mail' }],
        because: 'the chest under the altar',
      }),
    );
    return t;
  };

  it('moves the thing from one pack to the other in one event', () => {
    const t = stocked();
    const given = expectOk(
      t.call('transfer_item', {
        from: 'bram',
        to: 'orin',
        item: 'potion-of-healing',
        because: 'Orin is the one who gets hit',
      }),
    );
    expect(given.events).toHaveLength(1);
    expect(owns(t, 'bram', 'potion-of-healing')).toBe(1);
    expect(owns(t, 'orin', 'potion-of-healing')).toBe(1);

    // And what arrived is usable, which is the point of moving it.
    expectOk(t.call('use_item', { who: 'orin', item: 'potion-of-healing' }));
  });

  it('refuses a gift to oneself, which moves nothing', () => {
    const t = stocked();
    const out = expectRefused(
      t.call('transfer_item', {
        from: 'bram',
        to: 'bram',
        item: 'potion-of-healing',
        because: 'thinking about it',
      }),
    );
    expect(out.code).toBe('same_creature');
  });

  it('refuses to hand over what is worn, because wearing is a separate fact', () => {
    const t = stocked();
    expectOk(t.call('equip_item', { who: 'bram', item: 'chain-mail' }));
    const out = expectRefused(
      t.call('transfer_item', {
        from: 'bram',
        to: 'orin',
        item: 'chain-mail',
        because: 'Orin asked nicely',
      }),
    );
    expect(out.code).toBe('equipped');
    expect(owns(t, 'orin', 'chain-mail')).toBe(0);
  });

  it('refuses more than is carried', () => {
    const t = stocked();
    const out = expectRefused(
      t.call('transfer_item', {
        from: 'bram',
        to: 'orin',
        item: 'potion-of-healing',
        quantity: 5,
        because: 'generosity beyond the pack',
      }),
    );
    expect(out.code).toBe('not_owned');
  });
});

// — losing, which is the DM's ——————————————————————————————————————————————

describe('what a party loses is the DM’s to say', () => {
  const stocked = (seed = 'inventory') => {
    const t = party(seed);
    expectOk(
      t.rule('award_items', {
        who: 'bram',
        items: [{ id: 'potion-of-healing', quantity: 2 }, { id: 'chain-mail' }],
        because: 'the chest under the altar',
      }),
    );
    return t;
  };

  it('takes the thing away, and says where it went', () => {
    const t = stocked();
    const taken = expectOk(
      t.rule('lose_items', {
        who: 'bram',
        items: [{ id: 'potion-of-healing' }],
        because: 'the thief in the night',
      }),
    );
    expect(taken.resolution['lost']).toEqual(['potion-of-healing']);
    expect(owns(t, 'bram', 'potion-of-healing')).toBe(1);
  });

  it('refuses to confiscate what is worn, leaving that to taking it off', () => {
    const t = stocked();
    expectOk(t.call('equip_item', { who: 'bram', item: 'chain-mail' }));
    const out = expectRefused(
      t.rule('lose_items', {
        who: 'bram',
        items: [{ id: 'chain-mail' }],
        because: 'the mimic',
      }),
    );
    expect(out.code).toBe('equipped');
  });

  it('refuses more than is owned', () => {
    const t = stocked();
    const out = expectRefused(
      t.rule('lose_items', {
        who: 'bram',
        items: [{ id: 'potion-of-healing', quantity: 9 }],
        because: 'a very thorough thief',
      }),
    );
    expect(out.code).toBe('not_owned');
  });

  /**
   * And it is not on the model's door at all, for `award_items`' reason: what
   * a party finds and what a party loses are the same decision twice.
   */
  it('is not a tool a model-driven session holds', () => {
    const t = party();
    const out = t.call('lose_items', {
      who: 'bram',
      items: [{ id: 'potion-of-healing' }],
      because: 'wishing it away',
    });
    expect(out.status).toBe('invalid');
    if (out.status !== 'invalid') return;
    expect(out.code).toBe('unknown_tool');
  });
});
