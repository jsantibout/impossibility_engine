import { readFileSync } from 'node:fs';
import { SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ClassDefinition, SubclassDefinition } from '@ie/engine';
import {
  auditClasses,
  auditPlayableLevels,
  MAX_LEVEL,
  playableLevels,
  type ParsedSpell,
} from '../scripts/coverage-data.js';

/**
 * The measurement the report could not make: **what runs at level N**.
 *
 * Every other row in `COVERAGE.md` counts a population over the whole book,
 * which is the right answer to "how much of the SRD is built" and the wrong
 * one to "can a level 5 party play". A level 5 Barbarian holds the features
 * printed at levels 1 to 5 and nothing else; a level 5 Cleric can reach the
 * spells on the Cleric list up to the third, because that is the highest slot
 * their table gives them. Both are answerable from the catalogue with no new
 * input, and both were answered by hand twice.
 *
 * The derivation is driven here in two directions, because there is only one
 * failure worth guarding against and it is the report's oldest: **a parsed
 * record counted as an implemented one**. A spell on a class list is a
 * sentence in a book. The engine either resolves it, casts it and hands the
 * effect to the table, or does neither, and those are three different claims
 * about it at every level.
 */

/** A twenty-row table, so a synthetic class is a real one as far as this reads. */
const table = (slots: (readonly number[] | undefined)[], cantrips: number) =>
  Array.from({ length: 20 }, (_unused, index) => ({
    level: index + 1,
    proficiencyBonus: 2,
    ...(cantrips > 0 ? { cantripsKnown: cantrips } : {}),
    ...(slots[index] === undefined ? {} : { spellSlots: slots[index] }),
  }));

const feature = (id: string, level: number, automation: 'engine' | 'manual') => ({
  id,
  name: id,
  level,
  automation,
  note: 'a note',
});

const CASTER = {
  id: 'oracle',
  name: 'Oracle',
  spellcasting: { style: 'known' },
  // Slots at the first level, a second-level slot at the third.
  table: table([[2], [3], [4, 2]], 2),
  features: [
    feature('oracle:first', 1, 'engine'),
    feature('oracle:third', 3, 'manual'),
    feature('oracle:fifth', 5, 'engine'),
  ],
} as unknown as ClassDefinition;

const FIGHTER = {
  id: 'brawler',
  name: 'Brawler',
  table: table([], 0),
  features: [feature('brawler:first', 1, 'manual')],
} as unknown as ClassDefinition;

const SUBCLASS = {
  id: 'oracle-of-the-deep',
  name: 'Oracle of the Deep',
  classId: 'oracle',
  features: [feature('oracle-of-the-deep:third', 3, 'engine')],
} as unknown as SubclassDefinition;

const spell = (id: string, level: number): ParsedSpell =>
  ({ id, name: id, level, classes: ['oracle'] }) as unknown as ParsedSpell;

/**
 * Three spells on one class list, one of each state, and a cantrip: the
 * smallest catalogue in which "parsed" and "executed" can come apart.
 */
const SPELLS: readonly ParsedSpell[] = [
  spell('resolved', 1),
  spell('cast-and-narrated', 1),
  spell('printed-only', 1),
  spell('a-cantrip', 0),
  spell('out-of-reach', 5),
  { ...spell('someone-elses', 1), classes: ['brawler'] } as ParsedSpell,
];

const derived = () =>
  playableLevels({
    classes: [CASTER, FIGHTER],
    subclasses: [SUBCLASS],
    spells: SPELLS,
    executed: new Set(['resolved']),
    tracked: new Set(['cast-and-narrated']),
  });

describe('a level is measured from what a character of it holds', () => {
  it('counts the features a path has taken by that level, and no others', () => {
    const path = derived().paths.find((one) => one.classId === 'oracle');

    expect(path?.name).toBe('Oracle (Oracle of the Deep)');
    expect(path?.levels[0]).toMatchObject({ level: 1, features: 1, executed: 1 });
    // The third-level feature is manual and the subclass's is not, so the
    // executed column moves by one where the held column moves by two.
    expect(path?.levels[2]).toMatchObject({ level: 3, features: 3, executed: 2 });
    expect(path?.levels[4]).toMatchObject({ level: 5, features: 4, executed: 3 });
  });

  it('gives a class with no subclass a path of its own', () => {
    const path = derived().paths.find((one) => one.classId === 'brawler');

    expect(path?.name).toBe('Brawler');
    expect(path?.levels[0]).toMatchObject({ features: 1, executed: 0 });
  });

  /**
   * **The rule this whole file exists for.** Three spells are on the list at
   * level 1 and the engine resolves one of them. A derivation that added
   * tracked to executed, or counted a parsed record as either, would report
   * this level as finished.
   */
  it('keeps parsed, tracked and executed apart at every level', () => {
    const level1 = derived().paths.find((one) => one.classId === 'oracle')?.levels[0];

    // Four reachable: three at spell level 1, and the cantrip.
    expect(level1).toMatchObject({
      highestSpellLevel: 1,
      reachable: 4,
      tracked: 1,
      executedSpells: 1,
    });
    expect(level1!.executedSpells).toBeLessThan(level1!.reachable);
    expect(level1!.executedSpells + level1!.tracked).toBeLessThan(level1!.reachable);
  });

  /** And a catalogue that executes nothing reports nothing executed. */
  it('reports no executed spell when the catalogue only parsed them', () => {
    const nothing = playableLevels({
      classes: [CASTER],
      subclasses: [SUBCLASS],
      spells: SPELLS,
      executed: new Set(),
      tracked: new Set(),
    });
    const level1 = nothing.paths[0]!.levels[0]!;

    expect(level1.reachable).toBe(4);
    expect(level1.executedSpells).toBe(0);
    expect(level1.tracked).toBe(0);
  });

  /**
   * A spell is reachable when the path has a slot of its level, and a cantrip
   * when the table gives the path cantrips at all. Both are read off the class
   * table rather than from a rule about full and half casters written here —
   * the table is what the book prints and what `rowAt` hands the engine.
   */
  it('reaches a spell level when the table gives a slot of it, and not before', () => {
    const path = derived().paths.find((one) => one.classId === 'oracle');

    expect(path?.levels[1]).toMatchObject({ highestSpellLevel: 1, reachable: 4 });
    // A second-level slot arrives at the third level, and nothing on the list
    // is a second-level spell — so the reach grows and the count does not.
    expect(path?.levels[2]).toMatchObject({ highestSpellLevel: 2, reachable: 4 });
  });

  it('reaches nothing for a class whose table has no slots and no cantrips', () => {
    const path = derived().paths.find((one) => one.classId === 'brawler');

    expect(path?.levels[19]).toMatchObject({
      highestSpellLevel: 0,
      reachable: 0,
      tracked: 0,
      executedSpells: 0,
    });
  });

  it('counts a spell for the list it is on and for no other', () => {
    const brawler = derived().paths.find((one) => one.classId === 'brawler');
    // `someone-elses` is on the Brawler's list, and the Brawler reaches
    // nothing, so nobody counts it. The Oracle's four are its own.
    expect(brawler?.levels[0]?.reachable).toBe(0);
  });

  /** The totals are the paths added up, so the two cannot drift apart. */
  it('totals its rows from its paths', () => {
    const coverage = derived();

    expect(coverage.rows).toHaveLength(MAX_LEVEL);
    for (const row of coverage.rows) {
      const paths = coverage.paths.map((path) => path.levels[row.level - 1]!);
      expect(row.features).toBe(paths.reduce((sum, one) => sum + one.features, 0));
      expect(row.executed).toBe(paths.reduce((sum, one) => sum + one.executed, 0));
      expect(row.reachable).toBe(paths.reduce((sum, one) => sum + one.reachable, 0));
      expect(row.tracked).toBe(paths.reduce((sum, one) => sum + one.tracked, 0));
      expect(row.executedSpells).toBe(paths.reduce((sum, one) => sum + one.executedSpells, 0));
    }
  });
});

/**
 * The same derivation over the catalogue, held to what the other tables say.
 *
 * A new measurement that disagreed with the old ones about the size of a
 * population would be a second answer to one question, which is the failure
 * `coverage-data.ts` keeps a record of. So the twentieth level is checked
 * against the class table's own totals: by level 20 a path holds everything
 * its class and its subclass grant, and the twelve paths together hold every
 * feature `auditClasses` counts.
 */
describe('the level rows agree with the tables they are derived from', () => {
  const coverage = auditPlayableLevels();

  it('gives every class path twenty levels', () => {
    expect(coverage.paths).toHaveLength(SRD_CONTENT.subclasses.length);
    for (const path of coverage.paths) expect(path.levels, path.name).toHaveLength(MAX_LEVEL);
  });

  it('holds everything the class table counts by the twentieth level', () => {
    const classes = auditClasses();
    const last = coverage.rows[MAX_LEVEL - 1]!;

    expect(last.features).toBe(classes.features);
    expect(last.executed).toBe(classes.executed);
  });

  /** Nothing is lost on the way up: a level never takes a feature away. */
  it('never counts fewer than the level below', () => {
    for (const path of coverage.paths) {
      for (let index = 1; index < MAX_LEVEL; index += 1) {
        const above = path.levels[index]!;
        const below = path.levels[index - 1]!;
        expect(above.features, `${path.name} ${above.level}`).toBeGreaterThanOrEqual(below.features);
        expect(above.reachable, `${path.name} ${above.level}`).toBeGreaterThanOrEqual(
          below.reachable,
        );
      }
    }
  });

  /**
   * **The claim the owner asked for, and the shape of its answer.** At the
   * fifth level a party's casters can reach real numbers of spells and the
   * engine resolves some of them; saying how many is the row's business, and
   * saying that the three counts are different is this test's.
   */
  it('reports fewer executed spells than reachable ones at the fifth level', () => {
    const fifth = coverage.rows[4]!;

    expect(fifth.reachable).toBeGreaterThan(0);
    expect(fifth.executedSpells).toBeGreaterThan(0);
    expect(fifth.executedSpells).toBeLessThan(fifth.reachable);
    // Executed and tracked together reached the whole of the fifth level's
    // spells on 2026-09-26, when Sending and Phantasmal Force — the last two in
    // reach with no definition — were written; the sum can no longer be less,
    // and it may never be more.
    expect(fifth.executedSpells + fifth.tracked).toBeLessThanOrEqual(fifth.reachable);
  });

  /**
   * A half caster climbs at half the rate, which the script knows only because
   * it reads the class table. **Nothing here says "half caster"** — the rule
   * about full and half progressions lives in `spellcasting.progression` and
   * in the twenty rows the book prints, and a script that reimplemented it
   * would be a second answer to the question the table already answers.
   *
   * SRD 2024 gives a Paladin spells at the first level and a third-level slot
   * at the ninth; a Cleric has one at the fifth. The two read off one
   * derivation is the evidence.
   */
  it('climbs a half caster’s reach at the rate its own table prints', () => {
    const paladin = coverage.paths.find((path) => path.classId === 'paladin');
    const cleric = coverage.paths.find((path) => path.classId === 'cleric');

    expect(paladin?.levels[0]?.highestSpellLevel).toBe(1);
    expect(paladin?.levels[4]?.highestSpellLevel).toBe(2);
    expect(cleric?.levels[4]?.highestSpellLevel).toBe(3);
    // And a Paladin has no cantrips at all, where a Cleric has three.
    expect(paladin?.levels[0]?.reachable).toBeLessThan(cleric!.levels[0]!.reachable);
  });

  /** And a class that never casts reaches nothing at any level. */
  it('gives a class with no spellcasting nothing to reach, ever', () => {
    const barbarian = coverage.paths.find((path) => path.classId === 'barbarian');

    expect(barbarian?.levels.map((one) => one.reachable)).toEqual(Array(MAX_LEVEL).fill(0));
  });
});

/**
 * Generated, like every other row: the committed report carries these.
 *
 * The same check the bestiary row takes, for the same reason — a measurement
 * that is regenerated and a file that is diffed are one guarantee, and a
 * section nothing holds to the committed text is a section that can quietly
 * stop being written.
 */
describe('the level rows are in the committed report', () => {
  const report = readFileSync(
    fileURLToPath(new URL('../../../COVERAGE.md', import.meta.url)),
    'utf8',
  );
  const coverage = auditPlayableLevels();

  it('carries the section', () => {
    expect(report).toContain('## What a character of a level can play');
  });

  it('carries every level’s totals', () => {
    for (const row of coverage.rows) {
      expect(report).toContain(
        `| ${row.level} | ${row.features} | ${row.executed} | ${row.reachable} | ${row.tracked} | ${row.executedSpells} |`,
      );
    }
  });

  it('carries every path, named once', () => {
    for (const path of coverage.paths) expect(report).toContain(`| ${path.name} |`);
  });
});
