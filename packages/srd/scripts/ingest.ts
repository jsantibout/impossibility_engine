import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEquipment } from '../src/parse/equipment.js';
import { parseMonsters } from '../src/parse/monsters.js';
import { parseSpells } from '../src/parse/spells.js';
import type { ParseProblem } from '../src/schemas.js';

/**
 * Parse the vendored SRD markdown into JSON, and fail loudly if it does not
 * come out whole.
 *
 * The parsers run inside the test suite already, so this exists for two other
 * reasons: to write the parsed data to disk for anything that would rather read
 * JSON than re-parse 1.9MB of markdown, and to give re-vendoring a single
 * command that reports what broke.
 *
 * It asserts counts rather than only the absence of problems. A parser that
 * silently skips everything reports no problems at all, which is exactly how
 * `animals.md` once yielded zero creatures.
 */

const here = dirname(fileURLToPath(import.meta.url));
const raw = (file: string) => readFileSync(join(here, '..', 'raw', file), 'utf8');
const outDir = join(here, '..', 'src', 'generated');

/** What each source must yield. A shortfall is a parser regression. */
const EXPECTED = {
  spells: 339,
  monsters: 235,
  animals: 95,
  weapons: 38,
  armor: 13,
} as const;

function report(label: string, count: number, expected: number, problems: readonly ParseProblem[]): string[] {
  const failures: string[] = [];

  for (const problem of problems) {
    failures.push(`${label}: ${problem.entry} — ${problem.message}`);
  }
  if (count !== expected) {
    failures.push(`${label}: parsed ${count}, expected ${expected}`);
  }

  process.stdout.write(`${label.padEnd(10)} ${String(count).padStart(4)}  ${count === expected && problems.length === 0 ? 'ok' : 'FAILED'}\n`);
  return failures;
}

const spells = parseSpells(raw('spells.md'), 'spells.md');
const monsters = parseMonsters(raw('monsters-A-Z.md'), 'monsters-A-Z.md');
const animals = parseMonsters(raw('animals.md'), 'animals.md');
const equipment = parseEquipment(raw('equipment.md'), 'equipment.md');

const failures = [
  ...report('spells', spells.items.length, EXPECTED.spells, spells.problems),
  ...report('monsters', monsters.items.length, EXPECTED.monsters, monsters.problems),
  ...report('animals', animals.items.length, EXPECTED.animals, animals.problems),
  ...report('weapons', equipment.weapons.length, EXPECTED.weapons, equipment.problems),
  ...report('armor', equipment.armor.length, EXPECTED.armor, []),
];

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} problem(s):\n${failures.map((f) => `  ${f}`).join('\n')}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown): void => {
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

write('spells', spells.items);
write('monsters', [...monsters.items, ...animals.items]);
write('weapons', equipment.weapons);
write('armor', equipment.armor);

process.stdout.write(`\nwrote JSON to ${outDir}\n`);
