import {
  CreatureSizeSchema,
  MonsterSchema,
  slugify,
  type Feature,
  type Monster,
  type ParseOutput,
  type ParseProblem,
} from '../schemas.js';
import { ABILITY_OVERRIDES } from './overrides.js';

/**
 * Parser for `raw/monsters-A-Z.md` and `raw/animals.md`.
 *
 * A stat block is a `###` heading followed by a `_Size Type (Tag), Alignment_`
 * line, the defence lines, an HTML ability table, the trait lines, and then
 * `####` sections for Traits, Actions, Bonus Actions, Reactions and Legendary
 * Actions.
 *
 * `##` headings group related creatures ("Goblins") and are not stat blocks.
 */

/**
 * The source writes negative numbers with U+2212 MINUS SIGN, not a hyphen —
 * 498 of the modifier cells in `monsters-A-Z.md`, against 20 that use ASCII.
 * `parseInt('−1')` is `NaN`, so every negative modifier would silently become
 * nothing without this. Exported because it is worth testing directly.
 */
export function parseSignedNumber(raw: string): number | null {
  const normalised = raw
    .trim()
    .replace(/[−–—]/g, '-')
    .replace(/^\+/, '');
  if (!/^-?\d+$/.test(normalised)) return null;
  return Number(normalised);
}

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;

const SIZE_WORD = '(?:Tiny|Small|Medium|Large|Huge|Gargantuan)';

/**
 * The descriptor line, in three shapes the source actually uses:
 *
 *   `_Small Fey (Goblinoid), Chaotic Neutral_`
 *   `_Medium or Small Humanoid, Neutral_`          (30-odd entries)
 *   `_Medium Swarm of Tiny Undead, Neutral Evil_`  (swarms)
 *
 * Split descriptor from alignment on the last comma, then pick the descriptor
 * apart — alignments never contain commas, but type tags can.
 */
const TYPE_LINE = new RegExp(`^_(.+),\\s*([^,]+?)_$`);
const DESCRIPTOR = new RegExp(
  `^(${SIZE_WORD}(?:\\s+or\\s+${SIZE_WORD})*)\\s+(.+?)(?:\\s*\\(([^)]*)\\))?$`,
);
const SWARM = new RegExp(`^Swarm\\s+of\\s+(${SIZE_WORD})\\s+(.+)$`, 'i');
const AC_LINE = /\*\*AC\*\*\s*(\d+)/;
const INITIATIVE = /\*\*Initiative\*\*\s*([+−-]?\d+)/;
const HP_LINE = /\*\*HP\*\*\s*([\d,]+)\s*(?:\(([^)]*)\))?/;
const SPEED_LINE = /\*\*Speed\*\*\s*([^<]*)/;
/**
 * `**CR** 1/8 (XP 25; PB +2)`, and two variants that a narrower pattern
 * silently swallowed: legendary creatures carry a lair value
 * (`XP 5,900, or 7,200 in lair`), and a handful put XP after the number
 * (`450 XP`). Everything up to the semicolon is skipped rather than matched,
 * so a third variant will not break this again.
 */
const CR_LINE =
  /\*\*CR\*\*\s*([\d/]+)\s*\(\s*(?:XP\s*([\d,]+)|([\d,]+)\s*XP)[^;)]*;\s*PB\s*([+−-]?\d+)\s*\)/;
const FIELD_LINE = /\*\*([A-Za-z]+)\*\*\s*([^<]*)/;
/** `**_Nimble Escape._** The goblin takes...` */
const FEATURE_LINE = /^\*\*_(.+?)\._\*\*\s*(.*)$/;

const SECTIONS = {
  Traits: 'traits',
  Actions: 'actions',
  'Bonus Actions': 'bonusActions',
  Reactions: 'reactions',
  'Legendary Actions': 'legendaryActions',
} as const;
type SectionKey = (typeof SECTIONS)[keyof typeof SECTIONS];

const MOVEMENT_MODES = ['burrow', 'climb', 'fly', 'swim'] as const;

function parseSpeed(raw: string): {
  walk: number;
  burrow: number | null;
  climb: number | null;
  fly: number | null;
  swim: number | null;
  hover: boolean;
} {
  const speed = {
    walk: 0,
    burrow: null as number | null,
    climb: null as number | null,
    fly: null as number | null,
    swim: null as number | null,
    hover: /\(hover\)/i.test(raw),
  };

  for (const part of raw.split(',')) {
    const segment = part.trim();
    const named = /^([A-Za-z]+)\s+(\d+)\s*ft/i.exec(segment);
    if (named) {
      const mode = named[1]!.toLowerCase();
      const value = Number(named[2]);
      const known = MOVEMENT_MODES.find((m) => m === mode);
      if (known) speed[known] = value;
      continue;
    }
    // A bare "30 ft." with no mode name is the walking speed.
    const bare = /^(\d+)\s*ft/i.exec(segment);
    if (bare) speed.walk = Number(bare[1]);
  }

  return speed;
}

/** `1/8` -> `0.125`. */
function parseChallengeRating(label: string): number | null {
  const fraction = /^(\d+)\/(\d+)$/.exec(label);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return Number(fraction[1]) / denominator;
  }
  return /^\d+$/.test(label) ? Number(label) : null;
}

/** Split on commas and semicolons: `Poison; Charmed, Frightened`. */
const splitList = (raw: string): string[] =>
  raw
    .split(/[;,]/)
    .map((s) => s.replace(/<br>/g, '').trim())
    .filter((s) => s.length > 0);

function parseAbilities(block: string): Record<string, { score: number; modifier: number; save: number }> | null {
  const abbrs = { STR: 'str', DEX: 'dex', CON: 'con', INT: 'int', WIS: 'wis', CHA: 'cha' } as const;
  const out: Record<string, { score: number; modifier: number; save: number }> = {};

  for (const [abbr, key] of Object.entries(abbrs)) {
    // Anchor on the ability label so row layout does not matter.
    const pattern = new RegExp(
      `<strong>${abbr}</strong>\\s*</td>\\s*<td>([^<]*)</td>\\s*<td>([^<]*)</td>\\s*<td>([^<]*)</td>`,
      'i',
    );
    const match = pattern.exec(block);
    if (!match) return null;

    const score = parseSignedNumber(match[1]!);
    const modifier = parseSignedNumber(match[2]!);
    const save = parseSignedNumber(match[3]!);
    if (score === null || modifier === null || save === null) return null;

    out[key] = { score, modifier, save };
  }

  return out;
}

function parseFeatures(lines: readonly string[]): Feature[] {
  const features: Feature[] = [];
  let current: { name: string; text: string[] } | null = null;

  const flush = () => {
    if (current === null) return;
    const text = current.text.join('\n').trim();
    if (text !== '') features.push({ name: current.name, text });
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '<hr>' || trimmed === '') {
      if (current !== null) current.text.push('');
      continue;
    }
    const feature = FEATURE_LINE.exec(trimmed);
    if (feature) {
      flush();
      current = { name: feature[1]!.trim(), text: [feature[2]!] };
    } else if (current !== null) {
      current.text.push(trimmed);
    }
  }
  flush();

  return features;
}

interface RawEntry {
  readonly name: string;
  readonly lines: readonly string[];
}

/**
 * Work out which heading level holds stat blocks.
 *
 * The two bestiary files disagree. `monsters-A-Z.md` uses `##` for groups
 * ("Goblins"), `###` for creatures and `####` for sections; `animals.md` shifts
 * everything up a level — `##` for creatures, `###` for sections. Hard-coding
 * `###` silently yielded zero animals, so detect it instead: the entry level is
 * whichever level is followed by a descriptor line before the next heading.
 */
export function detectEntryLevel(markdown: string): number {
  const lines = markdown.split(/\r?\n/);
  const hits = new Map<number, number>();

  for (let i = 0; i < lines.length; i++) {
    const heading = HEADING.exec(lines[i]!);
    if (!heading) continue;

    // Stop at the next heading, so a group heading gets no credit for the
    // descriptor belonging to a creature nested beneath it.
    for (let j = i + 1; j < lines.length && !HEADING.test(lines[j]!); j++) {
      if (TYPE_LINE.test(lines[j]!.trim())) {
        const level = heading[1]!.length;
        hits.set(level, (hits.get(level) ?? 0) + 1);
        break;
      }
    }
  }

  let best = 3;
  let bestCount = 0;
  for (const [level, count] of hits) {
    if (count > bestCount) {
      best = level;
      bestCount = count;
    }
  }
  return best;
}

/** Split into stat blocks at `entryLevel`, ignoring shallower group headings. */
function splitEntries(markdown: string, entryLevel: number): RawEntry[] {
  const entries: RawEntry[] = [];
  let name: string | null = null;
  let lines: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    // Deeper headings are sections *inside* a stat block; they do not end it.
    if (heading && heading[1]!.length <= entryLevel) {
      if (name !== null) entries.push({ name, lines });
      name = heading[1]!.length === entryLevel ? heading[2]! : null;
      lines = [];
      continue;
    }
    if (name !== null) lines.push(line);
  }
  if (name !== null) entries.push({ name, lines });

  return entries;
}

function parseEntry(
  entry: RawEntry,
  source: string,
  sectionLevel: number,
): { monster: Monster } | { problem: ParseProblem } | null {
  const lines = entry.lines;
  const body = lines.join('\n');

  const typeIndex = lines.findIndex((l) => TYPE_LINE.test(l.trim()));
  // A `###` heading with no type line is a section of prose, not a stat block.
  if (typeIndex === -1) return null;

  const problem = (message: string): { problem: ParseProblem } => ({
    problem: { source, entry: entry.name, message },
  });

  const [, descriptorRaw, alignmentRaw] = TYPE_LINE.exec(lines[typeIndex]!.trim())!;

  const descriptor = DESCRIPTOR.exec(descriptorRaw!.trim());
  if (!descriptor) return problem(`unparsable descriptor: "${descriptorRaw}"`);

  const [, sizesRaw, typePhrase, subtype] = descriptor;
  const alignment = alignmentRaw!;

  const sizes = sizesRaw!.split(/\s+or\s+/i).map((s) => CreatureSizeSchema.safeParse(s.toLowerCase()));
  const badSize = sizes.find((s) => !s.success);
  if (badSize && !badSize.success) return problem(`unknown creature size in "${sizesRaw}"`);
  const parsedSizes = sizes.flatMap((s) => (s.success ? [s.data] : []));
  const size = parsedSizes[0]!;

  // `Swarm of Tiny Undead` -> type Undead, member size tiny.
  const swarm = SWARM.exec(typePhrase!.trim());
  const swarmMember = swarm ? CreatureSizeSchema.safeParse(swarm[1]!.toLowerCase()) : null;
  const type = swarm ? swarm[2]!.trim() : typePhrase!.trim();

  const acMatch = AC_LINE.exec(body);
  if (!acMatch) return problem('missing AC');

  // 234 of 235 stat blocks put Initiative inline on the AC line; the Succubus
  // puts it on its own line after CR. Search the whole block rather than the
  // AC line, so both shapes work.
  const initiativeMatch = INITIATIVE.exec(body);
  const initiative = initiativeMatch ? parseSignedNumber(initiativeMatch[1]!) : null;
  if (initiative === null) return problem('missing or unparsable Initiative');

  const hpMatch = HP_LINE.exec(body);
  if (!hpMatch) return problem('missing HP');
  const average = Number(hpMatch[1]!.replace(/,/g, ''));

  const speedMatch = SPEED_LINE.exec(body);
  if (!speedMatch) return problem('missing Speed');

  const id = slugify(entry.name);

  // Three stat blocks have collapsed cell boundaries upstream. Rather than
  // guess at a mangled table — a silently wrong modifier is the worst failure
  // mode a rules engine has — the parser stays strict and takes corrected
  // values from the official PDF. See overrides.ts.
  const abilities = parseAbilities(body) ?? ABILITY_OVERRIDES[id] ?? null;
  if (abilities === null) return problem('missing or unparsable ability score table');

  const crMatch = CR_LINE.exec(body);
  if (!crMatch) return problem('missing or unparsable CR line');
  const crLabel = crMatch[1]!;
  const cr = parseChallengeRating(crLabel);
  if (cr === null) return problem(`unparsable challenge rating: "${crLabel}"`);

  // Neither of these defaults to anything. A proficiency bonus quietly falling
  // back to +2 is how thirty-two legendary creatures ended up with the
  // proficiency of a goblin.
  const xpText = crMatch[2] ?? crMatch[3];
  if (xpText === undefined) return problem('CR line states no XP');
  const proficiencyBonus = parseSignedNumber(crMatch[4]!);
  if (proficiencyBonus === null) return problem('CR line states no proficiency bonus');

  // Optional single-line fields.
  const fields = new Map<string, string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('**')) continue;
    const field = FIELD_LINE.exec(trimmed);
    if (field) fields.set(field[1]!.toLowerCase(), field[2]!.trim());
  }

  const skills: Record<string, number> = {};
  for (const item of splitList(fields.get('skills') ?? '')) {
    const skill = /^(.+?)\s*([+−-]?\d+)$/.exec(item);
    if (!skill) continue;
    const bonus = parseSignedNumber(skill[2]!);
    if (bonus !== null) skills[slugify(skill[1]!)] = bonus;
  }

  const sensesRaw = fields.get('senses') ?? '';
  const passiveMatch = /Passive Perception\s*(\d+)/i.exec(sensesRaw);
  const senses = splitList(sensesRaw).filter((s) => !/^Passive Perception/i.test(s));

  // Sections: everything after a `#### <Section>` heading.
  const sections: Record<SectionKey, string[]> = {
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendaryActions: [],
  };
  const sectionHeading = new RegExp(`^#{${sectionLevel}}\\s+(.+?)\\s*$`);
  let currentSection: SectionKey | null = null;
  for (const line of lines) {
    const heading = sectionHeading.exec(line);
    if (heading) {
      const key = SECTIONS[heading[1]!.trim() as keyof typeof SECTIONS];
      currentSection = key ?? null;
      continue;
    }
    if (currentSection !== null) sections[currentSection].push(line);
  }

  const monster = {
    id,
    name: entry.name,
    size,
    alternateSizes: parsedSizes.slice(1),
    type,
    subtype: subtype?.trim() ?? null,
    swarmMemberSize: swarmMember?.success ? swarmMember.data : null,
    alignment: alignment.trim(),

    ac: Number(acMatch[1]),
    initiative,
    hp: { average, formula: hpMatch[2]?.trim() ?? null },
    speed: parseSpeed(speedMatch[1]!),
    abilities,

    skills,
    vulnerabilities: splitList(fields.get('vulnerabilities') ?? ''),
    resistances: splitList(fields.get('resistances') ?? ''),
    immunities: splitList(fields.get('immunities') ?? ''),
    gear: splitList(fields.get('gear') ?? ''),

    senses,
    passivePerception: passiveMatch ? Number(passiveMatch[1]) : 10,
    languages: splitList(fields.get('languages') ?? ''),

    cr,
    crLabel,
    xp: Number(xpText.replace(/,/g, '')),
    proficiencyBonus,

    traits: parseFeatures(sections.traits),
    actions: parseFeatures(sections.actions),
    bonusActions: parseFeatures(sections.bonusActions),
    reactions: parseFeatures(sections.reactions),
    legendaryActions: parseFeatures(sections.legendaryActions),
  };

  const validated = MonsterSchema.safeParse(monster);
  if (!validated.success) {
    return problem(validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }

  return { monster: validated.data };
}

export function parseMonsters(markdown: string, source: string): ParseOutput<Monster> {
  const items: Monster[] = [];
  const problems: ParseProblem[] = [];

  const entryLevel = detectEntryLevel(markdown);

  for (const entry of splitEntries(markdown, entryLevel)) {
    const result = parseEntry(entry, source, entryLevel + 1);
    if (result === null) continue;
    if ('problem' in result) problems.push(result.problem);
    else items.push(result.monster);
  }

  return { items, problems };
}
