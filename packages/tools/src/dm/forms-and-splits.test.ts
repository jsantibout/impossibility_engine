/**
 * The DM's doors onto W7-B12: a form taken at a rest's end, a day's die, a
 * split, and the hags' Coven Magic through the door every cast line takes.
 *
 * Each states no number. The blocks, the die, the sizes and the Hit Points are
 * the engine's; what the doors carry is what the book leaves open — whether a
 * creature takes its form or its Reaction, what the new creatures are called,
 * and where the second of two stands.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, type ToolOutcome } from '@ie/tools';

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`,
    );
  }
  return outcome;
};

function table(seed = 'forms-and-splits') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { campaign, surface, call };
}

describe('take_rest_form', () => {
  it('turns an incubus into a succubus at the end of its Long Rest, and only then', () => {
    const t = table();
    expectOk(t.call('add_creature', { id: 'fiend', monsterId: 'incubus' }));
    const early = t.call('take_rest_form', { who: 'fiend' });
    expect(early.status).toBe('refused');
    if (early.status === 'refused') expect(early.code).toBe('no_long_rest_just_finished');

    expectOk(t.call('begin_rest', { who: 'fiend', kind: 'long' }));
    expectOk(t.call('advance_time', { hours: 8, because: 'the night' }));
    expectOk(t.call('end_rest', { who: 'fiend' }));
    const changed = expectOk(t.call('take_rest_form', { who: 'fiend' }));
    expect(changed.resolution['became']).toBe('Succubus');
    expect(t.campaign.state().creatures['fiend']?.name).toBe('Succubus');
  });
});

describe('settle_block_deadlines', () => {
  it('throws the limb’s d12 once its day is up, and does nothing before', () => {
    const t = table();
    expectOk(t.call('add_creature', { id: 'limb', monsterId: 'troll-limb' }));
    const early = expectOk(t.call('settle_block_deadlines', {}));
    expect(early.resolution['thrown']).toBe(0);

    expectOk(t.call('advance_time', { hours: 24, because: 'a day passes' }));
    const thrown = expectOk(t.call('settle_block_deadlines', {}));
    expect(thrown.resolution['thrown']).toBe(1);
    const limb = t.campaign.state().creatures['limb'];
    // A Troll on a 12, and gone on anything else.
    expect(limb === undefined || limb.name === 'Troll').toBe(true);
  });
});

describe('split_printed_line', () => {
  /** A pudding at 12 Hit Points and a goblin beside it, in a fight. */
  function drain() {
    const t = table();
    expectOk(t.call('add_creature', { id: 'pudding', monsterId: 'black-pudding' }));
    expectOk(t.call('add_creature', { id: 'goblin', monsterId: 'goblin-warrior' }));
    expectOk(t.call('declare_side', { who: 'pudding', side: 'oozes' }));
    expectOk(t.call('declare_side', { who: 'goblin', side: 'party' }));
    expectOk(t.call('set_scene', { width: 200, depth: 200, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the drain', at: { x: 100, y: 100 } }));
    expectOk(t.call('place_creature', { who: 'pudding', fromLandmark: 'the drain', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'goblin', fromCreature: 'pudding', feet: 10, bearing: 90 }));
    expectOk(
      t.call('roll_initiative', { combatants: [{ who: 'pudding' }, { who: 'goblin' }] }),
    );
    const max = t.campaign.state().creatures['pudding']!.vitals.hpMax;
    expectOk(t.call('improvised_damage', { target: 'pudding', amount: max - 12, ruling: 'an earlier fight' }));
    return t;
  }

  it('asks for the names first, and splits the pudding a Slashing blow reached', () => {
    const t = drain();
    expectOk(
      t.call('roll_improvised_damage', {
        target: 'pudding',
        dice: '1d6',
        damageType: 'slashing',
        ruling: 'the goblin’s blade',
        by: 'goblin',
      }),
    );
    const asked = t.call('split_printed_line', { who: 'pudding', feature: 'black-pudding:split' });
    expect(asked.status).toBe('needs-context');

    const out = expectOk(
      t.call('split_printed_line', {
        who: 'pudding',
        feature: 'black-pudding:split',
        into: ['left', 'right'],
        placement: { fromCreature: 'goblin', feet: 10, bearing: 180 },
      }),
    );
    expect(out.resolution['into']).toEqual(['left', 'right']);
    const state = t.campaign.state();
    expect(state.creatures['pudding']).toBeUndefined();
    expect(state.creatures['left']?.vitals.hp).toBe(6);
    expect(state.creatures['right']?.size).toBe('medium');
  });
});

describe('cast_printed_line, onto a trait', () => {
  it('casts Coven Magic among two hag allies, outside a fight', () => {
    const t = table();
    for (const [id, block] of [
      ['mother', 'green-hag'],
      ['sister', 'green-hag'],
      ['aunt', 'sea-hag'],
    ] as const) {
      expectOk(t.call('add_creature', { id, monsterId: block }));
      expectOk(t.call('declare_side', { who: id, side: 'coven' }));
    }
    expectOk(t.call('set_scene', { width: 100, depth: 100, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the hut', at: { x: 50, y: 50 } }));
    expectOk(t.call('place_creature', { who: 'mother', fromLandmark: 'the hut', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'sister', fromCreature: 'mother', feet: 10, bearing: 90 }));
    expectOk(t.call('place_creature', { who: 'aunt', fromCreature: 'mother', feet: 10, bearing: 270 }));
    const cast = expectOk(
      t.call('cast_printed_line', { who: 'mother', line: 'Coven Magic', spell: 'locate-object' }),
    );
    expect(cast.resolution['castingId']).not.toBeNull();
  });
});
