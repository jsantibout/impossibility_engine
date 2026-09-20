import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CITATION_FLOOR,
  misquotes as misquotedIn,
  namesIn,
  quotedRunsIn,
  type Citation,
  type CitedSource,
} from '../scripts/citations.js';
import { ITEM_SHAPES, MISSING_SHAPES } from '../scripts/missing-shapes.js';
import {
  FEATURE_BLOCKED_ON,
  FEATURE_SHAPES,
  allFeatureShapeConsumers,
  claimedFeatureShapes,
  featureBlockersIn,
  featureBlockersOf,
  featureClausesIn,
  featureConsumersOf,
  featureCoverageGaps,
  featureNoteOf,
  featuresBlockedByNothing,
  featuresTheTableOwns,
  knownFeatureBlockers,
  manualFeatureIds,
  unanchoredFeatureClauses,
  type FeatureEntry,
} from '../scripts/missing-feature-shapes.js';

/**
 * The manual features' blockers, asserted the way the undefined spells' and
 * the untranscribed items' are.
 *
 * `blocked-on.test.ts` exists because one family of spells was counted by hand
 * three times and came out 17, 4 and 2. `blocked-on-items.test.ts` exists
 * because the items were never counted at all. This one exists because the
 * features were counted **honestly** and read by nothing: every feature the
 * engine does not execute has carried a note saying what is missing since the
 * day it was transcribed, and those notes were the best evidence in the
 * repository about where the next mechanic should go, scattered across twelve
 * class files in whatever words fitted.
 *
 * The two guards the map is held with are the two the other maps are:
 *
 * - **a citation checked against the document it quotes**, in both directions
 *   — a shape description must name a document this repository already
 *   reviewed, and the run it quotes must be in that document. Here it is
 *   asked twice, because the map has two corpora: the shape descriptions
 *   against the design notes and the engine's own vocabulary files, and every
 *   clause against the **feature's own note**, which is the document the
 *   clause is a citation of.
 * - **no shape claimed by nothing**, which is what keeps a vocabulary from
 *   outliving the gap it named.
 */

const MANUAL = manualFeatureIds();

/** A real feature to hang synthetic readings on, chosen for a short note. */
const SPECIMEN = 'druid:druidic';

describe('the feature blocked-on map covers the manual population', () => {
  /**
   * The completeness guard, and it has to be able to fail.
   *
   * Parameterised over the population for `coverageGaps`'s own reason: a guard
   * that can only be run against the data it already agrees with is not a
   * guard.
   */
  it('reports a feature marked manual that nobody has adjudicated', () => {
    const synthetic = [...MANUAL, 'wizard:a-feature-nobody-read'];
    expect(featureCoverageGaps(synthetic).unrecorded).toEqual(['wizard:a-feature-nobody-read']);
  });

  /**
   * And the other direction, which is the case the *next* task will cause: a
   * feature converted to `engine` leaves a line behind, and the line has to go
   * with the conversion rather than a commit later.
   */
  it('reports a line for a feature that has since been executed', () => {
    const converted = MANUAL.filter((id) => id !== 'ranger:tireless');
    expect(featureCoverageGaps(converted).stale).toEqual(['ranger:tireless']);
  });

  /** Neither synthetic case is vacuous: the real corpus has no gap either way. */
  it('has a line for every manual feature and no line for anything else', () => {
    expect(featureCoverageGaps()).toEqual({ unrecorded: [], stale: [] });
  });

  /**
   * A population worth deriving, with the floor **below** it rather than on it.
   *
   * `blocked-on.test.ts` records what happens otherwise: it read `> 200`
   * against a map of exactly 201, so the next task to define two spells failed
   * a guard by succeeding. Conversions are the whole point of this map, so the
   * number here will fall; what this catches is a wrong predicate, a filter
   * that reads nothing, or a map that has quietly stopped being populated.
   */
  it('covers a population worth deriving', () => {
    expect(Object.keys(FEATURE_BLOCKED_ON).length).toBeGreaterThan(100);
  });

  /** In an order two branches can both append to, and the order is the data's. */
  it('names its entries in an order two branches can both append to', () => {
    const ids = Object.keys(FEATURE_BLOCKED_ON);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Every entry is read, which is the difference from the item map.
   *
   * There is no grandfathered form here: a hundred and sixty short notes this
   * repository wrote about itself is not two hundred SRD paragraphs nobody has
   * opened, so an entry that names no clause is a line somebody added without
   * reading anything.
   */
  it('carries at least one clause on every entry', () => {
    for (const [id, entry] of Object.entries(FEATURE_BLOCKED_ON)) {
      expect(featureClausesIn(entry).length, id).toBeGreaterThan(0);
    }
  });
});

describe('a clause names one thing the feature’s note says', () => {
  /** The anchoring guard, driven by a phrase the note says twice. */
  it('reports a phrase the note prints more than once', () => {
    const twice = unanchoredFeatureClauses('cleric:divine-order', [
      { clause: 'grants', why: 'table', note: 'synthetic' },
    ]);
    expect(twice).toEqual([
      { spell: 'cleric:divine-order', clause: 'grants', matches: 2 },
    ]);
  });

  /** And by one it prints nowhere, which is a reworded or invented sentence. */
  it('reports a phrase the note prints nowhere', () => {
    expect(
      unanchoredFeatureClauses(SPECIMEN, [
        { clause: 'a secret handshake and the doors it opens', why: 'table', note: 'synthetic' },
      ]),
    ).toEqual([
      { spell: SPECIMEN, clause: 'a secret handshake and the doors it opens', matches: 0 },
    ]);
  });

  /**
   * Typesetting is not wording, and the note is the side that carries it.
   *
   * The catalogue's prose uses curly apostrophes and this file's clauses are
   * written with whichever the author typed. `unanchoredWithin` normalises the
   * phrase and trusts the unit, so the note has to be flattened before it is
   * searched — which was wrong for eleven clauses the first time this ran, and
   * is asserted here rather than left to the corpus agreeing by luck.
   */
  it('matches a clause across the apostrophe the note is typeset with', () => {
    expect(featureNoteOf('barbarian:instinctive-pounce')).toContain('turn’s allowance');
    expect(
      unanchoredFeatureClauses('barbarian:instinctive-pounce', [
        { clause: "costs nothing out of the turn's allowance", why: 'table', note: 'synthetic' },
      ]),
    ).toEqual([]);
  });

  /** Neither case is vacuous: every clause in the real map anchors. */
  it('anchors every clause in the map', () => {
    for (const [id, entry] of Object.entries(FEATURE_BLOCKED_ON)) {
      expect(unanchoredFeatureClauses(id, entry), id).toEqual([]);
    }
  });

  /** A clause that is neither the table's nor expressible names an enumerated shape. */
  it('names an enumerated shape for every clause that is neither', () => {
    const known = knownFeatureBlockers();
    for (const [id, entry] of Object.entries(FEATURE_BLOCKED_ON)) {
      for (const clause of featureClausesIn(entry)) {
        if (clause.why === 'table' || clause.why === 'expressible') continue;
        expect(known.has(clause.why), `${id} names ${clause.why}`).toBe(true);
      }
      expect(featureBlockersIn(entry).filter((shape) => !known.has(shape)), id).toEqual([]);
    }
  });

  /** Every clause says something: a note field nobody wrote is not an adjudication. */
  it('writes a real note against every clause', () => {
    for (const [id, entry] of Object.entries(FEATURE_BLOCKED_ON)) {
      for (const clause of featureClausesIn(entry)) {
        expect(clause.note.length, `${id}: ${clause.clause}`).toBeGreaterThan(20);
      }
    }
  });
});

describe('a shape nobody consumes reports itself', () => {
  /**
   * The unclaimed-shape guard, asked of the feature vocabulary alone.
   *
   * Asked of all three together it would pass on a spell's claim, which is how
   * a shape stays in a map after the last thing needing it has moved. The
   * other two vocabularies keep their own guards over their own populations,
   * and a feature claiming a spell shape does not satisfy either — so no list
   * can quietly keep a dead id alive through another.
   */
  it('keeps no feature shape nothing is blocked on', () => {
    const claimed = claimedFeatureShapes();
    expect(Object.keys(FEATURE_SHAPES).filter((shape) => !claimed.has(shape))).toEqual([]);
  });

  /** And nothing claims a shape none of the three vocabularies has. */
  it('has a vocabulary that covers every feature claim', () => {
    const known = knownFeatureBlockers();
    expect([...claimedFeatureShapes()].filter((shape) => !known.has(shape))).toEqual([]);
  });

  /**
   * The reuse is real rather than claimed: features are blocked on spell and
   * item shapes.
   *
   * The instruction this vocabulary was written under was to reuse the other
   * two wherever the gap is the same one, and a vocabulary that quietly did
   * not would look exactly like one that did. So the query is asked: Slow Fall
   * waits on the same missing mechanic Feather Fall does, a Dragon Companion
   * on the same summons Arcane Hand does, and a Wish that Divine Intervention
   * cannot reach is a spell nothing defines.
   */
  it('files a feature under a spell or item shape where the gap is the same one', () => {
    expect(featureBlockersOf('monk:slow-fall')).toEqual(['falling']);
    expect(featureBlockersOf('draconic-sorcery:dragon-companion')).toEqual([
      'a-stat-block-created-mid-fight',
    ]);
    expect(featureBlockersOf('cleric:greater-divine-intervention')).toEqual([
      'a-spell-an-item-casts-that-nothing-executes',
    ]);

    const spellShapes = new Set<string>(Object.keys(MISSING_SHAPES));
    const itemShapes = new Set<string>(Object.keys(ITEM_SHAPES));
    const claimed = [...claimedFeatureShapes()];
    expect(claimed.filter((shape) => spellShapes.has(shape)).length).toBeGreaterThan(10);
    expect(claimed.filter((shape) => itemShapes.has(shape)).length).toBeGreaterThan(1);
  });
});

describe('what a shape finishes is the column a tranche is planned from', () => {
  it('never claims to finish a feature it does not block', () => {
    for (const row of allFeatureShapeConsumers()) {
      for (const id of row.finishes) {
        expect(row.blocks, row.shape).toContain(id);
        expect(featureBlockersOf(id), id).toEqual([row.shape]);
      }
    }
  });

  /**
   * And blocks is the larger number, which is the whole reason both are
   * printed.
   *
   * A shape that touches ten features and finishes three is worth knowing
   * about differently from one that touches three and finishes three, and
   * reporting only one of the two is how a family came to be ranked three
   * ways in three documents.
   */
  it('has shapes whose two columns differ', () => {
    const rows = allFeatureShapeConsumers();
    for (const row of rows) expect(row.finishes.length).toBeLessThanOrEqual(row.blocks.length);
    expect(rows.some((row) => row.finishes.length < row.blocks.length)).toBe(true);
    expect(rows.some((row) => row.finishes.length === 0 && row.blocks.length > 1)).toBe(true);
  });

  /**
   * The finding that planned the first batch, what reading the book did to
   * it, and what building it did next.
   *
   * Reading a hundred and sixty notes put two shapes at the top — an Ability
   * Score Improvement the engine could only take as a feat, and an Epic Boon
   * whose one mechanical sentence raised a score past 20 — and they were
   * ranked apart because nobody had opened `classes.md` beside `feats.md`.
   * They were one shape and it was neither of those: SRD prints both
   * sentences on **the feat the class feature grants**, so what stood in the
   * way was that nothing read a grant off a feat.
   *
   * All three ids are gone now. The engine vocabulary the first two asked for
   * was built and the two capstones use it; the third was the host, and the
   * host exists — a feat asks which scores, gates on a level, and has its
   * grant read — so the catalogue publishes the Improvement feat and the
   * seven Epic Boons and every clause that named the shape reads
   * `expressible`.
   */
  it('has retired all three advancement shapes, the host last', () => {
    for (const shape of [
      'an-ability-score-an-advancement-raises',
      'an-ability-score-maximum-above-20',
      'a-grant-read-off-a-feat',
    ]) {
      expect(Object.keys(FEATURE_SHAPES)).not.toContain(shape);
      expect(claimedFeatureShapes().has(shape)).toBe(false);
    }

    /**
     * And the twenty-four entries are gone with them, which is the last half
     * of the same retirement. They stayed one batch longer than the shapes
     * did — each still carrying `automation: 'manual'` and a note written
     * when the host was missing — because a line saying "nothing blocks this"
     * is the honest record of a feature nobody had transcribed yet. The
     * transcription landed: every Improvement and every Epic Boon declares
     * `engine`, so the coverage guard wants no line and a line would be
     * {@link featureCoverageGaps}'s `stale`.
     */
    const advancement = Object.keys(FEATURE_BLOCKED_ON).filter(
      (id) => id.includes(':ability-score-improvement') || id.endsWith(':epic-boon'),
    );
    expect(advancement).toEqual([]);
    expect(MANUAL.filter((id) => id.endsWith(':epic-boon'))).toEqual([]);
    expect(MANUAL.filter((id) => id.includes(':ability-score-improvement'))).toEqual([]);

    // And the two that really do carry the sentence on the feature are
    // executed, so they left the map rather than moving to a new id.
    for (const id of ['barbarian:primal-champion', 'monk:body-and-mind']) {
      expect(FEATURE_BLOCKED_ON[id]).toBeUndefined();
      expect(MANUAL).not.toContain(id);
    }
  });

  /**
   * The claim that ranked weapon mastery first, what reading the book did to
   * it, and where it ended.
   *
   * It said blocks 6 / finishes 6 — the only shape on the map that finished
   * every feature it touched — and two batches were sized off that number. A
   * builder found it wrong in the direction a ranking is least able to survive:
   * the shape was one **entry** per feature where the feature's own paragraphs
   * name four different mechanics, so it blocked six and finished none.
   *
   * | | |
   * |---|---|
   * | the record, and Cleave, Graze, Push, Slow, Topple | `a-weapon-mastery-property` |
   * | Sap and Vex, each a modifier consumed by the roll it changes | `a-one-shot-roll-modifier` |
   * | Nick, which redirects an extra attack the Attack action does not hold | `an-attack-the-class-redefines` |
   * | "change one of those weapon choices" after a Long Rest | `an-option-re-chosen-on-a-rest` |
   *
   * **Three of the four landed together**, and that is why the shape is gone
   * rather than smaller. The record was built with the properties that hang off
   * it, and Sap and Vex followed in the same breath, because what they were
   * waiting on was never the mechanism — `oneShot` and `counterpart` were built
   * for Guiding Bolt and Vicious Mockery — but the record itself. So the six
   * features are `engine` now and carry no line here: what is left of each of
   * them is Nick and the Long Rest re-choice, which live in the feature's own
   * note exactly as every other partly-executed feature's do, and the two
   * shapes that name them are claimed by nine features apiece without these.
   */
  it('has retired the mastery shape rather than shrinking it', () => {
    const six = [
      'barbarian:weapon-mastery',
      'fighter:tactical-master',
      'fighter:weapon-mastery',
      'paladin:weapon-mastery',
      'ranger:weapon-mastery',
      'rogue:weapon-mastery',
    ];
    for (const id of six) {
      expect(FEATURE_BLOCKED_ON[id], id).toBeUndefined();
      expect(MANUAL, id).not.toContain(id);
    }

    // A shape nothing claims is removed rather than kept as a private
    // language, which is the rule the spell map wrote and this one inherited.
    expect(Object.keys(FEATURE_SHAPES)).not.toContain('a-weapon-mastery-property');
    const ranked = allFeatureShapeConsumers();
    expect(ranked.map((row) => row.shape)).not.toContain('a-weapon-mastery-property');

    // The leader a tranche is sized from, pinned rather than left derived: it
    // is the number the next batch is planned against, and a ranking nobody
    // asserts is one nobody notices going wrong.
    expect(ranked[0]?.shape).toBe('a-casting-paid-for-out-of-a-feature-pool');

    // And the two shapes the remaining clauses belong to are still claimed, by
    // features that have nothing to do with a weapon's mastery property.
    expect(featureConsumersOf('an-attack-the-class-redefines').blocks.length).toBeGreaterThan(0);
    expect(featureConsumersOf('an-option-re-chosen-on-a-rest').blocks.length).toBeGreaterThan(0);
    for (const id of six) {
      expect(featureConsumersOf('a-one-shot-roll-modifier').blocks, id).not.toContain(id);
    }
  });

  /**
   * The second shape to be ranked joint-first and turn out to be one id over
   * four different gaps — and the first to be re-filed *without* anything
   * being built.
   *
   * It read blocks 10 / finishes 4, which is how a batch came to brief four
   * features off it as a transcription track. A builder read the mechanism
   * instead and found the entries did not share a blocker at all — and that
   * **the ten were never ten allowances**: the clauses filed there were not
   * all `ActionRule` clauses. What they shared was a *sentence about the
   * action economy*, and the engine refuses those in four unrelated places:
   *
   * | | |
   * |---|---|
   * | the rule is writable and a feature has nowhere to hold it | `an-action-rule-a-feature-holds` |
   * | the action has no spender, so no rule could name it | `an-action-the-engine-has-no-spender-for` |
   * | the rule is writable and only one command will be asked for the price | `a-cheaper-price-only-one-command-offers` |
   * | the rule is not writable at all, by a spell either | `an-action-a-spell-compels-or-forbids` |
   *
   * The fourth row is the borrowed spell id doing what a borrowed id is for:
   * what stays on it is exactly the residue that description already names —
   * an extra action granted rather than an existing one governed, and a rule
   * that couples slots — which is a gap a casting has too.
   *
   * A fifth entry left the subject altogether. Steady Aim was here for its
   * "haven't moved" gate, and a gate is a field on the Bonus Action a feature
   * has no way to spend — which is the moment `a-one-shot-roll-modifier`
   * already names one entry above. So it is not an action-rule feature at
   * all, and moving it is what takes that shape's *finishes* column to two.
   */
  it('splits the action-economy shape into the four gaps it was standing for', () => {
    expect(featureConsumersOf('an-action-rule-a-feature-holds')).toEqual({
      shape: 'an-action-rule-a-feature-holds',
      blocks: ['barbarian:improved-brutal-strike', 'rogue:cunning-action'],
      finishes: [],
    });
    expect(featureConsumersOf('a-one-shot-roll-modifier')).toEqual({
      shape: 'a-one-shot-roll-modifier',
      blocks: ['barbarian:improved-brutal-strike', 'fighter:studied-attacks', 'rogue:steady-aim'],
      finishes: ['fighter:studied-attacks', 'rogue:steady-aim'],
    });
    expect(featureConsumersOf('an-action-the-engine-has-no-spender-for')).toEqual({
      shape: 'an-action-the-engine-has-no-spender-for',
      blocks: [
        'halfling:naturally-stealthy',
        'rogue:cunning-action',
        'thief:fast-hands',
        'thief:supreme-sneak',
      ],
      finishes: ['halfling:naturally-stealthy', 'thief:fast-hands'],
    });
    expect(featureConsumersOf('a-cheaper-price-only-one-command-offers')).toEqual({
      shape: 'a-cheaper-price-only-one-command-offers',
      blocks: ['orc:adrenaline-rush', 'rogue:cunning-action'],
      finishes: [],
    });
    expect(featureConsumersOf('an-action-a-spell-compels-or-forbids')).toEqual({
      shape: 'an-action-a-spell-compels-or-forbids',
      blocks: ['open-hand:fleet-step', 'paladin:abjure-foes', 'rogue:devious-strikes'],
      finishes: ['open-hand:fleet-step'],
    });
  });

  /**
   * And the number the brief would have been sized from, said plainly.
   *
   * **The door alone finishes nothing.** Opening `ActionRule` to a feature —
   * the decision the split sends to an architect — takes no feature off this
   * list, because both of the ones it blocks are blocked on something else as
   * well. One Rogue feature needs all three of the new ids at once, which is
   * the clearest single fact the re-filing produced: a transcription track
   * briefed off `finishes: 4` would have landed none of them.
   *
   * And a brief that built the door **and** a price on `takeDash` would still
   * not take Cunning Action off the list. It would free two of its three
   * verbs and leave the Hide, and a feature half applied declares `manual`:
   * `barbarian:persistent-rage` is the standing reading of that, and it is
   * why this column counts features rather than clauses.
   */
  it('finishes nothing with the door alone, and one feature wants all three', () => {
    expect(featureConsumersOf('an-action-rule-a-feature-holds').finishes).toEqual([]);
    expect(featureBlockersOf('rogue:cunning-action')).toEqual([
      'a-cheaper-price-only-one-command-offers',
      'an-action-rule-a-feature-holds',
      'an-action-the-engine-has-no-spender-for',
    ]);
    // The two the coined ids really do finish are finished by a *spender*
    // rather than by the grant: a Hide the engine takes and a Utilize it
    // charges for. Neither is a grant vocabulary's business.
    expect(featureConsumersOf('an-action-the-engine-has-no-spender-for').finishes).toEqual([
      'halfling:naturally-stealthy',
      'thief:fast-hands',
    ]);
  });
});

/**
 * The features that are finished business, pinned by name rather than by size.
 *
 * The *fiction* pile on the other book. A feature whose every clause is the
 * table's is not waiting on the engine and is never going to be executed —
 * Thieves' Cant is a language, a Fighting Style is its feat's debt, and
 * Hunter's Lore is knowledge. Pinning them by name means a builder who thinks
 * one of them is buildable has to come here and say so.
 */
describe('the features blocked by nothing', () => {
  it('are these, and every clause of each is the table’s', () => {
    expect(featuresTheTableOwns()).toEqual([
      'champion:additional-fighting-style',
      'druid:druidic',
      'fighter:fighting-style',
      'hunter:hunters-lore',
      'paladin:fighting-style',
      'ranger:fighting-style',
      'rogue:thieves-cant',
    ]);
    for (const id of featuresTheTableOwns()) {
      expect(
        featureClausesIn(FEATURE_BLOCKED_ON[id] ?? []).every((clause) => clause.why === 'table'),
        id,
      ).toBe(true);
    }
  });

  /**
   * And the two piles are the same one again, which is what finishing the
   * advancement work did to them.
   *
   * For one batch they differed: twenty-four features named no missing
   * mechanic, because the engine already did what their sentence said and
   * only the note and the automation flag in the class file were outstanding.
   * Transcribing those took all twenty-four out of the map altogether — they
   * are executed, not blocked by nothing — so what is left blocked by nothing
   * is exactly what the **table** owns. The two functions are kept apart
   * rather than merged, because the day a twenty-fifth is transcribed and
   * half-recorded is the day they differ again and this assertion says so.
   */
  it('is the same pile as the features the table owns', () => {
    const nothing = featuresBlockedByNothing();
    for (const id of featuresTheTableOwns()) expect(nothing).toContain(id);
    expect(nothing.length).toBe(featuresTheTableOwns().length);
    // The feature that used to be the example on the other side of the line.
    expect(nothing).not.toContain('wizard:epic-boon');
    expect(MANUAL).not.toContain('wizard:epic-boon');
  });

  /**
   * And they are not the same pile as a feature with a clause that is not a
   * blocker.
   *
   * An `'expressible'` clause says *this sentence is not what is standing in
   * the way* — either because the engine already does that half, as it does
   * a Barbarian's Rage immunity, or because the vocabulary could write it and
   * nobody has, as with the Advantage Reckless Attack hands its attackers. A
   * feature carrying one is still blocked on whatever its other clauses name,
   * and is not finished business.
   */
  it('keeps a half-built feature out of the table’s pile', () => {
    const half = Object.entries(FEATURE_BLOCKED_ON).filter(([, entry]) =>
      featureClausesIn(entry).some((clause) => clause.why === 'expressible'),
    );
    expect(half.length).toBeGreaterThan(5);
    for (const [id, entry] of half) {
      if (featureBlockersIn(entry).length === 0) continue;
      expect(featuresTheTableOwns(), id).not.toContain(id);
    }
  });
});

/**
 * The documents a shape description may name, and what each resolves to.
 *
 * `blocked-on.test.ts`'s table pointed at this corpus. It is **its own table
 * rather than an import**, for the reason `citations.ts` gives: what is shared
 * is the floor, the normalisation and the two scans, and what is not shared is
 * which documents may be named — this map cites the engine's own vocabulary
 * files, which the spell map has no reason to.
 *
 * `srd` resolves to nothing on purpose, so a quotation of the book is skipped
 * rather than looked up in whichever document was named before it — every
 * description here quotes an SRD sentence somewhere, and checking one against
 * a design note would fail on prose that is perfectly correct.
 *
 * **What that costs, said plainly rather than left to be discovered.** `srd`
 * is matched anywhere, including inside an earlier quoted run, so a
 * description that quotes a repository sentence containing the word "SRD" and
 * then quotes a second one has its *second* quotation skipped. The corpus
 * assertion below only asks that each named document be quoted once across
 * the whole vocabulary, so it does not catch that either. The guard is a
 * **floor**: what it promises is that no description misquotes the last
 * document it named before the run, which is the same promise the spell map's
 * copy of this rule makes in the same words.
 */
const HERE = fileURLToPath(new URL('.', import.meta.url));

const CITED_SOURCES: readonly CitedSource[] = [
  { name: 'srd', label: 'the SRD', files: [] },
  {
    name: 'progression.ts',
    label: 'packages/engine/src/progression.ts',
    files: ['packages/engine/src/progression.ts'],
  },
  {
    name: 'standing.ts',
    label: 'packages/engine/src/standing.ts',
    files: ['packages/engine/src/standing.ts'],
  },
  {
    name: 'roll-modifiers.ts',
    label: 'packages/engine/src/roll-modifiers.ts',
    files: ['packages/engine/src/roll-modifiers.ts'],
  },
  // The action economy's own vocabulary file, registered when three shapes
  // were coined out of one: `ActionRule`, `NAMED_ACTIONS` and
  // `STATABLE_PRICES` are the three refusals those ids name, and each of them
  // argues for itself in prose right where it is declared. A description that
  // could not quote them would have had to paraphrase the engine's reasons
  // back at it, which is the drift this table exists to catch.
  {
    name: 'combat.ts',
    label: 'packages/engine/src/combat.ts',
    files: ['packages/engine/src/combat.ts'],
  },
  {
    name: 'content.ts',
    label: 'packages/engine/src/content.ts',
    files: ['packages/engine/src/content.ts'],
  },
  { name: 'content.md', label: 'docs/design/content.md', files: ['docs/design/content.md'] },
  // Two files under one name, exactly as the spell map resolves this one: the
  // architecture was reviewed in the archived copy and the current document is
  // where the magic-item half was written afterwards.
  {
    name: 'characters-and-equipment.md',
    label: 'docs/design/characters-and-equipment.md',
    files: [
      'docs/design/characters-and-equipment.md',
      'docs/archive/design/characters-and-equipment.md',
    ],
  },
  {
    name: 'time-and-turns.md',
    label: 'docs/design/time-and-turns.md',
    files: ['docs/design/time-and-turns.md', 'docs/archive/design/time-and-turns.md'],
  },
  {
    name: 'space-and-areas.md',
    label: 'docs/design/space-and-areas.md',
    files: ['docs/design/space-and-areas.md', 'docs/archive/design/space-and-areas.md'],
  },
  {
    name: 'rolls-and-damage.md',
    label: 'docs/design/rolls-and-damage.md',
    files: ['docs/design/rolls-and-damage.md', 'docs/archive/design/rolls-and-damage.md'],
  },
];

/**
 * Every quoted run in one description, attributed to the last document named
 * before it.
 *
 * The **nearest preceding name**, which is the spell map's rule and is one an
 * author can hold in their head: name the document, then quote it. Its one
 * cost is that a quotation of something else is read as belonging to whatever
 * was named last, so a description quoting a second source has to name that
 * one too.
 */
function citationsIn(where: string, prose: string): readonly Citation[] {
  const named = namesIn(CITED_SOURCES, prose);
  const cited: Citation[] = [];
  for (const { at, run } of quotedRunsIn(prose)) {
    const attributed = named.filter((mention) => mention.at < at).pop();
    if (attributed === undefined || attributed.files.length === 0) continue;
    cited.push({ where, source: attributed.source, run, files: attributed.files });
  }
  return cited;
}

const misquotes = (corpus: Iterable<readonly [string, string]>): string[] =>
  misquotedIn(corpus, citationsIn);

/** Every piece of prose in this map that may cite the repository. */
const citedProse = (): Array<readonly [string, string]> =>
  Object.entries(FEATURE_SHAPES).map(([shape, description]) => [shape, description] as const);

describe('a shape says where this repository already described it', () => {
  /**
   * The rule that keeps the vocabulary from becoming a private language.
   *
   * The names are read off {@link CITED_SOURCES} rather than written out a
   * second time, so the list a description must name and the list a quotation
   * is checked against cannot drift apart.
   */
  it('makes every shape point at prose somebody already reviewed', () => {
    const sources = CITED_SOURCES.filter((source) => source.files.length > 0).map(
      (source) => source.name,
    );
    for (const [shape, description] of Object.entries(FEATURE_SHAPES)) {
      const said = description.toLowerCase();
      expect(
        sources.filter((source) => said.includes(source)),
        `${shape} names no place this repository already described it`,
      ).not.toEqual([]);
    }
  });

  /** A description that says nothing is a licence, so each must be a real sentence. */
  it('writes a real sentence for every shape', () => {
    for (const [shape, description] of Object.entries(FEATURE_SHAPES)) {
      expect(description.length, shape).toBeGreaterThan(120);
    }
  });
});

/**
 * Naming a document is not quoting it, and the guard above only asks for the
 * name.
 *
 * `blocked-on.test.ts` records what that costs: two misquotes of a named file
 * shipped inside one tranche and were caught by a reviewer reading rather than
 * by a test. This is the other half of the same rule, pointed at the third
 * corpus — a claim about a document, checked against the document.
 */
describe('a citation is held against the document it names', () => {
  /**
   * The guard, driven by a misquote built to be caught.
   *
   * The synthetic **inverts a sentence the file really prints**, because that
   * is the failure in its hardest form: the file is named, the file exists,
   * the subject is right, and nothing but opening it can tell the two apart.
   */
  it('catches a description quoting a sentence the named document does not print', () => {
    const wrong =
      'packages/engine/src/standing.ts says it outright: "Suppression, and also prevention and removal".';
    expect(misquotes([['synthetic-shape', wrong]])).toEqual([
      expect.stringContaining('Suppression, and also prevention and removal'),
    ]);
  });

  /** And it passes the moment the quotation is the sentence the file prints. */
  it('passes once that quotation is corrected', () => {
    const right =
      'packages/engine/src/standing.ts says it outright: "Suppression, not prevention and not removal".';
    expect(misquotes([['synthetic-shape', right]])).toEqual([]);
  });

  /**
   * A quotation of the book is not a claim about this repository.
   *
   * Every description here quotes an SRD sentence somewhere, and looking one
   * up in whichever document was named before it would fail on prose that is
   * perfectly correct.
   */
  it('leaves a quotation attributed to the SRD to the guard that owns it', () => {
    const note =
      'packages/engine/src/progression.ts files it as debt. SRD: "You can attack twice instead of once".';
    expect(misquotes([['synthetic-shape', note]])).toEqual([]);
  });

  /** A run shorter than the floor is a quoted term rather than a citation. */
  it('leaves a quoted term alone', () => {
    expect(CITATION_FLOOR).toBe(8);
    expect(misquotes([['synthetic-shape', 'packages/engine/src/standing.ts: "aura".']])).toEqual([]);
  });

  /**
   * The corpus, and the assertion that the corpus is not vacuous.
   *
   * Every document the table names must be quoted somewhere: a name with no
   * citation is an alias nothing uses, which would make the guard quietly
   * narrower than it reads.
   */
  it('checks at least one citation of every document the table names', () => {
    const cited = new Set(
      citedProse().flatMap(([where, prose]) =>
        citationsIn(where, prose).map((citation) => citation.source),
      ),
    );
    expect(
      CITED_SOURCES.filter((source) => source.files.length > 0 && !cited.has(source.label)).map(
        (source) => source.label,
      ),
    ).toEqual([]);
  });

  /** And the real thing: every description quotes the document it names. */
  it('quotes every document this map names', () => {
    expect(misquotes(citedProse())).toEqual([]);
  });

  /** The design-note paths this table resolves really are tracked files. */
  it('names documents that exist', () => {
    const tracked = new Set([
      ...readdirSync(`${HERE}../../../docs/design`).map((file) => `docs/design/${file}`),
      ...readdirSync(`${HERE}../../../docs/archive/design`).map(
        (file) => `docs/archive/design/${file}`,
      ),
    ]);
    for (const source of CITED_SOURCES) {
      for (const path of source.files) {
        if (!path.startsWith('docs/')) continue;
        expect(tracked.has(path), path).toBe(true);
      }
    }
  });
});

/** The synthetic entry type is the real one, so a test cannot widen the map. */
const SYNTHETIC: FeatureEntry = [
  { clause: 'A secret language', why: 'table', note: 'a synthetic reading of a real note' },
];

describe('the classifier can be driven with something it must refuse', () => {
  it('reads a synthetic entry over a real note', () => {
    expect(unanchoredFeatureClauses(SPECIMEN, SYNTHETIC)).toEqual([]);
    expect(featureBlockersIn(SYNTHETIC)).toEqual([]);
  });

  it('refuses a clause naming a shape no vocabulary has', () => {
    const invented: FeatureEntry = [
      { clause: 'A secret language', why: 'a-shape-nobody-wrote-down' as never, note: 'synthetic' },
    ];
    expect(knownFeatureBlockers().has(featureBlockersIn(invented)[0] ?? '')).toBe(false);
  });
});
