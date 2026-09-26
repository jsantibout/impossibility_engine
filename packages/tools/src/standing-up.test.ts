/**
 * Getting up off the floor, asked for through the door.
 *
 * SRD Prone: "_Restricted Movement._ Your only movement options are to crawl
 * or to spend an amount of movement equal to half your Speed (round down) to
 * right yourself and thereby end the condition."
 *
 * Every door that knocks a creature down has been on this surface for batches
 * — a Shove, a fall, a Gorgon's charge, Grease, the roll on the ground that
 * puts a fire out — and there was no door back up. A table's only recourse was
 * `apply_condition`'s opposite number, a DM ruling the Prone over, which
 * charges nothing and is not the creature's own act.
 *
 * The whole of the call is who is getting up: the price, the Speed it is half
 * of and every refusal are the engine's. This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  toolSchemas,
  type ToolOutcome,
} from '@ie/tools';

const fighter = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 3,
  subclassId: 'champion',
  speciesId: 'dwarf',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { str: 2, con: 1 },
  classSkills: ['athletics', 'perception'],
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {},
  feats: {
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'fighter:fighting-style': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, surface, dm, call };
}

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

const seen = (t: ReturnType<typeof table>, who: string) =>
  t.surface.observe().creatures.find((one) => one.id === who)!;

const feetLeft = (t: ReturnType<typeof table>, who: string): number =>
  seen(t, who).budget!.movementFeet;

/** One fighter on the floor, on their own turn, with thirty feet of Speed. */
function floored(seed: string) {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'bren', choices: fighter('Bren') }));
  expectOk(t.call('add_creature', { id: 'grik', monsterId: 'goblin-warrior' }));
  expectOk(t.call('set_scene', { width: 200, depth: 200, height: 40 }));
  expectOk(t.call('add_landmark', { name: 'the ditch', at: { x: 100, y: 100 } }));
  expectOk(t.call('place_creature', { who: 'bren', fromLandmark: 'the ditch', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'grik', fromCreature: 'bren', feet: 15, bearing: 90 }));
  expectOk(t.call('declare_side', { who: 'bren', side: 'party' }));
  expectOk(t.call('declare_side', { who: 'grik', side: 'foes' }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'bren' }, { who: 'grik' }] }));
  for (let guard = 0; guard < 4 && t.surface.observe().turnOf !== 'bren'; guard += 1) {
    expectOk(t.call('end_turn', {}));
  }
  expect(t.surface.observe().turnOf).toBe('bren');
  expectOk(
    t.call('apply_condition', { who: 'bren', condition: 'prone', ruling: 'the goblin tripped him' }),
  );
  return t;
}

describe('a creature gets up off the floor', () => {
  it('spends half its Speed and ends the condition', () => {
    const t = floored('up-1');
    expect(seen(t, 'bren').conditions).toContain('prone');
    expect(feetLeft(t, 'bren')).toBe(30);

    const up = expectOk(t.call('stand_up', { who: 'bren' }));
    expect(up.resolution['stood']).toBe('bren');
    expect(up.events.some((event) => event.type === 'movement-spent')).toBe(true);
    // Movement and not an action: the turn's Action is untouched.
    expect(up.events.some((event) => event.type === 'action-spent')).toBe(false);

    expect(seen(t, 'bren').conditions).not.toContain('prone');
    expect(feetLeft(t, 'bren')).toBe(15);

    // And there is nothing left to get up from.
    expect(expectRefused(t.call('stand_up', { who: 'bren' })).code).toBe('not_prone');
  });

  it('is refused once the turn has too few feet left in it', () => {
    const t = floored('up-2');
    expectOk(t.call('move', { who: 'bren', fromLandmark: 'the ditch', feet: 20, bearing: 270 }));
    const refused = expectRefused(t.call('stand_up', { who: 'bren' }));
    expect(refused.code).toBe('not_enough_movement');
    expect(seen(t, 'bren').conditions).toContain('prone');
  });

  it('is on the player’s door and takes nothing but a creature id', () => {
    const t = table('up-3');
    const schema = toolSchemas(t.surface).find((one) => one.name === 'stand_up')!;
    const parameters = schema.parameters as {
      readonly properties: Record<string, unknown>;
      readonly required?: readonly string[];
    };
    expect(Object.keys(parameters.properties)).toEqual(['who']);
    expect(parameters.required).toEqual(['who']);
    // And the DM's door holds it too, as it holds the whole player list.
    expect(toolSchemas(t.dm).some((one) => one.name === 'stand_up')).toBe(true);
  });
});
