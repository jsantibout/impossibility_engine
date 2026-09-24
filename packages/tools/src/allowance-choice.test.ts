/**
 * Which allowance pays, and what one spend buys — through the door.
 *
 * Two SRD sentences make the question real and neither is exotic.
 *
 * > Adrenaline Rush: "You can take the Dash action as a Bonus Action. When you
 * > do so, you gain a number of Temporary Hit Points equal to your Proficiency
 * > Bonus. You can use this trait a number of times equal to your Proficiency
 * > Bonus."
 * > Cunning Action: "you can take one of the following actions as a Bonus
 * > Action: Dash, Disengage, or Hide." — free, and unlimited.
 *
 * An Orc Rogue holds both. Underneath, `allowsPrice` took whichever rule the
 * sheet happened to compile first and the command charged it, so this Rogue
 * spent the Orc's uses on every Dash and was then refused, `exhausted`, an
 * action the Rogue's own feature gives away. Above it there was no field to
 * say which was meant. The default is the free one — the only answer that can
 * never take something away — and `using_feature` is how the Orc asks for the
 * Temporary Hit Points on purpose.
 *
 * `also_taking` is the other half of the same question, asked from the other
 * end: SRD Patient Defense buys **two** actions with one Bonus Action and one
 * Focus Point, so naming the second is what tells the priced pair from the
 * free single sentence beside it. The second action is then taken by its own
 * call, naming what bought it, and costs nothing more.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const common = {
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
  cantrips: [],
  preparedSpells: [],
};

const initiate = {
  featId: 'magic-initiate',
  spellList: 'wizard',
  spellcastingAbility: 'int',
  cantrips: ['mage-hand', 'light'],
  levelOneSpell: 'find-familiar',
};

/** An Orc Rogue 5: Cunning Action's Dash and Adrenaline Rush's, on one sheet. */
const orcRogue = (name: string): Record<string, unknown> => ({
  ...common,
  name,
  classId: 'rogue',
  level: 5,
  speciesId: 'orc',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  subclassId: 'thief',
  featureChoices: { 'rogue:expertise': ['stealth', 'sleight-of-hand'] },
  feats: {
    'sage:magic-initiate-wizard': initiate,
    'rogue:ability-score-improvement': { featId: 'savage-attacker' },
  },
});

/** A Monk 5, who holds Patient Defense's free sentence and its priced pair. */
const monk = (name: string): Record<string, unknown> => ({
  ...common,
  name,
  classId: 'monk',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['acrobatics', 'stealth'],
  subclassId: 'warrior-of-the-open-hand',
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': initiate,
    'human:versatile': { featId: 'alert' },
    'monk:ability-score-improvement': { featId: 'savage-attacker' },
  },
});

/** Somebody to be in a fight with, from a class whose table prints none of this. */
const fighter = (name: string): Record<string, unknown> => ({
  ...common,
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'dwarf',
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, dex: 1 },
  classSkills: ['athletics', 'perception'],
  featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
  feats: { 'criminal:alert': { featId: 'alert' }, 'fighter:fighting-style': { featId: 'defense' } },
});

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, surface, call };
}

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

const expectRefused = (outcome: ToolOutcome) => {
  if (outcome.status !== 'refused') {
    throw new Error(
      `expected refused, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

/** Two creatures in a fight, on the first one's turn. */
function fight(seed: string, who: string, choices: Record<string, unknown>) {
  const t = table(seed);
  expectOk(t.call('create_character', { id: who, choices }));
  expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
  expectOk(t.call('roll_initiative', { combatants: [{ who }, { who: 'bram' }] }));
  for (let step = 0; step < 2 && t.surface.observe().turnOf !== who; step += 1) {
    expectOk(t.call('end_turn'));
  }
  expect(t.surface.observe().turnOf).toBe(who);
  return t;
}

const budget = (t: ReturnType<typeof table>, id: string) =>
  t.surface.observe().creatures.find((one) => one.id === id)!.budget!;

const pool = (t: ReturnType<typeof table>, id: string, key: string) =>
  t.campaign.state().creatures[id]!.resources.pools[key]!;

describe('a creature holding a free allowance and a priced one for the same pair', () => {
  it('takes the free one when nobody says which', () => {
    const t = fight('two-allowances-default', 'krusk', orcRogue('Krusk'));
    expectOk(t.call('take_action', { who: 'krusk', kind: 'dash', from: 'bonus-action' }));
    expect(pool(t, 'krusk', 'orc:adrenaline-rush').spent).toBe(0);
    expect(t.campaign.state().creatures['krusk']!.vitals.temporaryHp ?? 0).toBe(0);
    expect(budget(t, 'krusk').bonusAction).toBe(false);
  });

  it('takes the priced one when the Orc names it, and says so in the resolution', () => {
    const t = fight('two-allowances-named', 'krusk', orcRogue('Krusk'));
    const took = expectOk(
      t.call('take_action', {
        who: 'krusk',
        kind: 'dash',
        from: 'bonus-action',
        using_feature: 'orc:adrenaline-rush',
      }),
    );
    expect(took.resolution['paidBy']).toBe('orc:adrenaline-rush');
    expect(pool(t, 'krusk', 'orc:adrenaline-rush').spent).toBe(1);
    expect(t.campaign.state().creatures['krusk']!.vitals.temporaryHp ?? 0).toBeGreaterThan(0);
  });

  it('refuses an allowance this creature does not hold', () => {
    const t = fight('two-allowances-absent', 'krusk', orcRogue('Krusk'));
    const out = expectRefused(
      t.call('take_action', {
        who: 'krusk',
        kind: 'dash',
        from: 'bonus-action',
        using_feature: 'monk:focus',
      }),
    );
    expect(out.code).toBe('no_such_allowance');
    expect(budget(t, 'krusk').bonusAction).toBe(true);
  });

  /**
   * A pair is a fact about a *spend*, so it is refused with no slot named to
   * spend out of — `placementSchema`'s rule rather than a rules judgement.
   */
  it('refuses a pair with no slot named to buy it out of', () => {
    const t = fight('two-allowances-pairless', 'krusk', orcRogue('Krusk'));
    const out = t.call('take_action', { who: 'krusk', kind: 'dash', also_taking: ['disengage'] });
    expect(out.status).toBe('invalid');
    if (out.status !== 'invalid') return;
    expect(out.issues.map((issue) => issue.path)).toContain('also_taking');
  });
});

describe('a pair bought with one spend, taken as two calls', () => {
  it('spends the Focus Point once and leaves the Action alone', () => {
    const t = fight('patient-defense', 'shan', monk('Shan'));
    const out = expectOk(
      t.call('take_action', {
        who: 'shan',
        kind: 'disengage',
        from: 'bonus-action',
        also_taking: ['dodge'],
      }),
    );
    expect(out.resolution['alsoBought']).toEqual(['dodge']);
    expect(pool(t, 'shan', 'focus-points').spent).toBe(1);
    expect(budget(t, 'shan').bonusAction).toBe(false);
    expect(budget(t, 'shan').action).toBe(true);

    expectOk(t.call('take_action', { who: 'shan', kind: 'dodge', using_feature: 'monk:focus' }));
    // Still one point, and the turn's own Action never went.
    expect(pool(t, 'shan', 'focus-points').spent).toBe(1);
    expect(budget(t, 'shan').action).toBe(true);
  });

  /** The free sentence beside it, which nobody has to pay for. */
  it('Disengages for nothing when the pair is not asked for', () => {
    const t = fight('patient-defense-free', 'shan', monk('Shan'));
    expectOk(t.call('take_action', { who: 'shan', kind: 'disengage', from: 'bonus-action' }));
    expect(pool(t, 'shan', 'focus-points').spent).toBe(0);
  });

  it('refuses the second half to a Monk who never bought it', () => {
    const t = fight('patient-defense-unbought', 'shan', monk('Shan'));
    const out = expectRefused(
      t.call('take_action', { who: 'shan', kind: 'dodge', using_feature: 'monk:focus' }),
    );
    expect(out.code).toBe('no_such_grant');
    expect(budget(t, 'shan').action).toBe(true);
  });
});
