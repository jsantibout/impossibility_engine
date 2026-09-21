/**
 * `LEDGER.md`: what stands between the engine and a playable level 5.
 *
 * **`COVERAGE.md` answers "how much of the SRD is built". This answers "what
 * is left before a level 1–5 party can play", and they are not the same
 * question.** The first is a measurement over the whole book and the right
 * way to read a project's size; the second is the one `docs/ROADMAP.md` ranks
 * every batch by, and until now it lived in a snapshot taken by hand from
 * scripts under `node_modules/.audit/` — a directory that vanishes on an
 * `npm ci`. The number the whole plan is aimed at could not be recomputed by
 * a second person, which is the failure this file exists to end.
 *
 * Three populations, the three the roadmap's §0 table names:
 *
 * | | Restricted to |
 * |---|---|
 * | Spells the engine does not resolve | a level 5 character of some class can cast it |
 * | Features the blocker map answers for | a character of level 1–5 holds it |
 * | Stat-block lines nothing applies | the block is CR ≤ 5 |
 *
 * **The reach rule is the report's, not a second one.** `reachOf` and
 * `withinReach` in `coverage-data.ts` are what `playableLevels` itself asks,
 * and the ledger asks them too rather than restating "a cantrip where the
 * table gives cantrips, a spell whose level it has a slot of". The audit's
 * throwaway script restated it, and a ledger that disagreed with the report
 * about a Cleric's reach would put a spell on a brief nobody can cast.
 * `ledger.test.ts` asserts the agreement class by class.
 *
 * **Nothing here decides what counts as executed.** A spell is executed when
 * `EXECUTED_SPELL_IDS` says so, partial when `PARTIAL_SPELLS` says so, in the
 * map's population when `ledgerFeatureIds` says so, and read when the parser
 * got structure out of the sentence. Every one of those is somebody else's
 * derivation and is imported rather than re-spelled.
 *
 * This module has one writer and it runs only when Node was asked to run this
 * file, exactly as `coverage.ts` does and for the same reason: a test imports
 * it for the measurement, and a script that writes while being imported turns
 * the suite into the generator of the file the gauntlet diffs.
 *
 * Run with `npm run ledger`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SRD_CONTENT } from '@ie/content';
import { dryBuild, refuseStaleBuild } from './build-freshness.js';
import {
  ADJUDICATED,
  TRACKED_ADJUDICATED,
  blockersOf,
} from './missing-shapes.js';
import {
  featureBlockersOf,
  ledgerFeatureIds,
} from './missing-feature-shapes.js';
import {
  EXECUTED_SPELL_IDS,
  LEGENDARY_ECONOMY,
  MONSTER_LINE_SHAPES,
  PARTIAL_SPELLS,
  RIDER_SHAPE,
  TRACKED_IDS,
  hasUnappliedRider,
  isReadLine,
  spellsInReach,
  statBlockLines,
  type ParsedSpell,
  type StatBlockLine,
} from './coverage-data.js';

/**
 * The level the ledger measures, and the owner's definition of the
 * destination: "playable to level 5" means everything a level 1–5 character
 * can reach is executed by the engine.
 */
export const LEDGER_LEVEL = 5;

/** The Challenge Rating a level 5 party is pointed at, and below. */
export const LEDGER_MAX_CR = 5;

/** The four claims `COVERAGE.md` keeps apart, read here rather than restated. */
export type SpellStatus = 'executed' | 'executed-partial' | 'tracked' | 'no-definition';

export interface LedgerSpell {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly status: SpellStatus;
  /** The shapes its unfinished clauses name, deduplicated and sorted. */
  readonly shapes: readonly string[];
}

export interface LedgerFeature {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /** Which book it is printed in, so a reader knows whose brief it is. */
  readonly source: 'class' | 'subclass' | 'species' | 'background';
  readonly automation: string;
  readonly shapes: readonly string[];
}

export interface LedgerMonsterShape {
  readonly shape: string;
  /** Lines of CR ≤ 5 blocks this shape accounts for. */
  readonly lines: number;
  /** Blocks at least one of those lines belongs to. */
  readonly blocks: number;
  /** A few named blocks, so a brief can start somewhere. */
  readonly examples: readonly string[];
}

export interface LedgerResidueLine {
  readonly monster: string;
  readonly cr: number;
  readonly section: string;
  readonly line: string;
}

export interface LedgerMonsters {
  /** CR ≤ 5 stat blocks the catalogue carries. */
  readonly blocks: number;
  readonly printed: number;
  readonly read: number;
  /** Printed lines the parser got nothing out of. */
  readonly handedOver: number;
  /** Read attack lines whose printed rider nothing applies. */
  readonly riders: number;
  /** The population: handed-over lines plus unapplied riders. */
  readonly items: number;
  /** Blocks carrying none of them. */
  readonly clean: number;
  readonly unfinished: number;
  readonly shapes: readonly LedgerMonsterShape[];
  /** Handed-over lines matching no enumerated shape. */
  readonly residue: readonly LedgerResidueLine[];
}

export interface Ledger {
  readonly level: number;
  readonly spells: readonly LedgerSpell[];
  readonly features: readonly LedgerFeature[];
  readonly monsters: LedgerMonsters;
}

/** One row of the summary table: a population, split by what it waits on. */
export interface LedgerRow {
  readonly name: string;
  /** The population's size in its own unit. */
  readonly size: number;
  readonly unit: string;
  /** Of {@link split}, what names at least one shape. */
  readonly blocked: number;
  readonly free: number;
  /**
   * The size in {@link splitUnit}, which is always `blocked + free`.
   *
   * It differs from {@link size} on exactly one row. The bestiary's
   * population is *lines* and the question "does this wait on anything" is
   * only answerable per **block** — a block with four unapplied lines is one
   * fight that does not run, not four — so the two are different units and
   * the table prints both rather than dividing one by the other.
   */
  readonly split: number;
  readonly splitUnit: string;
}

const sorted = (ids: Iterable<string>): readonly string[] => [...new Set(ids)].sort();

/** Which of the four states a spell is in, read off the report's own sets. */
export const spellStatusOf = (id: string, defined: ReadonlySet<string>): SpellStatus => {
  if (!defined.has(id)) return 'no-definition';
  if (EXECUTED_SPELL_IDS.has(id)) return PARTIAL.has(id) ? 'executed-partial' : 'executed';
  if (TRACKED_IDS.has(id)) return 'tracked';
  return 'no-definition';
};

const PARTIAL = new Set(PARTIAL_SPELLS);

/**
 * The shapes one spell's unfinished clauses name.
 *
 * Three populations and one answer, because a spell is adjudicated in
 * whichever of the three maps its state puts it in: `BLOCKED_ON` for a spell
 * with no definition, `ADJUDICATED` for an executed one with a clause left,
 * `TRACKED_ADJUDICATED` for one the engine casts and does not resolve.
 * `'table'` is a handover and `'engine'` says the clause *is* executed, so
 * neither is a shape and neither is counted.
 */
export const spellShapesOf = (id: string, status: SpellStatus): readonly string[] => {
  if (status === 'no-definition') return [...blockersOf(id)];
  const clauses = status === 'executed-partial' ? ADJUDICATED[id] : TRACKED_ADJUDICATED[id];
  return sorted(
    (clauses ?? [])
      .map((clause) => clause.why)
      .filter((why) => why !== 'table' && why !== 'engine'),
  );
};

/** Every feature a character of level 1–5 holds, with where it is printed. */
const featuresHeld = (level: number): readonly LedgerFeature[] => {
  const population = new Set(ledgerFeatureIds());
  const books = [
    ['class', SRD_CONTENT.classes.flatMap((one) => one.features)],
    ['subclass', SRD_CONTENT.subclasses.flatMap((one) => one.features)],
    ['species', SRD_CONTENT.species.flatMap((one) => one.features)],
    ['background', SRD_CONTENT.backgrounds.flatMap((one) => one.features)],
  ] as const;

  const found = new Map<string, LedgerFeature>();
  for (const [source, features] of books) {
    for (const feature of features) {
      if (feature.level > level) continue;
      if (!population.has(feature.id)) continue;
      if (found.has(feature.id)) continue;
      found.set(feature.id, {
        id: feature.id,
        name: feature.name,
        level: feature.level,
        source,
        automation: feature.automation,
        shapes: [...featureBlockersOf(feature.id)],
      });
    }
  }
  return [...found.values()].sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
};

/** The section a line is printed under, which is what a reader looks it up by. */
const sectionsOf = (
  monster: (typeof SRD_CONTENT.monsters)[number],
): readonly (readonly [string, StatBlockLine])[] => [
  ...monster.traits.map((line) => ['trait', line] as const),
  ...monster.actions.map((line) => ['action', line] as const),
  ...monster.bonusActions.map((line) => ['bonus action', line] as const),
  ...monster.reactions.map((line) => ['reaction', line] as const),
  ...monster.legendaryActions.map((line) => ['legendary action', line] as const),
];

/**
 * Whether a shape accounts for a line.
 *
 * The rider shape is the only one that runs over a line the parser **read**:
 * the other five ask about a sentence nothing got structure out of, and a
 * recharge on a line whose attack is parsed is an economy the engine already
 * spends rather than a debt. That gate is the difference between the whole
 * bestiary's table in `COVERAGE.md`, which counts a shape wherever it is
 * printed, and this one, which counts what is *unapplied*.
 */
const accountsFor = (
  shape: string,
  matches: (line: StatBlockLine) => boolean,
  line: StatBlockLine,
): boolean => (shape === RIDER_SHAPE ? matches(line) : !isReadLine(line) && matches(line));

const auditMonsters = (maxCr: number): LedgerMonsters => {
  const low = SRD_CONTENT.monsters.filter((monster) => monster.cr <= maxCr);

  let printed = 0;
  let read = 0;
  let riders = 0;
  let clean = 0;
  for (const monster of low) {
    const lines = statBlockLines(monster);
    printed += lines.length;
    read += lines.filter(isReadLine).length;
    riders += lines.filter(hasUnappliedRider).length;
    if (lines.every((line) => isReadLine(line) && !hasUnappliedRider(line))) clean += 1;
  }

  const shapes: LedgerMonsterShape[] = [];
  for (const [shape, matches] of MONSTER_LINE_SHAPES) {
    let lines = 0;
    const blocks = new Set<string>();
    const examples: string[] = [];
    for (const monster of low) {
      const hits = statBlockLines(monster).filter((line) => accountsFor(shape, matches, line));
      if (hits.length === 0) continue;
      lines += hits.length;
      blocks.add(monster.name);
      if (examples.length < 6) examples.push(`${monster.name} (CR ${monster.cr}) / ${hits[0]!.name}`);
    }
    shapes.push({ shape, lines, blocks: blocks.size, examples });
  }
  // The legendary economy belongs to the block rather than to a line, so it
  // is counted as one shape over every legendary action a CR ≤ 5 block prints.
  const legendary = low.filter((monster) => monster.legendaryActions.length > 0);
  shapes.push({
    shape: LEGENDARY_ECONOMY,
    lines: legendary.reduce((sum, monster) => sum + monster.legendaryActions.length, 0),
    blocks: legendary.length,
    examples: legendary
      .slice(0, 6)
      .map((monster) => `${monster.name} (CR ${monster.cr}) / ${monster.legendaryActions[0]!.name}`),
  });
  shapes.sort((a, b) => b.lines - a.lines || b.blocks - a.blocks || a.shape.localeCompare(b.shape));

  const named = (line: StatBlockLine, section: string): boolean =>
    section === 'legendary action' ||
    MONSTER_LINE_SHAPES.some(([shape, matches]) => accountsFor(shape, matches, line));

  const residue: LedgerResidueLine[] = [];
  for (const monster of low) {
    for (const [section, line] of sectionsOf(monster)) {
      if (isReadLine(line)) continue;
      if (named(line, section)) continue;
      residue.push({ monster: monster.name, cr: monster.cr, section, line: line.name });
    }
  }
  residue.sort((a, b) => a.monster.localeCompare(b.monster) || a.line.localeCompare(b.line));

  const handedOver = printed - read;
  return {
    blocks: low.length,
    printed,
    read,
    handedOver,
    riders,
    items: handedOver + riders,
    clean,
    unfinished: low.length - clean,
    shapes,
    residue,
  };
};

/** The three populations, measured against the catalogue as it stands. */
export function auditLedger(level: number = LEDGER_LEVEL): Ledger {
  const parsed = JSON.parse(
    readFileSync('packages/srd/src/generated/spells.json', 'utf8'),
  ) as ParsedSpell[];
  const defined = new Set(
    // The definitions the catalogue holds, which is what tells a tracked
    // spell from one nothing has written at all.
    [...EXECUTED_SPELL_IDS, ...TRACKED_IDS],
  );

  const spells: LedgerSpell[] = [];
  for (const one of spellsInReach(SRD_CONTENT.classes, parsed, level)) {
    const status = spellStatusOf(one.id, defined);
    if (status === 'executed') continue;
    spells.push({
      id: one.id,
      name: one.name,
      level: one.level,
      status,
      shapes: spellShapesOf(one.id, status),
    });
  }

  return {
    level,
    spells,
    features: featuresHeld(level),
    monsters: auditMonsters(LEDGER_MAX_CR),
  };
}

/** The summary table: three populations, each split by what it waits on. */
export function ledgerTotals(ledger: Ledger): readonly LedgerRow[] {
  const split = (items: readonly { readonly shapes: readonly string[] }[]) => ({
    blocked: items.filter((one) => one.shapes.length > 0).length,
    free: items.filter((one) => one.shapes.length === 0).length,
  });
  const spells = split(ledger.spells);
  const features = split(ledger.features);

  return [
    {
      name: 'Spells in reach, not executed',
      size: ledger.spells.length,
      unit: 'spells',
      ...spells,
      split: ledger.spells.length,
      splitUnit: 'spells',
    },
    {
      name: 'Features manual, or a pool with nothing to buy',
      size: ledger.features.length,
      unit: 'features',
      ...features,
      split: ledger.features.length,
      splitUnit: 'features',
    },
    {
      name: 'CR ≤ 5 stat-block items handed over or unapplied',
      size: ledger.monsters.items,
      unit: 'items',
      blocked: ledger.monsters.unfinished,
      free: ledger.monsters.clean,
      split: ledger.monsters.blocks,
      splitUnit: 'blocks',
    },
  ];
}

const HEADER = [
  '# LEDGER.md — what is left before a level 5 party can play',
  '',
  '> **Derived. Do not edit by hand.** Regenerate with `npm run ledger` and',
  '> commit the result. `COVERAGE.md` answers how much of the SRD is built;',
  '> this answers what stands between the engine and the destination in',
  '> `docs/ROADMAP.md` §0, which is the first of the four ship criteria:',
  '> **this report at zero**.',
  '',
  'Everything below is restricted to what a character of level 1–5 can reach.',
  'A spell is in reach when its class table gives a slot of its level at the',
  'fifth, or gives cantrips at all — the rule `playableLevels` applies, asked',
  'through the same two functions so the two cannot drift. A feature is in',
  'reach when it is printed at level 5 or below. A stat block is in reach when',
  'its Challenge Rating is 5 or less.',
  '',
  '**Waiting on a shape is a debt; waiting on nothing is not.** A clause the',
  'table owns is fiction no rule reads afterwards and nobody will ever pay it,',
  'which `docs/design/content.md` states as the test: a table fact that a rule',
  'then reads is a debt, a table fact nothing reads afterwards is a handover.',
  'An item in the *waits on none* column is finished business, and it is listed',
  'rather than omitted because an entry silently missing from a ledger looks',
  'exactly like an entry nobody read.',
  '',
];

const line = (row: LedgerRow): string => {
  const split =
    row.splitUnit === row.unit
      ? [`${row.blocked}`, `${row.free}`]
      : [
          `on ${row.blocked} of ${row.split} ${row.splitUnit}`,
          `${row.free} ${row.splitUnit} already clean`,
        ];
  return `| ${row.name} | ${row.size} ${row.unit} | ${split[0]} | ${split[1]} |`;
};

const spellLine = (one: LedgerSpell): string =>
  `- **${one.name}** (level ${one.level}) — ${one.status}`;

const featureLine = (one: LedgerFeature): string =>
  `- \`${one.id}\` — ${one.name} (level ${one.level}, ${one.source}, ${one.automation})`;

/** Everything of a population that waits on one shape, under that shape. */
function groupByShape<T extends { readonly shapes: readonly string[] }>(
  items: readonly T[],
  render: (one: T) => string,
  noun: string,
  order: string,
): readonly string[] {
  const shapes = sorted(items.flatMap((one) => one.shapes));
  const rows = shapes
    .map((shape) => {
      const blocks = items.filter((one) => one.shapes.includes(shape));
      return { shape, blocks, finishes: blocks.filter((one) => one.shapes.length === 1) };
    })
    .sort(
      (a, b) =>
        b.finishes.length - a.finishes.length ||
        b.blocks.length - a.blocks.length ||
        a.shape.localeCompare(b.shape),
    );

  const lines = ['', '| Shape | Blocks | Finishes |', '|---|---|---|'];
  for (const row of rows) {
    lines.push(`| \`${row.shape}\` | ${row.blocks.length} | ${row.finishes.length} |`);
  }
  lines.push(
    '',
    `**Blocks** is every ${noun} of this population the shape touches;`,
    '**finishes** is what it is the *only* blocker for — the column a tranche',
    `is planned from. A ${noun} can need more than one shape, so neither column`,
    'sums to the population.',
    '',
  );
  for (const row of rows) {
    lines.push(
      `#### \`${row.shape}\` — blocks ${row.blocks.length}, finishes ${row.finishes.length}`,
      '',
    );
    for (const one of row.blocks) {
      const rest = one.shapes.filter((shape) => shape !== row.shape);
      const also = rest.length === 0 ? '' : ` — also waits on ${rest.length}`;
      lines.push(`${render(one)}${also}`);
    }
    lines.push('');
  }

  const free = items.filter((one) => one.shapes.length === 0);
  lines.push(`#### Waiting on no shape — ${free.length}`, '');
  for (const one of free) lines.push(render(one));
  lines.push('', `Listed by ${order}.`);
  return lines;
}

/** The whole report as text, measured but not written. */
export function renderLedger(ledger: Ledger = auditLedger()): string {
  const lines = [...HEADER];

  lines.push(
    '## The three populations',
    '',
    '| Ledger | Size | Waits on an engine shape | Waits on none |',
    '|---|---|---|---|',
  );
  for (const row of ledgerTotals(ledger)) lines.push(line(row));

  lines.push(
    '',
    '## 1. Spells in reach the engine does not resolve',
    '',
    'Four states, kept apart because conflating them is how a project believes',
    'it is finished. `executed-partial` is a spell the engine resolves that',
    'still carries a clause nobody has built; `tracked` is one it casts and',
    'hands the effect over; `no-definition` is a spell the catalogue does not',
    'hold at all. An executed spell with nothing left is not here.',
  );
  lines.push(...groupByShape(ledger.spells, spellLine, 'spell', 'spell level, then name'));

  lines.push(
    '',
    '## 2. Features a level 1–5 character holds that the engine does not run',
    '',
    'The population is `missing-feature-shapes.ts`\'s: every feature declaring',
    '`automation: \'manual\'`, plus every feature declaring `engine` for a pool',
    'with nothing to spend a use on, plus the one pool whose uses buy some of',
    'what its page prints. Species and background traits are counted, because a',
    'species trait is the same `FeatureDefinition` a class feature is and a',
    'level 5 character holds one.',
  );
  const bySource = (source: string) =>
    ledger.features.filter((one) => one.source === source).length;
  lines.push(
    '',
    `Of the ${ledger.features.length}, ${bySource('class') + bySource('subclass')} are class or subclass features printed at level ${ledger.level} or below and ${bySource('species') + bySource('background')} are species or background traits.`,
    'The snapshot of 2026-09-21 in `docs/dev/roadmap-ledger-2026-09-21.md`',
    'counted the first group only, and did not see the pools; the traits are in',
    'reach of a level 5 character too, which is where the difference in the size',
    'comes from.',
  );
  lines.push(...groupByShape(ledger.features, featureLine, 'feature', 'level, then id'));

  const monsters = ledger.monsters;
  lines.push(
    '',
    '## 3. CR ≤ 5 stat-block lines handed over or unapplied',
    '',
    `${monsters.blocks} of the ${SRD_CONTENT.monsters.length} carried stat blocks are CR ≤ 5. They print ${monsters.printed} lines, of which the parser reads ${monsters.read} and hands over ${monsters.handedOver}. A further ${monsters.riders} of the read attack lines carry a printed rider nothing applies, so the population is ${monsters.items} items over ${monsters.blocks} blocks — ${monsters.clean} of which already carry none of them.`,
    '',
    '**A block is the unit that matters and a line is the unit that is counted.**',
    'A block with four unapplied lines is one fight that does not run, not four,',
    'so the split above is per block while the size is per line. The piles below',
    'overlap: one sentence can force a save and recharge.',
    '',
    '| Shape | Lines | Blocks | Three example blocks |',
    '|---|---|---|---|',
  );
  for (const shape of monsters.shapes) {
    lines.push(
      `| ${shape.shape} | ${shape.lines} | ${shape.blocks} | ${shape.examples.slice(0, 3).join('; ') || '—'} |`,
    );
  }
  lines.push(
    '',
    '**Two of those rows are an effect nobody applies and an economy that is',
    'already correct.** A recharge and a per-day limit are parsed onto every',
    'line, carried onto the sheet, asked at the turn boundary and spent by',
    '`takeStatedAction`; what is unapplied on such a line is what it *does*.',
    'A brief quoting those rows should say so.',
    '',
    `### Handed-over lines matching no enumerated shape — ${monsters.residue.length}`,
    '',
    'A debt nobody has given an id to is still a debt, so these are named here',
    'rather than dropped. They carry no parsed structure at all, which is why no',
    'predicate reaches them and why classifying them is a reading of English',
    'rather than a derivation — the roadmap keeps that reading in prose, and the',
    'ledger keeps the list.',
    '',
  );
  for (const one of monsters.residue) {
    lines.push(`- ${one.monster} (CR ${one.cr}) [${one.section}] ${one.line}`);
  }

  return `${lines.join('\n')}\n`;
}

/** True when Node was asked to run this file, rather than something importing it. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
  // The same refusal `coverage.ts` takes and for the same reason: `tsx`
  // resolves `@ie/content` through `dist`, so a build behind its source would
  // measure yesterday's catalogue against today's maps.
  refuseStaleBuild(dryBuild());

  const ledger = auditLedger();
  writeFileSync('LEDGER.md', renderLedger(ledger), 'utf8');
  for (const row of ledgerTotals(ledger)) {
    console.log(
      `${row.name}: ${row.size} ${row.unit}, ${row.blocked} of ${row.split} ${row.splitUnit} waiting on a shape`,
    );
  }
}
