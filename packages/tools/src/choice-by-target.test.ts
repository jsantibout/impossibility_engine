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

    // And `cast_spell.magicalEffect` (E-L1) reaches it the same way: a spell
    // that ends no spells is refused for being aimed at one, which it could
    // only be told if the field arrived.
    const aimed = outcomeOf(
      call('cast_spell', {
        caster: 'ada',
        spellId: 'sacred-flame',
        targets: [],
        magicalEffect: 'cast:1',
      }),
      'refused',
    );
    expect((aimed as { readonly code: string }).code).toBe('no_effect_clause');
  });
});

/**
 * SRD Sanctuary's choice through the door (E-L1, owner's ruling of 2026-10-03):
 * `attack.ifWarded` is asked for before any die, answered by the same call,
 * and a lost swing is reported `warded` with no roll.
 */
describe('attack.ifWarded', () => {
  it('asks for the fallback at a warded creature, and loses the swing on "lose"', () => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'warded' });
    const surface = createSurface(campaign);
    let calls = 0;
    const call = (tool: string, input: unknown = {}): ToolOutcome =>
      surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

    outcomeOf(call('create_character', { id: 'ada', choices: cleric('Ada') }), 'ok');
    outcomeOf(call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }), 'ok');
    outcomeOf(call('set_scene', { width: 60, depth: 40, height: 20 }), 'ok');
    outcomeOf(call('add_landmark', { name: 'the door', at: { x: 10, y: 10 } }), 'ok');
    outcomeOf(call('place_creature', { who: 'ada', fromLandmark: 'the door', feet: 0 }), 'ok');
    outcomeOf(call('place_creature', { who: 'grish', fromCreature: 'ada', feet: 5, bearing: 90 }), 'ok');
    outcomeOf(
      call('cast_spell', { caster: 'ada', spellId: 'sanctuary', targets: ['ada'], slotLevel: 1, payment: 'slot' }),
      'ok',
    );

    const asked = outcomeOf(
      call('attack', { attacker: 'grish', target: 'ada', action: 'Scimitar' }),
      'needs-context',
    );
    expect((asked as { readonly code: string }).code).toBe('warded_fallback_required');

    // Whichever way the goblin's save falls, the call is answered: a swing let
    // through or a swing lost, never another question.
    const answered = outcomeOf(
      call('attack', { attacker: 'grish', target: 'ada', action: 'Scimitar', ifWarded: 'lose' }),
      'ok',
    ) as { readonly resolution: Record<string, unknown> };
    if (answered.resolution['warded'] === true) expect(answered.resolution['hit']).toBeNull();
  });

  /**
   * And `cast_spell` says when a ward lost the casting, so an empty
   * `outcomes` is not read as a spell that caught nobody. The ward's save is
   * the engine's die, so seeds are tried until one fails it, and every casting
   * lost that way must say so.
   */
  it('reports a casting lost to a ward as warded', () => {
    const lostOn = (seed: string): Record<string, unknown> => {
      const campaign = createCampaign({ content: SRD_CONTENT, seed });
      const surface = createSurface(campaign);
      let calls = 0;
      const call = (tool: string, input: unknown = {}): ToolOutcome =>
        surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

      outcomeOf(call('create_character', { id: 'ada', choices: cleric('Ada') }), 'ok');
      outcomeOf(call('create_character', { id: 'bo', choices: cleric('Bo') }), 'ok');
      outcomeOf(call('set_scene', { width: 60, depth: 40, height: 20 }), 'ok');
      outcomeOf(call('add_landmark', { name: 'the door', at: { x: 10, y: 10 } }), 'ok');
      outcomeOf(call('place_creature', { who: 'ada', fromLandmark: 'the door', feet: 0 }), 'ok');
      outcomeOf(call('place_creature', { who: 'bo', fromCreature: 'ada', feet: 10, bearing: 90 }), 'ok');
      outcomeOf(call('declare_sight', { from: 'bo', to: 'ada', seen: true }), 'ok');
      outcomeOf(
        call('cast_spell', { caster: 'ada', spellId: 'sanctuary', targets: ['ada'], slotLevel: 1, payment: 'slot' }),
        'ok',
      );
      return (
        outcomeOf(
          call('cast_spell', { caster: 'bo', spellId: 'sacred-flame', targets: ['ada'], ifWarded: 'lose' }),
          'ok',
        ) as { readonly resolution: Record<string, unknown> }
      ).resolution;
    };

    const tried = Array.from({ length: 12 }, (_, i) => lostOn(`warded-cast-${i}`));
    const lost = tried.filter((one) => one['warded'] === true);
    expect(lost.length).toBeGreaterThan(0);
    for (const one of lost) expect(one['outcomes']).toEqual([]);
    // And a casting that cleared the ward lands, and is not marked.
    for (const one of tried.filter((t) => t['warded'] !== true)) {
      expect((one['outcomes'] as readonly unknown[]).length).toBeGreaterThan(0);
    }
  });
});
