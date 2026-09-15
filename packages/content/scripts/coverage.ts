/**
 * `COVERAGE.md`, rendered from the measurement in `coverage-data.ts`.
 *
 * **This module has one writer and it runs only when Node was asked to run
 * this file.** The write used to sit at module top level, and two test files
 * import the measurement — so `npm test` regenerated the report that the
 * gauntlet's `git diff --exit-code COVERAGE.md` then diffed, and that check
 * was asserting the suite had run rather than that the committed report was
 * right. Splitting the data out is what makes the guard sufficient: a test
 * that wants `PARTIAL_SPELLS` imports `coverage-data.ts` and never reaches
 * this file at all.
 *
 * The write sits **inside** the guard block rather than in a `main()` the
 * guard calls, because a function is callable from anywhere and a block is
 * not — which is the claim `coverage-script.test.ts` checks across the whole
 * of `scripts/`, driven over a synthetic write it has to catch.
 *
 * **Two things stop the run before the write, and both used to be neither.**
 * A build older than the source it would be measured from is refused, because
 * `tsx` resolves `@ie/content` through `dist` while the lists here are source
 * — the two can be a day apart. And a measurement that contradicts itself is
 * refused, where it used to be written into the file as a line of prose
 * beginning "**Inconsistent:**", which is a report describing its own
 * brokenness and shipping anyway. `coverage-script.test.ts` reads the order of
 * those two against the write off this file's own source.
 *
 * Run with `npm run coverage`.
 */

import { writeFileSync } from 'node:fs';
import { SPELL_DEFINITIONS } from '@ie/content';
import { pathToFileURL } from 'node:url';
import { dryBuild, refuseStaleBuild } from './build-freshness.js';
import { allShapeConsumers } from './missing-shapes.js';
import {
  auditClasses,
  auditMagicItems,
  auditOrigins,
  auditSpells,
  coverageInconsistencies,
  PARTIAL_SPELLS,
  TRACKED_IDS,
  VERIFIED_SPELLS,
  type ClassCoverage,
  type MagicItemCoverage,
  type OriginCoverage,
  type SpellCoverage,
} from './coverage-data.js';

function renderClasses(coverage: ClassCoverage): readonly string[] {
  const lines = [
    '',
    '## Classes',
    '',
    `| Classes | Subclasses | Features | Executed by the engine |`,
    `|---|---|---|---|`,
    `| ${coverage.classes} / 12 | ${coverage.subclasses} / 12 | ${coverage.features} | ${coverage.executed} |`,
    '',
    'A feature declares its own automation, so this column is read rather than',
    'guessed. **Manual is not failure**: several features are judgement the',
    'engine should never take from a DM, and every one of them carries a note',
    'saying what is left to do. But a project that does not count them will',
    'believe it has twelve working classes when it has twelve validated ones.',
    '',
    '| Class | Casting | Features | Executed |',
    '|---|---|---|---|',
  ];

  for (const row of [...coverage.rows].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| ${row.name} | ${row.style} | ${row.features} | ${row.executed} |`);
  }

  return lines;
}

/**
 * Species and backgrounds, counted with the class column's own predicate.
 *
 * **They were honest and uncounted at the same time.** Every trait the engine
 * cannot execute is marked `manual` and says what a DM is left holding — the
 * standard the class corpus set — and none of it appeared anywhere, because
 * the only audit there was audits classes.
 *
 * Its own section rather than rows in the table above, because that table's
 * totals answer "how much of a class does the engine run". A species has no
 * casting style and no subclasses; folding its traits into that total would
 * change what the existing numbers mean without changing their names.
 */
function renderOrigins(coverage: OriginCoverage): readonly string[] {
  const lines = [
    '',
    '## Origins',
    '',
    '| Species | Backgrounds | Features | Executed by the engine |',
    '|---|---|---|---|',
    `| ${coverage.species} | ${coverage.backgrounds} | ${coverage.features} | ${coverage.executed} |`,
    '',
    'A species trait and a class feature are the same `FeatureDefinition` and',
    'declare automation the same way, so this is the column above read by the',
    'same predicate — `isExecutedFeature` in',
    '`packages/content/scripts/coverage-data.ts`, which both tables call.',
    '**Manual is not failure** here either: most of what a species grants is',
    'Darkvision, a Breath Weapon or a Resistance whose damage type is read off a',
    'sibling choice, and each carries a note saying exactly what is left to the',
    'table and why.',
    '',
    '**Feats are not counted.** A `FeatDefinition` declares no automation — it',
    'carries a note about what a DM still applies and nothing the engine reads —',
    'so there is no predicate to read one with, and a column claiming to be',
    'derived would be somebody’s opinion instead.',
    '',
    '| Origin | Kind | Features | Executed |',
    '|---|---|---|---|',
  ];

  for (const row of [...coverage.rows].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| ${row.name} | ${row.kind} | ${row.features} | ${row.executed} |`);
  }

  return lines;
}

/**
 * Magic items, where the two populations must never be divided by each other.
 *
 * The SRD writes _Weapon, +1, +2, or +3_ **once**, as a template over the
 * weapon table, and the catalogue holds a +1, a +2 and a +3 of each weapon
 * because an inventory holds a sword rather than a template. Four entries
 * account for most of the catalogue's magic items. So "how much of the book is
 * transcribed" is a count of entries and "how many magic items are there" is a
 * count of records, and printing the second under the first would claim the
 * Weapons chapter was covered nearly four times over.
 */
function renderMagicItems(coverage: MagicItemCoverage): readonly string[] {
  const lines = [
    '',
    '## Magic items',
    '',
    'Five states, and *transcribed* and *instances* count different things and',
    'are never divided by each other:',
    '',
    '| | Means |',
    '|---|---|',
    '| **Parsed** | `@ie/srd` has the entry: name, category, rarity line, attunement bracket, charges, prose |',
    '| **Transcribed** | at least one catalogue record was read out of that entry |',
    '| **Instances** | the catalogue records those entries expand to |',
    '| **Complete** | a record that carries no `unmodelled` note: it does everything its entry says |',
    '| **Partial** | a record carrying at least one, quoting the clause it leaves to the table |',
    '',
    '**One entry is not one item.** The SRD writes _Weapon, +1, +2, or +3_ once,',
    'as a template over the weapon table; the catalogue holds a +1, a +2 and a +3',
    'of every weapon in it, because an inventory holds a sword rather than a',
    'template. A handful of template entries account for most of the records',
    'below, which is why *transcribed* counts entries and *instances* counts',
    'records. *Transcribed* against *parsed* is a fraction of the book and is',
    'meant to be read as one; *instances* against either is not a fraction of',
    'anything, and reading it as one would report the Weapons chapter as',
    'covered several times over — the Weapons row below says by how much, which',
    'is where a figure like that belongs.',
    '',
    `| Parsed | Transcribed | Instances | of which complete | of which partial |`,
    `|---|---|---|---|---|`,
    `| ${coverage.parsed} | ${coverage.transcribed} | ${coverage.instances} | ${coverage.complete} | ${coverage.partial} |`,
    '',
    'An entry with **no** record is one whose whole text is beyond the grant',
    'vocabulary. `packages/content/src/items.ts` states the three rules that',
    'decide it — and the third is the sharp one: an item is left out when the',
    'clause the engine cannot say is the one that *limits* the benefit, because',
    'a Cloak of Displacement without its "if you take damage" is a better cloak',
    'than the book prints.',
    '',
    '**Whether a test drives an item end to end is not counted here.** That is',
    'the spells table’s *verified*, and it is a hand-kept list precisely because',
    'no derivation can say it: the claim belongs to the commit that writes the',
    'test. There is no such list for items, so this says nothing rather than',
    'inventing a column that nothing checks.',
    '',
    '| Category | Parsed | Transcribed | Instances | Complete | Partial |',
    '|---|---|---|---|---|---|',
  ];

  for (const row of coverage.rows) {
    lines.push(
      `| ${row.category} | ${row.parsed} | ${row.transcribed} | ${row.instances} | ${row.complete} | ${row.partial} |`,
    );
  }

  lines.push(
    '',
    '### Entries transcribed',
    '',
    'Each is one entry of "Magic Items A–Z", with the records it expands to and',
    'how many of those still carry a clause the engine does not say.',
    '',
  );
  for (const entry of coverage.entries) {
    const gaps = entry.partial === 0 ? 'complete' : `${entry.partial} partial`;
    lines.push(`- **${entry.name}** (${entry.category}) — ${entry.instances} recorded, ${gaps}`);
  }

  return lines;
}

/**
 * What blocks the rest, counted rather than estimated.
 *
 * The repository carried **three** rankings of one family and they disagreed by
 * four times, because none of them was derived. `missing-shapes.ts` holds the
 * vocabulary and every spell blocked on it across all three populations, so
 * this table is a query.
 *
 * **Three columns, and each difference is a finding.** *Blocks* is every spell
 * a shape touches; *finishes* is the spells it is the only blocker for — the
 * ones building it would complete. A granted defence finishes exactly two and
 * touches several times that many, and reporting only the second number is how
 * 17, 4 and 2 came to be three answers to one question.
 *
 * And *finishes* is itself two numbers, because an entry that names one blocker
 * for a spell printing three used to pass every guard. IE-044 gave the
 * undefined map the clause-anchored entry type the executed one always had, so
 * a spell whose paragraph somebody has read sentence by sentence is now
 * distinguishable from one nobody has — and every wrong prediction this map has
 * made was an unread sentence rather than a wrong entry. No figure is written
 * down here: the table below prints all three, which is the whole point.
 */
function renderBlockers(): readonly string[] {
  const rows = allShapeConsumers();
  const lines = [
    '',
    '## What blocks the rest',
    '',
    'Derived from `packages/content/scripts/missing-shapes.ts`, which holds one',
    'missing-shape vocabulary and every spell blocked on it — the executed',
    'definitions carrying a clause they do not finish, the tracked ones, and all',
    'the parsed spells with no definition at all.',
    '',
    '**Blocks** is every spell a shape touches. **Finishes** is the spells it is',
    'the *only* blocker for — the ones building it would complete. Those are',
    'different numbers, and reporting only the first is how one family came to be',
    'ranked three different ways in three different documents.',
    '',
    '**Finishes is split in two**, and that difference is the second finding.',
    '*Read* counts the spells whose SRD paragraph has been read sentence by',
    'sentence — every sentence tripping one of the guard’s mechanical markers',
    'carries a written clause saying which of four things it is. *Unread* counts',
    'the rest, whose entry names a blocker and says nothing about the sentences',
    'beside it. Every wrong prediction this map has made — Mind Blank, Protection',
    'from Energy, Enthrall, Magic Weapon, True Strike — was an unread sentence',
    'rather than a wrong entry, so the first column is what a tranche may be',
    'planned from and the second is what it may be planned from once somebody',
    'reads it.',
    '',
    '*Read* is a **floor, not a proof.** The markers read English, so a rule the',
    'SRD phrases in none of their words trips nothing and is demanded of nobody —',
    'Gaseous Form’s "can enter and occupy the space of another creature" is one,',
    'and is recorded because somebody read the paragraph rather than because the',
    'guard asked. What the column promises is that every sentence the markers can',
    'see has an answer, which is the same promise the tracked bucket’s guard has',
    'always made in the same words.',
    '',
    '| Shape | Blocks | Finishes (read) | Finishes (unread) | Executed | Tracked | Undefined |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    lines.push(
      `| \`${row.shape}\` | ${row.blocks.length} | ${row.unblocksRead.length} | ${row.unblocksUnread.length} | ${row.executed.length} | ${row.tracked.length} | ${row.undefined.length} |`,
    );
  }
  lines.push(
    '',
    'A spell can need more than one shape, so the columns do not sum to the',
    'population. A spell blocked on **nothing** — genuinely the table’s, and the',
    'engine could take it today — is recorded as such rather than omitted.',
  );
  return lines;
}

function render(coverage: SpellCoverage): string {
  const verified = new Set(VERIFIED_SPELLS);
  const partial = new Set(PARTIAL_SPELLS);
  const pct = (n: number) => `${((n / coverage.total) * 100).toFixed(1)}%`;

  const lines: string[] = [
    '# SRD 5.2.1 coverage',
    '',
    '> Generated by `npm run coverage`. Do not edit by hand — edit the script,',
    '> or better, make the number go up.',
    '',
'Five states, and the middle ones are different claims that are never added',
    'together:',
    '',
    '| | Means |',
    '|---|---|',
    '| **Parsed** | `@ie/srd` has the record: id, level, school, class list, prose |',
    '| **Tracked** | the engine casts it for real — action, slot, Concentration, duration — and says what the DM adjudicates |',
    '| **Executed** | a definition whose effects the engine resolves: dice, saves, targets, scaling |',
    '| **Partial** | executed, and one of its `unmodelled` clauses is a rule the engine owns and has not built |',
    '| **Verified** | an integration test drives it end to end through the public API |',
    '',
    'A catalogue entry is not an implementation. Neither is a refusal saying the',
    'spell is unsupported.',
    '',
    '**Partial and verified are different axes**, so a spell can be both: Web is',
    'driven end to end and still leaves its Difficult Terrain unbuilt. Partial is',
    'not a list at all — it is derived from the adjudication map in',
    '`packages/content/scripts/missing-shapes.ts`: a spell is partial because one',
    'of its `unmodelled` clauses is adjudicated to a named missing shape rather',
    'than to the table.',
    '',
    '## Spells',
    '',
    `| Parsed | Tracked | Executed | of which partial | Verified |`,
    `|---|---|---|---|---|`,
    `| ${coverage.total} | ${coverage.tracked} (${pct(coverage.tracked)}) | ${coverage.executed} (${pct(coverage.executed)}) | ${coverage.partial} | ${coverage.verified} (${pct(coverage.verified)}) |`,
    '',
    'A **tracked** spell is not a half-finished executed one. Disguise Self will',
    'never be executed, because what the caster looks like is not arithmetic;',
    'what the engine owes it is the slot, the action, the hour on the clock, and',
    'a plain statement of what the table decides.',
  ];

  const named = (want: 'tracked' | 'executed') =>
    [...SPELL_DEFINITIONS]
      .filter((d) => (TRACKED_IDS.has(d.id) ? 'tracked' : 'executed') === want)
      .sort((a, b) => a.id.localeCompare(b.id));

  lines.push('', '### Executed today', '');
  for (const definition of named('executed')) {
    // Two axes, so both are said: whether a test drives it, and whether it
    // finishes. A verified spell carrying a debt used to print only the tick.
    const driven = verified.has(definition.id) ? 'verified' : 'untested';
    const mark = partial.has(definition.id)
      ? `${driven}, partial — a clause the engine owns is still unbuilt`
      : driven;
    const level = definition.level === 0 ? 'cantrip' : `level ${definition.level}`;
    lines.push(`- **${definition.name}** (${level}) — ${mark}`);
  }

  lines.push('', '### Tracked today', '');
  lines.push('Cast for real; the effect is narrated. Each says what it leaves to the DM.', '');
  for (const definition of named('tracked')) {
    const level = definition.level === 0 ? 'cantrip' : `level ${definition.level}`;
    lines.push(`- **${definition.name}** (${level}) — ${(definition.unmodelled ?? []).length} noted`);
  }

  lines.push(...renderBlockers());
  lines.push(...renderClasses(auditClasses()));
  lines.push(...renderOrigins(auditOrigins()));
  lines.push(...renderMagicItems(auditMagicItems()));

  return `${lines.join('\n')}\n`;
}

/**
 * The whole report as text, measured but not written.
 *
 * Exported so `coverage.test.ts` can hold the text the *next* run would
 * produce to the same rules it holds the committed file to — a prose number
 * introduced here should fail on the commit that introduces it, not one commit
 * later when somebody regenerates. It writes nothing, which is the only thing
 * the sweep in `coverage-script.test.ts` cares about.
 */
export function renderReport(): string {
  return render(auditSpells());
}

/** True when Node was asked to run this file, rather than something importing it. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
  // Two refusals, both before anything is written, because a report is worse
  // than no report when it is wrong. The first: `tsx` resolves `@ie/content`
  // through `dist`, so a build behind its source measures yesterday's
  // catalogue against today's lists. The second: the contradiction that used
  // to be written into the file as a line of prose.
  refuseStaleBuild(dryBuild());
  const found = coverageInconsistencies();
  if (found.length > 0) {
    throw new Error(
      ['COVERAGE.md was not written: the measurement contradicts itself.', ...found].join('\n'),
    );
  }

  const coverage = auditSpells();
  writeFileSync('COVERAGE.md', render(coverage), 'utf8');
  console.log(
    `spells: ${coverage.executed}/${coverage.total} executed, ` +
      `${coverage.tracked} tracked, ${coverage.verified} verified`,
  );
  const classes = auditClasses();
  console.log(
    `classes: ${classes.classes}/12 with ${classes.subclasses} subclasses; ` +
      `${classes.executed}/${classes.features} features executed`,
  );
  const origins = auditOrigins();
  console.log(
    `origins: ${origins.species} species and ${origins.backgrounds} backgrounds; ` +
      `${origins.executed}/${origins.features} features executed`,
  );
  const items = auditMagicItems();
  console.log(
    `magic items: ${items.transcribed}/${items.parsed} entries transcribed as ` +
      `${items.instances} records, ${items.partial} of them partial`,
  );
}
