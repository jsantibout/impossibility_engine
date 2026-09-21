/**
 * A Disengage paid for out of a Bonus Action — the allowance the engine takes
 * and nothing could ask for.
 *
 * `takeDisengage` has taken a `from` since SRD Conjure Woodland Beings gave
 * the engine a sentence to model — "you can take the Disengage action **as a
 * Bonus Action** for the spell's duration" — and `STATABLE_PRICES` says which
 * slots a named action may come out of. `take_action` had two fields, who and
 * which of the three, so the allowance was unreachable from any caller:
 * whatever granted it, the only call that could invoke it charged an Action.
 *
 * **What grants a Disengage one is still homebrew, and this file is still the
 * only thing that reaches it.** Conjure Woodland Beings is recorded as
 * adjudicated in `@ie/content` — its other half is a creature the engine does
 * not summon — so no *spell* in the book hands this rule out, and the granting
 * half here is built through `extendContent` with no engine change at all: a
 * definition granting `{ kind: 'allows', action: 'disengage', from:
 * 'bonus-action' }` reaches this field and works.
 *
 * **This file used to say nothing in the book handed the rule out at all, and
 * that is no longer true.** `rogue:cunning-action` holds three `allows` rules
 * of its own — Dash, Disengage and Hide, the three clauses of the sentence —
 * and `orc:adrenaline-rush` holds the Dash. The catalogue half of the claim is
 * `cunning-action.test.ts`, which drives all four through this same field with
 * a character out of the book; the homebrew half is here, and it is the one
 * that proves *content alone* is what a new allowance takes.
 *
 * **The caller names a slot and the engine rules on it.** A `from` nothing
 * granted is refused `action_not_allowed` rather than quietly charging the
 * ordinary price — a caller asking for the Bonus Action wanted to keep the
 * Action, and spending it anyway would be the wrong answer told quietly.
 *
 * **`from` is refused for a Dodge here, in the schema**, and for a Dodge only.
 * That is `placementSchema`'s rule and not a rules judgement: `takeDodge` has
 * no such parameter, so a slot sent with it would be a key Zod strips and a
 * caller acting on an answer it never got — which is what the fourth outcome
 * exists to prevent. This comment used to say the same of a Dash and call that
 * "an engine gap"; `takeDash` takes a slot now, `STATABLE_PRICES` holds `dash`,
 * and the schema admits it.
 *
 * It imports the engine once, for `extendContent`. That is not a rule reached
 * past the door: it is the door content comes through, and the point of the
 * test is that content is all this took.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
// The one engine import in this file, and it is the homebrew door rather than
// a rule: `extendContent` is how a catalogue is added to, which is the point
// being made — the allowance needs content and not an engine change.
import { extendContent, type Content, type SpellEntry, type SpellDefinition } from '@ie/engine';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

/**
 * A homebrew spell that hands out the allowance, and its entry on a list.
 *
 * The shape `action-rules.test.ts` already drives one layer down, cast here
 * through the door instead: Range Self, a minute of Concentration, one effect,
 * and the rule the engine has always executed.
 */
const NIMBLE_STEP: SpellDefinition = {
  id: 'nimble-step',
  name: 'Nimble Step',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  durationSeconds: 600,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [
    { kind: 'action-rule', rule: { kind: 'allows', action: 'disengage', from: 'bonus-action' } },
  ],
};

const NIMBLE_STEP_ENTRY: SpellEntry = {
  id: 'nimble-step',
  name: 'Nimble Step',
  level: 1,
  school: 'conjuration',
  classes: ['wizard'],
  castingTime: 'Action',
  ritual: false,
  concentration: true,
};

const withHomebrew = (): Content => {
  const built = extendContent(SRD_CONTENT, {
    spells: [NIMBLE_STEP],
    spellEntries: [NIMBLE_STEP_ENTRY],
  });
  if (!built.ok) throw new Error(`the homebrew did not load: ${built.reason}`);
  return built.value;
};

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

/** A wizard who has the homebrew spell written down and prepared. */
const wizard = (name: string): Record<string, unknown> => ({
  name,
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
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: [
    'nimble-step',
    'magic-missile',
    'shield',
    'detect-magic',
    'mage-armor',
    'sleep',
  ].map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const })),
  preparedSpells: ['nimble-step', 'magic-missile', 'shield', 'mage-armor'],
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
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed: string, content = SRD_CONTENT) {
  const campaign = createCampaign({ content, seed });
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

  /**
   * And the accepting path, reached from content that is nobody's but this
   * file's: a homebrew spell grants the allowance, the caller invokes it, and
   * the Disengage comes out of the Bonus Action with the Action still in hand.
   * **No engine change anywhere in it** — the rule, the grant and the price
   * were all already there, and the field is what let somebody ask. It used to
   * say "which nothing in the SRD catalogue can reach", which was true of the
   * whole allowance and is now true only of the *spell*: a Rogue reaches the
   * same field off `rogue:cunning-action`, and `cunning-action.test.ts` drives
   * that. What is proved here and nowhere else is that a catalogue this
   * repository does not ship gets in through the same door.
   */
  it('takes the cheaper slot when something running on the creature grants it', () => {
    const t = table('nimble', withHomebrew());
    expectOk(t.call('create_character', { id: 'vashti', choices: wizard('Vashti') }));
    expectOk(t.call('create_character', { id: 'orin', choices: fighter('Orin') }));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the bar', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'vashti', fromLandmark: 'the bar', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'orin', fromCreature: 'vashti', feet: 5, bearing: 0 }));
    expectOk(
      t.call('roll_initiative', { combatants: [{ who: 'vashti' }, { who: 'orin' }] }),
    );
    // Whoever went first, get to the wizard's turn.
    for (let step = 0; step < 2 && t.surface.observe().turnOf !== 'vashti'; step += 1) {
      expectOk(t.call('end_turn'));
    }
    expect(t.surface.observe().turnOf).toBe('vashti');

    expectOk(
      t.call('cast_spell', {
        caster: 'vashti',
        spellId: 'nimble-step',
        targets: ['vashti'],
        slotLevel: 1,
      }),
    );
    // The casting spent the Action; the Disengage comes out of the other slot.
    expect(budget(t, 'vashti').action).toBe(false);
    const stepped = expectOk(
      t.call('take_action', { who: 'vashti', kind: 'disengage', from: 'bonus-action' }),
    );
    expect(stepped.resolution['paidFrom']).toBe('bonus-action');
    expect(budget(t, 'vashti').bonusAction).toBe(false);
  });

  /**
   * And a slot no command charges at all is the engine's other refusal, which
   * is a different sentence: `action_not_allowed` says nothing granted you
   * this price, and this says nothing charges it.
   */
  it('refuses a slot no command would charge, whatever granted what', () => {
    const t = brawl();
    const first = t.surface.observe().turnOf!;
    const out = expectRefused(
      t.call('take_action', { who: first, kind: 'disengage', from: 'reaction' }),
    );
    expect(out.code).toBe('no_such_price');
    expect(budget(t, first).action).toBe(true);
    expect(budget(t, first).reaction).toBe(true);
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
   *
   * **A Dash used to be in this loop and is not.** It was here because
   * `takeDash` really had no slot parameter; it has one now, so a Dash sent a
   * slot is a rules question the engine answers rather than an argument the
   * schema turns away, and `cunning-action.test.ts` holds it to both answers.
   * A Dodge is the only one of the four left that takes none.
   */
  it('refuses a slot named for an action that takes none', () => {
    const t = brawl();
    const first = t.surface.observe().turnOf!;
    const out = t.call('take_action', { who: first, kind: 'dodge', from: 'bonus-action' });
    expect(out.status).toBe('invalid');
    if (out.status === 'invalid') {
      expect(out.issues.map((issue) => issue.path)).toContain('from');
    }
    // And a Dash sent the same slot is *not* turned away here: it reaches the
    // engine, which refuses it by name because nothing granted this Fighter
    // the price. The difference between the two answers is the whole point.
    const dashed = t.call('take_action', { who: first, kind: 'dash', from: 'bonus-action' });
    expect(dashed.status).toBe('refused');
    if (dashed.status === 'refused') expect(dashed.code).toBe('action_not_allowed');
    // And nothing was spent finding either of those out.
    expect(budget(t, first).action).toBe(true);
    expect(budget(t, first).bonusAction).toBe(true);
  });
});
