import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  misquotes as misquotedIn,
  namesIn,
  normaliseProse,
  quotedRunsIn,
  type Citation,
  type CitedSource,
} from '../scripts/citations.js';
import { FEATURE_SHAPES } from '../scripts/missing-feature-shapes.js';
import {
  ADJUDICATED,
  BLOCKED_ON,
  ITEM_BLOCKED_ON,
  ITEM_SHAPES,
  itemClausesIn,
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
  unanchoredPhrases,
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
    // The case this guard has already caught for real, four times over: IE-014
    // defined Lesser Restoration and Protection from Poison, IE-017 Stoneskin
    // and Protection from Energy, and the spell catalogue batch twenty-four at
    // once — Magic Missile, which used to stand here, among them. The
    // synthetic has to name a spell that is **still** undefined, which is why
    // it moves every time the real thing catches up with it — and it has now
    // moved a third time, off True Polymorph, which the third catalogue pass
    // defined along with twenty-nine others. Maze is the safest perch left:
    // `packages/engine`'s own tests pin it as a spell with no definition, so
    // it cannot be written out from under this synthetic by a content task.
    const defined = new Set([...DEFINED_SPELL_IDS, 'maze']);
    expect(coverageGaps(PARSED, defined).stale).toEqual(['maze']);
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
   *
   * Lowered from 150 by the batch that wrote two dozen of them, and **from
   * 100 by the batch that wrote fifty-two**, for the reason the docstring
   * above already gives: a floor that sits on the population is a guard the
   * next success fails.
   *
   * **The slack is the seven spells it has always been**, measured in spells
   * rather than as a share: 100 sat seven below a map of 107, 48 sat seven
   * below a map of 55, and 13 sits seven below a map of 20. As a *proportion*
   * of a map that keeps halving that is a wider window each time, and that is
   * the honest way round — what this floor watches for is a filter reading
   * nothing or a wrong directory, which empties the map outright rather than
   * shaving two spells off it.
   *
   * **And it is now close to the floor under the floor.** Ten of the twenty
   * entries left are spells a decision rather than a transcription is holding
   * back, so the next pass cannot take the map far below thirteen without the
   * engine gaining a mechanic first. When it can, this guard stops being worth
   * keeping rather than being lowered again.
   *
   * **Moved from 13 to 6 by IE-060**, which wrote the last spell the map itself
   * called executable and left thirteen entries — so a floor of thirteen sat
   * *on* the population, which is the failure the paragraph above records
   * happening once already. Every entry that is left is a decision rather than
   * a transcription, so the honest slack is the whole of it: what this still
   * catches is a wrong directory or a filter reading nothing, and nothing else.
   *
   * **Moved from 6 to 5 by the area filters**, which wrote Entangle — the
   * seventh entry, and the last one the map itself called `expressible` but
   * for a single clause. The floor sat *on* the population for the third
   * time; it is lowered by one rather than deleted because what it still
   * catches is an empty map, and an empty map is exactly what a wrong
   * directory produces.
   */
  it('covers a population worth deriving', () => {
    expect(Object.keys(BLOCKED_ON).length).toBeGreaterThan(5);
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
    expect(free).toEqual(['programmed-illusion']);
  });

  /**
   * And the ten that left it are **collected**, not lost.
   *
   * "The engine could take this spell today" is a claim with a shelf life: the
   * honest end of it is a definition, and eight of the eleven got one in a
   * single batch. What is asserted here is the end rather than the snapshot,
   * the way Gate, Mind Blank, Gaseous Form and Heroism are asserted elsewhere
   * in this file — each is out of the undefined population *and* in the
   * catalogue, which is the pair of facts a stale entry could not satisfy.
   *
   * **Darkness was the ninth, and the decision it was waiting on was taken.**
   * The worry was that writing it would make Sunburst's "dispels Darkness in
   * its area" reachable and turn a clause filed as fiction into a debt. It does
   * not: the definition is tracked and carries no `SpellArea`, for the reason
   * Daylight and Fog Cloud carry none, so the casting exists and holds no place
   * for sixty feet of sunlight to overlap. The clause stays the table's and
   * `spell-honesty.test.ts` pins the new reason where it pinned the old one.
   *
   * **Programmed Illusion** is the one still standing. It is refused its
   * Investigation check by `check_without_duration`, which reads
   * `durationSeconds` and `durationUntil` and not `untilDispelled`; the casting
   * it would hang on is ongoing and has no deadline, and widening that rule is
   * engine work.
   */
  it('collected the nine that were written, and says why one is left', () => {
    for (const spellId of [
      'conjure-fey',
      'create-or-destroy-water',
      'dancing-lights',
      'darkness',
      'daylight',
      'druidcraft',
      'elementalism',
      'fog-cloud',
      'purify-food-and-drink',
      'zone-of-truth',
    ]) {
      expect(BLOCKED_ON[spellId], spellId).toBeUndefined();
      expect(SRD_CONTENT.spell(spellId), spellId).not.toBeNull();
    }
    for (const spellId of ['programmed-illusion']) {
      expect(SRD_CONTENT.spell(spellId), spellId).toBeNull();
    }
  });

  /**
   * The one spell in the book whose **range** grows with the caster, and the
   * two shapes it was the only claimant of — **both built, so both retired**.
   *
   * The entry this replaces said that `SpellDefinition.range` was one fixed
   * `SpellRange` checked before a target is looked at, so the level 5 cleric
   * the SRD lets stabilise an ally at thirty feet would be refused. It is
   * `rangeAtLevel` now, read by `rangeFeetAt` at the cast and at the shortlist
   * alike; the four words beside it are the `stabilise` effect, writing the
   * `stabilised` a DM's declaration writes; and the sentence that chooses the
   * target is `TargetRule.mustBeDying`.
   *
   * So the spell has no tracked entry at all and neither
   * `a-range-that-scales-with-caster-level` nor
   * `an-effect-that-stabilises-a-dying-creature` is in `MISSING_SHAPES`. That
   * is the **right** way for a one-claimant shape to leave: it was named
   * because it was cheap to name and impossible to reconstruct later, it was
   * carried by a marker-less entry so the reading survived the move, and what
   * retires it is the mechanism arriving rather than the claim being dropped.
   */
  it('retires the two shapes Spare the Dying was the only claimant of', () => {
    // Asked of the keys rather than by indexing, because the type of
    // `MISSING_SHAPES` is the record's own literal keys: a retired id is not a
    // key any more, so an index expression naming one no longer compiles —
    // which is the guard working at the type level and not a reason to widen it.
    const shapes = new Set(Object.keys(MISSING_SHAPES));
    expect(shapes.has('a-range-that-scales-with-caster-level')).toBe(false);
    expect(shapes.has('an-effect-that-stabilises-a-dying-creature')).toBe(false);
    expect(BLOCKED_ON['spare-the-dying']).toBeUndefined();
    expect(SRD_CONTENT.spell('spare-the-dying')).not.toBeNull();
    expect(TRACKED_ADJUDICATED['spare-the-dying']).toBeUndefined();
    // And the definition really does all three: the effect, the target rule
    // and the band the reach grows by.
    const definition = SRD_CONTENT.spell('spare-the-dying');
    expect(definition?.effects.map((effect) => effect.kind)).toEqual(['stabilise']);
    expect(definition?.targets.mustBeDying).toBe(true);
    expect(definition?.rangeAtLevel).toEqual({ 5: 30, 11: 60, 17: 120 });
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
  /**
   * The synthetic it must catch: a sentence the engine owns, with nothing
   * written.
   *
   * **Mind Blank is still the fixture and is no longer in the map**, which is
   * the reason the entry is passed in rather than looked up: IE-042 defined the
   * spell, so `BLOCKED_ON` has nothing for it, while the *book* still prints
   * the one marker sentence this asserts against. A synthetic that reads the
   * map would have quietly stopped being about anything the day the spell was
   * written.
   */
  it('reports a marker sentence no clause answers', () => {
    const gaps = sentenceGaps('mind-blank', []);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.sentence).toContain('Immunity to Psychic damage');
    expect(gaps[0]!.markers).toContain('defence');
  });

  /**
   * And the one it must pass, because a guard that reported everything would
   * too — read off a spell that is still undefined and still read.
   *
   * **The fixture was Heroes' Feast, then Hallow, and it has had to move
   * twice** — which is the same hazard Mind Blank's move recorded above,
   * arriving on schedule: a spell chosen for being read and undefined stops
   * being the second the day somebody writes it, and being the most heavily
   * read entry in the map is exactly what makes a spell worth writing next.
   * Find Familiar was the third fixture and went the same way on 2026-09-22,
   * written on the kept summons; Phantasmal Force is the replacement, and it
   * is what "most heavily read" means now: nine clauses over one paragraph.
   */
  it('reports nothing once that sentence is answered', () => {
    expect(sentenceGaps('phantasmal-force')).toEqual([]);
  });

  /**
   * An entry that names no clause is never complete, however quiet its prose.
   *
   * "No sentence names a mechanic" is a conclusion somebody has to have
   * reached, and an entry with no clause records no reading — so the two are
   * told apart by the clause rather than by the silence.
   */
  it('does not call a grandfathered entry read', () => {
    expect(isSentenceComplete('phantasmal-force')).toBe(true);
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
 * The family IE-044 backfilled, what reading ten paragraphs found, and what
 * **building the shape** then found in the same ten.
 *
 * `a-condition-immunity-a-spell-grants` was the shape IE-042 was briefed from,
 * so it is the family whose entries had to stop being bare lists first.
 * Backfilling is deliberately family by family: two hundred paragraphs in one
 * commit is how a reviewer stops reading, and the second `finishes` number is
 * what makes the rest honest in the meantime.
 *
 * **IE-042 built it, and the ten were re-read one at a time rather than
 * find-and-replaced** — which is the discipline this file records for every
 * shape that gets built, and the one that earned its keep again here. The
 * unconditional grant reached five clauses; it reached **none** of the other
 * five, and each of those is a different sentence:
 *
 * | | |
 * |---|---|
 * | Mind Blank | defined, and out of this population altogether — the map's sharpest wrong prediction, collected |
 * | Calm Emotions, Gaseous Form, Heroes' Feast, Heroism, Wind Walk | `expressible`: each prints the Immunity unconditionally |
 * | Freedom of Movement, Magic Circle, Protection from Evil and Good, Hallow's Ward | `a-condition-immunity-narrowed-to-its-source` — the Immunity holds against *some* causes, which `conditionImmunitiesOf` has no argument for |
 * | Calm Emotions' second sentence | `a-condition-a-spell-suppresses` — the condition lands and is silenced, which is a feature's rule and no spell's |
 * | Hallow's Courage | `a-standing-effect-derived-from-where-a-creature-stands`, where its own sibling clause Fear already sat |
 *
 * So the shape retired and **two** narrower ones came out of it, both of them
 * sentences somebody had read rather than ids invented to hold a residue. That
 * is IE-017's own lesson arriving one level down: the way to find out whether a
 * shape is a bundle is to build it.
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
  /**
   * Which shapes each of the nine still-undefined spells names now, pinned so
   * the backfill **and the re-read** are both checkable.
   *
   * Mind Blank is not here: it is defined, and a defined spell is not in this
   * population at all. What is left of its entry is one `table` clause in
   * `ADJUDICATED`.
   *
   * **Gaseous Form left the same way and for the same reason**, on the batch
   * that unblocked the magic items waiting on it: the sentence this family was
   * read for — "it has Immunity to the Prone condition" beside a Resistance and
   * three Advantages — is executed now, and the six blockers its entry named
   * are the definition's own `unmodelled`, four of them adjudicated and two
   * tripping no marker. A defined spell is not in this population, however
   * partial its definition.
   */
  const BACKFILLED: readonly (readonly [string, readonly ShapeId[]])[] = [
    [
      'calm-emotions',
      ['a-condition-a-spell-suppresses', 'a-spells-effects-applied-to-different-targets'],
    ],
    [
      'hallow',
      [
        'a-barrier-that-blocks-passage',
        'a-cap-on-how-many-castings-run-at-once',
        'a-choice-made-at-the-casting',
        'a-condition-immunity-narrowed-to-its-source',
        'a-creature-type-predicate-an-area-reads',
        'a-standing-effect-derived-from-where-a-creature-stands',
        'an-effect-that-suppresses-other-magic',
      ],
    ],
  ];

  // **All four are spent now.** The third catalogue pass wrote Magic Circle and
  // Wind Walk; the marker-less entry form let the last two be written, and each
  // was written the day that form existed rather than the day it landed. So the
  // backfill is checked where the readings **went** instead of where they were:
  // out of `BLOCKED_ON`, into `TRACKED_ADJUDICATED` against the same sentences,
  // and into the definition's own `unmodelled` for the clauses that name no
  // shape. That is the same test in a later population and not a weaker one —
  // the shapes are asserted as a set, so a reading dropped on the way still
  // fails.
  //
  // One shape is deliberately not in Hallow's list any more and it is the one
  // the spell **spent**: `a-long-casting-time` was the twenty-four hours, and a
  // tracked definition carries a long casting time itself. It could not have
  // been kept in any case — it was anchored to a printed field, which the
  // undefined population's entry form allows and the tracked one refuses.

  it.each(BACKFILLED)('keeps every shape %s was read for', (spellId, shapes) => {
    expect(BLOCKED_ON[spellId], spellId).toBeUndefined();
    expect(
      [...new Set((TRACKED_ADJUDICATED[spellId] ?? []).map((entry) => entry.why))].sort(),
      spellId,
    ).toEqual(shapes);
  });

  /** And the twenty-four hours it spent is executed rather than dropped. */
  it('spends the one shape Hallow no longer names', () => {
    expect(SRD_CONTENT.spell('hallow')?.castingTime).toBe('long');
    expect(SRD_CONTENT.spell('hallow')?.castingSeconds).toBe(86_400);
    expect(
      (TRACKED_ADJUDICATED['hallow'] ?? []).map((entry) => entry.why),
    ).not.toContain('a-long-casting-time');
  });

  /**
   * And the two residues cover exactly the clauses the build did not reach, so
   * the claim above is about all of them.
   *
   * Four spells narrow their Immunity to what is causing the condition and one
   * suppresses a condition that has already landed. Neither list is the whole
   * family and that is the point: the other five clauses are `expressible` and
   * claim no shape at all.
   */
  it('covers every spell the two residues block', () => {
    // **Neither residue has an undefined claimant left**, which is the state
    // this describe was always heading for: every spell the family was read
    // for is written, and each reading is in the tracked map against the
    // sentence it was read from. A shape with no undefined claimant is not a
    // shape that is finished — it is one nothing is waiting on to be *cast*.
    expect(consumersOf('a-condition-immunity-narrowed-to-its-source').undefined).toEqual([]);
    // Freedom of Movement was the fourth and Protection from Evil and Good the
    // third; both are **tracked** now, so the shape keeps them in a different
    // population rather than losing them. Each batch that wrote one moved the
    // clause into `TRACKED_ADJUDICATED`, where it says the same thing about the
    // same sentence — and Protection from Evil and Good keeps two of its three
    // readings there, the third being the Immunity narrowed by the word "them".
    expect(consumersOf('a-condition-immunity-narrowed-to-its-source').tracked).toEqual([
      'freedom-of-movement',
      'hallow',
      'magic-circle',
    ]);
    // **And Protection from Evil and Good's third reading has been paid.** The
    // Immunity narrowed by the word "them" is a `fromTypes` on the grant now
    // and the door that applies a condition asks what is causing it, so the
    // spell is executed-partial and holds no reading against this shape at all
    // — asserted rather than the row quietly disappearing, which is what the
    // list above is for.
    expect(consumersOf('a-condition-immunity-narrowed-to-its-source').executed).not.toContain(
      'protection-from-evil-and-good',
    );
    expect(
      (SRD_CONTENT.spell('protection-from-evil-and-good')?.effects ?? []).filter(
        (effect) => effect.kind === 'condition-immunity',
      ),
    ).toHaveLength(1);
    // Calm Emotions is the one spell the suppression residue blocks, and it
    // **was undefined for that reason**: the tracked map anchored a clause to a
    // sentence that trips a mechanical marker, and "those conditions are
    // suppressed for the duration" trips none — so a tracked definition could
    // not carry this reading, and writing one would have retired a shape that
    // is still missing. `marker: null` is the entry form that ended that, so
    // the spell is written, the reading is kept, and the shape is claimed by
    // the one sentence it was always about.
    expect(consumersOf('a-condition-a-spell-suppresses').undefined).toEqual([]);
    expect(consumersOf('a-condition-a-spell-suppresses').tracked).toEqual(['calm-emotions']);
    expect(consumersOf('a-condition-a-spell-suppresses').unseen).toEqual(['calm-emotions']);
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
    // Freedom of Movement's was the first of the five, and it is **kept**
    // rather than lost now that the spell is defined: the reading moved into
    // `TRACKED_ADJUDICATED` against the same sentence, and into the
    // definition's own `unmodelled`, where the table hears it on every
    // casting. Gaseous Form's clause below made the same move first.
    expect(
      (TRACKED_ADJUDICATED['freedom-of-movement'] ?? []).find(
        (entry) => entry.clause === "can neither reduce the target's Speed",
      )?.why,
    ).toBe('an-effect-that-suppresses-other-magic');
    expect(BLOCKED_ON['freedom-of-movement']).toBeUndefined();
    // Magic Circle's was the second, and it is **kept** rather than lost now
    // that the spell is defined: the type the circle is drawn against is
    // chosen at the casting, and the definition says so on every casting.
    // There is no tracked entry for it because the sentence the reading was
    // anchored to trips no mechanical marker — which is the same reason Calm
    // Emotions is still undefined, met from the other side.
    expect(BLOCKED_ON['magic-circle']).toBeUndefined();
    expect(
      (SRD_CONTENT.spell('magic-circle')?.unmodelled ?? []).filter((note) =>
        note.includes('is chosen when the spell is cast'),
      ),
    ).toHaveLength(1);
    // Wind Walk's was the third, and that one *does* trip a marker, so it moved
    // into the tracked map against the very sentence it was read from — **and
    // has since moved again**, into the executed map, because the spell stopped
    // being tracked: its "The only actions a target can take in this form"
    // sentence is written now, so the definition resolves something and every
    // clause it does not finish is an executed spell's debt rather than a
    // tracked one's. The reading is the same reading; only the map it is
    // anchored in has changed, and the anchor is the definition's own clause
    // rather than the book's sentence because that is how the executed map is
    // keyed.
    expect(BLOCKED_ON['wind-walk']).toBeUndefined();
    expect(TRACKED_ADJUDICATED['wind-walk']).toBeUndefined();
    expect(
      (ADJUDICATED['wind-walk'] ?? []).find((entry) => entry.clause === 'the minute of reverting')
        ?.why,
    ).toBe('an-activation-taken-by-somebody-other-than-the-caster');
    // Hallow's was the fourth, and it is **kept** rather than lost now that the
    // spell is defined — but it could only be kept because the entry may now
    // carry no marker at all. This is the sentence the review found by reading
    // the paragraph, and it is the sole claimant of its shape, so the reading
    // and the gap stood or fell together.
    expect(BLOCKED_ON['hallow']).toBeUndefined();
    expect(
      (TRACKED_ADJUDICATED['hallow'] ?? []).find(
        (entry) =>
          entry.clause ===
          'the spell fails if the radius includes an area already under the effect of',
      ),
    ).toMatchObject({ marker: null, why: 'a-cap-on-how-many-castings-run-at-once' });
    // Gaseous Form's occupancy override was the fifth, and it is **kept**
    // rather than lost now that the spell is defined: the sentence moved from
    // its blocked-on entry into the definition's own `unmodelled`, where it is
    // handed to the table on every casting. A reading that survives the spell
    // being written is the reading that was worth doing.
    expect(
      (SRD_CONTENT.spell('gaseous-form')?.unmodelled ?? []).filter((note) =>
        note.includes('The target can enter and occupy the space of another creature'),
      ),
    ).toHaveLength(1);
    expect(BLOCKED_ON['gaseous-form']).toBeUndefined();

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
   * And the `finishes` this shape carried was **collected**, which is the one
   * thing a read count is for.
   *
   * Mind Blank was the map's sharpest correction — the query said IE-017 would
   * finish it and the build did not, because the entry recorded the damage half
   * of a sentence and not the condition half — and the number it stood behind
   * turned into a definition rather than into another prediction. So the honest
   * check now is that the spell is defined and out of the population, and that
   * neither residue inherited the claim: an Immunity narrowed to its source
   * finishes nobody, because every spell that writes one prints other blockers
   * beside it.
   */
  it('collected the one spell it finished, and neither residue inherited it', () => {
    expect(BLOCKED_ON['mind-blank']).toBeUndefined();
    expect(ADJUDICATED['mind-blank']?.map((entry) => entry.why)).toEqual(['table']);

    for (const shape of [
      'a-condition-immunity-narrowed-to-its-source',
      'a-condition-a-spell-suppresses',
    ] as const) {
      expect(consumersOf(shape).unblocks, shape).toEqual([]);
    }
  });

  /**
   * **And building this shape handed a `finishes` to another one, which has
   * since been built and collected it.**
   *
   * IE-042 left Heroism printing one blocker where it had printed two: the
   * Immunity was `expressible` and the Temporary Hit Points every turn were
   * not, so `a-payout-at-a-turn-boundary` gained a spell it finished outright,
   * in the column that says somebody had read the paragraph. That is the
   * prediction this row existed to make, and the honest check now is that it
   * came true rather than that it is still pending — the move Mind Blank's own
   * row made one build earlier.
   *
   * So the spell is defined, out of the blocked population entirely, and
   * carries no adjudicated debt: all three of its clauses are executed, which
   * is the state a `finishes` is supposed to end in.
   */
  it('collected the spell it handed on, once the payout shape was built', () => {
    expect(BLOCKED_ON['heroism']).toBeUndefined();
    expect(ADJUDICATED['heroism']).toBeUndefined();
    expect(DEFINED_SPELL_IDS.has('heroism')).toBe(true);
    // And the shape itself is gone from the vocabulary, because nothing claims
    // it any more — the retirement every built shape ends in.
    expect(Object.keys(MISSING_SHAPES)).not.toContain('a-payout-at-a-turn-boundary');
    expect(claimedShapes().has('a-payout-at-a-turn-boundary')).toBe(false);
  });
});

/**
 * The four families the next cycle would be briefed from, read the same way.
 *
 * IE-044 backfilled one family and recorded the rule: a shape is briefed only
 * from a `finishes` list somebody has read. On `main` every family but that one
 * read **zero**, so the whole capability roster was gated on a reading rather
 * than on a decision. These are the four the coverage report ranked highest by
 * what a read count would unblock, taken in that order.
 *
 * **Reading them moved three of the four counts off zero and moved the fourth
 * further down**, which is the instrument working rather than failing:
 * `a-stat-block-created-mid-fight` was the highest-ranked family in the book and
 * it now finishes **nothing anybody can read**. Unseen Servant, the one spell of
 * its four finishes whose paragraph the guard can anchor, prints "If it drops to
 * 0 Hit Points, the spell ends" — a casting-end trigger with no member — so it
 * left the column. The other three cannot be read at all; see the block below.
 *
 * What the four families are is written out rather than derived, for the reason
 * the blocked-on-nothing set is: a spell joining or leaving one of these lists
 * is a reading somebody changed, and it should have to say so here.
 */
describe('the four highest-leverage families are read sentence by sentence', () => {
  /**
   * Each family, its undefined consumers, and the ones the guard cannot reach.
   *
   * The third column is **not** a licence: it is the five spells whose printed
   * entry contains a marker sentence the book repeats verbatim, which no phrase
   * can be anchored to. The block below proves that rather than asserting it.
   */
  const FAMILIES: readonly (readonly [ShapeId, readonly string[], readonly string[]])[] = [
    // **The third catalogue pass emptied three of the four**, by writing the
    // spells rather than by building anything. What is left of each family in
    // the undefined population is written here; what left it is asserted
    // below, and the shapes all survive in the tracked population.
    // **And Find Familiar left it on 2026-09-22**, written on the kept
    // summons: the form the caster names, the type they state, the familiar
    // bound to its wizard rather than to a casting. Its two remaining debts
    // are adjudicated on the executed side, which is where the shape's own
    // claim moved.
    ['a-stat-block-created-mid-fight', [], []],
    // Conjure Woodland Beings left this list by being **written**, and the
    // reading that had kept it here was wrong about which gap it was: see the
    // block below, and `conjure-woodland-beings.test.ts` for the definition.
    //
    // **And Slow left it the same way**, which empties the family's undefined
    // column: `save.condition` became optional, so the failed save that its
    // “can't take Reactions” rides became writable, and the spell is executed
    // with two clauses of this shape still open — the two slots coupled to
    // each other, and the attacks counted inside the Attack action. The claim
    // moved into the adjudicated population rather than going away, exactly
    // as the wall family's did.
    ['an-action-a-spell-compels-or-forbids', [], []],
    ['a-second-place-to-put-a-creature', ['maze', 'sending'], []],
    ['a-wall-or-several-templates-in-one-area', [], []],
  ];

  /**
   * **What left each family, and by which of the two doors.**
   *
   * A reading is spent when the spell is written, and the four lists above
   * lost twenty-five rows across twenty-two spells in one batch without a
   * shape being built. That is the departure Gate, Expeditious Retreat,
   * Scorching Ray and Barkskin already made one at a time; what is new is the
   * scale, and the scale is what makes it worth pinning. The shapes all survive, because each still
   * has claimants in the tracked population saying the same thing about the
   * same sentences — which is the whole of why `consumersOf` counts three
   * populations and not one.
   */
  it('spent those readings on definitions rather than on builds', () => {
    const written = [
      'animate-dead',
      'animate-objects',
      'awaken',
      'blade-barrier',
      'blink',
      'create-undead',
      'fire-storm',
      'irresistible-dance',
      'magnificent-mansion',
      'meteor-swarm',
      'mislead',
      'phantom-steed',
      'planar-ally',
      'power-word-heal',
      'secret-chest',
      'silence',
      'teleportation-circle',
      'unseen-servant',
      'wall-of-ice',
      'wall-of-stone',
      'wall-of-thorns',
      'wind-wall',
    ];
    // Written out rather than counted in the name, because the number is the
    // list's and a name that carried one drifted the moment a spell was added
    // to it — which it had, by the spell below that the first version missed.
    expect(written).toEqual([...written].sort());
    expect(written).toContain('power-word-heal');
    for (const spellId of written) {
      expect(BLOCKED_ON[spellId], spellId).toBeUndefined();
      expect(SRD_CONTENT.spell(spellId), spellId).not.toBeNull();
    }
    // And every shape they left is still claimed, by the tracked entries those
    // same definitions carry.
    for (const shape of [
      'a-stat-block-created-mid-fight',
      'an-action-a-spell-compels-or-forbids',
      'a-second-place-to-put-a-creature',
      'a-wall-or-several-templates-in-one-area',
    ] as const) {
      expect(claimedShapes().has(shape), shape).toBe(true);
      expect(consumersOf(shape).tracked.length, shape).toBeGreaterThan(0);
    }
  });

  /** The family is exactly these spells, so the claim below is about all of them. */
  it.each(FAMILIES)('covers every spell %s blocks', (shape, consumers) => {
    expect(consumersOf(shape).undefined).toEqual([...consumers]);
  });

  /**
   * And an empty list is a real answer here rather than a sweep that stopped
   * checking: `a-wall-or-several-templates-in-one-area` blocks no undefined
   * spell at all now, and still blocks plenty — the claim moved from the
   * undefined population into the tracked one rather than going away.
   */
  it('keeps a family the undefined population has run out of', () => {
    const walls = consumersOf('a-wall-or-several-templates-in-one-area');
    expect(walls.undefined).toEqual([]);
    expect(walls.blocks.length).toBeGreaterThan(1);
  });

  /** And every one of them is read, except the ones the guard demonstrably cannot reach. */
  it.each(FAMILIES)('reads every sentence of every spell %s blocks', (_shape, consumers, skipped) => {
    for (const spellId of consumers) {
      expect(isSentenceComplete(spellId), spellId).toBe(!skipped.includes(spellId));
    }
  });

  /**
   * The counts the next cycle would be planned from, before and after.
   *
   * Every one of these read **zero** on `main`. Three went non-zero when the
   * paragraphs were read, and **one of the three has since been collected**:
   * Gate was the one spell `a-second-place-to-put-a-creature` was the only
   * blocker for, and the batch that unblocked Cubic Gate wrote it as a tracked
   * definition rather than waiting for the shape — which takes that count back
   * to zero from the other end. A read count going to zero because the spell
   * was written and a read count that was never anything but zero are opposite
   * findings, and the difference is that one of them left a definition behind.
   */
  it('moves three of the four counts off zero, and says what became of each', () => {
    // **And one of the two was collected, the way Gate's was.** Expeditious
    // Retreat is twenty words and both of them are the action economy, so the
    // spell catalogue batch wrote it tracked rather than waiting for the
    // shape: the Concentration and the ten minutes are real and the Dash is
    // the table's. A read count going to zero because somebody wrote the
    // spell is the opposite finding from one that was never anything else.
    // **Collected, and the collection came with a correction.** Conjure
    // Woodland Beings was the last spell in the book whose effects the engine
    // could execute today, and it is executed now — an Emanation, three
    // triggers, a save and 5d8 Force, which is Spirit Guardians' shape. What
    // had kept it here was its Disengage, filed under this shape; `ActionRule`
    // built that sentence and the entry was never re-read. The gap that is
    // real is a grant on the caster beside an area that catches everybody
    // else, and it is filed as debt on the definition.
    expect(consumersOf('an-action-a-spell-compels-or-forbids').unblocksRead).toEqual([]);
    expect(BLOCKED_ON['conjure-woodland-beings']).toBeUndefined();
    expect(ADJUDICATED['conjure-woodland-beings']?.map((entry) => entry.why)).toEqual([
      'a-spells-effects-applied-to-different-targets',
      'table',
    ]);
    expect(BLOCKED_ON['expeditious-retreat']).toBeUndefined();
    expect(SRD_CONTENT.spell('expeditious-retreat')).not.toBeNull();
    // Collected: Gate is defined, so the shape finishes nobody who is left.
    expect(consumersOf('a-second-place-to-put-a-creature').unblocksRead).toEqual([]);
    expect(BLOCKED_ON['gate']).toBeUndefined();
    expect(SRD_CONTENT.spell('gate')).not.toBeNull();
    // Collected, both of them, the way Gate's was: Fire Storm and Meteor Swarm
    // were the two spells this shape was the only blocker for, and the second
    // catalogue pass wrote both as tracked definitions rather than waiting for
    // the ten Cubes and the four Spheres. So the count is back to zero from the
    // other end, and what the shape now blocks is entirely spells it does not
    // finish.
    expect(consumersOf('a-wall-or-several-templates-in-one-area').unblocksRead).toEqual([]);
    for (const id of ['fire-storm', 'meteor-swarm']) {
      expect(BLOCKED_ON[id], id).toBeUndefined();
      expect(SRD_CONTENT.spell(id)?.effects, id).toEqual([]);
    }
    // Collected, all three of them, and this is the one that had been called
    // "the **whole** of what `a-stat-block-created-mid-fight` finishes" and
    // "the highest-leverage family in the book". Find Steed, Giant Insect and
    // Summon Dragon were unreadable — the repeated `SAVE` cell below defeats
    // any clause — so no read count could ever have been planned from them,
    // and the third catalogue pass wrote all three as tracked definitions
    // instead. A family that could not be read can still be written.
    //
    // **And Find Steed has since been resolved rather than merely written**,
    // which is the second half of the same lesson: P2-T11 built the `summon`
    // effect kind, the owner's ruling put the Otherworldly Steed in the
    // bestiary, and the spell raises it. It is an executed definition now —
    // so what is asserted of it here is that it left the undefined population
    // and did *not* leave this shape, because the clause it still carries is
    // the steed's lifetime rather than the steed's existence.
    const statBlock = consumersOf('a-stat-block-created-mid-fight');
    expect(statBlock.unblocksRead).toEqual([]);
    expect(statBlock.unblocksUnread).toEqual([]);
    for (const id of ['find-steed', 'giant-insect', 'summon-dragon']) {
      expect(BLOCKED_ON[id], id).toBeUndefined();
    }
    for (const id of ['giant-insect', 'summon-dragon']) {
      expect(SRD_CONTENT.spell(id)?.effects, id).toEqual([]);
    }
    expect(SRD_CONTENT.spell('find-steed')?.effects.map((e) => e.kind)).toEqual(['summon']);
  });
});

/**
 * **A sentence the book repeats verbatim can be adjudicated by nobody**, and
 * five spells print one.
 *
 * A clause must occur **exactly once** across a spell's printed units, which is
 * what makes it a citation rather than an assertion. SRD 5.2.1 prints a summon's
 * stat block inside the spell's own entry as an HTML table, and that table has
 * three identical `SAVE` header cells; the parser keeps them, the splitter
 * returns each as its own unit, and every one of them trips the saving-throw
 * marker. So the coverage guard demands an adjudication of a unit the anchoring
 * guard forbids anyone to write — the two guards disagree, and no reading can
 * satisfy both.
 *
 * **This is reported rather than worked around.** Relaxing the anchoring rule,
 * teaching the splitter about table markup, or narrowing the marker list would
 * each change what "read" means for all two hundred entries, and that is an
 * architecture decision rather than a reading. What is recorded here is the
 * measurement: which spells, which unit, and how many times it occurs.
 *
 * The cost is exact and it is the highest-leverage family in the book:
 * `a-stat-block-created-mid-fight` finishes three spells and all three are here.
 */
describe('a unit the book repeats verbatim can carry no clause', () => {
  /** The spell, the repeated unit, and how many of that spell's units contain it. */
  const REPEATED: readonly (readonly [string, string, number])[] = [
    ['find-steed', '<td>SAVE</td>', 3],
    ['giant-insect', '<th>SAVE</th>', 3],
    ['summon-dragon', '<td>SAVE</td>', 3],
    ['prismatic-spray', '*Successful Save:* Half as much damage.</td>', 5],
    ['prismatic-wall', '*Successful Save:* Half as much damage.', 5],
  ];

  it.each(REPEATED)('cannot anchor a clause in %s', (spellId, unit, times) => {
    // The unit really is a sentence of the spell's own prose, and it really does
    // trip a marker — so the coverage guard demands an adjudication for it.
    expect(sentencesOf(spellId)).toContain(unit);
    expect(markersIn(unit).length).toBeGreaterThan(0);
    // And it occurs that many times, so the anchoring guard refuses every phrase
    // inside it — including the whole unit, which is the longest one available.
    expect(unanchoredPhrases(spellId, [unit])).toEqual([
      { spell: spellId, clause: unit, matches: times },
    ]);
  });

  /** So those five stay grandfathered, and the count that says so is honest. */
  it('leaves the five out of the read column rather than pretending', () => {
    for (const [spellId] of REPEATED) expect(isSentenceComplete(spellId), spellId).toBe(false);
  });

  /**
   * And the rule really is per-spell rather than a property of table markup:
   * Confusion and Divine Word print tables too, and every marker-bearing cell
   * in them is distinct, so both are read.
   */
  it('reads a spell whose table cells happen to differ', () => {
    // **Both are defined now, so `isSentenceComplete` cannot be the measure.**
    // It reads a `BLOCKED_ON` entry, and a defined spell has none — so it
    // would answer false for a spell whose cells are perfectly distinct, which
    // is the opposite of what this claims. The anchoring is the claim, and the
    // anchoring is a property of the printed entry rather than of the map, so
    // it is asserted directly and goes on holding after the spell is written.
    for (const [spellId, cell] of [
      ['divine-word', '<td>The target dies.</td>'],
      ['confusion', '<td>The target chooses its behavior.</td>'],
    ] as const) {
      const sentence = sentencesOf(spellId).find((text) => text.includes(cell));
      expect(sentence, `${spellId} does not print ${cell}`).toBeDefined();
      expect(unanchoredPhrases(spellId, [cell]), spellId).toEqual([]);
    }
  });
});

/**
 * Twenty-five spells gained a blocker nobody had recorded, and here they are.
 *
 * "The reading found something" is only a claim until the something is named,
 * which is the rule IE-044 wrote for its own five. Every one below is an
 * **existing** shape id filed against a sentence the spell prints — no id was
 * invented — and each is asserted through the clause that records it, so a
 * later edit cannot quietly drop one.
 *
 * Four are worth reading twice:
 *
 * | | |
 * |---|---|
 * | Unseen Servant | "If it drops to 0 Hit Points, the spell ends" — the trigger that cost the largest family its only readable finish, where Giant Insect and Summon Dragon say the *creature* disappears and the spell does not end |
 * | Phantom Steed | a one-minute casting time the entry had simply never recorded, while Find Familiar recorded the same field |
 * | Wall of Stone | "AC 15 and 30 Hit Points per inch of thickness" — a stat block inside a wall spell, which is where the wall family and the summons family turn out to meet |
 * | Maze | "If it succeeds, it escapes, and the spell ends", which `SpellCheck.onSuccess` had already written down as a gap and named this spell for |
 *
 * **Five of the sentences below trip no marker at all**, so none of them was
 * demanded by the guard and each was found by reading. That is the floor
 * behaving as a floor, the same way Hallow's refusal and Gaseous Form's
 * occupancy override were for IE-044.
 */
describe('reading four families found blockers the bare lists had missed', () => {
  const filed = (spellId: string, phrase: string): string | undefined =>
    clausesIn(BLOCKED_ON[spellId] ?? []).find((clause) => clause.clause === phrase)?.why;

  /** The spell, the sentence that forced it, and the shape it was filed under. */
  const FOUND: readonly (readonly [string, string, ShapeId])[] = [
    // Find Familiar's three rows were spent on 2026-09-22 — see `SPENT` below.
    ['maze', 'If it succeeds, it escapes, and the spell ends', 'a-casting-ended-by-a-trigger'],
    [
      'sending',
      'a creature can block your ability to reach it again with this spell for 8 hours',
      'an-effect-that-suppresses-other-magic',
    ],
  ];

  it.each(FOUND)('records %s: "%s"', (spellId, phrase, shape) => {
    expect(filed(spellId, phrase)).toBe(shape);
    expect(blockersOf(spellId), spellId).toContain(shape);
  });

  /**
   * **Eleven of these rows have been spent, and spending one is not losing
   * it.**
   *
   * Each was a sentence somebody found by reading a paragraph, and each has
   * since become a definition — so the row cannot stay in the table above,
   * where every entry asserts an *undefined* spell's own entry. What is
   * asserted instead is the survival: the spell is out of the map, and the
   * reading is somewhere a reader still meets it. Freedom of Movement and
   * Gaseous Form each made this move alone; this is the same move ten times,
   * and writing it out is what stops a deleted row looking like a row that was
   * never right.
   *
   * The second element says where the reading went: `tracked` for a clause the
   * tracked map anchors to the same sentence, `unmodelled` for one the markers
   * cannot see, which the definition hands to the table on every casting.
   *
   * **Ten of the eleven are here and the eleventh is the row below**, because
   * its survival is of a different kind: Phantom Steed's deleted row recorded
   * the *casting time*, and what happened to that reading is that the rite is
   * run rather than refused, which is a field on the definition rather than an
   * adjudication anywhere. Filing it in this table under a shape it was never
   * filed under would have been a tidier list saying something false.
   */
  const SPENT: readonly (readonly [string, 'tracked' | 'unmodelled', ShapeId | string])[] = [
    ['unseen-servant', 'tracked', 'a-casting-ended-by-a-trigger'],
    ['irresistible-dance', 'tracked', 'a-repeat-save-raised-by-a-trigger'],
    ['wall-of-ice', 'tracked', 'a-stat-block-created-mid-fight'],
    ['wall-of-stone', 'tracked', 'a-stat-block-created-mid-fight'],
    ['wall-of-stone', 'tracked', 'an-action-a-spell-compels-or-forbids'],
    ['mislead', 'unmodelled', 'seeing through its eyes or hearing through its ears'],
    // Both corpse rules were found by the same reading and both spells are
    // tracked now; the sentence trips no mechanical marker, so each survives
    // in the definition's own notes rather than in the tracked map.
    ['animate-dead', 'unmodelled', 'a size and a type on something that is not a creature'],
    ['create-undead', 'unmodelled', 'selects corpses rather than creatures'],
    ['secret-chest', 'unmodelled', 'the Ethereal Plane they go to is a second place'],
    ['secret-chest', 'unmodelled', 'nor does it end on a recasting'],
    // The third catalogue pass spent twenty-five more rows in one commit,
    // which is what happens when a batch takes the whole mechanically dense
    // tail at once. Each is the same claim as the ten above: the entry is
    // gone, the definition is there, and the sentence somebody read is still
    // somewhere a reader meets it.
    ['arcane-hand', 'tracked', 'a-casting-ended-by-a-trigger'],
    ['arcane-hand', 'unmodelled', 'does not occupy its space'],
    ['arcane-hand', 'unmodelled', 'an area that moves by itself'],
    ['arcane-hand', 'unmodelled', 'with neither an attack roll nor a saving throw in front of it'],
    ['simulacrum', 'tracked', 'healing-modified-by-an-effect'],
    ['simulacrum', 'tracked', 'a-casting-ended-by-a-trigger'],
    ['simulacrum', 'unmodelled', 'dismisses it as a Magic action'],
    ['true-polymorph', 'unmodelled', 'lasts until dispelled'],
    ['true-polymorph', 'unmodelled', 'cannot speak or cast spells'],
    ['antipathy-sympathy', 'unmodelled', 'a target rule selecting by size'],
    ['antipathy-sympathy', 'unmodelled', 'the minute of immunity after a success'],
    ['symbol', 'unmodelled', 'lasts until dispelled or triggered'],
    ['symbol', 'unmodelled', 'awakens if it takes damage'],
    ['astral-projection', 'tracked', 'a-casting-ended-by-a-trigger'],
    ['dispel-evil-and-good', 'tracked', 'a-casting-dismissed-early'],
    ['imprisonment', 'tracked', 'a-creature-fact-an-effect-overrides'],
    ['imprisonment', 'unmodelled', 'a dismissal a spell offers'],
    ['magic-jar', 'unmodelled', 'a casting dismissed early'],
    ['magic-jar', 'unmodelled', 'an action economy belonging to somebody else'],
    ['magic-jar', 'unmodelled', 'a second casting refusing this one'],
    ['project-image', 'unmodelled', 'sight is a pairwise declaration'],
    ['tsunami', 'tracked', 'an-action-a-spell-compels-or-forbids'],
    ['tsunami', 'unmodelled', 'a catch filtered by size'],
    ['tsunami', 'unmodelled', 'swimming creatures being unaffected'],
    ['tsunami', 'unmodelled', 'nothing falls and there is no water'],
    // Find Familiar, written on the kept summons on 2026-09-22. Its three
    // readings survive in the definition's own notes and in the executed map,
    // which is where an executed-partial spell's debts are adjudicated.
    ['find-familiar', 'unmodelled', 'you can temporarily dismiss the familiar to a pocket dimension'],
    ['find-familiar', 'unmodelled', 'your familiar can deliver the touch'],
    ['find-familiar', 'unmodelled', 'seeing through the familiar’s eyes'],
  ];

  it.each(SPENT)('kept %s’s reading after the definition landed (%s)', (spellId, where, what) => {
    expect(BLOCKED_ON[spellId], spellId).toBeUndefined();
    expect(SRD_CONTENT.spell(spellId), spellId).not.toBeNull();
    if (where === 'tracked') {
      expect(
        (TRACKED_ADJUDICATED[spellId] ?? []).map((entry) => entry.why),
        spellId,
      ).toContain(what);
    } else {
      expect(
        (SRD_CONTENT.spell(spellId)?.unmodelled ?? []).filter((note) => note.includes(what)),
        `${spellId}: ${what}`,
      ).toHaveLength(1);
    }
  });

  /**
   * And Phantom Steed's minute is cast rather than refused, which is the
   * eleventh spent row: the reading it recorded was "Casting Time: 1 minute or
   * Ritual", filed under `a-long-casting-time`, and what became of it is that
   * the rite runs.
   */
  it('runs the rite the long-casting row used to record', () => {
    expect(SRD_CONTENT.spell('phantom-steed')?.castingTime).toBe('long');
    expect(SRD_CONTENT.spell('phantom-steed')?.castingSeconds).toBe(60);
    expect(SRD_CONTENT.spell('phantom-steed')?.ritual).toBe(true);
  });

  /**
   * And five of them really are invisible to `CLAUSE_MARKERS`, which is what
   * makes them the floor's counterexamples rather than a guard that fired and
   * was obeyed. A clause may be written for any sentence precisely so that a
   * reader who sees one can record it.
   */
  it.each([
    ['arcane-hand', "The hand doesn't occupy its space"],
    ['true-polymorph', "it can't speak or cast spells"],
    ['imprisonment', 'The target becomes 1 inch tall'],
    ['maze', 'If it succeeds, it escapes, and the spell ends'],
    ['silence', 'Casting a spell that includes a Verbal component is impossible there'],
  ])('finds %s: "%s" with no marker to demand it', (spellId, phrase) => {
    const sentence = sentencesOf(spellId).find((text) => text.includes(phrase));
    expect(sentence, `${spellId}: ${phrase}`).toBeDefined();
    expect(markersIn(sentence ?? ''), `${spellId}: ${phrase}`).toEqual([]);
  });

  /**
   * **No shape id was invented, which is the constraint that makes the rest of
   * this checkable.** The vocabulary is exactly what it was.
   */
  it('names no shape the vocabulary did not already have', () => {
    const known = new Set<string>(Object.keys(MISSING_SHAPES));
    for (const [spellId, entry] of Object.entries(BLOCKED_ON)) {
      for (const shape of blockersIn(entry)) expect(known.has(shape), `${spellId}`).toBe(true);
    }
  });
});

/**
 * **One sentence in the four families needs an id this vocabulary does not
 * have**, and it is filed as the table's under protest rather than forced.
 *
 * SRD Confusion: "The Sphere's radius increases by 5 feet for each spell slot
 * level above 4." `SpellArea` holds one fixed size; `docs/design/spell-
 * definitions.md` says what a slot reaches — "the damage dice from the
 * definition's scaling ... the target count from the slot" — and an area is not
 * on that list. So a level 6 casting would be resolved over the level 4 Sphere
 * and catch too few creatures, which is this map's own definition of debt
 * rather than of fiction.
 *
 * Naming a shape for it is an architecture decision rather than a reading, so
 * the brief's rule applies: adjudicate to the nearest honest existing option and
 * say so. `table` is that option and it is **wrong** — nothing here is the DM's
 * — and the note says as much in its own first sentence, so the placeholder
 * cannot be mistaken for a finding.
 *
 * SRD Fog Cloud prints the only other instance, and this map records that spell
 * as blocked on nothing at all. That entry is outside these four families and
 * outside this task; it is named here so the next reader finds both together.
 */
describe('one clause is filed under protest, and says so', () => {
  it('records the slot-scaled area as a placeholder rather than an adjudication', () => {
    // **The placeholder has been spent rather than resolved**, and that is
    // worth saying plainly: Confusion is a tracked definition now, so the
    // entry that carried the protest is gone, and the shape nobody would name
    // was never named. What survives is the sentence itself, handed to the
    // table on every casting — and Fog Cloud below still prints it, so the
    // gap is as unclaimed as it ever was.
    expect(BLOCKED_ON['confusion']).toBeUndefined();
    expect(
      (SRD_CONTENT.spell('confusion')?.unmodelled ?? []).filter((note) =>
        note.includes('a slot reaches damage dice, a target count and a duration, and never an area'),
      ),
    ).toHaveLength(1);
  });

  /** And the sentence really is one the spell prints, anchored like any other. */
  it('anchors it to the spell that prints it', () => {
    expect(
      unanchoredPhrases('confusion', [
        "The Sphere's radius increases by 5 feet for each spell slot level above 4",
      ]),
    ).toEqual([]);
  });

  /** The second instance, in a spell this map still calls blocked on nothing. */
  it('names the other spell in the book that prints the same sentence', () => {
    expect(
      sentencesOf('fog-cloud').some((sentence) =>
        sentence.includes("The fog's radius increases by 20 feet for each spell slot level above 1"),
      ),
    ).toBe(true);
    expect(blockersOf('fog-cloud')).toEqual([]);
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
   * **The second column is empty, and that is the end this pair was for.**
   *
   * It read "one shape's finishes have been read, and most have not" while
   * that was true and the whole population was grandfathered. IE-060 read the
   * nine paragraphs that were left, so every `finishes` the map still carries
   * is one somebody read — which is the state the split existed to reach, not
   * a guard that stopped checking. Asserting it the old way would now mean
   * leaving a paragraph unread on purpose to keep a number above zero.
   *
   * So the claim is the one that is still falsifiable: the first column says
   * something, and the second is empty **because the population was read**
   * rather than because nothing is blocked. The entry that is still
   * grandfathered is named in {@link BLOCKED_ON} and finishes nobody, which is
   * asserted below rather than assumed.
   */
  it('has read every finish it reports, and says so', () => {
    const rows = allShapeConsumers();
    expect(rows.filter((row) => row.unblocksRead.length > 0).length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.unblocksUnread.length > 0)).toEqual([]);
  });

  /**
   * And the column is empty for the right reason, which is the only way an
   * empty column is worth anything.
   *
   * One entry in the map is still grandfathered — Wish, whose Resistance the
   * book calls permanent and for which no shape id names a grant that outlives
   * every deadline the engine has. It is not in the second column because it
   * prints six blockers rather than because somebody read it, and the two are
   * told apart here: it is unread, it is in the map, and it finishes nothing.
   *
   * Barkskin stays as the other half of the same point: a shape whose last
   * claimant left the undefined population finishes nobody from **either**
   * column and holds its claim in the tracked one.
   */
  it('names the one entry nobody has read, and shows it finishes nothing', () => {
    const unread = Object.keys(BLOCKED_ON).filter((id) => !isSentenceComplete(id));
    expect(unread).toEqual(['wish']);
    expect(blockersOf('wish').length).toBeGreaterThan(1);
    // **This named `a-reduction-an-effect-applies-to-damage` until that shape
    // left the spell vocabulary.** Resistance walks through the
    // `damage-reduction` effect now and Shield's clause is filed under the
    // window it actually waits on, so the id's last claimant is SRD Ring of
    // Warmth and it lives in `ITEM_SHAPES` — where what is true of an item and
    // false of a casting belongs. The example is a different shape and the
    // claim is the same one: an empty unread column because the population was
    // read, rather than because nothing is blocked.
    expect(
      consumersOf('a-repeat-save-that-does-something-on-a-failure').unblocksUnread,
    ).toEqual([]);
    // **This named `an-armor-class-a-spell-floors` until that shape was built
    // and retired**, which is the same departure the example above records one
    // shape further on. The claim being made is about the *column* rather than
    // about either id: an empty unread column because the population was read,
    // rather than because nothing is blocked.
    expect(consumersOf('an-outcome-that-reads-the-targets-hit-points').unblocks).toEqual([]);
  });

  /**
   * **The claim SRD 5.2.1 does not print**, corrected at its source.
   *
   * Wish's entry named `an-exhaustion-level-a-spell-changes`, and nothing in
   * the paragraph the parser holds mentions Exhaustion: 5.2.1 rewrote what the
   * stress of a Wish costs as a Strength score of 3 for 2d4 days. The claim was
   * inherited from an edition this repository does not implement, which is a
   * different failure from the omissions this map keeps finding — a wrong
   * entry rather than a missing one, and the first of those.
   *
   * The shape stays, because the spell that actually prints the sentence now
   * claims it: Greater Restoration's "1 Exhaustion level" is a line no
   * mechanical marker can see, so it is carried by a marker-less entry — the
   * form that exists for exactly this.
   */
  it('files the Exhaustion level on the spell that prints one', () => {
    expect(blockersOf('wish')).not.toContain('an-exhaustion-level-a-spell-changes');
    for (const sentence of sentencesOf('wish')) expect(sentence).not.toContain('Exhaustion');
    expect(consumersOf('an-exhaustion-level-a-spell-changes').blocks).toEqual([
      'greater-restoration',
    ]);
    expect(consumersOf('an-exhaustion-level-a-spell-changes').unseen).toEqual([
      'greater-restoration',
    ]);
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
  // The working notes and the design records are archived; a description
  // that quotes one is quoting provenance, and provenance is where it was.
  { name: 'progress.md', label: 'docs/archive/PROGRESS.md', files: ['docs/archive/PROGRESS.md'] },
  {
    name: 'audit',
    label: 'the audit records under docs/archive/architecture/',
    files: readdirSync(`${HERE}../../../docs/archive/architecture`).map(
      (file) => `docs/archive/architecture/${file}`,
    ),
  },
  // The name a description writes is the file the definitions used to live
  // in; the definitions themselves are content now, so the run is looked for
  // in the catalogue as well as in the vocabulary that stayed.
  {
    name: 'spell-definitions.ts',
    label: 'packages/engine/src/spell-definitions.ts',
    files: ['packages/engine/src/spell-definitions.ts', 'packages/content/src/spells.ts'],
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
    label: 'docs/archive/design/event-log.md',
    files: ['docs/archive/design/event-log.md'],
  },
  { name: 'casting.md', label: 'docs/archive/design/casting.md', files: ['docs/archive/design/casting.md'] },
  {
    name: 'spell-definitions.md',
    label: 'docs/archive/design/spell-definitions.md',
    files: ['docs/archive/design/spell-definitions.md'],
  },
  {
    name: 'space-and-areas.md',
    label: 'docs/archive/design/space-and-areas.md',
    files: ['docs/archive/design/space-and-areas.md'],
  },
  {
    name: 'time-and-turns.md',
    label: 'docs/archive/design/time-and-turns.md',
    files: ['docs/archive/design/time-and-turns.md'],
  },
  // **Two files under one name**, for the reason `characters-and-equipment.md`
  // below is: the archived copy is where the damage pipeline was reviewed and
  // is what the older notes quote, and the current document is where the two
  // sentences this batch added were written — the family of D20 Tests a
  // selector may name, and the penalty a creature takes off its own damage.
  // Registering a second name for the same document would have been the
  // drifting copy this table exists to avoid.
  {
    name: 'rolls-and-damage.md',
    label: 'docs/archive/design/rolls-and-damage.md',
    files: ['docs/archive/design/rolls-and-damage.md', 'docs/design/rolls-and-damage.md'],
  },
  // **Two files under one name**, the way `spell-definitions.ts` above already
  // resolves to two. The archived copy is where the equipment architecture was
  // reviewed and is what the spell map's notes quote; the current document is
  // where the magic-item architecture was written afterwards, and it holds the
  // two sentences the item map cites — the instance identity and what ends an
  // attunement. Registering a second name for the same document would have
  // been the drifting copy this table exists to avoid.
  {
    name: 'characters-and-equipment.md',
    label: 'docs/archive/design/characters-and-equipment.md',
    files: [
      'docs/archive/design/characters-and-equipment.md',
      'docs/design/characters-and-equipment.md',
    ],
  },
  // Registered with their first citations, which is what the note on
  // `claude-integration.md` below says to do. All three are where an **item's**
  // gaps were already written down and reviewed: the boundary note, the
  // validator that refuses an item's grant by name, and the catalogue file that
  // states the three rules deciding what is transcribed.
  { name: 'content.md', label: 'docs/design/content.md', files: ['docs/design/content.md'] },
  // Registered with its first citation, which is the rule the note below
  // states: `light-and-obscurement-the-scene-holds` is the first shape to
  // quote the sight model, and it is the first thing in this table to name a
  // document written for a shape rather than the other way round.
  {
    name: 'light-and-sight.md',
    label: 'docs/design/light-and-sight.md',
    files: ['docs/design/light-and-sight.md'],
  },
  {
    name: 'content.ts',
    label: 'packages/engine/src/content.ts',
    files: ['packages/engine/src/content.ts'],
  },
  // The action economy, registered here as well as in the feature table: the
  // shape a spell is blocked on when it wants an errand no spender is told
  // apart by lives in `NAMED_ACTIONS`, and it became a spell shape when the
  // last feature under it left. A description naming a file this table does
  // not hold fails the *points at prose* guard rather than passing unchecked,
  // which is how the absence was found.
  {
    name: 'combat.ts',
    label: 'packages/engine/src/combat.ts',
    files: ['packages/engine/src/combat.ts'],
  },
  {
    name: 'items.ts',
    label: 'packages/content/src/items.ts',
    files: ['packages/content/src/items.ts'],
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
    // Keyed by the clause rather than by the marker, which a marker-less entry
    // does not have: a label reading "spare-the-dying: null" would name two
    // entries the same the day a spell wrote two of them.
    ...Object.entries(TRACKED_ADJUDICATED).flatMap(([spellId, written]) =>
      written.map((entry) => [`${spellId}: ${entry.clause}`, entry.note] as const),
    ),
    // The undefined population's clause notes, once an entry has any: they cite
    // this repository exactly as the other two maps' notes do, and a guard that
    // read two of the three maps would be narrower than it reads.
    ...Object.entries(BLOCKED_ON).flatMap(([spellId, entry]) =>
      clausesIn(entry).map((clause) => [`${spellId}: ${clause.clause}`, clause.note] as const),
    ),
    // The item vocabulary and the item map's clause notes, held to the same
    // rule by the same guard. A second corpus with a second copy of the
    // attribution rule would be the drifting spelling this file keeps a record
    // of; one corpus, one rule, two populations.
    ...Object.entries(ITEM_SHAPES).map(([shape, description]) => [shape, description] as const),
    ...Object.entries(ITEM_BLOCKED_ON).flatMap(([entryId, entry]) =>
      itemClausesIn(entry).map((clause) => [`${entryId}: ${clause.clause}`, clause.note] as const),
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
    // Both vocabularies, because the item half is a vocabulary over the same
    // repository and the rule it has to keep is the same one.
    for (const [shape, description] of [
      ...Object.entries(MISSING_SHAPES),
      ...Object.entries(ITEM_SHAPES),
    ]) {
      const said = description.toLowerCase();
      expect(
        sources.filter((source) => said.includes(source)),
        `${shape} names no place this repository already described it`,
      ).not.toEqual([]);
    }
  });

  /** A description that says nothing is a licence, so each must be a real sentence. */
  it('writes a real sentence for every shape', () => {
    for (const [shape, description] of [
      ...Object.entries(MISSING_SHAPES),
      ...Object.entries(ITEM_SHAPES),
    ]) {
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

  /**
   * And nothing claims a shape **any** vocabulary has dropped.
   *
   * The item half is here because gate G1 widened `TrackedAdjudication.why` to
   * `ItemBlockerId`: Remove Curse's Attunement clause is a debt whose shape is
   * `what-ends-attunement-besides-a-command`, which lives over there and
   * finishes on that very sentence. Minting a second id here for one gap is
   * the duplication the item vocabulary was split out to avoid, so a claim may
   * name either list and this guard reads both. What it still refuses is a
   * claim naming neither, which is the drift it was written for.
   *
   * **The feature half is the third and the last**, taken by the owner on
   * 2026-09-21 as the general form rather than a fourth enumeration: `why`
   * names a shape in any of the three maps. Speak with Animals, Gaseous Form
   * and Haste's narrowed action are all blocked on
   * `an-action-the-engine-has-no-spender-for`, which the feature book
   * describes because `NAMED_ACTIONS` leaves Influence and Utilize out for a
   * reason that has nothing to do with spells.
   */
  it('has a vocabulary that covers every claim', () => {
    const known = new Set<string>([
      ...Object.keys(MISSING_SHAPES),
      ...Object.keys(ITEM_SHAPES),
      ...Object.keys(FEATURE_SHAPES),
    ]);
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

/**
 * Clauses a **re-reading** moved off a shape and onto the table.
 *
 * The fourth honest reason a recorded destination may no longer be where a
 * clause sits, and the first that is neither a shape being built nor a
 * population moving: somebody read the sentence again and found that what it
 * waits on is nothing. The split that recorded it was not wrong about the
 * arithmetic; it was wrong about the sentence.
 *
 * SRD Speak with Animals is the first. Gate G1 filed "skill options with them"
 * against `an-action-the-engine-has-no-spender-for` on the reading that the
 * Influence action had no spender — `NAMED_ACTIONS` holds `influence` now,
 * `takeInfluence` takes it, and that command has never narrowed by the
 * target's creature type, so an Influence attempt on a Beast was always legal
 * and always rolled. There was nothing for the spell to widen. What it buys is
 * that the Beast understands, which is speech, and no rule reads speech
 * afterwards.
 *
 * A reviewed list for {@link BUILT_CLAUSES}' reason and held to the same rule
 * in both directions: an entry here must really be filed as `'table'` now, so
 * a licence cannot go stale in silence.
 */
const HANDED_OVER: readonly (readonly [string, string])[] = [
  ['speak-with-animals', 'skill options with them'],
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
   * **Unless what it went to has since been built**, which was the only honest
   * reason a clause could leave the map, and it comes two ways. The shape may
   * be gone: IE-019 built `an-outcome-that-varies-by-creature-type` and
   * executed Shatter with it. Or the shape may stand while *this clause* is
   * finished, which is {@link BUILT_CLAUSES} — a reviewed list, because a
   * shape can be built in part and nothing derived can tell that from a silent
   * loss.
   *
   * **The third reason is that the spell got written anyway**, which the batch
   * that unblocked the magic items is the first to cause: Etherealness is a
   * tracked definition now, so its entry is gone from `BLOCKED_ON` and its two
   * movement clauses are sentences of its own `unmodelled`, held by
   * `spell-tracking.test.ts` and handed to the table on every casting. The
   * clause did not vanish and the shape was not built — the population moved.
   * A clause that vanished under none of the three fails here, which is what
   * keeps the exception a branch rather than a hole.
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
    //
    // **Or by the clause, where the entry carries no marker.** `null` is not a
    // key, so a marker-less entry cannot be recorded under one — and a lookup
    // that missed it would fall through to the branch that forgives a clause
    // whose spell has since been written, which is a silent pass on a
    // re-filing that never happened. Speak with Animals is the first of these.
    const tracked = (TRACKED_ADJUDICATED[spellId] ?? []).find(
      (entry) => entry.marker === clause || (entry.marker === null && entry.clause === clause),
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
    const handed = new Set(HANDED_OVER.map(([id, clause]) => `${id}/${clause}`));
    const landed = new Map<string, number>();

    for (const [spellId, clause, wentTo] of split.held) {
      const why = filedAt(spellId, clause, wentTo);
      if (why === undefined) {
        expect(
          live.has(wentTo) &&
            !built.has(`${spellId}/${clause}`) &&
            !DEFINED_SPELL_IDS.has(spellId),
          `${spellId}: "${clause}" left the map while ${wentTo} is still missing`,
        ).toBe(false);
      } else if (handed.has(`${spellId}/${clause}`)) {
        // Re-read and handed over: the destination is history and `'table'`
        // is where the sentence sits now — see {@link HANDED_OVER}, whose
        // entries are held to exactly this and would otherwise rot unnoticed.
        expect(why, `${spellId}/${clause}`).toBe('table');
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
   * `a-condition-immunity-a-spell-grants` was — and that id has since been
   * built and left two narrower ones of its own, which is the lesson a third
   * time and the second measurement of it.
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
   *
   * **It is a tracked definition now and both halves came with it**, which is
   * the part that could not be done until a tracked entry was allowed to carry
   * no marker. The save trips one, so the automatic success is anchored to the
   * sentence that forces the save; the −10 trips none — `\bcheck\b` does not
   * match "checks" — so the penalty is the marker-less entry, and without it
   * `a-bonus-narrowed-to-a-skill` would have had no claimant left in any
   * population the day this spell was written.
   *
   * **Pass without Trace was the second claimant and has left**, which is the
   * shape narrowing to what is actually missing rather than the claim
   * weakening. "a +10 bonus to Dexterity (Stealth) checks" is the same gap in
   * the same words and it was read off an undefined paragraph; the spell is
   * written now, and the bonus is narrowed — `AreaStanding`'s `bonus` member
   * carries the `BonusNarrowing` Guidance's stored bonus already carried, and
   * `areaBonuses` withholds it from every check that names another skill. What
   * is left under the id is Enthrall's, which is the half nothing reaches: a
   * *penalty* on a **stored** bonus, gathered by `checkBonuses` off the
   * creature rather than derived from where it is standing.
   */
  it('leaves Enthrall blocked, on the outcome and on the penalty', () => {
    expect(BLOCKED_ON['enthrall']).toBeUndefined();
    expect(SRD_CONTENT.spell('enthrall')).not.toBeNull();
    expect((TRACKED_ADJUDICATED['enthrall'] ?? []).map((entry) => entry.why)).toEqual([
      'a-fact-only-the-table-can-declare',
      'a-bonus-narrowed-to-a-skill',
    ]);
    expect(consumersOf('a-bonus-narrowed-to-a-skill').unseen).toEqual(['enthrall']);
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
   *
   * **And a third population claims it now.** Scrying was undefined here until
   * the Crystal Ball needed it; it is tracked, and the two tables that modify
   * its save — how well the caster knows the target, and what of the target's
   * they are holding — are the same fact, recorded in `TRACKED_ADJUDICATED`
   * instead. The shape did not move; the spell did.
   *
   * **And a second executed claimant arrived by a build finishing half a
   * sentence**, which is the reading this shape exists to keep honest. SRD
   * Sleep spares "Creatures that don't sleep, such as elves, or that have
   * Immunity to the Exhaustion condition"; `save.autoSucceedIf` is the second
   * clause, read off `conditionImmunitiesOf`, and the first is a fact the
   * engine holds about nobody — the SRD prints it of no creature type and the
   * Elf states it as a species trait no grant kind carries. So the spell moved
   * off the shape the build retired and onto this one, which is where a fact
   * rather than a mechanism belongs.
   *
   * **And a third executed claimant arrived the same way — and has since left
   * again**, which is the other half of the same honesty. SRD Levitate asks
   * its Constitution saving throw of "an **unwilling** creature" and a willing
   * one is simply lifted; that clause was filed here because "the casting has
   * no word for consent", and the word arrived: `CastSpellRequest.willing` is
   * the fact the table declares and `save.unlessWilling` is the clause that
   * reads it. A declared fact is what this shape has always been — the table
   * says it and the engine uses it — so a claimant leaving by being *given a
   * field to declare into* is the shape working, not shrinking.
   */
  it('keeps the shape for the facts the build did not reach', () => {
    const fact = consumersOf('a-fact-only-the-table-can-declare');
    // Call Lightning was the second undefined consumer and is tracked now, so
    // its reading — the extra 1d10 for being outdoors in a storm — moved into
    // the tracked map against the sentence it was read from. Enthrall was the
    // one left, and it followed the same way once a tracked entry could carry
    // the half of it no mechanical marker sees: the undefined population is
    // empty of this shape and all three claims are live somewhere else.
    expect(fact.undefined).toEqual([]);
    expect(fact.executed).toEqual(['hunters-mark', 'sleep']);
    expect(fact.tracked).toEqual(['call-lightning', 'enthrall', 'scrying']);
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

    // The wrong half, and where it went — and then what happened to it.
    // IE-042 built `a-condition-immunity-a-spell-grants` in its turn, so that
    // id is retired too and Mind Blank is defined: the prediction was wrong for
    // two tranches and the debt it named is paid. Asserting the *end* of it is
    // what keeps this test about the lesson rather than about a snapshot.
    expect(Object.keys(MISSING_SHAPES)).not.toContain('a-condition-immunity-a-spell-grants');
    expect(claimedShapes().has('a-condition-immunity-a-spell-grants')).toBe(false);
    expect(BLOCKED_ON['mind-blank']).toBeUndefined();
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
    // **And the value half is no longer a blocker either.** `choiceStated`
    // carries a condition, an ability or a skill on the same terms a damage
    // type has been carried since IE-017, and `statedChoice` substitutes the
    // caster's answer into the effect that holds one — which took
    // Blindness/Deafness, Lesser Restoration, Enhance Ability and Guidance off
    // this id as surely as the damage type took the six above.
    for (const id of [
      'blindness-deafness',
      'lesser-restoration',
      'enhance-ability',
      'guidance',
    ]) {
      const shapes =
        BLOCKED_ON[id] !== undefined
          ? blockersOf(id)
          : [
              ...(ADJUDICATED[id]?.map((e) => e.why) ?? []),
              ...(TRACKED_ADJUDICATED[id]?.map((e) => e.why) ?? []),
            ];
      expect(shapes, id).not.toContain('a-choice-made-at-the-casting');
    }
    // **And the other arm is built too, which is what this loop now records.**
    // A choice of *which effects run* is `SpellDefinition.options`: a record
    // of named branches, one of which a casting runs, named as the tenth
    // stated fact and pinned onto the record. Thaumaturgy's six wonders and
    // Command's five words left by that door, and Enlarge/Reduce's two halves
    // are the shell of it with every clause inside them filed under a shape of
    // its own. What is left under the id is **Glyph of Warding**, whose two
    // glyphs are a stored casting rather than a branch — a shape of its own,
    // and the one population the claim still reads across.
    for (const id of ['glyph-of-warding']) {
      const shapes =
        BLOCKED_ON[id] !== undefined
          ? blockersOf(id)
          : [
              ...(ADJUDICATED[id]?.map((e) => e.why) ?? []),
              ...(TRACKED_ADJUDICATED[id]?.map((e) => e.why) ?? []),
            ];
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
    // All three are tracked now — the third catalogue pass took the whole
    // family — so the shape is claimed entirely from the tracked and the
    // executed populations, and the undefined column is empty: Find Familiar
    // was the last of it, written on the kept summons on 2026-09-22.
    for (const id of ['arcane-hand', 'summon-dragon', 'giant-insect']) {
      expect(statBlock.tracked, id).toContain(id);
    }
    expect(statBlock.undefined).toEqual([]);
    expect(statBlock.executed).toContain('find-steed');
    // Unseen Servant was the fourth and is tracked too, which is the third
    // population claiming the shape rather than the shape losing a consumer.
    expect(statBlock.tracked).toContain('unseen-servant');
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
   * **Hunter's Mark and Hex were the fifth and sixth, and they were one
   * sentence.** SRD gives both "If the target drops to 0 Hit Points before
   * this spell ends, you can take a Bonus Action ... to curse a new creature",
   * and IE-035 defined Hunter's Mark without that clause while leaving Hex
   * undefined. It filed the sentence for one of them and not the other on its
   * first pass, which moved this shape's `unblocks` from 0 to 1 on the
   * strength of a spell that prints the same rule — the argument for re-filing
   * **both ends of a shared sentence in the same pass**.
   *
   * **They left together too**, which is the same argument arriving from the
   * other end: the re-aiming Bonus Action was built once and both spells took
   * it in one pass, so neither is in this list any more and the shape is down
   * to the four the ranked map and Aura of Life account for.
   */
  it('finds one more than the ranked map did for reading the target’s Hit Points', () => {
    expect(consumersOf('an-outcome-that-reads-the-targets-hit-points').blocks).toEqual([
      'aura-of-life',
      'divine-word',
      'power-word-kill',
      'power-word-stun',
    ]);
  });

  /**
   * A shape both a definition and an undefined spell name is counted once each.
   *
   * `speed-and-movement-modes` was the example and is gone; `movement-modes`
   * is the half of it that stands, and it now spans all three populations —
   * one executed definition, two tracked ones and a run of undefined spells —
   * which is the property being asserted. The executed claimants were Gaseous
   * Form, Levitate and Wind Walk; the first has since left the shape by being
   * built, and the other two still hold a clause each.
   */
  it('adds all three populations up', () => {
    const modes = consumersOf('movement-modes');
    // Wind Walk moved from the second column into the first when its action
    // sentence was written: the Fly Speed, the hovering, the Prone Immunity and
    // the three Resistances are the same reading in the same words, and what
    // changed is that the definition now resolves something, so they are an
    // executed spell's debt. A shape that spanned two populations still spans
    // two, which is the property this test is about.
    //
    // And a third executed claimant arrived with the lift: SRD Levitate's
    // "which allows it to move as if it were climbing" is the same missing
    // distinction, and the lift opened the other side of it — a creature held
    // twenty feet up walks its ordinary Speed sideways through the air,
    // because `checkRise` refuses a rise and asks nothing of a creature that
    // is already off the ground.
    //
    // **And Gaseous Form has left the shape altogether**, which is the third
    // way a claimant goes: not moving column and not being dropped, but being
    // built. Its "only method of movement is a Fly Speed of 10 feet, and it
    // can hover" is one `SpeedChange` now — `only`, which replaces every
    // other Speed rather than adding a mode beside them — so the shape has
    // one fewer executed claimant and still spans two populations.
    expect(modes.executed).toEqual(['levitate', 'wind-walk']);
    // **Fly and Spider Climb left the shape rather than moving column**,
    // which is what building a writer looks like from here: the two are
    // executed definitions now, and neither has a clause this shape still
    // holds. Fly's whole printed benefit is one grant and what is left of it
    // names no mechanic at all; Spider Climb's Climb Speed is granted and
    // what is left — which walls a creature may walk on — is the table's,
    // filed against a lattice that holds no surfaces.
    expect(modes.tracked).toEqual(['alter-self', 'freedom-of-movement']);
    // A floor below the population rather than on it, lowered by the batch
    // that wrote Freedom of Movement — which moved a spell from the third
    // population into the second and so shrank this one by one.
    // A floor below the population rather than on it, lowered again by the
    // batch that wrote Alter Self — which moved the fourth claimant from the
    // third population into the second, as Freedom of Movement did before it.
    // **The third catalogue pass emptied the third column**, moving Wind Walk
    // and Tsunami into the tracked one, so the floor that used to sit under it
    // is gone rather than lowered: a floor of zero is not a claim. What this
    // test is actually for is the sum — a shape's `blocks` is the three
    // populations added up and never one of them mistaken for the total — and
    // that claim is stronger now, because a shape whose undefined column is
    // empty is exactly where a reader who only counted that column would read
    // zero and stop.
    expect(modes.undefined).toEqual([]);
    expect(modes.executed.length + modes.tracked.length).toBeGreaterThan(0);
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
   * The single largest blocker across all three populations, named rather than
   * felt.
   *
   * **It was `a-long-casting-time` and is not**, which is the plainest
   * consequence of the second catalogue pass: that shape ranked first on a
   * mechanism the engine had already built, and writing the spells took it
   * from thirty-eight consumers to fourteen. What is heaviest now is an action
   * a spell compels or forbids, which is a mechanic nobody has built — so the
   * top of the ranking is a real blocker again rather than a bucket.
   *
   * The floor sits well below the population rather than on it, which is the
   * lesson this file records about `> 200`: four of the spells the old row
   * held left on the batch that wrote Scrying, Tiny Hut, Private Sanctum and
   * Resurrection, and a floor set at the old count would have failed by
   * succeeding. **Moved from 30 to 20 with the row itself**, against 28
   * consumers — the same eight spells of slack the old pair had. The real
   * number is `COVERAGE.md`'s.
   */
  it('names the largest blocker in the undefined population', () => {
    const ranked = [...allShapeConsumers()].sort((a, b) => b.blocks.length - a.blocks.length);
    // **The top of this ranking is a bundle, and saying so is the point.**
    // Gate G1 read `an-action-a-spell-compels-or-forbids` as five mechanisms
    // rather than one; P2-A moved three of its adjudications out — Speak with
    // Animals, Gaseous Form and Haste's narrowed action, all to
    // `an-action-the-engine-has-no-spender-for` — and recorded the rest in
    // `SPLIT_BUNDLES`. It still leads, so the honest assertion is not that the
    // leader is a mechanism nobody built but that **a leader which is a bundle
    // is declared as one**: nobody may brief it as a unit while it sits here.
    //
    // **The tie is back, and it is asserted as one rather than as a leader.**
    // P2-T11 gave Phantom Steed a definition, which moved its "ends early if
    // the steed takes any damage" out of the tracked map and into an executed
    // spell's debt under `a-casting-ended-by-a-trigger` — and that shape now
    // ties the bundle at the top. `ranked[0]` is meaningless across a tie, so
    // what is named is the whole of the leading band, sorted; the bundle claim
    // is made about the bundle by name.
    const leaders = ranked
      .filter((one) => one.blocks.length === ranked[0]!.blocks.length)
      .map((one) => one.shape)
      .sort();
    // **The tie is over and the bundle is not in it**, which is what happens
    // when a bundle is actually split. One batch built `grants` and
    // `OutcomeRiders.spends`, paid two of the five arms and sent three more to
    // ids of their own, taking the bundle from twenty spells to seven; another
    // in the same batch took `a-casting-ended-by-a-trigger` from eight blocks
    // to five. **Two tracks each wrote this assertion for the ranking their
    // own branch produced, and neither survived the merge of both** — which is
    // why the leader is asserted by measurement here and not by name from a
    // digest.
    //
    // **And the tie is back, for the third time and by the same mechanism.**
    // Gust of Wind was executed, which took its "50 percent chance to
    // extinguish them" out of the tracked map — and the executed map has no
    // entry to put it in, because `CLAUSE_MARKERS` sees no coin flip. So the
    // leader lost a consumer without anything being built for it, and
    // `a-casting-ended-by-a-trigger` drew level: a ranking is a measurement of
    // the populations rather than a statement about what is hard.
    expect(leaders).toEqual([
      'a-casting-ended-by-a-trigger',
      'a-random-outcome-that-is-not-a-d20',
    ]);
    expect(Object.keys(SPLIT_BUNDLES)).toContain('an-action-a-spell-compels-or-forbids');
    // And the split is visible from here rather than only in the record: the
    // bundle stands below the leader, and the largest piece to come out of it
    // stands on its own.
    const sizeOf = (shape: string) =>
      ranked.find((one) => one.shape === shape)?.blocks.length ?? 0;
    expect(sizeOf('an-action-a-spell-compels-or-forbids')).toBeLessThan(ranked[0]!.blocks.length);
    expect(sizeOf('a-creature-somebody-else-is-playing')).toBeGreaterThan(1);
    // The runners-up are asserted as a set and never by `slice` alone: two
    // shapes of equal size have no defined order between them. The tie this
    // used to record was broken on 2026-09-22, when Find Familiar was written
    // and `a-stat-block-created-mid-fight` lost its last undefined consumer.
    //
    // **And the band below the leaders is the next distinct size**, not
    // `ranked[1]`: while the top is a tie, the second entry of the ranking is
    // still in the leading band, and reading it as the runner-up would have
    // asserted the leaders twice under another name.
    const below = ranked.find((one) => one.blocks.length < ranked[0]!.blocks.length);
    expect(
      ranked
        .filter((one) => one.blocks.length === below!.blocks.length)
        .map((one) => one.shape)
        .sort(),
    ).toEqual([
      // `a-choice-made-at-the-casting` stood here until its second arm was
      // built. `SpellDefinition.options` is that arm — a choice of which
      // effects run — and Command and Thaumaturgy left the undefined and
      // tracked maps through it, which took the shape out of this band rather
      // than moving it down inside one.
      'a-second-place-to-put-a-creature',
      'a-stat-block-created-mid-fight',
      'an-effect-that-suppresses-other-magic',
    ]);
    // **Moved from 20 to 15 by the third catalogue pass, and the total fell
    // further than the tracked column rose.** Twelve undefined spells named
    // this shape; ten of them were written, and only two carry the claim into
    // `TRACKED_ADJUDICATED` — Confusion and Tsunami, whose blocking sentences
    // trip a mechanical marker. The other eight lost it, because the
    // adjudication map is keyed by marker and their sentences trip none; what
    // each of them says about the shape now lives in the definition's own
    // `unmodelled`, which no consumer count reads. So `blocks` went 28 to 20
    // while `tracked` went 4 to 6, and the eight-spell difference is the
    // asymmetry between the two maps rather than eight gaps being closed.
    // The ranking moved, which is the point: the bundle that used to sit at
    // the top of it was a bundle, and reading it apart took thirteen of its
    // twenty spells off it in one batch. The floor still sits below the
    // leader rather than on it, for the reason this paragraph records.
    expect(ranked[0]!.blocks.length).toBeGreaterThan(12);
  });
});

describe('a spell with one blocker is the leverage the map is for', () => {
  /**
   * Magic Missile was the spell that proved the second column is worth
   * reading, and it has left the map by having **both** of its blockers built.
   *
   * "Damage with neither an attack roll nor a save" was the clause everybody
   * quoted it for, and `PROGRESS.md` ranked that shape at 19 open spells. But
   * the darts are *distributed* — "you can direct them to hit one creature or
   * several" — and a casting that names the same target twice is refused, so
   * three darts into one goblin could not be said at all. That was the same
   * gap Mass Heal's "divided as you choose" has, and it was not downstream of
   * the first: you met it in the same sentence rather than after the missing
   * mechanism was built. **Reading the map that way is what made the spell
   * cost two builds rather than one**, and both of them landed: the
   * `auto-damage` effect for the first, and the aimed-roll count and split the
   * `attack` already carried — `rolls`, `rollsAt`, `aimedRollsIn` — for the
   * second, which is why the distribution half cost nothing new. A map that
   * had called it one blocker would have promised a definition a build short.
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
    // Both of its blockers were built, so it is off the map entirely rather
    // than down to one — which is the departure this paragraph predicted.
    expect(blockersOf('magic-missile')).toEqual([]);
    expect(BLOCKED_ON['magic-missile']).toBeUndefined();
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
   * **A row leaves this list by being built**, which has now happened three
   * times: Stoneskin stood here until IE-017 defined it, Divine Favor —
   * "your attacks with weapons deal an extra 1d4 Radiant damage on a hit" —
   * until IE-035 did, and **Heal** until the printed half of
   * `a-flat-amount-with-no-dice` was built and the Rod of Resurrection came
   * for it. Each was the map's prediction coming true, and the row going
   * rather than the assertion being loosened is what keeps the list a claim
   * about spells nobody has finished.
   *
   * **A row may also leave because the spell was written without the shape**,
   * which Scorching Ray is the first of: three rays from one casting is still
   * missing, and the spell is a tracked definition that spends the slot and
   * says so. That is a different departure from the other three and the
   * assertion below says which — the shape stands, and the spell no longer
   * waits on it to be cast at all.
   *
   * **Feather Fall left that second way**, and took the list's only row with
   * it. What replaces the row is the one spell left in the whole map with a
   * single blocker, because the claim this list makes is about *being* the
   * last thing between a spell and a definition, and a list with nothing in it
   * makes no claim at all — an `it.each` over an empty array registers no
   * tests and goes green for ever.
   */
  const SOLE: readonly (readonly [string, ShapeId])[] = [
    // "If it takes any damage or is targeted by another spell, this spell
    // ends, and no memories are modified."
    ['modify-memory', 'a-casting-ended-by-a-trigger'],
  ];

  it.each(SOLE)('%s is blocked on %s and nothing else', (spellId, shape) => {
    expect(blockersOf(spellId)).toEqual([shape]);
  });

  /**
   * The two rows that left, and the two different reasons — pinned, because a
   * row silently deleted looks exactly like a row that was never right.
   */
  it('records the two that left, and which way each went', () => {
    // A third way out, and the plainest: Revivify was the only spell this list
    // held for `healing-that-raises-the-dead`. It became a tracked definition,
    // and then the shape was **built** — the `revive` effect and
    // `creature-revived` — so it is executed now and owes the table only the
    // old age and the body parts. The shape keeps its four undefined
    // claimants, which is why it is still claimed: what changed is which
    // population owes it and by how much, rather than whether it is owed.
    expect(BLOCKED_ON['revivify']).toBeUndefined();
    expect(TRACKED_ADJUDICATED['revivify']).toBeUndefined();
    expect(ADJUDICATED['revivify']?.map((entry) => entry.why)).toEqual(['table']);
    expect(claimedShapes().has('healing-that-raises-the-dead')).toBe(true);

    // Built: the printed half of the amount shape exists, so Heal executes and
    // carries no residue at all.
    expect(BLOCKED_ON['heal']).toBeUndefined();
    expect(ADJUDICATED['heal']).toBeUndefined();
    expect(SRD_CONTENT.spell('heal')?.unmodelled ?? []).toEqual([]);

    // Written anyway, and then **built** — the fourth way out, and the one
    // this row was left standing to record. Scorching Ray was written as a
    // tracked definition while `several-attack-rolls-from-one-casting` was
    // missing entirely; the count arrived first and the spell hurled its rays
    // for real while still owing a line, and the caster's own split of them
    // arrived second. So the residue is gone too and the spell is clean —
    // which is the whole of the path this row records: blocked, written,
    // half-built, built.
    //
    // **And the shape does not retire with it.** Chromatic Orb still waits on
    // the part nobody has built — a roll aimed at a creature the casting never
    // named — so the id keeps a claimant, and what left is two spells rather
    // than the debt.
    expect(BLOCKED_ON['scorching-ray']).toBeUndefined();
    expect(claimedShapes().has('several-attack-rolls-from-one-casting')).toBe(true);
    expect(SRD_CONTENT.spell('scorching-ray')?.effects).not.toEqual([]);
    expect(ADJUDICATED['scorching-ray']).toBeUndefined();
    expect(SRD_CONTENT.spell('scorching-ray')?.unmodelled ?? []).toEqual([]);
    expect(ADJUDICATED['eldritch-blast']).toBeUndefined();
    expect(SRD_CONTENT.spell('eldritch-blast')?.unmodelled ?? []).toEqual([]);

    // And a third departure, which went the whole way in two steps and is the
    // only row here that records both of them. Barkskin was undefined, then
    // tracked on `an-armor-class-a-spell-floors` alone, and is now executed:
    // the second arm of `armor-class` is a floor read after the calculation,
    // the Shield and every flat bonus. Its last claimant having left, the
    // shape is retired the way `condition-removal` was, so what this row now
    // pins is that the id is gone from the vocabulary rather than sitting in
    // it unclaimed.
    expect(BLOCKED_ON['barkskin']).toBeUndefined();
    expect(TRACKED_ADJUDICATED['barkskin']).toBeUndefined();
    expect(Object.keys(MISSING_SHAPES)).not.toContain('an-armor-class-a-spell-floors');
    expect(SRD_CONTENT.spell('barkskin')?.effects).toEqual([{ kind: 'armor-class', minimum: 17 }]);

    // **A fourth, and the only row to leave this list in two steps.** Feather
    // Fall waited on `falling` and nothing else. The *trigger* half arrived
    // first — a fall the engine can see, a declared fact with a Reaction
    // window over it — and the spell was written as a tracked definition that
    // spent the slot and said what it still owed. The half with the number in
    // it arrived second: `fall-ward` is a grant the landing reads, so "the
    // creature takes no damage from the fall, and the spell ends for that
    // creature" is executed and the spell is clean of the shape.
    //
    // **And the shape does not retire with it**, which is the pattern
    // Scorching Ray's row records too: Reverse Gravity still needs a failed
    // save to *produce* a fall, which nothing does, so `falling` keeps a
    // claimant rather than being retired on the strength of the half that
    // landed.
    expect(BLOCKED_ON['feather-fall']).toBeUndefined();
    expect(claimedShapes().has('falling')).toBe(true);
    expect(SRD_CONTENT.spell('feather-fall')?.effects).not.toEqual([]);
    expect(TRACKED_ADJUDICATED['feather-fall']).toBeUndefined();
    expect((ADJUDICATED['feather-fall'] ?? []).map((entry) => entry.why)).toEqual(['table']);
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
  // list, so the removal was done here and the flat 70 was all that was left.
  // The amount shape's printed half has since been built too, so both halves
  // of the sentence are executed and the spell has left this map entirely.
  it('finishes the removal half of Heal, and then the other half', () => {
    expect(blockersOf('heal')).toEqual([]);
    expect(SRD_CONTENT.spell('heal')?.effects.map((effect) => effect.kind)).toEqual([
      'heal',
      'end-condition',
    ]);
  });

  // Greater Restoration removes "one of the following", and one of them is
  // "1 Exhaustion level" — a level rather than a condition, which a list of
  // condition names cannot say.
  it('keeps what a list of condition names cannot remove', () => {
    // The spell is tracked now, so the reading moved rather than went: the
    // choice among five is in `TRACKED_ADJUDICATED` against the line it is
    // about, and the Exhaustion level is in the definition's own `unmodelled`
    // because that line trips no marker for a guard to demand one against.
    // Gaseous Form's occupancy override made the same move first.
    expect(BLOCKED_ON['greater-restoration']).toBeUndefined();
    expect(TRACKED_ADJUDICATED['greater-restoration']?.map((entry) => entry.why)).toEqual([
      'an-exhaustion-level-a-spell-changes',
      'a-choice-made-at-the-casting',
      'a-hit-point-maximum-a-spell-moves',
    ]);
    expect(
      (SRD_CONTENT.spell('greater-restoration')?.unmodelled ?? []).filter((note) =>
        note.includes('Exhaustion is a level the engine counts'),
      ),
    ).toHaveLength(1);
    // **And the shape is claimed by this spell rather than by Wish.** The
    // Exhaustion level had been in the definition's own `unmodelled` and
    // nowhere else, because the line trips no mechanical marker and every
    // entry here had to carry one; `marker: null` is the form that ended that,
    // and it was written the moment somebody looked. Wish's claim on the same
    // shape was an edition older than this book — see the Exhaustion test
    // above — so the two corrections are one.
    expect(consumersOf('an-exhaustion-level-a-spell-changes').blocks).toEqual([
      'greater-restoration',
    ]);
  });

  // Calm Emotions *suppresses* a condition it did not cause and restores it
  // when the spell ends, which is not a removal — and, once IE-042 built the
  // Immunity in the clause beside it, is not that either: an Immunity refuses a
  // condition and a suppression silences one that has already landed.
  // The spell is tracked now, so the reading moved rather than went: both
  // shapes are in `TRACKED_ADJUDICATED` against the sentences they were read
  // from, and the suppression is the marker-less one — "conditions" is not
  // "condition", so no guard could have demanded it.
  it('reads suppression as neither a removal nor the granted immunity', () => {
    expect(BLOCKED_ON['calm-emotions']).toBeUndefined();
    expect(
      [...new Set((TRACKED_ADJUDICATED['calm-emotions'] ?? []).map((entry) => entry.why))].sort(),
    ).toEqual(['a-condition-a-spell-suppresses', 'a-spells-effects-applied-to-different-targets']);
    expect(
      (TRACKED_ADJUDICATED['calm-emotions'] ?? []).find(
        (entry) => entry.why === 'a-condition-a-spell-suppresses',
      )?.marker,
    ).toBeNull();
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

    // A ward against arriving is suppression, not teleportation. All three are
    // tracked definitions now, and each reading moved into
    // `TRACKED_ADJUDICATED` against the very sentence it was read from —
    // Hallow's last of the three, filed under the `teleport` marker the
    // sentence trips.
    expect(BLOCKED_ON['hallow']).toBeUndefined();
    expect(TRACKED_ADJUDICATED['hallow']?.map((entry) => entry.why)).toContain(
      'an-effect-that-suppresses-other-magic',
    );
    // Magic Circle is tracked now and its half of the re-filing made the same
    // move Forbiddance's did: the ward against arriving is anchored to the
    // very sentence it was read from, in the tracked map.
    expect(BLOCKED_ON['magic-circle']).toBeUndefined();
    expect(TRACKED_ADJUDICATED['magic-circle']?.map((entry) => entry.why)).toContain(
      'an-effect-that-suppresses-other-magic',
    );
    expect(BLOCKED_ON['forbiddance']).toBeUndefined();
    expect(TRACKED_ADJUDICATED['forbiddance']?.map((entry) => entry.why)).toContain(
      'an-effect-that-suppresses-other-magic',
    );
    // A destination off the scene is the second place, which one of the two
    // already named and the other had never recorded at all. Teleport is a
    // tracked definition now, so its half of the re-filing lives in the
    // definition's own notes rather than here, and the sentence that trips a
    // marker — the GM's d100 — is in `TRACKED_ADJUDICATED`.
    // Teleportation Circle is tracked now too, and its reading made the same
    // move: the destination is still a second place and the claim now sits in
    // the tracked map instead of the undefined one.
    expect(BLOCKED_ON['teleportation-circle']).toBeUndefined();
    expect(TRACKED_ADJUDICATED['teleportation-circle']?.map((entry) => entry.why)).toEqual([
      'a-second-place-to-put-a-creature',
    ]);
    expect(BLOCKED_ON['teleport']).toBeUndefined();
    expect(
      (SRD_CONTENT.spell('teleport')?.unmodelled ?? []).some((note) =>
        note.includes('a second place to put a creature'),
      ),
    ).toBe(true);
    // And Blink kept the two halves this build did not reach until it was
    // written. Both are in the definition's own notes, and **all three of its
    // sentences are in the tracked map now**: the d6 was there because it
    // trips a marker, and the other two were dropped on the way out of
    // `BLOCKED_ON` because no marker could see them — which is the loss the
    // marker-less entry form was added to stop, arriving a batch late on the
    // spell this very row is about.
    expect(BLOCKED_ON['blink']).toBeUndefined();
    expect(TRACKED_ADJUDICATED['blink']?.map((entry) => entry.why)).toEqual([
      'a-random-outcome-that-is-not-a-d20',
      'a-second-place-to-put-a-creature',
      'table',
    ]);
    expect(
      (SRD_CONTENT.spell('blink')?.unmodelled ?? []).some((note) =>
        note.includes('a second place to put a creature'),
      ),
    ).toBe(true);
  });

  // And the two spells IE-014 defined leave the map entirely, with their debt
  // in ADJUDICATED where an executed spell's debt belongs.
  it('moves a newly defined spell out of the map and into the adjudications', () => {
    expect(BLOCKED_ON['lesser-restoration']).toBeUndefined();
    expect(BLOCKED_ON['protection-from-poison']).toBeUndefined();
    // Lesser Restoration's one adjudication was the "**one** condition" the
    // caster picks, and the debt is paid: it holds none now, which is the end
    // state this row was always tracking rather than a row that stopped
    // mattering.
    expect(ADJUDICATED['lesser-restoration']).toBeUndefined();
    // IE-014 gave this two adjudications, IE-017 built one of them away and
    // P2-F1 built the other: the condition-keyed save is the axis three
    // species traits wanted, and this spell's own sentence is the fourth. So
    // the entry is gone rather than emptied, which is where Lesser
    // Restoration's went and what an executed spell with no debt looks like.
    expect(ADJUDICATED['protection-from-poison']).toBeUndefined();
  });
});

describe('the shape that was built three tranches before its entries were re-read', () => {
  /**
   * **`a-long-casting-time` is retired, and it should have been retired twice
   * before.**
   *
   * IE-034 built the clock half — a casting of a minute or more is declared,
   * runs on the clock and settles — and IE-041 built the obligation, and the
   * shape's own description has said "the mechanism is whole" ever since.
   * Three entries went on naming it anyway, and the map went on printing a
   * column of claimants for a gap that did not exist. Every one of the three
   * was wrong in the same way and none of them was found by a guard: the
   * shape was claimed, so "no shape sits unclaimed" was satisfied; the
   * claimants were grandfathered, so no clause had to say what the blocker
   * was. Reading the three paragraphs is what found it, which is the argument
   * this whole instrument makes, arriving on the instrument itself.
   *
   * | | |
   * |---|---|
   * | Find Familiar | the hour and the Ritual, re-filed `expressible` — it keeps four other blockers |
   * | Dream | a minute, re-filed `expressible` — what holds it back is a printed Range of Special |
   * | Mirage Arcane | ten minutes, re-filed `expressible` — the same, with a Range of Sight |
   *
   * So the shape is gone from {@link MISSING_SHAPES}, the way
   * `outcome-scoped-child-effects`, `condition-removal`, `teleportation` and
   * `a-payout-at-a-turn-boundary` went before it. Its retirement is the fifth
   * and the first that was **overdue** rather than earned by a build.
   */
  it('has retired the shape the clock and the obligation finished', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('a-long-casting-time');
    expect(claimedShapes().has('a-long-casting-time')).toBe(false);
  });

  /**
   * And the spells it used to block are still long castings the engine runs,
   * which is the half a retirement must not lose.
   *
   * Regenerate is the one the map called a `finishes` and was never blocked at
   * all; the four the magic items came for are tracked definitions on the same
   * mechanism; Dream and Mirage Arcane have since become two more; and the one
   * that is left carries the casting time as an `expressible` clause rather
   * than as a blocker.
   */
  it('keeps every long casting it used to stand in front of', () => {
    expect(BLOCKED_ON['regenerate']).toBeUndefined();
    expect(SRD_CONTENT.spell('regenerate')?.effects.map((effect) => effect.kind)).toEqual([
      'heal',
      'turn-payout',
    ]);
    expect(SRD_CONTENT.spell('regenerate')?.castingTime).toBe('long');
    for (const id of [
      'scrying',
      'tiny-hut',
      'private-sanctum',
      'resurrection',
      'hallow',
      'dream',
      'mirage-arcane',
    ]) {
      expect(BLOCKED_ON[id], id).toBeUndefined();
      expect(SRD_CONTENT.spell(id)?.castingTime, id).toBe('long');
    }
    // And the one that carried the casting time as an `expressible` clause is
    // written now, and the rite is run: an hour, or the Ritual.
    expect(BLOCKED_ON['find-familiar']).toBeUndefined();
    expect(SRD_CONTENT.spell('find-familiar')?.castingTime).toBe('long');
    expect(SRD_CONTENT.spell('find-familiar')?.castingSeconds).toBe(3600);
    expect(SRD_CONTENT.spell('find-familiar')?.ritual).toBe(true);
  });

  /**
   * **The protest, and the ruling that answered it.**
   *
   * `SpellRange` is Self, Touch or a number of feet. SRD prints "Special" for
   * one of these and "Sight" for the other, and for three tranches both were
   * filed as the table's **under protest** — the form Confusion's slot-scaled
   * Sphere used — on the stated grounds that no shape id named the gap and
   * that naming one would be an architecture decision the reading had not
   * taken.
   *
   * The decision was taken and it went the other way: there was never a shape
   * to name. "Some text is the DM's alone ... the casting hands the printed
   * text to whoever is running the table, marked explicitly as a thing only the
   * DM can decide. **Not a format arm to invent, a handover to make visible.**"
   * So `range: { kind: 'dm' }` says the book asked a question, `dmDecides`
   * carries the printed words, and the engine measures nothing — which is what
   * the protest was asking for and is not a `Sight` range with sight in it.
   *
   * Pinned here, where the protest was, so the answer is as findable as the
   * complaint: the entries are gone, the definitions exist, and the vocabulary
   * grew by nothing.
   */
  it('has answered the Range neither spell could state', () => {
    for (const [id, field] of [
      ['dream', 'Range: Special'],
      ['mirage-arcane', 'Range: Sight'],
    ] as const) {
      expect(BLOCKED_ON[id], id).toBeUndefined();
      const definition = SRD_CONTENT.spell(id);
      expect(definition?.range.kind, id).toBe('dm');
      expect(definition?.dmDecides ?? [], id).toContain(field);
      // The phrase is still the book's, so the handover quotes rather than
      // paraphrases — the rule the clause it replaces was held to.
      expect(unanchoredPhrases(id, [field]), id).toEqual([]);
      // And no shape was invented for either of them: what each still names in
      // the tracked map is a gap that was already there for other spells.
      for (const entry of TRACKED_ADJUDICATED[id] ?? []) {
        if (entry.why === 'table' || entry.why === 'engine') continue;
        expect(Object.keys(MISSING_SHAPES), `${id}/${entry.clause}`).toContain(entry.why);
      }
    }
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
   * And the two of the twelve that carry a clause a **marker** can see are in
   * the tracked map under that marker — the other ten name nothing the markers
   * can see, which is what "tracked" is supposed to mean and is the measure of
   * how well the twelve fitted the bucket.
   *
   * **The other ten are in the map too now, and that is gate G1.** While they
   * were absent the report read the absence as "no debt" and printed them as
   * finished business; each carries a marker-less entry saying the table owns
   * its paragraph, which is the same claim written where a generator can count
   * it. The distinction this assertion still makes is the one that matters:
   * which of them a marker could have demanded an entry of.
   *
   * **Magic Mouth has grown a second entry and it is marker-less**, which is
   * P3-S6 rather than a weakening: reading the spell to the end found that its
   * own `unmodelled` line had been naming `a-casting-dismissed-early` since it
   * was written while the map carried no such claim. That sentence — "you can
   * have the spell end after it delivers its message" — is written in none of
   * the guard's words, so the entry is exactly the marker-less form that
   * exists for a blocker no marker can ask for. What is asserted below is the
   * original claim narrowed to the clause it was always about: **one** entry
   * each that a marker could have demanded.
   */
  it('files the two clauses the twelve carry under a marker', () => {
    expect(TRACKED_ADJUDICATED['hallucinatory-terrain']?.map((e) => e.why)).toEqual(['engine']);
    // **And Magic Mouth's second entry has left by being paid**, which is the
    // other end of the paragraph above: the sentence a marker could not see
    // was carried until the mechanism arrived, `offersEndAfterTrigger` is it,
    // and what is left of the spell is the one clause a marker *could* have
    // demanded. So the narrowing this assertion was written to make holds
    // with nothing beside it.
    expect(TRACKED_ADJUDICATED['magic-mouth']?.map((e) => e.why)).toEqual(['table']);
    for (const id of ['hallucinatory-terrain', 'magic-mouth']) {
      expect(
        (TRACKED_ADJUDICATED[id] ?? []).filter((entry) => entry.marker !== null).length,
        id,
      ).toBe(1);
    }
    for (const id of ['alarm', 'clairvoyance', 'identify', 'mending']) {
      const entries = TRACKED_ADJUDICATED[id] ?? [];
      expect(entries.length, id).toBeGreaterThan(0);
      expect(
        entries.every((entry) => entry.marker === null && entry.why === 'table'),
        id,
      ).toBe(true);
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
   * And Hypnotic Pattern owes nothing at all now, which is the other end of
   * the lesson the old row taught.
   *
   * The list was widened by *transcribing a sentence* rather than by
   * stretching a member until a spell fitted, and the residue it left —
   * "someone else uses an action to shake the creature out of its stupor" —
   * was carried on the spell until the verb it names existed. It does now, so
   * both halves of the sentence are causes and neither is prose.
   */
  it('builds both halves of Hypnotic Pattern’s sentence, the blow and the shake', () => {
    const shapes = (ADJUDICATED['hypnotic-pattern'] ?? []).map((entry) => entry.why);
    expect(shapes).not.toContain('a-casting-ended-by-a-trigger');
    expect(SRD_CONTENT.spell('hypnotic-pattern')?.endsEarly).toEqual([
      { on: 'target-takes-damage', ends: 'target' },
      { on: 'shaken-awake', ends: 'target' },
    ]);
    expect(SRD_CONTENT.spell('hypnotic-pattern')?.unmodelled ?? []).toEqual([]);
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
   *
   * **And reading the paragraph sentence by sentence found a third**, which is
   * the same lesson once more: the borrowed senses are their own blocker rather
   * than part of the double. Sight here is a pairwise declaration, so one
   * creature seeing through another's eyes has no state to sit in — and the
   * clause is filed the same way on Find Familiar and on Project Image, which
   * print it too, rather than three ways on three spells.
   */
  it('does not call Mislead finished, and records the blocker the entry had missed', () => {
    // The spell is tracked now and the reading survived the writing, which is
    // the strongest form of the claim: the casting-end trigger is in the
    // tracked map against the Invisible it cannot release, and the other two
    // are in the definition's own notes, where the table hears them.
    expect(BLOCKED_ON['mislead']).toBeUndefined();
    expect(TRACKED_ADJUDICATED['mislead']?.map((entry) => entry.why)).toEqual([
      'a-casting-ended-by-a-trigger',
      'a-stat-block-created-mid-fight',
    ]);
    for (const phrase of [
      'those triggers end a casting rather than one of its effects',
      'seeing through its eyes or hearing through its ears',
    ]) {
      expect(
        (SRD_CONTENT.spell('mislead')?.unmodelled ?? []).filter((note) => note.includes(phrase)),
        phrase,
      ).toHaveLength(1);
    }
    // Find Familiar is written now, and the clause moved with it into the
    // executed map rather than going away.
    expect(ADJUDICATED['find-familiar']?.map((entry) => entry.why)).toContain(
      'senses-beyond-declared-sight',
    );
    // Project Image was the second and is a tracked definition now. Its
    // senses clause trips no mechanical marker, so it could not move into the
    // tracked map; what carries it is the definition's own note, which the
    // table hears on every casting. The shape keeps Find Familiar and keeps
    // its claim.
    expect(BLOCKED_ON['project-image']).toBeUndefined();
    expect(
      (SRD_CONTENT.spell('project-image')?.unmodelled ?? []).filter((note) =>
        note.includes('no creature borrows another'),
      ),
    ).toHaveLength(1);
    expect(TRACKED_ADJUDICATED['project-image']?.map((entry) => entry.why)).toContain(
      'a-second-place-to-put-a-creature',
    );
  });

  /**
   * Two undefined spells do lose the blocker, and both keep others — so the
   * shape's `unblocks` column is unchanged by this build, which is exactly the
   * distinction between the two numbers that column exists to draw.
   */
  it('clears it from the two undefined spells that print one of the five', () => {
    // "The awakened target has the Charmed condition for 30 days **or until
    // you or your allies deal damage to it**." Awaken is tracked now, and the
    // record of that reading is the tracked entry saying the condition and its
    // ending are both writable and have nothing to land on.
    expect(BLOCKED_ON['awaken']).toBeUndefined();
    expect(TRACKED_ADJUDICATED['awaken']?.map((entry) => entry.why)).toEqual([
      'a-target-rule-the-format-cannot-state',
      'table',
    ]);
    expect(SRD_CONTENT.spell('awaken')?.castingTime).toBe('long');
    // "The spell ends if the warded creature makes an attack roll, casts a
    // spell, or deals damage." — Invisibility's three, word for word, and the
    // spell catalogue batch **spent** that reading: Sanctuary wrote all three
    // `endsEarly` causes and left the ward to the table.
    //
    // **And it is executed now**, which is why the tracked entry is gone from
    // under it rather than being asserted here: the owner's ruling of
    // 2026-09-22 made a passive defence a thing a definition can write, so the
    // ward is a `passive-defense` effect and the spell has left the tracked
    // population altogether. `spell-tracking.test.ts` records the departure in
    // `EXECUTED_SINCE` and the clauses it still hands over are adjudicated
    // among the executed. What is asserted here is the half this describe
    // block is about, which has not moved.
    expect(BLOCKED_ON['sanctuary']).toBeUndefined();
    expect(SRD_CONTENT.spell('sanctuary')?.endsEarly?.map((end) => end.on)).toEqual([
      'target-attacks',
      'target-casts',
      'target-deals-damage',
    ]);
    expect(TRACKED_ADJUDICATED['sanctuary']).toBeUndefined();
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
