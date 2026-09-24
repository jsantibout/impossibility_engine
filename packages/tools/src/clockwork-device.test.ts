/**
 * A thing a feature makes, through the door — SRD Rock Gnome's clockwork
 * device.
 *
 * The whole sentence in four calls: the Gnome makes it, `look` finds it
 * standing in the room with the Armour Class and the hit point the trait
 * prints, somebody presses the button and is told what it does, and somebody
 * takes it apart.
 *
 * **The function comes back as prose and is narrated**, which is the point of
 * the last of those: the engine applies no part of "you light or snuff out a
 * candle", and a caller told only that a Bonus Action was spent would have
 * nothing to say about what happened.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const gnome = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'gnome',
  size: 'Small',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { str: 2, dex: 1 },
  classSkills: ['acrobatics', 'animal-handling'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'gnome:gnomish-lineage': ['Rock Gnome'] },
  featureSpellcasting: { 'gnome:gnomish-lineage': 'int' },
  feats: {
    'fighter:fighting-style': { featId: 'defense' },
    'soldier:savage-attacker': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed = 'workshop') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { call };
}

const expectOk = (outcome: ToolOutcome): Record<string, unknown> => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome.resolution as Record<string, unknown>;
};

const expectRefused = (outcome: ToolOutcome) => {
  if (outcome.status !== 'refused') {
    throw new Error(
      `expected refused, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

interface Seen {
  readonly id: string;
  readonly armorClass: number;
  readonly hpMax: number;
  readonly creatureType: string | null;
}

const seen = (t: ReturnType<typeof table>, id: string): Seen | undefined =>
  (expectOk(t.call('look'))['creatures'] as readonly Seen[]).find((one) => one.id === id);

/** The menu the sheet reports under the feature, which is what a caller names from. */
const functionsOf = (t: ReturnType<typeof table>, who: string): readonly string[] => {
  const features = expectOk(t.call('sheet', { who }))['features'] as readonly {
    readonly feature: string;
    readonly functions?: readonly string[];
  }[];
  return features.find((one) => one.feature === 'gnome:gnomish-lineage')?.functions ?? [];
};

function workshop() {
  const t = table();
  expectOk(t.call('create_character', { id: 'nim', choices: gnome('Nim') }));
  expectOk(t.call('add_creature', { id: 'thug', monsterId: 'bandit' }));
  expectOk(t.call('set_scene', { width: 200, depth: 200, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the bench', at: { x: 50, y: 50 } }));
  expectOk(t.call('place_creature', { who: 'nim', fromLandmark: 'the bench', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'thug', fromCreature: 'nim', feet: 5, bearing: 90 }));
  return t;
}

describe('a Rock Gnome makes a clockwork device from the door', () => {
  it('stands it in the room with the numbers the trait prints', () => {
    const t = workshop();
    const menu = functionsOf(t, 'nim');
    expect(menu.length).toBeGreaterThan(3);

    expectOk(
      t.call('create_device', {
        who: 'nim',
        feature: 'gnome:gnomish-lineage',
        device: 'music-box',
        name: 'a music box',
        function: menu[1],
        fromCreature: 'nim',
        feet: 5,
        bearing: 0,
      }),
    );

    expect(seen(t, 'music-box')).toMatchObject({
      armorClass: 5,
      hpMax: 1,
      creatureType: 'Object',
    });
  });

  it('reports what it was made to do when anybody presses the button', () => {
    const t = workshop();
    const menu = functionsOf(t, 'nim');
    expectOk(
      t.call('create_device', {
        who: 'nim',
        feature: 'gnome:gnomish-lineage',
        device: 'fire-starter',
        name: 'a fire starter',
        function: menu[1],
        detail: 'it lights, never snuffs',
        fromCreature: 'nim',
        feet: 5,
        bearing: 0,
      }),
    );

    // "whenever **you or another creature** takes a Bonus Action to activate
    // it with a touch" — the thug is standing beside it and may press it.
    const pressed = expectOk(t.call('activate_device', { who: 'thug', device: 'fire-starter' }));
    expect(pressed['does']).toBe(menu[1]);
    expect(pressed['detail']).toBe('it lights, never snuffs');
  });

  it('refuses an effect the feature does not print, naming nothing of its own', () => {
    const t = workshop();
    const refusal = expectRefused(
      t.call('create_device', {
        who: 'nim',
        feature: 'gnome:gnomish-lineage',
        device: 'thunderbox',
        name: 'a thunderbox',
        function: 'it throws lightning',
        fromCreature: 'nim',
        feet: 5,
        bearing: 0,
      }),
    );
    expect(refusal.code).toBe('no_such_function');
    expect(seen(t, 'thunderbox')).toBeUndefined();
  });

  it('takes one apart and the room forgets it', () => {
    const t = workshop();
    const menu = functionsOf(t, 'nim');
    expectOk(
      t.call('create_device', {
        who: 'nim',
        feature: 'gnome:gnomish-lineage',
        device: 'tin-bird',
        name: 'a tin bird',
        function: menu[0],
        fromCreature: 'nim',
        feet: 5,
        bearing: 0,
      }),
    );
    expect(seen(t, 'tin-bird')).toBeDefined();

    expectOk(t.call('dismantle_device', { who: 'thug', device: 'tin-bird' }));
    expect(seen(t, 'tin-bird')).toBeUndefined();
  });
});
