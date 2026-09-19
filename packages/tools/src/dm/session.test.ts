/**
 * A table with a human DM at it, driven through the DM surface and nothing
 * else.
 *
 * The doctrine's North Star is a DM free to invent: *"I swing from the
 * chandelier"* is answered with Acrobatics against a DC the table chose, and
 * the chandelier that comes down afterwards hurts whoever is under it. Every
 * one of those is a **number the DM adjudicated** — and step one's surface
 * takes none, on purpose, because the caller there is a language model.
 *
 * So this is the other half, and the line it keeps is narrower than "no
 * numbers": the DM states a DC, an amount and a span of time, and **still
 * never states a roll**. The die is the engine's here exactly as it is on the
 * model's surface; what changed is who decides what the die is thrown at.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, type ToolOutcome } from '@ie/tools';

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

/** `fight.test.ts`'s Kessa, transcribed, so the sheet is one the engine knows. */
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

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`,
    );
  }
  return outcome;
};

/** A table, and a caller that numbers its `tool_use.id`s as a transport would. */
function table(seed = 'the-chandelier') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const sent: { tool: string; input: unknown; commandId: string }[] = [];

  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    const request = { tool, input, commandId: `toolu_${calls}` };
    sent.push(request);
    return surface.call(request);
  };

  /** Exactly what a transport re-sends: the same id, the same arguments. */
  const resend = (index: number): ToolOutcome => surface.call(sent[index]!);

  return { campaign, surface, call, resend };
}

/** One character, which is all an adjudication needs. */
function atTheTable(seed?: string) {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'kessa', choices: wizard('Kessa') }));
  return t;
}

describe('a check against a Difficulty Class the table decided', () => {
  it('rolls it, and the DM supplied nothing but the class and the skill', () => {
    const t = atTheTable();
    const outcome = expectOk(
      t.call('ability_check', {
        who: 'kessa',
        ability: 'dex',
        skill: 'acrobatics',
        dc: 14,
        because: 'swinging from the chandelier',
      }),
    );

    // The engine threw the die. Nothing in the call said what it showed.
    expect(outcome.resolution['natural']).toBeGreaterThanOrEqual(1);
    expect(outcome.resolution['natural']).toBeLessThanOrEqual(20);
    expect(typeof outcome.resolution['total']).toBe('number');
    expect(typeof outcome.resolution['success']).toBe('boolean');
    expect(outcome.resolution['dc']).toBe(14);

    // And the log says why the number was what it was.
    const recorded = outcome.events.find((event) => event.type === 'roll-recorded');
    expect(recorded).toBeDefined();
    expect(outcome.events.some((event) => event.type === 'rolls-issued')).toBe(true);
  });

  it('is the engine’s die: the same seed and the same call give the same roll', () => {
    const ask = (t: ReturnType<typeof table>) =>
      expectOk(t.call('ability_check', { who: 'kessa', ability: 'dex', dc: 10 })).resolution[
        'natural'
      ];
    expect(ask(atTheTable('one-table'))).toBe(ask(atTheTable('one-table')));
    // And the seed is what makes it so, rather than the roll being fixed.
    const seeds = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => ask(atTheTable(`seed-${seed}`))),
    );
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('records the DM’s words for why, so a later reader knows it was a ruling', () => {
    const t = atTheTable();
    const outcome = expectOk(
      t.call('ability_check', {
        who: 'kessa',
        ability: 'str',
        dc: 12,
        because: 'heaving the portcullis',
      }),
    );
    const recorded = outcome.events.find((event) => event.type === 'roll-recorded');
    expect(JSON.stringify(recorded)).toContain('heaving the portcullis');
  });

  it('asks about a creature nobody has declared, rather than refusing', () => {
    const t = atTheTable();
    const outcome = t.call('ability_check', { who: 'the-ostler', ability: 'wis', dc: 10 });
    expect(outcome.status).toBe('needs-context');
    if (outcome.status !== 'needs-context') return;
    expect(outcome.establish[0]!.kind).toBe('creature');
    expect(outcome.establish[0]!.tools).toContain('create_character');
  });

  it('takes no roll from the caller: a natural is not a field', () => {
    const t = atTheTable();
    const outcome = t.call('ability_check', {
      who: 'kessa',
      ability: 'dex',
      dc: 10,
      natural: 20,
      total: 25,
    });
    // Unknown keys are not silently kept; the schema is strict about what a
    // DM may say, and what it may say is never the number on the die.
    expect(outcome.status).toBe('invalid');
  });
});

describe('damage from something nobody has statted', () => {
  it('takes the amount the DM adjudicated and applies every rule around it', () => {
    const t = atTheTable();
    const before = t.surface.observe().creatures[0]!.hp;
    const outcome = expectOk(
      t.call('improvised_damage', {
        target: 'kessa',
        amount: 7,
        ruling: 'the chandelier came down on her',
      }),
    );
    expect(t.surface.observe().creatures[0]!.hp).toBe(before - 7);
    expect(outcome.events.some((event) => event.type === 'damage-taken')).toBe(true);
    expect(JSON.stringify(outcome.events)).toContain('the chandelier came down on her');
  });

  it('drops a creature to 0 and the engine does the rest', () => {
    const t = atTheTable();
    const hp = t.surface.observe().creatures[0]!.hp;
    expectOk(
      t.call('improvised_damage', { target: 'kessa', amount: hp, ruling: 'the whole ceiling' }),
    );
    const after = t.surface.observe().creatures[0]!;
    expect(after.hp).toBe(0);
    expect(after.conditions).toContain('unconscious');
  });

  it('applies once however many times the transport sends it', () => {
    const t = atTheTable();
    const before = t.surface.observe().creatures[0]!.hp;
    expectOk(t.call('improvised_damage', { target: 'kessa', amount: 5, ruling: 'a falling beam' }));
    const retry = expectOk(t.resend(1));
    expect(retry.events).toEqual([]);
    expect(retry.resolution['duplicate']).toBe(true);
    expect(t.surface.observe().creatures[0]!.hp).toBe(before - 5);
  });

  it('refuses an amount that is not one', () => {
    const t = atTheTable();
    expect(
      t.call('improvised_damage', { target: 'kessa', amount: -3, ruling: 'a kind chandelier' })
        .status,
    ).toBe('invalid');
  });
});

describe('a condition ruled, and later ruled over', () => {
  it('applies it for a span of time only a DM may state', () => {
    const t = atTheTable();
    const outcome = expectOk(
      t.call('rule_condition', {
        who: 'kessa',
        condition: 'frightened',
        ruling: 'the shrieking in the walls',
        until: { kind: 'seconds', seconds: 600 },
      }),
    );
    expect(t.surface.observe().creatures[0]!.conditions).toContain('frightened');
    expect(outcome.events.some((event) => event.type === 'effect-scheduled')).toBe(true);
  });

  it('and lifts it again when the ruling is over', () => {
    const t = atTheTable();
    expectOk(
      t.call('rule_condition', {
        who: 'kessa',
        condition: 'frightened',
        ruling: 'the shrieking in the walls',
      }),
    );
    const lifted = expectOk(
      t.call('end_condition', {
        who: 'kessa',
        condition: 'frightened',
        ruling: 'the shrieking in the walls',
      }),
    );
    expect(lifted.events.some((event) => event.type === 'condition-removed')).toBe(true);
    expect(t.surface.observe().creatures[0]!.conditions).not.toContain('frightened');
  });

  it('ends the ruling that was named and leaves the other standing', () => {
    const t = atTheTable();
    expectOk(t.call('rule_condition', { who: 'kessa', condition: 'frightened', ruling: 'the shrieking' }));
    expectOk(t.call('rule_condition', { who: 'kessa', condition: 'frightened', ruling: 'the dragon' }));
    expectOk(
      t.call('end_condition', { who: 'kessa', condition: 'frightened', ruling: 'the shrieking' }),
    );
    // Two reasons went in and one came out, which is the whole point of
    // naming the ruling: a dragon is still a dragon.
    expect(t.surface.observe().creatures[0]!.conditions).toContain('frightened');
  });

  it('and lifts every reason when none is named', () => {
    const t = atTheTable();
    expectOk(t.call('rule_condition', { who: 'kessa', condition: 'frightened', ruling: 'the shrieking' }));
    expectOk(t.call('rule_condition', { who: 'kessa', condition: 'frightened', ruling: 'the dragon' }));
    expectOk(t.call('end_condition', { who: 'kessa', condition: 'frightened' }));
    expect(t.surface.observe().creatures[0]!.conditions).not.toContain('frightened');
  });

  it('asks about a creature nobody has declared', () => {
    const t = atTheTable();
    const outcome = t.call('end_condition', { who: 'the-ostler', condition: 'prone' });
    expect(outcome.status).toBe('needs-context');
    if (outcome.status !== 'needs-context') return;
    expect(outcome.establish[0]!.kind).toBe('creature');
  });

  it('lifts nothing twice under one command id', () => {
    const t = atTheTable();
    expectOk(t.call('rule_condition', { who: 'kessa', condition: 'prone', ruling: 'the floor gave way' }));
    expectOk(t.call('end_condition', { who: 'kessa', condition: 'prone' }));
    const again = expectOk(t.resend(2));
    expect(again.events).toEqual([]);
  });
});

describe('the whole evening, through one surface', () => {
  /**
   * The brief's session, end to end: a check against a stated DC, damage
   * nobody statted, a ruled condition applied and later lifted. Nothing here
   * touches the engine, and nothing here states a roll.
   */
  it('runs a ruling from the question to its consequences', () => {
    const t = atTheTable('one-evening');

    const swing = expectOk(
      t.call('ability_check', {
        who: 'kessa',
        ability: 'dex',
        skill: 'acrobatics',
        dc: 14,
        because: 'swinging from the chandelier',
      }),
    );
    expect(typeof swing.resolution['success']).toBe('boolean');

    expectOk(
      t.call('improvised_damage', { target: 'kessa', amount: 6, ruling: 'the chandelier fell' }),
    );
    expectOk(
      t.call('rule_condition', {
        who: 'kessa',
        condition: 'prone',
        ruling: 'flat on her back among the candles',
      }),
    );
    expect(t.surface.observe().creatures[0]!.conditions).toContain('prone');

    expectOk(
      t.call('end_condition', {
        who: 'kessa',
        condition: 'prone',
        ruling: 'flat on her back among the candles',
      }),
    );
    expect(t.surface.observe().creatures[0]!.conditions).not.toContain('prone');
  });

  it('and the DM can still do everything the fight needs', () => {
    // The DM surface is not a second, thinner door: the tools a model has are
    // on it too, minus the one the wider ruling replaces.
    const t = atTheTable();
    expectOk(t.call('set_scene', { width: 40, depth: 40, height: 15 }));
    expectOk(t.call('add_landmark', { name: 'the hearth', at: { x: 5, y: 5 } }));
    expectOk(t.call('place_creature', { who: 'kessa', fromLandmark: 'the hearth', feet: 5 }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'kessa' }] }));
    expect(t.surface.observe().round).toBe(1);
  });
});
