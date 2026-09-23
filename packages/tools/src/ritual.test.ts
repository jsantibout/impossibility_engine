/**
 * `cast_spell.ritual`, through the door.
 *
 * SRD Ritual Adept: a Wizard casts a Ritual-tagged spell from the spellbook
 * unprepared, ten minutes longer and with no slot. The casting is declared,
 * the clock is advanced, and `resolve_declared_cast` settles it; the sheet's
 * slots are what they were.
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
  cantrips: ['fire-bolt', 'prestidigitation', 'ray-of-frost'],
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
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed = 'a-rite-in-the-study') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { call };
}

const expectOk = (outcome: ToolOutcome): Record<string, unknown> => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 500)}`);
  }
  return outcome.resolution as Record<string, unknown>;
};

const slotsLeft = (t: ReturnType<typeof table>): number => {
  const sheet = expectOk(t.call('sheet', { who: 'ander' }));
  const slots = sheet['spellSlots'] as readonly { readonly level: number; readonly left: number }[];
  return slots.find((one) => one.level === 1)?.left ?? -1;
};

describe('a Ritual through the door', () => {
  it('casts a book spell unprepared as a Ritual, declared and settled, spending no slot', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'ander', choices: wizard() }));
    expectOk(t.call('declare_side', { who: 'ander', side: 'party' }));
    const before = slotsLeft(t);

    const declared = expectOk(
      t.call('cast_spell', { caster: 'ander', spellId: 'detect-magic', targets: [], ritual: true }),
    );
    const castingId = declared['castingId'];
    expect(typeof castingId).toBe('string');

    expectOk(t.call('advance_time', { minutes: 11, because: 'the rite is read from the book' }));
    expectOk(t.call('resolve_declared_cast', { castingId }));
    expect(slotsLeft(t)).toBe(before);
  });

  it('refuses the same spell cast plainly, because it is not prepared', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'ander', choices: wizard() }));
    const plain = t.call('cast_spell', { caster: 'ander', spellId: 'detect-magic', targets: [], slotLevel: 1 });
    expect(plain.status).toBe('refused');
    if (plain.status === 'refused') expect(plain.code).toBe('spell_not_available');
  });
});
