import {
  SpellSchema,
  SpellSchoolSchema,
  slugify,
  type ParseOutput,
  type ParseProblem,
  type Spell,
  type SpellComponents,
} from '../schemas.js';

/**
 * Parser for `raw/spells.md`.
 *
 * Entries look like:
 *
 * ```
 * #### Fireball
 *
 * _Level 3 Evocation (Sorcerer, Wizard)_
 *
 * **Casting Time:** Action
 * **Range:** 150 feet
 * **Components:** V, S, M (a ball of bat guano and sulfur)
 * **Duration:** Instantaneous
 *
 * <description>
 *
 * _Using a Higher-Level Spell Slot._ <upcast text>
 * ```
 *
 * The same file also carries explanatory prose under `####` headings, so a
 * heading only counts as a spell if it is followed by a school/level line.
 */

/** `_Level 3 Evocation (Sorcerer, Wizard)_` or `_Evocation Cantrip (Wizard)_`. */
const SCHOOL_LINE =
  /^_(?:Level\s+(\d)\s+([A-Za-z]+)|([A-Za-z]+)\s+Cantrip)\s*(?:\(([^)]*)\))?_$/;

const FIELD_LINE = /^\*\*([A-Za-z\s-]+):\*\*\s*(.+)$/;

/**
 * The source is inconsistent about one label: 327 spells use `**Components:**`
 * and 12 use the singular `**Component:**` (Guidance, Jump, Power Word Kill and
 * nine others), including spells that plainly have more than one component.
 * Normalise rather than special-case, so a future re-vendor of the upstream
 * markdown does not resurrect the bug.
 */
const FIELD_ALIASES: Readonly<Record<string, string>> = {
  component: 'components',
};
const HIGHER_LEVEL = /^_Using a Higher-Level Spell Slot\._\s*(.*)$/;
const HEADING = /^####\s+(.+?)\s*$/;

function parseComponents(raw: string): SpellComponents {
  // e.g. "V, S, M (a ball of bat guano and sulfur)"
  const materialMatch = /\bM\b\s*\(([^)]*)\)/.exec(raw);
  const withoutMaterialText = raw.replace(/\([^)]*\)/g, '');
  const flags = withoutMaterialText.split(',').map((s) => s.trim().toUpperCase());

  return {
    verbal: flags.includes('V'),
    somatic: flags.includes('S'),
    material: flags.includes('M'),
    materialDescription: materialMatch?.[1]?.trim() ?? null,
  };
}

interface RawEntry {
  readonly name: string;
  readonly lines: readonly string[];
}

/** Split the document into `#### Heading` blocks. */
function splitEntries(markdown: string): RawEntry[] {
  const entries: RawEntry[] = [];
  let name: string | null = null;
  let lines: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      if (name !== null) entries.push({ name, lines });
      name = heading[1]!;
      lines = [];
    } else if (name !== null) {
      lines.push(line);
    }
  }
  if (name !== null) entries.push({ name, lines });

  return entries;
}

function parseEntry(
  entry: RawEntry,
  source: string,
): { spell: Spell } | { problem: ParseProblem } | null {
  const lines = entry.lines;

  const schoolIndex = lines.findIndex((l) => SCHOOL_LINE.test(l.trim()));
  // Prose sections under #### headings have no school line. They are not
  // malformed spells, they simply are not spells — skip them silently.
  if (schoolIndex === -1) return null;

  const problem = (message: string): { problem: ParseProblem } => ({
    problem: { source, entry: entry.name, message },
  });

  const schoolMatch = SCHOOL_LINE.exec(lines[schoolIndex]!.trim())!;
  const [, levelDigits, levelledSchool, cantripSchool, classList] = schoolMatch;

  const level = levelDigits === undefined ? 0 : Number(levelDigits);
  const schoolRaw = (levelledSchool ?? cantripSchool ?? '').toLowerCase();

  const school = SpellSchoolSchema.safeParse(schoolRaw);
  if (!school.success) {
    return problem(`unknown school of magic: "${schoolRaw}"`);
  }

  const classes = (classList ?? '')
    .split(',')
    .map((c) => slugify(c))
    .filter((c) => c.length > 0);

  const fields = new Map<string, string>();
  let bodyStart = schoolIndex + 1;
  for (let i = schoolIndex + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    const field = FIELD_LINE.exec(line);
    if (!field) {
      bodyStart = i;
      break;
    }
    const label = field[1]!.trim().toLowerCase();
    fields.set(FIELD_ALIASES[label] ?? label, field[2]!.trim());
    bodyStart = i + 1;
  }

  const castingTime = fields.get('casting time');
  const range = fields.get('range');
  const duration = fields.get('duration');
  const components = fields.get('components');

  for (const [label, value] of [
    ['Casting Time', castingTime],
    ['Range', range],
    ['Duration', duration],
    ['Components', components],
  ] as const) {
    if (value === undefined) return problem(`missing "${label}" field`);
  }

  // Body: everything after the fields, minus the upcast clause.
  const bodyLines: string[] = [];
  let higherLevel: string | null = null;

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i]!;
    const upcast = HIGHER_LEVEL.exec(line.trim());
    if (upcast) {
      higherLevel = [upcast[1]!, ...lines.slice(i + 1)].join('\n').trim();
      break;
    }
    bodyLines.push(line);
  }

  const description = bodyLines.join('\n').trim();
  if (description === '') return problem('empty description');

  const spell = {
    id: slugify(entry.name),
    name: entry.name,
    level,
    school: school.data,
    classes,
    castingTime: castingTime!,
    ritual: /\bRitual\b/.test(castingTime!),
    range: range!,
    components: parseComponents(components!),
    duration: duration!,
    concentration: /\bConcentration\b/.test(duration!),
    description,
    higherLevel: higherLevel === '' ? null : higherLevel,
  };

  const validated = SpellSchema.safeParse(spell);
  if (!validated.success) {
    return problem(validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }

  return { spell: validated.data };
}

export function parseSpells(markdown: string, source: string): ParseOutput<Spell> {
  const items: Spell[] = [];
  const problems: ParseProblem[] = [];

  for (const entry of splitEntries(markdown)) {
    const result = parseEntry(entry, source);
    if (result === null) continue;
    if ('problem' in result) problems.push(result.problem);
    else items.push(result.spell);
  }

  return { items, problems };
}
