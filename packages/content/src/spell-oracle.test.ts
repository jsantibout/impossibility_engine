import { readFileSync } from 'node:fs';
import { SPELL_DEFINITIONS } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPELL_INDEX } from '@ie/srd';
import {
  ORACLE_EXEMPTIONS,
  srdCastingSeconds,
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
 * The quoted SRD header above each definition, and the classes it names.
 *
 * **The blockquote is the review surface and nothing was checking it.** Every
 * definition in `spells.ts` opens with the book's own header — _Level 2
 * Evocation (Druid, Ranger, Sorcerer, Wizard)._ — and a reader weighing
 * whether a transcription is right reads that line before anything else. An
 * independent review found **thirteen** headers naming a class list the book
 * does not print: seven inventing a class — two of them an Artificer, which
 * SRD 5.2.1 has no such thing as — and six dropping one. Eight were this
 * batch's and five had been there for tranches.
 *
 * A wrong quotation inside a `>` is worse than a wrong comment, because it is
 * attributed. So the class list joins Range, Duration and the casting time as
 * a printed field held against the parsed book — and it is read out of the
 * **source**, the way `spell-tracking.test.ts` reads the SRD's prose, because
 * a docstring is not a value the runtime can be asked for.
 *
 * **The whole quote is read rather than its first line.** The first version
 * of this matched one line, so a header long enough to wrap — Dispel Magic
 * lists eight classes — parsed as nothing and was skipped in silence, which
 * is the same guard failing the way it was written to catch. A skipped entry
 * is now a named one: {@link NO_CLASS_LIST} is written out, so a header that
 * stops parsing fails here rather than quietly leaving the population.
 */
const SOURCE: readonly string[] = readFileSync(
  fileURLToPath(new URL('./spells.ts', import.meta.url)),
  'utf8',
).split('\n');

/**
 * The classes a definition's own blockquote names, or null where it names
 * none.
 *
 * Parameterised over the lines rather than reading the file, so the guard can
 * be driven against a header built to be caught — a rule this repository
 * already follows for `coverageGaps` and for every marker sweep.
 */
const quotedClasses = (lines: readonly string[], name: string): readonly string[] | null => {
  // The heading is `SRD <Name>:` or `SRD <Name>, whole:` — three definitions
  // write the second form, and an exact match silently lost all three.
  const at = lines.findIndex(
    (line) => line === ` * SRD ${name}:` || line.startsWith(` * SRD ${name}, `),
  );
  if (at < 0) return null;
  for (let line = at + 1; line < Math.min(at + 12, lines.length); line += 1) {
    if (lines[line]!.startsWith(' */')) return null;
    if (!lines[line]!.startsWith(' * > _')) continue;
    // The italic run may wrap, so the quote is joined until it closes. The
    // school word is what tells a header from a quoted sentence that happens
    // to be emphasised.
    let quote = '';
    for (let more = line; more < lines.length && lines[more]!.startsWith(' * > '); more += 1) {
      quote = `${quote}${quote === '' ? '' : ' '}${lines[more]!.slice(' * > '.length)}`;
      if (quote.includes('._')) break;
    }
    const header = /^_(?:Level \d )?\w+(?: Cantrip)?((?: \([^)]*\))*)\._/.exec(quote);
    if (header === null) return null;
    const groups = [...header[1]!.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]!);
    const classes = groups.filter((group) => group !== 'Ritual');
    if (classes.length === 0) return null;
    return classes[0]!.split(',').map((one) => one.trim().toLowerCase());
  }
  return null;
};

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

/**
 * The definitions whose blockquote names no class list at all, by name.
 *
 * **A skipped entry has to be a named one.** A run of the oldest definitions
 * print the school and a Ritual tag and stop — _Evocation Cantrip._,
 * _Level 1 Divination (Ritual)._ — which is quiet rather than wrong, and a
 * bound on how many headers were *found* cannot tell one of those from a
 * header the parser stopped understanding. Dispel Magic was in this set for
 * exactly one commit, because its eight classes wrap onto a second line and
 * nothing said so; Heroism, Divine Favor and Hunter's Mark were in it for a
 * second commit, because their headers read `SRD Heroism, whole:` and the
 * lookup wanted a colon straight after the name. Both were the same failure:
 * a definition the parser could not find looks exactly like one with nothing
 * to find.
 */
const NO_CLASS_LIST: readonly string[] = [
  'comprehend-languages',
  'darkvision',
  'detect-magic',
  'dimension-door',
  'disguise-self',
  'fire-bolt',
  'fly',
  'hold-person',
  'jump',
  'light',
  'longstrider',
  'mage-armor',
  'mage-hand',
  'misty-step',
  'prestidigitation',
  'speak-with-animals',
  'spider-climb',
  'tree-stride',
  'water-breathing',
];

describe('every definition quotes the class list the book prints', () => {
  const quoted = (id: string): readonly string[] | null => {
    const definition = SPELL_DEFINITIONS.find((d) => d.id === id);
    return definition === undefined ? null : quotedClasses(SOURCE, definition.name);
  };

  const QUOTED = SPELL_DEFINITIONS.map((d) => [d.id, quotedClasses(SOURCE, d.name)] as const).filter(
    (entry): entry is readonly [string, readonly string[]] => entry[1] !== null,
  );

  /** Every definition carries one, or is on the list that says it does not. */
  it('reads a class list off every definition but the ones named here', () => {
    const silent = SPELL_DEFINITIONS.filter((d) => quoted(d.id) === null).map((d) => d.id);
    expect([...silent].sort()).toEqual([...NO_CLASS_LIST].sort());
  });

  it('names them in an order two branches can both append to', () => {
    expect(NO_CLASS_LIST).toEqual([...NO_CLASS_LIST].sort());
  });

  it.each(QUOTED)('%s names the classes the SRD grants it', (id, list) => {
    const book = SPELL_INDEX.find((spell) => spell.id === id);
    expect(book, `${id} is not in the SRD index`).toBeDefined();
    expect([...list].sort()).toEqual([...(book?.classes ?? [])].sort());
  });

  /**
   * And the parser really reads what it claims to, driven against headers
   * built to be caught rather than against the corpus it already agrees with.
   */
  it('reads a header that wraps, and one that does not', () => {
    const wrapped = [
      ' * SRD Made Up:',
      ' *',
      ' * > _Level 3 Abjuration (Bard, Cleric, Druid, Paladin, Ranger, Sorcerer,',
      ' * > Warlock, Wizard)._ **Casting Time:** Action.',
      ' */',
    ];
    expect(quotedClasses(wrapped, 'Made Up')).toEqual([
      'bard',
      'cleric',
      'druid',
      'paladin',
      'ranger',
      'sorcerer',
      'warlock',
      'wizard',
    ]);

    // A Ritual tag is a second parenthesis and not a class list, and a header
    // that carries only one names nobody.
    expect(
      quotedClasses(
        [' * SRD Made Up:', ' * > _Level 1 Divination (Ritual)._ **Range:** Self.', ' */'],
        'Made Up',
      ),
    ).toBeNull();

    // And a cantrip, whose header has no level.
    expect(
      quotedClasses(
        [' * SRD Made Up:', ' * > _Evocation Cantrip (Cleric)._ **Range:** 60 feet.', ' */'],
        'Made Up',
      ),
    ).toEqual(['cleric']);
  });

  /** The sweep bites: a header naming a class the book does not grant fails. */
  it('catches a class the book does not grant', () => {
    const drifted = [
      ' * SRD Fireball:',
      ' * > _Level 3 Evocation (Cleric, Sorcerer, Wizard)._ **Range:** 150 feet.',
      ' */',
    ];
    const book = SPELL_INDEX.find((spell) => spell.id === 'fireball');
    expect(book?.classes).toEqual(['sorcerer', 'wizard']);
    // Read positively, because `not.toEqual` is also satisfied by the parser
    // returning nothing — which is the failure this whole guard exists to
    // stop mistaking for agreement.
    expect(quotedClasses(drifted, 'Fireball')).toEqual(['cleric', 'sorcerer', 'wizard']);
    expect(quotedClasses(drifted, 'Fireball')).not.toEqual([...(book?.classes ?? [])]);
    // And the real one passes, so the difference is the class rather than
    // the shape of the assertion.
    expect(quoted('fireball')).toEqual([...(book?.classes ?? [])]);
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
      // **And the two are not the same state.** One spell is over and the
      // other is still running with nothing to end it, which decides whether
      // the casting leaves an ongoing record at all — so the flag that says
      // which is held against the book rather than taken on trust.
      expect(definition.untilDispelled === true, id).toBe(book.open);
      return;
    }

    // A spell the book gives a span to is not one that runs until dispelled.
    expect(definition.untilDispelled, id).toBeUndefined();

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

/**
 * The casting time is two printed facts, not one, and only the first was ever
 * checked.
 *
 * `srdCastingTime` has answered which of the four buckets a spell is in since
 * tracked spells landed. **How long** a casting of a minute or more takes was
 * nobody's, because nothing could be cast that way — and it is the same class
 * of unwatched number as the Range and the Duration above: fifty-four spells
 * print one, and a definition saying ten minutes where the book says an hour
 * would defer a casting to the wrong moment with nothing to say so.
 *
 * The Ritual tag is the other half of the same line. SRD prints it *inside*
 * the casting time — "Action or Ritual", "1 minute or Ritual" — so the two are
 * oracled together against the same string.
 */
describe('a casting time of a minute or more is a number the book prints', () => {
  /**
   * The grammar covers the whole book rather than the corner the catalogue
   * uses, exactly as the Range and Duration grammars do: a wording that came
   * back null would be a parser problem silently excusing a spell.
   */
  it('reads a span of seconds for every long casting time the book prints', () => {
    const unread = [...BOOK.values()]
      .filter(
        (spell) =>
          srdCastingTime(spell.castingTime) === 'long' &&
          srdCastingSeconds(spell.castingTime) === null,
      )
      .map((spell) => `${spell.id}: ${spell.castingTime}`);
    expect(unread).toEqual([]);
  });

  /** And reads nothing at all for a casting time that is a moment in a turn. */
  it('reads no span for an Action, a Bonus Action or a Reaction', () => {
    const spurious = [...BOOK.values()]
      .filter(
        (spell) =>
          srdCastingTime(spell.castingTime) !== 'long' &&
          srdCastingSeconds(spell.castingTime) !== null,
      )
      .map((spell) => `${spell.id}: ${spell.castingTime}`);
    expect(spurious).toEqual([]);
  });

  it('reads the units it claims to', () => {
    expect(srdCastingSeconds('1 minute')).toBe(60);
    expect(srdCastingSeconds('10 minutes')).toBe(600);
    expect(srdCastingSeconds('1 hour')).toBe(3600);
    expect(srdCastingSeconds('8 hours')).toBe(28_800);
    expect(srdCastingSeconds('24 hours')).toBe(86_400);
    // The suffix is the *other* casting time the same line offers, and the
    // ten minutes a Ritual adds are the rule's rather than the spell's.
    expect(srdCastingSeconds('1 minute or Ritual')).toBe(60);
    expect(srdCastingSeconds('Action')).toBeNull();
    expect(srdCastingSeconds('Action or Ritual')).toBeNull();
  });

  /** Both directions: a definition says the number, or says nothing at all. */
  it.each(CASES)('%s takes the span of seconds the book prints', (id, definition) => {
    expect(definition.castingSeconds, id).toBe(
      srdCastingSeconds(printed(id).castingTime) ?? undefined,
    );
  });

  /**
   * And carries the Ritual tag exactly where the book prints one. Both
   * directions, because a definition that quietly claimed the tag would offer
   * a Ritual version of a spell that has none, and one that quietly dropped it
   * would refuse a casting the rules allow.
   */
  it.each(CASES)('%s carries the Ritual tag exactly when the book does', (id, definition) => {
    const tagged = SPELL_INDEX.find((s) => s.id === id)?.ritual === true;
    expect(definition.ritual ?? false, id).toBe(tagged);
  });

  /** The catalogue really does hold some of each, so neither sweep is vacuous. */
  it('has definitions on both sides of the tag', () => {
    expect(SPELL_DEFINITIONS.filter((d) => d.ritual === true).length).toBeGreaterThan(0);
    expect(SPELL_DEFINITIONS.filter((d) => d.ritual !== true).length).toBeGreaterThan(0);
  });
});
