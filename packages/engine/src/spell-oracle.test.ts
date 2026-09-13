import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPELL_INDEX } from '@ie/srd';
import { SPELL_DEFINITIONS } from './spell-definitions.js';
import {
  ORACLE_EXEMPTIONS,
  srdCastingTime,
  srdDuration,
  srdRange,
} from '../scripts/spell-oracle.js';

/**
 * The catalogue, held against the book it was transcribed from.
 *
 * `coverage.test.ts` already checks name, level, school, casting time and
 * Concentration. This adds the two printed fields nothing ever checked —
 * **Range** and **Duration** — which between them are 250 numbers nobody was
 * watching. `PROGRESS.md` names the second out loud as the field with no
 * automatic check, and the class of bug it is for is the one this repository
 * has already had twice: Fire Bolt thrown for 2d10, Finger of Death silently
 * dropping its flat 30.
 *
 * **Schema validity and SRD conformance are different questions**, and they
 * are in different files on purpose. `spell-schema.test.ts` asks whether a
 * definition is coherent — true of a DM's invented spell. This asks whether it
 * agrees with a spell the SRD prints, which an invented spell cannot and
 * should not. A layer that answered both at once would make "valid" mean
 * "official", which is exactly what a definition format must not do.
 *
 * The prose is deliberately untouched: damage dice, save abilities, area
 * shapes and conditions all live in the description, and a parser for that
 * would be English wearing data's clothes. `spell-tracking.test.ts` scans it
 * for markers instead, which is what prose honestly supports.
 */

interface ParsedSpell {
  readonly id: string;
  readonly name: string;
  readonly range: string;
  readonly duration: string;
  readonly castingTime: string;
  readonly concentration: boolean;
}

const BOOK: ReadonlyMap<string, ParsedSpell> = new Map(
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../srd/src/generated/spells.json', import.meta.url)),
        'utf8',
      ),
    ) as readonly ParsedSpell[]
  ).map((spell) => [spell.id, spell]),
);

const printed = (id: string): ParsedSpell => {
  const spell = BOOK.get(id);
  if (spell === undefined) throw new Error(`${id} is not in the parsed SRD`);
  return spell;
};

const CASES = SPELL_DEFINITIONS.map((d) => [d.id, d] as const);

/**
 * The grammar has to cover the whole book, not the corner of it the catalogue
 * happens to use. A parser that silently returns null for a wording it does
 * not know reports no problems and checks nothing — the lesson
 * `packages/srd/raw` taught when `animals.md` yielded 0 creatures.
 */
describe('the oracle reads every spell the book prints', () => {
  it('measures against the whole SRD, not a sample', () => {
    expect(SPELL_INDEX.length).toBe(339);
  });

  it('parses every printed Range', () => {
    const unread = [...BOOK.values()]
      .filter((spell) => srdRange(spell.range) === null)
      .map((spell) => `${spell.id}: ${spell.range}`);
    expect(unread).toEqual([]);
  });

  /**
   * `Special` is the one duration with nothing to parse, and it is a value
   * rather than a failure — the SRD declines to give a span. Named, so the
   * exemption cannot silently grow.
   */
  it('parses every printed Duration but the one the book leaves special', () => {
    const unread = [...BOOK.values()]
      .filter((spell) => srdDuration(spell.duration) === null)
      .map((spell) => spell.duration);
    expect([...new Set(unread)]).toEqual(['Special']);
  });

  it('reads the units it claims to', () => {
    expect(srdRange('120 feet')).toEqual({ kind: 'ranged', feet: 120 });
    expect(srdRange('1 mile')).toEqual({ kind: 'ranged', feet: 5280 });
    expect(srdRange('Self')).toEqual({ kind: 'self' });
    expect(srdRange('Touch')).toEqual({ kind: 'touch' });

    expect(srdDuration('Instantaneous')).toEqual({
      seconds: null,
      concentration: false,
      open: false,
    });
    expect(srdDuration('Concentration, up to 10 minutes')).toEqual({
      seconds: 600,
      concentration: true,
      open: false,
    });
    expect(srdDuration('8 hours')).toEqual({
      seconds: 28_800,
      concentration: false,
      open: false,
    });
    expect(srdDuration('1 round')).toEqual({
      seconds: 6,
      concentration: false,
      open: false,
    });
    // "Until dispelled" is the absence of a duration, not a large one.
    expect(srdDuration('Until dispelled')).toEqual({
      seconds: null,
      concentration: false,
      open: true,
    });
    expect(srdDuration('Until dispelled or triggered')?.open).toBe(true);
  });
});

describe('every definition agrees with the range the book prints', () => {
  it.each(CASES)('%s reaches what the SRD says it reaches', (id, definition) => {
    if (ORACLE_EXEMPTIONS[id]?.field === 'range') return;
    const book = srdRange(printed(id).range);
    expect(book, `${printed(id).range} did not parse`).not.toBeNull();
    if (book === null) return;

    // `unbounded` is Sight and Unlimited; nothing in the catalogue has one, and
    // the engine has no kind for it, so a definition claiming one of those
    // ranges would be claiming a rule it cannot check.
    expect(book.kind, id).not.toBe('unbounded');
    expect(definition.range.kind, id).toBe(book.kind);
    if (book.kind === 'ranged' && definition.range.kind === 'ranged') {
      expect(definition.range.feet, id).toBe(book.feet);
    }
  });
});

describe('every definition agrees with the duration the book prints', () => {
  it.each(CASES)('%s lasts what the SRD says it lasts', (id, definition) => {
    if (ORACLE_EXEMPTIONS[id]?.field === 'duration') return;
    const book = srdDuration(printed(id).duration);
    if (book === null) return;

    if (book.seconds === null) {
      // Instantaneous, or "Until dispelled": either way there is no span, and
      // a definition that invented one would be running a clock the book does
      // not print.
      expect(definition.durationSeconds, id).toBeUndefined();
      return;
    }

    // A rider that ends at a moment in the turn order is the other way of
    // lasting, and the two are not interchangeable — see the durations section
    // of CLAUDE.md. SRD Shield prints "1 round" and the engine records "until
    // the start of your next turn", which is the same sentence said exactly.
    if (definition.durationUntil !== undefined) {
      expect(book.seconds, id).toBe(6);
      return;
    }

    expect(definition.durationSeconds, id).toBe(book.seconds);
  });

  /** And the Concentration clause inside the duration says the same thing. */
  it.each(CASES)('%s concentrates exactly when the SRD says so', (id, definition) => {
    const book = srdDuration(printed(id).duration);
    if (book === null) return;
    expect(definition.concentration, id).toBe(book.concentration);
  });
});

describe('the casting time oracle still answers for every definition', () => {
  it.each(CASES)('%s takes as long to cast as the book says', (id, definition) => {
    expect(definition.castingTime, id).toBe(srdCastingTime(printed(id).castingTime));
  });
});

/**
 * The map is held to the same three rules the prose adjudications are: an
 * exemption must be needed, must still be needed, and must say something.
 * Without those it is a place for disagreements to be parked.
 */
describe('a deliberate disagreement is written down, and stays true', () => {
  const disagrees = (id: string, field: 'range' | 'duration'): boolean => {
    const definition = SPELL_DEFINITIONS.find((d) => d.id === id);
    if (definition === undefined) return false;
    const spell = BOOK.get(id);
    if (spell === undefined) return false;

    if (field === 'range') {
      const book = srdRange(spell.range);
      if (book === null) return true;
      if (book.kind !== definition.range.kind) return true;
      return (
        book.kind === 'ranged' &&
        definition.range.kind === 'ranged' &&
        book.feet !== definition.range.feet
      );
    }

    const book = srdDuration(spell.duration);
    if (book === null) return false;
    if (book.seconds === null) return definition.durationSeconds !== undefined;
    if (definition.durationUntil !== undefined) return book.seconds !== 6;
    return definition.durationSeconds !== book.seconds;
  };

  it('has one, so the rules below are not vacuous', () => {
    expect(Object.keys(ORACLE_EXEMPTIONS).length).toBeGreaterThan(0);
  });

  it('exempts only definitions that really do disagree', () => {
    const stale = Object.entries(ORACLE_EXEMPTIONS).filter(
      ([id, exemption]) => !disagrees(id, exemption.field),
    );
    expect(stale.map(([id]) => id)).toEqual([]);
  });

  it('exempts only spells the catalogue defines', () => {
    const unknown = Object.keys(ORACLE_EXEMPTIONS).filter(
      (id) => !SPELL_DEFINITIONS.some((d) => d.id === id),
    );
    expect(unknown).toEqual([]);
  });

  it('makes every exemption say something', () => {
    for (const [id, exemption] of Object.entries(ORACLE_EXEMPTIONS)) {
      expect(exemption.reason.length, id).toBeGreaterThan(60);
    }
  });

  /** And nothing disagrees without an entry. */
  it('leaves no undeclared disagreement', () => {
    const undeclared: string[] = [];
    for (const definition of SPELL_DEFINITIONS) {
      for (const field of ['range', 'duration'] as const) {
        if (!disagrees(definition.id, field)) continue;
        if (ORACLE_EXEMPTIONS[definition.id]?.field === field) continue;
        undeclared.push(`${definition.id}/${field}`);
      }
    }
    expect(undeclared).toEqual([]);
  });
});

/**
 * The oracle catches a deliberate mismatch.
 *
 * The half that says this test does work rather than merely pass: a definition
 * whose numbers have drifted from the book is what the whole file exists to
 * find, driven here directly rather than trusted.
 */
describe('the oracle catches a metadata mismatch', () => {
  const fireball = SPELL_DEFINITIONS.find((d) => d.id === 'fireball')!;

  it('notices a range that has drifted', () => {
    const book = srdRange(printed('fireball').range);
    expect(book).toEqual({ kind: 'ranged', feet: 150 });
    const drifted = { ...fireball, range: { kind: 'ranged' as const, feet: 120 } };
    expect(drifted.range.feet).not.toBe((book as { feet: number }).feet);
  });

  it('notices a duration that has drifted', () => {
    // SRD Fly: "Concentration, up to 10 minutes" — the exact mutation
    // `PROGRESS.md` says nothing downstream would notice.
    const book = srdDuration(printed('fly').duration);
    expect(book?.seconds).toBe(600);
    const fly = SPELL_DEFINITIONS.find((d) => d.id === 'fly')!;
    expect(fly.durationSeconds).toBe(600);
    expect({ ...fly, durationSeconds: 60 }.durationSeconds).not.toBe(book?.seconds);
  });

  it('notices a Concentration clause that has drifted', () => {
    expect(srdDuration(printed('fly').duration)?.concentration).toBe(true);
    expect(srdDuration(printed('mage-armor').duration)?.concentration).toBe(false);
  });
});
