/**
 * Light through the door: a model casts Light on the torch it is holding, and
 * `look` says the caster's space is bright.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, type ToolOutcome } from '@ie/tools';

const wizard = (): Record<string, unknown> => ({
  name: 'Ander',
  classId: 'wizard',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Dwarvish', 'Elvish'],
  alignment: 'Neutral',
  cantrips: ['fire-bolt', 'light', 'ray-of-frost'],
  spellbook: ['magic-missile', 'shield', 'detect-magic', 'find-familiar', 'mage-armor', 'sleep'].map(
    (spellId) => ({ spellId, acquiredAt: 1, origin: 'level' }),
  ),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'wizard:scholar': ['arcana'], 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'prestidigitation'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed = 'a-torch-in-the-dark') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { call, look: () => surface.observe() };
}

const expectOk = (outcome: ToolOutcome): Record<string, unknown> => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 500)}`);
  }
  return outcome.resolution as Record<string, unknown>;
};

describe('a lit torch, seen from the door', () => {
  it('reports the caster’s space bright once Light is cast on what they hold', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'ander', choices: wizard() }));
    expectOk(t.call('declare_side', { who: 'ander', side: 'party' }));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the stair', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'ander', fromLandmark: 'the stair', feet: 0 }));

    const before = t.look().creatures.find((one) => one.id === 'ander');
    expect(before?.light).toBeNull();

    expectOk(t.call('cast_spell', { caster: 'ander', spellId: 'light', targets: ['ander'] }));
    const after = t.look().creatures.find((one) => one.id === 'ander');
    expect(after?.light).toEqual({ level: 'bright', magical: true });
  });
});
