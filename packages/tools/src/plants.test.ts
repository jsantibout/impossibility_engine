/**
 * SRD Plant Growth through the doors (E-L2, the owner's ruling of 2026-10-03):
 * where normal plants grow is the DM's to say (`declare_plants`, the DM's
 * door alone), and the areas a caster leaves out of a spell's area are named
 * on `cast_spell.exclude`, refused on a spell that prints no such sentence.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, DM_TOOL_NAMES, TOOL_NAMES, type ToolOutcome } from '@ie/tools';

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

function table(seed = 'a-meadow') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { call, look: () => surface.observe(), campaign };
}

const expectOk = (outcome: ToolOutcome): Record<string, unknown> => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 500)}`);
  }
  return outcome.resolution as Record<string, unknown>;
};

describe('the plants, declared', () => {
  it('pins where plants grow and where nothing does, and takes a stretch back', () => {
    const t = table();
    expectOk(t.call('set_scene', { width: 300, depth: 300, height: 20 }));
    expectOk(t.call('declare_plants', { name: 'the meadow', at: { x: 100, y: 100 }, radius: 30 }));
    expectOk(t.call('declare_plants', { name: 'the court', at: { x: 200, y: 200 }, radius: 20, growing: false }));
    const plants = t.campaign.state().scene!.plants!;
    expect(plants['the meadow']!.growing).toBe(true);
    expect(plants['the meadow']!.region.shape).toEqual({ kind: 'sphere', radius: 30 });
    expect(plants['the court']!.growing).toBe(false);

    expectOk(t.call('declare_plants', { name: 'the meadow' }));
    expect(t.campaign.state().scene!.plants!['the meadow']).toBeUndefined();
  });

  it('is the DM’s door alone', () => {
    expect(DM_TOOL_NAMES).toContain('declare_plants');
    expect(TOOL_NAMES).not.toContain('declare_plants');
  });
});

describe('an exclusion, named on the cast', () => {
  it('reaches the engine, which refuses it on a spell that prints none', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'ander', choices: wizard() }));
    expectOk(t.call('set_scene', { width: 300, depth: 300, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the stair', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'ander', fromLandmark: 'the stair', feet: 0 }));
    const refused = t.call('cast_spell', {
      caster: 'ander',
      spellId: 'sleep',
      targets: [],
      at: { x: 40, y: 40 },
      exclude: [{ at: { x: 40, y: 40 }, radius: 5 }],
    });
    expect(refused.status).toBe('refused');
    expect(refused.status === 'refused' && refused.code).toBe('nothing_to_exclude');
  });
});
