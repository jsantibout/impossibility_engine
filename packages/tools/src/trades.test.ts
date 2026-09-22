/**
 * One resource spent to buy another, through a door.
 *
 * `kind: 'trade'` has been a `FeatureGrant` and `tradeResource` a whole engine
 * command since SRD Wild Resurgence was built — two refusals of its own, a
 * once-a-turn ledger key, a once-a-day pool and the caster's choice of which
 * slot to burn. Above it there was nothing at all: `sheet` listed no trade,
 * `SPENT_BY` held no entry for one, and `doors.test.ts` recorded
 * `slot_level_required` as a refusal no field on either surface could answer.
 * Two level 5 features were stopped at that door — SRD Font of Inspiration,
 * "you can expend a spell slot to regain one expended use of Bardic
 * Inspiration", and both directions of Wild Resurgence.
 *
 * So this file drives the whole sentence from outside the engine: the Bard
 * spends a die, buys it back with a slot and the log carries both halves; the
 * Druid pays a use of Wild Shape for a level 1 slot; the sheet says the trade
 * is there and names `trade_resource` as the thing that spends it; and a trade
 * with nothing to give back comes back as a value.
 *
 * **One half of one sentence is not reachable from here and says so.** SRD
 * Wild Resurgence's first direction is "if you have no uses of Wild Shape
 * left, you can give yourself one use by expending a spell slot" — and
 * *nothing on either surface spends a use of Wild Shape*, because becoming a
 * Beast is recorded in the catalogue as not modelled. A level 5 Druid holds
 * two uses and can spend exactly one of them, through the other direction of
 * this same feature, once a day. So the test drives that direction through the
 * door to the refusal the clause itself writes — which is what proves the call
 * reached *that* trade and not the other one, since `onlyIfEmpty` belongs to
 * one of the two and not to both.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createSurface,
  type ToolOutcome,
} from '@ie/tools';

/**
 * Every feature the catalogue publishes whose grant is a trade, in id order.
 *
 * Derived rather than listed, so that a class the book grows fails the sweep
 * below instead of going unreported — and writing the derivation is what
 * found two the list had not.
 *
 * **The four hosts walked here are the four `checkContent` itself walks**, so
 * the sweep is exhaustive by construction rather than by somebody having
 * remembered. A feat is not among them and is not an omission: `FEAT_GRANT_KINDS`
 * admits two kinds and a trade is neither, so `checkContent` refuses a feat
 * that carries one with `feat_grant_not_read`. An item carries a standing
 * grant rather than a feature grant, which is a different vocabulary again.
 */
const TRADE_FEATURES: readonly string[] = [
  ...SRD_CONTENT.classes.flatMap((one) => one.features),
  ...SRD_CONTENT.subclasses.flatMap((one) => one.features),
  ...SRD_CONTENT.species.flatMap((one) => one.features),
  ...SRD_CONTENT.backgrounds.flatMap((one) => one.features),
]
  .filter((feature) => feature.grants?.kind === 'trade')
  .map((feature) => feature.id)
  .sort();

// — two characters at the level their trade arrives at ————————————————————

/** A level 5 Bard of the College of Lore: Font of Inspiration is a level 5 feature. */
const bard = {
  name: 'Lyra',
  classId: 'bard',
  level: 5,
  subclassId: 'college-of-lore',
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 12, int: 10, wis: 13, cha: 15 },
  },
  abilityIncreases: { cha: 2, wis: 1 },
  classSkills: ['performance', 'persuasion', 'deception'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral',
  cantrips: ['vicious-mockery', 'dancing-lights', 'mage-hand'],
  spellbook: [],
  preparedSpells: [
    'aid',
    'bane',
    'blindness-deafness',
    'calm-emotions',
    'charm-person',
    'color-spray',
    'command',
    'comprehend-languages',
    'animal-messenger',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['acrobatics'],
    'bard:expertise': ['performance', 'persuasion'],
    'college-of-lore:bonus-proficiencies': ['arcana', 'history', 'insight'],
  },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
    'human:versatile': { featId: 'alert' },
    'bard:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['cha', 'cha'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

/** A level 5 Druid: Wild Resurgence is a level 5 feature, and prints two trades. */
const druid = {
  name: 'Fenn',
  classId: 'druid',
  level: 5,
  subclassId: 'circle-of-the-land',
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['nature', 'perception'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral',
  cantrips: ['druidcraft', 'guidance', 'shillelagh'],
  spellbook: [],
  preparedSpells: [
    'aid',
    'barkskin',
    'call-lightning',
    'cure-wounds',
    'dispel-magic',
    'faerie-fire',
    'fog-cloud',
    'goodberry',
    'healing-word',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['acrobatics'],
    'druid:primal-order': ['Magician'],
  },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
    'human:versatile': { featId: 'alert' },
    'druid:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['wis', 'wis'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

/** The ally who gets the die, so that a die has been spent to buy back. */
const fighter = {
  name: 'Bram',
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
};

// — a table, and a caller that numbers its own ids as a transport would ————

function table(seed = 'trades') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, call };
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
}

interface Slots {
  readonly level: number;
  readonly left: number;
}

interface TradeLine {
  readonly trade: string;
  readonly name: string;
  readonly action: string;
  readonly spends: { readonly pool: string | null; readonly uses: number };
  readonly gains: { readonly pool: string; readonly uses: number };
  readonly slotLevelRequired: boolean;
  readonly limit: string;
  readonly limitPool?: string;
  readonly onlyIfEmpty?: string;
}

interface FeatureLine {
  readonly feature: string;
  readonly name: string;
  readonly kind: string;
  readonly spentBy: string | null;
  readonly alsoSpentBy?: readonly string[];
  readonly trades?: readonly TradeLine[];
}

const sheetOf = (t: ReturnType<typeof table>, who: string) =>
  expectOk(t.call('sheet', { who })).resolution;

const featureLine = (
  t: ReturnType<typeof table>,
  who: string,
  feature: string,
): FeatureLine | undefined =>
  (sheetOf(t, who)['features'] as readonly FeatureLine[]).find((one) => one.feature === feature);

const poolLeft = (t: ReturnType<typeof table>, who: string, key: string): number =>
  (sheetOf(t, who)['pools'] as readonly Pool[]).find((one) => one.key === key)!.left;

const slotsLeft = (t: ReturnType<typeof table>, who: string, level: number): number =>
  (sheetOf(t, who)['spellSlots'] as readonly Slots[]).find((one) => one.level === level)!.left;

/** A Bard and a Fighter, standing in a room thirty feet apart. */
function stage(seed = 'trades') {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'lyra', choices: bard }));
  expectOk(t.call('create_character', { id: 'bram', choices: fighter }));
  expectOk(t.call('set_scene', { width: 120, depth: 60, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the stage', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'lyra', fromLandmark: 'the stage', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'bram', fromCreature: 'lyra', feet: 30, bearing: 90 }));
  return t;
}

/** A Druid in a clearing, because a spell with a range needs one to mean anything. */
const grove = (seed = 'grove') => {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'fenn', choices: druid }));
  expectOk(t.call('set_scene', { width: 120, depth: 60, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the oak', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'fenn', fromLandmark: 'the oak', feet: 0 }));
  return t;
};

// — what the sheet says a trade is ————————————————————————————————————————

describe('the sheet reports a trade as a thing this surface can spend', () => {
  /**
   * The half `sheet` could not say. A caller was told its Bardic Inspiration
   * pool was empty and shown no way to refill it, because the feature that
   * refills it reported nothing at all.
   */
  it('names the tool that spends it, and the menu that tool is asked for', () => {
    const t = stage();
    const line = featureLine(t, 'lyra', 'bard:font-of-inspiration');
    expect(line).toMatchObject({
      name: 'Font of Inspiration',
      kind: 'trade',
      spentBy: 'trade_resource',
      // SRD: "(no action required)".
      action: 'none',
    });
    expect(line!.trades).toEqual([
      {
        trade: 'slot-for-inspiration',
        name: 'Font of Inspiration',
        action: 'none',
        // "a spell slot" — the level is the caster's, so there is no key to
        // name and the caller is told it has to say which.
        spends: { pool: null, uses: 1 },
        slotLevelRequired: true,
        gains: { pool: 'bardic-inspiration', uses: 1 },
        gainedSlotLevelsRequired: false,
        limit: 'unlimited',
      },
    ]);
  });

  /**
   * One feature, two trades, one line — the shape a pool's menu already takes.
   * Two lines would say a Druid held two features, and the call is asked for
   * the feature *and* which of its trades.
   */
  it('reports a feature that prints two trades as one line with two entries', () => {
    const t = grove();
    const line = featureLine(t, 'fenn', 'druid:wild-resurgence');
    expect(line).toMatchObject({
      // The first trade's name, because the sheet keeps a trade's name and not
      // its feature's — see `holdings.ts`. The id is what the call takes.
      name: 'Wild Resurgence (a slot for a use)',
      kind: 'trade',
      spentBy: 'trade_resource',
      action: 'none',
    });
    expect(line!.trades).toEqual([
      {
        trade: 'slot-for-wild-shape',
        name: 'Wild Resurgence (a slot for a use)',
        action: 'none',
        spends: { pool: null, uses: 1 },
        slotLevelRequired: true,
        gains: { pool: 'wild-shape', uses: 1 },
        gainedSlotLevelsRequired: false,
        limit: 'once-per-turn',
        // SRD: "if you have no uses of Wild Shape left".
        onlyIfEmpty: 'wild-shape',
      },
      {
        trade: 'wild-shape-for-slot',
        name: 'Wild Resurgence (a use for a slot)',
        action: 'none',
        spends: { pool: 'wild-shape', uses: 1 },
        slotLevelRequired: false,
        gains: { pool: 'spell-slot:1', uses: 1 },
        gainedSlotLevelsRequired: false,
        limit: 'once-per-long-rest',
        // "you can't do so again until you finish a Long Rest": a pool of one,
        // which is on `pools` under this key with what is left of it.
        limitPool: 'druid:wild-resurgence',
      },
    ]);
  });
  /**
   * What the book prints, recorded; and what these two hold, checked.
   *
   * **The list is derived from `SRD_CONTENT`** — every feature anywhere in it
   * whose grant is a trade — rather than written down, so a class the
   * catalogue grows fails here instead of going unreported. That is the
   * mistake `holdings.test.ts` records against its own former five-character
   * party, and writing the derivation is what found the other two: a Bard 5
   * and a Druid 5 are not the whole of the shape.
   *
   * Where each of the six is covered, so that no reader has to guess:
   *
   * - **Font of Inspiration** (Bard 5) and **Wild Resurgence** (Druid 5) are
   *   driven end to end through the door in this file.
   * - **Font of Magic** (Sorcerer 2) and **Arcane Recovery** (Wizard 1) are
   *   driven end to end against the engine command in
   *   `packages/content/src/slot-trades.test.ts`, which is where the two
   *   shapes that leave the *bought* slot to the caller live — a price table
   *   and a combined-level budget.
   * - **Sorcery Incarnate** (Sorcerer 7) is inside the level 10 catalogue
   *   sweep in `holdings.test.ts` — which proves less than it sounds like: it
   *   is the Sorcerer 10 sheet that keeps this file's new `SPENT_BY` key
   *   non-vacuous, and that every `spentBy` it reports names a real tool.
   * - **Holy Nimbus** (Oath of Devotion 20) is above every sweep there is.
   *
   * **Both of the two are driven end to end against the engine command**, in
   * `packages/content/src/unlimited-trades.test.ts` — including the clause
   * Sorcery Incarnate prints and the fixed-level slot Holy Nimbus spends. What
   * no test reaches is the *door* over them, which is one `settle` the Bard
   * and the Druid exercise twice between them. The one content shape nothing
   * here holds is Holy Nimbus's: a trade that spends a spell slot of a level
   * the grant names rather than one the caster chooses. The sheet would report
   * `slotLevelRequired: false` for it, which is the branch Wild Resurgence's
   * second trade already takes by spending a pool instead.
   *
   * The second assertion is the merge. `holdings.ts` reports a feature once
   * and the first claim on its id decides what it is, so a feature holding a
   * trade **and** something else would keep the first claim's kind and name
   * this door in `alsoSpentBy` — the merge `two-menus.test.ts` holds for a
   * pool's menu and a hit's, and the branch this file's trades loop joined.
   * Nothing in the book can reach it: `FeatureDefinition.grants` is singular
   * and `checkContent` refuses two definitions under one id, so a trade is
   * always the only claim on its id. The machinery stays and the claim is
   * recorded rather than argued about.
   */
  it('records every trade the book prints, and grows no second door for one', () => {
    expect(TRADE_FEATURES).toEqual([
      'bard:font-of-inspiration',
      'druid:wild-resurgence',
      'oath-of-devotion:holy-nimbus',
      'sorcerer:font-of-magic',
      'sorcerer:sorcery-incarnate',
      'wizard:arcane-recovery',
    ]);

    const lines = [
      ...(sheetOf(stage(), 'lyra')['features'] as readonly FeatureLine[]),
      ...(sheetOf(grove(), 'fenn')['features'] as readonly FeatureLine[]),
    ];
    const withTrades = lines.filter((one) => one.trades !== undefined);
    expect(withTrades.map((one) => one.feature).sort()).toEqual([
      'bard:font-of-inspiration',
      'druid:wild-resurgence',
    ]);
    for (const line of withTrades) {
      expect(line.kind).toBe('trade');
      expect(line.spentBy).toBe('trade_resource');
      expect(line.alsoSpentBy).toBeUndefined();
    }
  });
});

// — the Bard's slot for a die ——————————————————————————————————————————————

describe('a Bard buys back a Bardic Inspiration die with a spell slot', () => {
  it('spends the slot the caster named and gives the die back, both in the log', () => {
    const t = stage();
    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(4);

    // A die has to have been spent before there is one to give back: SRD's
    // trade returns what was expended and never mints above the table.
    expectOk(
      t.call('confer_reaction', {
        who: 'lyra',
        feature: 'bard:bardic-inspiration',
        target: 'bram',
      }),
    );
    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(3);
    expect(slotsLeft(t, 'lyra', 2)).toBe(3);

    const traded = expectOk(
      t.call('trade_resource', {
        who: 'lyra',
        feature: 'bard:font-of-inspiration',
        trade: 'slot-for-inspiration',
        slotLevel: 2,
      }),
    );

    // Both halves, in the log the tool appended and in the resolution read off
    // it. The engine decided both amounts; neither was sent.
    expect(traded.resolution['spent']).toEqual([{ pool: 'spell-slot:2', uses: 1 }]);
    expect(traded.resolution['regained']).toEqual([{ pool: 'bardic-inspiration', uses: 1 }]);
    expect(
      traded.events.filter((event) => event.type === 'resource-spent').map((event) => event.key),
    ).toEqual(['spell-slot:2']);
    expect(
      traded.events.filter((event) => event.type === 'resource-regained').map((event) => event.key),
    ).toEqual(['bardic-inspiration']);

    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(4);
    expect(slotsLeft(t, 'lyra', 2)).toBe(2);
  });

  /**
   * "The sentence prints no limit of any kind", which is what `unlimited`
   * says: a Bard with slots left may do it as often as they like.
   */
  it('has no limit but what it spends', () => {
    const t = stage();
    for (const target of ['bram', 'bram']) {
      expectOk(
        t.call('confer_reaction', {
          who: 'lyra',
          feature: 'bard:bardic-inspiration',
          target,
        }),
      );
    }
    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(2);

    for (const level of [1, 1]) {
      expectOk(
        t.call('trade_resource', {
          who: 'lyra',
          feature: 'bard:font-of-inspiration',
          trade: 'slot-for-inspiration',
          slotLevel: level,
        }),
      );
    }
    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(4);
    expect(slotsLeft(t, 'lyra', 1)).toBe(2);
  });

  /**
   * The refusal `doors.test.ts` recorded as unanswerable until this tool
   * existed: "you can expend a spell slot", with the level left to the caster.
   * It is a value, and it is answerable at the field the tool now has.
   */
  it('refuses a trade that spends an unnamed slot, and says the caster chooses', () => {
    const t = stage();
    expectOk(
      t.call('confer_reaction', {
        who: 'lyra',
        feature: 'bard:bardic-inspiration',
        target: 'bram',
      }),
    );
    const refused = expectRefused(
      t.call('trade_resource', {
        who: 'lyra',
        feature: 'bard:font-of-inspiration',
        trade: 'slot-for-inspiration',
      }),
    );
    expect(refused.code).toBe('slot_level_required');
    expect(refused.reason).toContain('caster chooses');
  });
});

// — a refusal is a value ————————————————————————————————————————————————————

describe('a trade with nothing to buy back is refused rather than thrown', () => {
  it('refuses when the pool it would fill has nothing expended in it', () => {
    const t = stage();
    // Nobody has been inspired, so every die is still there and the trade
    // would pay a slot for nothing at all.
    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(4);

    const refused = expectRefused(
      t.call('trade_resource', {
        who: 'lyra',
        feature: 'bard:font-of-inspiration',
        trade: 'slot-for-inspiration',
        slotLevel: 1,
      }),
    );
    expect(refused.code).toBe('nothing_to_regain');
    expect(refused.reason).toContain('Bardic Inspiration');

    // And nothing was spent: a refused trade costs neither end of itself.
    expect(slotsLeft(t, 'lyra', 1)).toBe(4);
    expect(poolLeft(t, 'lyra', 'bardic-inspiration')).toBe(4);
  });

  it('refuses a trade the feature does not print, naming what was asked for', () => {
    const t = stage();
    const refused = expectRefused(
      t.call('trade_resource', {
        who: 'lyra',
        feature: 'bard:font-of-inspiration',
        trade: 'inspiration-for-slot',
      }),
    );
    expect(refused.code).toBe('no_such_feature');
    expect(refused.reason).toContain('inspiration-for-slot');
  });
});

// — the Druid's two directions —————————————————————————————————————————————

describe('a Druid’s Wild Resurgence runs in both directions', () => {
  /**
   * "You can expend one use of Wild Shape (no action required) to give
   * yourself a level 1 spell slot, but you can't do so again until you finish
   * a Long Rest."
   */
  it('pays a use of Wild Shape for a level 1 slot, once a day', () => {
    const t = grove();
    expect(poolLeft(t, 'fenn', 'wild-shape')).toBe(2);
    expect(slotsLeft(t, 'fenn', 1)).toBe(4);

    // A slot has to have been spent before there is one to give back.
    expectOk(t.call('cast_spell', { caster: 'fenn', spellId: 'cure-wounds', targets: ['fenn'], slotLevel: 1 }));
    expect(slotsLeft(t, 'fenn', 1)).toBe(3);

    const traded = expectOk(
      t.call('trade_resource', {
        who: 'fenn',
        feature: 'druid:wild-resurgence',
        trade: 'wild-shape-for-slot',
      }),
    );
    // Two spends: the use, and the pool of one that *is* the daily limit.
    expect(traded.resolution['spent']).toEqual([
      { pool: 'wild-shape', uses: 1 },
      { pool: 'druid:wild-resurgence', uses: 1 },
    ]);
    expect(traded.resolution['regained']).toEqual([{ pool: 'spell-slot:1', uses: 1 }]);
    expect(poolLeft(t, 'fenn', 'wild-shape')).toBe(1);
    expect(slotsLeft(t, 'fenn', 1)).toBe(4);

    // And not again today. The limit is the pool of one the trade declares,
    // and it is spent — so a second call is refused even with a use of Wild
    // Shape still in hand and a slot freshly expended to give back.
    expectOk(t.call('cast_spell', { caster: 'fenn', spellId: 'cure-wounds', targets: ['fenn'], slotLevel: 1 }));
    const again = expectRefused(
      t.call('trade_resource', {
        who: 'fenn',
        feature: 'druid:wild-resurgence',
        trade: 'wild-shape-for-slot',
      }),
    );
    expect(again.code).toBe('exhausted');
    expect(poolLeft(t, 'fenn', 'wild-shape')).toBe(1);
  });

  /**
   * The other direction, through the same door and to the clause that belongs
   * to it alone: "if you have no uses of Wild Shape left".
   *
   * **This is as far as either surface can take it**, and the reason is in the
   * catalogue rather than here: nothing spends a use of Wild Shape, because
   * becoming a Beast is recorded as not modelled. So a Druid can never have
   * none left, and the successful half of this sentence is unreachable from a
   * session today. What the call does prove is that it reached *this* trade —
   * `onlyIfEmpty` is printed on this one and not on the other — and that the
   * clause comes back as a value.
   */
  it('reaches the other trade, and is answered by that trade’s own clause', () => {
    const t = grove();
    const refused = expectRefused(
      t.call('trade_resource', {
        who: 'fenn',
        feature: 'druid:wild-resurgence',
        trade: 'slot-for-wild-shape',
        slotLevel: 1,
      }),
    );
    expect(refused.code).toBe('not_yet');
    expect(refused.reason).toContain('Wild Shape');
    expect(poolLeft(t, 'fenn', 'wild-shape')).toBe(2);
    expect(slotsLeft(t, 'fenn', 1)).toBe(4);
  });
});
