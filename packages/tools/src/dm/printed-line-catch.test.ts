/**
 * `printed_line_catch`, and the aim on `force_printed_save` — I-E9.
 *
 * The owner ruled on 2026-09-26 that app code, not the model, plays the
 * monsters, and uses a unique ability before a plain attack whenever it is
 * legal. Code cannot choose who a Cone caught without doing geometry, so the
 * DM's surface now asks the engine: who would this line catch, aimed so — and
 * hands back the exact call that rolls for them. The door and the query are
 * one function, and the tests below hold them to naming the same creatures.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  DM_ONLY_TOOL_NAMES,
  TOOL_NAMES,
  type ToolOutcome,
} from '@ie/tools';

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`);
  }
  return outcome;
};
const expectRefused = (outcome: ToolOutcome) => {
  if (outcome.status !== 'refused') {
    throw new Error(`expected refused, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`);
  }
  return outcome;
};

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, surface, call };
}
type Table = ReturnType<typeof table>;

interface Body {
  readonly id: string;
  readonly monsterId: string;
  readonly feet: number;
  readonly bearing: number;
}

/** A monster by a landmark, the rest placed from it, and the monster's turn. */
function room(seed: string, monsterId: string, bodies: readonly Body[]): Table {
  const t = table(seed);
  expectOk(t.call('add_creature', { id: 'beast', monsterId }));
  for (const body of bodies) expectOk(t.call('add_creature', { id: body.id, monsterId: body.monsterId }));
  expectOk(t.call('set_scene', { width: 200, depth: 200, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the rock', at: { x: 100, y: 100 } }));
  expectOk(t.call('place_creature', { who: 'beast', fromLandmark: 'the rock', feet: 0 }));
  for (const body of bodies) {
    expectOk(t.call('place_creature', { who: body.id, fromCreature: 'beast', feet: body.feet, bearing: body.bearing }));
  }
  expectOk(t.call('declare_side', { who: 'beast', side: 'wild' }));
  for (const body of bodies) expectOk(t.call('declare_side', { who: body.id, side: 'party' }));
  expectOk(
    t.call('roll_initiative', { combatants: [{ who: 'beast' }, ...bodies.map((body) => ({ who: body.id }))] }),
  );
  for (let guard = 0; guard < 12 && t.surface.observe().turnOf !== 'beast'; guard += 1) {
    expectOk(t.call('end_turn', {}));
  }
  return t;
}

const goblins = (...placed: readonly [string, number, number][]): Body[] =>
  placed.map(([id, feet, bearing]) => ({ id, monsterId: 'goblin-warrior', feet, bearing }));

const COLD_BREATH = 'Cold Breath (Recharge 5–6)';
const FIRE_BREATH = 'Fire Breath (Recharge 5–6)';

const targetsOf = (outcome: ToolOutcome): readonly string[] =>
  (expectOk(outcome).resolution['outcomes'] as readonly { target: string }[]).map((one) => one.target);

describe('who a line would catch, and the call that rolls for them', () => {
  it("answers a Winter Wolf's Cone aimed at a creature, with the exact call to send", () => {
    const t = room('the-cone', 'winter-wolf', goblins(['grish', 10, 0], ['snik', 15, 0], ['pip', 10, 180]));
    const asked = expectOk(t.call('printed_line_catch', { who: 'beast', line: COLD_BREATH, towardsCreature: 'grish' }));
    expect(asked.events).toEqual([]);
    expect(asked.resolution['catches']).toEqual({ kind: 'cone', feet: 15 });
    expect(asked.resolution['caught']).toEqual(['grish', 'snik']);
    expect(asked.resolution['establish']).toEqual([]);
    expect(asked.resolution['send']).toEqual({
      tool: 'force_printed_save',
      input: { who: 'beast', line: COLD_BREATH, towardsCreature: 'grish' },
    });
  });

  it('asks for the aim rather than guessing one, and names the field that gives it', () => {
    const t = room('no-aim', 'winter-wolf', goblins(['grish', 10, 0]));
    const asked = expectOk(t.call('printed_line_catch', { who: 'beast', line: COLD_BREATH }));
    expect(asked.resolution['caught']).toEqual([]);
    const establish = asked.resolution['establish'] as readonly { kind: string; need: string; tools: string[] }[];
    expect(establish.map((one) => one.kind)).toEqual(['route']);
    expect(establish[0]!.need).toContain('towards');
    expect(establish[0]!.tools).toContain('printed_line_catch');
    expect(asked.resolution['send']).toBeUndefined();
  });

  it('refuses what the line is with the door’s own codes', () => {
    const t = room('the-codes', 'winter-wolf', goblins(['grish', 10, 0]));
    expect(expectRefused(t.call('printed_line_catch', { who: 'beast', line: 'Bite' })).code).toBe('no_such_line');
    expect(
      expectRefused(t.call('printed_line_catch', { who: 'beast', line: COLD_BREATH, atCreature: 'grish' })).code,
    ).toBe('area_starts_at_caster');
  });

  it('refuses two aims at once, before the engine is asked anything', () => {
    const t = room('two-aims', 'winter-wolf', goblins(['grish', 10, 0]));
    const both = t.call('printed_line_catch', {
      who: 'beast',
      line: COLD_BREATH,
      towardsCreature: 'grish',
      towards: { x: 0, y: 0 },
    });
    expect(both.status).toBe('invalid');
  });

  it('changes nothing: no event, no roll issued, the state byte-identical', () => {
    const t = room('read-only', 'red-dragon-wyrmling', goblins(['grish', 5, 0], ['snik', 10, 0]));
    const before = JSON.stringify(t.campaign.state());
    const logged = t.campaign.log().length;
    const issued = t.campaign.state().rollsIssued;
    expectOk(t.call('printed_line_catch', { who: 'beast', line: FIRE_BREATH, towardsCreature: 'grish' }));
    expect(t.campaign.log().length).toBe(logged);
    expect(t.campaign.state().rollsIssued).toBe(issued);
    expect(JSON.stringify(t.campaign.state())).toBe(before);
  });
});

describe('the door and the query name the same creatures', () => {
  /** The query, then the call it hands back, through the one surface. */
  const agree = (t: Table, input: Record<string, unknown>) => {
    const asked = expectOk(t.call('printed_line_catch', input));
    const caught = asked.resolution['caught'] as readonly string[];
    const send = asked.resolution['send'] as { tool: string; input: Record<string, unknown> } | undefined;
    // A line that reaches one creature hands back no call: the caller picks.
    const rolled = send === undefined
      ? targetsOf(t.call('force_printed_save', { who: input['who'], line: input['line'], targets: [caught[0]] }))
      : targetsOf(t.call(send.tool, send.input));
    return { caught, rolled };
  };

  it('for a Cone, a Line, an Emanation and a Sphere', () => {
    const cone = agree(room('agree-cone', 'red-dragon-wyrmling', goblins(['grish', 5, 0], ['snik', 10, 0], ['pip', 5, 180])), {
      who: 'beast',
      line: FIRE_BREATH,
      towardsCreature: 'grish',
    });
    expect(cone.caught).toEqual(['grish', 'snik']);
    expect(cone.rolled).toEqual(cone.caught);

    const line = agree(room('agree-line', 'blue-dragon-wyrmling', goblins(['grish', 10, 90], ['snik', 25, 90], ['pip', 10, 270])), {
      who: 'beast',
      line: 'Lightning Breath (Recharge 5–6)',
      towardsCreature: 'snik',
    });
    expect(line.caught).toEqual(['grish', 'snik']);
    expect(line.rolled).toEqual(line.caught);

    const cloud = agree(room('agree-cloud', 'dretch', goblins(['grish', 5, 0], ['snik', 20, 0])), {
      who: 'beast',
      line: 'Fetid Cloud (1/Day)',
    });
    expect(cloud.caught).toEqual(['grish']);
    expect(cloud.rolled).toEqual(cloud.caught);

    const sphere = agree(room('agree-sphere', 'gibbering-mouther', goblins(['grish', 25, 90], ['snik', 25, 270])), {
      who: 'beast',
      line: 'Blinding Spittle (Recharge 5–6)',
      atCreature: 'grish',
    });
    expect(sphere.caught).toEqual(['grish']);
    expect(sphere.rolled).toEqual(sphere.caught);
  });

  it('for a hold, a ruler to one creature, and a leap', () => {
    const t = room('agree-hold', 'otyugh', goblins(['grish', 10, 0], ['snik', 10, 180]));
    expectOk(t.call('rule_condition', { who: 'grish', condition: 'grappled', ruling: 'the tentacle' }));
    // A ruled grapple is the table's, not the otyugh's: the slam reaches
    // "each creature Grappled by the otyugh", and nobody is.
    const unheld = expectOk(t.call('printed_line_catch', { who: 'beast', line: 'Tentacle Slam' }));
    expect(unheld.resolution['caught']).toEqual([]);

    const wight = agree(room('agree-ruler', 'wight', goblins(['grish', 5, 0], ['snik', 20, 0])), {
      who: 'beast',
      line: 'Life Drain',
    });
    expect(wight.caught).toEqual(['grish']);
    expect(wight.rolled).toEqual(wight.caught);

    const b = room('agree-leap', 'bulette', goblins(['grish', 10, 0]));
    const leap = expectOk(b.call('printed_line_catch', { who: 'beast', line: 'Deadly Leap', towardsCreature: 'grish' }));
    expect(leap.resolution['caught']).toEqual(['grish']);
    const send = leap.resolution['send'] as { tool: string; input: Record<string, unknown> };
    expect(send).toEqual({
      tool: 'move_printed_line',
      input: { who: 'beast', line: 'Deadly Leap', fromCreature: 'grish', feet: 0 },
    });
    expect(targetsOf(b.call(send.tool, send.input))).toEqual(['grish']);
  });

  it('answers every CR ≤ 5 line the engine measures, and refuses none as unread', () => {
    const t = table('every-line');
    const lines: { who: string; line: string }[] = [];
    for (const monster of SRD_CONTENT.monsters.filter((one) => one.cr <= 5)) {
      const measured = [...monster.actions, ...monster.bonusActions].filter(
        (line) =>
          line.save !== undefined &&
          line.save.trigger === undefined &&
          (line.save.catches !== undefined || line.save.reach !== undefined),
      );
      if (measured.length === 0) continue;
      expectOk(t.call('add_creature', { id: monster.id, monsterId: monster.id }));
      for (const line of measured) lines.push({ who: monster.id, line: line.name });
    }
    // 35 caught by a template, a space or a hold and 25 by a ruler: the srd
    // corpus tally, `monster-saves.test.ts`.
    expect(lines.length).toBe(60);
    for (const { who, line } of lines) {
      const answer = t.call('printed_line_catch', { who, line });
      expect(answer.status, `${who}/${line}: ${JSON.stringify(answer).slice(0, 300)}`).toBe('ok');
    }
  });
});

describe('the aim on force_printed_save', () => {
  it('rolls for exactly whom the query caught, and says it measured', () => {
    const t = room('aimed', 'winter-wolf', goblins(['grish', 10, 0], ['snik', 15, 0], ['pip', 10, 180]));
    const caught = expectOk(t.call('printed_line_catch', { who: 'beast', line: COLD_BREATH, towardsCreature: 'grish' }))
      .resolution['caught'];
    const rolled = expectOk(t.call('force_printed_save', { who: 'beast', line: COLD_BREATH, towardsCreature: 'grish' }));
    expect(targetsOf(rolled)).toEqual(caught);
    expect(rolled.unverified.some((line) => line.includes('measured no area'))).toBe(false);
  });

  it('refuses a target list beside an aim before anything is spent', () => {
    const t = room('aim-and-list', 'winter-wolf', goblins(['grish', 10, 0], ['pip', 10, 180]));
    const logged = t.campaign.log().length;
    const refused = expectRefused(
      t.call('force_printed_save', { who: 'beast', line: COLD_BREATH, towardsCreature: 'grish', targets: ['pip'] }),
    );
    expect(refused.code).toBe('area_picks_its_own_targets');
    expect(t.campaign.log().length).toBe(logged);
    expect(t.campaign.state().combat!.budgets['beast']!.action).toBe(true);
  });

  it('spends the breath, so look says it is gone and the next aim is refused', () => {
    const t = room('spent', 'winter-wolf', goblins(['grish', 10, 0]));
    expectOk(t.call('force_printed_save', { who: 'beast', line: COLD_BREATH, towardsCreature: 'grish' }));
    const breath = t.surface
      .observe()
      .creatures.find((one) => one.id === 'beast')!
      .printed!.actions.find((one) => one.name === COLD_BREATH)!;
    expect(breath.expended).toBe(true);
    expect(
      expectRefused(t.call('force_printed_save', { who: 'beast', line: COLD_BREATH, towardsCreature: 'grish' })).code,
    ).toBe('line_expended');
  });

  it('is a duplicate under a repeated command id, and throws no die', () => {
    const t = room('twice', 'winter-wolf', goblins(['grish', 10, 0]));
    const first = t.surface.call({
      tool: 'force_printed_save',
      input: { who: 'beast', line: COLD_BREATH, towardsCreature: 'grish' },
      commandId: 'toolu_breath',
    });
    expectOk(first);
    const issued = t.campaign.state().rollsIssued;
    const logged = t.campaign.log().length;
    const again = expectOk(
      t.surface.call({
        tool: 'force_printed_save',
        input: { who: 'beast', line: COLD_BREATH, towardsCreature: 'grish' },
        commandId: 'toolu_breath',
      }),
    );
    expect(again.events).toEqual([]);
    expect(t.campaign.state().rollsIssued).toBe(issued);
    expect(t.campaign.log().length).toBe(logged);
  });

  it('takes the head count alone as it always has', () => {
    const t = room('counted', 'winter-wolf', goblins(['grish', 10, 0], ['pip', 10, 180]));
    const rolled = expectOk(t.call('force_printed_save', { who: 'beast', line: COLD_BREATH, targets: ['grish', 'pip'] }));
    expect(targetsOf(rolled)).toEqual(['grish', 'pip']);
    expect(rolled.unverified.some((line) => line.includes('measured no area'))).toBe(true);
  });
});

describe('the line between the two surfaces', () => {
  it("is on the DM's surface and not the player's", () => {
    expect(DM_ONLY_TOOL_NAMES).toContain('printed_line_catch');
    expect(TOOL_NAMES).not.toContain('printed_line_catch');
    const player = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'walls' }));
    const answer = player.call({ tool: 'printed_line_catch', input: {}, commandId: 'toolu_1' });
    expect(answer.status === 'invalid' && answer.code).toBe('unknown_tool');
  });
});
