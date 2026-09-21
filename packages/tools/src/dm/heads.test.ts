/**
 * The DM's door onto a number, and the Bites the engine derives from it.
 *
 * SRD Hydra's Multiattack — "The hydra makes as many Bite attacks as it has
 * heads" — is a count that reads off a fact no engine holds: the Multiple
 * Heads trait takes a head off at 25 damage *in a turn* and grows two back at
 * the end of it, and none of that is state. The owner's ruling drew the line
 * where the authority is rather than where the numbers are: **a number the
 * engine produces is a fabrication, a number the table states is a fact.**
 *
 * So this is the first door on either surface that takes a number, and it is
 * the DM's alone. A model that could say "the hydra has twelve heads" would be
 * writing itself twelve attacks; a DM saying "three left" is reporting the
 * creature in front of them. What neither of them states is how many *Bites*
 * that is — one affordance, and the arithmetic stays the engine's, which is
 * what makes the door safe to open at all.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  DM_ONLY_TOOL_NAMES,
  DM_TOOL_NAMES,
  TOOL_NAMES,
  type ToolOutcome,
} from '@ie/tools';

function table(seed = 'the-hydra') {
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

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 600)}`);
  }
  return outcome;
};

const codeOf = (outcome: ToolOutcome): string =>
  'code' in outcome && typeof outcome.code === 'string' ? outcome.code : outcome.status;

/** A hydra in the shallows with something large to bite, and its turn to do it. */
function shallows(t: ReturnType<typeof table>) {
  expectOk(t.call('add_creature', { id: 'hydra', monsterId: 'hydra' }));
  expectOk(t.call('add_creature', { id: 'brute', monsterId: 'ogre' }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the reeds', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'hydra', fromLandmark: 'the reeds', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'brute', fromCreature: 'hydra', feet: 20, bearing: 0 }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'hydra' }, { who: 'brute' }] }));
  // Initiative is the engine's die, so who goes first is the seed's business.
  // The fight walks to the hydra's turn rather than the fixture assuming it.
  let guard = 0;
  while (t.surface.observe().turnOf !== 'hydra') {
    expectOk(t.call('end_turn'));
    guard += 1;
    if (guard > 4) throw new Error('the hydra never got a turn');
  }
  return t;
}

/** One Bite at the ogre. Whether it lands is the die's; that it was *made* is the claim. */
const bite = (t: ReturnType<typeof table>): ToolOutcome =>
  t.call('attack', { attacker: 'hydra', target: 'brute', action: 'Bite' });

const headsOf = (t: ReturnType<typeof table>): number | null =>
  t.campaign.state().creatures.hydra!.heads;

describe('a DM says how many heads are still on it', () => {
  /**
   * The whole door in one test: the DM states the count, the engine states the
   * Bites. Five heads, five Bites, and the sixth is a swing the Attack action
   * does not hold — which is the engine refusing, off a number it derived.
   */
  it('holds as many Bites in the Attack action as the DM declared heads', () => {
    const t = shallows(table());
    expectOk(t.call('declare_heads', { who: 'hydra', heads: 5 }));

    for (const nth of [1, 2, 3, 4, 5]) {
      const swing = bite(t);
      if (swing.status !== 'ok') throw new Error(`bite ${nth}: ${JSON.stringify(swing).slice(0, 400)}`);
    }
    expect(codeOf(bite(t))).toBe('no_attacks_left');
  });

  /** And the count is on the creature, where a reload finds it. */
  it('writes the count onto the creature', () => {
    const t = shallows(table());
    expect(headsOf(t)).toBeNull();
    expectOk(t.call('declare_heads', { who: 'hydra', heads: 5 }));
    expect(headsOf(t)).toBe(5);
  });

  /**
   * SRD's Multiple Heads: a head dies at 25 damage in a turn and two grow back
   * at the end of it. So the DM re-states the count whenever it changes and
   * the newest answer is the one the Attack action follows — a declaration
   * replaces, it does not accumulate.
   */
  it('replaces the count when the DM says it again', () => {
    const t = shallows(table());
    expectOk(t.call('declare_heads', { who: 'hydra', heads: 5 }));
    expectOk(t.call('declare_heads', { who: 'hydra', heads: 2 }));
    expect(headsOf(t)).toBe(2);

    expectOk(bite(t));
    expectOk(bite(t));
    expect(codeOf(bite(t))).toBe('no_attacks_left');
  });

  /**
   * **One affordance, not arithmetic done twice.** The DM says how many heads
   * are active and nothing else; there is no field for how many attacks that
   * buys, and a caller that tried to state one is refused rather than quietly
   * ignored — Zod strips unknown keys in silence, so the strict object is the
   * whole of that guarantee and this is what proves it strict.
   */
  it('takes a count of heads and no count of attacks', () => {
    const t = shallows(table());
    const out = t.call('declare_heads', { who: 'hydra', heads: 3, attacks: 3 });

    expect(out.status).toBe('invalid');
    expect(headsOf(t)).toBeNull();
  });

  /** A creature whose last head is gone is dead, which is a different sentence. */
  it('refuses a count below one', () => {
    const t = shallows(table());
    expect(t.call('declare_heads', { who: 'hydra', heads: 0 }).status).toBe('invalid');
    expect(codeOf(t.call('declare_heads', { who: 'nobody', heads: 3 }))).toBe('unknown_creature');
  });

  /** And a transport that re-sends a call re-sends the declaration, not a second one. */
  it('declares once when the same call arrives twice', () => {
    const t = shallows(table());
    const request = {
      tool: 'declare_heads',
      input: { who: 'hydra', heads: 4 },
      commandId: 'toolu_the_heads',
    };
    expectOk(t.surface.call(request));
    expectOk(t.surface.call(request));

    expect(headsOf(t)).toBe(4);
    // Four Bites and no more: the retry did not size the action twice.
    for (const nth of [1, 2, 3, 4]) {
      const swing = bite(t);
      if (swing.status !== 'ok') throw new Error(`bite ${nth}: ${JSON.stringify(swing).slice(0, 400)}`);
    }
    expect(codeOf(bite(t))).toBe('no_attacks_left');
  });
});

describe('and a model may not say it', () => {
  /**
   * The wall, named rather than only swept. `boundary.test.ts` beside this
   * file proves no file under `dm/` is reachable from the model's surface at
   * all; this says the same thing about this door in particular, in the two
   * forms that would have to fail for a model to reach it: the name is not on
   * the model's list, and the model's dispatch table does not answer it.
   */
  it('is on the DM’s surface and not the model’s', () => {
    expect(DM_ONLY_TOOL_NAMES).toContain('declare_heads');
    expect(DM_TOOL_NAMES).toContain('declare_heads');
    expect(TOOL_NAMES).not.toContain('declare_heads');
  });

  it('answers a model that calls it as an unknown tool', () => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'the-hydra' });
    const model = createSurface(campaign);
    const out = model.call({
      tool: 'declare_heads',
      input: { who: 'hydra', heads: 12 },
      commandId: 'toolu_1',
    });

    expect(out.status).toBe('invalid');
    expect(codeOf(out)).toBe('unknown_tool');
    // And the model's own list holds no tool by that name to find another way.
    expect(model.tools.map((definition) => definition.name)).not.toContain('declare_heads');
  });
});
