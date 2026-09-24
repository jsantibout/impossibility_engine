/**
 * The one hazard the glossary prints and the one action that ends it, asked
 * for through the door.
 *
 * SRD *Burning* [Hazard]: "A burning creature or object takes 1d4 Fire damage
 * at the start of each of its turns. As an action, you can extinguish fire on
 * yourself by giving yourself the Prone condition and rolling on the ground."
 *
 * The engine has lit creatures since the Magmin's Touch was read and has had
 * `extinguishFire` since the same batch, and nothing above it could call the
 * second: a character a Magmin set alight burned every turn with no door to
 * roll on the ground. This is that door, and the whole of the call is who is
 * rolling — no number, no span, no DC.
 *
 * This file imports no engine.
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
  const rule = (tool: string, input: unknown = {}): ToolOutcome =>
    dm.call({ tool, input, commandId: `dm_${(calls += 1)}` });
  return { campaign, surface, dm, call, rule };
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

const conditionsOn = (t: ReturnType<typeof table>, who: string): readonly string[] =>
  t.surface.observe().creatures.find((one) => one.id === who)!.conditions;

/**
 * A fighter, a magmin five feet away, and a fight already running — with the
 * magmin swinging until its Touch lands, because the sentence that lights the
 * fire is on the *Hit* and whether a die falls that way is the engine's.
 */
function alight(seed: string) {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'bren', choices: fighter('Bren') }));
  expectOk(t.call('add_creature', { id: 'ember', monsterId: 'magmin' }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the forge', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'bren', fromLandmark: 'the forge', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'ember', fromCreature: 'bren', feet: 5, bearing: 90 }));
  expectOk(t.call('declare_side', { who: 'bren', side: 'party' }));
  expectOk(t.call('declare_side', { who: 'ember', side: 'wild' }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'bren' }, { who: 'ember' }] }));
  return t;
}

const turnTo = (t: ReturnType<typeof table>, who: string): void => {
  for (let guard = 0; guard < 6 && t.surface.observe().turnOf !== who; guard += 1) {
    expectOk(t.call('end_turn', {}));
  }
  expect(t.surface.observe().turnOf).toBe(who);
};

/** Swing the magmin's Touch until it lands, handing the turn round between tries. */
const lightHim = (t: ReturnType<typeof table>): void => {
  for (let guard = 0; guard < 12; guard += 1) {
    turnTo(t, 'ember');
    const swing = t.call('attack', { attacker: 'ember', target: 'bren', action: 'Touch' });
    if (swing.status === 'ok' && swing.resolution['hit'] === true) return;
    expectOk(t.call('end_turn', {}));
  }
  throw new Error('the magmin never landed its Touch');
};

describe('a creature puts out its own fire', () => {
  it('rolls on the ground, ends the fire and is left Prone', () => {
    const t = alight('ember-1');
    lightHim(t);
    turnTo(t, 'bren');

    const put = expectOk(t.call('extinguish_fire', { who: 'bren' }));
    expect(put.resolution['extinguished']).toBe('bren');
    expect(put.events.some((event) => event.type === 'hazard-ended')).toBe(true);
    expect(put.events.some((event) => event.type === 'action-spent')).toBe(true);
    // SRD's method rather than a price: the roll on the ground leaves them
    // flat on it.
    expect(conditionsOn(t, 'bren')).toContain('prone');

    // And the fire is out, so a second call has nothing to put out.
    const again = expectRefused(t.call('extinguish_fire', { who: 'bren' }));
    expect(again.code).toBe('not_burning');
  });

  it('refuses a creature that is not burning, naming the fire it has not got', () => {
    const t = alight('ember-2');
    turnTo(t, 'bren');
    const refused = expectRefused(t.call('extinguish_fire', { who: 'bren' }));
    expect(refused.code).toBe('not_burning');
    expect(refused.reason).toContain('not burning');
  });

  it('is on the player’s door and takes nothing but a creature id', () => {
    const t = table('ember-3');
    const schema = toolSchemas(t.surface).find((one) => one.name === 'extinguish_fire')!;
    const parameters = schema.parameters as {
      readonly properties: Record<string, unknown>;
      readonly required?: readonly string[];
    };
    expect(Object.keys(parameters.properties)).toEqual(['who']);
    expect(parameters.required).toEqual(['who']);
    // And the DM's door holds it too, as it holds the whole player list.
    expect(toolSchemas(t.dm).some((one) => one.name === 'extinguish_fire')).toBe(true);
  });
});
