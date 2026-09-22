import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { linesOf } from '../../../test-support/lines.js';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId } from '@ie/shared';
import {
  anchoredOnTarget,
  riderDuration,
  riderDurationPhrase,
  type SpellDefinition,
} from './spell-definitions.js';
import { checkSpellDefinition } from './spell-schema.js';
import { startOfNextTurn } from './time.js';

/**
 * Every reader of `RiderDuration` names every member of it.
 *
 * The union is five named moments and a span of seconds, and none of them is
 * interchangeable with another — that sentence is the whole reason they are
 * separate members. But two of its readers ended in a **ternary**:
 *
 * ```ts
 * return lasts === 'end-of-casters-next-turn'
 *   ? endOfNextTurn(casterId)
 *   : startOfNextTurn(casterId);
 * ```
 *
 * A fifth member added to the union compiles against that, and silently
 * becomes "the start of the caster's next turn" — a *wrong deadline* rather
 * than a refusal, which is exactly what a closed vocabulary exists to make
 * impossible. The same tail spelled the phrase a refusal prints, so the two
 * would have gone on agreeing about the wrong moment.
 *
 * Two guards, because they answer different questions. The readers are
 * exhaustive `switch`es over a `never` now, so the **compiler** refuses a
 * member nobody answered; this sweep is what catches the reader that answers
 * one by falling through to it, which the compiler is happy with. It is
 * derived — the members come from the declaration and the readers from their
 * signatures — so a fifth member or a fifth reader is covered without anybody
 * remembering to add it here.
 */

const SRC = fileURLToPath(new URL('.', import.meta.url));
const SOURCES: Readonly<Record<string, string>> = {
  'spell-definitions.ts': readFileSync(`${SRC}spell-definitions.ts`, 'utf8'),
  'spell-schema.ts': readFileSync(`${SRC}spell-schema.ts`, 'utf8'),
};

/**
 * The union's named moments, read off the declaration rather than listed.
 *
 * The `\r?` is not decoration: the declaration is found by the `;` that ends
 * it and the newline after it, and on a file with CRLF endings that `;` is
 * followed by a `\r`. Without it this reader hands back **no members at all**
 * on such a file, and every assertion below passes over an empty list — a
 * sweep reporting no problems because it could not see the type. A split
 * helper cannot reach this one, which is why it is spelled out here.
 */
const membersOf = (source: string): readonly string[] => {
  const declared = /export type RiderDuration =([\s\S]*?);\r?\n/.exec(source);
  if (declared === null) return [];
  return [...declared[1]!.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]!);
};

interface Reader {
  readonly file: string;
  readonly name: string;
  readonly signature: string;
  readonly body: string;
}

/**
 * Every top-level function in a module, by the convention this repository's
 * other derived sweeps use: a declaration at column zero, closed by the first
 * line that is a lone `}`.
 */
const functionsIn = (file: string, source: string): readonly Reader[] => {
  const lines = linesOf(source);
  const found: Reader[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = /^(?:export )?function (\w+)\(/.exec(lines[i]!);
    if (head === null) continue;
    let end = i + 1;
    while (end < lines.length && lines[end] !== '}') end += 1;
    const text = lines.slice(i, end + 1);
    // The signature runs to the line the body opens on, which is the head line
    // itself where the whole declaration fits on one.
    const opens = text.findIndex((line) => /\{\s*$/.test(line));
    found.push({
      file,
      name: head[1]!,
      signature: text.slice(0, opens === -1 ? 1 : opens + 1).join('\n'),
      body: text.join('\n'),
    });
  }
  return found;
};

/**
 * The functions that **take** one, which is what "a reader" means here.
 *
 * The parameters rather than the whole signature: `riderDurations` gathers the
 * deadlines a definition names and hands back a list of them, so it mentions
 * the type in its return and branches on none of its members. A collector is
 * not a reader, and asking it to name four moments it never inspects would be
 * a sweep asserting something untrue of the one function it happened to catch.
 */
const parametersOf = (signature: string): string =>
  signature.slice(signature.indexOf('(') + 1, signature.lastIndexOf(')'));

const readersOf = (sources: Readonly<Record<string, string>>): readonly Reader[] =>
  Object.entries(sources).flatMap(([file, source]) =>
    functionsIn(file, source).filter((fn) => /\bRiderDuration\b/.test(parametersOf(fn.signature))),
  );

/** A member a reader never names. */
const unnamed = (
  sources: Readonly<Record<string, string>>,
  members: readonly string[],
): readonly string[] =>
  readersOf(sources).flatMap((reader) =>
    members
      .filter((member) => !reader.body.includes(`'${member}'`))
      .map((member) => `${reader.file}:${reader.name} never names '${member}'`),
  );

const MEMBERS = membersOf(SOURCES['spell-definitions.ts']!);

describe('every reader of a rider’s deadline names every member of it', () => {
  it('reads the union off its declaration', () => {
    expect(MEMBERS).toEqual([
      'start-of-casters-next-turn',
      'end-of-casters-next-turn',
      'start-of-targets-next-turn',
      'end-of-targets-next-turn',
      'end-of-current-turn',
    ]);
  });

  /**
   * Four of them, and they are named so that one quietly leaving the sweep is
   * a failure rather than a smaller sweep. `checkRiderDuration` is in the list
   * because it is the same hazard from the other side: it judges *untyped*
   * input by naming the four, so a fifth member would be data the compiler
   * accepted and the validator refused.
   */
  it('finds every function that takes one', () => {
    expect(readersOf(SOURCES).map((reader) => `${reader.file}:${reader.name}`).sort()).toEqual([
      'spell-definitions.ts:anchoredOnTarget',
      'spell-definitions.ts:riderDuration',
      'spell-definitions.ts:riderDurationPhrase',
      'spell-schema.ts:checkRiderDuration',
    ]);
  });

  it('leaves no member unnamed by a reader', () => {
    expect(unnamed(SOURCES, MEMBERS)).toEqual([]);
  });

  /** And the span, which is the member that is not a name. */
  it('and every reader answers the span as well', () => {
    for (const reader of readersOf(SOURCES)) {
      expect(/typeof \w+ === 'object'/.test(reader.body), `${reader.name}`).toBe(true);
    }
  });

  /**
   * And the sweep is not vacuous: shown the tail it was written for, it
   * reports it.
   */
  it('would report a reader that fell through to a member', () => {
    const synthetic = {
      'a-module.ts': [
        "export type RiderDuration = 'first' | 'second' | 'third';\n",
        'export function readsTwoOfThem(lasts: RiderDuration): string {',
        "  if (lasts === 'first') return 'the first';",
        "  return lasts === 'second' ? 'the second' : 'whatever else';",
        '}',
      ].join('\n'),
    };
    expect(membersOf(synthetic['a-module.ts'])).toEqual(['first', 'second', 'third']);
    expect(unnamed(synthetic, membersOf(synthetic['a-module.ts']))).toEqual([
      "a-module.ts:readsTwoOfThem never names 'third'",
    ]);
  });

  /**
   * And it reports the same thing when the file on disk ends its lines CRLF.
   *
   * **Two different things break on a `\r` here, and this drives both.** The
   * body of a function ends at `lines[end] !== '}'`, a whole-line comparison
   * a trailing `\r` makes false for ever, so the body would run to the end of
   * the file and find every member "named" by the declaration it swallowed.
   * And `membersOf` finds the declaration by the `;` and the newline after
   * it, which on a CRLF file is `;\r\n` — so the union came back empty and
   * every assertion in this file passed over nothing. Either one alone is a
   * sweep reporting no problems and checking nothing.
   *
   * The sample carries a line **after** the closing brace on purpose: a
   * file's last line has no ending at all, so a sample that stops at the
   * brace leaves the one line that matters without its `\r` and passes
   * whatever the reader does.
   */
  it('reports the same over source whose lines end CRLF', () => {
    const lines = [
      "export type RiderDuration = 'first' | 'second' | 'third';",
      'export function readsTwoOfThem(lasts: RiderDuration): string {',
      "  if (lasts === 'first') return 'the first';",
      "  return lasts === 'second' ? 'the second' : 'whatever else';",
      '}',
      // After the brace, and naming the member the reader misses: that is
      // what makes the body's end load-bearing. A body that ran on past `}`
      // would find `'third'` down here and report nothing.
      "export const somethingAfterTheBrace = 'third';",
    ];
    const synthetic = { 'a-module.ts': lines.join('\r\n') };
    expect(membersOf(synthetic['a-module.ts'])).toEqual(['first', 'second', 'third']);
    expect(unnamed(synthetic, membersOf(synthetic['a-module.ts']))).toEqual([
      "a-module.ts:readsTwoOfThem never names 'third'",
    ]);
  });

  /** And it would notice a reader that stopped being one. */
  it('finds nothing in a module that takes no such argument', () => {
    expect(readersOf({ 'a-module.ts': 'export function nothing(x: number): number {\n  return x;\n}' })).toEqual([]);
  });
});

/**
 * The behaviour under the source reading, so the two cannot drift: each member
 * resolves to its own moment, and the two that are one word apart are a round
 * apart in the answer.
 */
describe('each member resolves to the moment it names', () => {
  const CASTER = asCharacterId('caster');
  const TARGET = asCharacterId('target');

  it('answers a different deadline for every one of them', () => {
    const answers = MEMBERS.map((member) =>
      JSON.stringify(riderDuration(member as never, CASTER, TARGET)),
    );
    expect(new Set(answers).size).toBe(MEMBERS.length);
  });

  it('says a different sentence for every one of them', () => {
    const said = MEMBERS.map((member) => riderDurationPhrase(member as never));
    expect(new Set(said).size).toBe(MEMBERS.length);
    // And the span and the borrowed deadline are two more.
    expect(riderDurationPhrase(undefined)).toBe('the spell ends');
    expect(riderDurationPhrase({ seconds: 60 })).toContain('60');
  });

  it('anchors exactly the two of them that say "its" on the creature the rider lands on', () => {
    const anchored = MEMBERS.filter((member) => anchoredOnTarget(member as never));
    expect(anchored).toEqual(['start-of-targets-next-turn', 'end-of-targets-next-turn']);
    expect(anchoredOnTarget({ seconds: 60 })).toBe(false);
  });

  /**
   * SRD Shocking Grasp: "can't make Opportunity Attacks **until the start of
   * its next turn**" — the target's turn, and a whole round before the
   * caster's if the caster went first.
   *
   * Built through `turnAnchored`'s own constructor rather than a second
   * spelling of `{ kind: 'start-of-next-turn' }`: `hit-riders.ts` already
   * resolves a printed stat-block rider's span that way, and two spellings of
   * one deadline is how this engine has twice grown a second answer to one
   * question.
   */
  it('binds the start of the target’s next turn to the target, a round from the caster’s', () => {
    expect(riderDuration('start-of-targets-next-turn', CASTER, TARGET)).toEqual(
      startOfNextTurn(TARGET),
    );
    expect(riderDuration('start-of-casters-next-turn', CASTER, TARGET)).toEqual(
      startOfNextTurn(CASTER),
    );
  });

  /**
   * And with no target it is programmer error rather than a fallback to the
   * caster, which is the rule {@link riderDuration} states and the older
   * target-anchored member already obeyed: a fallback there would be a *wrong
   * deadline* instead of a refusal.
   */
  it('refuses to guess whose turn it is when nobody passed a target', () => {
    for (const member of MEMBERS.filter((one) => anchoredOnTarget(one as never))) {
      expect(() => riderDuration(member as never, CASTER)).toThrow(/target/);
    }
  });
});

/**
 * A casting's own deadline may not be anchored on a target, for every member
 * that is — derived, so a sixth member arrives guarded.
 *
 * A casting has as many targets as it caught and one duration, so the moment
 * that says "its" means nothing in that position; and `resolveSpell` pins
 * `durationUntil` by calling `riderDuration` with **no** target, so a member
 * that slipped past this check would reach the one throw the validator exists
 * to keep out of a content author's reach.
 */
describe('a casting’s own deadline is refused every target-anchored member', () => {
  it('refuses each of them by name', () => {
    const anchored = MEMBERS.filter((member) => anchoredOnTarget(member as never));
    expect(anchored.length).toBeGreaterThan(1);
    for (const member of anchored) {
      const definition = {
        ...SRD_CONTENT.spell('guiding-bolt')!,
        durationUntil: member,
      } as unknown as SpellDefinition;
      expect(
        checkSpellDefinition(definition).map((problem) => problem.code),
        member,
      ).toContain('casting_duration_without_a_target');
    }
  });
});
