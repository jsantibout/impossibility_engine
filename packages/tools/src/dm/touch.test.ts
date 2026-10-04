/**
 * **`touch_printed_line`** — M-MATTER.
 *
 * SRD Rust Monster, Destroy Metal: "The rust monster touches a nonmagical
 * metal object within 5 feet of itself that isn't being worn or carried. The
 * touch destroys a 1-foot Cube of the object." The engine checks the touch
 * (`takePrintedTouch`); the table says whether the cube is the whole of the
 * thing, and the engine destroys it where it is. The rules are held in
 * `packages/engine/src/destroy-metal.test.ts`; this holds the door.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, createSurface, type ToolOutcome } from '@ie/tools';

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`);
  }
  return outcome;
};

function smithy() {
  const campaign = createCampaign({ content: SRD_CONTENT, seed: 'the-smithy' });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  expectOk(call('add_creature', { id: 'rust', monsterId: 'rust-monster' }));
  expectOk(call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(call('declare_side', { who: 'rust', side: 'beasts' }));
  expectOk(call('declare_side', { who: 'grish', side: 'goblins' }));
  expectOk(
    call('declare_object', { id: 'lock', name: 'the iron lock', material: 'iron', size: 'tiny', build: 'resilient' }),
  );
  expectOk(call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(call('add_landmark', { name: 'the anvil', at: { x: 10, y: 10 } }));
  expectOk(call('place_creature', { who: 'rust', fromLandmark: 'the anvil', feet: 0 }));
  expectOk(call('place_creature', { who: 'lock', fromCreature: 'rust', feet: 5, bearing: 90 }));
  expectOk(call('place_creature', { who: 'grish', fromCreature: 'rust', feet: 20, bearing: 0 }));
  expectOk(call('roll_initiative', { combatants: [{ who: 'rust' }, { who: 'grish' }] }));
  for (let guard = 0; guard < 8 && surface.observe().turnOf !== 'rust'; guard += 1) {
    expectOk(call('end_turn', {}));
  }
  return { campaign, surface, call };
}

describe('touch_printed_line', () => {
  it('is named on the line `look` reports, and on no other', () => {
    const t = smithy();
    const rust = t.surface.observe().creatures.find((one) => one.id === 'rust');
    const touching = (rust?.printed?.actions ?? []).filter((line) => line.engineMakesTheTouch);
    expect(touching.map((line) => line.name)).toEqual(['Destroy Metal']);
  });

  it('asks whether the cube is the whole of the object, and the same call answers it', () => {
    const t = smithy();
    const asked = t.call('touch_printed_line', { who: 'rust', line: 'Destroy Metal', object: 'lock' });
    expect(asked.status).toBe('needs-context');

    const out = expectOk(
      t.call('touch_printed_line', { who: 'rust', line: 'Destroy Metal', object: 'lock', wholeObject: true }),
    );
    expect(out.resolution['destroyed']).toBe(true);
    expect(t.campaign.state().creatures['lock']!.vitals.dead).toBe(true);
  });

  it('is the DM’s door and not the model’s', () => {
    const surface = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'the-smithy' }));
    const out = surface.call({ tool: 'touch_printed_line', input: {}, commandId: 'toolu_touch' });
    expect(out.status).toBe('invalid');
    if (out.status === 'invalid') expect(out.code).toBe('unknown_tool');
  });
});
