import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS } from '@ie/content';
import { EXECUTED_SPELL_IDS, PARTIAL_SPELLS } from '../scripts/coverage-data.js';
import { FEATURE_SHAPES } from '../scripts/missing-feature-shapes.js';
import {
  ADJUDICATED,
  ITEM_SHAPES,
  MISSING_SHAPES,
  markersIn,
  sentencesOf,
  type Adjudication,
} from '../scripts/missing-shapes.js';

/**
 * The honesty guard, pointed at the spells the engine **executes**.
 *
 * `spell-tracking.test.ts` has held the line for the tracked bucket since it
 * existed: `unmodelled` means *this part of the spell belongs to the fiction,
 * and the engine should never decide it*, and it must never come to mean *the
 * engine ought to enforce this and nobody has built it yet*. That guard reads
 * each tracked spell's own **SRD paragraph** out of the parsed book, because a
 * tracked definition resolves nothing and every rule in its text is a claim.
 *
 * The executed bucket is the other half of the population and had no guard at
 * all — 58 of the 82 executed definitions carry `unmodelled` clauses and
 * nothing read one. The third whole-engine audit (2026-09-13, §3.5) found what
 * that costs: a frozen statue and a puff of dust are fiction, and beside them
 * sat "the target cannot regain Hit Points until the end of your next turn",
 * "the save has Advantage if you or your allies are fighting the target", a
 * Hit Point maximum reduction and three Difficult Terrain areas — every one a
 * rule the engine owns or has already named as a missing shape, filed as
 * though it were narration.
 *
 * **The text scanned is the clause, not the paragraph**, and that is the one
 * real difference from the tracked guard. An executed spell's paragraph is
 * mostly *executed*: scanning it would demand an adjudication for the very
 * dice the engine rolls. What is a claim is the sentence the definition wrote
 * about itself, so that is what is read.
 *
 * | | |
 * |---|---|
 * | `'table'` | fiction; the engine's resolution path never arrives at it, and it should never decide it |
 * | a shape id | the path *does* arrive, would answer wrongly, and a named, enumerated shape is missing |
 *
 * And **partial is a consequence rather than a list**: a spell carrying a
 * shape adjudication is one the engine drives and does not finish, which is
 * exactly what `PARTIAL_SPELLS` claims — so that is the filter it is, taken
 * over this map in `coverage-data.ts`. The report cannot drift from the debts
 * because there is nothing for it to drift from.
 */

/**
 * Every executed definition, read off the catalogue rather than listed — and
 * read through the **one** predicate that decides it.
 *
 * `isExecuted` lives in `coverage.ts` because the report counts with it, and
 * it is imported here rather than restated because this guard's entire
 * population is that predicate: a copy that drifted by forgetting
 * `areaTrigger` would quietly stop covering Web, Grease and Insect Plague and
 * nothing would go red. One of the three copies that existed had already lost
 * that arm.
 */
const EXECUTED: readonly string[] = [...EXECUTED_SPELL_IDS].sort();

/**
 * The markers, the vocabulary and the executed population's adjudications all
 * live in `scripts/missing-shapes.ts` now, and the guards stay here.
 *
 * `CLAUSE_MARKERS` and `markersIn` moved for the reason the two maps did:
 * `npm run coverage` runs outside vitest, and IE-044 made the report ask
 * whether an undefined spell's paragraph had been read sentence by sentence —
 * which is this same list of mechanics, pointed at a second population. Two
 * copies of one question is the failure this file's own subject keeps naming,
 * so there is one list and this guard imports it.
 */

const clausesOf = (spellId: string): readonly string[] =>
  SPELL_DEFINITIONS.find((d) => d.id === spellId)?.unmodelled ?? [];

/** The clauses of this spell that name a mechanic the engine owns. */
const mechanicalClausesOf = (spellId: string): readonly string[] =>
  clausesOf(spellId).filter((clause) => markersIn(clause).length > 0);

const entriesFor = (spellId: string): readonly Adjudication[] => ADJUDICATED[spellId] ?? [];

const matching = (entry: Adjudication, clauses: readonly string[]): readonly string[] =>
  clauses.filter((clause) => clause.includes(entry.clause));

describe('an executed spell may not file a rule the engine owns as fiction', () => {
  it('has markers that actually fire, so the rule below is not vacuous', () => {
    // The clauses the audit read as debt, each firing on the mechanic it names.
    expect(markersIn('the target cannot regain Hit Points until the end of your next turn')).toContain(
      'hit-points',
    );
    expect(markersIn('the save has Advantage if you or your allies are fighting the target')).toContain(
      'roll-mode',
    );
    expect(markersIn('the Hit Point maximum reduction equal to the damage taken')).toContain(
      'hit-points',
    );
    expect(
      markersIn('the next attack roll against the target before the end of your next turn has Advantage'),
    ).toContain('attack-roll');
    expect(markersIn('the area is Difficult Terrain for the duration')).toContain(
      'difficult-terrain',
    );
    expect(markersIn('an attacker that perceives the target with Blindsight or Truesight')).toContain(
      'senses',
    );
  });

  /**
   * And the other direction, which is what keeps the marker list from becoming
   * a demand that every sentence be justified: a clause naming nothing the
   * engine owns is left alone.
   */
  it('leaves the fiction alone', () => {
    expect(markersIn('the mote of radiance that sheds sunlight for the duration')).toEqual([]);
    expect(
      markersIn('what the force looks like — "a weapon of your choice" — is narration'),
    ).toEqual([]);
    const quiet = EXECUTED.flatMap((id) =>
      clausesOf(id).filter((clause) => markersIn(clause).length === 0),
    );
    expect(quiet.length).toBeGreaterThan(10);
  });

  it.each(EXECUTED.map((s) => [s] as const))(
    'has a written adjudication for every mechanical clause in %s',
    (spellId) => {
      const entries = entriesFor(spellId);
      for (const clause of mechanicalClausesOf(spellId)) {
        const written = entries.filter((entry) => clause.includes(entry.clause));
        expect(
          written.length,
          `${spellId}: no adjudication for a clause naming ${markersIn(clause).join(', ')} — "${clause}"`,
        ).toBe(1);
      }
    },
  );

  /**
   * A stale exemption is the same failure wearing the other face: a clause
   * that once said something mechanical, no longer does, and keeps a licence
   * for it. An entry must match exactly one clause, and that clause must still
   * be one that names a mechanic.
   */
  it('carries no adjudication for a clause that is gone or is no longer mechanical', () => {
    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      for (const entry of entries) {
        const hit = matching(entry, mechanicalClausesOf(spellId));
        expect(hit.length, `${spellId}: "${entry.clause}" matches ${hit.length} clauses`).toBe(1);
      }
    }
  });

  /** And every adjudicated spell is one the catalogue actually executes. */
  it('adjudicates only spells that are executed', () => {
    expect(Object.keys(ADJUDICATED).filter((id) => !EXECUTED.includes(id))).toEqual([]);
  });

  /** In an order two branches can both append to, like every other list here. */
  it('names them in an order two branches can both append to', () => {
    const ids = Object.keys(ADJUDICATED);
    expect(ids).toEqual([...ids].sort());
  });

  /**
   * The half that makes this more than a comment box: a clause that is not the
   * table's must name an enumerated missing shape, and adding one means adding
   * to a reviewed list that says where the repository already described it.
   *
   * **In any of the three books**, which is the owner's disposition of
   * 2026-09-21 arriving here: a spell's sentence may finish on a gap the item
   * or the feature vocabulary already describes, and minting a second id over
   * here for it is the duplication those vocabularies were split out to
   * avoid. Gaseous Form and Haste each name a feature shape now, because what
   * blocks them is an action no command takes. The three id spaces are
   * disjoint, which `why-names-any-shape.test.ts` asserts rather than assumes.
   */
  it('names an enumerated shape for every clause that is not the table’s', () => {
    const known = [
      ...Object.keys(MISSING_SHAPES),
      ...Object.keys(ITEM_SHAPES),
      ...Object.keys(FEATURE_SHAPES),
    ];
    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      for (const entry of entries) {
        if (entry.why === 'table') continue;
        expect(known, `${spellId}/${entry.clause}`).toContain(entry.why);
      }
    }
  });

  /** A note that says nothing is a licence, so each must be a real sentence. */
  it('writes a real sentence for every adjudication', () => {
    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      for (const entry of entries) {
        expect(entry.note.length, `${spellId}/${entry.clause}`).toBeGreaterThan(60);
      }
    }
  });

  /**
   * "No shape sits unclaimed" is in `blocked-on.test.ts` now, over all three
   * populations at once — asking it here would delete every shape only an
   * undefined spell is blocked on, which is most of them. What stays here is
   * the half that is about *this* map: every shape an executed clause names is
   * one the vocabulary knows.
   */
  it('names no shape the vocabulary does not have', () => {
    const known = new Set<string>([
      ...Object.keys(MISSING_SHAPES),
      ...Object.keys(ITEM_SHAPES),
      ...Object.keys(FEATURE_SHAPES),
    ]);
    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      for (const entry of entries) {
        if (entry.why === 'table') continue;
        expect(known.has(entry.why), `${spellId}/${entry.clause}`).toBe(true);
      }
    }
  });

  /**
   * A shape must say **where this repository already described the gap**, and
   * that has to be checkable rather than promised.
   *
   * The rule is the interesting half of the whole map: a shape invented in a
   * note is an architecture decision smuggled past review, and the only thing
   * standing between this list and that is whether each entry can point at
   * prose somebody already reviewed. A docstring saying so is the claim
   * `spell-tracking.test.ts` learned not to trust when it started asserting
   * `engine` in both directions. Four places count, and `spell-definitions.ts`
   * is one of them because a definition's own clause is where several of these
   * gaps were first written down.
   */
  it('makes every shape point at prose somebody already reviewed', () => {
    // **This list is a second spelling of `CITED_SOURCES` and should not be.**
    // `blocked-on.test.ts` reads its own copy off that table precisely so "the
    // list a description must name and the list a quotation is checked against
    // cannot drift apart" — and this one is written out by hand, so it drifted
    // the moment CLAUDE.md's architecture moved into `docs/design/`. Extended
    // here to keep the guard true; unifying the two belongs to whoever next
    // owns these files, because the table lives in a test module and sharing
    // it is a structural change rather than a documentation one.
    const sources = [
      'progress.md',
      'the audit',
      'spell-definitions.ts',
      'docs/design/',
      'docs/rules/',
    ];
    for (const [shape, description] of Object.entries(MISSING_SHAPES)) {
      const said = description.toLowerCase();
      expect(
        sources.filter((source) => said.includes(source)),
        `${shape} names no place this repository already described it`,
      ).not.toEqual([]);
    }
  });

  /**
   * The one adjudication that is true only while another spell has no place.
   *
   * Sunburst "dispels Darkness in its area", and ending a casting is an
   * operation the engine really has — `spell-ended`, and Dispel Magic through
   * it. What makes that clause the table's is not the rule but the geometry,
   * and **which** absent fact it is has moved once already.
   *
   * It used to be the population: no Darkness definition compiled in, so there
   * was no casting to reach. Then it was one field — the definition was tracked
   * and carried no `SpellArea`, so "in its area" had nothing to be measured
   * against — and this test pinned that field so it would fail on the day the
   * field changed rather than go quietly on calling a rule fiction.
   *
   * **It failed, on the day it was written for.** P3-S gave Darkness a Sphere
   * and gave the Sphere magical darkness, so Sunburst's own sixty feet overlap
   * something real and `lightDispelledBy` is a built operation. The clause is
   * therefore **debt** rather than the table's, and what it is blocked on is
   * the trigger: `docs/design/light-and-sight.md` runs the mutual dispel "on
   * pinning a patch", and Sunburst pins none — it is a flash that leaves no
   * light behind and so has no route to the operation.
   *
   * What is pinned now is that pair, and it is pinned in the same spirit: if
   * somebody gives a casting that sheds nothing a way to put a Darkness out,
   * this fails again and the clause stops being debt.
   */
  it('pins the fact that makes Sunburst’s dispel clause debt rather than fiction', () => {
    const darkness = SPELL_DEFINITIONS.filter((d) => d.id === 'darkness');
    expect(darkness, 'Darkness has no definition at all').toHaveLength(1);
    expect(
      darkness[0]?.area,
      'Darkness holds no area again, so Sunburst is back to having no place to overlap',
    ).toEqual({ kind: 'sphere', radius: 15, origin: 'point' });
    expect(
      darkness[0]?.areaLight,
      'Darkness sheds no darkness, so there is nothing in its Sphere for Sunburst to dispel',
    ).toEqual({ level: 'darkness' });
    // And Sunburst's own side of the overlap: a flash that lays no patch, so
    // nothing it does reaches the dispel the geometry would otherwise allow.
    const sunburst = SPELL_DEFINITIONS.find((d) => d.id === 'sunburst');
    expect(
      sunburst?.areaLight,
      'Sunburst lays light now, which is the one thing that would reach the dispel',
    ).toBeUndefined();
    expect(
      ADJUDICATED['sunburst']?.find((entry) => entry.clause === 'dispelling magical Darkness')?.why,
    ).toBe('light-and-obscurement-the-scene-holds');
  });

  /**
   * And where a note quotes the book, it quotes the book.
   *
   * Found by review: four notes attributed to the SRD a sentence it does not
   * print — Dominate's repeat save, and Charm Person's Advantage clause wearing
   * Dominate's wording. That is the file's own subject failing inside the file,
   * and it is exactly the class of error `coverage.test.ts` already oracles for
   * a definition's printed fields. The quotation is checked against **this**
   * spell's paragraph, because a sentence some other spell prints is the way a
   * neighbouring clause gets lent to a spell that never had it.
   */
  it('quotes the SRD exactly, and quotes the right spell', () => {
    const normalise = (text: string) =>
      text
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      const printed = normalise(sentencesOf(spellId).join(' '));
      expect(printed.length, `${spellId} is not in the parsed SRD`).toBeGreaterThan(0);
      for (const entry of entries) {
        if (!entry.note.includes('SRD')) continue;
        for (const quoted of entry.note.match(/"[^"]{8,}"/g) ?? []) {
          const fragment = normalise(quoted.slice(1, -1));
          expect(
            printed.includes(fragment),
            `${spellId} quotes "${fragment}", which its SRD paragraph does not print`,
          ).toBe(true);
        }
      }
    }
  });
});

/**
 * Partial is a consequence, not a list.
 *
 * A spell carrying a shape adjudication is one the engine drives and does not
 * finish, which is exactly what the third coverage state claims — so
 * `PARTIAL_SPELLS` **is** that filter over {@link ADJUDICATED}, computed in
 * `coverage-data.ts` where the report reads it.
 *
 * It used to be written out there and asserted against a copy of the derivation
 * here, in both directions, because this map lived in this file and a report
 * generator that imported the test suite would have had the dependency
 * backwards. IE-015 moved the map to `scripts/missing-shapes.ts`, so that
 * reason is gone and **the equality assertion went with the copy**: two
 * spellings of one derivation check each other rather than checking anything,
 * which is the second-place-to-get-it-wrong failure this file's whole subject
 * keeps naming.
 *
 * What is left is what a derivation can still get wrong: an inverted filter, or
 * an empty map. Both are asserted against the list the report actually
 * publishes rather than against a local copy of the expression.
 */
describe('the partial set is derived from the debts', () => {
  it('has some, so the rules below are not vacuous', () => {
    expect(PARTIAL_SPELLS.length).toBeGreaterThan(0);
  });

  /**
   * Spirit Guardians was the hand list's only entry and the spell the third
   * state was invented for. It is **finished**: the one shape it was waiting
   * on — a Speed derived from where a creature is standing — was built, so its
   * halved Emanation is executed and its last debt is the spirits' appearance,
   * which is narration and names no mechanic.
   *
   * **The pin inverts rather than goes.** A spell that reacquires a shape debt
   * is a regression, and the debt this one would reacquire is precisely the
   * one that was just paid.
   */
  it('has finished the spell the third state was invented for', () => {
    expect(ADJUDICATED['spirit-guardians'] ?? []).toEqual([]);
    expect(PARTIAL_SPELLS).not.toContain('spirit-guardians');
  });

  /**
   * A spell whose every clause is the table's is finished, not partial — the
   * direction that catches a filter reading "has any adjudication at all".
   *
   * The complement is non-empty, and asserted to be: with no all-table spell in
   * the map this would pass while proving nothing, which is the vacuity the
   * rule above guards against on the other side.
   */
  it('leaves a spell whose clauses are all fiction out of it', () => {
    const allTable = Object.entries(ADJUDICATED)
      .filter(([, entries]) => entries.every((entry) => entry.why === 'table'))
      .map(([spellId]) => spellId);
    expect(allTable.length).toBeGreaterThan(0);
    expect(PARTIAL_SPELLS.filter((id) => allTable.includes(id))).toEqual([]);
  });
});
