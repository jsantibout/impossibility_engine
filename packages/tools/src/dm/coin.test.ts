/**
 * A party that can be paid — through `surface.call` and nothing else.
 *
 * `purchase_item` has been on the model's surface for as long as there has
 * been a shop, and it spent a purse **nothing on either surface could fill**.
 * A character's money was whatever creation gave it, and every command that
 * touched coin after that took some away. A level 5 party found a hoard and
 * was told it had 15 gold, because that is what a level 1 Fighter starts with.
 *
 * **Two doors over one command, and the split is `award_items` / `lose_items`
 * exactly.** The engine has one signed event and one signed command; a surface
 * is where that turns back into two sentences a DM would say, because "pass a
 * negative number to rob them" is not prose a door should print.
 *
 * **The amount is a decision, not a die.** How much the patron pays is fiction
 * of the same kind as how wide the room is and how many potions the chest held
 * — which is why this is the DM's door and not the model's. What the *engine*
 * does with it is not the caller's: the denomination is converted through the
 * catalogue's own `COPPER_PER`, the purse is checked before a levy is allowed,
 * and a price is still the book's when the coin is spent again.
 *
 * **And `create_character` still refuses gold on both surfaces.** That is the
 * whole reason this is a tool rather than a field: `dmGrants.goldPieces` is
 * pinned to a literal zero in a schema both surfaces share, so loosening it
 * there would hand a model the authorship the field exists to refuse.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, createSurface, type ToolOutcome } from '@ie/tools';

const fighter = (name: string, gold = 0): Record<string, unknown> => ({
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
  classEquipment: 'B',
  backgroundEquipment: 'B',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
  feats: { 'criminal:alert': { featId: 'alert' }, 'fighter:fighting-style': { featId: 'defense' } },
  dmGrants: { items: [], goldPieces: gold, magicItems: [], note: 'standard package only' },
});

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;

  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

  const rule = (tool: string, input: unknown = {}, commandId?: string): ToolOutcome =>
    dm.call({ tool, input, commandId: commandId ?? `dm_${(calls += 1)}` });

  return { campaign, surface, dm, call, rule };
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

const coins = (t: ReturnType<typeof table>, who: string): number =>
  expectOk(t.call('sheet', { who })).resolution['coins'] as number;

const owns = (t: ReturnType<typeof table>, who: string, item: string): number => {
  const carrying = expectOk(t.call('sheet', { who })).resolution['carrying'] as readonly {
    id: string;
    quantity: number;
  }[];
  return carrying.find((line) => line.id === item)?.quantity ?? 0;
};

function party(seed = 'coin') {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
  return t;
}

// — being paid ————————————————————————————————————————————————————————————

describe('a DM can pay a party', () => {
  it('fills a purse, and the purse holds it', () => {
    const t = party();
    const before = coins(t, 'bram');

    expectOk(
      t.rule('award_coin', {
        who: 'bram',
        amount: 50,
        coin: 'gp',
        because: 'the reward for the caravan',
      }),
    );

    // Fifty gold is five thousand copper, converted by the catalogue and not
    // by whoever called the tool.
    expect(coins(t, 'bram')).toBe(before + 5_000);
  });

  it('counts every coin the book prints, and the caller never says the rate', () => {
    for (const [coin, copper] of [
      ['cp', 1],
      ['sp', 10],
      ['ep', 50],
      ['gp', 100],
      ['pp', 1_000],
    ] as const) {
      const t = party(`coin-${coin}`);
      const before = coins(t, 'bram');
      expectOk(t.rule('award_coin', { who: 'bram', amount: 7, coin, because: 'the hoard' }));
      expect(coins(t, 'bram') - before, coin).toBe(7 * copper);
    }
  });

  it('says gold when nobody says which coin', () => {
    const t = party();
    const before = coins(t, 'bram');
    expectOk(t.rule('award_coin', { who: 'bram', amount: 3, because: 'the purse on the body' }));
    expect(coins(t, 'bram')).toBe(before + 300);
  });

  /**
   * The point of the whole brief: what a DM pays, a character spends, at the
   * price the book prints and through the tool that has always been there.
   */
  it('makes the shop reachable by somebody who did not start rich', () => {
    const t = party();

    // Plate armour is 1,500 gp: out of reach of anything a level 1 character
    // was born with, which is the state the engine shipped in.
    const broke = expectRefused(t.call('purchase_item', { who: 'bram', item: 'plate-armor' }));
    expect(broke.code).toBe('cannot_afford');

    expectOk(
      t.rule('award_coin', {
        who: 'bram',
        amount: 2_000,
        coin: 'gp',
        because: 'the dragon’s hoard, split five ways',
      }),
    );

    const bought = expectOk(t.call('purchase_item', { who: 'bram', item: 'plate-armor' }));
    expect(bought.resolution['bought']).toBe('plate-armor');
    expect(owns(t, 'bram', 'plate-armor')).toBe(1);
    // And the price was still the book's: nobody typed what it cost.
    expect(coins(t, 'bram')).toBeLessThan(200_000);
  });

  /**
   * A transport re-sending a call must not pay a party twice — which is the
   * failure this whole command was nearly shipped with, because a stamp had
   * nowhere to ride until `coins-changed` declared one.
   *
   * Asserted as `award_items` asserts it and not with a `duplicate` flag:
   * `settleEvents` builds one resolution for both paths, so the honest claim
   * is that the retry wrote no events, the log did not grow and the purse did
   * not move.
   */
  it('pays once however many times the call arrives', () => {
    const t = party();
    const before = coins(t, 'bram');
    const args = { who: 'bram', amount: 50, coin: 'gp', because: 'the reward' };

    expectOk(t.rule('award_coin', args, 'toolu_reward'));
    const paid = coins(t, 'bram');
    const entries = t.campaign.log().length;

    const again = expectOk(t.rule('award_coin', args, 'toolu_reward'));

    expect(again.events).toHaveLength(0);
    expect(t.campaign.log()).toHaveLength(entries);
    expect(paid).toBe(before + 5_000);
    expect(coins(t, 'bram')).toBe(before + 5_000);
  });

  it('is refused rather than silently swallowed when one id names two payments', () => {
    const t = party();
    expectOk(
      t.rule('award_coin', { who: 'bram', amount: 50, because: 'the reward' }, 'toolu_reward'),
    );
    const out = t.rule(
      'award_coin',
      { who: 'bram', amount: 900, because: 'the reward' },
      'toolu_reward',
    );
    expect(out.status).toBe('refused');
    if (out.status !== 'refused') return;
    expect(out.code).toBe('command_id_reused');
  });
});

// — being robbed ——————————————————————————————————————————————————————————

describe('a DM can rob a party', () => {
  it('takes a toll that buys nothing', () => {
    const t = party();
    expectOk(t.rule('award_coin', { who: 'bram', amount: 50, coin: 'gp', because: 'the reward' }));
    const before = coins(t, 'bram');

    expectOk(
      t.rule('take_coin', { who: 'bram', amount: 10, coin: 'gp', because: 'the toll at the bridge' }),
    );
    expect(coins(t, 'bram')).toBe(before - 1_000);
  });

  it('refuses to take more than is carried, and says what is there', () => {
    const t = party();
    const purse = coins(t, 'bram');

    const out = expectRefused(
      t.rule('take_coin', {
        who: 'bram',
        amount: 10_000,
        coin: 'gp',
        because: 'a bribe they cannot pay',
      }),
    );
    expect(out.code).toBe('not_enough_coin');
    expect(out.reason).toContain(String(purse));
    // And nothing moved.
    expect(coins(t, 'bram')).toBe(purse);
  });

  it('empties a purse exactly, which is what a thief in the night does', () => {
    const t = party();
    const purse = coins(t, 'bram');
    expectOk(
      t.rule('take_coin', {
        who: 'bram',
        amount: purse,
        coin: 'cp',
        because: 'the thief in the night',
      }),
    );
    expect(coins(t, 'bram')).toBe(0);
  });
});

// — refusals are values ———————————————————————————————————————————————————

describe('a coin tool refuses as a value', () => {
  it('asks about a creature nobody has created', () => {
    const t = party();
    const out = t.rule('award_coin', { who: 'nobody', amount: 5, because: 'a patron' });
    expect(out.status).toBe('needs-context');
    if (out.status !== 'needs-context') return;
    expect(out.code).toBe('unknown_creature');
    expect(out.reason).toContain('nobody');
  });

  it.each([
    ['nothing at all', 0],
    ['a fraction of a coin', 2.5],
    ['a debt', -5],
  ])('refuses %s at the door', (_why, amount) => {
    const t = party();
    const out = t.rule('award_coin', { who: 'bram', amount, because: 'a patron' });
    expect(out.status).toBe('invalid');
  });

  it('will not be told why in no words at all', () => {
    const t = party();
    expect(t.rule('award_coin', { who: 'bram', amount: 5, because: '' }).status).toBe('invalid');
    expect(t.rule('award_coin', { who: 'bram', amount: 5 }).status).toBe('invalid');
  });

  it('refuses a coin the book does not print', () => {
    const t = party();
    const out = t.rule('award_coin', {
      who: 'bram',
      amount: 5,
      coin: 'zorkmid',
      because: 'a patron',
    });
    expect(out.status).toBe('invalid');
  });
});

// — the wall ——————————————————————————————————————————————————————————————

describe('the model may not pay itself', () => {
  it.each(['award_coin', 'take_coin'])('holds no %s on the model’s surface', (tool) => {
    const t = party();
    expect(t.surface.tools.map((definition) => definition.name)).not.toContain(tool);

    const out = t.call(tool, { who: 'bram', amount: 50, because: 'a windfall I decided on' });
    expect(out.status).toBe('invalid');
    if (out.status !== 'invalid') return;
    expect(out.code).toBe('unknown_tool');
  });

  it.each(['award_coin', 'take_coin'])('offers %s on the DM’s', (tool) => {
    const t = party();
    expect(t.dm.tools.map((definition) => definition.name)).toContain(tool);
  });

  /**
   * The literal zero this tool exists to protect. Both surfaces share one
   * `create_character` schema, so a character is still born with exactly what
   * the book gives it and the only other way in is the DM's door above.
   */
  it.each(['model', 'dm'])('refuses gold at creation on the %s surface', (surface) => {
    const t = table(`creation-${surface}`);
    const send = surface === 'model' ? t.call : t.rule;

    const out = send('create_character', { id: 'rich', choices: fighter('Rich', 500) });
    expect(out.status).toBe('invalid');

    // And the same character without the gold is fine, so the refusal is
    // about the gold and not about the rest of the sheet.
    expect(send('create_character', { id: 'poor', choices: fighter('Poor', 0) }).status).toBe('ok');
  });
});
