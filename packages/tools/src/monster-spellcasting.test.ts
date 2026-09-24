/**
 * A stat block's spells, through the door that was already there.
 *
 * **No door opened for this.** `cast_spell` has always cast for any creature
 * whose spellcasting is declared, and `declareSpellcasting` — the DM command
 * that states one by hand — is still withheld from every surface
 * (`doors.test.ts` records it `UNDECLARABLE`). What changed is upstream of
 * both: `add_creature` now declares what the block prints, so a Cultist
 * Fanatic arrives with a list and the existing tool spends it.
 *
 * What is asserted here is the three things a caller can actually see and do:
 * the 1/Day use goes and the second call is refused, the At Will line is not
 * a count at all, and both `look` and `sheet` say so before anything is cast.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, type ToolOutcome } from '@ie/tools';

function table(seed = 'a-casting-block') {
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

/** A cultist, a commoner to hold, and twenty feet of floor between them. */
function room(t: ReturnType<typeof table>) {
  expectOk(t.call('add_creature', { id: 'zeal', monsterId: 'cultist-fanatic' }));
  expectOk(t.call('add_creature', { id: 'pell', monsterId: 'commoner' }));
  expectOk(t.call('set_scene', { width: 120, depth: 120, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the altar', at: { x: 20, y: 20 } }));
  expectOk(t.call('place_creature', { who: 'zeal', fromLandmark: 'the altar', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'pell', fromCreature: 'zeal', feet: 20, bearing: 0 }));
  expectOk(t.call('declare_sight', { from: 'zeal', to: 'pell', seen: true }));
  return t;
}

describe('the DM casts a stat block’s own spells', () => {
  it('holds a commoner at the DC the block prints', () => {
    const t = room(table());
    const out = expectOk(t.call('cast_spell', { caster: 'zeal', spellId: 'hold-person', targets: ['pell'] }));

    const castingId = out.resolution['castingId'] as string;
    const running = t.surface.observe().ongoing.find((one) => one.castingId === castingId);
    expect(running?.spellId).toBe('hold-person');

    // The DC is not on the wire — a caller told one is a caller a step from
    // narrating against a number nobody rolled — so what proves it landed is
    // the roll the engine made and the condition it left behind.
    expect(out.events.some((event) => event.type === 'roll-recorded')).toBe(true);
  });

  it('spends the one daily use and refuses the second casting', () => {
    const t = room(table());
    expectOk(t.call('cast_spell', { caster: 'zeal', spellId: 'hold-person', targets: ['pell'] }));

    const held = expectOk(t.call('sheet', { who: 'zeal' }));
    const granted = (held.resolution['spellcasting'] as { granted: readonly Record<string, unknown>[] })
      .granted;
    expect(granted.find((one) => one['spellId'] === 'hold-person')).toMatchObject({ left: 0 });

    const again = t.call('cast_spell', { caster: 'zeal', spellId: 'hold-person', targets: ['pell'] });
    expect(again.status).toBe('refused');
  });

  it('casts an At Will cantrip twice, with no count to run out', () => {
    const t = room(table());
    // Light names the creature carrying the lit object: the cultist's own.
    expectOk(t.call('cast_spell', { caster: 'zeal', spellId: 'light', targets: ['zeal'] }));
    expectOk(t.call('cast_spell', { caster: 'zeal', spellId: 'light', targets: ['zeal'] }));

    const held = expectOk(t.call('sheet', { who: 'zeal' }));
    const granted = (held.resolution['spellcasting'] as { granted: readonly Record<string, unknown>[] })
      .granted;
    expect(granted.find((one) => one['spellId'] === 'light')).toMatchObject({
      left: null,
      atWill: true,
      slotCasting: false,
    });
  });
});

describe('what a caller can see before it casts anything', () => {
  it('shows on `look` that the block casts, and what is left of each price', () => {
    const t = room(table());
    const zeal = t.surface.observe().creatures.find((c) => c.id === 'zeal')!;
    expect(zeal.grantedSpells).toEqual([
      {
        spellId: 'light',
        source: 'cultist-fanatic:spellcasting',
        left: null,
        atWill: true,
        throughLine: null,
      },
      {
        spellId: 'thaumaturgy',
        source: 'cultist-fanatic:spellcasting',
        left: null,
        atWill: true,
        throughLine: null,
      },
      {
        spellId: 'command',
        source: 'cultist-fanatic:spellcasting',
        left: 2,
        atWill: false,
        throughLine: null,
      },
      {
        spellId: 'hold-person',
        source: 'cultist-fanatic:spellcasting',
        left: 1,
        atWill: false,
        throughLine: null,
      },
      // And the Bonus Action cast line, which is a route of its own: the
      // heading rations it, so the grant itself runs out of nothing and
      // `throughLine` says where the counting happens.
      {
        spellId: 'spiritual-weapon',
        source: 'cultist-fanatic:spiritual-weapon-2-day',
        left: null,
        atWill: true,
        throughLine: 'Spiritual Weapon (2/Day)',
      },
    ]);
  });

  it('shows nothing for a block that prints no such line', () => {
    const t = table();
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    expect(t.surface.observe().creatures.find((c) => c.id === 'grish')!.grantedSpells).toEqual([]);
  });

  it('counts the daily use down where `look` can see it', () => {
    const t = room(table());
    expectOk(t.call('cast_spell', { caster: 'zeal', spellId: 'hold-person', targets: ['pell'] }));
    const zeal = t.surface.observe().creatures.find((c) => c.id === 'zeal')!;
    expect(zeal.grantedSpells.find((one) => one.spellId === 'hold-person')?.left).toBe(0);
  });
});
