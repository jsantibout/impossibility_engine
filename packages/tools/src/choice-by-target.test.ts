/**
 * A choice answered per creature, through the door.
 *
 * SRD Enhance Ability's upcast: "You can choose a different ability for each
 * target." `cast_spell.choiceByTarget` carries the answer as a list of pairs on
 * the wire and the engine takes it as a map, the conversion `optionByTarget`
 * already makes. What the engine does with it is `choice-per-target.test.ts`'s
 * to prove; what this proves is that the pairs reach it at all — a field the
 * door dropped would leave Guidance refused for want of an answer, and it is
 * refused instead for answering in a shape the spell does not offer.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const cleric = (name: string): Record<string, unknown> => ({
  name,
  classId: 'cleric',
  level: 1,
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 12, con: 14, int: 8, wis: 15, cha: 13 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['medicine', 'persuasion'],
  languages: ['Elvish', 'Goblin'],
  alignment: 'Neutral Good',
  cantrips: ['guidance', 'sacred-flame', 'thaumaturgy'],
  spellbook: [],
  preparedSpells: ['bless', 'cure-wounds', 'healing-word', 'shield-of-faith'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['survival'], 'cleric:divine-order': ['Protector'] },
  feats: {
    'human:versatile': { featId: 'alert' },
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['light', 'spare-the-dying'],
      levelOneSpell: 'sanctuary',
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

const outcomeOf = (outcome: ToolOutcome, status: ToolOutcome['status']) => {
  if (outcome.status !== status) {
    throw new Error(
      `expected ${status}, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

describe('cast_spell.choiceByTarget', () => {
  it('reaches the engine as a map, which refuses it on a spell that chooses once', () => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'choice-by-target' });
    const surface = createSurface(campaign);
    let calls = 0;
    const call = (tool: string, input: unknown = {}): ToolOutcome =>
      surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

    outcomeOf(call('create_character', { id: 'ada', choices: cleric('Ada') }), 'ok');

    // Guidance asks "choose a skill" once. Without the map reaching the engine
    // this would be `choice_required`; with it, the answer is the wrong shape.
    const refused = outcomeOf(
      call('cast_spell', {
        caster: 'ada',
        spellId: 'guidance',
        targets: ['ada'],
        choiceByTarget: [{ target: 'ada', choice: 'religion' }],
      }),
      'refused',
    );
    expect((refused as { readonly code: string }).code).toBe('no_per_target_choice_clause');
  });
});
