/**
 * What the engine actually does, measured against the SRD rather than recalled.
 *
 * Three states, kept apart on purpose, because conflating them is how a
 * project believes it is finished:
 *
 * | State | Means |
 * |---|---|
 * | **parsed** | `@ie/srd` has the record: id, level, school, class list, prose |
 * | **executable** | a `SpellDefinition` the engine resolves — dice, saves, targets |
 * | **verified** | an integration test drives it end to end through `resolveSpell` |
 *
 * A catalogue entry is not an implementation, and neither is a refusal that
 * says the spell is unsupported. Only the third column is a claim about
 * behaviour.
 *
 * Every spell is also classified by the *shape* its text needs, because the
 * work is shaped by shapes rather than by spells: one area-of-effect engine
 * unblocks ninety spells, and the next hundred definitions after that are data.
 *
 * Classes are measured the same way and the three states mean the same things,
 * with one difference worth stating: a class *feature* declares its own
 * automation, `engine` or `manual`, so the middle column is not inferred. A
 * manual feature is not a failure — several of them are judgement the engine
 * should never take from a DM — but a project that does not count them will
 * believe it has twelve working classes when it has twelve validated ones.
 *
 * Run with `pnpm run coverage`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { SPELL_DEFINITIONS } from '../src/spell-definitions.js';
import { allClasses, allSubclasses } from '../src/creation.js';

interface ParsedSpell {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly school: string;
  readonly classes: readonly string[];
  readonly castingTime: string;
  readonly ritual: boolean;
  readonly range: string;
  readonly duration: string;
  readonly concentration: boolean;
  readonly description: string;
  readonly higherLevel?: string;
}

/**
 * The mechanical shapes a spell's text can ask for.
 *
 * Ordered by how much machinery each needs, so a spell is filed under the
 * hardest thing it requires: Fireball is an area spell first and a
 * save-for-damage spell second, and it is the area that is missing.
 */
const SHAPES = [
  {
    id: 'summon',
    label: 'Summons and created creatures',
    test: (s: ParsedSpell) =>
      /\bsummon(s|ed|ing)?\b/i.test(s.description) || /\bappears? in an unoccupied space/i.test(s.description),
  },
  {
    id: 'area',
    label: 'Area of effect',
    test: (s: ParsedSpell) =>
      /\b\d+-foot(-radius)?(-tall|-high|-long|-wide)?[- ](Sphere|Cone|Cube|Line|Cylinder|Emanation|Hemisphere)\b/i.test(
        s.description,
      ) || /each creature in (a|the) \w+/i.test(s.description),
  },
  {
    id: 'reaction',
    label: 'Reaction timing',
    test: (s: ParsedSpell) => /^reaction/i.test(s.castingTime),
  },
  {
    id: 'long-casting',
    label: 'Casting time of a minute or more',
    test: (s: ParsedSpell) => /\b(minute|hour)s?\b/i.test(s.castingTime),
  },
  {
    id: 'ongoing',
    label: 'An ongoing effect that acts on later turns',
    test: (s: ParsedSpell) =>
      /\bas a (Bonus Action|Magic action)\b/i.test(s.description) &&
      !/^instantaneous$/i.test(s.duration),
  },
  {
    id: 'attack',
    label: 'Spell attack roll',
    test: (s: ParsedSpell) => /\b(ranged|melee) spell attack\b/i.test(s.description),
  },
  {
    id: 'save-damage',
    label: 'Saving throw for damage',
    test: (s: ParsedSpell) =>
      /saving throw/i.test(s.description) && /\b\d+d\d+\b/.test(s.description) && /damage/i.test(s.description),
  },
  {
    id: 'save-condition',
    label: 'Saving throw for a condition',
    test: (s: ParsedSpell) => /saving throw/i.test(s.description),
  },
  {
    id: 'heal',
    label: 'Restores Hit Points',
    test: (s: ParsedSpell) => /regains? .{0,40}Hit Points/i.test(s.description),
  },
  {
    id: 'temp-hp',
    label: 'Temporary Hit Points',
    test: (s: ParsedSpell) => /Temporary Hit Points/i.test(s.description),
  },
  {
    id: 'buff',
    label: 'A bonus to later rolls',
    test: (s: ParsedSpell) =>
      /\bbonus to\b/i.test(s.description) || /\bAdvantage on\b/i.test(s.description),
  },
  {
    id: 'utility',
    label: 'Narrative or exploration effect',
    test: () => true,
  },
] as const;

const shapeOf = (spell: ParsedSpell): string =>
  SHAPES.find((shape) => shape.test(spell))?.id ?? 'utility';

/**
 * Spells an integration test drives end to end.
 *
 * Listed by hand and asserted by `coverage.test.ts`, so it cannot drift from
 * the tests without something going red — a generated claim about test
 * coverage that nothing checks would be the exact failure this file exists to
 * prevent.
 */
export const VERIFIED_SPELLS: readonly string[] = [
  'acid-splash',
  'animal-friendship',
  'bane',
  'banishment',
  'bless',
  'blight',
  'blindness-deafness',
  'burning-hands',
  'charm-monster',
  'charm-person',
  'chill-touch',
  'circle-of-death',
  'cone-of-cold',
  'cure-wounds',
  'dissonant-whispers',
  'eldritch-blast',
  'false-life',
  'fear',
  'finger-of-death',
  'fire-bolt',
  'fireball',
  'flame-strike',
  'grease',
  'guidance',
  'guiding-bolt',
  'harm',
  'healing-word',
  'hold-monster',
  'hold-person',
  'hypnotic-pattern',
  'ice-storm',
  'inflict-wounds',
  'lightning-bolt',
  'mind-spike',
  'poison-spray',
  'ray-of-frost',
  'ray-of-sickness',
  'sacred-flame',
  'shatter',
  'shocking-grasp',
  'thunderwave',
  'vicious-mockery',
  'vitriolic-sphere',
];

export interface SpellCoverage {
  readonly total: number;
  readonly executable: number;
  readonly verified: number;
  readonly byShape: ReadonlyMap<string, { total: number; executable: number }>;
  readonly spells: readonly ParsedSpell[];
}

export function auditSpells(): SpellCoverage {
  const spells = JSON.parse(
    readFileSync('packages/srd/src/generated/spells.json', 'utf8'),
  ) as ParsedSpell[];
  const executable = new Set(SPELL_DEFINITIONS.map((d) => d.id));

  const byShape = new Map<string, { total: number; executable: number }>();
  for (const shape of SHAPES) byShape.set(shape.id, { total: 0, executable: 0 });

  for (const spell of spells) {
    const bucket = byShape.get(shapeOf(spell));
    if (bucket === undefined) continue;
    bucket.total += 1;
    if (executable.has(spell.id)) bucket.executable += 1;
  }

  return {
    total: spells.length,
    executable: executable.size,
    verified: VERIFIED_SPELLS.length,
    byShape,
    spells,
  };
}

interface ClassCoverage {
  readonly classes: number;
  readonly subclasses: number;
  readonly features: number;
  readonly executed: number;
  readonly rows: readonly {
    readonly name: string;
    readonly style: string;
    readonly features: number;
    readonly executed: number;
  }[];
}

function auditClasses(): ClassCoverage {
  const rows = allClasses().map((definition) => {
    const own = [
      ...definition.features,
      ...allSubclasses()
        .filter((s) => s.classId === definition.id)
        .flatMap((s) => s.features),
    ];
    return {
      name: definition.name,
      style: definition.spellcasting?.style ?? 'none',
      features: own.length,
      executed: own.filter((f) => f.automation === 'engine').length,
    };
  });

  return {
    classes: allClasses().length,
    subclasses: allSubclasses().length,
    features: rows.reduce((sum, r) => sum + r.features, 0),
    executed: rows.reduce((sum, r) => sum + r.executed, 0),
    rows,
  };
}

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

function render(coverage: SpellCoverage): string {
  const executable = new Set(SPELL_DEFINITIONS.map((d) => d.id));
  const verified = new Set(VERIFIED_SPELLS);
  const pct = (n: number) => `${((n / coverage.total) * 100).toFixed(1)}%`;

  const lines: string[] = [
    '# SRD 5.2.1 coverage',
    '',
    '> Generated by `pnpm run coverage`. Do not edit by hand — edit the script,',
    '> or better, make the number go up.',
    '',
    'Three states, and only the third is a claim about behaviour:',
    '',
    '| | Means |',
    '|---|---|',
    '| **Parsed** | `@ie/srd` has the record: id, level, school, class list, prose |',
    '| **Executable** | a definition the engine resolves — dice, saves, targets, scaling |',
    '| **Verified** | an integration test drives it end to end through the public API |',
    '',
    'A catalogue entry is not an implementation. Neither is a refusal saying the',
    'spell is unsupported.',
    '',
    '## Spells',
    '',
    `| Parsed | Executable | Verified |`,
    `|---|---|---|`,
    `| ${coverage.total} | ${coverage.executable} (${pct(coverage.executable)}) | ${coverage.verified} (${pct(coverage.verified)}) |`,
    '',
    '### By mechanical shape',
    '',
    'A spell is filed under the *hardest* thing its text needs, because that is',
    'what blocks it. Fireball is an area spell before it is a save-for-damage',
    'spell, and the area is the part that is missing.',
    '',
    '| Shape | Parsed | Executable | Blocked on |',
    '|---|---|---|---|',
  ];

  const BLOCKERS: Readonly<Record<string, string>> = {
    summon: 'creating a creature from a stat block mid-fight',
    area: '—',
    reaction: 'an interrupt mechanism that can order a cast against its trigger',
    'long-casting': 'a casting-in-progress state machine with a per-turn obligation',
    ongoing: 'an effect that a later turn can act through',
    attack: '—',
    'save-damage': '—',
    'save-condition': '—',
    heal: '—',
    'temp-hp': '—',
    buff: '—',
    utility: 'judgement the engine deliberately leaves to the DM',
  };

  for (const shape of SHAPES) {
    const bucket = coverage.byShape.get(shape.id);
    if (bucket === undefined || bucket.total === 0) continue;
    lines.push(
      `| ${shape.label} | ${bucket.total} | ${bucket.executable} | ${BLOCKERS[shape.id] ?? '—'} |`,
    );
  }

  lines.push('', '### Executable today', '');
  for (const definition of [...SPELL_DEFINITIONS].sort((a, b) => a.id.localeCompare(b.id))) {
    const mark = verified.has(definition.id) ? 'verified' : 'untested';
    const level = definition.level === 0 ? 'cantrip' : `level ${definition.level}`;
    lines.push(`- **${definition.name}** (${level}) — ${mark}`);
  }

  const missing = [...verified].filter((id) => !executable.has(id));
  if (missing.length > 0) {
    lines.push('', `**Inconsistent:** verified but not executable: ${missing.join(', ')}`);
  }

  lines.push(...renderClasses(auditClasses()));

  return `${lines.join('\n')}\n`;
}

const coverage = auditSpells();
writeFileSync('COVERAGE.md', render(coverage), 'utf8');
console.log(
  `spells: ${coverage.executable}/${coverage.total} executable, ${coverage.verified} verified`,
);
const classes = auditClasses();
console.log(
  `classes: ${classes.classes}/12 with ${classes.subclasses} subclasses; ` +
    `${classes.executed}/${classes.features} features executed`,
);
for (const shape of SHAPES) {
  const bucket = coverage.byShape.get(shape.id);
  if (bucket === undefined || bucket.total === 0) continue;
  console.log(`  ${shape.label.padEnd(42)} ${String(bucket.executable).padStart(3)}/${bucket.total}`);
}
