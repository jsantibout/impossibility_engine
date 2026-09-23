/**
 * SRD Undead Fortitude at the door, and the one clause a door cannot answer.
 *
 * `roll_improvised_damage` names a kind, so the engine can see whether the
 * falling brazier was Radiant and applies the whole sentence. `improvised_damage`
 * names a number and no kind at all — which is why no Resistance meets it
 * either — so the save is thrown with "unless the damage is Radiant" applied
 * blind, and the line saying so comes back in `unverified`. Refusing the save
 * on that ground would be inventing the exception rather than applying it;
 * skipping it silently would be worse than either.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, type ToolOutcome } from '@ie/tools';

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

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 700)}`);
  }
  return outcome;
};

/** A zombie on 5 of its 15 Hit Points, so one more blow of 5 takes it to none. */
function softened(seed: string) {
  const t = table(seed);
  expectOk(t.call('add_creature', { id: 'shambler', monsterId: 'zombie' }));
  expectOk(
    t.call('improvised_damage', {
      target: 'shambler',
      amount: 10,
      ruling: 'the ceiling came down',
    }),
  );
  return t;
}

const hpOf = (t: ReturnType<typeof table>): number =>
  t.surface.observe().creatures.find((c) => c.id === 'shambler')!.hp;

describe('a zombie taken to 0 by something nobody statted', () => {
  it('still makes the save, and says which half of the sentence went unchecked', () => {
    const t = softened('door-fortitude');
    const out = expectOk(
      t.call('improvised_damage', { target: 'shambler', amount: 5, ruling: 'a falling beam' }),
    );

    expect(out.events.some((event) => event.type === 'roll-recorded')).toBe(true);
    expect(out.unverified.join(' ')).toContain('Undead Fortitude');
    expect(out.unverified.join(' ')).toContain('Radiant');
    // One of the two, whichever the seed threw — what is asserted is that the
    // rule ran, not which way a die fell.
    expect([0, 1]).toContain(hpOf(t));
  });

  /**
   * The other door names a kind, so the sentence is applied whole and there
   * is nothing left over to hand to the table.
   */
  it('hands over nothing where the damage has a kind the engine can read', () => {
    const t = softened('door-radiant');
    const out = expectOk(
      t.call('roll_improvised_damage', {
        target: 'shambler',
        dice: '1d4',
        damageType: 'radiant',
        ruling: 'sunlight through the roof',
      }),
    );
    expect(out.unverified).toEqual([]);
  });
});
