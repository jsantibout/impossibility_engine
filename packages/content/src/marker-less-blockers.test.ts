import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { renderReport } from '../scripts/coverage.js';
import {
  ADJUDICATED as ADJUDICATED_EXECUTED,
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
  // **Spare the Dying is not here any more, and that is the form working
  // rather than the form failing.** Its marker-less entry carried
  // `a-range-that-scales-with-caster-level` — a Cantrip Upgrade no mechanical
  // marker can see — through the commits between the definition being written
  // and the mechanism being built. The mechanism is built, `rangeAtLevel` is
  // the field, and a shape nothing is blocked on is one the guard deletes. So
  // the reading left by being **paid**, which is the one exit from this list
  // that is not a loss.
  //
  // **And Enthrall left the same way.** Its marker-less entry carried
  // `a-bonus-narrowed-to-a-skill` — a −10 that reaches one skill and the
  // passive score, in words no marker sees — until `autoSucceedIf.fought`
  // read the fought fact as a success and `passivePerceptionOf` read the
  // stored bonus at the passive end. The spell is executed, and the id moved
  // to the item vocabulary for the one half a casting never had: a standing
  // grant with no narrowing.
  [
    'flesh-to-stone',
    'an-automatic-success-by-creature-type',
    'Constructs automatically succeed on the save',
  ],
];

/**
 * The two the same derivation named and the same commit did not write.
 *
 * The commit that built the entry form derived its three from the shapes
 * rather than from the spells — *hold the tracked map to the old rule and
 * exactly three shapes lose their last claimant* — and named no spell at all.
 * Run the derivation over the **undefined** population instead and it names
 * five: a spell is unwritable under the old rule exactly when one of its
 * blockers sits in a sentence no marker can see **and** nothing else in the
 * book claims that shape. Spare the Dying, Enthrall and Flesh to Stone were
 * three of the five; these are the other two, and each brings a shape of its
 * own into the counterfactual below.
 *
 * Kept as a second list rather than merged into `LANDED`, because the claim is
 * about a different pass: `LANDED`'s three are evidence the form was needed,
 * and these two are evidence it keeps working on paragraphs nobody had read
 * with it in hand.
 */
const SINCE: readonly (readonly [string, ShapeId, string])[] = [
  [
    'calm-emotions',
    'a-condition-a-spell-suppresses',
    'those conditions are suppressed for the duration',
  ],
  [
    'hallow',
    'a-cap-on-how-many-castings-run-at-once',
    'the spell fails if the radius includes an area already under the effect of',
  ],
  ['hallow', 'a-choice-made-at-the-casting', 'Choose any of these creature types'],
  // **The sixth, and it is a correction rather than a spell being written.**
  // Greater Restoration's Exhaustion level had been in the definition's own
  // `unmodelled` and nowhere else, on the stated grounds that the line trips no
  // marker for a guard to demand one against — written before this form
  // existed, and never revisited once it did. Meanwhile the shape was claimed
  // by Wish, whose SRD 5.2.1 paragraph prints no Exhaustion at all. So the form
  // is what moves the claim onto the one spell in the book that makes it, and
  // the shape survives a wrong entry being deleted.
  [
    'greater-restoration',
    'an-exhaustion-level-a-spell-changes',
    '- 1 Exhaustion level',
  ],
];

describe('a blocker no mechanical marker can see survives the spell being written', () => {
  it.each([...LANDED, ...SINCE])('writes %s and keeps the reading of %s', (spellId, shape, phrase) => {
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
  it.each([...LANDED, ...SINCE])('finds no marker in %s’s sentence about %s', (spellId, _shape, phrase) => {
    const sentence = sentencesOf(spellId).find((text) => text.includes(phrase));
    expect(sentence, `${spellId}: "${phrase}" is in no sentence of the prose`).toBeDefined();
    expect(mechanicalMarkersIn(sentence ?? ''), `${spellId}: ${phrase}`).toEqual([]);
  });

  /**
   * The counterfactual, which is the whole finding: hold the tracked map to
   * the old rule — every entry carries a marker — and the shapes the engine
   * genuinely lacks whose only claimant is a sentence the markers cannot see
   * are left with nothing blocked on them, so the unclaimed guard demands
   * every one of them be retired.
   *
   * That is what "the three were reverted rather than shipped" means, stated
   * as an assertion instead of as a paragraph in a commit message — **and it
   * was never three**. Three was the count on the day the form landed, over
   * the spells that commit wrote; the derivation is over the book, and two
   * more spells were sitting behind exactly the same sentence. Calm Emotions'
   * suppression and Hallow's refusal to overlap another Hallow are the sole
   * claimants of their shapes, so writing either spell under the old rule
   * would have retired a gap that is still real, which is why neither had been
   * written.
   *
   * Hallow's other marker-less reading is not here and that is the check on
   * this list: `a-choice-made-at-the-casting` is claimed by a dozen sentences
   * a marker can see, so the form is what keeps that reading and not what
   * keeps the shape.
   */
  it('retires a real gap for every shape a marker-less entry is the last claimant of', () => {
    const narrowed = claimedShapes(withoutMarkerLessEntries(TRACKED_ADJUDICATED));
    const retired = Object.keys(MISSING_SHAPES).filter((shape) => !narrowed.has(shape));
    expect(retired.sort()).toEqual(
      [
        // **`a-bonus-narrowed-to-a-skill` is not here any more, and it left
        // by every exit this list can show.** It came off by gaining a second
        // claimant (SRD Slow), came back when that claimant was paid, and has
        // now been paid itself: Enthrall is executed, and what is left of the
        // shape is the standing side, which is an item's gap and lives in the
        // item vocabulary. A spell shape nothing is blocked on is one the
        // guard deletes, so there is no longer a shape here to retire.
        'a-cap-on-how-many-castings-run-at-once',
        'a-condition-a-spell-suppresses',
        // **`a-range-that-scales-with-caster-level` came off this list by being
        // built**, which is the third way an entry leaves and the only one
        // that is a payment rather than a reshuffle: Spare the Dying was its
        // only claimant, `rangeAtLevel` is the field, and a shape nothing is
        // blocked on is one the guard deletes. So there is no longer a shape
        // here for the counterfactual to retire.
        'an-automatic-success-by-creature-type',
        // The sixth, and the one that arrived by a different road: the spell
        // was already written and the reading was in its `unmodelled`, so what
        // the form saved here was a shape from being retired on the strength
        // of a claim from the wrong edition of the book.
        'an-exhaustion-level-a-spell-changes',
        // **`light-and-obscurement-the-scene-holds` was the seventh and is
        // the second to leave by gaining a claimant the form does not carry**
        // — the one exit that makes a gap *more* claimed rather than less,
        // and the reason the list is derived instead of frozen.
        //
        // It was the largest single claim the form had: six spells in level-5
        // reach print a light level — Dancing Lights, Darkness, Daylight,
        // Continual Flame, Light and Fog Cloud — and not one sentence of any
        // of them trips a `MECHANICAL_MARKERS` pattern, because the list
        // knows dice, saves, checks, Armour Class, Hit Points, defences,
        // conditions, roll modes, Speed, chance, movement cost, teleportation
        // and extra damage, and the book writes Bright Light, Dim Light,
        // Darkness and Heavily Obscured in none of those words. What changed
        // was Web: the Difficult Terrain half of "The webs are Difficult
        // Terrain, and the area within them is Lightly Obscured" was executed
        // and the half that was left became an **executed** spell's
        // adjudication, which carries no marker to be stripped of.
        //
        // **The claimant has moved once more, and Web is not it.** P3-S built
        // the shape, so Web's second half is executed too and four of the six
        // spells came off the claim altogether. What holds the id up now is
        // Sunburst's "This spell dispels any Darkness in its area that was
        // created by a spell" — an executed spell's adjudication again, and
        // marker-less again, because a dispel is not a die.
      ].sort(),
    );
    // What the form landed with is in it, less the one that was paid: Flesh
    // to Stone's automatic success still holds its shape up, and Enthrall's
    // narrowed bonus left this list twice — once by gaining a second claimant,
    // the one way out that makes a gap *more* claimed rather than less, and
    // finally by being built.
    for (const [, shape] of LANDED) {
      expect(retired, shape).toContain(shape);
    }
    expect(retired).not.toContain('a-choice-made-at-the-casting');
    // And the second departure, held down the same way: the shape has residue
    // and it is Sunburst's executed clause that now holds it up.
    expect(claimedShapes().has('light-and-obscurement-the-scene-holds')).toBe(true);
    expect(
      (ADJUDICATED_EXECUTED['sunburst'] ?? []).map((entry) => entry.why),
    ).toContain('light-and-obscurement-the-scene-holds');
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
   * And a marker-less entry may not claim the engine reaches a sentence no
   * marker can see — `'engine'` says the resolution path arrives and
   * `'expressible'` says it could, and neither is a reading anybody can
   * re-run against the book.
   *
   * **`'table'` was on this list and gate G1 took it off.** The refusal read:
   * a sentence the markers cannot see that blocks nobody is narration, and a
   * tracked definition already has somewhere to put narration — its own
   * `unmodelled`. `docs/design/content.md` says the opposite and says it as
   * the distinction the two lists exist for: an `unmodelled` line is a
   * **debt** and `dmDecides` is the handover. So the second half of that
   * justification was false, and while it stood a tracked spell whose
   * paragraph trips no marker at all and whose every line is fiction had no
   * legal way to record that somebody had read it — which is thirty-four
   * spells in level-5 reach, every one of them printed as finished business.
   * The case below is the other half of the change, asserted rather than
   * described: `'table'` claims no shape, so it cannot keep one alive, which
   * is the rot this rule was written against.
   */
  it('refuses a marker-less entry that claims the engine reaches it', () => {
    for (const why of ['engine', 'expressible'] as const) {
      const found = misanchoredAdjudications('flesh-to-stone', synthetic({ why }));
      expect(found, why).toHaveLength(1);
      expect(found[0]?.complaint, why).toContain('missing shape or the table');
    }
  });

  it('accepts a marker-less handover, which claims no shape at all', () => {
    expect(misanchoredAdjudications('flesh-to-stone', synthetic({ why: 'table' }))).toEqual([]);
    // And it adds nothing to the claimed set, which is the reason it is safe:
    // the rot this rule guards against is a shape kept alive by an entry
    // nobody read, and a handover keeps none.
    expect(claimedShapes({ synthetic: synthetic({ why: 'table' }) })).toEqual(claimedShapes({}));
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
   * entry form already: `BlockedClause`, which Find Familiar's hour uses and
   * which needs no marker to begin with. Hallow's twenty-four hours used it
   * too until the spell was written; `refuses Hallow’s casting time as an
   * adjudication of any kind` below is that clause meeting this rule.
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
 * The same two refusals, driven against the entries **this** pass wrote.
 *
 * The synthetics above are built out of Flesh to Stone, which is the spell the
 * form landed with. An entry form is only as good as the next paragraph
 * somebody points it at, so each reading Calm Emotions and Hallow added is
 * broken the two ways that matter — moved onto a sentence a marker can see,
 * and relabelled as narration — and each must be caught. A guard driven only
 * by the data it was written for is not a guard.
 */
describe('the readings this pass added are held to the same two rules', () => {
  const entry = (spellId: string, phrase: string): TrackedAdjudication => {
    const written = (TRACKED_ADJUDICATED[spellId] ?? []).find(
      (candidate) => candidate.clause === phrase,
    );
    expect(written, `${spellId} wrote no entry for "${phrase}"`).toBeDefined();
    return written!;
  };

  it.each(SINCE)('accepts %s’s entry about %s as written', (spellId, _shape, phrase) => {
    expect(misanchoredAdjudications(spellId, [entry(spellId, phrase)])).toEqual([]);
  });

  /**
   * Moved onto a sentence of the same spell that a marker *can* see. The
   * clause is a real one the spell prints, so what is being refused is the
   * filing rather than the phrase.
   */
  it.each([
    ['calm-emotions', 'Immunity to the Charmed and Frightened conditions', 'defence'],
    ['hallow', 'have Resistance to one damage type of your choice', 'defence'],
  ] as const)('refuses %s’s reading filed against a sentence naming %s', (spellId, phrase, marker) => {
    const seen = (TRACKED_ADJUDICATED[spellId] ?? []).find((written) => written.marker === null)!;
    const found = misanchoredAdjudications(spellId, [{ ...seen, clause: phrase }]);
    expect(found).toHaveLength(1);
    expect(found[0]?.complaint).toContain(marker);
  });

  /** And relabelled as a claim about the engine that no marker can check. */
  it.each(SINCE)('refuses %s’s reading of %s when it records no blocker', (spellId, _shape, phrase) => {
    for (const why of ['engine', 'expressible'] as const) {
      const found = misanchoredAdjudications(spellId, [{ ...entry(spellId, phrase), why }]);
      expect(found, why).toHaveLength(1);
      expect(found[0]?.complaint, why).toContain('missing shape or the table');
    }
  });

  /**
   * And Hallow's twenty-four hours cannot ride in this map at all, which is
   * the sentence the form's own docstring used to point at.
   *
   * While the spell was undefined its casting time was a `BlockedClause`
   * anchored to a printed field, which that form allows and this one does not.
   * A tracked definition holds the casting time itself — `castingTime: 'long'`
   * with the span the book prints — so the blocker is spent rather than
   * dropped; what is asserted here is that it could not have been carried even
   * if it had not been.
   *
   * **The shape it used to name is retired**, because reading the last three
   * paragraphs that claimed it found every one of them expressible — so the
   * synthetic names a shape that is still real instead. What it is testing is
   * the *anchor*, not the shape: a printed field is in no sentence of the
   * prose, and an entry pointed at one says nothing either rule can read
   * whatever it claims.
   */
  it('refuses Hallow’s casting time as an adjudication of any kind', () => {
    for (const marker of [null, 'condition'] as const) {
      const found = misanchoredAdjudications('hallow', [
        {
          marker,
          clause: 'Casting Time: 24 hours',
          why: 'a-choice-made-at-the-casting',
          note: 'a synthetic entry, built to be caught: the field the undefined population may anchor to and this one may not.',
        },
      ]);
      expect(found, `${marker}`).toHaveLength(1);
      expect(found[0]?.complaint, `${marker}`).toContain('no sentence of the prose');
    }
    expect(SRD_CONTENT.spell('hallow')?.castingTime).toBe('long');
    expect(SRD_CONTENT.spell('hallow')?.castingSeconds).toBe(86_400);
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
    // Enthrall stood first on this list and is executed now: an executed spell
    // keeps no tracked bullet to mark.
    ['Flesh to Stone'],
    ['Calm Emotions'],
    ['Hallow'],
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
    for (const [, shape] of [...LANDED, ...SINCE]) {
      const row = report.split('\n').find((line) => line.startsWith(`| \`${shape}\` |`)) ?? '';
      const cells = row.split('|').map((cell) => cell.trim());
      expect(cells.at(-3), shape).toBe(String(consumersOf(shape).unseen.length));
      expect(Number(cells.at(-3)), shape).toBeGreaterThan(0);
    }
  });
});
