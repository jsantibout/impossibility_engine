import { describe, expect, it } from 'vitest';
import {
  ADJUDICATED,
  BLOCKED_ON,
  ITEM_SHAPES,
  MISSING_SHAPES,
  SPLIT_BUNDLES,
  TRACKED_ADJUDICATED,
  claimedShapes,
  misanchoredAdjudications,
} from '../scripts/missing-shapes.js';
import { FEATURE_SHAPES } from '../scripts/missing-feature-shapes.js';
import { spellShapesOf } from '../scripts/ledger.js';

/**
 * `why` names a shape in **any** of the three maps.
 *
 * The field has now been too narrow three times, and each widening was the
 * same discovery arriving from a different book: Remove Curse's attunement is
 * an `ItemShapeId`, Hex is `'expressible'`, and the three spells gate G1 filed
 * under an action nobody can spend want `an-action-the-engine-has-no-spender-
 * for`, which is a **feature** shape. The owner's disposition is the general
 * form rather than a fourth enumeration, so this file holds what the general
 * form has to be true for.
 *
 * Three claims, and the first is the one the type rests on.
 *
 * | | |
 * |---|---|
 * | the three id spaces are **disjoint** | a string that named a shape in two maps would make `why` ambiguous, and every consumer would resolve it by whichever map it happened to look in first |
 * | the three words are still not shapes | `'table'`, `'engine'` and `'expressible'` are claims about the clause rather than about the vocabulary, and the ledger drops all three |
 * | every guard P2-T0 shipped still bites | a widening that quietly relaxed the anchoring rules would buy the field's reach with the map's honesty |
 */

const SPELL = Object.keys(MISSING_SHAPES);
const ITEM = Object.keys(ITEM_SHAPES);
const FEATURE = Object.keys(FEATURE_SHAPES);

describe('the three shape vocabularies are one id space', () => {
  /**
   * **Verified before the union was written, not after.** If two maps ever
   * spelled one gap the same way, the honest answer is to stop and say so
   * rather than to pick a map — a `why` resolving to the wrong vocabulary
   * would file a debt against a gap that is not the one the reader meant,
   * with every other guard still green.
   */
  it.each([
    ['spell', 'item', SPELL, ITEM],
    ['spell', 'feature', SPELL, FEATURE],
    ['item', 'feature', ITEM, FEATURE],
  ] as const)('keeps the %s and %s ids apart', (_a, _b, left, right) => {
    const shared = left.filter((id) => right.includes(id));
    expect(shared).toEqual([]);
  });

  /** And all three are non-empty, so the assertion above is not vacuous. */
  it('has three vocabularies to keep apart', () => {
    for (const map of [SPELL, ITEM, FEATURE]) expect(map.length).toBeGreaterThan(0);
  });
});

describe('a spell may name a shape in any book', () => {
  const known = new Set([...SPELL, ...ITEM, ...FEATURE]);
  const WORDS = ['table', 'engine', 'expressible'];

  it.each([
    ['executed', ADJUDICATED],
    ['tracked', TRACKED_ADJUDICATED],
  ] as const)('files every %s clause against a word or a real shape', (_name, map) => {
    for (const [spellId, entries] of Object.entries(map)) {
      for (const entry of entries) {
        if (WORDS.includes(entry.why)) continue;
        expect(known.has(entry.why), `${spellId}/${entry.clause}`).toBe(true);
      }
    }
  });

  /**
   * The spells gate G1 read as mis-filed, now filed where it said.
   *
   * Gaseous Form forbids talking and handling objects, which is Utilize, and
   * Haste's extra action may be spent on a Utilize among four others.
   * `NAMED_ACTIONS` leaves both out because no spender could be told apart as
   * having taken one, which is exactly what the feature vocabulary's
   * `an-action-the-engine-has-no-spender-for` says. **Both have since left**,
   * and the assertions below say how.
   *
   * **Speak with Animals was the third and has left**, which is the assertion
   * below it. G1 filed it here on the reading that the Influence action had no
   * spender; `takeInfluence` is one, has never narrowed by the target's
   * creature type, and so an Influence attempt on a Beast was always legal and
   * always rolled. There was never anything for the spell to widen, and what
   * it buys — that the Beast understands — is speech. Handed over on
   * 2026-09-24, with the departure asserted rather than the row quietly
   * deleted.
   */
  it('files the actions nobody can spend against the feature shape', () => {
    const filed = (map: Record<string, readonly { why: string; clause: string }[]>, id: string) =>
      (map[id] ?? []).map((entry) => entry.why);

    expect(filed(TRACKED_ADJUDICATED, 'speak-with-animals')).toEqual(['table']);
    // **Gaseous Form has left, on the owner's ruling of 2026-09-26.** Handling
    // objects was always `forbids.objects`, and what stayed filed here was
    // "The target can't talk": talking is no action anything spends, and it
    // sits in the one sentence with the object clauses the engine enforces, so
    // the reading was that it could not go to the table by half. The owner
    // overruled it — the sentence is handed over whole, under the DM mark —
    // and the spell files nothing under any shape. Asserted rather than the
    // row quietly deleted.
    expect(filed(ADJUDICATED, 'gaseous-form')).not.toContain(
      'an-action-the-engine-has-no-spender-for',
    );
    expect(filed(ADJUDICATED, 'gaseous-form')).toEqual([]);
    // **And Haste has left too, on the same reading and by the same door.**
    // It was filed here because the note said Utilize was an action no
    // spender could be told apart as having taken. `takeUtilize` is one and
    // `NAMED_ACTIONS` holds it, so `GrantedAction.only` names all five the
    // book prints and the narrowing is enforced. Asserted rather than the row
    // quietly deleted.
    expect(filed(ADJUDICATED, 'haste')).not.toContain('an-action-the-engine-has-no-spender-for');
    // The shape was claimed across books, which is what the widening was for:
    // the query counted a spell's claim on a feature's gap. With Gaseous Form
    // gone nothing claims it, so the guard that keeps no unclaimed shape has
    // deleted it from the vocabulary — the widening still stands, and is
    // asserted below of the three books' ids rather than of this one.
    expect(claimedShapes().has('an-action-the-engine-has-no-spender-for')).toBe(false);
    expect(Object.keys(MISSING_SHAPES)).not.toContain('an-action-the-engine-has-no-spender-for');
  });

  /**
   * **Haste was two debts in one clause, filed as two — and the split is what
   * let one of them be paid on its own.**
   *
   * The extra action itself was the arm with no destination; `ActionRule`
   * grew the member that creates one, and the clause is not an adjudication
   * any more. Had the entry been re-filed whole onto the narrowing, this batch
   * would have finished the larger half of Haste's sentence and the map would
   * have gone on saying the spell was blocked on the same thing it had always
   * been blocked on.
   *
   * **And the smaller half has since been paid too**, which is what the split
   * was worth: the narrowing was filed on its own, the reason it was filed
   * turned out to be one stale sentence about Utilize having no spender, and
   * paying it moved nothing else.
   *
   * **And the parenthesis is paid now as well, which is the third and last
   * arm** — so the spell files nothing at all. "(one attack only)" was the
   * count of attacks inside one Attack action, and it was never the same number
   * as SRD Slow's: this one narrows the action the spell *hands over*
   * (`GrantedAction.attacksCap`) and Slow's stands on the creature
   * (`ActionRule`'s `caps-attacks`), so a hasted Fighter swings twice on their
   * own Attack action and once on Haste's. Had the two been filed as one clause
   * and paid with one field, one of them would have been wrong in the direction
   * nothing measures.
   */
  it('paid all three arms it had split out, the parenthesis last', () => {
    const filed = (ADJUDICATED['haste'] ?? []).map((entry) => entry.why);
    expect(filed).not.toContain('an-action-the-engine-has-no-spender-for');
    expect(filed).toEqual([]);
    // And SRD Slow's end of the same sentence went with it, by a second field
    // rather than by the same one.
    expect((ADJUDICATED['slow'] ?? []).map((entry) => entry.clause)).not.toContain(
      'it can make only one attack if it takes the Attack action',
    );
  });
});

describe('the widening bought no relaxation', () => {
  /**
   * `'expressible'` is still the third column and never a shape heading —
   * the failure the disposition that added it names by hand.
   */
  it('drops the three words from the shapes a spell waits on', () => {
    // **Read off the undefined map rather than the tracked one**, because Hex
    // was the tracked map's only `'expressible'` entry and it left when the
    // definition somebody had not written was written. The word is still a
    // `why` and still never a heading, which is what this asserts; where the
    // live example lives is not the claim.
    expect(
      (BLOCKED_ON['maze'] ?? []).some(
        (entry) => typeof entry !== 'string' && entry.why === 'expressible',
      ),
    ).toBe(true);
    expect(spellShapesOf('maze', 'no-definition')).not.toContain('expressible');
    // And the same of the other two, over the whole of both maps: a heading
    // in the report's shape table is a shape, never a claim about a clause.
    const headings = new Set(
      Object.keys(TRACKED_ADJUDICATED).flatMap((id) => spellShapesOf(id, 'tracked')),
    );
    for (const word of ['table', 'engine', 'expressible']) expect(headings.has(word)).toBe(false);
  });

  /**
   * And the anchoring rule is exactly as P2-T0 left it: a marker-less entry
   * may claim a missing shape or the table, and may not claim that the
   * engine reaches a sentence no marker can see.
   */
  it('still refuses a marker-less claim about the engine', () => {
    const complaints = (why: string) =>
      misanchoredAdjudications('speak-with-animals', [
        { marker: null, clause: 'skill options with them', why, note: 'a synthetic' },
      ] as never);

    expect(complaints('engine')).toHaveLength(1);
    expect(complaints('expressible')).toHaveLength(1);
    // A shape in any of the three books is a claim a reader can re-run, so
    // all three are permitted — and so is the table.
    expect(complaints('table')).toEqual([]);
    // The feature book's example was `an-action-the-engine-has-no-spender-for`
    // until that id left the vocabulary (2026-09-26); a live feature shape
    // stands in for it, and the item book has one of its own.
    expect(complaints('an-action-rule-a-feature-holds')).toEqual([]);
    expect(complaints('what-ends-attunement-besides-a-command')).toEqual([]);
    expect(complaints('a-fact-only-the-table-can-declare')).toEqual([]);
  });
});

describe('the bundle that could not be split until now', () => {
  const BUNDLE = 'an-action-a-spell-compels-or-forbids';

  /**
   * P2-T0 could not write this record because the split had one destination
   * and a split needs more than one — `blocked-on.test.ts` asserts that of
   * every bundle. The `why` widening is the second destination.
   */
  it('records what left the bundle, and where it went', () => {
    const split = SPLIT_BUNDLES[BUNDLE];
    expect(split, `${BUNDLE} has no record`).toBeDefined();
    expect(new Set(split!.held.map(([, , wentTo]) => wentTo)).size).toBeGreaterThan(1);
    expect(split!.held.map(([, , wentTo]) => wentTo)).toContain(
      'an-action-the-engine-has-no-spender-for',
    );
  });

  /**
   * And the bundle id itself survives, narrowed, which is
   * `a-mode-on-the-save-a-spell-forces`' precedent: the audit found the
   * *description* misstated its own blocker, not that the mechanism was
   * imaginary. What is left under it is the arms G1 counted and nobody has
   * built.
   */
  it('leaves the arms that have nowhere to go filed where they were', () => {
    expect(Object.keys(MISSING_SHAPES)).toContain(BUNDLE);
    expect(claimedShapes().has(BUNDLE)).toBe(true);
  });
});
