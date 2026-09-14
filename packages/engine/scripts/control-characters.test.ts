/**
 * No tracked text file carries a character nobody can see.
 *
 * A stray `U+0008` inside `docs/dev/check-queue.mjs`'s regex — written where a
 * `\b` was meant — made `WHOLE_ENGINE_AUDIT_RECOMMENDED` match nothing, so the
 * one signal the manual-audit design leaves the foreman was invisible to every
 * fresh session from the day it was written. The same character then sat in
 * `CLAUDE.md`, where it made the file misquote the very guard it describes.
 *
 * Both are the same failure and neither is visible in a diff, a review or a
 * rendered page: the character *is* the bug and it has no appearance. So it is
 * refused by a sweep rather than by attention.
 *
 * ### What is refused, and what is not
 *
 * The C0 block (`U+0000`–`U+001F`) minus the three a text file legitimately
 * uses — tab, line feed, carriage return. Nothing wider: `U+007F` is not C0,
 * and the zero-width and bidirectional characters above it are a different
 * question with different answers per file type (an em dash is not a defect,
 * and this repository's prose is full of them). A guard that reached further
 * than the evidence would start refusing things somebody meant.
 *
 * ### It reads the tracked set, and asks git for it
 *
 * `git ls-files` is the only list that excludes `node_modules`, `.git`, build
 * output and a scratch file somebody has not added — without a hand-written
 * ignore list that would rot. A tracked path missing from disk is skipped
 * rather than read: that is a staged deletion, not a hidden character.
 *
 * ### Where this lives
 *
 * `packages/engine/scripts/` already hosts repository-level instruments —
 * `coverage.ts` writes the repository's `COVERAGE.md` and `missing-shapes.ts`
 * reads `PROGRESS.md` — and it is one of the three directories `npm test`
 * looks in. The guard rides in `npm test` rather than in a script of its own
 * because the gauntlet runs `npm test` and would not run a sixth command.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The C0 controls, minus tab (`U+0009`), LF (`U+000A`) and CR (`U+000D`). */
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** The tracked text this is a claim about. */
const TEXT_FILE = /\.(md|ts|mjs|json)$/;

const codePoint = (char: string): string =>
  `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Every forbidden character in one file, as `<file>:<line>: <code point>` —
 * the file, the line and the code point, because an invisible character is
 * exactly the thing a reader cannot find from a file name alone.
 */
export function controlCharactersIn(file: string, text: string): string[] {
  const found: string[] = [];
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(FORBIDDEN)) {
      found.push(`${file}:${index + 1}: ${codePoint(match[0])}`);
    }
  });
  return found;
}

/** The tracked `*.md`, `*.ts`, `*.mjs` and `*.json` files that exist on disk. */
function trackedTextFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '' && TEXT_FILE.test(file))
    .filter((file) => existsSync(`${ROOT}${file}`));
}

describe('control characters', () => {
  /**
   * The synthetic case the sweep has to catch. Written as escapes rather than
   * as the characters themselves, because a guard whose own fixture tripped it
   * could only be written by exempting a file — and an exempt file is where the
   * next one would live.
   */
  it('reports the file, the line and the code point', () => {
    const text = ['first line is fine', `a backspace \u0008 here`, 'and \u0000 a null'].join('\n');
    expect(controlCharactersIn('synthetic.md', text)).toEqual([
      'synthetic.md:2: U+0008',
      'synthetic.md:3: U+0000',
    ]);
  });

  it('permits tab, line feed and carriage return', () => {
    expect(controlCharactersIn('synthetic.ts', 'a\tb\r\nc\n')).toEqual([]);
  });

  it('is silent about a file that carries none', () => {
    expect(controlCharactersIn('synthetic.md', 'ordinary prose — with an em dash')).toEqual([]);
  });

  it('reads the tracked set, and nothing outside it', () => {
    const tracked = trackedTextFiles();
    // A bound rather than a count: the number moves with every task, and a
    // sweep that silently found nothing to read would report no problems.
    expect(tracked.length).toBeGreaterThan(100);
    expect(tracked.some((file) => file.startsWith('node_modules/'))).toBe(false);
    expect(tracked.some((file) => file.startsWith('.git/'))).toBe(false);
    expect(tracked).toContain('CLAUDE.md');
  });

  it('finds none in any tracked text file', () => {
    const found = trackedTextFiles().flatMap((file) =>
      controlCharactersIn(file, readFileSync(`${ROOT}${file}`, 'utf8')),
    );
    expect(found).toEqual([]);
  });
});
