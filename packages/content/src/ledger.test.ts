/**
 * `LEDGER.md`: the number that has to reach zero, derived and diffed.
 *
 * `docs/ROADMAP.md` §0 gives four ship criteria for playable levels 1–5, and
 * the first is that this report is empty. It was a snapshot taken by hand at
 * `f163717` from scripts under `node_modules/.audit/`, which is a directory
 * that vanishes on an `npm ci` — so the one number the whole plan is ranked
 * against lived nowhere a second person could recompute it.
 *
 * Two claims are made here and they are different claims.
 *
 * **The derivation is the report's, not a second one.** The restriction to
 * level-5 reach goes through `reachOf` and `withinReach` in
 * `coverage-data.ts` — the functions `playableLevels` itself uses — because
 * the audit's script wrote that rule out a second time, and a ledger that
 * disagreed with `COVERAGE.md` about which spells a Cleric can cast would put
 * a spell on somebody's brief that nobody at the table can reach. The
 * agreement is asserted per class rather than assumed.
 *
 * **The committed file says what the code says.** `playable-levels.test.ts`'s
 * own rule, for `playable-levels.test.ts`'s own reason: a measurement that is
 * regenerated and a file that is diffed are one guarantee, and a section
 * nothing holds to the committed text is a section that can quietly stop
 * being written.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import type { ClassDefinition } from '@ie/engine';
import {
  LEGENDARY_ECONOMY,
  MONSTER_LINE_SHAPES,
  auditPlayableLevels,
  isExecutedLine,
  isReadLine,
  reachOf,
  spellsInReach,
  statBlockLines,
  withinReach,
  type ParsedSpell,
} from '../scripts/coverage-data.js';
import { FEATS_ANSWERED_FOR } from '../scripts/missing-feature-shapes.js';
import {
  LEDGER_LEVEL,
  auditLedger,
  itemsInReach,
  ledgerTotals,
  renderLedger,
  spellWaitOf,
  type Ledger,
} from '../scripts/ledger.js';

const spell = (id: string, level: number, classes: readonly string[] = ['oracle']): ParsedSpell =>
  ({ id, name: id, level, classes }) as unknown as ParsedSpell;

/** A twenty-row table, so a synthetic class reads as a real one. */
const table = (slots: (readonly number[] | undefined)[], cantrips: number) =>
  Array.from({ length: 20 }, (_unused, index) => ({
    level: index + 1,
    proficiencyBonus: 2,
    ...(cantrips > 0 ? { cantripsKnown: cantrips } : {}),
    ...(slots[index] === undefined ? {} : { spellSlots: slots[index] }),
  }));

describe('the reach rule has one spelling', () => {
  /**
   * A cantrip is reachable when the row gives cantrips at all, and a spell
   * when the row has a slot of its level — both read off the table rather
   * than from a rule about full and half casters written here.
   */
  it('reads a row for its highest slot and whether it casts cantrips', () => {
    const row = { level: 5, proficiencyBonus: 3, cantripsKnown: 3, spellSlots: [4, 3, 2] };
    expect(reachOf(row as never)).toEqual({ highestSpellLevel: 3, cantrips: true });
  });

  /** A Warlock's row is the reason the rule is the last non-zero column. */
  it('reads the last column with a number in it, not the width of the run', () => {
    const pact = { level: 5, proficiencyBonus: 3, spellSlots: [0, 0, 2] };
    expect(reachOf(pact as never)).toEqual({ highestSpellLevel: 3, cantrips: false });
  });

  it('gives a row with no table nothing to reach', () => {
    expect(reachOf(undefined)).toEqual({ highestSpellLevel: 0, cantrips: false });
  });

  it('takes in a cantrip only where the row gives cantrips', () => {
    expect(withinReach(spell('a', 0), { highestSpellLevel: 3, cantrips: false })).toBe(false);
    expect(withinReach(spell('a', 0), { highestSpellLevel: 0, cantrips: true })).toBe(true);
  });

  it('takes in a spell only up to the highest slot', () => {
    expect(withinReach(spell('a', 3), { highestSpellLevel: 3, cantrips: false })).toBe(true);
    expect(withinReach(spell('a', 4), { highestSpellLevel: 3, cantrips: false })).toBe(false);
  });

  /** And the union is over the class's own list and no other. */
  it('unions the classes and counts a spell for the list it is on', () => {
    const oracle = {
      id: 'oracle',
      name: 'Oracle',
      table: table([[2], [3], [4, 2]], 2),
      features: [],
    } as unknown as ClassDefinition;
    const brawler = {
      id: 'brawler',
      name: 'Brawler',
      table: table([], 0),
      features: [],
    } as unknown as ClassDefinition;

    const found = spellsInReach(
      [oracle, brawler],
      [
        spell('a-cantrip', 0),
        spell('in-reach', 2),
        spell('out-of-reach', 5),
        spell('someone-elses', 1, ['brawler']),
      ],
      3,
    );
    expect(found.map((one) => one.id)).toEqual(['a-cantrip', 'in-reach']);
  });

  /**
   * The load-bearing claim: the ledger and the report agree, class by class,
   * over the real catalogue. A second spelling of the reach rule would show
   * up here as one class disagreeing about one spell.
   */
  it('reaches exactly what the playable-levels report counts, class by class', () => {
    const parsed = JSON.parse(
      readFileSync('packages/srd/src/generated/spells.json', 'utf8'),
    ) as ParsedSpell[];
    const report = auditPlayableLevels();

    for (const definition of SRD_CONTENT.classes) {
      const mine = spellsInReach([definition], parsed, LEDGER_LEVEL);
      const path = report.paths.find((one) => one.classId === definition.id);
      expect(mine.length, definition.name).toBe(path?.levels[LEDGER_LEVEL - 1]?.reachable);
    }
  });
});

describe('the ledger measures the three populations of the roadmap', () => {
  const ledger: Ledger = auditLedger();

  it('measures the level the roadmap names', () => {
    expect(LEDGER_LEVEL).toBe(5);
    expect(ledger.level).toBe(5);
  });

  /**
   * Every spell in the table is in reach and is *not* executed, which is the
   * whole of what the population claims. An executed spell here would be the
   * report's oldest mistake — a parsed record counted as an implemented one —
   * arriving from the other end.
   */
  it('holds only spells in reach that the engine does not resolve', () => {
    expect(ledger.spells.length).toBeGreaterThan(0);
    const reach = new Set(
      spellsInReach(
        SRD_CONTENT.classes,
        JSON.parse(readFileSync('packages/srd/src/generated/spells.json', 'utf8')) as ParsedSpell[],
        LEDGER_LEVEL,
      ).map((one) => one.id),
    );
    for (const one of ledger.spells) {
      expect(reach.has(one.id), one.id).toBe(true);
      expect(one.status, one.id).not.toBe('executed');
    }
  });

  /** All four states are represented, or the status reading has gone quiet. */
  it('keeps partial, tracked and undefined apart', () => {
    const states = new Set(ledger.spells.map((one) => one.status));
    expect([...states].sort()).toEqual(['executed-partial', 'no-definition', 'tracked']);
  });

  /**
   * Every feature in the table is one a character of level 1–5 holds and is
   * in the blocker map's population — the widened one, so the bare pools and
   * the Monk's Focus are in it.
   *
   * Font of Magic and Arcane Recovery were in this list and have left it,
   * which is what a pool opening looks like from here: they are `trade` grants
   * now, they buy something, and the derivation stops finding them. A
   * Paladin's Channel Divinity was the last of them and left the same way, on
   * the activation that spends it.
   */
  it('holds only features a character of the level can hold', () => {
    expect(ledger.features.length).toBeGreaterThan(0);
    for (const one of ledger.features) expect(one.level, one.id).toBeLessThanOrEqual(LEDGER_LEVEL);
    for (const id of [
      'druid:wild-shape',
      'sorcerer:font-of-magic',
      'wizard:arcane-recovery',
      'monk:focus',
      'paladin:channel-divinity',
    ]) {
      expect(
        ledger.features.map((one) => one.id),
        id,
      ).not.toContain(id);
    }
  });

  /** Nothing the engine already executes and nothing above the level. */
  it('holds no feature the engine applies in full', () => {
    const above = SRD_CONTENT.classes
      .flatMap((one) => one.features)
      .filter((one) => one.level > LEDGER_LEVEL)
      .map((one) => one.id);
    for (const id of above) expect(ledger.features.map((one) => one.id)).not.toContain(id);
  });

  /** The bestiary half is the CR ≤ 5 tail and nothing above it. */
  it('holds only the stat blocks a level 5 party is pointed at', () => {
    expect(ledger.monsters.blocks).toBeGreaterThan(0);
    expect(ledger.monsters.blocks).toBeLessThan(SRD_CONTENT.monsters.length);
    // Handed over, plus the two families the parser read and the engine does
    // not spend: a rider nothing applies and a trait kind nobody asks for.
    expect(ledger.monsters.items).toBe(
      ledger.monsters.handedOver + ledger.monsters.riders + ledger.monsters.inertTraits,
    );
    // The riders are populated, so the identity above is not holding at zero —
    // which is what it would do if the predicate stopped matching and the debt
    // it names quietly left the ledger.
    expect(ledger.monsters.riders).toBeGreaterThan(0);
    // **And the inert traits are zero, which is the column finishing rather
    // than the predicate going quiet.** Every kind `MonsterTraitSchema` admits
    // is now either spent by something in the engine or filed as a handover,
    // and `coverage.test.ts` holds both of those lists against the schema and
    // against the engine's own sources. The day the parser learns a sentence
    // nothing reads, this goes back above zero and the guard is the same one.
    expect(ledger.monsters.inertTraits).toBe(0);
    expect(ledger.monsters.clean + ledger.monsters.unfinished).toBe(ledger.monsters.blocks);
  });

  /** Asked with the report's own predicates, so the two cannot drift. */
  it('asks the bestiary the report’s own questions', () => {
    const named = ledger.monsters.shapes.map((one) => one.shape);
    for (const [shape] of MONSTER_LINE_SHAPES) expect(named, shape).toContain(shape);
  });

  /**
   * The residue is named rather than dropped: a handed-over line matching no
   * enumerated shape is a debt nobody has given an id to, and omitting it
   * would make the ledger read as finished sooner than it is.
   */
  it('names every handed-over line that matches no shape', () => {
    expect(ledger.monsters.residue.length).toBeGreaterThan(0);
    for (const line of ledger.monsters.residue) {
      expect(line.monster.length).toBeGreaterThan(0);
      expect(line.line.length).toBeGreaterThan(0);
    }
  });

  /**
   * **Every handed-over line is accounted for exactly once**, by a shape or
   * by the residue, and the two together are the whole of it.
   *
   * The rule the residue's own prose claims, asserted rather than left to a
   * byte comparison with the committed file. A reviewer found the first
   * version excluding legendary lines from the residue on the grounds that
   * the economy row named them — which took a Unicorn's Shimmering Shield
   * off the ledger altogether, because the economy row is a debt the
   * *block* owes and says nothing about what the line does.
   */
  it('accounts for every handed-over line, by a shape or by the residue', () => {
    const listed = new Set(
      ledger.monsters.residue.map((one) => `${one.monster}/${one.line}`),
    );
    let handed = 0;
    let lost = 0;
    for (const monster of SRD_CONTENT.monsters) {
      if (monster.cr > 5) continue;
      for (const line of statBlockLines(monster)) {
        if (isReadLine(line)) continue;
        handed += 1;
        if (MONSTER_LINE_SHAPES.some(([, matches]) => matches(line))) continue;
        if (listed.has(`${monster.name}/${line.name}`)) continue;
        lost += 1;
      }
    }
    expect(handed).toBe(ledger.monsters.handedOver);
    expect(lost).toBe(0);
  });

  /**
   * **A cast line has left the books**, which is the other direction the same
   * argument runs in.
   *
   * It was here as a row of its own for one batch — read, and not paid,
   * because no door handed one of its spells to the casting pipeline — and it
   * is gone because `castPrintedLine` is that door. So the shape is not among
   * the rows at all, a block whose only debt was a cast line is counted clean,
   * and `isExecutedLine` counts `casts`, which is what takes those lines out
   * of the recharge and per-day rows as well.
   *
   * Asserted rather than left to a byte comparison with the committed file,
   * for the reason the row itself was asserted: a shape that quietly came back
   * would be a debt nobody was told about.
   */
  it('counts a cast line as executed, and carries no row for it', () => {
    expect(ledger.monsters.shapes.map((one) => one.shape)).not.toContain(
      'A line that casts, read and not spent',
    );

    const casting = SRD_CONTENT.monsters.filter(
      (monster) =>
        monster.cr <= 5 && statBlockLines(monster).some((line) => line.casts !== undefined),
    );
    // Non-vacuous: the book does print such lines under CR 5.
    expect(casting.length).toBeGreaterThan(0);
    for (const monster of casting) {
      const lines = statBlockLines(monster).filter((line) => line.casts !== undefined);
      // Read, as they always were — and now executed, which is what takes them
      // off every row that counts a debt.
      expect(lines.every(isReadLine)).toBe(true);
      expect(lines.every(isExecutedLine)).toBe(true);
    }
  });

  /**
   * And the legendary lines are in both, because they are two debts: that
   * nothing spends a legendary action, and that nothing applies what the
   * line says. Pinned by name so an exclusion has to come here and argue.
   */
  it('keeps a legendary line in the residue as well as in the economy row', () => {
    const legendary = ledger.monsters.shapes.find((one) => one.shape === LEGENDARY_ECONOMY);
    expect(legendary?.lines).toBeGreaterThan(0);
    const inResidue = ledger.monsters.residue.filter(
      (one) => one.section === 'legendary action',
    );
    expect(inResidue.length).toBe(legendary?.lines);
  });
});

describe('the three totals are the three populations added up', () => {
  const ledger = auditLedger();
  const totals = ledgerTotals(ledger);

  /**
   * **Five rows, and two of them are gate G1's.** Items had a blocker map and
   * no row; the glossary's general rules had neither. Both were invisible on
   * the one report the roadmap ranks by.
   */
  it('gives one row per population, and five of them', () => {
    expect(totals).toHaveLength(5);
    expect(totals.map((one) => one.name)).toEqual([
      'Spells in reach, not executed',
      'Features manual, or a pool with nothing to buy',
      'Items a level 1–5 party can buy',
      'Glossary general rules nothing executes',
      'CR ≤ 5 stat-block items handed over or unapplied',
    ]);
  });

  /**
   * The item reach rule is a price, and it can fail: a priced item the map
   * blocks lands in the blocked column, which is the case the row is empty of
   * today and would otherwise be unfalsifiable.
   */
  it('reaches a priced item and refuses one the book charges nothing for', () => {
    const priced = { id: 'a-torch', name: 'A Torch', kind: 'gear', costCp: 1 };
    const granted = { id: 'a-hoard-sword', name: 'A Hoard Sword', kind: 'weapon', costCp: null };
    expect(itemsInReach([priced, granted], {}).map((one) => one.id)).toEqual(['a-torch']);
    expect(
      itemsInReach([priced], { 'a-torch': ['what-ends-attunement-besides-a-command'] })[0],
    ).toMatchObject({ wait: 'shape', shapes: ['what-ends-attunement-besides-a-command'] });
  });

  it('counts the Potion of Healing as the one magic item a party can buy', () => {
    const potions = ledger.items.filter((one) => one.kind === 'potion');
    expect(potions.map((one) => one.id)).toEqual(['potion-of-healing']);
  });

  /**
   * And feats are in the feature walk, which they were not before G1 — a
   * whole book of the catalogue the ledger could not see.
   *
   * Asserted over `ledger.features` rather than over `SRD_CONTENT.feats`,
   * because the walk is the thing that was missing and a test of the fixture
   * would pass with the walk deleted. Every feat the population answers for
   * is in the table, carries the level its bracket prints, and waits on a
   * shape.
   */
  it('puts every feat the map answers for in the table', () => {
    const feats = ledger.features.filter((one) => one.source === 'feat');
    expect(feats.map((one) => one.id).sort()).toEqual([...FEATS_ANSWERED_FOR].sort());
    for (const one of feats) {
      expect(one.level, one.id).toBeLessThanOrEqual(LEDGER_LEVEL);
      expect(one.shapes.length, one.id).toBeGreaterThan(0);
      expect(one.wait, one.id).toBe('shape');
    }
  });

  /**
   * And the bracket is the level, which is the one thing a feat has that a
   * feature's `level` field is standing in for.
   *
   * An Origin feat and a Fighting Style print no bracket and are taken at 1;
   * an Epic Boon prints 19 and is out of a level 5 character's reach. Nine of
   * the sixteen are in it, which is the number the walk had been going past.
   */
  it('reads a feat’s bracket as its level and drops the ones out of reach', () => {
    const inReach = SRD_CONTENT.feats.filter((one) => (one.minimumLevel ?? 1) <= LEDGER_LEVEL);
    expect(inReach.length).toBeLessThan(SRD_CONTENT.feats.length);
    for (const id of ledger.features.filter((one) => one.source === 'feat').map((one) => one.id)) {
      expect(inReach.map((one) => one.id), id).toContain(id);
    }
    // The epic boons are out, and named so the drop is a claim rather than an
    // absence: each prints `Prerequisite: Level 19+`.
    const epic = SRD_CONTENT.feats.filter((one) => one.category === 'epic-boon');
    expect(epic.length).toBeGreaterThan(0);
    for (const one of epic) {
      expect(ledger.features.map((row) => row.id), one.id).not.toContain(one.id);
    }
  });

  it('splits each population into what waits on a shape and what does not', () => {
    const [spells, features] = totals;
    expect(spells?.size).toBe(ledger.spells.length);
    expect(spells?.blocked).toBe(ledger.spells.filter((one) => one.wait === 'shape').length);
    expect(spells?.free).toBe(ledger.spells.filter((one) => one.wait === 'none').length);
    expect(features?.size).toBe(ledger.features.length);
    expect(features?.blocked).toBe(ledger.features.filter((one) => one.wait === 'shape').length);
  });

  /** Every row's three parts add to the population they split, or one is lost. */
  it('loses nothing between the split and the population it splits', () => {
    for (const row of totals) {
      expect(row.blocked + row.pending + row.free, row.name).toBe(row.split);
    }
  });

  /**
   * **Waiting on a shape is not the same claim as waiting on a definition**,
   * and the second column exists because the report used to print the second
   * as the third.
   *
   * Gate G1: *waits on none* held three claims — nobody has read it, it is
   * expressible and nobody wrote it, and it is handed over — and only the
   * third is finished business. The classifier is driven with one of each
   * before it is believed about the catalogue, because a column that can only
   * be computed over data it already agrees with is not a measurement.
   */
  it('tells an unread spell from a handed-over one', () => {
    // Nobody has read it: no map holds an entry for this id at all.
    expect(spellWaitOf('a-spell-nobody-read', 'tracked', [])).toBe('definition');
    // No definition at all is always a definition short, whatever its clauses
    // say — an entry naming only handovers records a reading, not a spell.
    expect(spellWaitOf('a-spell-nobody-wrote', 'no-definition', [])).toBe('definition');
    // A shape outranks both.
    expect(spellWaitOf('a-spell-nobody-read', 'tracked', ['movement-modes'])).toBe('shape');
    // And a spell whose every clause is the table's is finished business.
    expect(spellWaitOf('water-walk', 'tracked', [])).toBe('none');
  });

  /**
   * And the column is not decoration: a spell nobody has read lands in it,
   * which is the state that used to be printed as zero.
   */
  it('counts an unread spell as waiting on a definition, not on nothing', () => {
    const unread: (typeof ledger.spells)[number] = {
      id: 'a-spell-nobody-read',
      name: 'A Spell Nobody Read',
      level: 1,
      status: 'tracked',
      shapes: [],
      wait: spellWaitOf('a-spell-nobody-read', 'tracked', []),
    };
    const [spells] = ledgerTotals({ ...ledger, spells: [unread] });
    expect(spells?.pending).toBe(1);
    expect(spells?.free).toBe(0);
  });

  /**
   * One row counts in two units and says so, rather than dividing lines by
   * blocks. A block with four unapplied lines is one fight that does not run.
   */
  it('names both units where a population has two', () => {
    const [spells, features, , , monsters] = totals;
    for (const row of [spells, features]) {
      expect(row?.splitUnit).toBe(row?.unit);
      expect(row?.split).toBe(row?.size);
    }
    expect(monsters?.unit).toBe('items');
    expect(monsters?.splitUnit).toBe('blocks');
    expect(monsters?.size).toBe(ledger.monsters.items);
    expect(monsters?.split).toBe(ledger.monsters.blocks);
  });

  /**
   * The criterion, written as the query the foreman runs. It is not zero
   * today and the test does not pretend otherwise: what it asserts is that
   * the question **has** an answer and that a ledger of nothing would read as
   * done rather than as broken.
   */
  it('answers criterion 1 with a number', () => {
    const waiting = totals.reduce((sum, row) => sum + row.blocked, 0);
    expect(waiting).toBeGreaterThan(0);
    expect(ledgerTotals({ ...ledger, spells: [], features: [] }).slice(0, 2)).toEqual([
      {
        name: 'Spells in reach, not executed',
        size: 0,
        unit: 'spells',
        blocked: 0,
        pending: 0,
        free: 0,
        split: 0,
        splitUnit: 'spells',
      },
      {
        name: 'Features manual, or a pool with nothing to buy',
        size: 0,
        unit: 'features',
        blocked: 0,
        pending: 0,
        free: 0,
        split: 0,
        splitUnit: 'features',
      },
    ]);
  });
});

describe('everything is grouped by the shape it waits on', () => {
  const report = renderLedger(auditLedger());

  it('prints a heading per shape a spell waits on, and names the spell under it', () => {
    const ledger = auditLedger();
    const blocked = ledger.spells.filter((one) => one.shapes.length > 0);
    for (const one of blocked.slice(0, 20)) {
      expect(report, one.id).toContain(one.name);
      for (const shape of one.shapes) expect(report, shape).toContain(`\`${shape}\``);
    }
  });

  it('names every feature of the population somewhere in the report', () => {
    for (const one of auditLedger().features) expect(report, one.id).toContain(`\`${one.id}\``);
  });

  /** And a spell waiting on no shape is listed too, rather than dropped. */
  it('lists what waits on nothing rather than omitting it', () => {
    const free = auditLedger().spells.filter((one) => one.wait === 'none');
    expect(free.length).toBeGreaterThan(0);
    for (const one of free.slice(0, 20)) expect(report, one.id).toContain(one.name);
  });

  /** And the third column has a heading of its own, listed the same way. */
  it('prints the waits-on-a-definition list as a section rather than a number', () => {
    expect(report).toContain('#### Waiting on a definition');
    expect(report).toContain('| Ledger | Size | Waits on an engine shape | Waits on a definition |');
  });
});

/**
 * Generated, like `COVERAGE.md`: the committed report carries what the code
 * says, or `npm run ledger` has not been run since the code moved.
 */
describe('the committed LEDGER.md says what the code says', () => {
  const committed = readFileSync(
    fileURLToPath(new URL('../../../LEDGER.md', import.meta.url)),
    'utf8',
  );

  it('is the file the generator would write', () => {
    expect(committed).toBe(renderLedger(auditLedger()));
  });

  /**
   * And the failure names the remedy, which is the half a byte comparison
   * cannot give a reader. The three totals are asserted line by line so a
   * stale report says *which* number moved.
   */
  it('carries the three totals', () => {
    for (const row of ledgerTotals(auditLedger())) {
      expect(committed, row.name).toContain(`| ${row.name} |`);
    }
  });

  it('says it is derived and how to regenerate it', () => {
    expect(committed).toContain('npm run ledger');
  });
});
