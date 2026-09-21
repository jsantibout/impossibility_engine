/**
 * One feature, two menus — and the first claim that used to swallow the
 * second.
 *
 * `holdings.ts` lists a feature **once**, and the order of its loops is a
 * decision: spendable kinds first, standing effects last, so Rage reads as
 * the thing a caller can switch on rather than as a damage resistance it can
 * do nothing with. The cost of that rule was recorded by the builder that
 * opened `attack.onHit`: the `hit-rider` loop runs after `pool-option`, so a
 * feature holding **both** would be reported as the pool and lose its menu of
 * riders — and a menu a caller is never shown is a menu it cannot elect from.
 *
 * **The route the record assumed is shut, and this file is where that is
 * written down.** `FeatureDefinition.grants` is singular — "at most one" — and
 * `checkContent` refuses two definitions under one id, so no catalogue this
 * engine accepts can put a pool menu and a rider on one feature id: the two
 * refusals below are the catalogue saying so in its own words. What content
 * *can* express is the arrangement SRD already uses one pool along — a pool
 * with a menu, and a rider spending that same pool from a feature of its own —
 * and the first test drives it through the door to show both menus arriving
 * under their own ids.
 *
 * So the seam is latent rather than live, and it is closed anyway, at the one
 * level it is reachable: {@link holdingsOf} is a pure reader over a sheet, and
 * the last test asks it about a sheet carrying both under one id. A merge
 * costs one branch, changes nothing about any character the catalogue can
 * build, and means the day the vocabulary grows a second grant the report does
 * not quietly lose half of a feature.
 *
 * **It imports the engine on purpose**, for `extendContent` — the door
 * homebrew comes through — and to hold a sheet the catalogue cannot yet
 * write. Neither is a rule reached around: every claim about what a *caller*
 * sees is still made through `surface.call`.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId } from '@ie/shared';
import { extendContent, type GameState } from '@ie/engine';
import {
  createCampaign,
  createSurface,
  holdingsOf,
  SPENT_BY,
  TOOL_NAMES,
  type HeldFeature,
  type ToolOutcome,
} from '@ie/tools';

// — a homebrew class that spends one pool two ways ——————————————————————————

const TABLE = Array.from({ length: 20 }, (_, index) => ({
  level: index + 1,
  proficiencyBonus: 2 + Math.floor(index / 4),
}));

/** Three uses from level one, sized off the class table as a feature's pool must be. */
const GRIT_BY_LEVEL = Array.from({ length: 20 }, () => 3);

/**
 * A pool with a menu, and a rider that spends the same pool.
 *
 * SRD's own arrangement with the names changed: Channel Divinity is a pool
 * whose uses buy a menu, and Stunning Strike is a rider that spends a pool
 * another feature declared. Two features, because two grants cannot live on
 * one — which is the whole finding this file records.
 */
const BRUISER = {
  id: 'hb-bruiser',
  name: 'Bruiser',
  primaryAbility: 'str',
  hitDie: 10,
  saveProficiencies: ['str', 'con'],
  skillChoices: { choose: 2, from: ['athletics', 'acrobatics', 'insight', 'survival'] },
  weaponProficiencies: ['simple', 'martial'],
  armorTraining: { light: true, medium: true, heavy: false, shields: true },
  subclassLevel: 3,
  table: TABLE,
  startingEquipment: [
    { option: 'A', items: [{ id: 'quarterstaff', quantity: 1 }], goldPieces: 5 },
  ],
  multiclass: {
    weapons: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'hb-bruiser:grit',
      name: 'Grit',
      level: 1,
      automation: 'engine',
      note: 'A pool of Grit, and the two things a use of it buys.',
      grants: {
        kind: 'pool',
        key: 'hb-grit',
        label: 'Grit',
        usesByLevel: GRIT_BY_LEVEL,
        recovers: 'short-rest',
        options: [
          {
            id: 'second-wind',
            name: 'Second Wind',
            action: 'bonus-action',
            effects: [{ kind: 'heal', healing: { dice: '1d8' } }],
          },
        ],
      },
    },
    {
      id: 'hb-bruiser:crushing-blow',
      name: 'Crushing Blow',
      level: 1,
      automation: 'engine',
      note: 'Once per turn when you hit, you can spend a use of Grit to put them down.',
      grants: {
        kind: 'on-hit',
        pool: 'hb-grit',
        costs: 1,
        oncePerTurn: true,
        saveAbility: 'con',
        options: [
          {
            id: 'flatten',
            name: 'Flatten',
            effects: [{ kind: 'save', ability: 'con', condition: 'prone' }],
            lasts: 'start-of-next-turn',
          },
        ],
      },
    },
  ],
};

const unwrap = <T,>(result: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!result.ok) throw new Error(`content refused: ${result.reason}`);
  return result.value;
};

const CONTENT = unwrap(extendContent(SRD_CONTENT, { classes: [BRUISER as never] }));

const bruiser = (name: string): Record<string, unknown> => ({
  name,
  classId: 'hb-bruiser',
  level: 2,
  speciesId: 'human',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { str: 2, con: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Orc', 'Goblin'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'intimidation'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed = 'two-menus') {
  const campaign = createCampaign({ content: CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, surface, call };
}

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`,
    );
  }
  return outcome;
};

const featuresOf = (outcome: ToolOutcome): readonly HeldFeature[] =>
  (outcome.status === 'ok' ? outcome.resolution['features'] : []) as readonly HeldFeature[];

describe('a pool with a menu and a rider that spends it, through the door', () => {
  it('reports both menus, each under its own feature and with its own door', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'brann', choices: bruiser('Brann') }));
    const features = featuresOf(expectOk(t.call('sheet', { who: 'brann' })));

    const grit = features.find((one) => one.feature === 'hb-bruiser:grit')!;
    expect(grit.kind).toBe('pool-option');
    expect(grit.spentBy).toBe(SPENT_BY['pool-option']);
    expect(grit.options?.map((one) => one.option)).toEqual(['second-wind']);

    const blow = features.find((one) => one.feature === 'hb-bruiser:crushing-blow')!;
    expect(blow.kind).toBe('hit-rider');
    expect(blow.spentBy).toBe(SPENT_BY['hit-rider']);
    expect(blow.onHit?.map((one) => one.option)).toEqual(['flatten']);
    // One pool between them, which is the arrangement SRD writes and the
    // reason the two live on two features rather than one.
    expect(blow.pool).toBe('hb-grit');
    expect(grit.pool).toBe('hb-grit');
  });
});

describe('the catalogue cannot put both on one feature, and says why', () => {
  const asClass = (features: readonly unknown[]): unknown => ({ ...BRUISER, features });

  it('refuses two definitions under one id', () => {
    const rider = { ...BRUISER.features[1]!, id: 'hb-bruiser:grit', name: 'Grit' };
    const built = extendContent(SRD_CONTENT, {
      classes: [asClass([BRUISER.features[0]!, rider]) as never],
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain('two features share the id hb-bruiser:grit');
  });

  it('refuses a menu hosted by a feature that is a rider rather than a pool', () => {
    const joins = {
      id: 'hb-bruiser:joins',
      name: 'Joins',
      level: 1,
      automation: 'engine',
      note: 'adds a form to a rider, which is not a menu',
      grants: {
        kind: 'pool-options',
        feature: 'hb-bruiser:crushing-blow',
        options: [
          {
            id: 'second-wind',
            name: 'Second Wind',
            action: 'action',
            effects: [{ kind: 'heal', healing: { dice: '1d8' } }],
          },
        ],
      },
    };
    const built = extendContent(SRD_CONTENT, {
      classes: [asClass([BRUISER.features[1]!, joins]) as never],
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain('a menu is a pool grant');
  });
});

describe('and the reader reports both anyway, for the sheet that carries both', () => {
  /**
   * The character above with its two menus filed under **one** id.
   *
   * No catalogue can write this today — that is the two refusals above — so
   * the sheet is patched rather than built, which is honest about what is
   * being asked: `holdingsOf` is a pure function over a `GameState`, and this
   * is the state it would be handed the day a feature may carry two grants.
   * Everything in the sheet is the engine's own; the one change is the id the
   * rider's menu is filed under.
   */
  function bothUnderOneId(): { state: GameState; feature: string } {
    const t = table('one-id');
    expectOk(t.call('create_character', { id: 'brann', choices: bruiser('Brann') }));
    const state = t.campaign.state();
    const brann = state.creatures['brann']!;
    const feature = 'hb-bruiser:grit';

    const hitOptions = (brann.sheet.hitOptions ?? []).map((one) => ({
      ...one,
      feature,
      featureName: 'Grit',
    }));
    expect(hitOptions).toHaveLength(1);

    return {
      feature,
      state: {
        ...state,
        creatures: {
          ...state.creatures,
          brann: { ...brann, sheet: { ...brann.sheet, hitOptions } },
        },
      },
    };
  }

  it('lists the feature once, with the pool’s menu and the hit’s together', () => {
    const { state, feature } = bothUnderOneId();
    const held = holdingsOf(state, asCharacterId('brann'))!;

    const lines = held.features.filter((one) => one.feature === feature);
    expect(lines).toHaveLength(1);

    const both = lines[0]!;
    expect(both.options?.map((one) => one.option)).toEqual(['second-wind']);
    expect(both.onHit?.map((one) => one.option)).toEqual(['flatten']);
  });

  it('names the door for each of them, because a menu with no door is half a door', () => {
    const { state, feature } = bothUnderOneId();
    const both = holdingsOf(state, asCharacterId('brann'))!.features.find(
      (one) => one.feature === feature,
    )!;

    // The first claim still decides what the feature *is*: a pool a caller
    // spends, rather than a rider it can only elect on a swing.
    expect(both.kind).toBe('pool-option');
    expect(both.spentBy).toBe(SPENT_BY['pool-option']);
    // And the other door is named rather than left to be guessed at.
    expect(both.alsoSpentBy).toEqual([SPENT_BY['hit-rider']]);
    for (const door of both.alsoSpentBy ?? []) expect(TOOL_NAMES).toContain(door);
  });

  it('says nothing extra about a feature with only one menu', () => {
    const t = table('one-menu');
    expectOk(t.call('create_character', { id: 'brann', choices: bruiser('Brann') }));
    const held = holdingsOf(t.campaign.state(), asCharacterId('brann'))!;
    for (const one of held.features) expect(one.alsoSpentBy).toBeUndefined();
  });
});
