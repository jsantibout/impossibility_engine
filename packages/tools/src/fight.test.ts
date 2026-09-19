/**
 * A fight, driven end to end through the tool surface and nothing else.
 *
 * **This file imports no engine.** `@ie/tools` and `@ie/content` are the
 * whole of its imports, which is the point: if a caller above the engine
 * needed to reach past this package to run a fight, the package would not
 * yet be a door. Every creature, every fact about the room, every roll and
 * every turn boundary here came through `surface.call`.
 *
 * Kessa's choices are `scenario.test.ts`'s, transcribed field for field, so
 * the character the surface builds is one the engine is already known to
 * fight with. Vex is the same character under another name, which makes the
 * fight symmetric: whichever way Initiative falls, the same script runs.
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

const book = (level: number) =>
  BOOK.slice(0, 6 + Math.max(0, level - 1) * 2).map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  }));

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
  spellbook: book(3),
  preparedSpells: [
    'magic-missile',
    'shield',
    'mage-armor',
    'hold-person',
    'burning-hands',
    'scorching-ray',
  ],
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

const SEED = 'two-wizards';

/** A table, and a caller that numbers its own `tool_use.id`s as a transport would. */
function table(seed = SEED) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const transcript: { tool: string; input: unknown }[] = [];

  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    transcript.push({ tool, input });
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };

  /** Exactly what a transport would re-send: the same id, the same arguments. */
  const resend = (index: number): ToolOutcome => {
    const sent = transcript[index]!;
    return surface.call({ ...sent, commandId: `toolu_${index + 1}` });
  };

  return { campaign, surface, call, resend };
}

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`,
    );
  }
  return outcome;
};

/** Everything up to the moment Initiative is rolled. */
function openTheRoom(t: ReturnType<typeof table>) {
  expectOk(t.call('create_character', { id: 'kessa', choices: wizard('Kessa') }));
  expectOk(t.call('create_character', { id: 'vex', choices: wizard('Vex') }));
  expectOk(t.call('declare_side', { who: 'kessa', side: 'party' }));
  expectOk(t.call('declare_side', { who: 'vex', side: 'rivals' }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the bar', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'kessa', fromLandmark: 'the bar', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'vex', fromCreature: 'kessa', feet: 15, bearing: 0 }));
  expectOk(t.call('declare_sight', { from: 'kessa', to: 'vex', seen: true }));
  expectOk(t.call('declare_sight', { from: 'vex', to: 'kessa', seen: true }));
}

/** The whole fight, as a list of what each call answered. */
function fight(t: ReturnType<typeof table>) {
  openTheRoom(t);

  const rolled = expectOk(
    t.call('roll_initiative', { combatants: [{ who: 'kessa' }, { who: 'vex' }] }),
  );

  const order = t.surface.observe().initiativeOrder!;
  const first = order[0]!;
  const second = order[1]!;

  // The first combatant closes and swings.
  const moved = expectOk(t.call('move', { who: first, fromCreature: second, feet: 5 }));
  const attacked = expectOk(t.call('attack', { attacker: first, target: second, weapon: 'quarterstaff' }));
  const endedFirst = expectOk(t.call('end_turn', {}));

  // The second answers with a spell out of a second-level slot.
  const cast = expectOk(
    t.call('cast_spell', { caster: second, spellId: 'hold-person', targets: [first], slotLevel: 2 }),
  );
  const endedSecond = expectOk(t.call('end_turn', {}));

  return { rolled, first, second, moved, attacked, endedFirst, cast, endedSecond };
}

describe('a fight through the tool surface', () => {
  it('rolls Initiative, moves, attacks, casts and ends two turns', () => {
    const t = table();
    const { rolled, first, second, moved, attacked, cast } = fight(t);

    // Initiative: the engine rolled it, the surface only said there was a fight.
    expect(rolled.resolution['began']).toBe(true);
    expect(t.surface.observe().initiativeOrder).toHaveLength(2);
    expect(rolled.events.some((event) => event.type === 'combat-started')).toBe(true);
    expect(rolled.events.some((event) => event.type === 'rolls-issued')).toBe(true);

    // The caller asked to end up five feet away; the engine decided what
    // getting there cost and where on the lattice it landed.
    expect(t.surface.observe().creatures.find((c) => c.id === first)!.feetTo[second]).toBe(5);
    expect(moved.resolution['movementCost']).toBe(moved.resolution['feetMoved']);
    expect(moved.resolution['feetMoved']).toBeGreaterThan(0);

    // The attack resolved, and every number in it is the engine's.
    expect(attacked.resolution['hit']).toBe(true);
    expect(typeof attacked.resolution['natural']).toBe('number');
    expect(typeof attacked.resolution['damageDealt']).toBe('number');

    // Hold Person: a second-level slot spent, and the caster now holding it.
    expect(typeof cast.resolution['castingId']).toBe('string');
    const casterAfter = t.surface.observe().creatures.find((c) => c.id === second)!;
    expect(casterAfter.spellSlots['2']).toBe(1);
    expect(casterAfter.concentratingOn).toBe('Hold Person');

    // Two turns ended: the order came back round to whoever went first.
    expect(t.surface.observe().turnOf).toBe(first);
    expect(t.surface.observe().round).toBe(2);
  });

  it('writes nothing to the log that an engine command did not produce', () => {
    const t = table();
    fight(t);
    // Every event in the log arrived through an `ok` outcome's `events`, and
    // `Campaign.append` is the only writer. Belt and braces: the log is
    // non-empty and the cache the surface reads agrees with it.
    expect(t.campaign.log().length).toBeGreaterThan(20);
    expect(t.campaign.state().eventCount).toBe(t.campaign.log().length);
  });
});

describe('determinism through the layer', () => {
  it('produces a byte-identical log from the same seed and the same calls', () => {
    const a = table();
    const b = table();
    fight(a);
    fight(b);
    expect(JSON.stringify(b.campaign.log())).toBe(JSON.stringify(a.campaign.log()));
  });

  it('produces a different log from a different seed', () => {
    const a = table();
    const b = table('a-different-table');
    fight(a);
    fight(b);
    expect(JSON.stringify(b.campaign.log())).not.toBe(JSON.stringify(a.campaign.log()));
  });

  it('is safe to retry: the transport re-sending a call writes nothing twice', () => {
    const t = table();
    openTheRoom(t);
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'kessa' }, { who: 'vex' }] }));
    const order = t.surface.observe().initiativeOrder!;
    expectOk(t.call('move', { who: order[0]!, fromCreature: order[1]!, feet: 5 }));

    const before = t.campaign.log().length;
    // The move again, under the id the transport already used for it (the
    // twelfth call: ten to open the room, then Initiative, then the move). A
    // retry is the same call, so it is a no-op rather than a second move.
    const again = expectOk(t.resend(11));
    expect(again.resolution['duplicate']).toBe(true);
    expect(again.events).toHaveLength(0);
    expect(t.campaign.log()).toHaveLength(before);
  });
});

describe('conditions, applied and ended', () => {
  it('applies a ruled condition and lets the engine work out what it implies', () => {
    const t = table();
    openTheRoom(t);
    const applied = expectOk(
      t.call('apply_condition', {
        who: 'vex',
        condition: 'unconscious',
        ruling: 'she was already asleep when the door came in',
      }),
    );
    expect(applied.resolution['applied']).toBe('unconscious');
    // Unconscious implies Incapacitated and Prone; the caller named one.
    const vex = t.surface.observe().creatures.find((c) => c.id === 'vex')!;
    expect(vex.conditions).toContain('unconscious');
    expect(vex.conditions).toContain('incapacitated');
    expect(vex.conditions).toContain('prone');
  });

  it('ends a spell by ending the Concentration holding it up', () => {
    const t = table('a-failed-save');
    openTheRoom(t);
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'kessa' }, { who: 'vex' }] }));
    const order = t.surface.observe().initiativeOrder!;
    const caster = order[0]!;
    const target = order[1]!;

    expectOk(t.call('cast_spell', { caster, spellId: 'hold-person', targets: [target], slotLevel: 2 }));
    expect(t.surface.observe().creatures.find((c) => c.id === caster)!.concentratingOn).toBe(
      'Hold Person',
    );

    // The save failed, so the spell is actually holding something up — which
    // is what makes ending it mean anything.
    expect(t.surface.observe().creatures.find((c) => c.id === target)!.conditions).toContain(
      'paralyzed',
    );

    expectOk(t.call('end_concentration', { who: caster }));
    expect(t.surface.observe().creatures.find((c) => c.id === caster)!.concentratingOn).toBeNull();
    expect(t.surface.observe().creatures.find((c) => c.id === target)!.conditions).toEqual([]);
  });
});

describe('a latecomer joins the fight already running', () => {
  it('rolls for them and slots them into the order, with no number from the caller', () => {
    const t = table();
    openTheRoom(t);
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'kessa' }, { who: 'vex' }] }));

    expectOk(t.call('create_character', { id: 'orin', choices: wizard('Orin') }));
    expectOk(t.call('declare_side', { who: 'orin', side: 'rivals' }));
    expectOk(t.call('place_creature', { who: 'orin', fromLandmark: 'the bar', feet: 20, bearing: 90 }));

    const joined = expectOk(t.call('roll_initiative', { combatants: [{ who: 'orin' }] }));
    expect(joined.resolution['began']).toBe(false);
    expect(t.surface.observe().initiativeOrder).toContain('orin');
    expect(t.surface.observe().initiativeOrder).toHaveLength(3);
    // The Initiative the engine rolled, recorded where the log explains it.
    expect(
      joined.events.some((event) => event.type === 'roll-recorded' && event.label === 'Initiative'),
    ).toBe(true);
    expect(joined.events.some((event) => event.type === 'combatant-joined')).toBe(true);
  });

  it('leaves the log untouched when the join is refused', () => {
    const t = table();
    openTheRoom(t);
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'kessa' }, { who: 'vex' }] }));

    const before = t.campaign.log().length;
    // Already in the order. The dice this threw are discarded with the
    // refusal, which is what makes a refusal free.
    const again = t.call('roll_initiative', { combatants: [{ who: 'kessa' }] });
    expect(again.status).toBe('refused');
    expect(t.campaign.log()).toHaveLength(before);
  });
});
