import { describe, expect, it } from 'vitest';
import { asCharacterId, contextRequestsOf, isErr, isNeedsContext, expect as unwrap } from '@ie/shared';
import { fold, type GameEvent, type GameState } from './events.js';
import {
  addSceneLandmark,
  beginCombat,
  declareCreatureDead,
  declareCreatureSide,
  dismountRider,
  loseItems,
  mountCreature,
  placeCreatureInScene,
  removeBonusFrom,
  setScene,
  stabiliseCreature,
  swapInitiativeBetween,
  useFreeObjectInteraction,
} from './commands.js';
import { armorClass, type CharacterSheet } from './character.js';
import { mountingCost, mountOf, positionOf } from './positioning.js';
import { movementLeftFor } from './standing.js';

/**
 * The other nine facts a DM declares.
 *
 * Nine of the ninety-one declared event types were emitted by no engine code
 * at all, so a tool surface — which calls commands and never folds events
 * itself — could not reach them. `commands/scene.ts` closed the eight that set
 * up a world; these are the rest, and they follow that file's four decisions
 * rather than inventing a second set:
 *
 * - **The command is its event's name read as an imperative**, lengthened
 *   where the pure function beneath already owns the plain verb — `mount`,
 *   `dismount`, `swapInitiative`, `stabilize` and `useFreeInteraction` are all
 *   exported from `index.ts`, so all five commands are lengthened.
 * - **A command refuses exactly what the reducer would call corrupt**, plus
 *   the rules the pure function beneath it already knows, and nothing more.
 * - **A missing fact is homework**, and the request says which fact.
 * - **`mayAct` is decided per command on the rule**, not on the family: the
 *   three that spend from the turn economy consult it and the six that
 *   declare a fact do not. `DECLARED_NOT_ACTED` in `invariants.test.ts` is
 *   where the second half of that is written down and checked.
 */

const id = (s: string) => asCharacterId(s);
const KNIGHT = id('knight');
const SQUIRE = id('squire');
const DESTRIER = id('destrier');
const GROOM = id('groom');

const sheet = (): CharacterSheet => ({
  level: 3,
  abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 12, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const added = (who: string, side?: string): GameEvent => ({
  type: 'creature-added',
  id: id(who),
  name: who,
  sheet: sheet(),
  maxHp: 30,
  ...(side === undefined ? {} : { side }),
});

/** A log built through the commands, with event literals only where no command exists. */
class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('declared', this.log);
  }

  get events(): readonly GameEvent[] {
    return this.log;
  }

  push(events: readonly GameEvent[]): void {
    this.log.push(...events);
    // Folding after every push is what makes a corrupt batch loud here rather
    // than three steps later.
    void this.state;
  }

  do(what: string, run: (state: GameState) => ReturnType<typeof setScene>): readonly GameEvent[] {
    const out = unwrap(run(this.state), what);
    this.push(out);
    return out;
  }
}

/** Three creatures in a yard, with the destrier Large so it can be ridden. */
const yard = (): Table => {
  const table = new Table();
  table.push([
    added('knight', 'party'),
    added('squire', 'party'),
    added('destrier'),
    added('groom', 'party'),
  ]);
  table.do('the yard', (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
  table.do('the post', (s) => addSceneLandmark(s, 'the post', { x: 100, y: 100, z: 0 }));
  table.do('the knight', (s) =>
    placeCreatureInScene(s, KNIGHT, { from: { landmark: 'the post' }, feet: 0 }),
  );
  table.do('the destrier', (s) =>
    placeCreatureInScene(s, DESTRIER, {
      from: { creature: KNIGHT },
      feet: 5,
      bearing: 90,
      size: 'large',
    }),
  );
  // The squire stands beside the knight, because `mount` checks the reach
  // before the size and a fixture 30 feet away can never reach `too_small`.
  table.do('the squire', (s) =>
    placeCreatureInScene(s, SQUIRE, { from: { landmark: 'the post' }, feet: 5, bearing: 180 }),
  );
  // …and the groom is across the yard, which is the only thing that makes the
  // reach check the one doing the refusing.
  table.do('the groom', (s) =>
    placeCreatureInScene(s, GROOM, { from: { landmark: 'the post' }, feet: 40, bearing: 180 }),
  );
  return table;
};

/** …and a fight, so the turn economy exists to be spent from. */
const fighting = (): Table => {
  const table = yard();
  table.do('the fight', (s) =>
    beginCombat(s, [
      { id: KNIGHT, initiative: 20, speed: 30 },
      { id: SQUIRE, initiative: 10, speed: 30 },
      { id: DESTRIER, initiative: 5, speed: 60 },
      { id: GROOM, initiative: 1, speed: 30 },
    ]),
  );
  return table;
};

describe('a side is declared, and re-declared when the fiction changes', () => {
  it('records it and the fold reads it back', () => {
    const table = yard();
    table.do('bribing the squire', (s) => declareCreatureSide(s, SQUIRE, 'bandits'));
    expect(table.state.creatures[SQUIRE]?.side).toBe('bandits');
  });

  it('tells a retry under one id that its command landed', () => {
    const table = yard();
    table.do('bribing the squire', (s) =>
      declareCreatureSide(s, SQUIRE, 'bandits', { commandId: 'the-bribe' }),
    );
    expect(
      unwrap(declareCreatureSide(table.state, SQUIRE, 'bandits', { commandId: 'the-bribe' }), 'retry'),
    ).toEqual([]);
  });

  /**
   * **Unlike a creature's type, allegiance is not durable.** `events.ts` says
   * so in the event's own docstring — "a bandit is bribed, a charmed ally
   * turns" — and the reducer overwrites rather than throwing, so a command
   * refusing a contradiction would be refusing something the log permits.
   */
  it('lets a bribed bandit be bribed back', () => {
    const table = yard();
    table.do('bribed', (s) => declareCreatureSide(s, SQUIRE, 'bandits'));
    table.do('bribed back', (s) => declareCreatureSide(s, SQUIRE, 'party'));
    expect(table.state.creatures[SQUIRE]?.side).toBe('party');
  });

  it('asks about a creature nobody has mentioned', () => {
    const out = declareCreatureSide(yard().state, id('nobody'), 'party');
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.kind)).toEqual(['creature']);
  });
});

describe('mounting and dismounting spend half the rider’s Speed', () => {
  /** SRD: "Doing so costs an amount of movement equal to half your Speed (round down)." */
  it('spends half the Speed and records the ride', () => {
    const table = fighting();
    const before = movementLeftFor(table.state, KNIGHT) ?? 0;
    table.do('up', (s) => mountCreature(s, KNIGHT, DESTRIER, { willing: true }));

    expect(mountOf(table.state.scene!, KNIGHT)).toBe(DESTRIER);
    expect(movementLeftFor(table.state, KNIGHT)).toBe(before - mountingCost(30));
    expect(mountingCost(30)).toBe(15);
  });

  /** The rider goes with the mount, which is `mount`'s own rule surfaced. */
  it('puts the rider above the mount', () => {
    const table = fighting();
    const on = positionOf(table.state.scene!, DESTRIER)!;
    table.do('up', (s) => mountCreature(s, KNIGHT, DESTRIER, { willing: true }));
    const rider = positionOf(table.state.scene!, KNIGHT)!;
    expect([rider.x, rider.y]).toEqual([on.x, on.y]);
    expect(rider.z).toBeGreaterThan(on.z);
  });

  it('tells a retry under one id that its command landed', () => {
    const table = fighting();
    table.do('up', (s) =>
      mountCreature(s, KNIGHT, DESTRIER, { willing: true }, { commandId: 'leap-up' }),
    );
    expect(
      unwrap(
        mountCreature(table.state, KNIGHT, DESTRIER, { willing: true }, { commandId: 'leap-up' }),
        'retry',
      ),
    ).toEqual([]);
  });

  /**
   * SRD says nothing about leaping onto a hostile dragon, which is among the
   * most-attempted moves at any table — so it is recorded, not refused.
   */
  it('records an unwilling mount rather than refusing it', () => {
    const table = fighting();
    table.do('clinging on', (s) => mountCreature(s, KNIGHT, DESTRIER, { willing: false }));
    expect(table.state.scene?.riding[KNIGHT]).toEqual({ mount: DESTRIER, willing: false });
  });

  it('dismounts to a place, spending the same again', () => {
    const table = fighting();
    table.do('up', (s) => mountCreature(s, KNIGHT, DESTRIER, { willing: true }));
    const before = movementLeftFor(table.state, KNIGHT) ?? 0;
    table.do('down', (s) =>
      dismountRider(s, KNIGHT, { from: { landmark: 'the post' }, feet: 5, bearing: 270 }),
    );

    expect(mountOf(table.state.scene!, KNIGHT)).toBeNull();
    expect(movementLeftFor(table.state, KNIGHT)).toBe(before - mountingCost(30));
  });

  it('tells a dismount retry under one id that its command landed', () => {
    const table = fighting();
    table.do('up', (s) => mountCreature(s, KNIGHT, DESTRIER, { willing: true }));
    const placement = { from: { landmark: 'the post' }, feet: 5, bearing: 270 } as const;
    table.do('down', (s) => dismountRider(s, KNIGHT, placement, { commandId: 'get-down' }));
    expect(
      unwrap(dismountRider(table.state, KNIGHT, placement, { commandId: 'get-down' }), 'retry'),
    ).toEqual([]);
  });

  it('refuses a mount that is not larger', () => {
    const table = fighting();
    const out = mountCreature(table.state, KNIGHT, SQUIRE, { willing: true });
    expect(isErr(out) ? out.code : 'ok').toBe('too_small');
  });

  it('refuses a mount out of reach', () => {
    const out = mountCreature(fighting().state, GROOM, DESTRIER, { willing: true });
    expect(isErr(out) ? out.code : 'ok').toBe('out_of_reach');
  });

  it('refuses a rider who is already riding something', () => {
    const table = fighting();
    table.do('up', (s) => mountCreature(s, KNIGHT, DESTRIER, { willing: true }));
    const out = mountCreature(table.state, KNIGHT, DESTRIER, { willing: true });
    expect(isErr(out) ? out.code : 'ok').toBe('already_riding');
  });

  it('refuses dismounting when nobody is riding', () => {
    const out = dismountRider(fighting().state, KNIGHT, { from: { landmark: 'the post' }, feet: 5 });
    expect(isErr(out) ? out.code : 'ok').toBe('not_riding');
  });

  /**
   * A rider who has run out of Speed cannot climb up, and the refusal is
   * `spendMovement`'s. The knight Dashes nowhere: a 30-foot move first, which
   * leaves 0 and therefore less than the 15 this costs.
   */
  it('refuses a mount the rider cannot afford', () => {
    const table = fighting();
    const spent: readonly GameEvent[] = [{ type: 'movement-spent', id: KNIGHT, feet: 30 }];
    table.push(spent);
    const out = mountCreature(table.state, KNIGHT, DESTRIER, { willing: true });
    expect(isErr(out) ? out.code : 'ok').toBe('not_enough_movement');
  });

  /**
   * Outside combat there is no budget to spend from, so nothing is spent and
   * the ride still happens — the reading `resolveMove` already takes.
   */
  it('costs nothing outside combat', () => {
    const table = yard();
    const out = table.do('up', (s) => mountCreature(s, KNIGHT, DESTRIER, { willing: true }));
    expect(out.map((e) => e.type)).toEqual(['mounted']);
  });

  it('asks for a scene when there is none', () => {
    const table = new Table();
    table.push([added('knight'), added('destrier')]);
    const out = mountCreature(table.state, KNIGHT, DESTRIER, { willing: true });
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.kind)).toEqual(['scene']);
  });

  it('asks where an unplaced mount is standing', () => {
    const table = new Table();
    table.push([added('knight'), added('destrier')]);
    table.do('the yard', (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
    table.do('the post', (s) => addSceneLandmark(s, 'the post', { x: 100, y: 100, z: 0 }));
    table.do('the knight', (s) =>
      placeCreatureInScene(s, KNIGHT, { from: { landmark: 'the post' }, feet: 0 }),
    );

    const out = mountCreature(table.state, KNIGHT, DESTRIER, { willing: true });
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => [r.kind, r.subject])).toEqual([
      ['position', DESTRIER],
    ]);
  });
});

describe('the free object interaction is spent once a turn', () => {
  it('spends it, and a second one is refused', () => {
    const table = fighting();
    table.do('the door', (s) => useFreeObjectInteraction(s, KNIGHT));
    expect(table.state.combat?.budgets[KNIGHT]?.freeInteraction).toBe(false);

    const again = useFreeObjectInteraction(table.state, KNIGHT);
    expect(isErr(again) ? again.code : 'ok').toBe('no_free_interaction');
  });

  it('tells a retry under one id that its command landed', () => {
    const table = fighting();
    table.do('the door', (s) => useFreeObjectInteraction(s, KNIGHT, { commandId: 'the-door' }));
    expect(
      unwrap(useFreeObjectInteraction(table.state, KNIGHT, { commandId: 'the-door' }), 'retry'),
    ).toEqual([]);
  });

  /**
   * SRD limits interactions "when time is short, such as in combat". Out of
   * combat there is no per-turn allowance to spend, and the reducer throws for
   * an event with no combat — so the command refuses rather than writing one.
   */
  it('refuses outside combat, where nothing is limited', () => {
    const out = useFreeObjectInteraction(yard().state, KNIGHT);
    expect(isErr(out) ? out.code : 'ok').toBe('not_in_combat');
  });

  it('refuses somebody whose turn it is not', () => {
    const out = useFreeObjectInteraction(fighting().state, SQUIRE);
    expect(isErr(out) ? out.code : 'ok').toBe('not_their_turn');
  });
});

describe('Initiative can be swapped, which is the event Alert asks for', () => {
  it('swaps the two and rebuilds the order', () => {
    const table = fighting();
    const before = table.state.combat!.order.map((c) => [c.id, c.initiative]);
    table.do('the swap', (s) => swapInitiativeBetween(s, KNIGHT, SQUIRE));
    const after = table.state.combat!.order;

    expect(after.find((c) => c.id === KNIGHT)?.initiative).toBe(10);
    expect(after.find((c) => c.id === SQUIRE)?.initiative).toBe(20);
    expect(before).not.toEqual(after.map((c) => [c.id, c.initiative]));
  });

  it('tells a retry under one id that its command landed', () => {
    const table = fighting();
    table.do('the swap', (s) => swapInitiativeBetween(s, KNIGHT, SQUIRE, { commandId: 'alert' }));
    expect(
      unwrap(swapInitiativeBetween(table.state, KNIGHT, SQUIRE, { commandId: 'alert' }), 'retry'),
    ).toEqual([]);
  });

  it('refuses a creature swapping with itself', () => {
    const out = swapInitiativeBetween(fighting().state, KNIGHT, KNIGHT);
    expect(isErr(out) ? out.code : 'ok').toBe('same_combatant');
  });

  /**
   * SRD Alert: "You can't make this swap if you or the ally has the
   * Incapacitated condition." `swapInitiative` has taken both creatures'
   * conditions since it was written, and the **reducer** passes neither — so
   * this rule was reachable from nothing at all until a command read them off
   * the creatures it was given.
   */
  it('refuses while either of them is Incapacitated', () => {
    const table = fighting();
    table.push([
      { type: 'condition-applied', id: SQUIRE, condition: 'stunned', source: 'a blow' },
    ]);
    const out = swapInitiativeBetween(table.state, KNIGHT, SQUIRE);
    expect(isErr(out) ? out.code : 'ok').toBe('incapacitated');
  });

  /** Out of combat there is no order, and the reducer throws for the event. */
  it('refuses outside combat', () => {
    const out = swapInitiativeBetween(yard().state, KNIGHT, SQUIRE);
    expect(isErr(out) ? out.code : 'ok').toBe('not_in_combat');
  });

  it('asks about a creature nobody has mentioned', () => {
    const table = fighting();
    const out = swapInitiativeBetween(table.state, KNIGHT, id('a-passer-by'));
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => [r.kind, r.subject])).toEqual([
      ['creature', id('a-passer-by')],
    ]);
  });

  /**
   * **And refuses a bystander outright, which is the other half of one code.**
   * `swapInitiative` answers `unknown_combatant` for both, and they are not the
   * same miss: the Initiative order is the engine's own ledger, written by
   * `startCombat` and complete, so a creature it knows who is not in it is a
   * fact rather than a gap. Answering with the `creature` request would
   * prescribe a `creature-added` that is both false — the ostler exists — and
   * unreachable, since nothing would make an existing creature a combatant.
   *
   * A creature the engine has never heard of cannot tell the two cases apart,
   * which is why this fixture puts a real one outside the fight.
   */
  it('refuses a creature who is in the game but not in the fight', () => {
    const table = yard();
    table.push([added('ostler', 'party')]);
    table.do('the fight', (s) =>
      beginCombat(s, [
        { id: KNIGHT, initiative: 20, speed: 30 },
        { id: SQUIRE, initiative: 10, speed: 30 },
      ]),
    );

    const out = swapInitiativeBetween(table.state, KNIGHT, id('ostler'));
    expect(isErr(out) ? out.code : 'ok').toBe('unknown_combatant');
    expect(isNeedsContext(out)).toBe(false);
    expect(isErr(out) ? out.reason : '').toContain('ostler');
  });
});

describe('a dying creature can be stabilised', () => {
  const dying = (): Table => {
    const table = yard();
    table.push([
      { type: 'damage-taken', id: SQUIRE, amount: 30, source: 'a spear' },
      { type: 'condition-applied', id: SQUIRE, condition: 'unconscious', source: 'zero hit points' },
    ]);
    return table;
  };

  it('records it and the fold reads it back', () => {
    const table = dying();
    expect(table.state.creatures[SQUIRE]?.vitals.stable).toBe(false);
    table.do('the kit', (s) => stabiliseCreature(s, SQUIRE));
    expect(table.state.creatures[SQUIRE]?.vitals.stable).toBe(true);
  });

  it('tells a retry under one id that its command landed', () => {
    const table = dying();
    table.do('the kit', (s) => stabiliseCreature(s, SQUIRE, { commandId: 'the-kit' }));
    expect(
      unwrap(stabiliseCreature(table.state, SQUIRE, { commandId: 'the-kit' }), 'retry'),
    ).toEqual([]);
  });

  /** SRD stabilises "a creature with 0 Hit Points", and nobody else. */
  it('refuses a creature who is not dying', () => {
    const out = stabiliseCreature(yard().state, SQUIRE);
    expect(isErr(out) ? out.code : 'ok').toBe('not_dying');
  });

  /** A corpse is Raise Dead's business, which is the rule `healCreature` takes. */
  it('asks about a creature nobody has mentioned', () => {
    expect(isNeedsContext(stabiliseCreature(yard().state, id('nobody')))).toBe(true);
  });

  it('refuses a corpse', () => {
    const table = dying();
    table.push([{ type: 'creature-died', id: SQUIRE, cause: 'the spear finished it' }]);
    const out = stabiliseCreature(table.state, SQUIRE);
    expect(isErr(out) ? out.code : 'ok').toBe('dead');
  });
});

describe('death that is not hit-point loss is declared', () => {
  it('records it with its cause and the fold reads it back', () => {
    const table = yard();
    table.do('the word', (s) => declareCreatureDead(s, SQUIRE, 'Power Word Kill'));
    expect(table.state.creatures[SQUIRE]?.vitals.dead).toBe(true);
    expect(table.state.creatures[SQUIRE]?.vitals.hp).toBe(0);
  });

  it('tells a retry under one id that its command landed', () => {
    const table = yard();
    table.do('the word', (s) =>
      declareCreatureDead(s, SQUIRE, 'Power Word Kill', { commandId: 'the-word' }),
    );
    expect(
      unwrap(
        declareCreatureDead(table.state, SQUIRE, 'Power Word Kill', { commandId: 'the-word' }),
        'retry',
      ),
    ).toEqual([]);
  });

  /**
   * Dying again is not a thing that happened, so nothing is written — the
   * rule `declareCreatureType` already takes for a fact that is already true.
   */
  it('writes nothing for a creature already dead', () => {
    const table = yard();
    table.do('the word', (s) => declareCreatureDead(s, SQUIRE, 'Power Word Kill'));
    expect(unwrap(declareCreatureDead(table.state, SQUIRE, 'the fall'), 'again')).toEqual([]);
  });

  it('asks about a creature nobody has mentioned', () => {
    const out = declareCreatureDead(yard().state, id('nobody'), 'off-screen');
    expect(isNeedsContext(out)).toBe(true);
  });
});

describe('a DM can take something away', () => {
  const carrying = (): Table => {
    const table = yard();
    table.push([
      {
        type: 'items-gained',
        id: KNIGHT,
        items: [
          { id: 'rations', quantity: 5 },
          { id: 'chain-shirt', quantity: 1 },
        ],
        source: 'a kit',
      },
    ]);
    return table;
  };

  it('records it and the fold reads the inventory back', () => {
    const table = carrying();
    table.do('the thief', (s) =>
      loseItems(s, KNIGHT, [{ id: 'rations', quantity: 2 }], 'a thief in the night'),
    );
    expect(table.state.creatures[KNIGHT]?.inventory).toContainEqual({ id: 'rations', quantity: 3 });
  });

  it('tells a retry under one id that its command landed', () => {
    const table = carrying();
    const items = [{ id: 'rations', quantity: 2 }];
    table.do('the thief', (s) => loseItems(s, KNIGHT, items, 'a thief', { commandId: 'the-theft' }));
    expect(
      unwrap(loseItems(table.state, KNIGHT, items, 'a thief', { commandId: 'the-theft' }), 'retry'),
    ).toEqual([]);
  });

  /**
   * **Losing more than is owned is refused rather than clamped.**
   * `removeItems` folds the loss in as a negative quantity and drops any line
   * that reaches zero, so five rations taken from two silently succeeds and
   * leaves none — a wrong number nothing else would catch.
   */
  it('refuses taking more than is carried', () => {
    const out = loseItems(carrying().state, KNIGHT, [{ id: 'rations', quantity: 9 }], 'a thief');
    expect(isErr(out) ? out.code : 'ok').toBe('not_owned');
  });

  /**
   * **Owning and wearing are two facts, and one command may not change the
   * other behind its back.** `items-lost` does not touch `equipped`, so taking
   * away a worn chain shirt would leave it worn and still adding its Armour
   * Class — the "chain mail in a backpack" bug, inverted.
   */
  it('refuses taking something that is being worn', () => {
    const table = carrying();
    table.push([{ type: 'item-equipped', id: KNIGHT, item: 'chain-shirt' }]);
    expect(armorClass(table.state.creatures[KNIGHT]!.sheet)).toBeGreaterThan(10);

    const out = loseItems(table.state, KNIGHT, [{ id: 'chain-shirt', quantity: 1 }], 'a mimic');
    expect(isErr(out) ? out.code : 'ok').toBe('equipped');
  });

  it('refuses a quantity that is not a count', () => {
    const out = loseItems(carrying().state, KNIGHT, [{ id: 'rations', quantity: 0 }], 'a thief');
    expect(isErr(out) ? out.code : 'ok').toBe('bad_quantity');
  });

  it('refuses a loss that names nothing', () => {
    const out = loseItems(carrying().state, KNIGHT, [], 'a thief');
    expect(isErr(out) ? out.code : 'ok').toBe('no_items');
  });

  it('asks about a creature nobody has mentioned', () => {
    const out = loseItems(yard().state, id('nobody'), [{ id: 'rations', quantity: 1 }], 'a thief');
    expect(isNeedsContext(out)).toBe(true);
  });
});

describe('a bonus no casting hung can be removed', () => {
  const blessed = (): Table => {
    const table = yard();
    table.push([
      {
        type: 'bonus-applied',
        id: KNIGHT,
        bonus: {
          source: 'the abbot’s blessing',
          bonus: { source: 'the abbot’s blessing', flat: 2 },
          applies: ['save'],
          direction: 'add',
        },
      },
    ]);
    return table;
  };

  it('records it and the fold drops the bonus', () => {
    const table = blessed();
    expect(table.state.creatures[KNIGHT]?.bonuses).toHaveLength(1);
    table.do('it wears off', (s) => removeBonusFrom(s, KNIGHT, 'the abbot’s blessing'));
    expect(table.state.creatures[KNIGHT]?.bonuses).toEqual([]);
  });

  it('tells a retry under one id that its command landed', () => {
    const table = blessed();
    table.do('it wears off', (s) =>
      removeBonusFrom(s, KNIGHT, 'the abbot’s blessing', { commandId: 'wears-off' }),
    );
    expect(
      unwrap(
        removeBonusFrom(table.state, KNIGHT, 'the abbot’s blessing', { commandId: 'wears-off' }),
        'retry',
      ),
    ).toEqual([]);
  });

  /** A bonus that was never there stopping is not a thing that happened. */
  it('writes nothing when the creature carries no such bonus', () => {
    expect(unwrap(removeBonusFrom(blessed().state, KNIGHT, 'a rumour'), 'nothing')).toEqual([]);
  });

  it('asks about a creature nobody has mentioned', () => {
    const out = removeBonusFrom(yard().state, id('nobody'), 'anything');
    expect(isNeedsContext(out)).toBe(true);
  });
});

/**
 * A refusal that is the reducer's own, and the two that are not.
 *
 * "The validation is the pure function's, not a second copy" is a slogan until
 * it is made precise enough to test, and `scene-commands.test.ts` supplied the
 * precise form: pair each refusal with the event the command declined to write,
 * fold it, and assert it throws. That is what shows the two agree rather than
 * merely both existing.
 *
 * These nine commands split on it, and the split is the interesting part. Most
 * refuse exactly what the reducer calls corrupt — `must(mount(...))`,
 * `must(useFreeInteraction(...))`, `must(swapInitiative(...))` and
 * `creatureOf` all throw for the same case. Two refuse **more**, on rules the
 * reducer has no way to apply, and those are named in `NOT_THE_REDUCER'S`
 * below rather than quietly left out of the table.
 */
describe('a declared-fact command refuses what the reducer would call corrupt', () => {
  const corrupt: readonly {
    readonly name: string;
    readonly code: string;
    readonly log: () => Table;
    readonly run: (state: GameState) => ReturnType<typeof setScene>;
    readonly forged: () => GameEvent;
  }[] = [
    {
      name: 'mounting something no larger than you',
      code: 'too_small',
      log: fighting,
      run: (s) => mountCreature(s, KNIGHT, SQUIRE, { willing: true }),
      forged: () => ({ type: 'mounted', rider: KNIGHT, mount: SQUIRE, willing: true }),
    },
    {
      name: 'mounting something out of reach',
      code: 'out_of_reach',
      log: fighting,
      run: (s) => mountCreature(s, GROOM, DESTRIER, { willing: true }),
      forged: () => ({ type: 'mounted', rider: GROOM, mount: DESTRIER, willing: true }),
    },
    {
      name: 'getting down off nothing',
      code: 'not_riding',
      log: fighting,
      run: (s) => dismountRider(s, KNIGHT, { from: { landmark: 'the post' }, feet: 5, bearing: 270 }),
      forged: () => ({
        type: 'dismounted',
        rider: KNIGHT,
        placement: { from: { landmark: 'the post' }, feet: 5, bearing: 270 },
      }),
    },
    {
      name: 'interacting with a second object',
      code: 'no_free_interaction',
      log: () => {
        const table = fighting();
        table.do('the door', (s) => useFreeObjectInteraction(s, KNIGHT));
        return table;
      },
      run: (s) => useFreeObjectInteraction(s, KNIGHT),
      forged: () => ({ type: 'free-interaction-used', id: KNIGHT }),
    },
    {
      name: 'interacting outside combat',
      code: 'not_in_combat',
      log: yard,
      run: (s) => useFreeObjectInteraction(s, KNIGHT),
      forged: () => ({ type: 'free-interaction-used', id: KNIGHT }),
    },
    {
      name: 'swapping Initiative with yourself',
      code: 'same_combatant',
      log: fighting,
      run: (s) => swapInitiativeBetween(s, KNIGHT, KNIGHT),
      forged: () => ({ type: 'initiative-swapped', a: KNIGHT, b: KNIGHT }),
    },
    {
      name: 'swapping Initiative outside combat',
      code: 'not_in_combat',
      log: yard,
      run: (s) => swapInitiativeBetween(s, KNIGHT, SQUIRE),
      forged: () => ({ type: 'initiative-swapped', a: KNIGHT, b: SQUIRE }),
    },
    {
      name: 'stabilising somebody nobody has mentioned',
      code: 'unknown_creature',
      log: yard,
      run: (s) => stabiliseCreature(s, id('nobody')),
      forged: () => ({ type: 'stabilised', id: id('nobody') }),
    },
    {
      name: 'taking something from somebody nobody has mentioned',
      code: 'unknown_creature',
      log: yard,
      run: (s) => loseItems(s, id('nobody'), [{ id: 'rations', quantity: 1 }], 'a thief'),
      forged: () => ({
        type: 'items-lost',
        id: id('nobody'),
        items: [{ id: 'rations', quantity: 1 }],
        source: 'a thief',
      }),
    },
  ];

  for (const entry of corrupt) {
    it(`${entry.name} is refused, and nothing is spent`, () => {
      const table = entry.log();
      const before = table.state;
      const out = entry.run(before);
      expect(isErr(out) ? out.code : 'ok').toBe(entry.code);
      expect(table.state).toEqual(before);
    });

    it(`${entry.name} is what the reducer would call corrupt`, () => {
      const table = entry.log();
      let thrown: unknown = null;
      try {
        fold('declared', [...table.events, entry.forged()]);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).name).toBe('CorruptLogError');
    });
  }

  /**
   * And the two that go further, each with the rule that takes it there.
   *
   * A command may refuse more than the reducer — `healCreature` has refused a
   * corpse since healing landed, and no `healed` event is corrupt for one.
   * What it may not do is refuse *silently*, so these are written down beside
   * the table that holds every other refusal to the reducer's own line.
   */
  const NOT_THE_REDUCERS: Readonly<Record<string, string>> = {
    stabiliseCreature:
      'SRD stabilises "a creature with 0 Hit Points", and the reducer would fold a `stabilised` for a healthy creature quite happily — setting `stable` on somebody who was never dying. A corpse is refused on the rule `healCreature` already takes: hit points alone do not raise the dead',
    loseItems:
      '`removeItems` folds a loss in as a negative quantity and drops any line that reaches zero, so taking five rations from two is not corrupt — it silently succeeds and leaves none. And `items-lost` does not touch `equipped`, so confiscating worn armour would leave it worn and still adding its Armour Class',
  };

  it('names the commands that refuse more than the reducer would', () => {
    expect(Object.keys(NOT_THE_REDUCERS).sort()).toEqual(['loseItems', 'stabiliseCreature']);
    expect(Object.values(NOT_THE_REDUCERS).every((why) => why.length > 40)).toBe(true);
  });

  /** And the claim is checked: the fold really does accept both of those. */
  it('and the fold really does accept the events they decline to write', () => {
    const healthy = yard();
    expect(() =>
      fold('declared', [...healthy.events, { type: 'stabilised', id: KNIGHT }]),
    ).not.toThrow();

    const carrying = yard();
    carrying.push([
      { type: 'items-gained', id: KNIGHT, items: [{ id: 'rations', quantity: 2 }], source: 'a kit' },
    ]);
    expect(() =>
      fold('declared', [
        ...carrying.events,
        { type: 'items-lost', id: KNIGHT, items: [{ id: 'rations', quantity: 5 }], source: 'a thief' },
      ]),
    ).not.toThrow();
  });
});
