/**
 * The moves a line makes, through the DM's door — W7-B9.
 *
 * `move_printed_line` takes a line that moves the creature and then rolls a
 * save for everybody whose space it entered; `teleport_printed_line` takes a
 * stride between two declared trees; and `move` with `using_line` spends the
 * feet a dash or a charge handed the turn. `look` says which lines admit which
 * door, off the same pinned records the engine reads.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, type ToolOutcome } from '@ie/tools';

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`);
  }
  return outcome;
};

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { campaign, surface, call };
}

describe('move_printed_line', () => {
  it('leaps a bulette onto two goblins and rolls each a save, naming no target and no number', () => {
    const t = table('the-pit');
    expectOk(t.call('add_creature', { id: 'shark', monsterId: 'bulette' }));
    expectOk(t.call('add_creature', { id: 'grix', monsterId: 'goblin-warrior' }));
    expectOk(t.call('add_creature', { id: 'nob', monsterId: 'goblin-warrior' }));
    expectOk(t.call('declare_side', { who: 'shark', side: 'wild' }));
    expectOk(t.call('declare_side', { who: 'grix', side: 'goblins' }));
    expectOk(t.call('declare_side', { who: 'nob', side: 'goblins' }));
    expectOk(t.call('set_scene', { width: 200, depth: 200, height: 30 }));
    expectOk(t.call('add_landmark', { name: 'the lip', at: { x: 50, y: 50 } }));
    expectOk(t.call('place_creature', { who: 'shark', fromLandmark: 'the lip', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'grix', fromLandmark: 'the lip', feet: 15, bearing: 0 }));
    expectOk(t.call('place_creature', { who: 'nob', fromCreature: 'grix', feet: 5, bearing: 90 }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'shark' }, { who: 'grix' }, { who: 'nob' }] }));
    for (let guard = 0; guard < 6 && t.surface.observe().turnOf !== 'shark'; guard += 1) {
      expectOk(t.call('end_turn', {}));
    }

    // `look` says which door the line admits.
    const shark = t.surface.observe().creatures.find((one) => one.id === 'shark');
    const leap = shark?.printed?.actions.find((one) => one.name === 'Deadly Leap');
    expect(leap?.engineMovesThenSaves).toBe(true);
    expect(leap?.engineRollsTheSave).toBe(false);
    expect(shark?.printed?.bonusActions.find((one) => one.name === 'Leap')?.engineGrantsJump).toBe(true);

    // The head-count door refuses the line, and names the right one.
    const wrongDoor = t.call('force_printed_save', { who: 'shark', line: 'Deadly Leap', targets: ['grix'] });
    expect(wrongDoor.status).toBe('refused');
    if (wrongDoor.status === 'refused') expect(wrongDoor.code).toBe('line_moves_first');

    const out = expectOk(
      t.call('move_printed_line', { who: 'shark', line: 'Deadly Leap', fromLandmark: 'the lip', feet: 15, bearing: 0 }),
    );
    expect(out.resolution['line']).toBe('Deadly Leap');
    expect(out.resolution['feet']).toBe(15);
    const outcomes = out.resolution['outcomes'] as readonly { target: string; saved: boolean | null }[];
    expect(outcomes.map((o) => o.target)).toEqual(['grix', 'nob']);
    expect(out.events.filter((e) => e.type === 'roll-recorded')).toHaveLength(2);
    expect(out.events.some((e) => e.type === 'action-spent')).toBe(true);
    expect(out.events.some((e) => e.type === 'movement-spent')).toBe(true);
  });

  it('asks for the route on a charge, and runs the centaur through a goblin without provoking', () => {
    const t = table('the-gate');
    expectOk(t.call('add_creature', { id: 'hoof', monsterId: 'centaur-trooper' }));
    expectOk(t.call('add_creature', { id: 'grix', monsterId: 'goblin-warrior' }));
    expectOk(t.call('declare_side', { who: 'hoof', side: 'raiders' }));
    expectOk(t.call('declare_side', { who: 'grix', side: 'goblins' }));
    expectOk(t.call('set_scene', { width: 200, depth: 200, height: 30 }));
    expectOk(t.call('add_landmark', { name: 'the gate', at: { x: 50, y: 50 } }));
    expectOk(t.call('place_creature', { who: 'hoof', fromLandmark: 'the gate', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'grix', fromLandmark: 'the gate', feet: 15, bearing: 0 }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'hoof' }, { who: 'grix' }] }));
    for (let guard = 0; guard < 4 && t.surface.observe().turnOf !== 'hoof'; guard += 1) {
      expectOk(t.call('end_turn', {}));
    }

    const asked = t.call('move_printed_line', { who: 'hoof', line: 'Trampling Charge (Recharge 5–6)' });
    expect(asked.status).toBe('needs-context');
    if (asked.status === 'needs-context') expect(asked.code).toBe('route_required');

    const out = expectOk(
      t.call('move_printed_line', {
        who: 'hoof',
        line: 'Trampling Charge (Recharge 5–6)',
        route: [
          { x: 50, y: 55 },
          { x: 50, y: 60 },
          { x: 50, y: 65 },
          { x: 50, y: 70 },
          { x: 50, y: 75 },
        ],
      }),
    );
    expect(out.resolution['expended']).toBe(true);
    expect(out.events.filter((e) => e.type === 'roll-recorded')).toHaveLength(1);
    expect(out.events.some((e) => e.type === 'movement-declared')).toBe(false);
    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(true);
  });
});

describe('a dash and a stride through the doors', () => {
  it('lets a seahorse swim on its Bubble Dash with `using_line`, and reports the water', () => {
    const t = table('the-reef');
    expectOk(t.call('add_creature', { id: 'fin', monsterId: 'giant-seahorse' }));
    expectOk(t.call('set_scene', { width: 200, depth: 200, height: 30 }));
    expectOk(t.call('add_landmark', { name: 'the rock', at: { x: 50, y: 50 } }));
    expectOk(t.call('place_creature', { who: 'fin', fromLandmark: 'the rock', feet: 0 }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'fin' }] }));

    const fin = t.surface.observe().creatures.find((one) => one.id === 'fin');
    expect(fin?.printed?.bonusActions.find((one) => one.name === 'Bubble Dash')?.engineGrantsMove).toBe(true);

    const dashed = expectOk(t.call('take_printed_bonus_action', { who: 'fin', line: 'Bubble Dash' }));
    expect(dashed.events.some((e) => e.type === 'movement-granted')).toBe(true);
    expect(dashed.unverified.join(' ')).toContain('While underwater');

    const walked = t.call('move', { who: 'fin', fromLandmark: 'the rock', feet: 5, bearing: 0, using_line: 'Bubble Dash' });
    expect(walked.status).toBe('refused');
    if (walked.status === 'refused') expect(walked.code).toBe('wrong_speed_for_line');

    const swam = expectOk(
      t.call('move', { who: 'fin', fromLandmark: 'the rock', feet: 20, bearing: 0, mode: 'swim', using_line: 'Bubble Dash' }),
    );
    expect(swam.events.find((e) => e.type === 'movement-spent')).toMatchObject({ feet: 20 });
    expect(swam.unverified.join(' ')).toContain('While underwater');
  });

  it('strides a dryad between two declared oaks named under viaFrom and viaTo', () => {
    const t = table('the-grove');
    expectOk(t.call('add_creature', { id: 'willow', monsterId: 'dryad' }));
    expectOk(t.call('declare_object', { id: 'old-oak', name: 'the old oak', material: 'wood', size: 'large', build: 'resilient' }));
    expectOk(t.call('declare_object', { id: 'far-oak', name: 'the far oak', material: 'wood', size: 'large', build: 'resilient' }));
    expectOk(t.call('set_scene', { width: 300, depth: 300, height: 60 }));
    expectOk(t.call('add_landmark', { name: 'the stone', at: { x: 50, y: 50 } }));
    expectOk(t.call('add_landmark', { name: 'the old root', at: { x: 55, y: 50 } }));
    expectOk(t.call('add_landmark', { name: 'the far root', at: { x: 55, y: 105 } }));
    expectOk(t.call('place_creature', { who: 'willow', fromLandmark: 'the stone', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'old-oak', fromLandmark: 'the old root', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'far-oak', fromLandmark: 'the far root', feet: 0 }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'willow' }] }));

    const willow = t.surface.observe().creatures.find((one) => one.id === 'willow');
    const stride = willow?.printed?.bonusActions.find((one) => one.name === 'Tree Stride');
    expect(stride?.engineTreeStrides).toBe(true);
    expect(stride?.engineTeleports).toBe(false);

    const asked = t.call('teleport_printed_line', { who: 'willow', line: 'Tree Stride', fromCreature: 'far-oak', feet: 5, bearing: 180 });
    expect(asked.status).toBe('needs-context');
    if (asked.status === 'needs-context') expect(asked.code).toBe('undeclared_trees');

    const out = expectOk(
      t.call('teleport_printed_line', {
        who: 'willow',
        line: 'Tree Stride',
        viaFrom: 'old-oak',
        viaTo: 'far-oak',
        fromCreature: 'far-oak',
        feet: 5,
        bearing: 180,
      }),
    );
    expect(out.resolution['line']).toBe('Tree Stride');
    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(true);
    expect(out.events.some((e) => e.type === 'bonus-action-spent')).toBe(true);
  });
});
