import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { expect as unwrap } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import { checkContent, loadContent } from './content.js';

/**
 * What an item does that the engine does not, as **data**.
 *
 * `SpellDefinition.unmodelled` has carried this for spells since the first
 * partial definition: most SRD text is one clean mechanic plus a rider, the
 * choice is between refusing the whole thing and executing the part the engine
 * has, and a definition that executes half of itself must say plainly which
 * half. An item is in exactly that position — a cloak grants Advantage on
 * Stealth *and* imposes Disadvantage on the Perception checks made to find its
 * wearer, and only one of those is a selector the engine can write.
 *
 * Before this field the second clause was a **code comment**. A comment is
 * read by whoever opens the file and by nothing else: no test counts one, no
 * report totals one, and the layer narrating a fight cannot hand one to the
 * DM. `unmodelled` is the same sentence where something can reach it.
 *
 * It is vocabulary rather than mechanism, which is why it is the only engine
 * change the transcription needed: nothing branches on it, nothing executes
 * it, and the validator's whole job is to refuse a note that says nothing.
 */

const codesOf = (item: unknown): readonly string[] =>
  checkContent({ items: [item as CatalogueItem] }).map(
    (problem) => `${problem.code} @ ${problem.field}`,
  );

/** A well-formed magic item, so each case below changes exactly one thing. */
const LENSES = {
  id: 'lenses-of-the-far-shore',
  name: 'Lenses of the Far Shore',
  kind: 'wondrous',
  weightLb: 0,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  attunement: {},
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'flat-bonus', applies: ['ac'], flat: 1 }],
      requires: [{ kind: 'while-worn' }, { kind: 'while-attuned' }],
    },
  ],
  unmodelled: ['you can see the far shore of any body of water you stand beside'],
};

describe('an item says what it does not do, in a field rather than a comment', () => {
  it('accepts a list of notes beside the grants it does execute', () => {
    expect(codesOf(LENSES)).toEqual([]);
    const loaded = unwrap(loadContent({ items: [JSON.parse(JSON.stringify(LENSES))] }), 'load');
    // Through the untyped door as well: a homebrew item's honesty survives
    // the round trip, exactly as its grants do.
    expect(loaded.item('lenses-of-the-far-shore')?.unmodelled).toEqual([
      'you can see the far shore of any body of water you stand beside',
    ]);
  });

  /**
   * The two refusals `checkSpellDefinition` already makes about the same
   * field, made here in the same words: a note that is not a list declares
   * nothing readable, and an empty note declares nothing at all.
   */
  it('refuses a note that is not a list, and one that says nothing', () => {
    expect(codesOf({ ...LENSES, unmodelled: 'a string is not a list of notes' })).toEqual([
      'bad_unmodelled @ items[lenses-of-the-far-shore].unmodelled',
    ]);
    expect(codesOf({ ...LENSES, unmodelled: null })).toEqual([
      'bad_unmodelled @ items[lenses-of-the-far-shore].unmodelled',
    ]);
    expect(codesOf({ ...LENSES, unmodelled: ['   '] })).toEqual([
      'empty_note @ items[lenses-of-the-far-shore].unmodelled[0]',
    ]);
    expect(codesOf({ ...LENSES, unmodelled: [7] })).toEqual([
      'empty_note @ items[lenses-of-the-far-shore].unmodelled[0]',
    ]);
  });

  /** Absent is the answer for everything mundane, which is almost everything. */
  it('leaves an item that does everything its line says with nothing to declare', () => {
    const { unmodelled, ...silent } = LENSES;
    void unmodelled;
    expect(codesOf(silent)).toEqual([]);
    expect(SRD_CONTENT.item('longsword')?.unmodelled).toBeUndefined();
  });
});

/**
 * What an item says it casts, judged at the one door.
 *
 * SRD "Spells Cast from Items" makes a wand's Fireball an ordinary casting, so
 * the grant is a *route* to the pipeline rather than a second resolver — and a
 * route that names a spell nothing can resolve, a price nothing can pay or a
 * range with no bottom to it is an item whose line silently does nothing. Each
 * is refused by name, in the `bad_item_grant` shape the other item rules use.
 */
describe('an item that casts a spell says which, for what, and out of what', () => {
  /** A well-formed casting item, so each case below changes exactly one thing. */
  const WAND = {
    id: 'wand-of-sparks',
    name: 'Wand of Sparks',
    kind: 'wand',
    weightLb: 1,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      { kind: 'pool', key: 'wand-of-sparks:charges', label: 'Wand of Sparks charges', uses: 5, recovers: 'dawn' },
      { kind: 'casts', spell: 'ember-lash', charges: 1, upToCharges: 3, saveDc: 14 },
    ],
  };

  const EMBER_LASH = {
    id: 'ember-lash',
    name: 'Ember Lash',
    level: 1,
    school: 'evocation',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 1 },
    effects: [{ kind: 'attack', attack: 'ranged', damage: { dice: '2d6' }, damageType: 'fire' }],
  };

  const problemsOf = (grants: unknown): readonly string[] =>
    checkContent({
      spells: [EMBER_LASH as never],
      items: [{ ...WAND, grants } as unknown as CatalogueItem],
    }).map((problem) => `${problem.code} @ ${problem.field}`);

  const withCasts = (over: Record<string, unknown>): unknown => [
    WAND.grants[0],
    { ...WAND.grants[1], ...over },
  ];

  /**
   * The same casting grant with named fields **taken off** rather than
   * overwritten, because the cases below are about what an entry does not say.
   */
  const castsWithout = (
    drop: readonly string[],
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => {
    const grant: Record<string, unknown> = { ...WAND.grants[1], ...over };
    for (const field of drop) delete grant[field];
    return grant;
  };

  it('accepts a wand that casts a spell the catalogue holds', () => {
    expect(problemsOf(WAND.grants)).toEqual([]);
    const loaded = unwrap(
      loadContent({ spells: [EMBER_LASH], items: [JSON.parse(JSON.stringify(WAND))] }),
      'load',
    );
    const grants = loaded.item('wand-of-sparks')?.grants ?? [];
    expect(grants[1]).toEqual({
      kind: 'casts',
      spell: 'ember-lash',
      charges: 1,
      upToCharges: 3,
      saveDc: 14,
    });
  });

  it('refuses a spell this content cannot resolve', () => {
    expect(problemsOf(withCasts({ spell: 'ember-flail' }))).toEqual([
      'unknown_spell @ items[wand-of-sparks].grants[1].spell',
    ]);
    expect(problemsOf(withCasts({ spell: '  ' }))).toEqual([
      'bad_item_spell @ items[wand-of-sparks].grants[1].spell',
    ]);
  });

  it('refuses two prices for one casting', () => {
    expect(problemsOf([...(WAND.grants as unknown[]), WAND.grants[1]])).toEqual([
      'two_item_castings @ items[wand-of-sparks].grants[2].spell',
    ]);
  });

  it('refuses a price that is not a price, and a range with nothing above it', () => {
    expect(problemsOf(withCasts({ charges: 0 }))).toEqual([
      'bad_charge_cost @ items[wand-of-sparks].grants[1].charges',
    ]);
    expect(problemsOf(withCasts({ upToCharges: 1 }))).toEqual([
      'bad_charge_range @ items[wand-of-sparks].grants[1].upToCharges',
    ]);
    expect(problemsOf(withCasts({ level: 11 }))).toEqual([
      'bad_level @ items[wand-of-sparks].grants[1].level',
    ]);
    expect(problemsOf(withCasts({ saveDc: 'fifteen' }))).toEqual([
      'bad_printed_number @ items[wand-of-sparks].grants[1].saveDc',
    ]);
  });

  /**
   * The charges come out of the item's own pool, and an item that casts for a
   * price and declares no pool is an economy with nothing behind it.
   */
  it('refuses an item that casts for charges it does not have', () => {
    expect(problemsOf([WAND.grants[1]])).toEqual([
      'casts_without_charges @ items[wand-of-sparks].grants[0].charges',
    ]);
  });

  /**
   * SRD Helm of Comprehending Languages: "While wearing this helm, you can
   * cast _Comprehend Languages_ from it." No charge count, no per-dawn
   * sentence, no limit at all — so the item has to be able to say that the
   * book charges nothing for its casting, and `atWill` is where it says so.
   *
   * **The licence is written down rather than inferred**, which is why the
   * absence of a cost is still a refusal on its own: a grant that names
   * neither a price nor `atWill` is exactly what a malformed entry looks like,
   * and reading it as free would make every typo a free casting.
   */
  it('refuses a casting that names neither a price nor a licence to be free', () => {
    expect(problemsOf([WAND.grants[0], castsWithout(['charges', 'upToCharges'])])).toEqual([
      'casts_for_no_price @ items[wand-of-sparks].grants[1].charges',
    ]);
  });

  /** And the other way round: a price and a licence to be free is two answers. */
  it('refuses a casting that is both priced and at will', () => {
    expect(
      problemsOf([WAND.grants[0], castsWithout(['upToCharges'], { atWill: true })]),
    ).toEqual(['at_will_and_a_price @ items[wand-of-sparks].grants[1].atWill']);
  });

  /**
   * "You can expend no more than 3 charges" is a range of prices, and an
   * at-will casting has none for it to be a range of.
   */
  it('refuses a charge range on a casting that spends no charges', () => {
    expect(problemsOf([WAND.grants[0], castsWithout(['charges'], { atWill: true })])).toEqual([
      'at_will_and_a_charge_range @ items[wand-of-sparks].grants[1].upToCharges',
    ]);
  });

  /** An at-will casting needs no pool, which is the whole of what it claims. */
  it('accepts an at-will casting with no charge pool behind it', () => {
    expect(problemsOf([castsWithout(['charges', 'upToCharges'], { atWill: true })])).toEqual([]);
  });

  /**
   * SRD Ring of Jumping: "you can cast _Jump_ from it, but can target only
   * yourself when you do so." A narrowing the item prints, accepted on any
   * casting grant — the spell's own rule still runs, and this runs after it.
   */
  it('accepts the narrowing an item prints on its own casting', () => {
    expect(problemsOf(withCasts({ targetsSelfOnly: true }))).toEqual([]);
  });
});

/**
 * What an item's **conferral** costs, judged at the same door.
 *
 * SRD prints the price of a use on the item's own line — "you can expend up to
 * 3 charges" — and until now a conferral could not name one at all: an item
 * that confers was an item that is used up. A staff is not, so the price is
 * read, and the rules it is held to are the ones a `casts` grant's price is
 * already held to, asked of a second host rather than spelled a second way.
 */
describe('an item that confers for a price says what it costs, and out of what', () => {
  /** A well-formed charged conferral, so each case changes exactly one thing. */
  const POOL = {
    kind: 'pool',
    key: 'rod-of-small-mending:charges',
    label: 'Rod of Small Mending charges',
    uses: 3,
    recovers: 'dawn',
  };
  const CONFERS = {
    kind: 'confers',
    action: 'action',
    charges: 1,
    effects: [{ kind: 'heal', healing: { dice: '1d4' }, addSpellcastingModifier: false }],
  };
  const ROD = {
    id: 'rod-of-small-mending',
    name: 'Rod of Small Mending',
    kind: 'rod',
    weightLb: 2,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [POOL, CONFERS],
  };

  const problemsOf = (grants: unknown): readonly string[] =>
    checkContent({ items: [{ ...ROD, grants } as unknown as CatalogueItem] }).map(
      (problem) => `${problem.code} @ ${problem.field}`,
    );

  /** The conferral with named fields changed, the pool left where it is. */
  const confers = (over: Record<string, unknown>): unknown => [POOL, { ...CONFERS, ...over }];

  /** The same, with named fields taken off: these cases are about silence. */
  const confersWithout = (
    drop: readonly string[],
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => {
    const grant: Record<string, unknown> = { ...CONFERS, ...over };
    for (const field of drop) delete grant[field];
    return grant;
  };

  it('accepts a conferral priced in the item’s own charges', () => {
    expect(problemsOf(ROD.grants)).toEqual([]);
    const loaded = unwrap(loadContent({ items: [JSON.parse(JSON.stringify(ROD))] }), 'load');
    expect((loaded.item('rod-of-small-mending')?.grants ?? [])[1]).toMatchObject({ charges: 1 });
  });

  /** The rule a `casts` grant's price keeps: a whole number of at least one. */
  it('refuses a price that is not a price', () => {
    expect(problemsOf(confers({ charges: 0 }))).toEqual([
      'bad_conferral_charge_cost @ items[rod-of-small-mending].grants[1].charges',
    ]);
    expect(problemsOf(confers({ charges: 1.5 }))).toEqual([
      'bad_conferral_charge_cost @ items[rod-of-small-mending].grants[1].charges',
    ]);
    expect(problemsOf(confers({ charges: 'one' }))).toEqual([
      'bad_conferral_charge_cost @ items[rod-of-small-mending].grants[1].charges',
    ]);
  });

  /**
   * "You can expend up to 3 charges" is a maximum above the cost, which is the
   * shape a Wand of Fireballs already prints over a casting.
   */
  it('refuses a maximum that is not above the cost', () => {
    expect(problemsOf(confers({ upToCharges: 1 }))).toEqual([
      'bad_conferral_charge_range @ items[rod-of-small-mending].grants[1].upToCharges',
    ]);
    expect(problemsOf(confers({ upToCharges: 2.5 }))).toEqual([
      'bad_conferral_charge_range @ items[rod-of-small-mending].grants[1].upToCharges',
    ]);
    expect(problemsOf(confers({ upToCharges: 3 }))).toEqual([]);
  });

  /** And a range over no price at all, which is a maximum above nothing. */
  it('refuses a maximum on a conferral that costs nothing', () => {
    expect(problemsOf([POOL, confersWithout(['charges'], { upToCharges: 3 })])).toEqual([
      'conferral_range_without_a_price @ items[rod-of-small-mending].grants[1].upToCharges',
    ]);
  });

  /**
   * The charges come out of the item's own pool — the same economy with
   * nothing behind it that `casts_without_charges` refuses one grant along.
   */
  it('refuses an item that confers for charges it does not have', () => {
    expect(problemsOf([CONFERS])).toEqual([
      'confers_without_charges @ items[rod-of-small-mending].grants[0].charges',
    ]);
  });

  /**
   * **A potion names no price and acquires no pool.** SRD's common case is an
   * item that is used up, and nothing about reading the price changes it.
   */
  it('accepts a conferral that names no price and declares no pool', () => {
    expect(problemsOf([confersWithout(['charges'])])).toEqual([]);
  });
});

describe('the clause that was a comment is now countable', () => {
  /**
   * SRD Cloak of Elvenkind: "While you wear this cloak, Wisdom (Perception)
   * checks made to perceive you have Disadvantage, and you have Advantage on
   * Dexterity (Stealth) checks."
   *
   * The Stealth half is a `roll-mode` grant. The Perception half is a mode on
   * rolls made *against* the wearer, and `against-holder` is legal only on an
   * attack roll — an attack is the one D20 Test the engine records a target
   * for — so "checks made to perceive you" cannot be picked out at all.
   */
  it('names the half of the Cloak of Elvenkind the engine does not do', () => {
    const cloak = SRD_CONTENT.item('cloak-of-elvenkind');
    expect(cloak?.grants).toHaveLength(1);
    expect(cloak?.unmodelled?.join(' ')).toMatch(/Perception/);
  });
});
