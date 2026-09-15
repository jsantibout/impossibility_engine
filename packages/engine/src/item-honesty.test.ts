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
