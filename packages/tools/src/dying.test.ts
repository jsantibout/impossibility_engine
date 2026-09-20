/**
 * Stopping a dying creature from dying, through `surface.call`.
 *
 * SRD: "You can take the Help action to try to stabilize a creature with 0 Hit
 * Points, which requires a successful DC 10 Wisdom (Medicine) check", and a
 * Healer's Kit does it with no check at all. Either way the *outcome* is a fact
 * about the creature on the floor, which is what `stabiliseCreature` records —
 * and it reached no tool on either surface, so a party could watch somebody
 * bleed out with the engine perfectly able to stop it.
 *
 * **What the tool does not do is decide the check.** It states no number: the
 * DC 10 Medicine check belongs to whoever is kneeling over the body and goes
 * through the check's own door, which is the DM's because a DC is a number
 * this surface does not carry. This records what happened next, on the same
 * rule `apply_condition` already keeps for a ruled condition.
 *
 * It is on the model's surface, which puts it on both: the DM's is a superset.
 * A creature nobody can stabilise from either door was the gap, and a tool on
 * the DM's alone would have left the model-driven half of it open.
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
  classEquipment: 'A',
  backgroundEquipment: 'A',
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

  const rule = (tool: string, input: unknown = {}): ToolOutcome =>
    dm.call({ tool, input, commandId: `dm_${(calls += 1)}` });

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

const seen = (t: ReturnType<typeof table>, id: string) =>
  t.surface.observe().creatures.find((one) => one.id === id)!;

/** A Fighter on the floor at nought hit points, and an ally kneeling over him. */
function bleeding(seed = 'dying') {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
  expectOk(t.call('create_character', { id: 'orin', choices: fighter('Orin') }));
  // Exactly what he has left, because a blow of the maximum over again is
  // instant death and this file is about the creature that is still dying.
  expectOk(
    t.rule('improvised_damage', {
      target: 'bram',
      amount: seen(t, 'bram').hp,
      ruling: 'the portcullis coming down',
    }),
  );
  expect(seen(t, 'bram').hp).toBe(0);
  expect(seen(t, 'bram').dead).toBe(false);
  return t;
}

describe('a creature at nought hit points can be stabilised', () => {
  it('records the stabilising, and the room can see it', () => {
    const t = bleeding();
    // Before: dying, and nothing says otherwise.
    expect(seen(t, 'bram').stable).toBe(false);

    // The check the SRD asks for is the DM's, because a DC is a number this
    // surface does not carry. Orin makes it, and then says what happened.
    expectOk(
      t.rule('ability_check', {
        who: 'orin',
        ability: 'wis',
        skill: 'medicine',
        dc: 10,
        because: 'kneeling over Bram',
      }),
    );
    // Nobody here can push a d20 that has landed, so no window opened and
    // there is nothing to settle: the check is over, and what follows from it
    // is the thing being recorded.

    const stopped = expectOk(t.call('stabilise_creature', { who: 'bram' }));
    expect(stopped.resolution['stabilised']).toBe('bram');
    expect(stopped.events.some((event) => event.type === 'stabilised')).toBe(true);
    expect(seen(t, 'bram').stable).toBe(true);
    expect(seen(t, 'bram').hp).toBe(0);
  });

  it('is a no-op on a retry, under the id the transport already used', () => {
    const t = bleeding();
    expectOk(t.surface.call({ tool: 'stabilise_creature', input: { who: 'bram' }, commandId: 'k' }));
    const before = t.campaign.log().length;

    const again = expectOk(
      t.surface.call({ tool: 'stabilise_creature', input: { who: 'bram' }, commandId: 'k' }),
    );
    expect(again.events).toHaveLength(0);
    expect(t.campaign.log()).toHaveLength(before);
  });

  /** And the DM holds it too, because that surface is a superset of this one. */
  it('is on the DM’s door as well as the model’s', () => {
    const t = bleeding();
    expectOk(t.rule('stabilise_creature', { who: 'bram' }));
    expect(seen(t, 'bram').stable).toBe(true);
  });
});

describe('stabilising is for a creature that is dying, and only that', () => {
  it('refuses a creature that is on its feet, saying what it has left', () => {
    const t = bleeding();
    const out = expectRefused(t.call('stabilise_creature', { who: 'orin' }));
    expect(out.code).toBe('not_dying');
    expect(t.campaign.log().some((event) => event.type === 'stabilised')).toBe(false);
  });

  it('refuses a corpse, because that is Raise Dead’s business', () => {
    const t = bleeding();
    expectOk(
      t.rule('improvised_damage', {
        target: 'bram',
        amount: seen(t, 'bram').hpMax,
        ruling: 'the portcullis a second time',
      }),
    );
    expect(seen(t, 'bram').dead).toBe(true);

    const out = expectRefused(t.call('stabilise_creature', { who: 'bram' }));
    expect(out.code).toBe('dead');
  });

  it('answers a creature nobody has created as homework, not as a verdict', () => {
    const t = bleeding();
    const out = t.call('stabilise_creature', { who: 'nobody' });
    expect(out.status).toBe('needs-context');
    if (out.status !== 'needs-context') return;
    expect(out.establish[0]!.kind).toBe('creature');
    expect(out.establish[0]!.tools).toContain('create_character');
  });
});
