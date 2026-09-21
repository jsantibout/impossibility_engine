/**
 * The Actions and Bonus Actions sections of a stat block, taken through a
 * door.
 *
 * `takeStatedAction` and `takeStatedBonusAction` have been finished engine
 * commands and barrelled exports for as long as the recharge ledger has
 * existed, and **neither surface imported either of them** — so every breath
 * weapon, every save-forcing Action line and every printed Bonus Action in the
 * book was a section of the block a caller could read the name of and could
 * not spend. These two tools are that door.
 *
 * What they are *not* is an execution. The engine applies no part of a printed
 * line: the whole of a successful call is the spend, the name written into the
 * log, and the block's own sentence handed back under `unverified`. That is
 * the reason they are on the DM's surface — see the note on
 * {@link TAKE_PRINTED_ACTION} — and it is what these tests hold.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  type ToolOutcome,
} from '@ie/tools';

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`,
    );
  }
  return outcome;
};

function table(seed = 'the-cold-breath') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { campaign, surface, call };
}

/**
 * SRD Winter Wolf's second Actions line, as the book prints it — en dash and
 * all. Read off the block rather than typed, because the whole claim is that
 * the name a caller sends is the name the block prints.
 */
const COLD_BREATH = 'Cold Breath (Recharge 5–6)';

/** Two monsters in a fight, which is the least a printed line can be spent in. */
function fight(seed?: string) {
  const t = table(seed);
  expectOk(t.call('add_creature', { id: 'fang', monsterId: 'winter-wolf' }));
  expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(t.call('declare_side', { who: 'fang', side: 'wolves' }));
  expectOk(t.call('declare_side', { who: 'grish', side: 'goblins' }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the drift', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'fang', fromLandmark: 'the drift', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'fang', feet: 15, bearing: 0 }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'fang' }, { who: 'grish' }] }));
  return t;
}

/** End turns until it is this creature's, which is when it may spend anything. */
function turnOf(t: ReturnType<typeof table>, who: string): void {
  for (let guard = 0; guard < 8; guard += 1) {
    if (t.surface.observe().turnOf === who) return;
    expectOk(t.call('end_turn', {}));
  }
  throw new Error(`the order never came round to ${who}`);
}

describe('a printed Action line, taken through the door', () => {
  it('spends the Action, writes the printed heading into the log, and executes none of it', () => {
    const t = fight();
    turnOf(t, 'fang');

    const out = expectOk(t.call('take_printed_action', { who: 'fang', line: COLD_BREATH }));

    // The log says what was taken, under the name the block prints.
    const taken = out.events.filter((event) => event.type === 'stated-action-taken');
    expect(taken).toHaveLength(1);
    expect((taken[0] as { line: string }).line).toBe(COLD_BREATH);
    expect(out.events.some((event) => event.type === 'action-spent')).toBe(true);
    expect(t.campaign.log().some((event) => event.type === 'stated-action-taken')).toBe(true);

    // And the resolution says whose line it was, without claiming it happened.
    expect(out.resolution['line']).toBe(COLD_BREATH);
    expect(out.resolution['who']).toBe('fang');

    // The whole of what the line *does* comes back unapplied. A DM reading
    // this is reading the block; a caller told only "the Action is gone" would
    // believe the wolf had breathed on somebody.
    expect(out.unverified).toHaveLength(1);
    expect(out.unverified[0]).toContain('Cold Breath');
    expect(out.unverified[0]).toContain('15-foot Cone');

    // Nothing was rolled. The save the line prints is the DM's to call for.
    expect(out.events.some((event) => event.type === 'rolls-issued')).toBe(false);
  });

  it('finds the line however the caller cased it, and records the printed spelling', () => {
    const t = fight('casing');
    turnOf(t, 'fang');
    const out = expectOk(
      t.call('take_printed_action', { who: 'fang', line: COLD_BREATH.toLowerCase() }),
    );
    expect((out.events.find((e) => e.type === 'stated-action-taken') as { line: string }).line).toBe(
      COLD_BREATH,
    );
    // And the answer says what the log says rather than echoing the call, so a
    // caller is never told two spellings of one heading.
    expect(out.resolution['line']).toBe(COLD_BREATH);
    // The recharge the block prints is reported off the creature's own ledger —
    // the one the engine's `line_expended` refusal reads.
    expect(out.resolution['expended']).toBe(true);
  });
});

describe('a line the block prints a recharge on', () => {
  it('is expended by taking it, and refused the second time with nothing more spent', () => {
    const t = fight('expended');
    turnOf(t, 'fang');
    expectOk(t.call('take_printed_action', { who: 'fang', line: COLD_BREATH }));

    const spentOnce = t.campaign.log().filter((event) => event.type === 'action-spent').length;
    const before = t.campaign.log().length;
    // The use is written down as expended beside the Action it cost.
    expect(t.campaign.log().some((event) => event.type === 'printed-line-expended')).toBe(true);

    const again = t.call('take_printed_action', { who: 'fang', line: COLD_BREATH });
    expect(again.status).toBe('refused');
    if (again.status !== 'refused') return;
    // `line_expended` rather than the economy's refusal, which is the engine
    // checking the ledger *before* it charges for anything — a refusal after
    // the Action is gone is a refusal with a footprint.
    expect(again.code).toBe('line_expended');
    expect(again.reason).toContain('Cold Breath');

    // And nothing was spent for it: no second `action-spent`, no new event.
    expect(t.campaign.log().filter((event) => event.type === 'action-spent').length).toBe(spentOnce);
    expect(t.campaign.log()).toHaveLength(before);
  });
});

describe('a retry says what the first call said', () => {
  it('answers a re-sent recharge line with the printed name and the recharge still spent', () => {
    const t = fight('resend-the-breath');
    turnOf(t, 'fang');

    // The heading in the caller's own casing, so an echo and a read of the log
    // cannot answer alike — this is the call that tells them apart.
    const input = { who: 'fang', line: COLD_BREATH.toUpperCase() };
    const first = expectOk(
      t.surface.call({ tool: 'take_printed_action', input, commandId: 'toolu_breath' }),
    );
    expect(first.resolution['line']).toBe(COLD_BREATH);
    expect(first.resolution['expended']).toBe(true);

    const before = t.campaign.log().length;
    const again = expectOk(
      t.surface.call({ tool: 'take_printed_action', input, commandId: 'toolu_breath' }),
    );

    // Nothing happened twice — and the answer is still the first one's, rather
    // than the caller's spelling and a recharge reported as unspent.
    expect(again.resolution['duplicate']).toBe(true);
    expect(again.events).toHaveLength(0);
    expect(t.campaign.log()).toHaveLength(before);
    expect(again.resolution['line']).toBe(COLD_BREATH);
    expect(again.resolution['expended']).toBe(true);
  });
});

describe('a printed Bonus Action line, taken through its own door', () => {
  it('spends the Bonus Action and hands the sentence back', () => {
    const t = fight('nimble');
    turnOf(t, 'grish');

    const out = expectOk(
      t.call('take_printed_bonus_action', { who: 'grish', line: 'Nimble Escape' }),
    );

    const taken = out.events.filter((event) => event.type === 'stated-bonus-action-taken');
    expect(taken).toHaveLength(1);
    expect((taken[0] as { line: string }).line).toBe('Nimble Escape');
    expect(out.events.some((event) => event.type === 'bonus-action-spent')).toBe(true);
    expect(out.resolution['line']).toBe('Nimble Escape');
    expect(out.unverified[0]).toContain('Disengage or Hide');
    // No recharge on this heading, so nothing was expended and the goblin has
    // it again next turn.
    expect(out.resolution['expended']).toBe(false);
    expect(out.events.some((event) => event.type === 'printed-line-expended')).toBe(false);
  });

  it('refuses a second Bonus Action on one turn, which is the economy and not this tool', () => {
    const t = fight('one-bonus');
    turnOf(t, 'grish');
    expectOk(t.call('take_printed_bonus_action', { who: 'grish', line: 'Nimble Escape' }));

    const again = t.call('take_printed_bonus_action', { who: 'grish', line: 'Nimble Escape' });
    expect(again.status).toBe('refused');
    if (again.status !== 'refused') return;
    expect(again.code).not.toBe('line_expended');
  });

  it('is a no-op when the transport re-sends the same call', () => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'retry' });
    const surface = createDmSurface(campaign);
    let calls = 0;
    const call = (tool: string, input: unknown = {}): ToolOutcome => {
      calls += 1;
      return surface.call({ tool, input, commandId: `toolu_${calls}` });
    };
    const t = { campaign, surface, call };
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    expectOk(t.call('add_creature', { id: 'fang', monsterId: 'winter-wolf' }));
    expectOk(t.call('declare_side', { who: 'grish', side: 'goblins' }));
    expectOk(t.call('declare_side', { who: 'fang', side: 'wolves' }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'grish' }, { who: 'fang' }] }));
    turnOf(t, 'grish');

    const input = { who: 'grish', line: 'Nimble Escape' };
    expectOk(surface.call({ tool: 'take_printed_bonus_action', input, commandId: 'toolu_same' }));
    const before = campaign.log().length;
    const retry = expectOk(
      surface.call({ tool: 'take_printed_bonus_action', input, commandId: 'toolu_same' }),
    );
    expect(retry.resolution['duplicate']).toBe(true);
    expect(retry.events).toHaveLength(0);
    expect(campaign.log()).toHaveLength(before);
  });
});

describe('everything a caller can get wrong arrives as one of the four outcomes', () => {
  it('refuses a heading the block does not print, naming what was sent', () => {
    const t = fight('no-such');
    turnOf(t, 'fang');
    const out = t.call('take_printed_action', { who: 'fang', line: 'Fire Breath' });
    expect(out.status).toBe('refused');
    if (out.status !== 'refused') return;
    expect(out.code).toBe('no_such_line');
    expect(out.reason).toContain('Fire Breath');
    expect(t.campaign.log().some((event) => event.type === 'stated-action-taken')).toBe(false);
  });

  it('refuses an attack line through this door, because the attack is its own door', () => {
    // SRD Winter Wolf's Bite is a line the parser read, so it is an attack and
    // `attack` takes it. This tool is the Actions section's *other* half.
    const t = fight('the-bite');
    turnOf(t, 'fang');
    const out = t.call('take_printed_action', { who: 'fang', line: 'Bite' });
    expect(out.status).toBe('refused');
    if (out.status !== 'refused') return;
    expect(out.code).toBe('no_such_line');
  });

  it('refuses a line taken outside a fight, as a value rather than an exception', () => {
    const t = table('no-fight');
    expectOk(t.call('add_creature', { id: 'fang', monsterId: 'winter-wolf' }));
    const out = t.call('take_printed_action', { who: 'fang', line: COLD_BREATH });
    expect(out.status).toBe('refused');
    if (out.status !== 'refused') return;
    expect(out.code).toBe('not_in_combat');
  });

  it('answers a creature nobody has added through the field that names it', () => {
    const t = fight('nobody');
    turnOf(t, 'fang');
    const out = t.call('take_printed_bonus_action', { who: 'nobody', line: 'Nimble Escape' });
    expect(out.status === 'refused' || out.status === 'needs-context').toBe(true);
  });

  it('rejects a call with no line at all before the engine is asked', () => {
    const t = fight('no-line');
    const missing = t.call('take_printed_action', { who: 'fang' });
    expect(missing.status).toBe('invalid');
    if (missing.status !== 'invalid') return;
    expect(missing.issues.map((issue) => issue.path)).toContain('line');

    const blank = t.call('take_printed_bonus_action', { who: 'grish', line: '' });
    expect(blank.status).toBe('invalid');
    expect(t.campaign.log().some((event) => event.type === 'stated-action-taken')).toBe(false);
  });
});

describe('the two doors are the DM’s and not the model’s', () => {
  it('is not a tool a model-driven session can call', () => {
    const surface = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'walls' }));
    // Non-vacuous: the DM's surface really does hold both.
    const dm = createDmSurface(createCampaign({ content: SRD_CONTENT, seed: 'walls' }));
    const theirs = dm.tools.map((definition) => definition.name);
    expect(theirs).toContain('take_printed_action');
    expect(theirs).toContain('take_printed_bonus_action');

    for (const name of ['take_printed_action', 'take_printed_bonus_action']) {
      const out = surface.call({ tool: name, input: {}, commandId: 'toolu_1' });
      expect(out.status).toBe('invalid');
      if (out.status !== 'invalid') continue;
      expect(out.code).toBe('unknown_tool');
    }
  });
});
