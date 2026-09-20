/**
 * The hour between two fights, driven through `surface.call` and nothing else.
 *
 * **This file imports no engine.** A Short Rest is what makes a Warlock and a
 * Fighter work across two fights rather than one, and until the doors below
 * existed a session could spend a Second Wind and never get it back: the
 * engine has had `beginRest` and `endRest` since rests landed and nothing
 * above it called either.
 *
 * Three things had to arrive together for a rest to be takeable at all.
 * `begin_rest` starts the span; **`advance_time` moves the clock**, because a
 * rest is measured against it and no command on this surface moved it; and
 * `end_rest` grants what the span earned. The engine decides the benefit from
 * the clock and from the interruptions it recorded for itself — a caller says
 * only which Hit Dice to spend, which is the same kind of choice `slotLevel`
 * is and carries no number the caller produced.
 *
 * The potion is the other half of the same gap: `useItem` is a door onto an
 * inventory, and nothing on either surface put anything in one. Handing out
 * what a party found is a **DM's** call — the model's `create_character`
 * refuses to grant an item or a magic item for exactly that reason — so
 * `award_items` is on the DM's door and `use_item` is on the model's. Two
 * surfaces over one campaign are one campaign.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  type ToolOutcome,
} from '@ie/tools';

/**
 * A dwarf Fighter, with no choice this file is not about.
 *
 * Written out rather than derived, which is the choice `fight.test.ts` makes
 * for its wizard: Dwarf and Criminal ask for nothing at all, and what is left
 * is the two the class asks. Level 2, because that is where Second Wind has a
 * pool worth emptying and the Hit Dice are still countable.
 */
const fighter = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 2,
  speciesId: 'dwarf',
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  // Criminal offers Dexterity, Constitution and Intelligence.
  abilityIncreases: { con: 2, dex: 1 },
  classSkills: ['athletics', 'perception'],
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
  feats: {
    'criminal:alert': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;

  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

  /** The DM's door, over the same campaign, for the two things a model may not do. */
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

interface Pool {
  readonly key: string;
  readonly left: number;
  readonly max: number;
}

const poolsOf = (t: ReturnType<typeof table>, who: string): readonly Pool[] =>
  expectOk(t.call('sheet', { who })).resolution['pools'] as readonly Pool[];

const poolLeft = (t: ReturnType<typeof table>, who: string, key: string): number =>
  poolsOf(t, who).find((one) => one.key === key)!.left;

/** The Hit Dice pool this character has, by the key the engine gave it. */
const hitDieKey = (t: ReturnType<typeof table>, who: string): string =>
  poolsOf(t, who).find((one) => one.key.startsWith('hit-die:'))!.key;

const creature = (t: ReturnType<typeof table>, who: string) =>
  t.surface.observe().creatures.find((one) => one.id === who)!;

const hpOf = (t: ReturnType<typeof table>, who: string): number => creature(t, who).hp;

// — the hour between two fights ————————————————————————————————————————————

describe('a Fighter can take a Short Rest between two fights', () => {
  const wounded = (seed: string) => {
    const t = table(seed);
    expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
    // A chandelier, adjudicated by a DM: the model's door deals no damage.
    expectOk(t.rule('improvised_damage', { target: 'bram', amount: 12, ruling: 'the chandelier' }));
    expectOk(t.call('heal_with_feature', { who: 'bram', feature: 'fighter:second-wind' }));
    expectOk(t.call('heal_with_feature', { who: 'bram', feature: 'fighter:second-wind' }));
    expect(poolLeft(t, 'bram', 'second-wind')).toBe(0);
    return t;
  };

  /**
   * SRD: "A Short Rest is a 1-hour period of downtime", and what it gives back
   * is whatever recovers on one — Second Wind's uses here — plus the Hit Dice
   * the character chose to spend.
   */
  it('gives back what a Short Rest gives back, an hour later', () => {
    const t = wounded('short-rest');
    const dice = hitDieKey(t, 'bram');
    expect(poolLeft(t, 'bram', dice)).toBe(2);
    const hurt = hpOf(t, 'bram');

    expectOk(t.call('begin_rest', { who: 'bram', kind: 'short' }));
    expectOk(t.call('advance_time', { hours: 1, because: 'the party rests in the ruined chapel' }));
    const rested = expectOk(t.call('end_rest', { who: 'bram', hitDice: [dice] }));

    expect(rested.resolution['benefit']).toBe('short');
    // The die is the engine's and so is what it adds: SRD "the total (minimum
    // of 1)" is the roll plus Constitution, read off the sheet as it stands.
    const roll = rested.events.find(
      (event) => event.type === 'roll-recorded' && event.label.startsWith('Hit Die'),
    );
    expect(roll).toBeDefined();
    if (roll?.type === 'roll-recorded') {
      expect(roll.contributions.map((one) => one.source)).toContain('Constitution');
    }
    expect(hpOf(t, 'bram')).toBeGreaterThan(hurt);
    expect(poolLeft(t, 'bram', dice)).toBe(1);
    // SRD Second Wind: "You regain one expended use when you finish a Short
    // Rest" — one, and not the pool. What a rest gives back is the pool's own
    // sentence and never the caller's expectation of it.
    expect(poolLeft(t, 'bram', 'second-wind')).toBe(1);
  });

  /**
   * A rest that has not run its course is not over, and saying so is a refusal
   * a caller acts on by letting the clock run — which is what `advance_time`
   * is for.
   */
  it('refuses to end a rest that has not run its course, and gives nothing back', () => {
    const t = wounded('too-soon');
    expectOk(t.call('begin_rest', { who: 'bram', kind: 'short' }));
    expectOk(t.call('advance_time', { minutes: 10, because: 'a short sit down' }));

    const refusal = expectRefused(t.call('end_rest', { who: 'bram' }));
    expect(refusal.code).toBe('rest_incomplete');
    expect(poolLeft(t, 'bram', 'second-wind')).toBe(0);

    // And the same rest, once the hour is up, pays out.
    expectOk(t.call('advance_time', { minutes: 50, because: 'the rest of the hour' }));
    expect(expectOk(t.call('end_rest', { who: 'bram' })).resolution['benefit']).toBe('short');
    expect(poolLeft(t, 'bram', 'second-wind')).toBe(1);
  });

  /**
   * SRD: "To start a Short Rest, you must have at least 1 Hit Point" — and
   * more to the point here, a rest asks for more Hit Dice than are left is
   * refused before a single one is rolled.
   */
  it('refuses more Hit Dice than are left, and spends neither a die nor a roll', () => {
    const t = wounded('too-many-dice');
    const dice = hitDieKey(t, 'bram');
    expectOk(t.call('begin_rest', { who: 'bram', kind: 'short' }));
    expectOk(t.call('advance_time', { hours: 1, because: 'the party rests' }));
    const before = { hp: hpOf(t, 'bram'), rolls: t.campaign.state().rollsIssued };

    const refusal = expectRefused(
      t.call('end_rest', { who: 'bram', hitDice: [dice, dice, dice] }),
    );
    expect(refusal.code).toBe('not_enough_hit_dice');
    expect(hpOf(t, 'bram')).toBe(before.hp);
    expect(t.campaign.state().rollsIssued).toBe(before.rolls);
    expect(poolLeft(t, 'bram', dice)).toBe(2);
  });
});

// — what the party found, and what it does ————————————————————————————————

describe('a character can drink a potion somebody gave them', () => {
  const chest = (seed: string) => {
    const t = table(seed);
    expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
    expectOk(t.rule('improvised_damage', { target: 'bram', amount: 12, ruling: 'the chandelier' }));
    return t;
  };

  /**
   * SRD Potion of Healing: "you regain 2d4 + 2 Hit Points" — the item's own
   * dice, the same in any hand, and the bottle is gone afterwards.
   */
  it('drinks it, is healed by the item’s own dice, and the bottle is gone', () => {
    const t = chest('potion');
    expectOk(
      t.rule('award_items', {
        who: 'bram',
        items: [{ id: 'potion-of-healing' }],
        because: 'the chest under the altar',
      }),
    );
    expect(creature(t, 'bram').carrying).toContain('potion-of-healing');
    const hurt = hpOf(t, 'bram');

    const drunk = expectOk(t.call('use_item', { who: 'bram', item: 'potion-of-healing' }));
    expect(drunk.events.some((event) => event.type === 'healed')).toBe(true);
    expect(hpOf(t, 'bram')).toBeGreaterThan(hurt);
    expect(creature(t, 'bram').carrying).not.toContain('potion-of-healing');
  });

  it('refuses a potion nobody gave them, and nothing is healed', () => {
    const t = chest('no-potion');
    const hurt = hpOf(t, 'bram');

    const refusal = expectRefused(t.call('use_item', { who: 'bram', item: 'potion-of-healing' }));
    expect(refusal.code).toBe('not_owned');
    expect(hpOf(t, 'bram')).toBe(hurt);
  });

  it('refuses an item that confers nothing by being used, naming what it is', () => {
    const t = chest('nothing-conferred');
    expectOk(
      t.rule('award_items', { who: 'bram', items: [{ id: 'crowbar' }], because: 'the toolshed' }),
    );

    const refusal = expectRefused(t.call('use_item', { who: 'bram', item: 'crowbar' }));
    expect(refusal.code).toBe('item_confers_nothing');
  });
});

// — the action that waits for something ————————————————————————————————————

describe('a Fighter can ready an action and let it go', () => {
  const standoff = (seed: string) => {
    const t = table(seed);
    expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the door', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'bram', fromLandmark: 'the door', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'bram', feet: 20, bearing: 0 }));
    expectOk(t.call('declare_sight', { from: 'bram', to: 'grish', seen: true }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'bram' }, { who: 'grish' }] }));
    for (let guard = 0; guard < 4; guard += 1) {
      const now = t.surface.observe().turnOf;
      if (now === 'bram') break;
      expectOk(t.call('end_turn', { who: now! }));
    }
    return t;
  };

  const budget = (t: ReturnType<typeof table>, who: string) => creature(t, who).budget!;

  /**
   * SRD Ready: "you take this action on your turn, which lets you act by
   * taking a Reaction before the start of your next turn." The trigger is the
   * table's — the engine judges Reactions, not perceivable circumstances — and
   * the action goes now while the Reaction goes when it fires.
   */
  it('spends the action now and the Reaction when the trigger comes', () => {
    const t = standoff('readied');
    expectOk(
      t.call('take_ready', {
        who: 'bram',
        trigger: 'the goblin steps out from behind the barrels',
        response: { kind: 'action', note: 'swing at it' },
      }),
    );
    expect(budget(t, 'bram').action).toBe(false);
    expect(budget(t, 'bram').reaction).toBe(true);

    const released = expectOk(t.call('release_ready', { who: 'bram' }));
    expect(released.resolution['took']).toBe(true);
    expect(budget(t, 'bram').reaction).toBe(false);
  });

  /**
   * A readied **move** is one of the two the engine carries out for itself,
   * and the only one whose destination this tool has to carry: SRD "you choose
   * to move up to your Speed in response to it", measured from a landmark or a
   * creature like every other destination on this surface.
   */
  it('makes the move it was holding, where the release says', () => {
    const t = standoff('readied-move');
    expectOk(
      t.call('take_ready', {
        who: 'bram',
        trigger: 'the goblin breaks for the stairs',
        response: { kind: 'move' },
      }),
    );

    const released = expectOk(
      t.call('release_ready', {
        who: 'bram',
        placement: { fromLandmark: 'the door', feet: 10, bearing: 0 },
      }),
    );
    expect(released.resolution['took']).toBe(true);
    expect(released.resolution['feetMoved']).toBe(10);
    // The Reaction paid for it, so no Speed went with it: a turn budget
    // belongs to a turn and this is somebody else's.
    expect(budget(t, 'bram').reaction).toBe(false);
    expect(budget(t, 'bram').movementFeet).toBe(creature(t, 'bram').speed);
  });

  /** SRD: "or ignore the trigger." It costs nothing and keeps the Reaction. */
  it('lets the trigger pass, which costs nothing and keeps the Reaction', () => {
    const t = standoff('ignored');
    expectOk(
      t.call('take_ready', {
        who: 'bram',
        trigger: 'the goblin says the word',
        response: { kind: 'action' },
      }),
    );

    const released = expectOk(t.call('release_ready', { who: 'bram', ignore: true }));
    expect(released.resolution['took']).toBe(false);
    expect(budget(t, 'bram').reaction).toBe(true);

    // The hold is gone with the trigger, so there is nothing left to let go.
    expect(expectRefused(t.call('release_ready', { who: 'bram' })).code).toBe('nothing_readied');
  });

  it('refuses to let go of a hold nobody is holding, and spends no Reaction', () => {
    const t = standoff('nothing-readied');
    const refusal = expectRefused(t.call('release_ready', { who: 'bram' }));
    expect(refusal.code).toBe('nothing_readied');
    expect(budget(t, 'bram').reaction).toBe(true);
  });
});
