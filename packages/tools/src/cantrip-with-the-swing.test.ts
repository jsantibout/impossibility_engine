/**
 * A cantrip cast with the swing, asked for through the door.
 *
 * SRD True Strike: "you make one attack with the weapon used in the spell's
 * casting." The casting and the attack are one moment, so `cast_spell` refuses
 * the spell outright and the swing names it instead — which is the whole of
 * the field this file is about. Without it the cantrip was unreachable for
 * anybody above the engine: no tool made a weapon attack out of a casting, and
 * `cast_spell` will not.
 *
 * **No number the caller produced.** Two words: which spell, and which of the
 * types it prints. Which ability the attack is rolled with, what the
 * Proficiency Bonus is, how many Radiant dice a level 5 caster adds, whether
 * the Action is there to spend and whether the caster has proficiency with the
 * thing in their hand are all the engine's.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

/** A level 5 Wizard with True Strike known and the daggers their package gives. */
const wizard = (name: string): Record<string, unknown> => ({
  name,
  classId: 'wizard',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation', 'true-strike'],
  spellbook: [
    'magic-missile',
    'shield',
    'detect-magic',
    'feather-fall',
    'mage-armor',
    'sleep',
    'thunderwave',
    'hold-person',
    'misty-step',
    'web',
    'fireball',
    'counterspell',
    'fly',
    'haste',
  ].map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  })),
  preparedSpells: [
    'magic-missile',
    'shield',
    'mage-armor',
    'hold-person',
    'misty-step',
    'fireball',
    'counterspell',
    'fly',
    'haste',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
    'wizard:ability-score-improvement': { featId: 'alert' },
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

/** The Wizard, a goblin within reach, and nothing cast yet. */
function study(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

  expectOk(call('create_character', { id: 'ilya', choices: wizard('Ilya') }));
  expectOk(call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(call('add_landmark', { name: 'the desk', at: { x: 10, y: 10 } }));
  expectOk(call('place_creature', { who: 'ilya', fromLandmark: 'the desk', feet: 0 }));
  expectOk(call('place_creature', { who: 'grish', fromCreature: 'ilya', feet: 5, bearing: 90 }));
  return { call };
}

const typesDealt = (outcome: {
  readonly events: readonly { readonly type: string }[];
}): readonly string[] => {
  const record = outcome.events.find((event) => event.type === 'damage-dice-recorded');
  if (record === undefined) return [];
  const components = (
    record as unknown as { readonly components: readonly { readonly type: string }[] }
  ).components;
  return components.map((component) => component.type);
};

const cast = (outcome: { readonly events: readonly { readonly type: string }[] }): boolean =>
  outcome.events.some((event) => event.type === 'spell-cast');

describe('True Strike is named on the swing it makes', () => {
  it('casts the cantrip and swings in one call', () => {
    const { call } = study('a-flash-of-insight');
    const swing = expectOk(
      call('attack', {
        attacker: 'ilya',
        target: 'grish',
        weapon: 'dagger',
        cantrip: { spell: 'true-strike' },
      }),
    );
    expect(cast(swing)).toBe(true);
    // The dagger's own type, and the level 5 Cantrip Upgrade beside it.
    expect(typesDealt(swing)).toEqual(['piercing', 'radiant']);
  });

  it('deals Radiant in place of the weapon’s type when the caller says so', () => {
    const { call } = study('a-flash-of-insight');
    const swing = expectOk(
      call('attack', {
        attacker: 'ilya',
        target: 'grish',
        weapon: 'dagger',
        cantrip: { spell: 'true-strike', damageType: 'radiant' },
      }),
    );
    expect(typesDealt(swing)).toEqual(['radiant', 'radiant']);
  });

  it('refuses a type the spell does not offer', () => {
    const { call } = study('a-flash-of-insight');
    const refused = expectRefused(
      call('attack', {
        attacker: 'ilya',
        target: 'grish',
        weapon: 'dagger',
        cantrip: { spell: 'true-strike', damageType: 'fire' },
      }),
    );
    expect(refused.code).toBe('bad_damage_type');
  });

  it('refuses a spell that is not cast with a swing', () => {
    const { call } = study('a-flash-of-insight');
    const refused = expectRefused(
      call('attack', {
        attacker: 'ilya',
        target: 'grish',
        weapon: 'dagger',
        cantrip: { spell: 'fire-bolt' },
      }),
    );
    expect(refused.code).toBe('not_cast_with_a_swing');
  });

  /** And the other door says so too: `cast_spell` makes no attack. */
  it('refuses True Strike at the casting tool', () => {
    const { call } = study('a-flash-of-insight');
    const refused = expectRefused(
      call('cast_spell', { caster: 'ilya', spellId: 'true-strike', targets: ['ilya'] }),
    );
    expect(refused.code).toBe('cast_with_a_swing');
  });
});
