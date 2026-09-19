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
import { createCampaign, createDmSurface, createSurface, type ToolOutcome } from '@ie/tools';

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
    expect(outcome.resolution['dc']).toBe(14);
    // And the DC decided the outcome, rather than being echoed beside one.
    expect(outcome.resolution['success']).toBe((outcome.resolution['total'] as number) >= 14);

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

  /**
   * The DC is the whole of what the DM supplies, so it has to be shown
   * arriving. One seed throws one die; two Difficulty Classes decide it two
   * ways, and a `dc` echoed back into the resolution beside an outcome it did
   * not reach would pass every other assertion in this file.
   */
  it('and the class the DM set is what the roll is measured against', () => {
    const against = (dc: number) =>
      expectOk(atTheTable('one-die').call('ability_check', { who: 'kessa', ability: 'dex', dc }));
    const trivial = against(1);
    const impossible = against(30);
    expect(trivial.resolution['natural']).toBe(impossible.resolution['natural']);
    expect(trivial.resolution['success']).toBe(true);
    expect(impossible.resolution['success']).toBe(false);
  });

  /**
   * And the skill, which is the other half of what a DM chooses. Kessa is
   * proficient in Stealth and in nothing else Dexterous, so the same die
   * under the same seed totals higher when the DM names it.
   */
  it('and the skill the DM named is added by the engine, not by the caller', () => {
    const raw = expectOk(
      atTheTable('one-die').call('ability_check', { who: 'kessa', ability: 'dex', dc: 10 }),
    ).resolution;
    const sneaking = expectOk(
      atTheTable('one-die').call('ability_check', {
        who: 'kessa',
        ability: 'dex',
        skill: 'stealth',
        dc: 10,
      }),
    ).resolution;
    expect(sneaking['natural']).toBe(raw['natural']);
    // Proficiency at level 3 is +2, and the caller never said so.
    expect(sneaking['total']).toBe((raw['total'] as number) + 2);
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

    // And the span reached the clock. `effect-scheduled` alone would pass for
    // any number of seconds, including one the tool dropped on the floor: the
    // engine converts a Duration into a Deadline against its own elapsed
    // time, and the deadline is where the ten minutes actually lands.
    const scheduled = outcome.events.find((event) => event.type === 'effect-scheduled');
    expect(scheduled).toBeDefined();
    expect(scheduled).toMatchObject({
      deadline: { kind: 'elapsed', at: t.surface.observe().elapsedSeconds + 600 },
    });
  });

  it('and a different span is a different deadline', () => {
    const at = (seconds: number) => {
      const t = atTheTable();
      const outcome = expectOk(
        t.call('rule_condition', {
          who: 'kessa',
          condition: 'frightened',
          ruling: 'the shrieking',
          until: { kind: 'seconds', seconds },
        }),
      );
      const scheduled = outcome.events.find((event) => event.type === 'effect-scheduled');
      return JSON.stringify(scheduled === undefined ? null : scheduled);
    };
    expect(at(60)).not.toBe(at(600));
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

describe('one campaign, both surfaces', () => {
  /**
   * The crossing `dm/surface.ts` says is allowed, asserted rather than
   * described: a table with an AI narrator and a human DM is two callers over
   * one log, and a condition the model ruled is one the DM can end.
   *
   * It works because both doors spell the source with the same function. Two
   * string literals agreeing is not a thing a reader can check, and this is
   * the test that notices when they stop.
   */
  it('a condition the model ruled is one the DM can lift by name', () => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'two-doors' });
    const narrator = createSurface(campaign);
    const dm = createDmSurface(campaign);

    expectOk(
      narrator.call({
        tool: 'create_character',
        input: { id: 'kessa', choices: wizard('Kessa') },
        commandId: 'toolu_1',
      }),
    );
    expectOk(
      narrator.call({
        tool: 'apply_condition',
        input: { who: 'kessa', condition: 'frightened', ruling: 'the shrieking in the walls' },
        commandId: 'toolu_2',
      }),
    );
    expect(dm.observe().creatures[0]!.conditions).toContain('frightened');

    expectOk(
      dm.call({
        tool: 'end_condition',
        input: { who: 'kessa', condition: 'frightened', ruling: 'the shrieking in the walls' },
        commandId: 'toolu_3',
      }),
    );
    expect(dm.observe().creatures[0]!.conditions).not.toContain('frightened');
  });
});

/**
 * The same wizard, born of a fiend.
 *
 * One field of difference that matters — SRD Fiendish Legacy, Infernal: "You
 * have Resistance to Fire damage" — and the two feature choices that follow
 * from it, since the human's name a species that is no longer hers.
 * Everything else is Kessa, so a die thrown at one is the die thrown at the
 * other and the only thing that can move the number is the Resistance.
 */
const tiefling = (name: string): Record<string, unknown> => ({
  ...wizard(name),
  speciesId: 'tiefling',
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'tiefling:fiendish-legacy': ['Infernal'],
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
  },
});

/** The same table, with a Fire-Resistant Kessa sitting at it. */
function atTheTableResistant(seed?: string) {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'kessa', choices: tiefling('Kessa') }));
  return t;
}

describe('damage the engine rolls, for something nobody has statted', () => {
  const brazier = (t: ReturnType<typeof table>, dice = '4d6') =>
    expectOk(
      t.call('roll_improvised_damage', {
        target: 'kessa',
        dice,
        damageType: 'fire',
        ruling: 'the falling brazier',
      }),
    );

  it('throws the dice itself: the DM said 4d6 and never said what they showed', () => {
    const t = atTheTable();
    const before = t.surface.observe().creatures[0]!.hp;
    const outcome = brazier(t);

    // Nothing in the call is a number the damage could have come from, and
    // four six-sided dice cannot land outside these bounds.
    const rolled = outcome.resolution['rolled'] as number;
    expect(rolled).toBeGreaterThanOrEqual(4);
    expect(rolled).toBeLessThanOrEqual(24);
    expect(outcome.resolution['amount']).toBe(rolled);
    expect(t.surface.observe().creatures[0]!.hp).toBe(before - rolled);
    expect(JSON.stringify(outcome.events)).toContain('the falling brazier');
  });

  it('records the roll as the engine’s own, and moves the generator through the log', () => {
    const t = atTheTable();
    const before = t.campaign.state().rollsIssued;
    const outcome = brazier(t);

    const rolls = outcome.resolution['rolls'] as readonly {
      id: string;
      source: string;
      dice: readonly number[];
      total: number;
    }[];
    expect(rolls).toHaveLength(1);
    expect(rolls[0]!.source).toBe('engine');
    expect(rolls[0]!.id.length).toBeGreaterThan(0);
    expect(rolls[0]!.dice).toHaveLength(4);
    expect(rolls[0]!.total).toBe(outcome.resolution['rolled']);

    // The generator moved, and it moved *through the log* — which is the whole
    // reason this is an engine command rather than four lines in a tool.
    expect(outcome.events.some((event) => event.type === 'rolls-issued')).toBe(true);
    expect(t.campaign.state().rollsIssued).toBe(before + 1);
  });

  it('is the engine’s dice: the same seed and the same call give the same damage', () => {
    const roll = (seed: string) => brazier(atTheTable(seed)).resolution['rolled'];
    expect(roll('one-brazier')).toBe(roll('one-brazier'));
    const seeds = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => roll(`brazier-${s}`)));
    expect(seeds.size).toBeGreaterThan(1);
  });

  /**
   * The point of the command. A DM saying "7 damage" states a number that has
   * already met whatever defences the DM remembered; a DM saying "4d6 fire"
   * states a kind of damage and lets the engine measure it. This is that
   * difference measured rather than asserted — one seed, one roll, two
   * targets, and the only thing between them is the Resistance.
   */
  it('a target Resistant to the type takes half of the very same roll', () => {
    const plain = brazier(atTheTable('one-brazier')).resolution;
    const resistant = brazier(atTheTableResistant('one-brazier')).resolution;

    expect(resistant['rolled']).toBe(plain['rolled']);
    expect(plain['amount']).toBe(plain['rolled']);
    expect(resistant['amount']).toBe(Math.floor((plain['rolled'] as number) / 2));
    expect(resistant['amount']).toBeLessThan(plain['amount'] as number);
  });

  it('checks the Concentration the damage put at risk, as any other damage does', () => {
    const t = table('a-brazier-mid-spell');
    expectOk(t.call('create_character', { id: 'kessa', choices: wizard('Kessa') }));
    expectOk(t.call('create_character', { id: 'vex', choices: wizard('Vex') }));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the bar', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'kessa', fromLandmark: 'the bar', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'vex', fromCreature: 'kessa', feet: 15, bearing: 0 }));
    expectOk(t.call('declare_sight', { from: 'kessa', to: 'vex', seen: true }));
    expectOk(
      t.call('cast_spell', {
        caster: 'kessa',
        spellId: 'hold-person',
        targets: ['vex'],
        slotLevel: 2,
      }),
    );
    expect(t.surface.observe().creatures.find((c) => c.id === 'kessa')!.concentratingOn).toBe(
      'Hold Person',
    );

    // Small dice on purpose: a caster dropped to 0 is Unconscious, therefore
    // Incapacitated, therefore no longer concentrating, and the engine
    // answers `already-lost` rather than wasting a die on a save the spell
    // cannot survive. The save is what this test is about, so she has to
    // still be standing when the brazier lands.
    const outcome = expectOk(
      t.call('roll_improvised_damage', {
        target: 'kessa',
        dice: '2d4',
        damageType: 'fire',
        ruling: 'the brazier came down on her',
      }),
    );
    expect(t.surface.observe().creatures.find((c) => c.id === 'kessa')!.hp).toBeGreaterThan(0);

    expect((outcome.resolution['concentration'] as { kind: string }).kind).toBe('resolved');
    expect(
      outcome.events.some(
        (event) => event.type === 'roll-recorded' && /maintain/.test(event.label),
      ),
    ).toBe(true);
  });

  it('applies once however many times the transport sends it', () => {
    const t = atTheTable();
    const before = t.surface.observe().creatures[0]!.hp;
    brazier(t);
    const hurt = t.surface.observe().creatures[0]!.hp;
    const issued = t.campaign.state().rollsIssued;
    expect(hurt).toBeLessThan(before);

    const retry = expectOk(t.resend(1));
    expect(retry.events).toEqual([]);
    expect(retry.resolution['duplicate']).toBe(true);
    expect(t.surface.observe().creatures[0]!.hp).toBe(hurt);
    // And the dice were not thrown a second time either.
    expect(t.campaign.state().rollsIssued).toBe(issued);
  });

  it('takes no roll from the caller: an amount is not a field', () => {
    const t = atTheTable();
    for (const forged of [{ amount: 24 }, { rolled: 24 }, { total: 24 }]) {
      const outcome = t.call('roll_improvised_damage', {
        target: 'kessa',
        dice: '4d6',
        damageType: 'fire',
        ruling: 'the falling brazier',
        ...forged,
      });
      expect(outcome.status).toBe('invalid');
    }
  });

  it('refuses a damage type the rules do not print', () => {
    const t = atTheTable();
    expect(
      t.call('roll_improvised_damage', {
        target: 'kessa',
        dice: '4d6',
        damageType: 'embarrassment',
        ruling: 'the whole room saw',
      }).status,
    ).toBe('invalid');
  });

  it('refuses notation that is not dice as a value, and throws nothing', () => {
    const t = atTheTable();
    const before = { log: t.campaign.log().length, rolls: t.campaign.state().rollsIssued };
    const outcome = t.call('roll_improvised_damage', {
      target: 'kessa',
      dice: 'quite a lot',
      damageType: 'fire',
      ruling: 'the falling brazier',
    });
    expect(outcome.status).toBe('refused');
    expect(t.campaign.log()).toHaveLength(before.log);
    expect(t.campaign.state().rollsIssued).toBe(before.rolls);
  });

  it('asks about a creature nobody has declared, rather than refusing', () => {
    const t = atTheTable();
    const outcome = t.call('roll_improvised_damage', {
      target: 'the-ostler',
      dice: '2d6',
      damageType: 'bludgeoning',
      ruling: 'the beam',
    });
    expect(outcome.status).toBe('needs-context');
    if (outcome.status !== 'needs-context') return;
    expect(outcome.establish[0]!.kind).toBe('creature');
  });
});

describe('a saving throw against a Difficulty Class the table set', () => {
  it('rolls it, and the class the DM set is what decides it', () => {
    const against = (dc: number) =>
      expectOk(atTheTable('one-die').call('saving_throw', { who: 'kessa', ability: 'dex', dc }));
    const trivial = against(1);
    const impossible = against(30);
    expect(trivial.resolution['natural']).toBe(impossible.resolution['natural']);
    expect(trivial.resolution['dc']).toBe(1);
    expect(trivial.resolution['success']).toBe(true);
    expect(impossible.resolution['success']).toBe(false);
  });

  /**
   * And it really is the *save* branch. A wizard is proficient in Intelligence
   * saving throws and in no Intelligence skill, so at level 3 the same die
   * totals two higher as a save than as a raw ability check — which is a fact
   * about which of `resolveTest`'s two branches ran, said in a number the
   * caller never supplied.
   */
  it('is a saving throw and not an ability check under another name', () => {
    const check = expectOk(
      atTheTable('one-die').call('ability_check', { who: 'kessa', ability: 'int', dc: 10 }),
    ).resolution;
    const save = expectOk(
      atTheTable('one-die').call('saving_throw', { who: 'kessa', ability: 'int', dc: 10 }),
    ).resolution;
    expect(save['natural']).toBe(check['natural']);
    expect(save['total']).toBe((check['total'] as number) + 2);
  });

  /**
   * The two fields `ability_check` has that a save has not.
   *
   * `resolveTest`'s saving-throw branch reads neither a skill nor the senses
   * an attempt leans on — `rollSavingThrow` takes no skill at all, and SRD
   * writes "automatically fails an **ability check** that requires sight".
   * Offering either would be a field dropped in silence, which is exactly
   * what the fourth outcome exists to refuse.
   */
  it('offers neither a skill nor a sense, because a save reads neither', () => {
    const t = atTheTable();
    expect(
      t.call('saving_throw', { who: 'kessa', ability: 'dex', dc: 10, skill: 'acrobatics' }).status,
    ).toBe('invalid');
    expect(
      t.call('saving_throw', { who: 'kessa', ability: 'dex', dc: 10, requiresSight: true }).status,
    ).toBe('invalid');
  });

  it('records the DM’s words for why, so a later reader knows it was a ruling', () => {
    const outcome = expectOk(
      atTheTable().call('saving_throw', {
        who: 'kessa',
        ability: 'con',
        dc: 13,
        because: 'the fumes rolling off the pit',
      }),
    );
    const recorded = outcome.events.find((event) => event.type === 'roll-recorded');
    expect(JSON.stringify(recorded)).toContain('the fumes rolling off the pit');
  });

  it('takes no roll from the caller: a natural is not a field', () => {
    expect(
      atTheTable().call('saving_throw', { who: 'kessa', ability: 'dex', dc: 10, natural: 20 })
        .status,
    ).toBe('invalid');
  });

  it('asks about a creature nobody has declared', () => {
    const outcome = atTheTable().call('saving_throw', { who: 'the-ostler', ability: 'wis', dc: 10 });
    expect(outcome.status).toBe('needs-context');
    if (outcome.status !== 'needs-context') return;
    expect(outcome.establish[0]!.kind).toBe('creature');
  });

  it('applies once however many times the transport sends it', () => {
    const t = atTheTable();
    expectOk(t.call('saving_throw', { who: 'kessa', ability: 'dex', dc: 10 }));
    const retry = expectOk(t.resend(1));
    expect(retry.events).toEqual([]);
    expect(retry.resolution['duplicate']).toBe(true);
  });
});

describe('Advantage the table granted, and who granted it', () => {
  it('arrives attributed, and is visible in the roll’s own record', () => {
    const outcome = expectOk(
      atTheTable('two-dice').call('ability_check', {
        who: 'kessa',
        ability: 'dex',
        dc: 10,
        advantage: 'she has the high ground',
      }),
    );
    expect(outcome.resolution['mode']).toBe('advantage');
    expect(outcome.resolution['modeSources']).toEqual([
      { source: 'DM ruling: Advantage — she has the high ground', mode: 'advantage' },
    ]);
    // And it is not a label on one die: Advantage is two dice, and the roll's
    // own record says how many were thrown.
    expect(outcome.resolution['rolls']).toHaveLength(2);
  });

  it('and without a ruling the same call throws one die and names nobody', () => {
    const outcome = expectOk(
      atTheTable('two-dice').call('ability_check', { who: 'kessa', ability: 'dex', dc: 10 }),
    );
    expect(outcome.resolution['mode']).toBe('normal');
    expect(outcome.resolution['modeSources']).toEqual([]);
    expect(outcome.resolution['rolls']).toHaveLength(1);
  });

  it('imposes Disadvantage the same way, on a saving throw', () => {
    const outcome = expectOk(
      atTheTable('two-dice').call('saving_throw', {
        who: 'kessa',
        ability: 'con',
        dc: 12,
        disadvantage: 'she is waist deep in the fumes',
      }),
    );
    expect(outcome.resolution['mode']).toBe('disadvantage');
    expect(outcome.resolution['modeSources']).toEqual([
      { source: 'DM ruling: Disadvantage — she is waist deep in the fumes', mode: 'disadvantage' },
    ]);
    expect(outcome.resolution['rolls']).toHaveLength(2);
  });

  /**
   * SRD: Advantage and Disadvantage cancel rather than stack, and the engine
   * keeps both sources so a normal-looking roll can still say why. Two rulings
   * in one breath is the case that would otherwise read as a DM who said
   * nothing at all.
   */
  it('two rulings cancel, and both are still named', () => {
    const outcome = expectOk(
      atTheTable('two-dice').call('ability_check', {
        who: 'kessa',
        ability: 'dex',
        dc: 10,
        advantage: 'she has the high ground',
        disadvantage: 'the floor is slick with oil',
      }),
    );
    expect(outcome.resolution['mode']).toBe('normal');
    expect(outcome.resolution['modeSources']).toEqual([
      { source: 'DM ruling: Advantage — she has the high ground', mode: 'advantage' },
      { source: 'DM ruling: Disadvantage — the floor is slick with oil', mode: 'disadvantage' },
    ]);
    expect(outcome.resolution['rolls']).toHaveLength(1);
  });

  /**
   * And they cancel **on both tools, whatever words they are given**.
   *
   * The two branches of `resolveTest` do not treat `command.modes` alike: the
   * ability check concatenates them, and the saving throw hands them to
   * `savingSupport`, which keys named modes by `source` so a caller who also
   * knows about Danger Sense cannot apply it twice. A source is therefore an
   * identity, and two rulings that happen to use the same phrase — "the
   * smoke", for both — would collapse into one on the save and roll it at
   * Disadvantage while reporting a single ruling. That is the silent drop the
   * whole field pair exists to refuse, so the mode is part of the source and
   * this asserts it over both branches and both phrasings.
   */
  it.each([
    ['ability_check', 'dex', 'the high ground', 'the slick floor'],
    ['ability_check', 'dex', 'the smoke', 'the smoke'],
    ['saving_throw', 'con', 'the high ground', 'the slick floor'],
    ['saving_throw', 'con', 'the smoke', 'the smoke'],
  ])('%s on %s: a ruling each way cancels, given "%s" and "%s"', (tool, ability, up, down) => {
    const ruled = expectOk(
      atTheTable('two-dice').call(tool, {
        who: 'kessa',
        ability,
        dc: 12,
        advantage: up,
        disadvantage: down,
      }),
    ).resolution;
    const plain = expectOk(
      atTheTable('two-dice').call(tool, { who: 'kessa', ability, dc: 12 }),
    ).resolution;

    expect(ruled['mode']).toBe('normal');
    expect(ruled['rolls']).toHaveLength(1);
    // Both rulings survive to the record, even spelled the same way.
    expect(ruled['modeSources']).toEqual([
      { source: `DM ruling: Advantage — ${up}`, mode: 'advantage' },
      { source: `DM ruling: Disadvantage — ${down}`, mode: 'disadvantage' },
    ]);
    // And the die is the one an unruled call would have thrown, which is what
    // "cancel" means and what a collapsed pair would not give.
    expect(ruled['natural']).toBe(plain['natural']);
  });

  it('takes no bare flag: the ruling is the field, so there is nothing to send without one', () => {
    const t = atTheTable();
    for (const bare of [{ advantage: true }, { mode: 'advantage' }, { advantage: '' }]) {
      expect(t.call('ability_check', { who: 'kessa', ability: 'dex', dc: 10, ...bare }).status).toBe(
        'invalid',
      );
    }
  });
});

describe('the same seed and the same calls write the same log', () => {
  const evening = (seed: string) => {
    const t = atTheTable(seed);
    expectOk(
      t.call('ability_check', {
        who: 'kessa',
        ability: 'dex',
        dc: 14,
        advantage: 'the rope is already in her hand',
      }),
    );
    expectOk(
      t.call('roll_improvised_damage', {
        target: 'kessa',
        dice: '4d6',
        damageType: 'fire',
        ruling: 'the falling brazier',
      }),
    );
    expectOk(t.call('saving_throw', { who: 'kessa', ability: 'con', dc: 12, because: 'the smoke' }));
    return JSON.stringify(t.campaign.log());
  };

  it('twice over, and differently under a different seed', () => {
    expect(evening('one-evening')).toBe(evening('one-evening'));
    expect(evening('one-evening')).not.toBe(evening('another-evening'));
    expect(evening('one-evening').length).toBeGreaterThan(100);
  });
});
