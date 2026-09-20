/**
 * A Disengage paid for out of a Bonus Action — the allowance the engine takes
 * and nothing could ask for.
 *
 * SRD Conjure Woodland Beings: "you can take the Disengage action **as a Bonus
 * Action** for the spell's duration." `takeDisengage` has taken a `from` since
 * that spell landed and `STATABLE_PRICES` says which slots a named action may
 * come out of, but `take_action` had two fields — who, and which of the three
 * — so the whole allowance was unreachable from a model-driven session: the
 * spell could be cast, the standing effect applied, and the only call that
 * could invoke it charged an Action every time.
 *
 * **The caller names a slot and the engine rules on it.** A `from` nothing
 * granted is refused `action_not_allowed` rather than quietly charging the
 * ordinary price — a caller asking for the Bonus Action wanted to keep the
 * Action, and spending it anyway would be the wrong answer told quietly.
 *
 * **`from` is refused for a Dodge or a Dash here, in the schema.** That is
 * `placementSchema`'s rule and not a rules judgement: `takeDodge` and
 * `takeDash` have no such parameter, so a slot sent with either would be a key
 * Zod strips and a caller acting on an answer it never got — which is what the
 * fourth outcome exists to prevent. The Dash half is an engine gap and is
 * reported as one rather than papered over here.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const fighter = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'dwarf',
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, dex: 1 },
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
  featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
  feats: { 'criminal:alert': { featId: 'alert' }, 'fighter:fighting-style': { featId: 'defense' } },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, surface, call };
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

const budget = (t: ReturnType<typeof table>, id: string) =>
  t.surface.observe().creatures.find((one) => one.id === id)!.budget!;

/** Two fighters, in a fight, so there is an economy to spend from. */
function brawl(seed = 'disengage') {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
  expectOk(t.call('create_character', { id: 'orin', choices: fighter('Orin') }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the bar', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'bram', fromLandmark: 'the bar', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'orin', fromCreature: 'bram', feet: 5, bearing: 0 }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'bram' }, { who: 'orin' }] }));
  return t;
}

describe('a Disengage costs what the book charges unless something says otherwise', () => {
  it('spends the Action when no slot is named', () => {
    const t = brawl();
    const first = t.surface.observe().turnOf!;
    expect(budget(t, first).action).toBe(true);

    expectOk(t.call('take_action', { who: first, kind: 'disengage' }));
    expect(budget(t, first).action).toBe(false);
    expect(budget(t, first).bonusAction).toBe(true);
  });

  /**
   * And the field reaches the engine, which is the whole claim: a slot nothing
   * granted comes back as the engine's own refusal rather than as an Action
   * spent quietly. Before the field existed this call was indistinguishable
   * from the one above.
   */
  it('refuses a Bonus Action nothing granted, and spends neither slot', () => {
    const t = brawl();
    const first = t.surface.observe().turnOf!;

    const out = expectRefused(
      t.call('take_action', { who: first, kind: 'disengage', from: 'bonus-action' }),
    );
    expect(out.code).toBe('action_not_allowed');
    expect(budget(t, first).action).toBe(true);
    expect(budget(t, first).bonusAction).toBe(true);
  });

  it('is a field of the call, proved at its own path', () => {
    const t = brawl();
    const out = t.call('take_action', {
      who: t.surface.observe().turnOf!,
      kind: 'disengage',
      from: 17,
    });
    expect(out.status).toBe('invalid');
    if (out.status !== 'invalid') return;
    expect(out.issues.map((issue) => issue.path)).toContain('from');
  });

  /**
   * A Dodge takes no slot argument at all, so a `from` sent with one would be
   * a key stripped in silence — the failure the fourth outcome exists to
   * prevent. It is an argument mistake rather than a rules refusal, so it is
   * answered as one, at the field that caused it.
   */
  it('refuses a slot named for an action that takes none', () => {
    const t = brawl();
    const first = t.surface.observe().turnOf!;
    for (const kind of ['dodge', 'dash']) {
      const out = t.call('take_action', { who: first, kind, from: 'bonus-action' });
      expect(out.status).toBe('invalid');
      if (out.status !== 'invalid') continue;
      expect(out.issues.map((issue) => issue.path)).toContain('from');
    }
    // And nothing was spent finding that out.
    expect(budget(t, first).action).toBe(true);
    expect(budget(t, first).bonusAction).toBe(true);
  });
});
