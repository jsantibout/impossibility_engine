/**
 * Flying, swimming and jumping, through the door.
 *
 * The engine grew four Speeds beside walking and two jumps; this is the half
 * that makes them askable. A rule a caller cannot invoke is the same defect
 * `parity.test.ts` was written for — "a refusal naming a parameter the caller
 * has no way to send looks exactly like a rule saying no" — and a Cockatrice
 * whose block prints `Fly 40 ft.` is exactly the creature a model would try to
 * fly on its first turn.
 *
 * **This file imports no engine.** Every number below is one no call named:
 * the forty feet a Cockatrice may fly is read off the stat block the surface
 * added, the double charge on an unaided swim is the glossary's, and the
 * distance a Goblin can jump comes from a Strength nobody typed.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

function table(seed = 'modes') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { campaign, surface, call };
}

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 600)}`);
  }
  return outcome;
};

const expectRefused = (outcome: ToolOutcome) => {
  if (outcome.status !== 'refused') {
    throw new Error(
      `expected refused, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 600)}`,
    );
  }
  return outcome;
};

/** East is +x, which is bearing 90. */
const EAST = 90;

/** One creature out of the bestiary, placed, with the turn. */
function summon(t: ReturnType<typeof table>, id: string, monsterId: string) {
  expectOk(t.call('set_scene', { width: 400, depth: 400, height: 200 }));
  expectOk(t.call('add_landmark', { name: 'the ford', at: { x: 100, y: 100 } }));
  expectOk(t.call('add_creature', { id, monsterId }));
  expectOk(t.call('place_creature', { who: id, fromLandmark: 'the ford', feet: 0 }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: id }] }));
}

describe('a move may say which Speed it used', () => {
  it('flies a Cockatrice the forty feet its block prints', () => {
    const t = table();
    summon(t, 'cockatrice', 'cockatrice');

    const flown = expectOk(
      t.call('move', {
        who: 'cockatrice',
        fromLandmark: 'the ford',
        feet: 40,
        bearing: EAST,
        mode: 'fly',
      }),
    );
    expect(flown.resolution['feetMoved']).toBe(40);
    expect(flown.resolution['movementCost']).toBe(40);
  });

  it('refuses to fly a Goblin, which has no Fly Speed to fly with', () => {
    const t = table();
    summon(t, 'grish', 'goblin-warrior');

    const refused = expectRefused(
      t.call('move', {
        who: 'grish',
        fromLandmark: 'the ford',
        feet: 10,
        bearing: EAST,
        mode: 'fly',
      }),
    );
    expect(refused.code).toBe('no_such_speed');
  });

  it('charges a Goblin double for a swim, which is the glossary’s rate', () => {
    const t = table();
    summon(t, 'grish', 'goblin-warrior');

    const swum = expectOk(
      t.call('move', {
        who: 'grish',
        fromLandmark: 'the ford',
        feet: 10,
        bearing: EAST,
        mode: 'swim',
      }),
    );
    expect(swum.resolution['feetMoved']).toBe(10);
    expect(swum.resolution['movementCost']).toBe(20);
  });
});

describe('a move may say it was a jump', () => {
  it('refuses a Goblin a jump longer than its Strength', () => {
    const t = table();
    summon(t, 'grish', 'goblin-warrior');

    // Strength 8, standing: four feet, and the lattice's smallest step is
    // five. Nobody typed either number.
    const refused = expectRefused(
      t.call('move', {
        who: 'grish',
        fromLandmark: 'the ford',
        feet: 5,
        bearing: EAST,
        jump: { kind: 'long' },
      }),
    );
    expect(refused.code).toBe('jump_too_far');
    expect(refused.reason).toContain('Long Jump');
  });

  it('takes a running jump once the run has been made', () => {
    const t = table();
    summon(t, 'grish', 'goblin-warrior');

    expectOk(t.call('move', { who: 'grish', fromLandmark: 'the ford', feet: 10, bearing: EAST }));
    const jumped = expectOk(
      t.call('move', {
        who: 'grish',
        fromCreature: 'grish',
        feet: 5,
        bearing: EAST,
        jump: { kind: 'long', running: true },
      }),
    );
    expect(jumped.resolution['movementCost']).toBe(5);
  });
});
