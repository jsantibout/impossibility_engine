/**
 * Source text, split into lines, whatever the file's endings are.
 *
 * ### The defect this closes
 *
 * A dozen tests in this repository read source off disk and parse it line by
 * line — which exports hand back events, which members the definition format
 * declares, which catalogue ids the engine names. Every one of them split on
 * `'\n'`, and several then matched a `$`-anchored regex (`/…\{$/`,
 * `/^\): (.+) \{$/`) or compared a whole line (`lines[i] === '}'`). A line
 * ending CRLF arrives at those patterns with a trailing `\r` and matches none
 * of them, so the sweep answers "this function declares no return type" or
 * runs a declaration's region on into the next one — it reports no problems
 * and checks nothing, which is the exact failure those sweeps exist to catch,
 * arriving inside them.
 *
 * And it arrives invisibly. `.gitattributes:2` says `* text=auto eol=lf`, so
 * CRLF is normalised on the way into the index: nothing is ever committed
 * with it, `git status` stays clean, and no diff and no review can show it.
 * Only the working tree has it, and only some of the time —
 * `commands/mastery.ts` carried six such lines the day this was written,
 * inside a doc comment, so the failure was latent rather than active. The
 * tests would have started failing on one developer's machine, for no reason
 * visible anywhere in the repository.
 *
 * So the ending is taken out of the question: every source-parsing test reads
 * its lines through here. `.editorconfig` is the other half, stopping the
 * CRLF from being written in the first place.
 *
 * ### Why it lives at the root
 *
 * Its readers are the source-parsing tests of `@ie/engine`, and one in
 * `@ie/content` — `origins.test.ts`, which parses `character-origins.md`,
 * the vendored SRD transcription that really does sit on disk with CRLF
 * endings today. (`@ie/tools` has none: `doors.test.ts` reads a field with a
 * character class rather than by line, and is fixed in place.)
 *
 * It is test support rather than anybody's published code, so putting it in
 * a package would either add it to that package's shipped surface — a
 * package's tsconfig includes `src` and compiles all of it into `dist` — or
 * make the other package reach into a sibling's internals for it. A
 * root directory is the neutral ground: every test reaches it by the same
 * relative path, `../../../test-support/`, it is on no package's `exports`
 * and in no package's build, and it adds no edge to the dependency graph
 * `CLAUDE.md` calls strict.
 *
 * It has no test file of its own because nothing here collects one: vitest's
 * `include` is the three package directories. It is proven where it matters
 * instead — `invariants.test.ts` drives the return-type reader over a CRLF
 * sample, `spell-schema.test.ts` drives the declaration reader over one, and
 * `rider-duration-readers.test.ts` drives the function-body reader, all three
 * asserting the same answer as LF. Those are the failures this exists to
 * prevent, and they fail without it.
 *
 * **And it is half the fix, never the whole of it.** A `\r` also breaks a
 * regex that never splits at all — `/…;\n/` finding a declaration's end, or a
 * `[^\n]*` capturing the rest of a line — and there is nothing a line helper
 * can do about those. They are spelled `\r?\n` and `[^\r\n]` where they are
 * written. Reaching for this function is not evidence that a file is safe.
 */

/**
 * The lines of `text`, splitting on LF or CRLF.
 *
 * A lone `\r` (classic Mac) is not a line ending here: nothing in this
 * repository has ever had one, and a splitter that guessed at more than the
 * evidence would start cutting lines somebody meant to be whole.
 */
export const linesOf = (text: string): readonly string[] => text.split(/\r?\n/);
