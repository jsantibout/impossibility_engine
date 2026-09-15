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
 * Run with `npm run coverage`.
 */

import { writeFileSync } from 'node:fs';
import { SPELL_DEFINITIONS } from '@ie/content';
import { pathToFileURL } from 'node:url';
import { allShapeConsumers } from './missing-shapes.js';
import {
  auditClasses,
  auditSpells,
  PARTIAL_SPELLS,
  TRACKED_IDS,
  VERIFIED_SPELLS,
  type ClassCoverage,
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
    'ranked at 17, at 4 and at 2 in three different documents.',
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
  const defined = new Set(SPELL_DEFINITIONS.map((d) => d.id));
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

  const missing = [...verified].filter((id) => !defined.has(id));
  if (missing.length > 0) {
    lines.push('', `**Inconsistent:** verified but not executable: ${missing.join(', ')}`);
  }

  lines.push(...renderBlockers());
  lines.push(...renderClasses(auditClasses()));

  return `${lines.join('\n')}\n`;
}

/** True when Node was asked to run this file, rather than something importing it. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
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
}
