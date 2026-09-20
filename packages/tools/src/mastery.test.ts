/**
 * The mastery property of the weapon in hand, asked for through the door.
 *
 * Seven of the eight properties landed in the engine — Graze, Push, Sap,
 * Slow, Topple, Vex and Cleave — and five of them are written "you can": SRD
 * makes them a decision the attacker states, and `AttackCommand.mastery` is
 * where the attacker states it. Nothing above the engine carried the field, so
 * a Fighter who had chosen three weapons to have mastery with could swing them
 * and never use one, and the two refusals the engine writes about a mastery —
 * a property nobody unlocked, a Push further than Push reaches — were
 * unreachable rather than unanswerable.
 *
 * **No number the caller produced.** `feet` is SRD Push's "up to 10 feet",
 * which is a choice out of a bound the rules print and the engine checks —
 * `slotLevel`'s kind of decision, not a distance the caller measured. How far
 * the shove actually lands, what it costs, whether the target is Large or
 * smaller and which way it goes are all read out of state. `cleaving` is a
 * creature id, and every question about the opening it claims — the property
 * is Cleave, the first creature is somebody else, the second is within five
 * feet of the first, the turn has not already had its extra swing — is the
 * engine's, asked before anything is rolled.
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

/**
 * A Fighter who has chosen the three weapons this file swings.
 *
 * Level 2, because Weapon Mastery is a level 1 feature and Tactical Master —
 * the feature that lets a property be *substituted* — is not: a swing that
 * asks for one is refused here, which is half of what the field is for.
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
  featureChoices: { 'fighter:weapon-mastery': ['warhammer', 'greataxe', 'longsword'] },
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

  /** The DM's door, over the same campaign, for the one thing a model may not do. */
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

const apart = (t: ReturnType<typeof table>, from: string, to: string): number | null =>
  t.surface.observe().creatures.find((one) => one.id === from)!.feetTo[to] ?? null;

/**
 * A Fighter with a warhammer and a goblin five feet away.
 *
 * The seed is chosen so the swing lands: a Push that missed would prove
 * nothing about Push, and a test that rolled until it hit would be a test of
 * the generator. The weapon arrives through the DM's door because handing out
 * what a party found is the DM's call and `create_character` on the model's
 * surface grants no item.
 */
function fight(seed = 'mastery') {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
  expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(
    t.rule('award_items', {
      who: 'bram',
      items: [{ id: 'warhammer' }, { id: 'spear' }],
      because: 'the armoury under the keep',
    }),
  );
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the fire', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'bram', fromLandmark: 'the fire', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'bram', feet: 5, bearing: 90 }));
  expect(apart(t, 'bram', 'grish')).toBe(5);
  return t;
}

describe('a mastery property is a decision the attacker states', () => {
  it('shoves the target with Push, and the engine says how far it went', () => {
    const t = fight();
    const swing = expectOk(
      t.call('attack', { attacker: 'bram', target: 'grish', weapon: 'warhammer', mastery: {} }),
    );

    expect(swing.resolution['hit']).toBe(true);
    // SRD Push: "you can push the target up to 10 feet away from you." The ten
    // is the property's and never the caller's.
    expect(apart(t, 'bram', 'grish')).toBe(15);
    expect(swing.events.some((event) => event.type === 'creature-moved')).toBe(true);
  });

  it('pushes a shorter way when the attacker says so, which the rules offer', () => {
    const t = fight();
    expectOk(
      t.call('attack', {
        attacker: 'bram',
        target: 'grish',
        weapon: 'warhammer',
        mastery: { feet: 5 },
      }),
    );
    expect(apart(t, 'bram', 'grish')).toBe(10);
  });

  it('leaves the target where it stood when nothing is asked for', () => {
    // Push is one of the five written "you can", so silence declines it — and
    // a caller that has not asked has not spent anything either.
    const t = fight();
    expectOk(t.call('attack', { attacker: 'bram', target: 'grish', weapon: 'warhammer' }));
    expect(apart(t, 'bram', 'grish')).toBe(5);
  });
});

describe('a mastery the attacker has not got is refused, never skipped', () => {
  it('refuses a weapon nobody unlocked, and spends nothing doing it', () => {
    const t = fight();
    const before = { log: t.campaign.log().length, rolls: t.campaign.state().rollsIssued };

    // A spear is a Sap weapon and Bram chose warhammer, greataxe and longsword.
    const out = expectRefused(
      t.call('attack', { attacker: 'bram', target: 'grish', weapon: 'spear', mastery: {} }),
    );
    expect(out.code).toBe('no_mastery');
    expect(t.campaign.log()).toHaveLength(before.log);
    expect(t.campaign.state().rollsIssued).toBe(before.rolls);
  });

  it('refuses a substitution nothing granted, before the die is thrown', () => {
    const t = fight();
    const before = t.campaign.state().rollsIssued;
    // SRD Tactical Master — "you can replace its mastery property with the
    // Push, Sap, or Slow property" — arrives long after level 2.
    const out = expectRefused(
      t.call('attack', {
        attacker: 'bram',
        target: 'grish',
        weapon: 'warhammer',
        mastery: { property: 'slow' },
      }),
    );
    expect(out.code).toBe('no_mastery');
    expect(t.campaign.state().rollsIssued).toBe(before);
  });
});

describe('a mastery refusal is answerable through the field it names', () => {
  it('refuses a Push further than Push reaches, and nothing is spent', () => {
    const t = fight();
    const before = { log: t.campaign.log().length, rolls: t.campaign.state().rollsIssued };

    const out = expectRefused(
      t.call('attack', {
        attacker: 'bram',
        target: 'grish',
        weapon: 'warhammer',
        mastery: { feet: 15 },
      }),
    );
    expect(out.code).toBe('bad_amount');
    expect(out.reason).toContain('10');
    expect(t.campaign.log()).toHaveLength(before.log);
    expect(t.campaign.state().rollsIssued).toBe(before.rolls);
  });

  /**
   * And the field is really there, proved the way `doors.test.ts` proves one:
   * a malformed value rejected **at that path**. Zod strips a key the schema
   * has never heard of in silence, so a call that merely succeeded would prove
   * nothing at all.
   */
  it('and the distance is a field of the call, not a key Zod threw away', () => {
    const t = fight();
    const out = t.call('attack', {
      attacker: 'bram',
      target: 'grish',
      weapon: 'warhammer',
      mastery: { feet: 'a long way' },
    });
    expect(out.status).toBe('invalid');
    if (out.status !== 'invalid') return;
    expect(out.issues.map((issue) => issue.path)).toContain('mastery.feet');
  });
});

describe('Cleave is the extra swing, and the opening is the engine’s to judge', () => {
  it('refuses a Cleave from a weapon that does not have the property', () => {
    const t = fight();
    expectOk(t.call('add_creature', { id: 'snik', monsterId: 'goblin-warrior' }));
    expectOk(t.call('place_creature', { who: 'snik', fromCreature: 'grish', feet: 5, bearing: 0 }));

    const out = expectRefused(
      t.call('attack', {
        attacker: 'bram',
        target: 'snik',
        weapon: 'warhammer',
        mastery: { cleaving: 'grish' },
      }),
    );
    expect(out.code).toBe('no_mastery');
    expect(out.reason).toContain('Cleave');
  });
});
