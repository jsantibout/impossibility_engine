/**
 * The DM's doors onto M-RISE: a printed line that restores a creature
 * (`heal_printed_line`, SRD Otherworldly Steed's Healing Touch) and one that
 * raises a creature from a corpse (`raise_printed_line`, SRD Wraith's Create
 * Specter).
 *
 * Neither states a number. The dice, the reach, the corpse's age and the count
 * under control are the engine's; what the doors carry is what the book leaves
 * open — which creature is restored, which corpse, and what the risen creature
 * is called.
 *
 * It imports the engine for one thing, `extendContent`, to put a homebrew
 * block beside the book the way a DM's homebrew arrives.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { extendContent } from '@ie/engine';
import { createCampaign, createDmSurface, createSurface, type ToolOutcome } from '@ie/tools';

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`);
  }
  return outcome;
};

/**
 * A homebrew healer whose Bonus Action is the Healing Touch template with a
 * printed number where the steed's is the casting's — so the door can be
 * driven without a Paladin casting Find Steed. The steed's own line is the
 * engine's `steed-lines.test.ts`.
 */
type Monster = NonNullable<ReturnType<typeof SRD_CONTENT.monsterById>>;

const SPRITE: Monster = {
  ...SRD_CONTENT.monsterById('otherworldly-steed')!,
  id: 'mending-sprite',
  name: 'Mending Sprite',
  size: 'tiny',
  type: 'Fey',
  traits: [],
  actions: [],
  bonusActions: [
    {
      name: 'Mending Touch (Recharge after a Short or Long Rest)',
      text: 'One creature within 5 feet of the sprite regains a number of Hit Points equal to 2d8 plus 2.',
      heals: { dice: '2d8', flat: 2, within: 5 },
      recharge: { kind: 'rest' },
    },
  ],
};

function table(seed: string) {
  const content = extendContent(SRD_CONTENT, { monsters: [SPRITE] });
  if (!content.ok) throw new Error(content.reason);
  const campaign = createCampaign({ content: content.value, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { campaign, surface, call };
}

describe('heal_printed_line', () => {
  it('rolls the line’s dice for a creature within its reach, and asks for one first', () => {
    const t = table('mending');
    expectOk(t.call('add_creature', { id: 'sprite', monsterId: 'mending-sprite' }));
    expectOk(t.call('add_creature', { id: 'goblin', monsterId: 'goblin-warrior' }));
    expectOk(t.call('set_scene', { width: 100, depth: 100, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the glade', at: { x: 50, y: 50 } }));
    expectOk(t.call('place_creature', { who: 'sprite', fromLandmark: 'the glade', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'goblin', fromCreature: 'sprite', feet: 5, bearing: 90 }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'sprite' }] }));
    expectOk(t.call('improvised_damage', { target: 'goblin', amount: 6, ruling: 'an earlier fight' }));

    const sprite = t.surface.observe().creatures.find((one) => one.id === 'sprite');
    expect(sprite?.printed?.bonusActions[0]?.engineHeals).toBe(true);

    const line = 'Mending Touch (Recharge after a Short or Long Rest)';
    const asked = t.call('heal_printed_line', { who: 'sprite', line });
    expect(asked.status).toBe('needs-context');

    const before = t.campaign.state().creatures['goblin']!.vitals.hp;
    const out = expectOk(t.call('heal_printed_line', { who: 'sprite', line, target: 'goblin' }));
    expect(out.resolution['healed']).toBe(t.campaign.state().creatures['goblin']!.vitals.hp - before);
    expect(out.resolution['expended']).toBe(true);
  });

  it('is the DM’s door and not the model’s', () => {
    const player = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'mending' }));
    expect(player.tools.map((one) => one.name)).not.toContain('heal_printed_line');
    expect(player.tools.map((one) => one.name)).not.toContain('raise_printed_line');
  });
});

describe('raise_printed_line', () => {
  it('raises a Specter from a fresh Humanoid corpse under the wraith’s control', () => {
    const t = table('crypt');
    expectOk(t.call('add_creature', { id: 'wraith', monsterId: 'wraith' }));
    expectOk(t.call('add_creature', { id: 'bandit', monsterId: 'bandit' }));
    expectOk(t.call('declare_side', { who: 'wraith', side: 'dead' }));
    expectOk(t.call('set_scene', { width: 100, depth: 100, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the crypt', at: { x: 50, y: 50 } }));
    expectOk(t.call('place_creature', { who: 'wraith', fromLandmark: 'the crypt', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'bandit', fromCreature: 'wraith', feet: 5, bearing: 0 }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'wraith' }] }));
    expectOk(t.call('improvised_damage', { target: 'bandit', amount: 100, ruling: 'the wraith’s touch' }));

    const wraith = t.surface.observe().creatures.find((one) => one.id === 'wraith');
    expect(wraith?.printed?.actions.find((one) => one.name === 'Create Specter')?.engineRaises).toBe(true);

    const asked = t.call('raise_printed_line', { who: 'wraith', line: 'Create Specter', corpse: 'bandit' });
    expect(asked.status).toBe('needs-context');

    const out = expectOk(
      t.call('raise_printed_line', { who: 'wraith', line: 'Create Specter', corpse: 'bandit', into: 'specter' }),
    );
    expect(out.resolution['risen']).toBe('specter');
    const specter = t.campaign.state().creatures['specter'];
    expect(specter?.name).toBe('Specter');
    expect(specter?.summonedBy?.by).toBe('wraith');
    expect(specter?.side).toBe('dead');
  });
});
