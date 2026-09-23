/**
 * A printed span and a Proficiency-Bonus pool, seen from the door.
 *
 * `sheet` reports an activation that runs "for 10 minutes" as exactly that,
 * beside the pool it draws on; `activate_feature` takes it; `extend_feature`
 * refuses to maintain what the book gave a duration to.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const goliath = (): Record<string, unknown> => ({
  name: 'Bren',
  classId: 'fighter',
  level: 5,
  subclassId: 'champion',
  speciesId: 'goliath',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'fighter:weapon-mastery': [],
    'goliath:giant-ancestry': ["Stone's Endurance"],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'fighter:fighting-style': { featId: 'archery' },
    'fighter:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed = 'a-goliath-in-the-yard') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { call };
}

const expectOk = (outcome: ToolOutcome): Record<string, unknown> => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 400)}`);
  }
  return outcome.resolution as Record<string, unknown>;
};

interface HeldLine {
  readonly feature: string;
  readonly kind: string;
  readonly spentBy: string | null;
  readonly pool: string | null;
  readonly left: number | null;
  readonly active: boolean;
  readonly lasts?: string;
}

const held = (t: ReturnType<typeof table>, feature: string): HeldLine | undefined =>
  (expectOk(t.call('sheet', { who: 'bren' }))['features'] as readonly HeldLine[]).find(
    (one) => one.feature === feature,
  );

describe('a feature that runs for a printed span, at the door', () => {
  it('is reported with its span and its pool, taken, and not maintained', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'bren', choices: goliath() }));

    expect(held(t, 'goliath:large-form')).toMatchObject({
      kind: 'activated',
      spentBy: 'activate_feature',
      pool: 'goliath:large-form',
      left: 1,
      active: false,
      lasts: '10 minutes',
    });
    // And the Proficiency-Bonus pool beside it, three at level 5: a bare pool,
    // listed among the pools rather than as a feature with a door.
    const pools = expectOk(t.call('sheet', { who: 'bren' }))['pools'] as readonly {
      readonly key: string;
      readonly max: number;
      readonly left: number;
    }[];
    expect(pools.find((one) => one.key === 'goliath:giant-ancestry')).toMatchObject({ max: 3, left: 3 });

    expectOk(t.call('activate_feature', { who: 'bren', feature: 'goliath:large-form' }));
    expect(held(t, 'goliath:large-form')).toMatchObject({ active: true, left: 0 });

    const extended = t.call('extend_feature', {
      who: 'bren',
      feature: 'goliath:large-form',
      by: 'bonus-action',
    });
    expect(extended.status).toBe('refused');
    if (extended.status === 'refused') expect(extended.code).toBe('not_extendable');
  });
});
