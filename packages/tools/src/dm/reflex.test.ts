/**
 * The DM's doors onto M-REFLEX: an octopus's Ink Cloud, the table's current
 * that disperses it, and a goblin boss turning an attack on an ally.
 *
 * Each states no number. What the doors carry is what the book leaves open or
 * the engine cannot hold — whether the octopus is underwater, where it swims,
 * which ally takes the swing — and the engine reads the rest off the block.
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

function table(seed = 'reflex') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  /** End turns until it is `who`'s. */
  const turnOf = (who: string): void => {
    for (let guard = 0; guard < 6; guard += 1) {
      const combat = campaign.state().combat!;
      if (combat.order[combat.turnIndex]!.id === who) return;
      expectOk(call('end_turn', {}));
    }
    throw new Error(`never reached ${who}'s turn`);
  };
  return { campaign, call, turnOf };
}

/** An octopus of the stated block at the reef, a goblin beside it, fighting. */
function reef(block: string, goblinFeet: number) {
  const t = table();
  expectOk(t.call('add_creature', { id: 'octopus', monsterId: block }));
  expectOk(t.call('add_creature', { id: 'goblin', monsterId: 'goblin-warrior' }));
  expectOk(t.call('set_scene', { width: 200, depth: 200, height: 40 }));
  expectOk(t.call('add_landmark', { name: 'the reef', at: { x: 100, y: 100 } }));
  expectOk(t.call('place_creature', { who: 'octopus', fromLandmark: 'the reef', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'goblin', fromLandmark: 'the reef', feet: goblinFeet, bearing: 90 }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'octopus' }, { who: 'goblin' }] }));
  return t;
}

describe('release_printed_cloud', () => {
  it('takes the giant octopus’s Ink Cloud off a blow, asking for the water first', () => {
    const t = reef('giant-octopus', 10);
    expectOk(
      t.call('roll_improvised_damage', {
        target: 'octopus',
        dice: '1d4',
        damageType: 'piercing',
        ruling: 'the goblin’s spear',
        by: 'goblin',
      }),
    );
    const feature = 'giant-octopus:ink-cloud-1-day';
    const asked = t.call('release_printed_cloud', { who: 'octopus', feature });
    expect(asked.status).toBe('needs-context');

    expectOk(t.call('release_printed_cloud', { who: 'octopus', feature, underwater: true }));
    const patches = Object.keys(t.campaign.state().scene!.obscurement);
    expect(patches).toHaveLength(1);

    // The table's strong current disperses it.
    expectOk(t.call('clear_obscurement', { patch: patches[0]! }));
    expect(t.campaign.state().scene!.obscurement).toEqual({});
  });

  it('takes the octopus’s off a turn ending beside it, through the same door', () => {
    const t = reef('octopus', 5);
    t.turnOf('goblin');
    expectOk(t.call('end_turn', {}));
    expectOk(
      t.call('release_printed_cloud', {
        who: 'octopus',
        feature: 'octopus:ink-cloud-1-day',
        underwater: true,
      }),
    );
    expect(Object.keys(t.campaign.state().scene!.obscurement)).toHaveLength(1);
  });
});

describe('answer_declared_attack', () => {
  function camp() {
    const t = table();
    expectOk(t.call('add_creature', { id: 'boss', monsterId: 'goblin-boss' }));
    expectOk(t.call('add_creature', { id: 'goblin', monsterId: 'goblin-warrior' }));
    expectOk(t.call('add_creature', { id: 'bandit', monsterId: 'bandit' }));
    expectOk(t.call('declare_side', { who: 'boss', side: 'goblins' }));
    expectOk(t.call('declare_side', { who: 'goblin', side: 'goblins' }));
    expectOk(t.call('declare_side', { who: 'bandit', side: 'bandits' }));
    expectOk(t.call('set_scene', { width: 200, depth: 200, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the fire', at: { x: 100, y: 100 } }));
    expectOk(t.call('place_creature', { who: 'boss', fromLandmark: 'the fire', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'bandit', fromCreature: 'boss', feet: 5, bearing: 270 }));
    expectOk(t.call('place_creature', { who: 'goblin', fromCreature: 'boss', feet: 5, bearing: 90 }));
    expectOk(
      t.call('roll_initiative', { combatants: [{ who: 'bandit' }, { who: 'boss' }, { who: 'goblin' }] }),
    );
    t.turnOf('bandit');
    return t;
  }

  it('declares the swing, takes the boss’s answer, and throws it at the ally', () => {
    const t = camp();
    const declared = expectOk(t.call('attack', { attacker: 'bandit', target: 'boss', action: 'Scimitar' }));
    expect(declared.resolution['declared']).toEqual({ awaiting: 'boss' });

    const unsaid = t.call('answer_declared_attack', { who: 'boss' });
    expect(unsaid.status).toBe('refused');
    if (unsaid.status === 'refused') expect(unsaid.code).toBe('bad_answer');

    expectOk(
      t.call('answer_declared_attack', { who: 'boss', feature: 'goblin-boss:redirect-attack', ally: 'goblin' }),
    );
    expect(t.campaign.state().pendingSwing?.target).toBe('goblin');

    const thrown = expectOk(t.call('attack', { attacker: 'bandit', target: 'boss', action: 'Scimitar' }));
    expect(thrown.resolution['natural']).not.toBeNull();
    expect(t.campaign.state().pendingSwing).toBeUndefined();
  });

  it('lets the swing come when the boss declines', () => {
    const t = camp();
    expectOk(t.call('attack', { attacker: 'bandit', target: 'boss', action: 'Scimitar' }));
    expectOk(t.call('answer_declared_attack', { who: 'boss', decline: true }));
    expect(t.campaign.state().pendingSwing?.target).toBe('boss');
    expectOk(t.call('attack', { attacker: 'bandit', target: 'boss', action: 'Scimitar' }));
  });
});
