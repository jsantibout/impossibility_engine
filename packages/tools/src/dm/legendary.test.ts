/**
 * The DM's door onto a legendary action.
 *
 * SRD Unicorn: "Immediately after another creature's turn, the unicorn can
 * expend a use to take one of the following actions." The engine holds the
 * pool and the moment; what the door takes is whom the line is aimed at,
 * which is the DM's decision as the head count of a Cone is. The tool states
 * no number: the uses, the dice, the bonus and the reach are all the block's.
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

function table(seed = 'the-unicorn-charges') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { campaign, surface, call };
}

/** A unicorn and two bandits, the unicorn first in the order. */
function grove() {
  const t = table();
  expectOk(t.call('add_creature', { id: 'horn', monsterId: 'unicorn' }));
  expectOk(t.call('add_creature', { id: 'grish', monsterId: 'bandit' }));
  expectOk(t.call('add_creature', { id: 'snik', monsterId: 'bandit' }));
  expectOk(t.call('declare_side', { who: 'horn', side: 'fey' }));
  expectOk(t.call('declare_side', { who: 'grish', side: 'bandits' }));
  expectOk(t.call('declare_side', { who: 'snik', side: 'bandits' }));
  expectOk(t.call('set_scene', { width: 120, depth: 80, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the pool', at: { x: 30, y: 30 } }));
  expectOk(t.call('place_creature', { who: 'horn', fromLandmark: 'the pool', feet: 0 }));
  // Ten feet, because the unicorn is Large and five would be inside its space.
  expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'horn', feet: 10, bearing: 0 }));
  expectOk(t.call('place_creature', { who: 'snik', fromCreature: 'horn', feet: 30, bearing: 180 }));
  expectOk(
    t.call('roll_initiative', { combatants: [{ who: 'horn' }, { who: 'grish' }, { who: 'snik' }] }),
  );
  return t;
}

describe('take_legendary_action', () => {
  it('spends a use after another creature’s turn, and is refused on the unicorn’s own', () => {
    const t = grove();
    // Whoever is first: a legendary action before any turn has ended has no
    // turn to come after.
    const early = t.call('take_legendary_action', { who: 'horn', line: 'Shimmering Shield' });
    expect(early.status).toBe('refused');
    if (early.status === 'refused') expect(early.code).toBe('legendary_moment_closed');

    // A turn ends, and then turns end until the unicorn is not the one acting:
    // whoever is up has spent nothing, which is the moment.
    expectOk(t.call('end_turn', {}));
    for (let guard = 0; guard < 3 && t.surface.observe().turnOf === 'horn'; guard += 1) {
      expectOk(t.call('end_turn', {}));
    }
    expect(t.surface.observe().turnOf).not.toBe('horn');

    const out = expectOk(
      t.call('take_legendary_action', { who: 'horn', line: 'Shimmering Shield', target: 'grish' }),
    );
    expect(out.resolution['usesLeft']).toBe(2);
    expect(out.events.some((event) => event.type === 'temporary-hp-granted')).toBe(true);
    expect(out.events.some((event) => event.type === 'bonus-applied')).toBe(true);
    expect(out.events.some((event) => event.type === 'action-spent')).toBe(false);

    // Twice in one round is refused by the line's own sentence.
    const again = t.call('take_legendary_action', { who: 'horn', line: 'Shimmering Shield' });
    expect(again.status).toBe('refused');
    if (again.status === 'refused') expect(again.code).toBe('line_expended');

    // The Horn asks whom it strikes rather than guessing.
    const unaimed = t.call('take_legendary_action', { who: 'horn', line: 'Charging Horn' });
    expect(unaimed.status).toBe('needs-context');
    if (unaimed.status === 'needs-context') {
      expect(unaimed.establish.flatMap((request) => request.tools)).toEqual(['take_legendary_action']);
    }

    const charge = expectOk(
      t.call('take_legendary_action', { who: 'horn', line: 'Charging Horn', target: 'grish' }),
    );
    expect(charge.resolution['usesLeft']).toBe(1);
    expect(charge.unverified.join(' ')).toContain('half its Speed');
    expect(charge.events.some((event) => event.type === 'roll-recorded')).toBe(true);
  });
});
