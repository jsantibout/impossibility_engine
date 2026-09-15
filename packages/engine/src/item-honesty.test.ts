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
