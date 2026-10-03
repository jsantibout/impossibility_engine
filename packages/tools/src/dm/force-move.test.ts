/**
 * The DM's door onto a move nobody makes of their own accord — E-STABLE.
 *
 * SRD makes an Opportunity Attack available only when a creature leaves your
 * reach "using its action, its Bonus Action, its Reaction, or one of its
 * speeds", and a shove, a gust, a current or a body carried off the field is
 * none of those: it spends no Speed, provokes nobody, and asks nothing of the
 * body being moved — so a corpse can be dragged. That is `forced`, and it was
 * on the player's `move`, where a creature could call its own walk forced.
 *
 * It is imposed by an effect or by somebody else, which is a decision the
 * table makes about the world — the DM's, the way a Cone's head count and a
 * fall's height are — so it is a tool on this surface alone, and the player's
 * `move` no longer carries the word (`boundary.test.ts` one directory up).
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  DM_ONLY_TOOL_NAMES,
  type ToolOutcome,
} from '@ie/tools';

function table(seed = 'the-carried') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const dm = createDmSurface(campaign);
  const player = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    dm.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  const play = (tool: string, input: unknown = {}): ToolOutcome =>
    player.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, dm, call, play };
}

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 600)}`);
  }
  return outcome;
};

const codeOf = (outcome: ToolOutcome): string =>
  'code' in outcome && typeof outcome.code === 'string' ? outcome.code : outcome.status;

/** A goblin at the gate, and the DM's portcullis coming down on it. */
function aCorpseAtTheGate() {
  const t = table();
  expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(t.call('set_scene', { width: 100, depth: 100, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the gate', at: { x: 50, y: 50 } }));
  expectOk(t.call('place_creature', { who: 'grish', fromLandmark: 'the gate', feet: 0 }));
  const hp = t.campaign.state().creatures['grish']!.vitals.hp;
  expectOk(t.call('improvised_damage', { target: 'grish', amount: hp, ruling: 'the portcullis' }));
  expect(t.campaign.state().creatures['grish']!.vitals.dead).toBe(true);
  return t;
}

describe('the DM moves a creature by force', () => {
  it('is on the DM’s door and not the player’s', () => {
    expect(DM_ONLY_TOOL_NAMES).toContain('force_move');
    const t = table();
    const out = t.play('force_move', { who: 'grish', to: { fromLandmark: 'the gate', feet: 10 } });
    expect(out.status).toBe('invalid');
    expect(codeOf(out)).toBe('unknown_tool');
  });

  it('drags a corpse, which its own move could never carry', () => {
    const t = aCorpseAtTheGate();
    // Its own move is refused: a dead creature makes no move of its own.
    expect(codeOf(t.call('move', { who: 'grish', fromLandmark: 'the gate', feet: 10, bearing: 90 }))).toBe(
      'actor_dead',
    );

    const out = expectOk(
      t.call('force_move', { who: 'grish', to: { fromLandmark: 'the gate', feet: 10, bearing: 90 } }),
    );
    const moved = out.events.find((event) => event.type === 'creature-moved');
    expect(moved).toMatchObject({ id: 'grish', forced: true });
    // Ten feet east of where it fell.
    const at = t.campaign.state().scene!.positions['grish'];
    expect(at).toMatchObject({ x: 60, y: 50 });
  });

  it('does nothing twice under one command id', () => {
    const t = aCorpseAtTheGate();
    const request = {
      tool: 'force_move',
      input: { who: 'grish', to: { fromLandmark: 'the gate', feet: 10, bearing: 90 } },
      commandId: 'toolu_drag',
    };
    expectOk(t.dm.call(request));
    const before = t.campaign.log().length;
    const again = expectOk(t.dm.call(request));
    expect(again.events).toEqual([]);
    expect(t.campaign.log()).toHaveLength(before);
  });

  it('rejects a key it does not know, rather than dropping it in silence', () => {
    const t = aCorpseAtTheGate();
    const out = t.call('force_move', {
      who: 'grish',
      to: { fromLandmark: 'the gate', feet: 10 },
      forced: true,
    });
    expect(out.status).toBe('invalid');
  });
});
