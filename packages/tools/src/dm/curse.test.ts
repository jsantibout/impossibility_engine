/**
 * **A lycanthrope's curse, as `look` shows it** — W7-B13.
 *
 * SRD Werewolf's Bite: "If the target is a Humanoid, it is subjected to the
 * following effect. _Constitution Saving Throw:_ DC 12. _Failure:_ The target
 * is cursed. If the cursed target drops to 0 Hit Points, it instead becomes a
 * **Werewolf** under the GM's control and has 10 Hit Points."
 *
 * The engine rolls the save and keeps the curse on the record; what the curse
 * does at 0 Hit Points is a character handed to the DM, which comes back
 * marked `[the DM decides]` when the save fails. The record is only useful if
 * the table can read it back when that moment comes, so `look` carries it:
 * `cursedBy`, by whose line.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, type ToolOutcome } from '@ie/tools';

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 600)}`);
  }
  return outcome;
};

const BITE = 'Bite (Wolf or Hybrid Form Only)';

/** A werewolf in its wolf shape beside a tough, on the werewolf's turn. */
function theBite(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const dm = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return dm.call({ tool, input, commandId: `toolu_${calls}` });
  };
  expectOk(call('add_creature', { id: 'lupa', monsterId: 'werewolf' }));
  expectOk(call('add_creature', { id: 'dunn', monsterId: 'tough' }));
  expectOk(call('declare_side', { who: 'lupa', side: 'wolves' }));
  expectOk(call('declare_side', { who: 'dunn', side: 'village' }));
  expectOk(call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(call('add_landmark', { name: 'the well', at: { x: 20, y: 20 } }));
  expectOk(call('place_creature', { who: 'lupa', fromLandmark: 'the well', feet: 0 }));
  expectOk(call('place_creature', { who: 'dunn', fromCreature: 'lupa', feet: 5, bearing: 90 }));
  expectOk(call('roll_initiative', { combatants: [{ who: 'lupa' }, { who: 'dunn' }] }));
  for (let guard = 0; guard < 4 && dm.observe().turnOf !== 'lupa'; guard += 1) {
    expectOk(call('end_turn', {}));
  }
  const shift = SRD_CONTENT.monsterById('werewolf')!.bonusActions.find(
    (line) => line.forms !== undefined,
  )!.name;
  expectOk(call('shape_shift_printed_line', { who: 'lupa', line: shift, form: 'wolf' }));
  const bite = call('attack', { attacker: 'lupa', target: 'dunn', action: BITE });
  return { dm, bite };
}

describe('a curse on the record, read back through look', () => {
  it('shows who cursed a creature, and hands the transformation over marked', () => {
    let found = false;
    for (const seed of 'abcdefghijklmnopqrstuvwxyz'.split('')) {
      const { dm, bite } = theBite(`curse-${seed}`);
      if (bite.status !== 'ok') continue;
      const dunn = dm.observe().creatures.find((one) => one.id === 'dunn')!;
      if (dunn.cursedBy.length === 0) continue;
      expect(dunn.cursedBy).toEqual([{ by: 'lupa', line: BITE }]);
      expect(bite.unverified.join(' ')).toContain(
        "[the DM decides] If the cursed target drops to 0 Hit Points, it instead becomes a **Werewolf**",
      );
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('shows nobody cursed who has not been bitten', () => {
    const { dm } = theBite('curse-quiet');
    const lupa = dm.observe().creatures.find((one) => one.id === 'lupa')!;
    expect(lupa.cursedBy).toEqual([]);
  });
});
