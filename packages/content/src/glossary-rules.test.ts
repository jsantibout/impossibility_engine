/**
 * The glossary's general rules, held down at both ends.
 *
 * Gate G1, job 1, finding 3: spells, features and items each have a blocker
 * map and a population, and **the rules everybody at the table uses had
 * none**. So `nick` could occur in no engine source file while a level 1
 * Rogue with a Scimitar reached it, and nothing anywhere would say so.
 *
 * A hand-written list is only worth as much as the two guards on it, and
 * both are here. A row claiming `built` must name something `@ie/engine`
 * really exports or a `NAMED_ACTIONS` member — so a renamed command breaks
 * the claim rather than outliving it. A row claiming nothing executes it must
 * name something that **occurs in no engine source file**, which is the check
 * that would have caught `nick` on the day the mastery vocabulary was written
 * and is the one the population exists for.
 *
 * Both are driven with a synthetic built to be caught before they are run on
 * the real list, because a guard that can only be run against the data it
 * already agrees with is not a guard.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as engine from '@ie/engine';
import { NAMED_ACTIONS } from '@ie/engine';
import { GLOSSARY_RULES, type GlossaryRule } from '../scripts/glossary-rules.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ENGINE_SRC = `${HERE}../../engine/src/`;

/** Every engine source file that is not a test, read once. */
const engineSources = (): readonly (readonly [string, string])[] => {
  const found: (readonly [string, string])[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = `${at}${entry.name}`;
      if (entry.isDirectory()) {
        walk(`${path}/`);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.test.ts')) continue;
      found.push([path, readFileSync(path, 'utf8')]);
    }
  };
  walk(ENGINE_SRC);
  return found;
};

const SOURCES = engineSources();
const EXPORTS = new Set(Object.keys(engine));
const ACTIONS = new Set<string>(NAMED_ACTIONS);

/** What the row names, resolved: an export, a named action, or neither. */
const resolves = (name: string): boolean => EXPORTS.has(name) || ACTIONS.has(name);

/** Every engine source file whose text says this word, whole and case-blind. */
const saysIt = (word: string): readonly string[] => {
  const mark = new RegExp(`\\b${word}\\b`, 'i');
  return SOURCES.filter(([, text]) => mark.test(text)).map(([path]) => path);
};

/**
 * Every engine source file that names this rule **as a value**.
 *
 * The narrower question, and the one that separates a rule the engine runs
 * from a rule its prose admits it does not. `'nick'` is written twice in
 * `mastery.ts` — in two comments, each saying the property is unbuilt — and a
 * word-level sweep would read those as coverage. A quoted literal is what a
 * switch arm, a union member or a lookup is made of, so that is what is asked
 * for: the seven built masteries are quoted in the code that applies them and
 * the eighth is quoted nowhere.
 */
const executesIt = (word: string): readonly string[] => {
  const mark = new RegExp(`['"\`]${word}['"\`]`);
  return SOURCES.filter(([, text]) => mark.test(text)).map(([path]) => path);
};

describe('the guards can be driven with a row they must refuse', () => {
  const synthetic = (over: Partial<GlossaryRule>): GlossaryRule => ({
    id: 'cleave',
    name: 'Cleave',
    kind: 'mastery',
    built: 'resolveAttack',
    note: 'the synthetic the guards are driven with: the row the list really wrote, then broken one field at a time.',
    ...over,
  });

  it('accepts the row the list really wrote', () => {
    expect(resolves(synthetic({}).built!)).toBe(true);
  });

  it('refuses a built row naming nothing the engine exports', () => {
    expect(resolves(synthetic({ built: 'takeCleaveAction' }).built!)).toBe(false);
  });

  it('refuses a missing row for a rule the engine plainly names', () => {
    // Filed as missing, and the word is all over `attacks.ts`. This is the
    // shape of the claim `nick` could not have made.
    expect(saysIt(synthetic({ built: null }).id).length).toBeGreaterThan(0);
  });

  /** And the reader is reading something: the sweep found the engine. */
  it('reads the engine’s own sources and no test file', () => {
    expect(SOURCES.length).toBeGreaterThan(30);
    expect(SOURCES.filter(([path]) => path.endsWith('.test.ts'))).toEqual([]);
  });
});

describe('every glossary rule says truthfully whether anything runs it', () => {
  it('names each rule once, and gives every one of them a real note', () => {
    const ids = GLOSSARY_RULES.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const one of GLOSSARY_RULES) {
      expect(one.name.length, one.id).toBeGreaterThan(0);
      expect(one.note.length, one.id).toBeGreaterThan(60);
    }
  });

  it.each(GLOSSARY_RULES.filter((one) => one.built !== null).map((one) => [one.id, one.built!]))(
    '%s names %s, which the engine really has',
    (_id, built) => {
      expect(resolves(built)).toBe(true);
    },
  );

  /**
   * The half that bites. A rule the list calls missing must be missing from
   * the engine's own text — not merely absent from the barrel, because a
   * command can be reached through another and a word that is nowhere cannot.
   *
   * Two rules are named in the engine's **prose** and are still unbuilt, and
   * each says so in its own note: `combat.ts` lists Search, Study, Influence
   * and Utilize as the book's and leaves them to the table, and three
   * definitions quote the Study action before the check the engine then
   * rolls. So the assertion is over the words the engine **executes** — the
   * `NAMED_ACTIONS` union and the mastery switch — rather than over every
   * occurrence of the word, and the prose is where the reading is recorded.
   */
  it.each(GLOSSARY_RULES.filter((one) => one.built === null).map((one) => [one.id] as const))(
    'has nothing that executes %s',
    (id) => {
      expect(ACTIONS.has(id), `${id} is a NAMED_ACTIONS member after all`).toBe(false);
      expect(EXPORTS.has(`take${id[0]!.toUpperCase()}${id.slice(1)}`), id).toBe(false);
    },
  );

  /**
   * And `nick` is the one that occurs **nowhere at all**, which is the
   * finding this population was opened for: a mastery property a level 1
   * Rogue with a Scimitar reaches, in no engine source file. Pinned by name,
   * so building it has to come here and say so.
   */
  it('finds the nick mastery nowhere the engine executes one', () => {
    expect(executesIt('nick')).toEqual([]);
    // And the other seven are quoted in the code that applies them, so the
    // sweep is not simply blind.
    for (const one of GLOSSARY_RULES.filter(
      (row) => row.kind === 'mastery' && row.built !== null,
    )) {
      expect(executesIt(one.id).length, one.id).toBeGreaterThan(0);
    }
    // The word itself is in the engine exactly twice, in two comments of
    // `mastery.ts` that say the property is unbuilt — which is the reading
    // this row records and the reason the guard asks for a **value** rather
    // than a word. A build has to quote it, and quoting it fails this.
    expect(saysIt('nick').map((path) => path.split('/').at(-1))).toEqual(['mastery.ts']);
  });

  /**
   * The count is not asserted and the **membership** is, which is this
   * repository's rule for a hand list: a row joining or leaving it is
   * somebody's reading and should have to say so here.
   */
  it('holds the five the gate named, and Two-Weapon Fighting', () => {
    const missing = GLOSSARY_RULES.filter((one) => one.built === null).map((one) => one.id);
    expect(missing.sort()).toEqual([
      'help',
      'influence',
      'nick',
      'search',
      'study',
      'two-weapon-fighting',
      'utilize',
    ]);
  });

  /** And every one of the eight masteries the SRD prints has a row. */
  it('covers the whole mastery vocabulary', () => {
    expect(GLOSSARY_RULES.filter((one) => one.kind === 'mastery').map((one) => one.id).sort()).toEqual([
      'cleave',
      'graze',
      'nick',
      'push',
      'sap',
      'slow',
      'topple',
      'vex',
    ]);
  });

  /** And every `NAMED_ACTIONS` member is a row, so the two cannot drift. */
  it('covers every action the engine names', () => {
    const rows = new Set(GLOSSARY_RULES.map((one) => one.id));
    for (const action of NAMED_ACTIONS) expect([...rows], action).toContain(action);
  });
});
