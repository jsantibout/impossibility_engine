/**
 * Light through the door: a model casts Light on the torch it is holding, and
 * `look` says the caster's space is bright.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, TOOL_NAMES, type ToolOutcome } from '@ie/tools';

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
  return { call, look: () => surface.observe(), campaign };
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

/**
 * The same torch, handed on and covered (W9-S1): `move_cast_light` keeps the
 * casting's own patch, so `look` reads it where the torch went and reads
 * nothing while a cloak is over it.
 */
describe('a lit torch, moved and covered through the door', () => {
  const lit = () => {
    const t = table('a-torch-handed-on');
    expectOk(t.call('create_character', { id: 'ander', choices: wizard() }));
    expectOk(t.call('declare_side', { who: 'ander', side: 'party' }));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the stair', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'ander', fromLandmark: 'the stair', feet: 0 }));
    const cast = expectOk(
      t.call('cast_spell', { caster: 'ander', spellId: 'light', targets: ['ander'] }),
    );
    return { t, castingId: String(cast.castingId) };
  };
  const anders = (t: ReturnType<typeof table>) =>
    t.look().creatures.find((one) => one.id === 'ander')?.light;

  it('is a door the player’s surface holds', () => {
    expect(TOOL_NAMES).toContain('move_cast_light');
  });

  it('puts the light out while it is covered, and back when it is not', () => {
    const { t, castingId } = lit();

    expectOk(t.call('move_cast_light', { castingId, covered: true }));
    expect(anders(t)).toBeNull();

    expectOk(t.call('move_cast_light', { castingId, covered: false }));
    expect(anders(t)).toEqual({ level: 'bright', magical: true });
  });

  it('leaves the light where it was set down', () => {
    const { t, castingId } = lit();

    expectOk(t.call('move_cast_light', { castingId, at: { x: 55, y: 35 } }));
    expect(anders(t)).toBeNull();
  });

  it('takes a place or a creature, not both', () => {
    const { t, castingId } = lit();

    const both = t.call('move_cast_light', { castingId, onto: 'ander', at: { x: 40, y: 30 } });
    expect(both.status).toBe('invalid');
  });

  it('refuses a spell whose light is on no object', () => {
    const { t } = lit();
    const armour = expectOk(
      t.call('cast_spell', { caster: 'ander', spellId: 'mage-armor', targets: ['ander'], slotLevel: 1 }),
    );

    const refused = t.call('move_cast_light', { castingId: String(armour.castingId), covered: true });
    expect(refused.status).toBe('refused');
    expect(refused.status === 'refused' && refused.code).toBe('no_object');
  });

  it('refuses a casting that is not running', () => {
    const { t } = lit();

    const refused = t.call('move_cast_light', { castingId: 'cast:99', covered: true });
    expect(refused.status === 'refused' && refused.code).toBe('not_ongoing');
  });
});

/**
 * SRD Gust of Wind and Sleet Storm put out flames, and a flame is light the
 * table says is one (E-L2, the owner's ruling of 2026-10-03): `flame` on
 * `declare_light`, unprotected (a torch, a candle) or protected (a lantern).
 */
describe('a flame, declared', () => {
  it('pins the kind the table names, and refuses one it does not', () => {
    const t = table();
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('declare_light', { patch: 'the candle', at: { x: 10, y: 10 }, radius: 5, level: 'dim', flame: 'unprotected' }));
    expectOk(t.call('declare_light', { patch: 'the lantern', at: { x: 30, y: 10 }, radius: 30, level: 'bright', flame: 'protected' }));
    const light = t.campaign.state().scene!.light;
    expect(light['the candle']!.flame).toBe('unprotected');
    expect(light['the lantern']!.flame).toBe('protected');

    const odd = t.call('declare_light', { patch: 'the ember', at: { x: 50, y: 10 }, radius: 5, level: 'dim', flame: 'smouldering' });
    expect(odd.status).toBe('invalid');
  });
});
