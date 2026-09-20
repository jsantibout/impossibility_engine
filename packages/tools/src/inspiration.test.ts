/**
 * A die handed to somebody else — the conferred Reaction, both halves through
 * `surface.call`.
 *
 * SRD Bardic Inspiration: "As a Bonus Action, you can inspire another creature
 * within 60 feet of yourself who can see or hear you. That creature gains one
 * of your Bardic Inspiration dice ... Once within the next hour when the
 * creature fails a D20 Test, the creature can roll the die and add the number
 * rolled to the d20." The engine has spent the use, hung the Reaction on the
 * recipient with an hour's deadline and let them spend it since `conferReaction`
 * landed; nothing above it could ask, so the pool was one of the two
 * `definitions.ts` deliberately left shut — "a pool a caller can spend for no
 * effect is worse than one it cannot spend" — and the reason had stopped being
 * true.
 *
 * **The reason it had stopped being true is the second half of this file.**
 * What a use buys is executed: the die is real, and the recipient takes it
 * through `take_test_reaction`, which has existed since the reaction windows
 * were opened. So the test drives the whole sentence — the Bard spends a use,
 * the ally holds a die, the ally fails a check and the die turns the number
 * round — and `sheet` reports both ends of it, because a caller that cannot
 * see a die it was given cannot spend one.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  type ToolOutcome,
} from '@ie/tools';

/** A Bard with a Charisma worth three dice, and nothing this file is not about. */
const bard = (name: string): Record<string, unknown> => ({
  name,
  classId: 'bard',
  level: 1,
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 12, int: 10, wis: 13, cha: 15 },
  },
  // Acolyte offers Intelligence, Wisdom and Charisma.
  abilityIncreases: { cha: 2, wis: 1 },
  classSkills: ['performance', 'persuasion', 'deception'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral',
  cantrips: ['vicious-mockery', 'dancing-lights'],
  spellbook: [],
  preparedSpells: ['healing-word', 'charm-person', 'cure-wounds', 'faerie-fire'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['acrobatics'] },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

/** The ally who gets the die. A Fighter, because the die is nobody's class. */
const fighter = (name: string): Record<string, unknown> => ({
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
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
  feats: { 'criminal:alert': { featId: 'alert' }, 'fighter:fighting-style': { featId: 'defense' } },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;

  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

  /** The DM's door, for the one thing that opens a D20 Test: a Difficulty Class. */
  const rule = (tool: string, input: unknown = {}): ToolOutcome =>
    dm.call({ tool, input, commandId: `dm_${(calls += 1)}` });

  return { campaign, surface, call, rule };
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

interface Pool {
  readonly key: string;
  readonly left: number;
  readonly max: number;
}

interface HeldFeatureLine {
  readonly feature: string;
  readonly kind: string;
  readonly spentBy: string | null;
  readonly action: string | null;
  readonly left: number | null;
}

interface GrantedLine {
  readonly feature: string;
  readonly name: string;
  readonly from: string;
  readonly window: string;
  readonly takenBy: string;
  readonly costsReaction: boolean;
}

const sheetOf = (t: ReturnType<typeof table>, who: string) =>
  expectOk(t.call('sheet', { who })).resolution;

const poolLeft = (t: ReturnType<typeof table>, who: string, key: string): number =>
  (sheetOf(t, who)['pools'] as readonly Pool[]).find((one) => one.key === key)!.left;

const featureLine = (
  t: ReturnType<typeof table>,
  who: string,
  feature: string,
): HeldFeatureLine | undefined =>
  (sheetOf(t, who)['features'] as readonly HeldFeatureLine[]).find(
    (one) => one.feature === feature,
  );

const grantedTo = (t: ReturnType<typeof table>, who: string): readonly GrantedLine[] =>
  sheetOf(t, who)['grantedReactions'] as readonly GrantedLine[];

/** A Bard and a Fighter, standing in a room, thirty feet apart. */
function party(seed = 'inspiration') {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'lyra', choices: bard('Lyra') }));
  expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
  expectOk(t.call('set_scene', { width: 120, depth: 60, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the stage', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'lyra', fromLandmark: 'the stage', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'bram', fromCreature: 'lyra', feet: 30, bearing: 90 }));
  return t;
}

// — the Bard's half ————————————————————————————————————————————————————————

describe('a Bard can put a die in somebody else’s hands', () => {
  it('reports the feature as one this surface spends, with the tool that spends it', () => {
    const t = party();
    // The half `sheet` could not say: the pool was reported and no feature line
    // named a door for it, which is the gap `spentBy` exists to close.
    expect(featureLine(t, 'lyra', 'bard:bardic-inspiration')).toMatchObject({
      kind: 'conferral',
      spentBy: 'confer_reaction',
      action: 'bonus-action',
    });
  });

  it('spends one use of the pool, and only the giver’s', () => {
    const t = party();
    // SRD: "a number of times equal to your Charisma modifier (minimum of
    // once)" — a 17 is three, and the number is the engine's.
    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(3);

    const given = expectOk(
      t.call('confer_reaction', {
        who: 'lyra',
        feature: 'bard:bardic-inspiration',
        target: 'bram',
      }),
    );
    expect(given.resolution['conferred']).toBe('bard:bardic-inspiration');
    expect(given.resolution['to']).toBe('bram');
    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(2);
    expect(given.events.some((event) => event.type === 'reaction-granted')).toBe(true);
  });

  /**
   * "Who can see or hear you", reported rather than refused: sight is declared
   * and hearing is modelled nowhere, so withholding the die would be the
   * engine deciding a fact nobody stated.
   */
  it('says which half of the sentence it could not check', () => {
    const t = party();
    // The half the engine *can* check, declared false: Bram cannot see Lyra.
    // Whether he can hear her is modelled nowhere, so the die is given anyway
    // and the unchecked half comes back rather than the conferral being
    // withheld on a fact nobody stated.
    expectOk(t.call('declare_sight', { from: 'bram', to: 'lyra', seen: false }));
    const given = expectOk(
      t.call('confer_reaction', {
        who: 'lyra',
        feature: 'bard:bardic-inspiration',
        target: 'bram',
      }),
    );
    expect(given.unverified.join(' ')).toContain('hear');
    expect(grantedTo(t, 'bram')).toHaveLength(1);
  });
});

// — the recipient's half ———————————————————————————————————————————————————

describe('the creature who was given a die can see it and spend it', () => {
  const inspired = (seed = 'inspiration') => {
    const t = party(seed);
    expectOk(
      t.call('confer_reaction', {
        who: 'lyra',
        feature: 'bard:bardic-inspiration',
        target: 'bram',
      }),
    );
    return t;
  };

  it('reports the die on the recipient’s own sheet, and whose it was', () => {
    const t = inspired();
    const held = grantedTo(t, 'bram');
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      feature: 'bard:bardic-inspiration',
      name: 'Bardic Inspiration',
      from: 'lyra',
      window: 'test-rolled',
      // The door that takes it, for the reason `spentBy` names one: a die a
      // caller is told it holds and can find no call for is half a door.
      takenBy: 'take_test_reaction',
      // SRD spends no Reaction on it: the cost was paid by whoever gave it.
      costsReaction: false,
    });
    // And the Bard is not holding one: the die was given away, not copied.
    expect(grantedTo(t, 'lyra')).toEqual([]);
  });

  it('turns a failed check round with it, and the die is then gone', () => {
    const t = inspired();
    const check = expectOk(
      t.rule('ability_check', { who: 'bram', ability: 'cha', dc: 25, because: 'the crowd' }),
    );
    expect(check.resolution['success']).toBe(false);
    const before = check.resolution['total'] as number;

    const pushed = expectOk(
      t.call('take_test_reaction', { who: 'bram', feature: 'bard:bardic-inspiration' }),
    );
    expect(pushed.resolution['total'] as number).toBeGreaterThan(before);
    expect(grantedTo(t, 'bram')).toEqual([]);

    expectOk(t.rule('settle_test'));
  });
});

// — what is refused, and what it costs to be refused ————————————————————————

describe('a conferral the rules do not allow costs nothing', () => {
  it('refuses a feature the giver has not got, naming it', () => {
    const t = party();
    const before = t.campaign.log().length;
    const out = expectRefused(
      t.call('confer_reaction', { who: 'bram', feature: 'bard:bardic-inspiration', target: 'lyra' }),
    );
    expect(out.code).toBe('no_such_feature');
    expect(t.campaign.log()).toHaveLength(before);
  });

  it('refuses the Bard inspiring themselves, because SRD says another creature', () => {
    const t = party();
    const out = expectRefused(
      t.call('confer_reaction', { who: 'lyra', feature: 'bard:bardic-inspiration', target: 'lyra' }),
    );
    expect(out.code).toBe('not_another_creature');
    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(3);
  });

  it('refuses a recipient further off than the feature reaches', () => {
    const t = party();
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'lyra', feet: 90, bearing: 90 }));

    const out = expectRefused(
      t.call('confer_reaction', {
        who: 'lyra',
        feature: 'bard:bardic-inspiration',
        target: 'grish',
      }),
    );
    expect(out.code).toBe('out_of_reach');
    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(3);
  });

  it('refuses an empty pool, having given every die away', () => {
    const t = party();
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'lyra', feet: 10, bearing: 0 }));
    expectOk(
      t.call('confer_reaction', { who: 'lyra', feature: 'bard:bardic-inspiration', target: 'bram' }),
    );
    expectOk(
      t.call('confer_reaction', {
        who: 'lyra',
        feature: 'bard:bardic-inspiration',
        target: 'grish',
      }),
    );
    expectOk(t.call('add_creature', { id: 'snik', monsterId: 'goblin-warrior' }));
    expectOk(t.call('place_creature', { who: 'snik', fromCreature: 'lyra', feet: 15, bearing: 0 }));
    expectOk(
      t.call('confer_reaction', {
        who: 'lyra',
        feature: 'bard:bardic-inspiration',
        target: 'snik',
      }),
    );
    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(0);

    const out = expectRefused(
      t.call('confer_reaction', {
        who: 'lyra',
        feature: 'bard:bardic-inspiration',
        target: 'grish',
      }),
    );
    expect(out.code).toBe('exhausted');
  });

  it('answers a creature nobody has created as homework, not as a verdict', () => {
    const t = party();
    const out = t.call('confer_reaction', {
      who: 'lyra',
      feature: 'bard:bardic-inspiration',
      target: 'nobody',
    });
    expect(out.status).toBe('needs-context');
    if (out.status !== 'needs-context') return;
    expect(out.establish[0]!.kind).toBe('creature');
    expect(out.establish[0]!.tools).toContain('create_character');
  });
});
