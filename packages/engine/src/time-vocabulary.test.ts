import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CharacterId } from '@ie/shared';
import { TURN_ANCHORS, TURN_MOMENTS, endOfNextTurn, startOfNextTurn } from './time.js';

/**
 * The moments of a turn are named once, and every reader says the name.
 *
 * Two pairs, and each of them is a *vocabulary* rather than two strings that
 * happen to sit beside each other:
 *
 * | | |
 * |---|---|
 * | {@link TURN_MOMENTS} | the boundary a repeat save, a payout or an area trigger fires at |
 * | the turn-anchored `Duration` kinds | how long a thing anchored to somebody's next turn lasts |
 *
 * Spelled inline, a pair is a list a reader has to keep in their head: eleven
 * sites wrote one of these two by hand before this sweep, in four different
 * orders, and nothing tied any of them to the module that decides what a
 * moment is. The cost is not the typing — it is that a third moment, or a
 * renaming of either, is a change nothing catches. `AreaMoment` is the shape
 * of the problem: `'end-of-turn' | 'area-moved' | 'entry' | 'start-of-turn'`
 * is two vocabularies in one union, and only one of them is the area's.
 *
 * So: the vocabulary is declared in one file, and every other file in the
 * engine refers to it by name. This is the same sweep the definition format
 * gets in `spell-schema.test.ts` — a file listing rather than an array, so a
 * module written next year is covered the day it lands.
 *
 * **Two shapes are refused, because the eleven sites wrote the pair two ways:**
 *
 * - a **union** of both members, which is a type saying what the named type
 *   already says;
 * - a **comparison against both**, which is the validator's spelling —
 *   `effect.at !== 'start-of-turn' && effect.at !== 'end-of-turn'` is the same
 *   list, checked rather than declared.
 *
 * Naming *one* member is not refused and must not be: `fold/turns.ts` raises
 * the beginning of a turn and says which, and a table keyed by a union writes
 * every member of it by definition. What is refused is spelling out the whole
 * pair, which is the thing the named type exists to be.
 */
describe('the turn vocabulary is named once', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));

  /**
   * Where the vocabulary is declared, and therefore the one file allowed to
   * spell it out.
   *
   * Named rather than derived, so the exemption is reviewed; and asserted to
   * really hold the declarations, so it cannot become a file that was waved
   * through after the vocabulary moved out of it.
   */
  const VOCABULARY = 'time.ts';

  /** Every non-test source file under `src`, at any depth. */
  const sourcesUnder = (dir: string, prefix = ''): readonly string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sourcesUnder(`${dir}${entry.name}/`, `${prefix}${entry.name}/`)
        : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
          ? [`${prefix}${entry.name}`]
          : [],
    );

  const RUNTIME = sourcesUnder(here).filter((file) => file !== VOCABULARY);
  const source = (file: string): string => readFileSync(`${here}${file}`, 'utf8');

  /**
   * The two pairs, read out of the engine rather than typed here.
   *
   * `TURN_MOMENTS` is the list itself. The turn-anchored kinds are erased at
   * runtime — `TurnAnchor` is a type — so they are read off the two
   * constructors that build them, which is the nearest thing to the type that
   * survives to be asked. A sweep that spelled its own copy of what it is
   * hunting would pass the day somebody renamed a member and left ten sites
   * behind.
   */
  const anchor = 'c1' as CharacterId;
  const PAIRS: readonly (readonly [string, string])[] = [
    [TURN_MOMENTS[0], TURN_MOMENTS[1]],
    [startOfNextTurn(anchor).kind, endOfNextTurn(anchor).kind],
  ];

  /**
   * A file's code, without the lines that are only prose.
   *
   * The rule is about a *type position*, and a docstring naming both moments
   * in one sentence is a file explaining the vocabulary rather than restating
   * it — this very docstring does it. Whole-line comments are what the engine
   * writes (JSDoc blocks and `//` lines), so dropping them is enough and
   * needs no parser.
   */
  const codeOf = (text: string): string =>
    text
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
      })
      .join('\n');

  /** Every run of string literals joined by `|`, which is a union as written. */
  const LITERAL_UNION = /'[a-z][a-z-]*'(?:\s*\|\s*'[a-z][a-z-]*')+/g;
  /** Every `=== 'literal'` or `!== 'literal'`, which is a list being checked. */
  const COMPARED = /[=!]==\s*'([a-z][a-z-]*)'/g;

  const membersOf = (union: string): readonly string[] =>
    [...union.matchAll(/'([a-z][a-z-]*)'/g)].map((match) => match[1] ?? '');

  /** Where a file spells out a whole pair instead of naming the type. */
  const spellingsIn = (text: string): readonly string[] => {
    const code = codeOf(text);
    const found: string[] = [];
    const compared = [...code.matchAll(COMPARED)].map((match) => match[1] ?? '');
    for (const pair of PAIRS) {
      for (const union of code.match(LITERAL_UNION) ?? []) {
        const members = membersOf(union);
        if (pair.every((moment) => members.includes(moment))) found.push(union);
      }
      if (pair.every((moment) => compared.includes(moment))) found.push(pair.join(' and '));
    }
    return found;
  };

  it.each(RUNTIME.map((file) => [file] as const))('%s names the turn moments', (file) => {
    expect(spellingsIn(source(file)), file).toEqual([]);
  });

  /**
   * The sweep is not vacuous, and it is driven against **every** file it
   * covers rather than against a string written in this test — the discipline
   * the spell sweep settled on. A file newly brought into the population must
   * be one that a hand-spelled pair really fails, by name.
   */
  it.each(RUNTIME.map((file) => [file] as const))(
    '%s would fail if a pair were spelled out in it',
    (file) => {
      for (const [first, second] of PAIRS) {
        const union = `${source(file)}\nexport type Smuggled = '${first}' | '${second}';\n`;
        expect(spellingsIn(union), file).toContain(`'${first}' | '${second}'`);
        const checked = `${source(file)}\nconst no = (m: string) => m !== '${first}' && m !== '${second}';\n`;
        expect(spellingsIn(checked), file).toContain(`${first} and ${second}`);
      }
    },
  );

  /** And prose is left alone, which is why the population can be every file. */
  it('reads code rather than the docstring above it', () => {
    const [first, second] = PAIRS[0] ?? ['', ''];
    expect(spellingsIn(` * A moment is '${first}' | '${second}', and nothing vaguer.\n`)).toEqual(
      [],
    );
    expect(spellingsIn(`// either '${first}' | '${second}'\n`)).toEqual([]);
  });

  /**
   * The exemption answers for something that is really there: the file it
   * names declares both pairs, so a vocabulary that moved out of it takes the
   * exemption with it rather than leaving a hole behind.
   */
  /**
   * And the anchors as **data** say the same two words the constructors do.
   *
   * `TurnAnchor` is erased, so `TURN_ANCHORS` — which the content validator
   * reads, because a class file arriving as JSON was never shown to the
   * compiler — is a list nothing could hold to the type it claims to be.
   * `satisfies` holds each entry to the type; this holds the type to the
   * entries, through the same two constructors {@link PAIRS} is read off.
   */
  it('keeps the anchors as data equal to the anchors as constructors', () => {
    expect([...TURN_ANCHORS].sort()).toEqual([...(PAIRS[1] ?? [])].sort());
  });

  it('exempts the file that declares the vocabulary, and only for declaring it', () => {
    const declaring = source(VOCABULARY);
    expect(declaring).toContain('export const TURN_MOMENTS = [');
    for (const pair of PAIRS) for (const moment of pair) expect(declaring).toContain(`'${moment}'`);
    expect(RUNTIME).not.toContain(VOCABULARY);
    expect(RUNTIME).toContain('spell-definitions.ts');
    expect(RUNTIME).toContain('commands/turns.ts');
    expect(RUNTIME).toContain('fold/areas.ts');
    // The exemption is the *declaring* file and not the time subsystem: a
    // repeat save and a payout both name a moment, they live next door in
    // `timers.ts`, and they are swept like anything else.
    expect(RUNTIME).toContain('timers.ts');
  });

  /** And the pairs really are two apiece, so `every` above is not vacuous. */
  it('hunts two pairs of two', () => {
    expect(PAIRS.map((pair) => pair.length)).toEqual([2, 2]);
    expect(new Set(PAIRS.flat()).size).toBe(4);
  });
});
