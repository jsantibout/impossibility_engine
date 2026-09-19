/**
 * The rest of the surface: the queries, the declarations, and the two engine
 * debts that can wedge a fight.
 *
 * `fight.test.ts` proves the spine works end to end. This proves every other
 * tool is reachable and does what it says — a surface whose handler nothing
 * has ever run is a schema with a hope attached, and the probe's hardest-won
 * finding was that a missing *settlement* is worse than a missing mechanic,
 * because the game stops rather than the action being refused.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const BOOK = [
  'magic-missile',
  'shield',
  'detect-magic',
  'feather-fall',
  'mage-armor',
  'sleep',
  'thunderwave',
  'hold-person',
  'misty-step',
  'web',
];

const wizard = (name: string): Record<string, unknown> => ({
  name,
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: BOOK.map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  })),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'hold-person', 'burning-hands', 'scorching-ray'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 600)}`);
  }
  return outcome;
};

/** Two wizards standing next to each other, with a fight running. */
function adjacent(seed = 'toe-to-toe') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${++calls}` });

  expectOk(call('create_character', { id: 'kessa', choices: wizard('Kessa') }));
  expectOk(call('create_character', { id: 'vex', choices: wizard('Vex') }));
  expectOk(call('declare_side', { who: 'kessa', side: 'party' }));
  expectOk(call('declare_side', { who: 'vex', side: 'rivals' }));
  expectOk(call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(call('add_landmark', { name: 'the bar', at: { x: 10, y: 10 } }));
  expectOk(call('place_creature', { who: 'kessa', fromLandmark: 'the bar', feet: 0 }));
  expectOk(call('place_creature', { who: 'vex', fromCreature: 'kessa', feet: 5, bearing: 0 }));
  expectOk(call('declare_sight', { from: 'kessa', to: 'vex', seen: true }));
  expectOk(call('declare_sight', { from: 'vex', to: 'kessa', seen: true }));
  expectOk(call('roll_initiative', { combatants: [{ who: 'kessa' }, { who: 'vex' }] }));
  return { campaign, surface, call };
}

describe('the queries cost nothing and write nothing', () => {
  it('look reports the authoritative state and no events', () => {
    const t = adjacent();
    const before = t.campaign.log().length;
    const outcome = expectOk(t.call('look'));
    expect(outcome.events).toHaveLength(0);
    expect(t.campaign.log()).toHaveLength(before);
    expect(outcome.resolution['round']).toBe(1);
    expect((outcome.resolution['creatures'] as unknown[]).length).toBe(2);
  });

  it('options reports the three things a caller chooses between on', () => {
    const t = adjacent();
    const turnOf = t.surface.observe().turnOf!;
    const outcome = expectOk(t.call('options', { who: turnOf }));
    expect(outcome.events).toHaveLength(0);
    // Nothing is owed, so nothing is in the way. This field answers about the
    // engine's *debts* — the area effect nobody settled, the turn start
    // nobody resolved — and is named for that rather than for "may act",
    // which it has never meant.
    expect(outcome.resolution['blockedByDebt']).toBeNull();
    expect(outcome.resolution['reactions']).toEqual([]);
    expect(outcome.resolution['checksAvailable']).toEqual([]);
  });

  it('options does not claim a Paralyzed creature is free to act', () => {
    // The field is about debts and nothing else, and a caller reading it as
    // permission would be wrong about a held creature. It reports null here
    // — correctly — and `look` is where the conditions are.
    const t = adjacent();
    const turnOf = t.surface.observe().turnOf!;
    expectOk(t.call('apply_condition', { who: turnOf, condition: 'paralyzed', ruling: 'a held spell' }));
    expect(expectOk(t.call('options', { who: turnOf })).resolution['blockedByDebt']).toBeNull();
    expect(t.surface.observe().creatures.find((c) => c.id === turnOf)!.conditions).toContain(
      'paralyzed',
    );
  });

  it('a ruled condition can be given a moment to stop at', () => {
    const t = adjacent();
    const turnOf = t.surface.observe().turnOf!;
    const applied = expectOk(
      t.call('apply_condition', {
        who: turnOf,
        condition: 'prone',
        ruling: 'the floor gave way',
        until: { kind: 'end-of-next-turn', of: turnOf },
      }),
    );
    expect(applied.resolution['until']).toEqual({ kind: 'end-of-next-turn', of: turnOf });
    expect(applied.events.some((event) => event.type === 'effect-scheduled')).toBe(true);
  });

  it('and takes no duration measured in seconds, because that is a number', () => {
    const t = adjacent();
    const outcome = t.call('apply_condition', {
      who: 'kessa',
      condition: 'prone',
      ruling: 'the floor gave way',
      until: { kind: 'seconds', seconds: 600 },
    });
    expect(outcome.status).toBe('invalid');
  });

  it('eligible_targets shortlists, and says why anyone is off the list', () => {
    const t = adjacent();
    const outcome = expectOk(
      t.call('eligible_targets', { caster: 'kessa', spellId: 'hold-person', slotLevel: 2 }),
    );
    expect(outcome.events).toHaveLength(0);
    expect(outcome.resolution['eligible']).toContain('vex');
  });
});

describe('the declarations the engine cannot work out for itself', () => {
  it('declares cover, which the engine then applies exactly', () => {
    const t = adjacent();
    const outcome = expectOk(t.call('declare_cover', { from: 'kessa', to: 'vex', degree: 'half' }));
    expect(outcome.resolution['degree']).toBe('half');
    expect(outcome.events.some((event) => event.type === 'cover-declared')).toBe(true);
  });

  it('declares a creature type once, and refuses a second, different one', () => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'types' });
    const surface = createSurface(campaign);
    let calls = 0;
    const call = (tool: string, input: unknown = {}) =>
      surface.call({ tool, input, commandId: `toolu_${++calls}` });

    expectOk(call('create_character', { id: 'kessa', choices: wizard('Kessa') }));
    // Creation already pinned Humanoid, so a contradiction is a verdict.
    const contradiction = call('declare_creature_type', { who: 'kessa', creatureType: 'Fey' });
    expect(contradiction.status).toBe('refused');
  });
});

describe('the debts a surface has to be able to settle', () => {
  it('a move out of reach is held until the Reaction is answered, and declining frees it', () => {
    const t = adjacent();
    const mover = t.surface.observe().turnOf!;
    const watcher = mover === 'kessa' ? 'vex' : 'kessa';

    const held = expectOk(t.call('move', { who: mover, fromCreature: watcher, feet: 25 }));
    expect(held.resolution['duplicate']).toBe(false);

    const owed = t.surface.observe().owed.pendingMove;
    expect(owed).not.toBeNull();
    expect(owed!.mover).toBe(mover);
    expect(owed!.mustAnswerOpportunityAttack).toContain(watcher);

    // The tool that says so. Without it the fight cannot continue, which is
    // the deadlock the probe found by wedging one.
    expectOk(t.call('decline_opportunity', { attacker: watcher }));
    expect(t.surface.observe().owed.pendingMove).toBeNull();
    expect(t.surface.observe().creatures.find((c) => c.id === mover)!.feetTo[watcher]).toBe(25);
  });

  it('or the Reaction can be taken, and the engine rolls it', () => {
    const t = adjacent();
    const mover = t.surface.observe().turnOf!;
    const watcher = mover === 'kessa' ? 'vex' : 'kessa';

    expectOk(t.call('move', { who: mover, fromCreature: watcher, feet: 25 }));
    const swung = expectOk(t.call('take_opportunity_attack', { attacker: watcher, weapon: 'quarterstaff' }));
    expect(typeof swung.resolution['natural']).toBe('number');
    expect(typeof swung.resolution['hit']).toBe('boolean');
    expect(t.surface.observe().owed.pendingMove).toBeNull();
  });

  it('settling area effects when none are owed changes nothing', () => {
    const t = adjacent();
    const before = t.campaign.log().length;
    const outcome = expectOk(t.call('settle_area_effects'));
    expect(outcome.resolution['settled']).toEqual([]);
    expect(t.campaign.log()).toHaveLength(before);
  });

  it('take_action spends the Action on a Dash, and the movement shows it', () => {
    const t = adjacent();
    const mover = t.surface.observe().turnOf!;
    const before = t.surface.observe().creatures.find((c) => c.id === mover)!.budget!;
    expectOk(t.call('take_action', { who: mover, kind: 'dash' }));
    const after = t.surface.observe().creatures.find((c) => c.id === mover)!.budget!;
    expect(before.action).toBe(true);
    expect(after.action).toBe(false);
    expect(after.movementFeet).toBeGreaterThan(before.movementFeet);
  });
});

describe('aiming a directional area', () => {
  it('asks where a creature is standing rather than guessing a coordinate', () => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'aiming' });
    const surface = createSurface(campaign);
    const outcome = surface.call({
      tool: 'cast_spell',
      input: {
        caster: 'kessa',
        spellId: 'burning-hands',
        targets: [],
        slotLevel: 1,
        towardsCreature: 'nobody',
      },
      commandId: 'toolu_1',
    });
    expect(outcome.status).toBe('needs-context');
    if (outcome.status !== 'needs-context') return;
    expect(outcome.code).toBe('no_such_position');
    expect(outcome.establish[0]!.kind).toBe('position');
    expect(outcome.establish[0]!.tools).toContain('place_creature');
    expect(campaign.log()).toHaveLength(0);
  });

  it('asks for a landmark nobody has named', () => {
    const t = adjacent();
    const outcome = t.call('cast_spell', {
      caster: 'kessa',
      spellId: 'burning-hands',
      targets: [],
      slotLevel: 1,
      towardsLandmark: 'the hearth',
    });
    expect(outcome.status).toBe('needs-context');
    if (outcome.status !== 'needs-context') return;
    expect(outcome.code).toBe('no_such_landmark');
    expect(outcome.establish[0]!.kind).toBe('scene');
    expect(outcome.establish[0]!.tools).toContain('add_landmark');
  });
});

describe('creating the same character twice', () => {
  const twice = (second: Record<string, unknown>) => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'twice' });
    const surface = createSurface(campaign);
    let calls = 0;
    const call = (tool: string, input: unknown) =>
      surface.call({ tool, input, commandId: `toolu_${++calls}` });
    expectOk(call('create_character', { id: 'kessa', choices: wizard('Kessa') }));
    const before = campaign.log().length;
    return { outcome: call('create_character', { id: 'kessa', choices: second }), campaign, before };
  };

  it('is a no-op when it is the same character', () => {
    const { outcome, campaign, before } = twice(wizard('Kessa'));
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.resolution['duplicate']).toBe(true);
    expect(campaign.log()).toHaveLength(before);
  });

  it('is a refusal when it is a different one wearing the same name', () => {
    const other = { ...wizard('Kessa'), level: 1, spellbook: [], subclassId: undefined };
    const { outcome, campaign, before } = twice(other);
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.code).toBe('id_taken');
    expect(campaign.log()).toHaveLength(before);
  });
});
