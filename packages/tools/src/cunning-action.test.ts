/**
 * SRD Cunning Action's three verbs, taken through the door — and the Dash
 * SRD Adrenaline Rush prints beside them.
 *
 * > "you can take one of the following actions as a Bonus Action: Dash,
 * > Disengage, or Hide."
 *
 * The engine executes all three. `actionRulesOn` merges what a creature holds
 * with what its features say, `takeDash` and `takeHide` both take a `from`
 * beside `takeDisengage`'s, and `rogue:cunning-action` grants the three
 * `allows` rules that let a Rogue state the cheaper price. Above it the
 * surface admitted a slot for a Disengage and nothing else: a Dash sent one
 * was answered `invalid` on a schema `refine`, and Hide was not one of the
 * kinds the tool would take at all. So a Rogue with the feature could invoke
 * one third of it, and an Orc could invoke none of Adrenaline Rush.
 *
 * **Hide is the reason this is a file and not two lines.** It is the one named
 * action whose legality turns on facts the table holds — who is looking, and
 * what is in the way — so it refuses in more shapes than the other five put
 * together, and each shape has to arrive as what it is. A sight line nobody
 * has settled is *homework*: `needs-context`, one request per watcher, naming
 * the door that settles it. A settled one that says the enemy is looking is a
 * refusal and closes the question. Flattening the first into the second would
 * tell a model the rules said no when the record was merely thin, which is the
 * distinction `result.ts` exists to keep.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const common = {
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
  cantrips: [],
  preparedSpells: [],
};

/** A Rogue past the level Cunning Action arrives at. */
const rogue = (name: string): Record<string, unknown> => ({
  ...common,
  name,
  classId: 'rogue',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  subclassId: 'thief',
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'rogue:ability-score-improvement': { featId: 'savage-attacker' },
  },
});

/** The control: a class whose table prints no such sentence, and a species too. */
const fighter = (name: string, speciesId = 'dwarf'): Record<string, unknown> => ({
  ...common,
  name,
  classId: 'fighter',
  level: 1,
  speciesId,
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, dex: 1 },
  classSkills: ['athletics', 'perception'],
  featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
  feats: { 'criminal:alert': { featId: 'alert' }, 'fighter:fighting-style': { featId: 'defense' } },
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

const expectNeedsContext = (outcome: ToolOutcome) => {
  if (outcome.status !== 'needs-context') {
    throw new Error(
      `expected needs-context, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

const budget = (t: ReturnType<typeof table>, id: string) =>
  t.surface.observe().creatures.find((one) => one.id === id)!.budget!;

/**
 * A Rogue and somebody to hide from, in a fight, on the Rogue's turn.
 *
 * `guardSees` is what makes the difference between the three outcomes a Hide
 * can have: `false` settles the sight line the hider's way, `true` settles it
 * against them, and leaving it out settles nothing, which is the homework
 * case.
 */
function heist(
  seed: string,
  options: { guardSees?: boolean; cover?: string; rogueName?: string } = {},
) {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'nyx', choices: rogue('Nyx') }));
  expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the bar', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'nyx', fromLandmark: 'the bar', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'bram', fromCreature: 'nyx', feet: 15, bearing: 0 }));
  if (options.guardSees !== undefined) {
    expectOk(t.call('declare_sight', { from: 'bram', to: 'nyx', seen: options.guardSees }));
  }
  if (options.cover !== undefined) {
    expectOk(t.call('declare_cover', { from: 'bram', to: 'nyx', degree: options.cover }));
  }
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'nyx' }, { who: 'bram' }] }));
  for (let step = 0; step < 2 && t.surface.observe().turnOf !== 'nyx'; step += 1) {
    expectOk(t.call('end_turn'));
  }
  expect(t.surface.observe().turnOf).toBe('nyx');
  return t;
}

describe('Cunning Action is three verbs, and each is reachable as a Bonus Action', () => {
  /**
   * The first of the three, and the one the surface refused *in its schema*:
   * a Dash sent a slot was answered `invalid` on a `refine` written when
   * `takeDash` really had no such parameter.
   */
  it('takes a Dash out of the Bonus Action', () => {
    const t = heist('cunning-dash');
    const took = expectOk(t.call('take_action', { who: 'nyx', kind: 'dash', from: 'bonus-action' }));
    expect(took.resolution['paidFrom']).toBe('bonus-action');
    expect(budget(t, 'nyx').bonusAction).toBe(false);
    // And the Action is still in hand, which is the whole point of the feature.
    expect(budget(t, 'nyx').action).toBe(true);
  });

  it('takes a Disengage out of the Bonus Action', () => {
    const t = heist('cunning-disengage');
    const took = expectOk(
      t.call('take_action', { who: 'nyx', kind: 'disengage', from: 'bonus-action' }),
    );
    expect(took.resolution['paidFrom']).toBe('bonus-action');
    expect(budget(t, 'nyx').bonusAction).toBe(false);
    expect(budget(t, 'nyx').action).toBe(true);
  });

  /**
   * The third, which was not a kind this tool would take at all. The sight
   * line is settled the hider's way and the bar is between them, so every
   * question the engine asks has an answer and the only thing left is its own
   * die.
   */
  it('takes a Hide out of the Bonus Action, and rolls the check itself', () => {
    const t = heist('cunning-hide', { guardSees: false, cover: 'total' });
    const hid = expectOk(t.call('take_action', { who: 'nyx', kind: 'hide', from: 'bonus-action' }));
    expect(hid.resolution['paidFrom']).toBe('bonus-action');
    expect(budget(t, 'nyx').bonusAction).toBe(false);
    expect(budget(t, 'nyx').action).toBe(true);
    // The engine's die, reported and not supplied: a natural on a d20 and a
    // total the modifiers moved.
    expect(hid.resolution['natural']).toBeGreaterThanOrEqual(1);
    expect(hid.resolution['natural']).toBeLessThanOrEqual(20);
    expect(typeof hid.resolution['total']).toBe('number');
    expect(typeof hid.resolution['hidden']).toBe('boolean');
    // The check is in the log whether it worked or not, under the engine's own
    // label — this surface wrote no part of it.
    const recorded = hid.events.filter((event) => event.type === 'roll-recorded');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ label: 'Dexterity (Stealth) check to Hide' });
  });

  /**
   * And the other half of the claim: the feature is what allows it. A Fighter
   * asking for any of the three is refused by the engine, by name, and spends
   * neither slot finding out.
   */
  it('refuses all three to a character who does not hold the feature', () => {
    for (const kind of ['dash', 'disengage', 'hide']) {
      const t = heist(`no-feature-${kind}`, { guardSees: false, cover: 'total' });
      expectOk(t.call('end_turn'));
      expect(t.surface.observe().turnOf).toBe('bram');
      const out = expectRefused(t.call('take_action', { who: 'bram', kind, from: 'bonus-action' }));
      expect(out.code).toBe('action_not_allowed');
      expect(budget(t, 'bram').action).toBe(true);
      expect(budget(t, 'bram').bonusAction).toBe(true);
    }
  });
});

describe('the sheet names the door, because a feature with no door named is half a door', () => {
  /**
   * A schema that takes the field is only half of it. A model elects a feature
   * it has been told it holds, and `sheet` filed every standing grant that was
   * not an optional casting-damage election under `passive` — whose whole
   * meaning is "never anybody's to spend". So a Rogue was told it held Cunning
   * Action and told, in the same breath, that nothing spent it.
   */
  it('reports Cunning Action as something to spend, and names the tool that spends it', () => {
    const t = table('cunning-sheet');
    expectOk(t.call('create_character', { id: 'nyx', choices: rogue('Nyx') }));
    const sheet = expectOk(t.call('sheet', { who: 'nyx' }));
    const features = sheet.resolution['features'] as readonly Record<string, unknown>[];
    const cunning = features.filter((one) => one['feature'] === 'rogue:cunning-action');
    // Three clauses of one sentence, so three grants under one feature.
    expect(cunning.length).toBeGreaterThan(0);
    for (const one of cunning) {
      expect(one['kind']).toBe('action-price');
      expect(one['spentBy']).toBe('take_action');
    }
  });

  /**
   * And the other direction, which is what keeps `action-price` from swallowing
   * the union: a Barbarian's Danger Sense is a standing grant too, offers the
   * holder nothing to state, and stays a passive with no door.
   */
  it('leaves a standing benefit that offers nothing to state as a passive', () => {
    const t = table('passive-sheet');
    expectOk(t.call('create_character', { id: 'nyx', choices: rogue('Nyx') }));
    const sheet = expectOk(t.call('sheet', { who: 'nyx' }));
    const features = sheet.resolution['features'] as readonly Record<string, unknown>[];
    const passives = features.filter((one) => one['kind'] === 'passive');
    expect(passives.length).toBeGreaterThan(0);
    for (const one of passives) expect(one['spentBy']).toBeNull();
  });
});

describe("SRD Adrenaline Rush: 'you can take the Dash action as a Bonus Action'", () => {
  /**
   * The same field, reached from a species rather than a class — which is the
   * point of deriving the rules from the sheet rather than storing them on the
   * creature. Nothing about this tool knows what an Orc is.
   */
  it('lets an Orc Dash out of the Bonus Action', () => {
    const t = table('adrenaline');
    expectOk(t.call('create_character', { id: 'gorm', choices: fighter('Gorm', 'orc') }));
    expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the bar', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'gorm', fromLandmark: 'the bar', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'bram', fromCreature: 'gorm', feet: 15, bearing: 0 }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'gorm' }, { who: 'bram' }] }));
    for (let step = 0; step < 2 && t.surface.observe().turnOf !== 'gorm'; step += 1) {
      expectOk(t.call('end_turn'));
    }
    expect(t.surface.observe().turnOf).toBe('gorm');

    const took = expectOk(
      t.call('take_action', { who: 'gorm', kind: 'dash', from: 'bonus-action' }),
    );
    expect(took.resolution['paidFrom']).toBe('bonus-action');
    expect(budget(t, 'gorm').bonusAction).toBe(false);
    expect(budget(t, 'gorm').action).toBe(true);
  });
});

/**
 * The four Hide outcomes this file can reach with the book, and the fifth it
 * cannot.
 *
 * `undeclared_sight` and `no_scene` are the two `needs-context` codes,
 * `seen` and `not_concealed` the two refusals. `immune` — "is immune to the
 * Invisible condition, so hiding buys nothing" — is the fifth, and **no SRD
 * content reaches it**: nothing in the bestiary lists Invisible among its
 * condition immunities and no spell in the catalogue grants immunity to it,
 * so a test for it here would have to mint homebrew content to exercise a line
 * of plumbing `seen` and `not_concealed` already prove twice. It is `err` like
 * both of those and arrives as `refused` for the same reason they do. The
 * engine's own `hide.test.ts` does not drive it either, and for the same
 * reason.
 */
describe('a Hide refuses in more shapes than any other named action, and each arrives as itself', () => {
  /**
   * The one that must not be flattened. Nobody has said whether the guard can
   * see the Rogue, so the engine has not decided anything — it has asked. The
   * outcome carries the request, the request names the kind, and the kind
   * names the tool that settles it, which is what makes it something an
   * orchestrator can act on rather than a sentence to read.
   */
  it('asks, one request per watcher, when nobody has settled a sight line', () => {
    const t = heist('hide-homework', { cover: 'total' });
    const asked = expectNeedsContext(t.call('take_action', { who: 'nyx', kind: 'hide' }));
    expect(asked.code).toBe('undeclared_sight');
    expect(asked.establish).toHaveLength(1);
    const [request] = asked.establish;
    expect(request!.kind).toBe('visibility');
    expect(request!.subject).toBe('bram');
    // The door, named: a kind with no door is the failure `doors.test.ts` is
    // about, and this is the one request on this surface that raises it.
    expect(request!.tools).toContain('declare_sight');
    // Nothing was spent and no die was thrown asking.
    expect(budget(t, 'nyx').action).toBe(true);
    expect(budget(t, 'nyx').bonusAction).toBe(true);
  });

  /**
   * The second of the two kinds a Hide can ask for, and the same claim of it:
   * cover and sight have to be *somewhere*, so a Hide before anybody has set a
   * scene is homework rather than a refusal, and the door it names is the one
   * that settles it.
   */
  it('asks for a scene when there is none for cover or sight to be in', () => {
    const t = table('hide-no-scene');
    expectOk(t.call('create_character', { id: 'nyx', choices: rogue('Nyx') }));
    expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
    const asked = expectNeedsContext(t.call('take_action', { who: 'nyx', kind: 'hide' }));
    expect(asked.code).toBe('no_scene');
    expect(asked.establish).toHaveLength(1);
    expect(asked.establish[0]!.kind).toBe('scene');
    expect(asked.establish[0]!.tools).toContain('set_scene');
  });

  /**
   * And the re-send, which is what `needs-context` promises: nobody holds a
   * partial command, the caller establishes the fact through the named door
   * and asks again.
   */
  it('goes through once the named door has been walked', () => {
    const t = heist('hide-resend', { cover: 'total' });
    expectNeedsContext(t.call('take_action', { who: 'nyx', kind: 'hide' }));
    expectOk(t.call('declare_sight', { from: 'bram', to: 'nyx', seen: false }));
    expectOk(t.call('take_action', { who: 'nyx', kind: 'hide' }));
  });

  /**
   * A settled sight line that says the guard is looking straight at the Rogue
   * closes the question: this is a refusal and not homework, because the fact
   * is there and the rules say no.
   */
  it('refuses a Hide from somebody who has been said to see the hider', () => {
    const t = heist('hide-seen', { guardSees: true, cover: 'total' });
    const out = expectRefused(t.call('take_action', { who: 'nyx', kind: 'hide' }));
    expect(out.code).toBe('seen');
    expect(budget(t, 'nyx').action).toBe(true);
  });

  /** Nothing between them, and nobody has said the Rogue is in the dark. */
  it('refuses a Hide in the open', () => {
    const t = heist('hide-open', { guardSees: false });
    const out = expectRefused(t.call('take_action', { who: 'nyx', kind: 'hide' }));
    expect(out.code).toBe('not_concealed');
    expect(budget(t, 'nyx').action).toBe(true);
  });

  /**
   * Half Cover is the degree the book leaves out, and leaving it out is the
   * point — so the refusal survives a bar that is only half a bar.
   */
  it('refuses a Hide behind Half Cover, which is not a thing you disappear behind', () => {
    const t = heist('hide-half', { guardSees: false, cover: 'half' });
    const out = expectRefused(t.call('take_action', { who: 'nyx', kind: 'hide' }));
    expect(out.code).toBe('not_concealed');
  });

  /**
   * The other route the sentence prints, and the one the engine cannot derive:
   * "while you're **Heavily Obscured**". The engine holds no light and no fog,
   * so this is the table's fact about this attempt — the same kind of thing
   * `declare_cover` and `declare_difficult_terrain` carry, and a field here
   * because the refusal above names it and a refusal naming a fact the caller
   * must supply has to be answerable through a field.
   */
  it('takes a declared Heavy Obscurement in place of the cover', () => {
    const t = heist('hide-obscured', { guardSees: false });
    expectOk(t.call('take_action', { who: 'nyx', kind: 'hide', obscured: true }));
  });

  it('is a field of the call, proved at its own path', () => {
    const t = heist('hide-field', { guardSees: false });
    const out = t.call('take_action', { who: 'nyx', kind: 'hide', obscured: 17 });
    expect(out.status).toBe('invalid');
    if (out.status !== 'invalid') return;
    expect(out.issues.map((issue) => issue.path)).toContain('obscured');
  });

  /**
   * And it is refused for the other three, in the schema rather than as a
   * rules judgement: `takeDodge`, `takeDash` and `takeDisengage` have no such
   * parameter, so a key sent with any of them would be one Zod strips in
   * silence and a caller acting on an answer it never got.
   */
  it('refuses an obscurement stated for an action that has no use for one', () => {
    const t = heist('hide-obscured-elsewhere', { guardSees: false });
    for (const kind of ['dodge', 'dash', 'disengage']) {
      const out = t.call('take_action', { who: 'nyx', kind, obscured: true });
      expect(out.status, kind).toBe('invalid');
      if (out.status !== 'invalid') continue;
      expect(out.issues.map((issue) => issue.path)).toContain('obscured');
    }
  });

  /**
   * A slot no command charges at all is still the engine's refusal for a Hide,
   * exactly as it is for a Disengage — a different sentence from
   * `action_not_allowed`, and worth keeping apart.
   */
  it('refuses a slot no command would charge', () => {
    const t = heist('hide-reaction', { guardSees: false, cover: 'total' });
    const out = expectRefused(
      t.call('take_action', { who: 'nyx', kind: 'hide', from: 'reaction' }),
    );
    expect(out.code).toBe('no_such_price');
    expect(budget(t, 'nyx').reaction).toBe(true);
  });
});
