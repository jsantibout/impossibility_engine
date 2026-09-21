/**
 * The morning, through the door that declares it.
 *
 * `declareDawn` had been finished in the engine since charges landed and was
 * recorded in `doors.test.ts` as deliberately withheld — "the rest slice
 * `definitions.ts` says is left for a later batch. It also rolls recovery." Both
 * halves of that reason have since stopped being true: the rest slice landed
 * with `begin_rest`, `end_rest` and `advance_time`, and a command that rolls is
 * what every other door on this surface already is. What was left was a world
 * in which nothing could say the sun had come up, so every line the book gives
 * back "daily at dawn" was given back never.
 *
 * **Dawn is declared and never derived**, which is why it is a door rather
 * than something `advance_time` works out: `time.ts` holds seconds since the
 * campaign began and no number of them is a sunrise. A party that rests eight
 * hours underground has not seen one.
 *
 * **And the caller states nothing but that it happened.** The call carries no
 * arguments at all — not who, not how many charges, not which pools. The
 * engine walks every creature, reads each pool's own `recovers` tag, and
 * throws the dice the item's line prints. That is invariant 1 at its
 * narrowest: the model says "morning", and every number in the answer is the
 * engine's.
 *
 * The lantern below is a homebrew item for the reason `content.test.ts` uses
 * homebrew — it exercises a mechanic the engine already has through the public
 * door — and it is shaped on SRD's Wand of Secrets, "3 charges and regains 1d3
 * expended charges daily at dawn", with a conferral bolted on so a charge can
 * be spent from this surface. Its two siblings differ in one field each, which
 * is the whole of what this file is about: a tag decides what a morning is
 * worth, and a rest does not do a morning's job.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { extendContent, type CatalogueItem, type Content } from '@ie/engine';
import { isErr } from '@ie/shared';
import { createCampaign, createDmSurface, createSurface, type ToolOutcome } from '@ie/tools';

/** Three charges back at dawn on a `1d3`, which is SRD's Wand of Secrets line. */
const DAWN_LANTERN = 'sunrise-lantern';
/**
 * "Regains **all** expended charges daily at dawn" — SRD Eyes of Charming's
 * half of the same rule, which is the `dawn` tag on its own with no dice
 * beside it.
 *
 * It is the shape a printed `N/Day` line comes back in, so it is the branch
 * this door most needs proved: a refill is one `resources-restored` and no
 * roll at all, and a door that only ever exercised the rolled branch would say
 * nothing about it.
 */
const PLAIN_LANTERN = 'daylight-lantern';
/** The same object with the tag a Short Rest answers. */
const SHORT_LANTERN = 'hearth-lantern';
/** And the tag a Long Rest answers. */
const LONG_LANTERN = 'midnight-lantern';

const lantern = (
  id: string,
  name: string,
  recovers: 'dawn' | 'short-rest' | 'long-rest',
  regainsAtDawn?: string,
): CatalogueItem =>
  ({
    id,
    name,
    kind: 'wondrous',
    weightLb: 1,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'pool',
        key: `${id}:charges`,
        label: `${name} charges`,
        uses: 3,
        recovers,
        ...(regainsAtDawn === undefined ? {} : { regainsAtDawn }),
      },
      {
        kind: 'confers',
        action: 'action',
        charges: 1,
        durationSeconds: 60,
        effects: [{ kind: 'temp-hp', amount: { flat: 4 }, addSpellcastingModifier: false }],
      },
    ],
  }) as unknown as CatalogueItem;

const CONTENT: Content = (() => {
  const built = extendContent(SRD_CONTENT, {
    items: [
      lantern(DAWN_LANTERN, 'Sunrise Lantern', 'dawn', '1d3'),
      lantern(PLAIN_LANTERN, 'Daylight Lantern', 'dawn'),
      lantern(SHORT_LANTERN, 'Hearth Lantern', 'short-rest'),
      lantern(LONG_LANTERN, 'Midnight Lantern', 'long-rest'),
    ],
  });
  if (isErr(built)) throw new Error(`the homebrew lanterns: ${built.reason}`);
  return built.value;
})();

/** A Fighter who asks for nothing this file is not about. */
const fighter = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 2,
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
  feats: {
    'criminal:alert': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed: string) {
  const campaign = createCampaign({ content: CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;

  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

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

interface Pool {
  readonly key: string;
  readonly left: number;
  readonly max: number;
}

const poolsOf = (t: ReturnType<typeof table>, who: string): readonly Pool[] =>
  expectOk(t.call('sheet', { who })).resolution['pools'] as readonly Pool[];

/**
 * A pool by the item it came from, rather than by a key written out here.
 *
 * An item's pool is keyed by the instance the engine issued at the moment it
 * was gained, so the key is the engine's to spell and this reads the one that
 * starts with the item's own id.
 */
const lanternPool = (t: ReturnType<typeof table>, who: string, item: string): Pool => {
  const found = poolsOf(t, who).find((pool) => pool.key.startsWith(`${item}:charges`));
  if (found === undefined) {
    throw new Error(`no pool for ${item}; there are ${poolsOf(t, who).map((p) => p.key).join(', ')}`);
  }
  return found;
};

const LANTERNS = [DAWN_LANTERN, PLAIN_LANTERN, SHORT_LANTERN, LONG_LANTERN];

/** A character holding all four lanterns, with a charge out of each. */
function theNightBefore(seed = 'dawn') {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
  expectOk(
    t.rule('award_items', {
      who: 'bram',
      items: LANTERNS.map((id) => ({ id })),
      because: 'the hoard',
    }),
  );
  for (const item of LANTERNS) {
    expectOk(t.call('equip_item', { who: 'bram', item }));
    expectOk(t.call('use_item', { who: 'bram', item }));
  }
  return t;
}

describe('a morning is a door, and everything it gives back is the engine’s', () => {
  it('takes no arguments at all: the caller says only that the sun came up', () => {
    const t = theNightBefore();
    // An empty object is the whole of the call. Nothing names a pool, a
    // creature, a count or a die.
    expectOk(t.call('declare_dawn', {}));
  });

  it('refills a dawn pool, on a die it rolled itself and recorded', () => {
    const t = theNightBefore();
    const before = lanternPool(t, 'bram', DAWN_LANTERN);
    expect(before.left).toBe(before.max - 1);

    const dawn = expectOk(t.call('declare_dawn', {}));

    // The provenance: a roll the engine issued, labelled with the line the
    // item prints, and the generator moved on the record.
    const rolled = dawn.events.find((event) => event.type === 'roll-recorded');
    expect(rolled, 'a dawn that rolls records the roll').toBeDefined();
    expect(rolled?.type === 'roll-recorded' && rolled.label).toContain('1d3');
    expect(dawn.events.some((event) => event.type === 'rolls-issued')).toBe(true);

    // And the number in the recovery is the number on the die, capped at what
    // was spent — one charge out, so exactly one back.
    const regained = dawn.events.find((event) => event.type === 'resource-regained');
    expect(regained?.type === 'resource-regained' && regained.amount).toBe(1);
    expect(lanternPool(t, 'bram', DAWN_LANTERN).left).toBe(before.max);
  });

  /**
   * The other kind of morning, and the one the dependent work needs: "regains
   * **all** expended charges daily at dawn" is the `dawn` tag with no dice
   * beside it, and a printed `N/Day` line that resets at dawn comes back the
   * same way. It is one `resources-restored` and no roll at all.
   */
  it('refills a dawn pool that prints no dice, and throws none for it', () => {
    const t = theNightBefore();
    const before = lanternPool(t, 'bram', PLAIN_LANTERN);
    expect(before.left).toBe(before.max - 1);

    const dawn = expectOk(t.call('declare_dawn', {}));

    const restored = dawn.events.find(
      (event) => event.type === 'resources-restored' && event.recovers === 'dawn',
    );
    expect(restored, 'the morning is one restoration by tag').toBeDefined();
    expect(lanternPool(t, 'bram', PLAIN_LANTERN).left).toBe(before.max);

    // And two charges out of it come back together, because "all" is all.
    expectOk(t.call('use_item', { who: 'bram', item: PLAIN_LANTERN }));
    expectOk(t.call('use_item', { who: 'bram', item: PLAIN_LANTERN }));
    expect(lanternPool(t, 'bram', PLAIN_LANTERN).left).toBe(before.max - 2);
    expectOk(t.call('declare_dawn', {}));
    expect(lanternPool(t, 'bram', PLAIN_LANTERN).left).toBe(before.max);
  });

  it('is the same morning for the same seed, and not always the same die', () => {
    const rolls = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((seed) => {
      const t = theNightBefore(seed);
      // Two charges out, so a 1d3 has somewhere to land other than 1.
      expectOk(t.call('use_item', { who: 'bram', item: DAWN_LANTERN }));
      const dawn = expectOk(t.call('declare_dawn', {}));
      const rolled = dawn.events.find((event) => event.type === 'roll-recorded');
      return rolled?.type === 'roll-recorded' ? rolled.total : 0;
    });
    expect(new Set(rolls).size).toBeGreaterThan(1);

    const once = expectOk(theNightBefore('repeat').call('declare_dawn', {}));
    const again = expectOk(theNightBefore('repeat').call('declare_dawn', {}));
    expect(again.events).toEqual(once.events);
  });

  it('leaves a short-rest and a long-rest pool exactly where the night left them', () => {
    const t = theNightBefore();
    const shortBefore = lanternPool(t, 'bram', SHORT_LANTERN);
    const longBefore = lanternPool(t, 'bram', LONG_LANTERN);

    expectOk(t.call('declare_dawn', {}));

    expect(lanternPool(t, 'bram', SHORT_LANTERN).left).toBe(shortBefore.left);
    expect(lanternPool(t, 'bram', LONG_LANTERN).left).toBe(longBefore.left);
    expect(shortBefore.left).toBe(shortBefore.max - 1);
    expect(longBefore.left).toBe(longBefore.max - 1);
  });

  it('rolls nothing at all for a pool nobody has spent from', () => {
    const t = table('untouched');
    expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
    expectOk(
      t.rule('award_items', {
        who: 'bram',
        items: [{ id: DAWN_LANTERN }],
        because: 'the hoard',
      }),
    );
    const dawn = expectOk(t.call('declare_dawn', {}));
    expect(dawn.events.some((event) => event.type === 'roll-recorded')).toBe(false);
    expect(dawn.events.some((event) => event.type === 'resource-regained')).toBe(false);
  });

  /**
   * The other half of the ruling this door exists for: a rest is not a
   * morning. SRD prints "daily at dawn" and "regains all expended uses on a
   * Short Rest" as two different sentences, and a session that could only rest
   * would quietly turn one into the other.
   */
  it('and a rest does not do a morning’s job', () => {
    const t = theNightBefore();
    const dawnBefore = lanternPool(t, 'bram', DAWN_LANTERN);

    expectOk(t.call('begin_rest', { who: 'bram', kind: 'long' }));
    expectOk(t.call('advance_time', { hours: 8, because: 'the whole night, underground' }));
    expectOk(t.call('end_rest', { who: 'bram' }));

    // The Short and Long lanterns are full again; the dawn one has seen no
    // sunrise and is exactly where it was.
    expect(lanternPool(t, 'bram', SHORT_LANTERN).left).toBe(lanternPool(t, 'bram', SHORT_LANTERN).max);
    expect(lanternPool(t, 'bram', LONG_LANTERN).left).toBe(lanternPool(t, 'bram', LONG_LANTERN).max);
    expect(lanternPool(t, 'bram', DAWN_LANTERN).left).toBe(dawnBefore.left);

    // And then the party walks out into the light.
    expectOk(t.call('declare_dawn', {}));
    expect(lanternPool(t, 'bram', DAWN_LANTERN).left).toBe(dawnBefore.max);
  });

  /** The transport's retry is a no-op, as it is for every other door. */
  it('is idempotent under the transport’s own id', () => {
    const t = theNightBefore();
    const first = t.surface.call({ tool: 'declare_dawn', input: {}, commandId: 'toolu_dawn' });
    expectOk(first);
    const again = t.surface.call({ tool: 'declare_dawn', input: {}, commandId: 'toolu_dawn' });
    expectOk(again);
    expect(again.status === 'ok' && again.events).toEqual([]);
    expect(lanternPool(t, 'bram', DAWN_LANTERN).left).toBe(lanternPool(t, 'bram', DAWN_LANTERN).max);
  });
});
