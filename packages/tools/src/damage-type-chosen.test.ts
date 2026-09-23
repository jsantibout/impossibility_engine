/**
 * A damage type chosen at the swing, asked for through the door.
 *
 * SRD Shillelagh: "A Club or Quarterstaff you are holding is imbued with
 * nature's power ... If the attack deals damage, it can be Force damage or the
 * weapon's normal damage type (your choice)." The casting names the weapon and
 * the *swing* names the type, so the two halves of the sentence are two calls
 * — and the second had no field on this surface at all, which made the choice
 * unreachable for anybody above the engine. SRD Divine Strike's "Necrotic or
 * Radiant damage (your choice)" was in the same position and is reached by the
 * same field.
 *
 * **No number the caller produced.** The whole of the field is two words: what
 * offers the choice, and which of the types it prints. What die is thrown, what
 * the blow comes to and what the target's Resistances do with it are the
 * engine's.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

/** A Druid with Shillelagh prepared and the quarterstaff its package gives it. */
const druid = (name: string): Record<string, unknown> => ({
  name,
  classId: 'druid',
  level: 1,
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 13, con: 14, int: 12, wis: 15, cha: 8 },
  },
  abilityIncreases: { wis: 2, int: 1 },
  classSkills: ['nature', 'perception'],
  languages: ['Elvish', 'Goblin'],
  alignment: 'Neutral',
  cantrips: ['shillelagh', 'guidance'],
  spellbook: [],
  preparedSpells: ['cure-wounds', 'entangle', 'faerie-fire', 'thunderwave'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['survival'], 'druid:primal-order': ['Warden'] },
  feats: {
    'human:versatile': { featId: 'alert' },
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['sacred-flame', 'thaumaturgy'],
      levelOneSpell: 'bless',
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

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

/** A Druid with an imbued staff and a goblin within reach, out of combat. */
function grove(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

  expectOk(call('create_character', { id: 'nel', choices: druid('Nel') }));
  expectOk(call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(call('add_landmark', { name: 'the oak', at: { x: 10, y: 10 } }));
  expectOk(call('place_creature', { who: 'nel', fromLandmark: 'the oak', feet: 0 }));
  expectOk(call('place_creature', { who: 'grish', fromCreature: 'nel', feet: 5, bearing: 90 }));
  expectOk(call('cast_spell', { caster: 'nel', spellId: 'shillelagh', targets: ['nel'], weapon: 'quarterstaff' }));
  return { call };
}

/** The types the blow dealt, off the events the call returned. */
const typesDealt = (outcome: {
  readonly events: readonly { readonly type: string }[];
}): readonly string[] => {
  const record = outcome.events.find((event) => event.type === 'damage-dice-recorded');
  if (record === undefined) return [];
  const components = (record as unknown as { readonly components: readonly { readonly type: string }[] })
    .components;
  return components.map((component) => component.type);
};

describe('Shillelagh’s "Force damage or the weapon’s normal damage type"', () => {
  it('deals the staff’s own Bludgeoning when the swing names nothing', () => {
    const { call } = grove('grove-0');
    const swing = expectOk(call('attack', { attacker: 'nel', target: 'grish', weapon: 'quarterstaff' }));
    expect(typesDealt(swing)).toEqual(['bludgeoning']);
  });

  it('deals Force when the swing names it, under the spell’s own name', () => {
    const { call } = grove('grove-0');
    const swing = expectOk(
      call('attack', {
        attacker: 'nel',
        target: 'grish',
        weapon: 'quarterstaff',
        damageTypes: { Shillelagh: 'force' },
      }),
    );
    expect(typesDealt(swing)).toEqual(['force']);
  });

  /** A type the sentence does not print, refused before anything is rolled. */
  it('refuses a type the spell does not offer', () => {
    const { call } = grove('grove-0');
    const refused = expectRefused(
      call('attack', {
        attacker: 'nel',
        target: 'grish',
        weapon: 'quarterstaff',
        damageTypes: { Shillelagh: 'radiant' },
      }),
    );
    expect(refused.code).toBe('bad_damage_type');
  });
});
