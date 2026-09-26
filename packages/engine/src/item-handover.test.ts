import { describe, expect, it } from 'vitest';
import { expect as unwrap } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import { checkContent, loadContent } from './content.js';
import { DM_DECIDES } from './spell-definitions.js';

/**
 * What an item hands to the table, kept apart from what it owes.
 *
 * `SpellDefinition.dmDecides` has carried this for spells since the owner
 * ruled that some text is the DM's alone, and `docs/design/content.md` states
 * the test that sorts a sentence into one list or the other: **a table fact
 * that a rule then reads is a debt; a table fact nothing reads afterwards is a
 * handover.** An item had only the first list, so a cube whose one remaining
 * note is what its faces look like stood on the road to zero forever, waiting
 * for a mechanism nobody should build.
 *
 * The field is vocabulary, not mechanism: nothing branches on it. What the
 * door judges is the same as for a spell — a handover is prose, a sentence is
 * in one list and never both, and the mark a handed-over sentence goes out
 * under is written by the engine and by nobody else.
 */

const codesOf = (item: unknown): readonly string[] =>
  checkContent({ items: [item as CatalogueItem] }).map(
    (problem) => `${problem.code} @ ${problem.field}`,
  );

/** A homebrew item whose only unexecuted text is the table's. */
const TIDE_BELL = {
  id: 'tide-bell',
  name: 'Tide Bell',
  kind: 'wondrous',
  weightLb: 1,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'flat-bonus', applies: ['ac'], flat: 1 }],
      requires: [{ kind: 'while-worn' }],
    },
  ],
  dmDecides: ['When rung, the bell sounds like surf on a far shore.'],
};

const WHERE = 'items[tide-bell]';

describe('an item hands the table what no rule reads, in a list of its own', () => {
  it('accepts a handover beside the grants it executes, and carries it through the untyped door', () => {
    expect(codesOf(TIDE_BELL)).toEqual([]);
    const loaded = unwrap(
      loadContent({ items: [JSON.parse(JSON.stringify(TIDE_BELL))] }),
      'load',
    );
    expect(loaded.item('tide-bell')?.dmDecides).toEqual([
      'When rung, the bell sounds like surf on a far shore.',
    ]);
    // And the round trip is the whole of it: what went in as JSON comes back
    // out as the same JSON.
    expect(JSON.parse(JSON.stringify(loaded.item('tide-bell')))).toEqual(TIDE_BELL);
  });

  it('refuses a handover that is not a list, and one that hands nothing over', () => {
    expect(codesOf({ ...TIDE_BELL, dmDecides: 'a string is not a list' })).toEqual([
      `bad_dm_decides @ ${WHERE}.dmDecides`,
    ]);
    expect(codesOf({ ...TIDE_BELL, dmDecides: null })).toEqual([
      `bad_dm_decides @ ${WHERE}.dmDecides`,
    ]);
    expect(codesOf({ ...TIDE_BELL, dmDecides: ['  '] })).toEqual([
      `empty_note @ ${WHERE}.dmDecides[0]`,
    ]);
    expect(codesOf({ ...TIDE_BELL, dmDecides: [3] })).toEqual([`empty_note @ ${WHERE}.dmDecides[0]`]);
  });

  /**
   * One sentence, two claims. Filed in both lists it is at once a debt the
   * blocker map ranks and a decision nobody may build — which is the one
   * thing the second list exists to stop being true of a sentence.
   */
  it('refuses a sentence that is filed as a debt and handed over at once', () => {
    const sentence = 'When rung, the bell sounds like surf on a far shore.';
    expect(codesOf({ ...TIDE_BELL, unmodelled: [sentence] })).toEqual([
      `debt_and_handover @ ${WHERE}.dmDecides[0]`,
    ]);
    // Quoted inside a longer note is still the same sentence in both lists.
    expect(
      codesOf({ ...TIDE_BELL, unmodelled: [`the ring: "${sentence.toLowerCase()}" — sound is not held`] }),
    ).toEqual([`debt_and_handover @ ${WHERE}.dmDecides[0]`]);
    // A debt about some other sentence is not a collision.
    expect(
      codesOf({ ...TIDE_BELL, unmodelled: ['"the bell deafens whoever rings it": nothing deafens'] }),
    ).toEqual([]);
  });

  /**
   * The mark is `handedOver`'s to write, as it is for a spell: a handover that
   * carries it reaches the table with the mark still in the text, and a debt
   * that carries it reads as a decision to every reader of `unverified`.
   */
  it('refuses the mark written by hand, in either list', () => {
    expect(codesOf({ ...TIDE_BELL, dmDecides: [`${DM_DECIDES} the bell's voice`] })).toEqual([
      `forged_dm_mark @ ${WHERE}.dmDecides[0]`,
    ]);
    expect(codesOf({ ...TIDE_BELL, unmodelled: [`${DM_DECIDES} the bell deafens nobody`] })).toEqual([
      `forged_dm_mark @ ${WHERE}.unmodelled[0]`,
    ]);
  });

  it('leaves an item with nothing to hand over with nothing to declare', () => {
    const { dmDecides, ...silent } = TIDE_BELL;
    void dmDecides;
    expect(codesOf(silent)).toEqual([]);
  });
});
