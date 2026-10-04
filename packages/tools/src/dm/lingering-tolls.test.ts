/**
 * The DM's door onto M-LINGER: the toll a harm that outlasts the fight takes
 * every 24 hours — SRD Mummy's "its Hit Point maximum decreases by 10 (3d6)
 * every 24 hours that elapse", SRD Death Dog's repeat save.
 *
 * It states nothing. The period, the dice and the save are the line's, pinned
 * on the harm when the blow landed; the call is the settlement of a debt the
 * clock raised, `settle_block_deadlines`' shape exactly.
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

/** A knight a mummy has cursed, outside any fight, found seed by seed. */
function cursedKnight() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const t = table(`tolls-${attempt}`);
    expectOk(t.call('add_creature', { id: 'knight', monsterId: 'knight' }));
    expectOk(t.call('add_creature', { id: 'mummy', monsterId: 'mummy' }));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the tomb', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'knight', fromLandmark: 'the tomb', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'mummy', fromCreature: 'knight', feet: 5, bearing: 90 }));
    const swing = t.call('attack', { attacker: 'mummy', target: 'knight', action: 'Rotting Fist' });
    const knight = t.campaign.state().creatures['knight'];
    if (swing.status === 'ok' && knight !== undefined && !knight.vitals.dead && knight.curses.length > 0) {
      return t;
    }
  }
  throw new Error('no mummy fist cursed the knight');
}

describe('settle_daily_tolls', () => {
  it('takes the day’s 3d6 off a cursed maximum once the day is up, and nothing before', () => {
    const t = cursedKnight();
    const early = expectOk(t.call('settle_daily_tolls', {}));
    expect(early.resolution['thrown']).toBe(0);

    const before = t.campaign.state().creatures['knight']!.vitals.hpMax;
    expectOk(t.call('advance_time', { hours: 24, because: 'a day in the tomb' }));
    const thrown = expectOk(t.call('settle_daily_tolls', {}));
    expect(thrown.resolution['thrown']).toBe(1);
    const cut = before - t.campaign.state().creatures['knight']!.vitals.hpMax;
    expect(cut).toBeGreaterThanOrEqual(3);
    expect(cut).toBeLessThanOrEqual(18);
  });
});
