/**
 * The running castings, and the one verdict a spell leaves nowhere else.
 *
 * `look` has always said which creature is *concentrating* on what, which is
 * one creature's view of one casting: a Web, a Grease and a Zone of Truth run
 * for ten minutes with nobody concentrating on any of them, and none of the
 * three appeared anywhere on this surface. A caller that wanted to end one had
 * to have kept the `castingId` the original `cast_spell` handed back.
 *
 * And SRD Zone of Truth needs more than that. "You know whether a creature
 * succeeds or fails on this save" is the *whole* of what the spell does that
 * the rules can see — the failure imposes no condition, because the engine
 * holds no speech — so the gate's ruling put a condition on the engine keeping
 * the fact at all: it may, when the fact is the recorded outcome of a roll the
 * engine made **and a door publishes it**. This file is the second half of
 * that sentence.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, type ToolOutcome } from '@ie/tools';

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

const cleric = (name: string): Record<string, unknown> => ({
  name,
  classId: 'cleric',
  level: 5,
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 10, con: 14, int: 8, wis: 15, cha: 13 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['medicine', 'persuasion'],
  languages: ['Dwarvish', 'Elvish'],
  alignment: 'Neutral Good',
  subclassId: 'life-domain',
  cantrips: ['sacred-flame', 'guidance', 'light', 'thaumaturgy'],
  spellbook: [],
  preparedSpells: [
    'zone-of-truth',
    'spirit-guardians',
    'inflict-wounds',
    'healing-word',
    'bane',
    'blindness-deafness',
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
});

function table(seed = 'the-zone') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, surface, call };
}

describe('`look` reports the spells still running', () => {
  it('says nothing at all before anybody casts', () => {
    const t = table('empty');
    expect(t.surface.observe().ongoing).toEqual([]);
  });

  it('names a running casting by the id every tool that ends one takes', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'ulfa', choices: cleric('Ulfa') }));
    expectOk(t.call('declare_side', { who: 'ulfa', side: 'party' }));
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    expectOk(t.call('declare_side', { who: 'grish', side: 'goblins' }));
    expectOk(t.call('set_scene', { width: 120, depth: 120, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the shrine', at: { x: 20, y: 20 } }));
    expectOk(t.call('place_creature', { who: 'ulfa', fromLandmark: 'the shrine', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'ulfa', feet: 40, bearing: 0 }));

    const cast = expectOk(
      t.call('cast_spell', {
        caster: 'ulfa',
        spellId: 'zone-of-truth',
        targets: [],
        at: { x: 20, y: 40 },
      }),
    );

    const running = t.surface.observe().ongoing;
    expect(running).toHaveLength(1);
    expect(running[0]!.spellId).toBe('zone-of-truth');
    expect(running[0]!.spell).toBe('Zone of Truth');
    expect(running[0]!.caster).toBe('ulfa');
    expect(running[0]!.level).toBe(2);
    // The id is the one `end_ongoing_spell` and `activate_spell` take, which
    // is what makes this a report a caller can act on rather than read.
    expect(running[0]!.castingId).toBe(cast.resolution['castingId']);

    // Nothing has walked in yet, so the zone has asked nobody.
    expect(running[0]!.saves).toEqual([]);

    // And what the spell *is* stays off it: the geometry is the engine's to
    // measure and the DC decides a roll the engine throws.
    expect(Object.keys(running[0]!)).toEqual([
      'castingId',
      'spellId',
      'spell',
      'caster',
      'level',
      'saves',
    ]);
  });
});
