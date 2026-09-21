/**
 * Three rooms the engine finished and nothing above it could reach.
 *
 * Each of these commands has been correct, tested and exported for as long as
 * its subsystem has existed, and no tool on either surface called any of them.
 * That is the gap `doors.test.ts` was written about, found once more by
 * counting the other way — from the engine's exports towards the surface,
 * rather than from a refusal towards a field.
 *
 * - **`mountCreature` / `dismountRider`** — SRD's Mounted Combat, half a
 *   Speed each way, and the reason a Paladin's Faithful Steed had nowhere at
 *   all to go: the engine could seat a rider and the session could not ask it
 *   to.
 * - **`useFreeObjectInteraction`** — the one object interaction a turn. It is
 *   the smallest thing in the action economy and the only budget field with no
 *   door, so a session could open a door, draw a sword and sheathe another in
 *   the same six seconds with the engine recording none of it.
 * - **`swapInitiativeBetween`** — SRD Alert's swap. The engine owns the
 *   arithmetic and the Incapacitated clause; whether the feat offers it at that
 *   moment is a ruling the table makes, which is what makes this a declaration
 *   rather than a feature.
 *
 * None of the three takes a number the caller produced. A mount is a creature
 * and a placement measured on the lattice; an interaction is a budget field
 * the engine flips; a swap is two ids and the engine's own order.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

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
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, surface, call };
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

/**
 * A rider, a Large creature to ride, and a room to do it in.
 *
 * The steed is placed Large because a character's record pins no size — SRD's
 * mount must be "at least one size larger than a rider", and `place_creature`
 * is the one door that takes a size for exactly the creature whose record
 * pinned none.
 */
function stables(seed = 'stables') {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
  expectOk(t.call('create_character', { id: 'hoof', choices: fighter('Hoof') }));
  expectOk(t.call('declare_side', { who: 'bram', side: 'party' }));
  expectOk(t.call('declare_side', { who: 'hoof', side: 'party' }));
  expectOk(t.call('set_scene', { width: 60, depth: 60, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the post', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'bram', fromLandmark: 'the post', feet: 0 }));
  expectOk(
    t.call('place_creature', {
      who: 'hoof',
      size: 'large',
      fromCreature: 'bram',
      feet: 5,
      bearing: 90,
    }),
  );
  return t;
}

describe('a rider gets up and gets down again', () => {
  it('seats the rider on the mount, and records whether it wanted to be ridden', () => {
    const t = stables();
    const up = expectOk(t.call('mount', { rider: 'bram', mount: 'hoof', willing: true }));

    const seated = up.events.find((event) => event.type === 'mounted');
    expect(seated?.type === 'mounted' && seated.rider).toBe('bram');
    expect(seated?.type === 'mounted' && seated.mount).toBe('hoof');
    expect(seated?.type === 'mounted' && seated.willing).toBe(true);
    expect(up.resolution['mounted']).toBe('hoof');
  });

  /**
   * The house case, recorded rather than refused. SRD covers a *willing*
   * creature and says nothing about leaping onto a hostile one, so `false`
   * reaches the log as a fact about the ride and the field has to carry it.
   */
  it('records an unwilling mount as unwilling, rather than refusing it', () => {
    const t = stables('unwilling');
    const up = expectOk(t.call('mount', { rider: 'bram', mount: 'hoof', willing: false }));
    const seated = up.events.find((event) => event.type === 'mounted');
    expect(seated?.type === 'mounted' && seated.willing).toBe(false);
    expect(up.resolution['willing']).toBe(false);
  });

  /** And the state took: a second climb is refused by the engine's own rule. */
  it('refuses a second climb onto anything, because the rider is already up', () => {
    const t = stables();
    expectOk(t.call('mount', { rider: 'bram', mount: 'hoof', willing: true }));
    const again = expectRefused(t.call('mount', { rider: 'bram', mount: 'hoof', willing: true }));
    expect(again.code).toBe('already_riding');
  });

  it('gets down into a placement the engine measures, not one the caller asserts', () => {
    const t = stables();
    expectOk(t.call('mount', { rider: 'bram', mount: 'hoof', willing: true }));

    const down = expectOk(
      t.call('dismount', { rider: 'bram', fromCreature: 'hoof', feet: 5, bearing: 270 }),
    );
    expect(down.events.some((event) => event.type === 'dismounted')).toBe(true);
    expect(down.resolution['dismounted']).toBe('bram');

    // The placement is the one the caller asked for and the engine measured:
    // five feet off the mount, on the lattice.
    expect(t.surface.observe().creatures.find((c) => c.id === 'bram')!.feetTo['hoof']).toBe(5);

    // Down and free: the rider can climb back on.
    expectOk(t.call('mount', { rider: 'bram', mount: 'hoof', willing: true }));
  });

  /**
   * The refusal `mountCreature` turns into a request, arriving through the
   * door with the tool that answers it named.
   */
  it('asks where somebody is standing rather than refusing, when nobody has said', () => {
    const t = table('unplaced');
    expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
    expectOk(t.call('create_character', { id: 'hoof', choices: fighter('Hoof') }));
    expectOk(t.call('set_scene', { width: 60, depth: 60, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the post', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'bram', fromLandmark: 'the post', feet: 0 }));

    const asked = t.call('mount', { rider: 'bram', mount: 'hoof', willing: true });
    expect(asked.status).toBe('needs-context');
    if (asked.status !== 'needs-context') return;
    expect(asked.establish[0]!.kind).toBe('position');
    expect(asked.establish[0]!.tools).toContain('place_creature');
  });

  it('refuses a mount no larger than the rider, which is the book’s rule', () => {
    const t = table('too-small');
    expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
    expectOk(t.call('create_character', { id: 'pip', choices: fighter('Pip') }));
    expectOk(t.call('set_scene', { width: 60, depth: 60, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the post', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'bram', fromLandmark: 'the post', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'pip', fromCreature: 'bram', feet: 5, bearing: 90 }));

    const refused = expectRefused(t.call('mount', { rider: 'bram', mount: 'pip', willing: true }));
    expect(refused.code).toBe('too_small');
  });
});

/** A fight with the two of them in it, for the two doors that need turns. */
function fight(seed = 'the-turn') {
  const t = stables(seed);
  expectOk(t.call('declare_sight', { from: 'bram', to: 'hoof', seen: true }));
  expectOk(t.call('declare_sight', { from: 'hoof', to: 'bram', seen: true }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'bram' }, { who: 'hoof' }] }));
  return t;
}

describe('the one object interaction a turn', () => {
  it('is spent once and refused the second time in the same turn', () => {
    const t = fight();
    const whose = t.surface.observe().turnOf!;

    const first = expectOk(t.call('use_free_interaction', { who: whose }));
    expect(first.events.some((event) => event.type === 'free-interaction-used')).toBe(true);
    expect(first.resolution['interacted']).toBe(whose);

    const second = expectRefused(t.call('use_free_interaction', { who: whose }));
    expect(second.code).toBe('no_free_interaction');
  });

  /** And the next turn brings a fresh one, because the allowance is per turn. */
  it('comes back when the turn does', () => {
    const t = fight();
    const first = t.surface.observe().turnOf!;
    expectOk(t.call('use_free_interaction', { who: first }));
    expectOk(t.call('end_turn', {}));

    const second = t.surface.observe().turnOf!;
    expect(second).not.toBe(first);
    expectOk(t.call('use_free_interaction', { who: second }));
  });

  /**
   * Outside a fight there is no turn to spend one on, which is the one place
   * this differs from a Dodge: the allowance exists only because time is short.
   */
  it('refuses outside a fight, where there is no turn to limit', () => {
    const t = stables('no-fight');
    const refused = expectRefused(t.call('use_free_interaction', { who: 'bram' }));
    expect(refused.code).toBe('not_in_combat');
  });
});

describe('two combatants trade places in the order', () => {
  it('swaps them, and the order is the engine’s afterwards', () => {
    const t = fight('swap');
    const before = t.surface.observe().initiativeOrder!;
    expect(before).toHaveLength(2);

    const swapped = expectOk(
      t.call('swap_initiative', { combatant: before[0]!, ally: before[1]! }),
    );
    expect(swapped.events.some((event) => event.type === 'initiative-swapped')).toBe(true);

    const after = t.surface.observe().initiativeOrder!;
    expect(after).toEqual([before[1], before[0]]);
    expect(swapped.resolution['order']).toEqual([...after]);
  });

  it('refuses a swap where there is no order to swap in', () => {
    const t = stables('no-order');
    const refused = expectRefused(
      t.call('swap_initiative', { combatant: 'bram', ally: 'hoof' }),
    );
    expect(refused.code).toBe('not_in_combat');
  });

  /**
   * A bystander standing right there is a verdict rather than homework: the
   * Initiative order is the engine's own ledger and complete, so there is
   * nothing for the caller to establish.
   */
  it('tells a bystander apart from a creature nobody has mentioned', () => {
    const t = fight('bystander');
    const inOrder = t.surface.observe().initiativeOrder![0]!;
    expectOk(t.call('create_character', { id: 'watcher', choices: fighter('Watcher') }));

    const refused = expectRefused(
      t.call('swap_initiative', { combatant: inOrder, ally: 'watcher' }),
    );
    expect(refused.code).toBe('unknown_combatant');

    const asked = t.call('swap_initiative', { combatant: inOrder, ally: 'nobody-at-all' });
    expect(asked.status).toBe('needs-context');
  });
});
