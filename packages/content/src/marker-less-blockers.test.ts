import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { renderReport } from '../scripts/coverage.js';
import {
  BLOCKED_ON,
  MISSING_SHAPES,
  TRACKED_ADJUDICATED,
  claimedShapes,
  consumersOf,
  mechanicalMarkersIn,
  misanchoredAdjudications,
  sentencesOf,
  unansweredMarkers,
  withoutMarkerLessEntries,
  type ShapeId,
  type TrackedAdjudication,
} from '../scripts/missing-shapes.js';

/**
 * The gap the map used to delete on its way to being filled in.
 *
 * `TRACKED_ADJUDICATED` was keyed to a **mechanical marker** — a word the
 * guard can find in the SRD's English — and `BLOCKED_ON` is keyed to a
 * sentence somebody read. So a spell moving from the undefined population into
 * the tracked one could only carry the blockers the markers happen to see, and
 * every other reading was dropped on the way. "No shape sits unclaimed" then
 * demanded the shape be retired, because nothing was left blocked on it — and
 * a gap that is still real would have been deleted from the map for the crime
 * of being written in words the guard does not know.
 *
 * `COVERAGE.md` says the same thing from the other side: the *Read* column
 * "is a **floor, not a proof.** The markers read English, so a rule the SRD
 * phrases in none of their words trips nothing and is demanded of nobody".
 * A floor that silently deletes what it cannot see is worse than a floor.
 *
 * So a tracked adjudication may now carry **no marker at all**: `marker: null`
 * says *the markers cannot see this sentence, and somebody read the paragraph.*
 * The three definitions below are the ones that could not be written without
 * it, and the two guards below are what stop it becoming a way to write
 * anything.
 */

/** Each landed definition, the shape its marker-less entry carries, and the sentence. */
const LANDED: readonly (readonly [string, ShapeId, string])[] = [
  [
    'spare-the-dying',
    'a-range-that-scales-with-caster-level',
    'The range doubles when you reach levels 5',
  ],
  [
    'enthrall',
    'a-bonus-narrowed-to-a-skill',
    'a −10 penalty to Wisdom (Perception) checks and Passive Perception',
  ],
  [
    'flesh-to-stone',
    'an-automatic-success-by-creature-type',
    'Constructs automatically succeed on the save',
  ],
];

describe('a blocker no mechanical marker can see survives the spell being written', () => {
  it.each(LANDED)('writes %s and keeps the reading of %s', (spellId, shape, phrase) => {
    // The spell left the undefined population, which is the move that used to
    // cost the reading.
    expect(BLOCKED_ON[spellId], spellId).toBeUndefined();
    expect(SRD_CONTENT.spell(spellId), spellId).not.toBeNull();

    const entry = (TRACKED_ADJUDICATED[spellId] ?? []).find(
      (written) => written.marker === null && written.clause === phrase,
    );
    expect(entry, `${spellId}: no marker-less entry for "${phrase}"`).toBeDefined();
    expect(entry?.why, spellId).toBe(shape);

    // And the reading is a *claim* on the shape rather than a comment: the
    // query counts it, so the ranking in COVERAGE.md sees it.
    expect(consumersOf(shape).tracked, shape).toContain(spellId);
    expect(claimedShapes().has(shape), shape).toBe(true);
  });

  /** And the sentence really is invisible, which is what made the entry necessary. */
  it.each(LANDED)('finds no marker in %s’s sentence about %s', (spellId, _shape, phrase) => {
    const sentence = sentencesOf(spellId).find((text) => text.includes(phrase));
    expect(sentence, `${spellId}: "${phrase}" is in no sentence of the prose`).toBeDefined();
    expect(mechanicalMarkersIn(sentence ?? ''), `${spellId}: ${phrase}`).toEqual([]);
  });

  /**
   * The counterfactual, which is the whole finding: hold the tracked map to
   * the old rule — every entry carries a marker — and three shapes the engine
   * genuinely lacks are left with nothing blocked on them, so the unclaimed
   * guard demands all three be retired.
   *
   * That is what "the three were reverted rather than shipped" means, stated
   * as an assertion instead of as a paragraph in a commit message.
   */
  it('retires three real gaps if an entry has to carry a marker', () => {
    const narrowed = claimedShapes(withoutMarkerLessEntries(TRACKED_ADJUDICATED));
    const retired = Object.keys(MISSING_SHAPES).filter((shape) => !narrowed.has(shape));
    expect(retired.sort()).toEqual(
      [...LANDED.map(([, shape]) => shape as string)].sort(),
    );
  });

  /** And under the rule as it stands, nothing is unclaimed at all. */
  it('leaves no shape unclaimed as the map is written', () => {
    const claimed = claimedShapes();
    expect(Object.keys(MISSING_SHAPES).filter((shape) => !claimed.has(shape))).toEqual([]);
  });
});

/**
 * The other direction, and the one that decides whether this is an entry form
 * or an escape hatch.
 *
 * Each guard is driven by a synthetic built to be caught, because a guard that
 * can only be run against the data it already agrees with is not a guard —
 * which is the rule `sentenceGaps` and `undefinedSpells` are parameterised for
 * in the same file.
 */
describe('the marker-less form cannot silence the rule beside it', () => {
  const synthetic = (over: Partial<TrackedAdjudication>): readonly TrackedAdjudication[] => [
    {
      marker: null,
      clause: 'Constructs automatically succeed on the save',
      why: 'an-automatic-success-by-creature-type',
      note: 'the synthetic the guards below are driven with: the entry the definition really wrote, then broken one field at a time.',
      ...over,
    },
  ];

  /** The entry as written passes, so the refusals below are about the change. */
  it('accepts the entry the definition really wrote', () => {
    expect(misanchoredAdjudications('flesh-to-stone', synthetic({}))).toEqual([]);
  });

  /**
   * A sentence a marker *can* see may not be filed marker-less, which is the
   * one move that would turn this into a way out of the anchoring rule.
   */
  it('refuses a marker-less entry for a sentence a marker can see', () => {
    const seen = synthetic({
      clause: 'On a failed save, it has the Restrained condition for the duration',
    });
    const found = misanchoredAdjudications('flesh-to-stone', seen);
    expect(found).toHaveLength(1);
    expect(found[0]?.complaint).toContain('condition');
  });

  /**
   * And a marker-less entry must name a **missing shape**. A sentence the
   * markers cannot see that blocks nobody is narration, and a tracked
   * definition already has somewhere to put narration — its own `unmodelled`,
   * which is handed to the table on every casting.
   */
  it('refuses a marker-less entry that records no blocker', () => {
    for (const why of ['table', 'engine'] as const) {
      const found = misanchoredAdjudications('flesh-to-stone', synthetic({ why }));
      expect(found, why).toHaveLength(1);
      expect(found[0]?.complaint, why).toContain('missing shape');
    }
  });

  /**
   * And a **printed field** is not an anchor, which is the same hole reached
   * from the other side.
   *
   * `Casting Time: Action` trips no marker and never will, so every spell in
   * the book carries a permanently marker-free unit — and an entry written
   * against one would keep any shape claimed forever without anybody having
   * read a paragraph. That is the unclaimed rule rotting from the end this
   * form was built to stop it rotting from. A blocker a field prints has an
   * entry form already: `BlockedClause`, which Hallow's twenty-four hours
   * uses and which needs no marker to begin with.
   */
  it('refuses an entry anchored to a printed field', () => {
    for (const marker of [null, 'condition'] as const) {
      const found = misanchoredAdjudications(
        'flesh-to-stone',
        synthetic({ marker, clause: 'Range: 60 feet' }),
      );
      expect(found, `${marker}`).toHaveLength(1);
      expect(found[0]?.complaint, `${marker}`).toContain('no sentence of the prose');
    }
  });

  /** And no entry in the map is anchored to one, so the rule costs nothing. */
  it('anchors every written entry to a sentence', () => {
    const fields = Object.entries(TRACKED_ADJUDICATED).flatMap(([spellId, written]) =>
      written
        .filter((entry) => !sentencesOf(spellId).some((text) => text.includes(entry.clause)))
        .map((entry) => `${spellId}: ${entry.clause}`),
    );
    expect(fields).toEqual([]);
  });

  /** A phrase the spell does not print exactly once is refused as it always was. */
  it('refuses a marker-less entry anchored to nothing', () => {
    const found = misanchoredAdjudications(
      'flesh-to-stone',
      synthetic({ clause: 'Constructs are immune to this spell' }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.complaint).toContain('exactly once');
  });

  /**
   * And the coverage rule is untouched: every marker the prose trips still
   * demands an entry carrying that marker, and a marker-less one answers none
   * of them.
   */
  it('still demands an entry for every marker the prose trips', () => {
    expect(unansweredMarkers('flesh-to-stone', synthetic({}))).toEqual([
      'saving-throw',
      'condition',
      'speed',
    ]);
    expect(unansweredMarkers('flesh-to-stone')).toEqual([]);
  });
});

/**
 * And the report says which is which, because a reader of `COVERAGE.md` is
 * exactly the person the distinction is for.
 *
 * The *Read* column has always carried a paragraph saying it is a floor rather
 * than a proof. Now the floor is **counted**: a tracked spell's bullet says how
 * many of its readings no marker could have demanded, and the blocker table
 * prints the same thing per shape, so the entries somebody had to read for are
 * distinguishable from the ones a guard asked for.
 */
describe('the report tells a reading from a marker', () => {
  const report = renderReport();

  const lineFor = (name: string): string =>
    report.split('\n').find((line) => line.startsWith(`- **${name}** (`)) ?? '';

  it.each([
    ['Spare the Dying'],
    ['Enthrall'],
    ['Flesh to Stone'],
  ])('marks %s’s bullet with the readings a marker could not demand', (name) => {
    expect(lineFor(name)).toMatch(/^- \*\*.+\*\* \(.+\) — \d+ noted, \d+ read$/);
  });

  /**
   * And a tracked spell whose every adjudication a marker found says nothing
   * about reading — otherwise the mark would be decoration rather than a
   * distinction.
   */
  it('leaves a bullet alone when every entry is one a marker demanded', () => {
    expect(TRACKED_ADJUDICATED['confusion']?.every((entry) => entry.marker !== null)).toBe(true);
    expect(lineFor('Confusion')).toMatch(/^- \*\*Confusion\*\* \(level 4\) — \d+ noted$/);
  });

  /** The blocker table prints the same fact per shape, in a column of its own. */
  it('prints an unseen column beside the tracked one', () => {
    expect(report).toContain('| Executed | Tracked | of which unseen | Undefined |');
    for (const [, shape] of LANDED) {
      const row = report.split('\n').find((line) => line.startsWith(`| \`${shape}\` |`)) ?? '';
      const cells = row.split('|').map((cell) => cell.trim());
      expect(cells.at(-3), shape).toBe(String(consumersOf(shape).unseen.length));
      expect(Number(cells.at(-3)), shape).toBeGreaterThan(0);
    }
  });
});
