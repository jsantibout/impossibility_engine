import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  misquotes as misquotedIn,
  namesIn,
  normaliseProse,
  quotedRunsIn,
  type Citation,
  type CitedSource,
} from '../scripts/citations.js';
import {
  ADJUDICATED,
  BLOCKED_ON,
  MAX_SENTENCE,
  MISSING_SHAPES,
  SPLIT_BUNDLES,
  SentenceSplitError,
  TRACKED_ADJUDICATED,
  allShapeConsumers,
  blockersIn,
  blockersOf,
  claimedShapes,
  clausesIn,
  consumersOf,
  flatten,
  coverageGaps,
  isSentenceComplete,
  markersIn,
  parsedSpellIds,
  printedUnitsOf,
  sentenceGaps,
  sentencesOf,
  splitSentences,
  unanchoredClauses,
  DEFINED_SPELL_IDS,
  type BlockedEntry,
  type ShapeId,
} from '../scripts/missing-shapes.js';

/**
 * The undefined population's blockers, asserted the way the executed one's are.
 *
 * `PARTIAL_SPELLS` stopped being a hand list when IE-004 made it a consequence
 * of the adjudication map. `BLOCKED_ON` is the other half: the spells the
 * engine has **no definition for at all**, each read against its own SRD
 * paragraph, so that a shape's consumer count is a query rather than a number
 * in prose that nothing regenerates.
 *
 * The failure this exists to end has happened three times on one family: 17
 * open spells in `PROGRESS.md`, 4 in the leverage audit, 2 whole and 1 partial
 * in the SRD text. None was derived.
 */

const PARSED = parsedSpellIds();
const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * Where in a spell's printed entry a clause phrase sits, as one number.
 *
 * The unit it lies in, then its offset inside that unit — so ordering a spell's
 * clauses by this is ordering them by the book. A phrase the entry does not
 * contain is `-1`, which sorts first and reports itself.
 *
 * **It normalises through `flatten`**, which is the anchoring check's own
 * function rather than a second spelling of it. The two agreed while they
 * differed only over smart quotes and the parsed corpus has none — which is
 * exactly the shape of agreement this repository keeps finding wrong, so one of
 * them asks the other.
 */
const printedOrder = (spellId: string, phrase: string): number => {
  const wanted = flatten(phrase);
  const units = printedUnitsOf(spellId);
  for (let unit = 0; unit < units.length; unit += 1) {
    const within = units[unit]!.indexOf(wanted);
    if (within >= 0) return unit * 10_000 + within;
  }
  return -1;
};

describe('the blocked-on map covers the undefined population', () => {
  /**
   * The completeness guard, and it has to be able to fail.
   *
   * A guard that can only be run against the data it already agrees with is
   * not a guard, so `coverageGaps` is parameterised over both lists and driven
   * here with a synthetic catalogue containing a spell nobody has read. This
   * is the shape `spell-tracking.test.ts` uses for its markers and
   * `invariants.test.ts` for its sweeps: prove the analysis bites on a case
   * built to be caught, then run it on the real thing.
   */
  it('reports a spell added to the catalogue with neither an entry nor a definition', () => {
    const synthetic = [...PARSED, 'hurl-through-hell'];
    const gaps = coverageGaps(synthetic, DEFINED_SPELL_IDS);
    expect(gaps.unrecorded).toEqual(['hurl-through-hell']);
  });

  /** And the other direction: an entry for a spell that is no longer undefined. */
  it('reports an entry for a spell that has since been defined', () => {
    // The case this guard has already caught for real, three times: IE-014
    // defined Lesser Restoration and Protection from Poison, IE-017 Stoneskin
    // and Protection from Energy. The synthetic stands in for the next one.
    const defined = new Set([...DEFINED_SPELL_IDS, 'magic-missile']);
    expect(coverageGaps(PARSED, defined).stale).toEqual(['magic-missile']);
  });

  /** Neither synthetic case is vacuous: the real catalogue has no gap either way. */
  it('has an entry for every undefined spell and no entry for anything else', () => {
    expect(coverageGaps(PARSED, DEFINED_SPELL_IDS)).toEqual({ unrecorded: [], stale: [] });
  });

  /**
   * And the population has not silently emptied.
   *
   * **A floor has to sit below the population, not on it.** This read
   * `> 200` against a map of exactly 201, so the *next* task to define two
   * spells failed a guard by succeeding — which is what IE-035 did, and the
   * only available answers were to lower the number or to leave two spells
   * recorded as undefined after they had been built. The count shrinking is
   * the work going well; what this exists to catch is a wrong directory, a
   * filter that reads nothing, or a map that has quietly stopped being
   * populated at all. So it is generous on purpose, and the number of spells
   * the engine actually defines is `COVERAGE.md`'s to print.
   */
  it('covers a population worth deriving', () => {
    expect(Object.keys(BLOCKED_ON).length).toBeGreaterThan(150);
  });

  it('names only shapes the vocabulary has', () => {
    const known = new Set<string>(Object.keys(MISSING_SHAPES));
    for (const [spellId, entry] of Object.entries(BLOCKED_ON)) {
      for (const shape of blockersIn(entry)) {
        expect(known.has(shape), `${spellId} names ${shape}`).toBe(true);
      }
    }
  });

  /**
   * In an order two branches can both append to, and the order is the data's.
   *
   * A grandfathered entry sorts its shape ids and repeats none, which is what
   * it always did. A clause-anchored one is in the order of the spell's own
   * printed entry — its fields, then its sentences, then position within the
   * sentence — which buys the same property for the same reason: where a new
   * entry goes is decided by the book rather than by whoever wrote it, so two
   * branches cannot put one line in two places.
   */
  it('names them in an order two branches can both append to', () => {
    const ids = Object.keys(BLOCKED_ON);
    expect(ids).toEqual([...ids].sort());
    for (const [spellId, entry] of Object.entries(BLOCKED_ON)) {
      const clauses = clausesIn(entry);
      if (clauses.length === 0) {
        const shapes = entry as readonly ShapeId[];
        expect([...shapes], spellId).toEqual([...shapes].sort());
        expect(new Set(shapes).size, `${spellId} repeats a shape`).toBe(shapes.length);
        continue;
      }
      // An entry is one kind or the other: half a reading is what the second
      // `finishes` number exists to keep out of the first.
      expect(clauses.length, `${spellId} mixes bare shape ids with clauses`).toBe(entry.length);
      const at = clauses.map((clause) => printedOrder(spellId, clause.clause));
      expect(at, `${spellId} names its clauses out of the book's order`).toEqual(
        [...at].sort((a, b) => a - b),
      );
    }
  });

  /**
   * An empty list is an answer, and it is pinned by **name**.
   *
   * "Blocked on nothing the engine owns" means the spell could be taken today,
   * tracked at least — the most interesting thing the map says, and the one
   * claim `CLAUDE.md` restates. A bound on the *size* is what a docstring
   * would carry and is exactly the kind of number this file exists to stop
   * trusting, so the set is written out: a spell joining or leaving it is a
   * reading somebody changed, and it should have to say so here.
   *
   * Light, obscurement and a fiction trigger are why most of them are here.
   * All three are clauses `CLAUSE_MARKERS` — the honesty guard's list, now
   * shared with the sentence-coverage guard below — already leaves
   * alone by name, so calling them fiction is the line this repository already
   * draws rather than a new one.
   *
   * **A spell that offers a choice of branches is here only while every branch
   * is fiction.** Druidcraft and Elementalism each pick one of four or five
   * effects and not one of them is arithmetic, so the choice decides nothing
   * the engine would have to record. Thaumaturgy prints the same shape and one
   * of its six branches grants Advantage on Charisma (Intimidation) checks —
   * which `roll-modifiers.ts` expresses exactly — so its choice does decide
   * something, and it is *not* here. That is the whole of the difference, and
   * it was worth getting wrong once to write down.
   *
   * **The set is derived through `blockersIn` rather than from the entry's
   * length**, which is what lets one of these be *read*. A clause-anchored
   * entry naming nothing but the table's sentences and the expressible ones
   * blocks nothing and belongs here, and is sentence-complete besides — where
   * an entry of length zero records no reading at all and never can. That is
   * the honest shape of this claim: "blocked on nothing" is the strongest thing
   * the map says about a spell, so it is the one most worth being able to show
   * somebody read the paragraph for.
   */
  it('records a spell blocked on nothing rather than omitting it', () => {
    const free = Object.entries(BLOCKED_ON)
      .filter(([, entry]) => blockersIn(entry).length === 0)
      .map(([id]) => id);
    expect(free).toEqual([
      'conjure-fey',
      'create-or-destroy-water',
      'dancing-lights',
      'darkness',
      'daylight',
      'druidcraft',
      'elementalism',
      'fog-cloud',
      'programmed-illusion',
      'purify-food-and-drink',
      'zone-of-truth',
    ]);
  });

  /**
   * The one spell in the book whose **range** grows with the caster.
   *
   * `SpellDefinition.range` is one fixed `SpellRange` and `ranged()` is checked
   * on every casting before a target is looked at, so a defined Spare the Dying
   * would refuse the level 5 cleric the SRD lets stabilise an ally at thirty
   * feet. The engine's path arrives and answers wrongly, which is this map's
   * own definition of debt rather than fiction — and it is the only spell that
   * prints the clause, which is exactly when a one-consumer shape is cheap to
   * name and impossible to reconstruct later.
   */
  it('files the one spell whose range scales with the caster', () => {
    expect(consumersOf('a-range-that-scales-with-caster-level').blocks).toEqual([
      'spare-the-dying',
    ]);
    expect(blockersOf('spare-the-dying')).toEqual([
      'a-range-that-scales-with-caster-level',
      'an-effect-that-stabilises-a-dying-creature',
    ]);
  });
});

/**
 * Splitting prose is approximate, so it fails **loud** or it checks nothing.
 *
 * Under-splitting is the one failure a quiet splitter has and the one the
 * coverage guard below cannot see: a run of text returned whole is a run one
 * adjudication covers, and the guard then reports nothing while checking
 * nothing. Over-splitting reports itself, because a phrase that straddles the
 * seam matches no unit and the anchoring guard says so.
 */
describe('the sentence splitter divides the book, or says it could not', () => {
  it('divides every paragraph in the book', () => {
    for (const id of PARSED) expect(() => sentencesOf(id), id).not.toThrow();
  });

  /**
   * And the bound is not vacuous: the longest sentence the book prints sits
   * comfortably under it, so the guard measures punctuation the splitter does
   * not know rather than prose style.
   */
  it('leaves room between the longest sentence in the book and the bound', () => {
    const longest = Math.max(...PARSED.flatMap((id) => sentencesOf(id).map((s) => s.length)));
    expect(longest).toBeGreaterThan(200);
    expect(longest).toBeLessThan(MAX_SENTENCE);
  });

  /** The synthetic it must catch: a paragraph divided by punctuation it has no rule for. */
  it('refuses a paragraph it cannot divide rather than returning it whole', () => {
    const undivided = `${'a creature within the area is affected; '.repeat(12)}and so on`;
    expect(() => splitSentences(undivided)).toThrow(SentenceSplitError);
  });

  /** And the one it must pass, because a splitter that refused everything would too. */
  it('accepts ordinary prose', () => {
    expect(splitSentences('It takes 2d6 damage. Then it is Prone.')).toEqual([
      'It takes 2d6 damage.',
      'Then it is Prone.',
    ]);
  });

  /**
   * Three rules and no more, each transcribed from what the book does.
   *
   * The label rule is the one that earns its place: `**Resistance.**` on its own
   * trips the defence marker and names no rule, so a splitter that stood it
   * alone would demand an adjudication of Hallow's typography.
   */
  it('ends a sentence at a line break, at a terminator, and never at a label', () => {
    expect(splitSentences('- It is Charmed.\n- It is Frightened.')).toHaveLength(2);
    expect(splitSentences('It said "go now." Then it left.')).toEqual([
      'It said "go now."',
      'Then it left.',
    ]);
    expect(splitSentences('**Resistance.** It has Resistance to Fire damage.')).toEqual([
      '**Resistance.** It has Resistance to Fire damage.',
    ]);
  });
});

/**
 * A clause is anchored to one sentence the spell prints, or it is anchored to
 * nothing.
 *
 * The phrase must occur **exactly once** across the spell's printed fields and
 * the sentences of its prose. Zero is a phrase reworded, mistyped, or assembled
 * across two of the book's sentences; more than one is a phrase that would
 * silently take a neighbouring sentence's licence — which is the failure
 * `Adjudication.clause` has guarded in the executed population since it was
 * written, arriving in the undefined one.
 */
describe('a clause names one thing the spell prints', () => {
  /** The synthetic it must catch, in the direction that reads as harmless. */
  it('reports a phrase the spell prints more than once', () => {
    const ambiguous: readonly BlockedEntry[] = [
      { clause: 'the creature', why: 'table', note: 'a synthetic entry, built to be caught.' },
    ];
    const found = unanchoredClauses('calm-emotions', ambiguous);
    expect(found).toHaveLength(1);
    expect(found[0]!.matches).toBeGreaterThan(1);
  });

  /** And the other direction, which is a clause written about the old sentence. */
  it('reports a phrase the spell prints nowhere', () => {
    const reworded: readonly BlockedEntry[] = [
      {
        clause: 'a sentence this spell does not print',
        why: 'table',
        note: 'a synthetic entry, built to be caught.',
      },
    ];
    expect(unanchoredClauses('mind-blank', reworded)).toEqual([
      { spell: 'mind-blank', clause: 'a sentence this spell does not print', matches: 0 },
    ]);
  });

  /** And it passes a phrase that is one sentence of the spell, so it is not vacuous. */
  it('accepts a phrase the spell prints once', () => {
    const anchored: readonly BlockedEntry[] = [
      {
        clause: 'Immunity to Psychic damage',
        why: 'expressible',
        note: 'a synthetic entry, built to pass.',
      },
    ];
    expect(unanchoredClauses('mind-blank', anchored)).toEqual([]);
  });

  /** The real thing. */
  it('anchors every clause in the map', () => {
    expect(Object.keys(BLOCKED_ON).flatMap((id) => [...unanchoredClauses(id)])).toEqual([]);
  });
});

/**
 * Every sentence that names a mechanic says which of four things it is.
 *
 * Modelled, the table's, deliberately unsupported, or blocked on a named
 * shape — derived from the book rather than from a list. **This is the guard
 * the whole instrument is for**: every wrong prediction this map has made was
 * an *omission*, and an entry naming one blocker for a spell that prints three
 * passed every other guard here.
 */
describe('a read entry answers every sentence that names a mechanic', () => {
  /** The synthetic it must catch: a sentence the engine owns, with nothing written. */
  it('reports a marker sentence no clause answers', () => {
    const gaps = sentenceGaps('mind-blank', []);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.sentence).toContain('Immunity to Psychic damage');
    expect(gaps[0]!.markers).toContain('defence');
  });

  /** And the one it must pass, because a guard that reported everything would too. */
  it('reports nothing once that sentence is answered', () => {
    expect(sentenceGaps('mind-blank')).toEqual([]);
  });

  /**
   * An entry that names no clause is never complete, however quiet its prose.
   *
   * "No sentence names a mechanic" is a conclusion somebody has to have
   * reached, and an entry with no clause records no reading — so the two are
   * told apart by the clause rather than by the silence.
   */
  it('does not call a grandfathered entry read', () => {
    expect(isSentenceComplete('mind-blank')).toBe(true);
    expect(isSentenceComplete('aid')).toBe(false);
    expect(clausesIn(BLOCKED_ON['aid'] ?? [])).toEqual([]);
  });

  /** And the real map: a clause-anchored entry answers every sentence of its spell. */
  it('has no gap in any entry that names a clause', () => {
    const read = Object.keys(BLOCKED_ON).filter(
      (id) => clausesIn(BLOCKED_ON[id] ?? []).length > 0,
    );
    expect(read.flatMap((id) => [...sentenceGaps(id)])).toEqual([]);
  });

  /** A note that says nothing is a licence, so each must be a real sentence. */
  it('writes a real sentence for every clause', () => {
    for (const [spellId, entry] of Object.entries(BLOCKED_ON)) {
      for (const clause of clausesIn(entry)) {
        expect(clause.note.length, `${spellId}/${clause.clause}`).toBeGreaterThan(60);
      }
    }
  });

  /** And a `why` is one of the two words or a shape the vocabulary has. */
  it('names an enumerated shape for every clause that is neither', () => {
    const known = new Set<string>(Object.keys(MISSING_SHAPES));
    for (const [spellId, entry] of Object.entries(BLOCKED_ON)) {
      for (const clause of clausesIn(entry)) {
        if (clause.why === 'table' || clause.why === 'expressible') continue;
        expect(known.has(clause.why), `${spellId}/${clause.clause}`).toBe(true);
      }
    }
  });

  /**
   * And where a note quotes the book, it quotes **this** spell's paragraph.
   *
   * `spell-honesty.test.ts` holds the executed map's notes to the same rule,
   * after four of them were found attributing to the SRD a sentence it does not
   * print and one of those was a neighbouring spell's. A note about an
   * undefined spell is a claim about a paragraph nobody has written a
   * definition against, which is if anything the easier one to get wrong.
   */
  it('quotes the SRD exactly, and quotes the right spell', () => {
    for (const [spellId, entry] of Object.entries(BLOCKED_ON)) {
      const printed = normaliseProse(sentencesOf(spellId).join(' '));
      for (const clause of clausesIn(entry)) {
        if (!clause.note.includes('SRD')) continue;
        for (const quoted of clause.note.match(/"[^"]{8,}"/g) ?? []) {
          const fragment = normaliseProse(quoted.slice(1, -1));
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
 * The family IE-044 backfilled, and what reading ten paragraphs found.
 *
 * `a-condition-immunity-a-spell-grants` is the shape IE-042 is briefed from, so
 * it is the family whose entries had to stop being bare lists first. Backfilling
 * is deliberately family by family: two hundred paragraphs in one commit is how
 * a reviewer stops reading, and the second `finishes` number is what makes the
 * rest honest in the meantime.
 *
 * **Five blockers came out of the reading that no entry had recorded**, which
 * is the instrument doing exactly what it exists for — each is a sentence the
 * spell prints and nobody had written down, and each an existing shape id
 * rather than a new one:
 *
 * | | |
 * |---|---|
 * | Freedom of Movement | "spells and other magical effects can neither reduce the target's Speed" — an effect refusing another effect, where the entry had recorded only the condition half of the same sentence |
 * | Magic Circle | "Choose one or more of the following types of creatures" — a choice made at the casting, which **Hallow states in different words** ("Choose any of these creature types") and had recorded |
 * | Wind Walk | reverting to and from cloud form, which is a later action the *target* takes through the casting |
 * | Hallow | "the spell fails if the radius includes an area already under the effect of _Hallow_" — a cap of one read over ground rather than over a caster |
 * | Gaseous Form | "The target can enter and occupy the space of another creature" — an override of occupancy, which the engine owns outright |
 *
 * **The last two trip no marker**, and an independent review found them by
 * reading the paragraphs. That is the floor working as a floor: a clause may be
 * written for any sentence, and what the guard promises is that every sentence
 * it can see has an answer.
 */
describe('the condition-immunity family is read sentence by sentence', () => {
  /** Which shapes each of the ten names now, pinned so the backfill is checkable. */
  const BACKFILLED: readonly (readonly [string, readonly ShapeId[]])[] = [
    [
      'calm-emotions',
      ['a-condition-immunity-a-spell-grants', 'a-spells-effects-applied-to-different-targets'],
    ],
    [
      'freedom-of-movement',
      [
        'a-condition-immunity-a-spell-grants',
        'an-activation-taken-by-somebody-other-than-the-caster',
        'an-effect-that-suppresses-other-magic',
        'difficult-terrain-an-area-creates',
        'movement-modes',
      ],
    ],
    [
      'gaseous-form',
      [
        'a-casting-dismissed-early',
        'a-casting-ended-by-a-trigger',
        'a-condition-immunity-a-spell-grants',
        'a-creature-fact-an-effect-overrides',
        'an-action-a-spell-compels-or-forbids',
        'movement-modes',
        'what-a-creature-is-holding',
      ],
    ],
    [
      'hallow',
      [
        'a-barrier-that-blocks-passage',
        'a-cap-on-how-many-castings-run-at-once',
        'a-choice-made-at-the-casting',
        'a-condition-immunity-a-spell-grants',
        'a-creature-type-predicate-an-area-reads',
        'a-long-casting-time',
        'a-standing-effect-derived-from-where-a-creature-stands',
        'an-effect-that-suppresses-other-magic',
      ],
    ],
    [
      'heroes-feast',
      [
        'a-condition-immunity-a-spell-grants',
        'a-hit-point-maximum-a-spell-moves',
        'a-long-casting-time',
      ],
    ],
    ['heroism', ['a-condition-immunity-a-spell-grants', 'a-payout-at-a-turn-boundary']],
    [
      'magic-circle',
      [
        'a-barrier-that-blocks-passage',
        'a-choice-made-at-the-casting',
        'a-condition-immunity-a-spell-grants',
        'a-filter-on-the-attackers-creature-type',
        'a-long-casting-time',
        'an-effect-that-suppresses-other-magic',
      ],
    ],
    ['mind-blank', ['a-condition-immunity-a-spell-grants']],
    [
      'protection-from-evil-and-good',
      [
        'a-condition-immunity-a-spell-grants',
        'a-filter-on-the-attackers-creature-type',
        'a-mode-on-the-save-a-spell-forces',
      ],
    ],
    [
      'wind-walk',
      [
        'a-condition-immunity-a-spell-grants',
        'a-long-casting-time',
        'an-action-a-spell-compels-or-forbids',
        'an-activation-taken-by-somebody-other-than-the-caster',
        'falling',
        'movement-modes',
      ],
    ],
  ];

  it.each(BACKFILLED)('reads every sentence of %s', (spellId, shapes) => {
    expect(isSentenceComplete(spellId)).toBe(true);
    expect(blockersOf(spellId)).toEqual(shapes);
  });

  /** And the family is exactly these ten, so the claim above is about all of them. */
  it('covers every spell the shape blocks', () => {
    expect(consumersOf('a-condition-immunity-a-spell-grants').undefined).toEqual(
      BACKFILLED.map(([id]) => id),
    );
  });

  /**
   * The sentences nobody had written down, asserted by the clause that records
   * each — because "the backfill found something" is only a claim until the
   * something is named.
   *
   * **The last two are the floor's own counterexamples**, and an independent
   * review found them by reading the paragraphs rather than by running
   * anything: neither sentence trips a marker, so neither was demanded, and a
   * clause may be written for any sentence precisely so that a reader who sees
   * one can record it. Hallow's refusal and Gaseous Form's occupancy override
   * are each an existing shape a sentence had never been filed under.
   */
  it('records the five blockers the bare lists had missed', () => {
    const filed = (spellId: string, phrase: string) =>
      clausesIn(BLOCKED_ON[spellId] ?? []).find((clause) => clause.clause === phrase)?.why;
    expect(filed('freedom-of-movement', "can neither reduce the target's Speed")).toBe(
      'an-effect-that-suppresses-other-magic',
    );
    expect(filed('magic-circle', 'Choose one or more of the following types of creatures')).toBe(
      'a-choice-made-at-the-casting',
    );
    expect(
      filed('wind-walk', 'Reverting takes 1 minute, during which the target has the Stunned condition'),
    ).toBe('an-activation-taken-by-somebody-other-than-the-caster');
    expect(
      filed('hallow', 'the spell fails if the radius includes an area already under the effect of'),
    ).toBe('a-cap-on-how-many-castings-run-at-once');
    expect(filed('gaseous-form', 'The target can enter and occupy the space of another creature')).toBe(
      'a-creature-fact-an-effect-overrides',
    );
    // And the marker list really cannot see those two, which is what makes them
    // the floor's counterexamples rather than a guard that fired and was obeyed.
    for (const [spellId, phrase] of [
      ['hallow', 'the spell fails if the radius includes an area already under the effect of'],
      ['gaseous-form', 'The target can enter and occupy the space of another creature'],
      ['magic-circle', 'cause its magic to operate in the reverse direction'],
    ] as const) {
      const sentence = sentencesOf(spellId).find((text) => text.includes(phrase));
      expect(markersIn(sentence ?? ''), `${spellId}: ${phrase}`).toEqual([]);
    }
  });

  /**
   * And Mind Blank stays the shape's one `finishes` — now in the column that
   * says somebody read it.
   *
   * That spell is this map's sharpest correction: the query said IE-017 would
   * finish it and the build did not, because the entry recorded the damage half
   * of a sentence and not the condition half. It is now the sentence that
   * records both.
   */
  it('reports the one spell it finishes as read rather than merely counted', () => {
    const immunity = consumersOf('a-condition-immunity-a-spell-grants');
    expect(immunity.unblocks).toEqual(['mind-blank']);
    expect(immunity.unblocksRead).toEqual(['mind-blank']);
    expect(immunity.unblocksUnread).toEqual([]);
  });
});

/**
 * Two `finishes` numbers, and the difference is the finding — exactly as
 * `blocks` against `unblocks` was.
 */
describe('what a shape finishes is two numbers', () => {
  it('partitions the spells a shape finishes, losing none', () => {
    for (const row of allShapeConsumers()) {
      expect([...row.unblocksRead, ...row.unblocksUnread].sort(), row.shape).toEqual([
        ...row.unblocks,
      ]);
      expect(row.unblocksRead.filter((id) => row.unblocksUnread.includes(id))).toEqual([]);
      for (const id of row.unblocksRead) expect(isSentenceComplete(id), id).toBe(true);
      for (const id of row.unblocksUnread) expect(isSentenceComplete(id), id).toBe(false);
    }
  });

  /**
   * And neither column is vacuous, which is what makes printing both worth
   * anything: one shape's finishes have been read, and most have not.
   */
  it('has some of each, so the report says something', () => {
    const rows = allShapeConsumers();
    expect(rows.filter((row) => row.unblocksRead.length > 0).length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.unblocksUnread.length > 0).length).toBeGreaterThan(0);
  });

  /** A grandfathered spell is counted, and counted in the column that says so. */
  it('still counts a spell nobody has read', () => {
    expect(consumersOf('an-armor-class-a-spell-floors').unblocksUnread).toEqual(['barkskin']);
    expect(consumersOf('an-armor-class-a-spell-floors').unblocksRead).toEqual([]);
  });

  /** And the markers the coverage guard reads are the honesty guard's, not a second list. */
  it('reads one marker list rather than two spelled alike', () => {
    expect(markersIn('it has Immunity to the Charmed condition')).toContain('defence');
    expect(markersIn('the mote of radiance that sheds sunlight for the duration')).toEqual([]);
  });
});

/**
 * The documents a citation may name, and what each name resolves to.
 *
 * Four entries and deliberately not "any file in the repository": a citation
 * is worth checking *because* it names a document somebody reviewed, and a
 * table that matched any path would stop saying where a claim came from.
 * `docs/architecture` is **read** rather than listed, because the audits are a
 * directory that grows and a hand-kept list of them is the hand-kept count
 * this whole map exists to end. That one name therefore resolves to several
 * files and a run need appear in any of them, which is the honest reading of a
 * description that says "the audit" without saying which — and still far
 * narrower than asking whether the word appears.
 *
 * **`SRD` is in the table carrying no file, and that is the whole of what it
 * is for.** A note that names `CLAUDE.md` and then quotes the book must not
 * have the book's sentence looked up in `CLAUDE.md`. Those quotations already
 * have a guard — `spell-honesty.test.ts` holds each against that spell's own
 * paragraph — and this one would check them against the wrong document
 * entirely. **The brief corpus resolves `SRD` to the raw files instead**, and
 * `brief-citations.ts` says why the two differ: a brief quoting a rules
 * section has no other guard, and nothing in a brief says which spell it is
 * talking about.
 */
const CITED_SOURCES: readonly CitedSource[] = [
  // **`claude.md` is deliberately not in this table any more.** When CLAUDE.md
  // became the constitution and router its architecture moved out verbatim,
  // and with it every sentence these maps quoted — so a `claude.md` entry
  // would be a name no citation uses, which the non-vacuity assertion below
  // exists to refuse. It comes back the day a note quotes the constitution
  // itself. Until then, a description naming only `CLAUDE.md` fails the
  // *points at prose somebody already reviewed* guard rather than passing
  // unchecked, so the removal is loud rather than a hole.
  { name: 'progress.md', label: 'PROGRESS.md', files: ['PROGRESS.md'] },
  {
    name: 'audit',
    label: 'the audit records under docs/architecture/',
    files: readdirSync(`${HERE}../../../docs/architecture`).map(
      (file) => `docs/architecture/${file}`,
    ),
  },
  {
    name: 'spell-definitions.ts',
    label: 'packages/engine/src/spell-definitions.ts',
    files: ['packages/engine/src/spell-definitions.ts'],
  },
  { name: 'srd', label: 'the SRD', files: [] },

  // The subsystem documents, **each registered on its own** rather than as
  // successors of `claude.md`. When `CLAUDE.md` became the constitution and
  // router, its architecture was extracted verbatim into these; the citations
  // moved with the sentences, so every note still names the document that
  // actually contains the run it quotes. Widening `claude.md` to resolve
  // against all of them was refused deliberately — a citation that names one
  // document and is checked against nine is the corpus-wide search this table
  // exists to prevent.
  //
  // `srd-policy.md` is listed **after** the bare `srd` entry on purpose. Its
  // path contains that entry's name, so the two match at the same offset, and
  // `citationsIn` attributes a run to the last such match in this array's
  // order — so the more specific document wins, and a quotation of the book
  // still resolves to no file, which is what the `srd` entry is for.
  {
    name: 'event-log.md',
    label: 'docs/design/event-log.md',
    files: ['docs/design/event-log.md'],
  },
  { name: 'casting.md', label: 'docs/design/casting.md', files: ['docs/design/casting.md'] },
  {
    name: 'spell-definitions.md',
    label: 'docs/design/spell-definitions.md',
    files: ['docs/design/spell-definitions.md'],
  },
  {
    name: 'space-and-areas.md',
    label: 'docs/design/space-and-areas.md',
    files: ['docs/design/space-and-areas.md'],
  },
  {
    name: 'time-and-turns.md',
    label: 'docs/design/time-and-turns.md',
    files: ['docs/design/time-and-turns.md'],
  },
  {
    name: 'rolls-and-damage.md',
    label: 'docs/design/rolls-and-damage.md',
    files: ['docs/design/rolls-and-damage.md'],
  },
  {
    name: 'characters-and-equipment.md',
    label: 'docs/design/characters-and-equipment.md',
    files: ['docs/design/characters-and-equipment.md'],
  },
  // `docs/design/claude-integration.md` is not registered for the same
  // reason: nothing quotes it yet. Register it with its first citation.
  {
    name: 'srd-policy.md',
    label: 'docs/rules/srd-policy.md',
    files: ['docs/rules/srd-policy.md'],
  },
];

/**
 * Every quoted run in one piece of prose, attributed to the last document
 * named before it.
 *
 * **Nearest preceding name**, which is a rule an author can hold in their head
 * rather than a matcher whose behaviour nobody can predict: name the document,
 * then quote it. Its one cost is that a quotation of something *else* is read
 * as belonging to whatever was named last, so a description quoting a second
 * source has to name that one too — which is the habit this guard exists to
 * enforce rather than a concession. A run with no document named anywhere
 * before it is nobody's citation and is skipped, as is one attributed to a
 * name the table gives no file.
 *
 * The scans it composes — {@link namesIn}, {@link quotedRunsIn} — and the
 * containment test underneath {@link misquotes} moved to `citations.ts` when
 * IE-052 pointed the same instrument at `docs/dev/tasks/`. The floor, the
 * normalisation and the elision are shared; **this attribution rule is not**,
 * because the brief corpus needs a different one and a flag argument standing
 * in for two honest rules would be worse than two named functions.
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

/** Every citation in this corpus the document it named does not contain. */
const misquotes = (corpus: Iterable<readonly [string, string]>): string[] =>
  misquotedIn(corpus, citationsIn);

/** Every piece of prose in these three maps that may cite this repository. */
function citedProse(): Array<readonly [string, string]> {
  return [
    ...Object.entries(MISSING_SHAPES).map(([shape, description]) => [shape, description] as const),
    ...Object.entries(ADJUDICATED).flatMap(([spellId, entries]) =>
      entries.map((entry) => [`${spellId}: ${entry.clause}`, entry.note] as const),
    ),
    ...Object.entries(TRACKED_ADJUDICATED).flatMap(([spellId, written]) =>
      written.map((entry) => [`${spellId}: ${entry.marker}`, entry.note] as const),
    ),
    // The undefined population's clause notes, once an entry has any: they cite
    // this repository exactly as the other two maps' notes do, and a guard that
    // read two of the three maps would be narrower than it reads.
    ...Object.entries(BLOCKED_ON).flatMap(([spellId, entry]) =>
      clausesIn(entry).map((clause) => [`${spellId}: ${clause.clause}`, clause.note] as const),
    ),
  ];
}

describe('a shape says where this repository already described it', () => {
  /**
   * The rule that keeps the vocabulary from becoming a private language — the
   * one `spell-honesty.test.ts` introduced, now asked of the whole map.
   *
   * The names are read off {@link CITED_SOURCES} rather than written out a
   * second time, so the list a description must name and the list a quotation
   * is checked against cannot drift apart.
   */
  it('makes every shape point at prose somebody already reviewed', () => {
    const sources = CITED_SOURCES.filter((source) => source.files.length > 0).map(
      (source) => source.name,
    );
    for (const [shape, description] of Object.entries(MISSING_SHAPES)) {
      const said = description.toLowerCase();
      expect(
        sources.filter((source) => said.includes(source)),
        `${shape} names no place this repository already described it`,
      ).not.toEqual([]);
    }
  });

  /** A description that says nothing is a licence, so each must be a real sentence. */
  it('writes a real sentence for every shape', () => {
    for (const [shape, description] of Object.entries(MISSING_SHAPES)) {
      expect(description.length, shape).toBeGreaterThan(120);
    }
  });

  /**
   * No shape may sit in the vocabulary unclaimed — now over all three
   * populations, which is the whole reason the three maps share one list.
   *
   * Asked of one population it deletes every shape only the others name. IE-010
   * is the precedent for what happens when a shape genuinely empties: it
   * removed `outcome-scoped-child-effects` rather than renaming it, because
   * re-filing its last claimant left a shape nothing was blocked on.
   */
  it('keeps no shape nothing is blocked on', () => {
    const claimed = claimedShapes();
    expect(Object.keys(MISSING_SHAPES).filter((shape) => !claimed.has(shape))).toEqual([]);
  });

  /** And nothing claims a shape the vocabulary has dropped. */
  it('has a vocabulary that covers every claim', () => {
    const known = new Set<string>(Object.keys(MISSING_SHAPES));
    expect([...claimedShapes()].filter((shape) => !known.has(shape))).toEqual([]);
  });
});

/**
 * Naming a document is not quoting it, and the guard above only ever asked for
 * the name.
 *
 * It is a substring test for a *source name*, so a description could name
 * `CLAUDE.md` and then quote a sentence `CLAUDE.md` does not contain — which
 * is exactly what happened: **two misquotes of `CLAUDE.md` shipped inside
 * tranche 4** and were caught by a reviewer reading rather than by a test.
 * This is the other half of the same rule, and the shape is
 * `spell-honesty.test.ts`'s, which holds an `unmodelled` note's SRD quotation
 * against that spell's own paragraph after four notes were found attributing
 * to the book a sentence it does not print. Same failure, the other axis: a
 * claim about a document, checked against the document.
 */
describe('a citation is held against the document it names', () => {
  /**
   * The guard, driven by a misquote built to be caught.
   *
   * The synthetic **inverts a sentence `CLAUDE.md` really prints**, because
   * that is the failure in its hardest form: the file is named, the file
   * exists, the subject is right, and nothing but opening it can tell the two
   * apart. A guard nobody has seen fire is a guard nobody has tested.
   */
  it('catches a description quoting a sentence the named document does not print', () => {
    const misquoted = 'docs/rules/srd-policy.md says it outright: "A Goblin Warrior is Humanoid, not Fey".';
    expect(misquotes([['synthetic-shape', misquoted]])).toEqual([
      expect.stringContaining('A Goblin Warrior is Humanoid, not Fey'),
    ]);
  });

  /** And it passes the moment the quotation is the sentence the file prints. */
  it('passes once that quotation is corrected', () => {
    const quoted = 'docs/rules/srd-policy.md says it outright: "A Goblin Warrior is Fey, not Humanoid".';
    expect(misquotes([['synthetic-shape', quoted]])).toEqual([]);
  });

  /**
   * **This repository states one sentence two ways, and the guard must not
   * pick for it.**
   *
   * `docs/design/spell-definitions.md` writes Mass Cure Wounds' range rule as
   * "the point **rather than** to each target" and `spell-definitions.ts`
   * writes it as "the point, **not** to each target". Both are correct in
   * their own file, so the quotation is resolved by *naming*: a citation of
   * the design document is checked against the design document. Neither
   * document is edited, and neither spelling is preferred.
   */
  it('holds each of the two spellings of one sentence against its own file', () => {
    expect(
      misquotes([
        ['design-doc-side', 'docs/design/spell-definitions.md: "The range then belongs to the point rather than to each target".'],
        [
          'definition-side',
          'spell-definitions.ts: "The range then belongs to the point, not to each target".',
        ],
      ]),
    ).toEqual([]);
  });

  /**
   * And swapped, both fail — which is what resolving *by naming* buys.
   *
   * A guard that checked a run against every document the table knows would
   * pass this, and would then be unable to tell a citation of one file from a
   * citation of the other. That is the whole distinction the two spellings
   * exist to test.
   */
  it('fails each spelling when it is attributed to the other file', () => {
    expect(
      misquotes([
        ['design-doc-side', 'docs/design/spell-definitions.md: "The range then belongs to the point, not to each target".'],
        [
          'definition-side',
          'spell-definitions.ts: "The range then belongs to the point rather than to each target".',
        ],
      ]),
    ).toHaveLength(2);
  });

  /**
   * An elision reads forwards, so a quotation cannot reorder its document.
   *
   * Citations here elide constantly — seventeen quoted runs in
   * `missing-shapes.ts` carry a `...` — so the alternative to reading one was
   * rewriting all of them. What it must not buy is a licence to assemble a
   * sentence the document never made, so the parts are matched in order.
   */
  it('reads an elision forwards and refuses one that runs backwards', () => {
    const forwards =
      'docs/rules/srd-policy.md: "Advantage is presence, not arithmetic ... Three advantages against one disadvantage is a *normal* roll".';
    const backwards =
      'docs/rules/srd-policy.md: "Three advantages against one disadvantage is a *normal* roll ... Advantage is presence, not arithmetic".';
    expect(misquotes([['forwards', forwards]])).toEqual([]);
    expect(misquotes([['backwards', backwards]])).toHaveLength(1);
  });

  /**
   * A quotation of the book is not a claim about this repository.
   *
   * Every `SRD:` note in these maps would otherwise be looked up in whichever
   * document was named before it. `spell-honesty.test.ts` already holds those
   * against the spell's own paragraph, which is the only text that can answer
   * them.
   */
  it('leaves a quotation attributed to the SRD to the guard that owns it', () => {
    const note =
      'CLAUDE.md files it as debt. SRD: "the sword vanishes into a puff of glittering dust".';
    expect(misquotes([['synthetic-spell', note]])).toEqual([]);
  });

  /**
   * The corpus, and the assertion that the corpus is not vacuous.
   *
   * Every document the table names must be quoted somewhere: a name with no
   * citation is an alias nothing uses, which is the speculative-member failure
   * this repository sweeps for everywhere else — and it would make the guard
   * quietly narrower than it reads.
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

  /**
   * And the real thing: every description and every note quotes the document
   * it names.
   *
   * Where this found a misquote the **description** was corrected, never the
   * cited document. Two were stale rather than invented — `PROGRESS.md`'s
   * ranked map was re-derived and its rows now carry two columns — and one,
   * "4 printed, far more in play", appears nowhere in this repository at all.
   */
  it('quotes every document these maps name', () => {
    expect(misquotes(citedProse())).toEqual([]);
  });
});

/**
 * Clauses a build finished while the shape they were filed to lived on.
 *
 * The second honest reason a clause may leave the map, and it exists because a
 * shape can be built **in part**. IE-030 gave a casting the fought fact —
 * `CastSpellRequest.fought`, refused when the spell prints no such clause and
 * required when it does — so the five spells that read that fact as Advantage
 * on their save now roll it, and their clauses are no longer adjudications at
 * all. `a-fact-only-the-table-can-declare` nonetheless stands, because the
 * *other* facts under it are not built: Scrying's table of how well you know
 * the target, Call Lightning's outdoor storm, and Enthrall reading the very
 * same fought fact as an automatic **success**, which `checks.ts` has no
 * `autoSucceed` for.
 *
 * So this list is the honest residue of a partial build rather than a licence:
 * every entry must genuinely be gone from `ADJUDICATED`, which the guard below
 * checks in both directions, and adding one means a reviewer has read the
 * sentence and agrees the engine now finishes it.
 */
const BUILT_CLAUSES: readonly (readonly [string, string])[] = [
  ['charm-monster', 'the save has Advantage'],
  ['charm-person', 'the save has Advantage'],
  ['dominate-beast', 'the save has Advantage'],
  ['dominate-monster', 'the save has Advantage'],
  ['dominate-person', 'the save has Advantage'],
];

describe('the split bundles add back up', () => {
  /**
   * The evidence that splitting three bundle ids preserved the facts.
   *
   * The audit's complaint was arithmetic — "every per-shape count derived from
   * that map inherits the bundle" — so the repair is checked as arithmetic.
   * Each recorded `[spellId, clause, wentTo]` triple must still be an
   * adjudication filed exactly where the split put it.
   *
   * **Unless what it went to has since been built**, which is the only honest
   * reason a clause may leave the map, and it comes two ways. The shape may be
   * gone: IE-019 built `an-outcome-that-varies-by-creature-type` and executed
   * Shatter with it. Or the shape may stand while *this clause* is finished,
   * which is {@link BUILT_CLAUSES} — a reviewed list, because a shape can be
   * built in part and nothing derived can tell that from a silent loss. A
   * clause that vanished under neither reason fails here, which is what keeps
   * the exception a branch rather than a hole.
   */
  /**
   * Where an entry is filed **now**, whichever population it belongs to.
   *
   * The three maps are keyed three different ways, so the middle slot of a
   * recorded triple is three different things: an adjudication's `clause`
   * phrase, a tracked marker key, or — where a `BLOCKED_ON` entry has no
   * clause at all — the bundle id itself, which is the whole of what that
   * entry says. A resolver that could only reach the executed population would
   * count a bundle spanning all three short, which is the very error
   * `missing-shapes.ts` was assembled to end: `speed-and-movement-modes` held
   * sixteen spells across all three.
   */
  const filedAt = (spellId: string, clause: string, wentTo: string): string | undefined => {
    const executed = (ADJUDICATED[spellId] ?? []).find((e) => e.clause === clause);
    if (executed !== undefined) return executed.why;
    // The tracked map is keyed by *marker*, a closed union, so the lookup goes
    // through its entries rather than by index: a recorded triple is history
    // and may name a marker the vocabulary has since dropped.
    const tracked = (TRACKED_ADJUDICATED[spellId] ?? []).find(
      (entry) => entry.marker === clause,
    );
    if (tracked !== undefined) return tracked.why;
    // An undefined spell's entry is a bare shape id, so the question it can
    // answer is whether the destination is on that spell's list now. That is
    // weaker than the clause lookup above and it is the strongest thing a list
    // with no clauses in it supports — and it still catches the loss, because
    // a destination quietly dropped takes the branch below.
    return blockersOf(spellId).find((shape) => shape === wentTo);
  };

  it.each(Object.keys(SPLIT_BUNDLES))('accounts for every adjudication %s held', (bundle) => {
    const split = SPLIT_BUNDLES[bundle]!;
    const live = new Set<string>(Object.keys(MISSING_SHAPES));
    const built = new Set(BUILT_CLAUSES.map(([id, clause]) => `${id}/${clause}`));
    const landed = new Map<string, number>();

    for (const [spellId, clause, wentTo] of split.held) {
      const why = filedAt(spellId, clause, wentTo);
      if (why === undefined) {
        expect(
          live.has(wentTo) && !built.has(`${spellId}/${clause}`),
          `${spellId}: "${clause}" left the map while ${wentTo} is still missing`,
        ).toBe(false);
      } else {
        expect(why, `${spellId}/${clause}`).toBe(wentTo);
      }
      landed.set(wentTo, (landed.get(wentTo) ?? 0) + 1);
    }

    // The counts sum to what the bundle claimed, over the spells it claimed.
    expect([...landed.values()].reduce((a, b) => a + b, 0)).toBe(split.adjudications);
    expect(split.held).toHaveLength(split.adjudications);
    expect(new Set(split.held.map(([id]) => id)).size).toBe(split.spells);
    // And the split really is a split: more than one destination, every one of
    // them either a live shape or one that has since been built.
    expect(new Set(split.held.map(([, , wentTo]) => wentTo)).size).toBeGreaterThan(1);
  });

  /** And the bundle id itself is gone from every map, not merely unused. */
  it.each(Object.keys(SPLIT_BUNDLES))('no longer files anything to %s', (bundle) => {
    if (Object.keys(MISSING_SHAPES).includes(bundle)) {
      // `a-mode-on-the-save-a-spell-forces` kept its id and lost five of its
      // six claimants: the audit found its *description* misstated its own
      // blocker, not that the mechanism was imaginary. What must be true is
      // that nothing it used to hold wrongly is still filed to it.
      const held = new Set(
        SPLIT_BUNDLES[bundle]!.held.map(([id, clause]) => `${id}/${clause}`),
      );
      for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
        for (const entry of entries) {
          if (entry.why !== bundle) continue;
          expect(held.has(`${spellId}/${entry.clause}`)).toBe(false);
        }
      }
      return;
    }
    expect(claimedShapes().has(bundle)).toBe(false);
  });

  /**
   * `outcome-scoped-child-effects` is IE-010's, and this file must not bring
   * it back. It removed the id when the rider vocabulary was built rather than
   * renaming it, because a shape nothing is blocked on is one the guard above
   * deletes.
   */
  it('does not resurrect the bundle IE-010 removed', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('outcome-scoped-child-effects');
    expect(Object.keys(MISSING_SHAPES)).not.toContain('outcome-riders');
    expect(Object.keys(SPLIT_BUNDLES)).not.toContain('outcome-scoped-child-effects');
  });

  /**
   * And a clause claimed as built must really be gone.
   *
   * The other direction, without which {@link BUILT_CLAUSES} is a list anybody
   * could write a spell's name into to make the arithmetic stop complaining.
   * A stale entry is a claim that the engine finishes something it does not.
   */
  it('keeps no built clause that is still adjudicated', () => {
    for (const [spellId, clause] of BUILT_CLAUSES) {
      expect(
        (ADJUDICATED[spellId] ?? []).map((entry) => entry.clause),
        `${spellId} still adjudicates "${clause}"`,
      ).not.toContain(clause);
    }
  });
});

describe('the fought fact is a second build that corrected the query', () => {
  /**
   * **The map predicted one spell finished and the SRD says none is.**
   *
   * `a-fact-only-the-table-can-declare` blocked nine spells and was the *only*
   * blocker recorded for Enthrall, so the derivation said building the fought
   * fact would finish it. IE-030 built it and read the paragraph, and Enthrall
   * prints a different sentence from the five that named the shape with it:
   *
   * | Predicted | What happened |
   * |---|---|
   * | Charm Person, Charm Monster, the three Dominates lose the clause | **five clauses closed** — right |
   * | Modify Memory loses the blocker | right, in different words: "If you are fighting the creature, it has Advantage on the save" |
   * | Enthrall finished | **wrong**, twice over |
   *
   * SRD Enthrall: "Any creature you or your companions are fighting
   * automatically succeeds on this save." The *fact* is now declarable and the
   * **outcome** is not — `checks.ts` carries `autoFail` and no `autoSucceed` —
   * and its failure branch is "a −10 penalty to Wisdom (Perception) checks and
   * Passive Perception", which `BonusApplies` cannot narrow to a skill and
   * which nothing reaches on a Passive score at all.
   *
   * This is IE-017's lesson arriving a second time: a count is only as good as
   * the shape it counts, and the way to find out which shapes are bundles is
   * to build one. So the residue is a narrower id, exactly as
   * `a-condition-immunity-a-spell-grants` was.
   */
  it('closes the five spells whose paragraph prints Advantage', () => {
    for (const id of [
      'charm-person',
      'charm-monster',
      'dominate-beast',
      'dominate-person',
      'dominate-monster',
    ]) {
      const shapes = (ADJUDICATED[id] ?? []).map((entry) => entry.why);
      expect(shapes, id).not.toContain('a-fact-only-the-table-can-declare');
    }
    // And Modify Memory, which prints the same rule in different words.
    expect(blockersOf('modify-memory')).toEqual(['a-casting-ended-by-a-trigger']);
  });

  /**
   * Enthrall is the correction, and it keeps **both** halves of why.
   *
   * The fought shape stands because Enthrall's reading of that fact is still
   * unexpressible; the minted id carries the penalty, which was never about
   * the fact at all and which the entry had never recorded.
   */
  it('leaves Enthrall blocked, on the outcome and on the penalty', () => {
    expect(blockersOf('enthrall')).toEqual([
      'a-bonus-narrowed-to-a-skill',
      'a-fact-only-the-table-can-declare',
    ]);
    expect(consumersOf('a-fact-only-the-table-can-declare').unblocks).toEqual([]);
  });

  /**
   * And the shape survives on the facts nobody has built.
   *
   * **It has an executed claimant now, and that is the shape working rather
   * than drifting.** IE-035 defined Hunter's Mark, whose "Advantage on any
   * Wisdom (Perception or Survival) check you make **to find it**" is this
   * same gap read off a check: the selector can name Wisdom (Perception)
   * perfectly well and nothing can say which check is the one made to find the
   * quarry. A spell moving from `BLOCKED_ON` into `ADJUDICATED` while keeping
   * a shape is exactly what a partial definition is.
   */
  it('keeps the shape for the facts the build did not reach', () => {
    const fact = consumersOf('a-fact-only-the-table-can-declare');
    expect(fact.undefined).toEqual(['call-lightning', 'enthrall', 'scrying']);
    expect(fact.executed).toEqual(['hunters-mark']);
  });
});

describe('a consumer count is a query', () => {
  /**
   * **The query predicted a build, and the build tested the query.**
   *
   * Before IE-017 existed this map said `a-defence-a-spell-grants` was the only
   * blocker for exactly two spells — Stoneskin and Mind Blank — reproducing
   * Fable's "2 whole, 1 partial" from data rather than quoting it. IE-017 then
   * built that shape, independently, and the result is the strongest evidence
   * this file has and the sharpest correction in it:
   *
   * | Predicted | What happened |
   * |---|---|
   * | Stoneskin finished | **defined and verified** — right |
   * | Mind Blank finished | still undefined — *wrong* |
   * | Protection from Energy partial | **defined and verified** — also wrong |
   *
   * Both misses are one mistake, and it is a bundle in this very vocabulary.
   * `a-defence-a-spell-grants` claimed condition Immunity was "the same storage
   * and the same sentence shape"; IE-017 built `CreatureState.defenses` and
   * touched `conditionApplicability` not at all, so Mind Blank's "Immunity to
   * Psychic damage **and the Charmed condition**" kept half a blocker. And the
   * damage type Protection from Energy chooses turned out to be expressible
   * already, once IE-017 gave `damageTypeStated` a second user.
   *
   * So the shape is retired, the condition half is its own id, and the lesson
   * is the audit's own in miniature: a count is only as good as the shape it
   * counts, and the way to find out is to build one.
   */
  it('retires the shape IE-017 built, and keeps the half it did not', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('a-defence-a-spell-grants');
    expect(claimedShapes().has('a-defence-a-spell-grants')).toBe(false);

    // The right half of the prediction: Stoneskin is defined, so it is out.
    expect(BLOCKED_ON['stoneskin']).toBeUndefined();
    expect(BLOCKED_ON['protection-from-energy']).toBeUndefined();

    // The wrong half, and where it went.
    expect(blockersOf('mind-blank')).toEqual(['a-condition-immunity-a-spell-grants']);
    expect(consumersOf('a-condition-immunity-a-spell-grants').unblocks).toEqual(['mind-blank']);
  });

  /**
   * And a damage type chosen at the casting is no longer a blocker at all.
   *
   * `damageTypeStated` was written for Spirit Guardians, where the SRD decides
   * the type on a fact the engine does not hold, and its docstring said a
   * second user would be the evidence it should generalise. IE-017's
   * Protection from Energy is that user and chooses for the opposite reason,
   * so the field carries both — which takes six spells' worth of
   * `a-choice-made-at-the-casting` filings off the map.
   */
  it('no longer blocks a spell whose only choice is a damage type', () => {
    for (const id of [
      'chromatic-orb',
      'conjure-elemental',
      'dragons-breath',
      'resistance',
      'sorcerous-burst',
      'true-strike',
    ]) {
      expect(blockersOf(id), id).not.toContain('a-choice-made-at-the-casting');
    }
    // And still blocks one whose choice is anything else: an ability, a
    // condition, one of six wonders, which of five effects to remove.
    for (const id of ['hex', 'blindness-deafness', 'thaumaturgy', 'greater-restoration']) {
      const shapes =
        BLOCKED_ON[id] === undefined ? (ADJUDICATED[id]?.map((e) => e.why) ?? []) : blockersOf(id);
      expect(shapes, id).toContain('a-choice-made-at-the-casting');
    }
  });

  /**
   * The whole "four Conjures" row, which is wrong about all six of them.
   *
   * `CLAUDE.md`'s "A stat block created mid-fight" row said "the four
   * Conjures". SRD 5.2.1 rewrote the family as *spirits* — a pack, a pillar
   * of light, an Emanation, a point you strike from — and not one of the six
   * prints an Armour Class, Hit Points or a turn. The brief said the SRD wins
   * where the prose disagrees; this is what keeps the correction from drifting
   * back, and it names spells the row *is* right about so the shape does not
   * lose its real consumers either.
   */
  it('files no Conjure spell under a stat block, and keeps the ones that print one', () => {
    const statBlock = consumersOf('a-stat-block-created-mid-fight');
    expect(statBlock.blocks.filter((id) => id.startsWith('conjure-'))).toEqual([]);
    for (const id of ['unseen-servant', 'arcane-hand', 'summon-dragon', 'giant-insect']) {
      expect(statBlock.undefined, id).toContain(id);
    }
    // Guardian of Faith and Faithful Hound are the pair that proves the row was
    // read rather than copied: both are invulnerable spectral things, and only
    // one of the two is a creature — neither, as it turns out.
    expect(blockersOf('faithful-hound')).not.toContain('a-stat-block-created-mid-fight');
    expect(blockersOf('guardian-of-faith')).not.toContain('a-stat-block-created-mid-fight');
  });

  /**
   * And the smallest number the ranked map printed, which comes out one higher.
   *
   * `PROGRESS.md` ranks "Reads the target's current Hit Points | 3" and names
   * the three Power Words. Aura of Life is a fourth — "If an ally with 0 Hit
   * Points starts its turn in the aura, that ally regains 1 Hit Point" — and it
   * is in the ranked map's own population. A three-spell family counted by hand
   * was still wrong, which is the argument for deriving even the small ones.
   *
   * **Hunter's Mark and Hex are the fifth and sixth, and they are one
   * sentence.** SRD gives both "If the target drops to 0 Hit Points before
   * this spell ends, you can take a Bonus Action ... to curse a new creature",
   * and IE-035 defined Hunter's Mark without that clause while leaving Hex
   * undefined. It filed the sentence for one of them and not the other on its
   * first pass, which moved this shape's `unblocks` from 0 to 1 on the
   * strength of a spell that prints the same rule — the argument for re-filing
   * **both ends of a shared sentence in the same pass**, and for reading the
   * paragraph rather than the brief, which said Hex would be blocked on its
   * chosen ability alone.
   */
  it('finds one more than the ranked map did for reading the target’s Hit Points', () => {
    expect(consumersOf('an-outcome-that-reads-the-targets-hit-points').blocks).toEqual([
      'aura-of-life',
      'divine-word',
      'hex',
      'hunters-mark',
      'power-word-kill',
      'power-word-stun',
    ]);
  });

  /**
   * A shape both a definition and an undefined spell name is counted once each.
   *
   * `speed-and-movement-modes` was the example and is gone; `movement-modes`
   * is the half of it that stands, and it still spans two populations — two
   * tracked definitions and a run of undefined spells — which is the property
   * being asserted. The executed population has none, and that is the split's
   * own result rather than an accident: IE-033 built the modifier half, which
   * is the only half any *definition* had.
   */
  it('adds all three populations up', () => {
    const modes = consumersOf('movement-modes');
    expect(modes.executed).toEqual([]);
    expect(modes.tracked).toEqual(['fly', 'spider-climb']);
    expect(modes.undefined.length).toBeGreaterThan(5);
    expect(modes.blocks.length).toBe(
      modes.executed.length + modes.tracked.length + modes.undefined.length,
    );
  });

  /** `unblocks` is a subset of `blocks`, and of the undefined population. */
  it('never claims to unblock a spell it does not block', () => {
    for (const row of allShapeConsumers()) {
      for (const id of row.unblocks) {
        expect(row.undefined, row.shape).toContain(id);
        expect(blockersOf(id)).toEqual([row.shape]);
      }
    }
  });

  /** Every shape is reported, heaviest first, with no gaps or repeats. */
  it('reports every shape once, ranked', () => {
    const rows = allShapeConsumers();
    expect(rows.map((row) => row.shape).sort()).toEqual(Object.keys(MISSING_SHAPES).sort());
    for (let i = 1; i < rows.length; i += 1) {
      const before = rows[i - 1]!;
      const after = rows[i]!;
      expect(
        before.unblocks.length > after.unblocks.length ||
          (before.unblocks.length === after.unblocks.length &&
            (before.blocks.length > after.blocks.length ||
              (before.blocks.length === after.blocks.length &&
                before.shape.localeCompare(after.shape) < 0))),
        `${before.shape} before ${after.shape}`,
      ).toBe(true);
    }
  });

  /**
   * The single largest blocker in the undefined population, named rather than
   * felt: fifty-odd spells cannot be cast at all because the casting takes a
   * minute or more, which `resolveCast` refuses.
   */
  it('names the largest blocker in the undefined population', () => {
    const ranked = [...allShapeConsumers()].sort((a, b) => b.blocks.length - a.blocks.length);
    expect(ranked[0]!.shape).toBe('a-long-casting-time');
    expect(ranked[0]!.blocks.length).toBeGreaterThan(40);
  });
});

describe('a spell with one blocker is the leverage the map is for', () => {
  /**
   * Magic Missile is the spell that proves the second column is worth reading,
   * and it is **not** on the list below.
   *
   * "Damage with neither an attack roll nor a save" is the clause everybody
   * quotes it for, and `PROGRESS.md` ranks that shape at 19 open spells. But
   * the darts are *distributed* — "you can direct them to hit one creature or
   * several" — and a casting that names the same target twice is refused, so
   * three darts into one goblin cannot be said at all. That is the same gap
   * Mass Heal's "divided as you choose" has, and it is not downstream of the
   * first: you meet it in the same sentence rather than after the missing
   * mechanism is built.
   *
   * **The distinction is what keeps `unblocks` honest, and the case it was
   * written against has since come true.** Dimension Door's 4d6 on a failed
   * arrival is damage with no roll too, and while nothing could teleport it
   * was *not* a second blocker: the damage was unreachable until the first
   * shape existed. A blocker you would meet anyway counts; one you could only
   * meet afterwards does not. IE-037 built teleportation, the spell left the
   * map, and the 4d6 became exactly what this paragraph predicted — a clause
   * an **executed** definition carries and does not finish, filed under this
   * very shape in `ADJUDICATED`.
   */
  it('does not call Magic Missile finished by one shape', () => {
    expect(blockersOf('magic-missile')).toEqual([
      'a-spells-effects-applied-to-different-targets',
      'damage-with-neither-an-attack-roll-nor-a-save',
    ]);
    expect(BLOCKED_ON['dimension-door']).toBeUndefined();
    expect(ADJUDICATED['dimension-door']?.map((entry) => entry.why)).toEqual([
      'a-spells-effects-applied-to-different-targets',
      'damage-with-neither-an-attack-roll-nor-a-save',
    ]);
  });

  /**
   * Spot-checks, each transcribed from the spell's own SRD paragraph, because
   * a map that nothing reads back is the prose it replaced in another costume.
   *
   * **A row leaves this list by being built**, which has now happened twice:
   * Stoneskin stood here until IE-017 defined it, and Divine Favor —
   * "your attacks with weapons deal an extra 1d4 Radiant damage on a hit" —
   * until IE-035 did. Both were the map's prediction coming true, and the row
   * going rather than the assertion being loosened is what keeps the list a
   * claim about spells nobody has finished.
   */
  const SOLE: readonly (readonly [string, ShapeId])[] = [
    // "the target's skin assumes a bark-like appearance, and the target has an
    // Armor Class of 17 if its AC is lower than that" — a floor on the total.
    ['barkskin', 'an-armor-class-a-spell-floors'],
    // "restoring 70 Hit Points" — the conditions it ends are `end-condition`
    // now, and the printed 70 is the whole of what is left.
    ['heal', 'a-flat-amount-with-no-dice'],
    // "Make a ranged spell attack for each ray."
    ['scorching-ray', 'several-attack-rolls-from-one-casting'],
    // "You touch a creature that has died within the last minute."
    ['revivify', 'healing-that-raises-the-dead'],
    // "Choose up to five falling creatures within range."
    ['feather-fall', 'falling'],
    // "Immunity to Psychic damage **and the Charmed condition**" — the damage
    // half is built and the condition half is not, which is the whole of what
    // is left. Stoneskin stood here until IE-017 defined it.
    ['mind-blank', 'a-condition-immunity-a-spell-grants'],
  ];

  it.each(SOLE)('%s is blocked on %s and nothing else', (spellId, shape) => {
    expect(blockersOf(spellId)).toEqual([shape]);
  });
});

describe('a shape that gets built is content work, not a merge', () => {
  /**
   * IE-014 built condition removal as `end-condition`, and eleven entries here
   * named it. Re-reading them is the work a textual rebase would have skipped:
   * the shape ends up with **no** claimants and is retired, exactly as IE-010
   * retired `outcome-scoped-child-effects`.
   *
   * What `end-condition` takes is a list of `ConditionName`, so it finishes a
   * spell that ends a printed list and no more. The four readings below are the
   * ones worth pinning, because each is a different reason:
   */
  it('has retired the shape `end-condition` solved', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('condition-removal');
    expect(claimedShapes().has('condition-removal')).toBe(false);
  });

  // Heal ends "the Blinded, Deafened, and Poisoned conditions" — a printed
  // list, so the removal is done and the flat 70 is all that is left.
  it('finishes the removal half of Heal', () => {
    expect(blockersOf('heal')).toEqual(['a-flat-amount-with-no-dice']);
  });

  // Greater Restoration removes "one of the following", and one of them is
  // "1 Exhaustion level" — a level rather than a condition, which a list of
  // condition names cannot say.
  it('keeps what a list of condition names cannot remove', () => {
    expect(blockersOf('greater-restoration')).toContain('an-exhaustion-level-a-spell-changes');
    expect(blockersOf('greater-restoration')).toContain('a-choice-made-at-the-casting');
    expect(consumersOf('an-exhaustion-level-a-spell-changes').blocks).toEqual([
      'greater-restoration',
      'wish',
    ]);
  });

  // Calm Emotions *suppresses* a condition it did not cause and restores it
  // when the spell ends, which is the granted Immunity rather than a removal.
  it('reads suppression as the granted immunity it is', () => {
    expect(blockersOf('calm-emotions')).toEqual([
      'a-condition-immunity-a-spell-grants',
      'a-spells-effects-applied-to-different-targets',
    ]);
  });

  /**
   * **IE-037 built teleportation and the shape was retired**, which is the
   * third id to go that way and the first whose claimants divided three ways
   * rather than narrowing.
   *
   * Eight spells named it and only two were finished by it. Re-reading the
   * other six against their own paragraphs found that **not one of them was
   * ever blocked on a teleport the engine could perform**:
   *
   * | | |
   * |---|---|
   * | Forbiddance, Magic Circle, Hallow | print a ward that **stops** a teleport — "creatures can't teleport into the area" — which is an area that suppresses magic rather than one that performs it |
   * | Teleport, Teleportation Circle | send the party to a destination "on the same plane" and off the scene entirely, which is the second place the engine has nowhere to put anybody |
   * | Blink | returns its caster "to an unoccupied space of your choice ... within 10 feet", which this build performs; what is left is the Ethereal Plane and a 1d6 |
   *
   * So the shape had one honest claimant apiece and none of them was this one,
   * which is IE-017's lesson from the other direction: a count is only as good
   * as the shape it counts, and building one is how anybody finds out.
   */
  it('has retired the shape IE-037 built, and re-filed every claimant', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('teleportation');
    expect(claimedShapes().has('teleportation')).toBe(false);

    // The two it finished are out of the map and into their own populations.
    expect(BLOCKED_ON['dimension-door']).toBeUndefined();
    expect(BLOCKED_ON['tree-stride']).toBeUndefined();

    // A ward against arriving is suppression, not teleportation.
    for (const id of ['forbiddance', 'magic-circle', 'hallow']) {
      expect(blockersOf(id), id).toContain('an-effect-that-suppresses-other-magic');
    }
    // A destination off the scene is the second place, which one of the two
    // already named and the other had never recorded at all.
    for (const id of ['teleport', 'teleportation-circle']) {
      expect(blockersOf(id), id).toContain('a-second-place-to-put-a-creature');
    }
    // And Blink keeps the two halves this build does not reach.
    expect(blockersOf('blink')).toEqual([
      'a-random-outcome-that-is-not-a-d20',
      'a-second-place-to-put-a-creature',
    ]);
  });

  // And the two spells IE-014 defined leave the map entirely, with their debt
  // in ADJUDICATED where an executed spell's debt belongs.
  it('moves a newly defined spell out of the map and into the adjudications', () => {
    expect(BLOCKED_ON['lesser-restoration']).toBeUndefined();
    expect(BLOCKED_ON['protection-from-poison']).toBeUndefined();
    expect(ADJUDICATED['lesser-restoration']?.map((e) => e.why)).toEqual([
      'a-choice-made-at-the-casting',
    ]);
    // IE-014 gave this two adjudications and IE-017 built one of them away, so
    // the Resistance clause is executed and only the condition-keyed save is
    // left. Two merges, one entry, and the map says which half survived.
    expect(ADJUDICATED['protection-from-poison']?.map((e) => e.why)).toEqual([
      'a-save-keyed-to-a-condition',
    ]);
  });
});

describe('a shape may finish nothing and still block forty-two spells', () => {
  /**
   * **IE-034 built the largest blocker in the book and IE-036 spent it**, and
   * what is left is the state this file had not seen before: a shape with a
   * long list of claimants and an `unblocks` of **zero**.
   *
   * The twelve `a-long-casting-time` was the only blocker for were read
   * paragraph by paragraph and written as tracked definitions, so they leave
   * the map entirely — and every remaining claimant names it *and something
   * else*, which is what makes the second column empty rather than the shape
   * retired. `blocks` is the number a reader wants and `unblocks` is the
   * number a tranche is planned from, and this is the clearest case in the map
   * of the two saying different things.
   *
   * Not retired, because the guard that retires a shape asks whether anything
   * claims it and forty-two spells do. What is genuinely gone is the *content*
   * half of the shape: nothing else can be finished by building the in-combat
   * per-turn obligation alone.
   */
  it('has finished every spell it was the only blocker for', () => {
    const casting = consumersOf('a-long-casting-time');
    expect(casting.unblocks).toEqual([]);
    expect(casting.blocks.length).toBeGreaterThan(40);
    expect(claimedShapes().has('a-long-casting-time')).toBe(true);
  });

  /** The twelve are out of the map, and every one of them is now a definition. */
  it.each([
    ['alarm'],
    ['clairvoyance'],
    ['commune-with-nature'],
    ['fabricate'],
    ['find-the-path'],
    ['hallucinatory-terrain'],
    ['identify'],
    ['illusory-script'],
    ['instant-summons'],
    ['legend-lore'],
    ['magic-mouth'],
    ['mending'],
  ] as const)('has moved %s out of the undefined population', (spellId) => {
    expect(BLOCKED_ON[spellId]).toBeUndefined();
    expect(DEFINED_SPELL_IDS.has(spellId), spellId).toBe(true);
  });

  /**
   * And the two of the twelve that carry a mechanical clause are in the
   * **tracked** map, which is where a tracked spell's debt belongs — the other
   * ten name nothing the markers can see, which is what "tracked" is supposed
   * to mean and is the measure of how well the twelve fitted the bucket.
   */
  it('files the two clauses the twelve carry in the tracked map', () => {
    expect(TRACKED_ADJUDICATED['hallucinatory-terrain']?.map((e) => e.why)).toEqual(['engine']);
    expect(TRACKED_ADJUDICATED['magic-mouth']?.map((e) => e.why)).toEqual(['table']);
    for (const id of ['alarm', 'clairvoyance', 'identify', 'mending']) {
      expect(TRACKED_ADJUDICATED[id], id).toBeUndefined();
    }
  });
});

describe('a trigger that ends a casting is a partial build, and the map says which part', () => {
  /**
   * **IE-032 built five causes out of a shape that names many more**, which is
   * the first entry here to stay in the vocabulary on the strength of what it
   * still blocks rather than being retired or renamed.
   *
   * The five are transcribed sentences — the target attacks, deals damage or
   * casts; the target dons armour; the caster or an ally damages the target —
   * and each hangs on a **consequence** event the engine already writes. What
   * the shape keeps is every cause whose fact no such event holds: *any*
   * damage from anybody, a distance two creatures drift apart, a running
   * total, a condition chosen at the casting, letting go of an object,
   * leaving an area, another spell ending this one.
   */
  it('closes the clause on the six executed spells whose whole sentence it reaches', () => {
    for (const id of [
      'animal-friendship',
      'charm-monster',
      'charm-person',
      'mage-armor',
      'mass-suggestion',
      'suggestion',
    ]) {
      const shapes = (ADJUDICATED[id] ?? []).map((entry) => entry.why);
      expect(shapes, id).not.toContain('a-casting-ended-by-a-trigger');
    }
    // **All six leave the map entirely now**, and the sixth took two builds to
    // get there: IE-032 closed Mass Suggestion's ending trigger and left its
    // "The duration is longer with a spell slot of level 7 (10 days), 8 (30
    // days), or 9 (366 days)" standing, which IE-035's `durationAtSlot`
    // closed. A spell can owe two shapes and be finished by neither alone,
    // which is exactly what `unblocks` counts and `blocks` does not.
    expect(ADJUDICATED['animal-friendship']).toBeUndefined();
    expect(ADJUDICATED['charm-person']).toBeUndefined();
    expect(ADJUDICATED['charm-monster']).toBeUndefined();
    expect(ADJUDICATED['mage-armor']).toBeUndefined();
    expect(ADJUDICATED['suggestion']).toBeUndefined();
    expect(ADJUDICATED['mass-suggestion']).toBeUndefined();
  });

  /**
   * Invisibility is the eighth and keeps a **narrower** clause, because the
   * residue is about which event records an attack roll rather than about the
   * cause. `target-attacks` reads `attack-made`, which is the Attack action;
   * a free swing — an Opportunity Attack, or any attack outside combat —
   * leaves only `roll-recorded`, which changes no state by rule. One that
   * lands still ends the spell through `target-deals-damage`.
   */
  it('keeps the narrower residue on the spell whose sentence names a roll', () => {
    expect(ADJUDICATED['invisibility']?.map((e) => e.why)).toEqual([
      'a-casting-ended-by-a-trigger',
    ]);
    expect(ADJUDICATED['invisibility']?.[0]?.clause).toBe(
      'an attack roll that costs no Attack action',
    );
  });

  /**
   * And Hypnotic Pattern keeps the whole of its clause, which is the
   * discriminating case for "do not widen the list to make a spell fit".
   *
   * SRD: "It wakes up if it takes any damage or if another creature takes an
   * action to shake it awake." *Any* damage is not the caster's or an ally's,
   * and the second half is an action a spell grants — so neither half is one
   * of the five, and the entry is untouched.
   */
  it('leaves a spell whose trigger is any damage at all exactly where it was', () => {
    const shapes = (ADJUDICATED['hypnotic-pattern'] ?? []).map((entry) => entry.why);
    expect(shapes).toContain('a-casting-ended-by-a-trigger');
  });

  /**
   * **The query predicted Mislead finished and the book says otherwise**, which
   * is IE-017's and IE-030's lesson arriving a third time.
   *
   * `a-casting-ended-by-a-trigger` was the only blocker recorded for Mislead,
   * so the derivation said building it would finish the spell. Read against the
   * paragraph, two things are wrong with that. SRD ends the **invisibility**
   * and not the casting — "The double lasts for the duration, but the
   * invisibility ends immediately after you make an attack roll, deal damage,
   * or cast a spell" — and `CastingEndTrigger.ends` says `casting` or
   * `target`, neither of which is *one effect of a casting*. And the entry had
   * never recorded the double at all, which prints Project Image's sentence
   * word for word: "You can see through its eyes and hear through its ears as
   * if you were located where it is."
   *
   * So the shape stays on it, a narrower id joins it, and the spell is **not**
   * in the blocked-on-nothing set that a naive removal would have put it in.
   */
  it('does not call Mislead finished, and records the blocker the entry had missed', () => {
    expect(blockersOf('mislead')).toEqual([
      'a-casting-ended-by-a-trigger',
      'a-second-place-to-put-a-creature',
    ]);
    expect(blockersOf('project-image')).toContain('a-second-place-to-put-a-creature');
    const free = Object.entries(BLOCKED_ON)
      .filter(([, entry]) => blockersIn(entry).length === 0)
      .map(([id]) => id);
    expect(free).not.toContain('mislead');
  });

  /**
   * Two undefined spells do lose the blocker, and both keep others — so the
   * shape's `unblocks` column is unchanged by this build, which is exactly the
   * distinction between the two numbers that column exists to draw.
   */
  it('clears it from the two undefined spells that print one of the five', () => {
    // "The awakened target has the Charmed condition for 30 days **or until
    // you or your allies deal damage to it**."
    expect(blockersOf('awaken')).not.toContain('a-casting-ended-by-a-trigger');
    expect(blockersOf('awaken')).toContain('a-long-casting-time');
    // "The spell ends if the warded creature makes an attack roll, casts a
    // spell, or deals damage." — Invisibility's three, word for word.
    expect(blockersOf('sanctuary')).toEqual(['a-spell-that-answers-a-later-attack']);
  });

  /** And the shape is still claimed, so the unclaimed-shape guard keeps it. */
  it('keeps the shape, because most of what it names is still missing', () => {
    expect(claimedShapes().has('a-casting-ended-by-a-trigger')).toBe(true);
    expect(consumersOf('a-casting-ended-by-a-trigger').blocks.length).toBeGreaterThan(10);
  });
});

describe('the executed and tracked maps still cover their own populations', () => {
  /**
   * The move is a move. Both maps are keyed by spell id and the populations
   * they describe are unchanged, which is what makes the diff a relocation
   * rather than a rewrite.
   */
  it('adjudicates only executed spells and tracks only tracked ones', () => {
    const defined = new Set(DEFINED_SPELL_IDS);
    for (const id of Object.keys(ADJUDICATED)) expect(defined.has(id), id).toBe(true);
    for (const id of Object.keys(TRACKED_ADJUDICATED)) expect(defined.has(id), id).toBe(true);
    for (const id of Object.keys(BLOCKED_ON)) expect(defined.has(id), id).toBe(false);
  });
});
