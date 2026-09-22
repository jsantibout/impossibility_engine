import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every refusal the engine can return, against every refusal a test has seen.
 *
 * `err(code, reason)` is the engine's answer to "why not", and the reason
 * rules-legal refusals are values rather than exceptions is that the layer
 * above is meant to *read* them — "you're out of third-level slots" is
 * something a DM narrates around. A code nothing has ever asserted is a
 * sentence nobody has read: it compiles, it is spelled however it was spelled
 * the day it was typed, and whether the branch it guards can be reached at all
 * is unknown.
 *
 * Three whole-engine audits measured that gap and all three got the same
 * proportion — the third 46 of 162, the fourth 41 of 112 — which is what makes
 * it a standing gap rather than a backlog.
 *
 * **Re-derived here, and the population is bigger than the audits saw**: 170
 * distinct codes, of which **36 were unasserted** when this file was written
 * and **one** is now. The audits' smaller figure is a line-based `grep`, which
 * cannot see the `err(` whose code is on the next line — see `REFUSAL` below.
 * Two of the codes those audits named as unasserted, `no_scene` and the mount
 * family, are asserted; IE-016 closed them, which is why a measured number is
 * re-derived rather than quoted.
 *
 * **This is a derived sweep, in the shape `invariants.test.ts` established:**
 * it reads the source, computes a set, and holds an allowlist checked in both
 * directions, so an exemption that has gone stale fails rather than rotting
 * quietly. What it is *not* is a substitute for the refusals: a sweep that
 * reported forty unasserted codes and carried forty exemptions would satisfy
 * every line of this file and none of its purpose. The allowlist below is the
 * residue, and each entry says why that residue is honest.
 */

const SRC = fileURLToPath(new URL('.', import.meta.url));

/** This file, which must never be able to satisfy itself — see `ASSERTED`. */
const SELF = 'refusal-sweep.test.ts';

const sourceFiles = (dir = ''): readonly string[] =>
  readdirSync(`${SRC}${dir}`, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${dir}${entry.name}/`)
      : entry.name.endsWith('.ts')
        ? [`${dir}${entry.name}`]
        : [],
  );

const ALL = sourceFiles();
const ENGINE_SOURCE = ALL.filter((file) => !file.endsWith('.test.ts'));

/**
 * The content package's tests count too: the SRD catalogue drives the engine
 * through the same commands, and a refusal a catalogue test provokes is a
 * refusal a test has seen. Absolute paths, because they are not under `SRC`.
 */
const CONTENT_SRC = fileURLToPath(new URL('../../content/src/', import.meta.url));
const CONTENT_TESTS = readdirSync(CONTENT_SRC)
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => `${CONTENT_SRC}${file}`);
const TEST_SOURCE = [
  ...ALL.filter((file) => file.endsWith('.test.ts') && file !== SELF).map((file) => `${SRC}${file}`),
  ...CONTENT_TESTS,
];

/**
 * Where each code is returned from.
 *
 * **The whole file is matched at once, not line by line**, because `err(` and
 * its code are routinely on two lines — prettier breaks the call the moment
 * the reason is long, which is most of the interesting ones. A line-based
 * `grep` over this same population sees 113 codes where there are 170, and
 * every one of the 57 it misses is missed for the sole reason that its reason
 * string was wordy. That is the `animals.md` failure again: an analysis that
 * silently stops seeing things reports no problems.
 */
const REFUSAL = /\b(?:err|needsContext)\(\s*'([a-z0-9_]+)'/g;

const sitesOf = (files: readonly string[]): ReadonlyMap<string, readonly string[]> => {
  const found = new Map<string, string[]>();
  for (const file of files) {
    const text = readFileSync(`${SRC}${file}`, 'utf8');
    for (const match of text.matchAll(REFUSAL)) {
      const at = `${file}:${text.slice(0, match.index).split('\n').length}`;
      const sites = found.get(match[1]!);
      if (sites === undefined) found.set(match[1]!, [at]);
      else sites.push(at);
    }
  }
  return found;
};

const SITES = sitesOf(ENGINE_SOURCE);
const CODES: ReadonlySet<string> = new Set(SITES.keys());

/**
 * Which codes a test has seen.
 *
 * A code quoted in a test file, in either quote style. That is the net the
 * repository's tests actually support, and tightening it further was tried and
 * rejected: requiring the literal to sit inside a matcher call marks ten codes
 * unasserted that are asserted perfectly well through a table (`code:
 * 'no_scene'` in `scene-commands.test.ts`, read by a loop below it) or through
 * a helper parameter (`reject(request, 'duplicate_target')`). A sweep that
 * demands a second test for a rule already pinned is a sweep that teaches
 * people to write redundant tests.
 *
 * It errs the other way instead, and the cost of that was measured rather than
 * assumed: no code in this repository is quoted in a test *only* as an
 * argument to a constructed `err` — there are no fixture-only mentions for the
 * loose net to be fooled by.
 *
 * **This file is excluded from the scan.** The allowlist below names codes as
 * object keys rather than strings precisely so they are not quoted, but an
 * exemption whose written reason happened to mention another code would
 * otherwise assert it, and a sweep that can satisfy itself is not a sweep.
 */
const assertedIn = (files: readonly string[]): ReadonlySet<string> => {
  const text = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  return new Set([...CODES].filter((code) => text.includes(`'${code}'`) || text.includes(`"${code}"`)));
};

const ASSERTED = assertedIn(TEST_SOURCE);

/**
 * A refusal no test can reach, with the reason it cannot.
 *
 * "Not got round to it" is not a reason, and an entry that gives one is a
 * refusal filed under the wrong heading. What is a reason: a defensive branch
 * a sibling guard already answers, a case only a hand-written corrupt log
 * produces, a second site of a code its own first site validated.
 *
 * Every entry is checked in both directions — the code must still exist in the
 * source, and must still be unasserted — so an exemption for a code somebody
 * has since written a test for fails here rather than sitting on.
 */
const UNASSERTED_ON_PURPOSE: Readonly<Record<string, string>> = {
  retaliation_without_type:
    'a defensive branch a sibling guard already answers, and the sibling is the validator two files away. `checkEffect` refuses a `passive-defense` whose defence is a retaliation and whose effect carries no `damageType` — `missing_damage_type`, asserted by the junk sweep in `spell-schema.test.ts` — and every definition reaches a resolver through `createContent`, which runs that validator over the whole catalogue before a `Content` value exists. So the only way to arrive here is a definition hand-built in TypeScript that skipped the door, which is exactly what this branch is for: the field is optional on the effect because two of the three defences deal no damage at all, so the compiler cannot say what the validator does. What it must not do is fall back to a type nobody chose — a retaliation dealing Fire because Fire was first in a list would be the engine answering a question the book asked the caster.',
  nothing_to_interrupt:
    'a defensive re-read, reachable from nothing — and the argument is now about the **casting id** rather than about the window being unique. `interrupt-casting` is written by exactly one definition, Counterspell, and its trigger check resolves *which* casting is answered through `answeredCasting`, refusing `no_trigger`, `forced_target` or `ambiguous_casting` before a slot or a Reaction is spent. The resolver re-reads that **same id** on the state the Counterspell’s own events have been folded into, so the two agree by construction: the id either names a record the trigger already found, or the trigger refused and nothing was spent. The one path that skips the trigger check is a **readied** spell, whose trigger was declared and paid for when it was readied; SRD requires a readied spell to have a casting time of an action and Counterspell is a Reaction, so it cannot take that path — and a release carries no resolved id either, which is the second reason it cannot arrive here with one. What the re-read protects against is the casting having *gone* between the two reads, and nothing in the Counterspell’s own batch removes it: its `spell-cast` allocates a fresh casting id rather than settling somebody else’s, and it takes no Concentration, so it writes no `concentration-ended` and `releaseCasting` never runs for the rite. `long-casting.test.ts` drives a Counterspell at a Ritual and watches it resolve, which is the re-read reaching the casting; the older halves are asserted in `refusals.test.ts`. This branch is what stays correct if any of those ever stops being true.',
};

/**
 * A reason has to say something.
 *
 * The failure mode a written exemption has is not a missing sentence but a
 * hollow one, and this is the cheapest half of that which is mechanically
 * checkable: a reason must be prose rather than a placeholder. Whether it is
 * *true* is review's, exactly as it is for `spell-honesty.test.ts`'s
 * adjudications.
 */
const HOLLOW = /^(todo|tbd|n\/?a|none|later|unknown|not (got round to it|yet|done))\.?$/i;

describe('every refusal the engine can return is a refusal a test has seen', () => {
  it('finds the refusals at all, and does not quietly see none', () => {
    // A floor rather than a count: the population grows with the engine, and a
    // sweep pinned to a number is a sweep somebody updates without reading.
    // What it must never do is silently drop to nothing, which is how a
    // regex that stopped matching would look.
    expect(CODES.size).toBeGreaterThan(150);
    expect(ENGINE_SOURCE.length).toBeGreaterThan(60);
    expect(TEST_SOURCE.length).toBeGreaterThan(60);
    // And the multi-line form is genuinely in the population, because it is
    // the half a line-based analysis loses.
    expect(CODES.has('not_an_area')).toBe(true);
  });

  it('accounts for every unasserted code, and exempts none that is asserted', () => {
    const unasserted = [...CODES].filter((code) => !ASSERTED.has(code)).sort();
    const exempt = Object.keys(UNASSERTED_ON_PURPOSE).sort();
    expect(unasserted.filter((code) => !exempt.includes(code))).toEqual([]);
    expect(exempt.filter((code) => !unasserted.includes(code))).toEqual([]);
  });

  it('holds no exemption for a code the source no longer returns', () => {
    expect(Object.keys(UNASSERTED_ON_PURPOSE).filter((code) => !CODES.has(code)).sort()).toEqual([]);
  });

  it('takes no bare exemption', () => {
    const bare = Object.entries(UNASSERTED_ON_PURPOSE)
      .filter(([, reason]) => reason.trim().length < 25 || HOLLOW.test(reason.trim()))
      .map(([code]) => code);
    expect(bare).toEqual([]);
  });
});

/**
 * And the analysis is not vacuous: it finds what it is shown, in both
 * directions. A guard that cannot fail is not a guard, and both halves of this
 * one fail silently — an unasserted code simply is not in a set, and a stale
 * exemption simply is not looked at.
 */
describe('the sweep would catch what it is for', () => {
  it('sees a code added to the source that no test asserts', () => {
    const smuggled = sitesOf([]);
    expect([...smuggled.keys()]).toEqual([]);
    const found = [
      ...`return err('a_brand_new_refusal', 'nobody has ever seen this');`.matchAll(REFUSAL),
    ].map((m) => m[1]);
    expect(found).toEqual(['a_brand_new_refusal']);
    expect(CODES.has('a_brand_new_refusal')).toBe(false);
    expect(assertedIn([]).has('a_brand_new_refusal')).toBe(false);
  });

  it('sees the multi-line form a line-based analysis loses', () => {
    const wrapped = "  return err(\n    'wrapped_over_two_lines',\n    `a reason long enough to break`,\n  );";
    expect([...wrapped.matchAll(REFUSAL)].map((m) => m[1])).toEqual(['wrapped_over_two_lines']);
  });

  it('sees a stale exemption naming a code the source no longer contains', () => {
    const stale = { a_code_that_was_deleted: 'a reason long enough to pass the bare check' };
    expect(Object.keys(stale).filter((code) => !CODES.has(code))).toEqual([
      'a_code_that_was_deleted',
    ]);
  });

  it('sees an exemption for a code a test has since asserted', () => {
    // `no_slot` is asserted, loudly and in several files. An exemption for it
    // is exactly the entry that would otherwise sit on for ever.
    expect(ASSERTED.has('no_slot')).toBe(true);
    const stale = { no_slot: 'a reason long enough to pass the bare check' };
    const unasserted = [...CODES].filter((code) => !ASSERTED.has(code));
    expect(Object.keys(stale).filter((code) => !unasserted.includes(code))).toEqual(['no_slot']);
  });

  it('refuses a bare reason', () => {
    const bare = { some_code: 'TODO', other_code: 'n/a', third_code: 'later' };
    expect(
      Object.entries(bare)
        .filter(([, reason]) => reason.trim().length < 25 || HOLLOW.test(reason.trim()))
        .map(([code]) => code),
    ).toEqual(['some_code', 'other_code', 'third_code']);
  });
});
