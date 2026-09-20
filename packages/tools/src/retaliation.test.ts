/**
 * Swinging back at whatever just hurt you — the feature half of the
 * `damaged-by-creature` window, through `surface.call`.
 *
 * SRD Retaliation: "When you take damage from a creature that is within 5 feet
 * of you, you can take a Reaction to make one melee attack against that
 * creature, using a weapon or an Unarmed Strike."
 *
 * **The window has two halves and only one had a door.** The spell half —
 * *Hellish Rebuke*, cast into the same moment — goes through `cast_spell`,
 * which has always been on this surface. The feature half is
 * `takeDamageResponse`, which has been in the engine since the third timing
 * family landed and reached no tool, so a Barbarian holding Retaliation was
 * shown the Reaction by `options` and could do nothing about it: "a window a
 * caller can see and cannot answer is worse than one it is never shown."
 *
 * **It holds nothing open, which is why there is no `decline` beside it.** The
 * damage has landed, the hit points have moved, and nothing the reactor does
 * changes any of it — so an unanswered window wedges nothing, and the only
 * call there can be is the one that swings.
 *
 * The damage arrives through the **DM's** door with the creature that dealt it
 * named, because an amount somebody adjudicated is the one thing a model may
 * not state and the trigger has to be exact: the target of the Reaction is
 * forced by whoever did the hurting.
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

/** A Berserker of the level Retaliation arrives at, and nothing else. */
const barbarian = (name: string): Record<string, unknown> => ({
  name,
  classId: 'barbarian',
  level: 10,
  subclassId: 'path-of-the-berserker',
  speciesId: 'human',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { str: 2, con: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Orc', 'Goblin'],
  alignment: 'Chaotic Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'barbarian:weapon-mastery': ['greataxe', 'handaxe', 'warhammer'],
    'barbarian:primal-knowledge': ['intimidation'],
    'human:skillful': ['perception'],
  },
  feats: {
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'human:versatile': { featId: 'alert' },
    'barbarian:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['str', 'str'],
    },
    'barbarian:ability-score-improvement-2': {
      featId: 'ability-score-improvement',
      abilities: ['con', 'con'],
    },
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

  /** The DM's door, for the amount a model may not state. */
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

const hpOf = (t: ReturnType<typeof table>, id: string): number =>
  t.surface.observe().creatures.find((one) => one.id === id)!.hp;

interface Offer {
  readonly id: string;
  readonly name: string;
  readonly window: string;
  readonly costsReaction: boolean;
}

const offersTo = (t: ReturnType<typeof table>, id: string): readonly Offer[] =>
  expectOk(t.call('options', { who: id })).resolution['reactions'] as readonly Offer[];

/** A Barbarian with an axe, a goblin within reach, and a fight running. */
function ambush(seed = 'retaliation') {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'thrag', choices: barbarian('Thrag') }));
  expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(t.rule('award_items', { who: 'thrag', items: [{ id: 'greataxe' }], because: 'the raid' }));
  expectOk(t.call('declare_side', { who: 'thrag', side: 'party' }));
  expectOk(t.call('declare_side', { who: 'grish', side: 'goblins' }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the cave mouth', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'thrag', fromLandmark: 'the cave mouth', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'thrag', feet: 5, bearing: 90 }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'thrag' }, { who: 'grish' }] }));
  return t;
}

/** The goblin's scimitar, as a number somebody at the table decided. */
const stab = (t: ReturnType<typeof table>) =>
  expectOk(
    t.rule('improvised_damage', {
      target: 'thrag',
      amount: 5,
      by: 'grish',
      ruling: 'the goblin’s scimitar out of the dark',
    }),
  );

describe('a creature that has just been hurt can swing back', () => {
  it('is offered the Reaction, and can now take it', () => {
    const t = ambush();
    stab(t);

    // The half that has always worked: `options` reports the window.
    expect(offersTo(t, 'thrag').map((offer) => offer.id)).toContain('berserker:retaliation');

    const swung = expectOk(
      t.call('take_damage_response', {
        who: 'thrag',
        feature: 'berserker:retaliation',
        weapon: 'greataxe',
      }),
    );
    expect(swung.resolution['took']).toBe('berserker:retaliation');
    expect(swung.resolution['against']).toBe('grish');
    expect(typeof swung.resolution['hit']).toBe('boolean');
    expect(swung.events.some((event) => event.type === 'reaction-taken')).toBe(true);
    // SRD spends a Reaction on this one, and the log says so.
    expect(swung.events.some((event) => event.type === 'reaction-spent')).toBe(true);
  });

  it('swings with fists when no weapon is named, which SRD allows', () => {
    const t = ambush();
    stab(t);
    const swung = expectOk(
      t.call('take_damage_response', { who: 'thrag', feature: 'berserker:retaliation' }),
    );
    expect(swung.resolution['against']).toBe('grish');
  });

  it('spends the Reaction, so a second answer is refused', () => {
    const t = ambush();
    stab(t);
    expectOk(
      t.call('take_damage_response', {
        who: 'thrag',
        feature: 'berserker:retaliation',
        weapon: 'greataxe',
      }),
    );
    // A second blow, a second window — and no Reaction left to answer it with.
    expectOk(
      t.rule('improvised_damage', {
        target: 'thrag',
        amount: 3,
        by: 'grish',
        ruling: 'the goblin again',
      }),
    );
    const again = expectRefused(
      t.call('take_damage_response', {
        who: 'thrag',
        feature: 'berserker:retaliation',
        weapon: 'greataxe',
      }),
    );
    expect(again.code).toBe('no_reaction');
  });
});

describe('a swing back the rules do not allow costs nothing', () => {
  it('refuses when nothing has just hurt them', () => {
    const t = ambush();
    const before = t.campaign.log().length;
    const out = expectRefused(
      t.call('take_damage_response', {
        who: 'thrag',
        feature: 'berserker:retaliation',
        weapon: 'greataxe',
      }),
    );
    expect(out.code).toBe('no_trigger');
    expect(t.campaign.log()).toHaveLength(before);
  });

  it('refuses a creature further off than the feature reaches', () => {
    const t = ambush();
    expectOk(t.call('add_creature', { id: 'snik', monsterId: 'goblin-warrior' }));
    expectOk(t.call('place_creature', { who: 'snik', fromCreature: 'thrag', feet: 25, bearing: 0 }));
    expectOk(
      t.rule('improvised_damage', {
        target: 'thrag',
        amount: 4,
        by: 'snik',
        ruling: 'a sling stone from the ledge',
      }),
    );

    const out = expectRefused(
      t.call('take_damage_response', {
        who: 'thrag',
        feature: 'berserker:retaliation',
        weapon: 'greataxe',
      }),
    );
    expect(out.code).toBe('out_of_range');
    expect(hpOf(t, 'snik')).toBe(10);
  });

  it('refuses a feature this creature has not got, naming it', () => {
    const t = ambush();
    stab(t);
    const out = expectRefused(
      t.call('take_damage_response', { who: 'thrag', feature: 'berserker:frenzy' }),
    );
    expect(out.code).toBe('no_such_feature');
  });
});
