import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, createSurface } from '@ie/tools';
import { toolSchemas } from '../tool-schemas.js';

/**
 * The door that sets off a glyph.
 *
 * SRD Glyph of Warding: "You decide what triggers the glyph when you cast the
 * spell." The trigger is fiction the caster invented — a footfall, a book
 * opened, a word spoken — and the engine holds nothing it could read it from,
 * so whether it occurred is a decision the rules leave open, which is the
 * DM's door's whole criterion. Everything after the decision is the engine's:
 * `trigger_glyph` names the casting and nothing else, and the Sphere, the
 * saves, the dice and the ending are all the record's.
 */
describe('trigger_glyph', () => {
  const campaign = () => createCampaign({ content: SRD_CONTENT, seed: 'the-vault' });

  it('is on the DM’s door and not on the model’s', () => {
    const dm = createDmSurface(campaign());
    const player = createSurface(campaign());
    expect(toolSchemas(dm).some((tool) => tool.name === 'trigger_glyph')).toBe(true);
    expect(toolSchemas(player).some((tool) => tool.name === 'trigger_glyph')).toBe(false);
  });

  it('refuses a casting that is not running, and states no number', () => {
    const dm = createDmSurface(campaign());
    const out = dm.call({ tool: 'trigger_glyph', input: { castingId: 'cast:9' }, commandId: 'toolu_1' });
    expect(out.status).not.toBe('ok');
    expect(JSON.stringify(out)).toContain('not_ongoing');
  });
});

/**
 * The spell glyph through both doors — SRD Glyph of Warding: "You can store a
 * prepared spell of level 3 or lower in the glyph by casting it as part of
 * creating the glyph. … If the spell has a target, it targets the creature that
 * triggered the glyph." The caster stores the spell with `cast_spell.stores`;
 * the DM says who stepped on it with `trigger_glyph.by`, which is the one
 * creature this door ever names. (W7-S21)
 */
describe('trigger_glyph on a glyph that stores a spell', () => {
  const BRANNOR: Record<string, unknown> = {
    name: 'Brannor',
    classId: 'cleric',
    level: 5,
    speciesId: 'human',
    backgroundId: 'acolyte',
    abilities: {
      method: 'standard-array',
      assignment: { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 },
    },
    abilityIncreases: { wis: 2, cha: 1 },
    classSkills: ['medicine', 'persuasion'],
    languages: ['Dwarvish', 'Elvish'],
    alignment: 'Neutral Good',
    subclassId: 'life-domain',
    cantrips: ['sacred-flame', 'guidance', 'light', 'thaumaturgy'],
    spellbook: [],
    preparedSpells: [
      'glyph-of-warding',
      'inflict-wounds',
      'healing-word',
      'bane',
      'blindness-deafness',
      'hold-person',
      'guiding-bolt',
      'aid',
      'silence',
    ],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: {
      'human:skillful': ['perception'],
      'cleric:divine-order': ['Protector'],
    },
    feats: {
      'acolyte:magic-initiate-cleric': {
        featId: 'magic-initiate',
        spellList: 'cleric',
        spellcastingAbility: 'wis',
        cantrips: ['spare-the-dying', 'resistance'],
        levelOneSpell: 'cure-wounds',
      },
      'human:versatile': { featId: 'alert' },
      'cleric:ability-score-improvement': {
        featId: 'ability-score-improvement',
        abilities: ['wis', 'wis'],
      },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
  };

  const inscribed = () => {
    const dm = createDmSurface(createCampaign({ content: SRD_CONTENT, seed: 'the-shrine' }));
    let calls = 0;
    const call = (tool: string, input: unknown) => {
      calls += 1;
      return dm.call({ tool, input, commandId: `toolu_${calls}` });
    };
    const must = (tool: string, input: unknown) => {
      const out = call(tool, input);
      if (out.status !== 'ok') throw new Error(`${tool}: ${JSON.stringify(out).slice(0, 600)}`);
      return out;
    };
    must('create_character', { id: 'brannor', choices: BRANNOR });
    must('add_creature', { id: 'grish', monsterId: 'bandit' });
    must('set_scene', { width: 200, depth: 200, height: 20 });
    must('add_landmark', { name: 'the shrine door', at: { x: 10, y: 10 } });
    must('place_creature', { who: 'brannor', fromLandmark: 'the shrine door', feet: 0 });
    must('place_creature', { who: 'grish', fromLandmark: 'the shrine door', feet: 90 });
    const declared = must('cast_spell', {
      caster: 'brannor',
      spellId: 'glyph-of-warding',
      targets: [],
      at: { x: 10, y: 15 },
      slotLevel: 3,
      stores: { spellId: 'hold-person', slotLevel: 2 },
    });
    if (declared.status !== 'ok') throw new Error('declared');
    const castingId = declared.resolution['castingId'] as string;
    must('advance_time', { hours: 1, because: 'the rune is drawn in chalk and blood' });
    must('resolve_declared_cast', { castingId });
    return { call, castingId };
  };

  it('asks the DM who set it off, and lets the stored Hold Person go at the bandit they name', () => {
    const { call, castingId } = inscribed();
    const unnamed = call('trigger_glyph', { castingId });
    expect(unnamed.status).not.toBe('ok');
    expect(JSON.stringify(unnamed)).toContain('triggerer_required');

    const fired = call('trigger_glyph', { castingId, by: 'grish' });
    expect(fired.status, JSON.stringify(fired).slice(0, 600)).toBe('ok');
    if (fired.status !== 'ok') return;
    const outcomes = fired.resolution['outcomes'] as readonly { readonly target: string }[];
    expect(outcomes.map((one) => one.target)).toEqual(['grish']);
  });
});
