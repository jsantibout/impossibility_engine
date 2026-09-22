/**
 * The DM's door onto a thing you can attack and break.
 *
 * **The declaration is the creation**, and that is the whole design rather
 * than a convenience. An object exists because somebody described it and
 * somebody swung at it — never because it was registered before the scene
 * started. A world that had to declare its doors in advance is a world where
 * the interesting door is always the one nobody thought of, and a table that
 * hits it gets a refusal instead of a fight.
 *
 * So the tool takes what a DM says out loud — a name, what it is made of, how
 * big it is, whether it is flimsy — and every mechanical number comes back out
 * of the book. The one number the DM may state is a damage threshold, which
 * the SRD names and declines to print a table for, exactly as it declines to
 * print the DC of a locked door.
 *
 * It is on this surface and not the model's for the reason `award_items` is:
 * what is in the room is the DM's to say. A model that could declare an
 * adamantine wall between itself and the party would be writing the world
 * rather than playing in it.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  DM_ONLY_TOOL_NAMES,
  TOOL_NAMES,
  type ToolOutcome,
} from '@ie/tools';

function table(seed = 'the-oak-door') {
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

const DOOR = {
  id: 'oak-door',
  name: 'the barred oak door',
  material: 'wood',
  size: 'medium',
  build: 'resilient',
} as const;

describe('a DM puts a breakable thing in the room by describing it', () => {
  it('states the fiction and the engine states every number', () => {
    const t = table();
    expectOk(t.call('declare_object', DOOR));

    const door = t.campaign.state().creatures['oak-door']!;
    // SRD Object Armour Class: Wood is 15. Object Hit Points: a resilient
    // Medium object is 18. Neither number was in the call.
    expect(door.sheet.stated?.armorClass).toBe(15);
    expect(door.vitals.hpMax).toBe(18);
    expect(door.creatureType).toBe('Object');
    expect(door.vitals.diesAtZero).toBe(true);
    expect(door.name).toBe('the barred oak door');
  });

  it('is a tool a model may never call', () => {
    expect(DM_ONLY_TOOL_NAMES).toContain('declare_object');
    expect(TOOL_NAMES).not.toContain('declare_object');

    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'model' });
    const model = createSurface(campaign);
    const refused = model.call({ tool: 'declare_object', input: DOOR, commandId: 'toolu_1' });
    expect(refused.status).not.toBe('ok');
  });

  it('refuses a substance the book does not print, by name', () => {
    const t = table();
    const refused = t.call('declare_object', { ...DOOR, material: 'voidsteel' });
    expect(codeOf(refused)).toBe('unknown_material');
  });

  it('refuses a Huge object, because the book asks for sections', () => {
    const t = table();
    // SRD: "To track Hit Points for a Huge or Gargantuan object, divide it into
    // Large or smaller sections, and track each section's Hit Points
    // separately." The division is the DM's, and the engine will not invent it.
    expect(codeOf(t.call('declare_object', { ...DOOR, size: 'huge' }))).toBe('unknown_object_size');
  });

  it('takes a damage threshold, which is the one number a DM may state', () => {
    const t = table();
    expectOk(
      t.call('declare_object', {
        id: 'castle-wall',
        name: 'the curtain wall',
        material: 'stone',
        size: 'large',
        build: 'resilient',
        damageThreshold: 10,
      }),
    );
    expect(t.campaign.state().creatures['castle-wall']!.sheet.stated?.damageThreshold).toBe(10);

    // Nine is superficial and the wall does not notice it; eleven is the whole
    // instance. SRD "Damage Threshold", both halves.
    const glanced = expectOk(
      t.call('improvised_damage', { target: 'castle-wall', amount: 9, ruling: 'the ram' }),
    );
    expect(t.campaign.state().creatures['castle-wall']!.vitals.hp).toBe(27);
    // And the report says what landed rather than what was ruled, so nobody
    // narrates nine damage to a wall that did not feel it.
    expect((glanced as { resolution: { amount: number } }).resolution.amount).toBe(0);

    expectOk(t.call('improvised_damage', { target: 'castle-wall', amount: 11, ruling: 'the ram' }));
    expect(t.campaign.state().creatures['castle-wall']!.vitals.hp).toBe(16);
  });

  it('is a retry rather than a second door when the transport repeats itself', () => {
    const t = table();
    expectOk(t.call('declare_object', DOOR));
    const again = t.resend(0);
    expect(again.status).toBe('ok');
    expect(t.campaign.state().creatures['oak-door']!.vitals.hp).toBe(18);

    // A different command id for the same name is the refusal, not a silent
    // second thing under one word.
    expect(codeOf(t.call('declare_object', DOOR))).toBe('already_present');
  });
});

describe('a door does not wedge the fight it is standing next to', () => {
  /**
   * The interaction most likely to break something, and the one the design
   * exists to survive: `endCombat` closes a fight when nobody left standing is
   * opposed to anybody else, and it reads the **turn order**. An object is not
   * in the order, is on nobody's side, and must not turn "the goblin is down"
   * into `undeclared_side`.
   */
  it('lets `end_fight` close a fight it was never a combatant in', () => {
    const t = table('the-fight');
    expectOk(t.call('add_creature', { id: 'goblin', monsterId: 'goblin-warrior' }));
    expectOk(t.call('declare_side', { who: 'goblin', side: 'goblins' }));
    expectOk(t.call('declare_object', DOOR));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the hall', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'goblin', fromLandmark: 'the hall', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'oak-door', fromCreature: 'goblin', feet: 5 }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'goblin' }] }));

    // The door is on the roster, placed, at full hit points and on nobody's
    // side — and it is not in the order.
    const before = t.campaign.state();
    expect(before.combat!.order.some((c) => c.id === 'oak-door')).toBe(false);
    expect(before.creatures['oak-door']!.side).toBeNull();

    expectOk(t.call('improvised_damage', { target: 'goblin', amount: 40, ruling: 'the ambush' }));
    expectOk(t.call('end_combat', { ending: { kind: 'defeated' } }));

    const after = t.campaign.state();
    expect(after.combat).toBeNull();
    // And it is still there, unbroken, to be forced open afterwards.
    expect(after.creatures['oak-door']!.vitals.hp).toBe(18);
    expect(after.scene!.positions['oak-door']).toBeDefined();
  });
});
