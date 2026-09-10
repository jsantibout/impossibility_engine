import {
  ArmorSchema,
  CurrencySchema,
  WeaponMasterySchema,
  WeaponPropertySchema,
  WeaponSchema,
  slugify,
  type Armor,
  type ParseProblem,
  type Weapon,
  type WeaponProperty,
} from '../schemas.js';

/**
 * Parser for the weapon and armour tables in `raw/equipment.md`.
 *
 * Unlike spells and monsters, equipment is table-driven: a six-column HTML
 * table whose sections are introduced by `<th colspan="6"><em>...</em></th>`
 * rows ("Simple Melee Weapons", "Heavy Armor", and so on).
 *
 * The row markup is unreliable — several rows are missing their `</tr>` and one
 * has a doubled `<tr>` — so cells are read in document order and grouped in
 * sixes rather than trusted to sit inside well-formed rows. Every group is then
 * schema-validated, and the tests assert exact counts, so a shifted column
 * would fail loudly rather than quietly mis-assign every weapon's damage.
 */

const EM_DASH = /^[—–-]$/;

/**
 * Split a comma-separated list without splitting inside parentheses.
 *
 * This is the trap in this file. Weapon properties look like
 * `Ammunition (Range 80/320; Bolt), Loading, Two-Handed`, and a plain
 * `split(',')` turns the first property into two corrupt fragments.
 */
export function splitTopLevel(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === '' || EM_DASH.test(trimmed)) return [];

  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of trimmed) {
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);

    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current.trim());

  return parts.filter((p) => p !== '');
}

export function parseCost(raw: string): { amount: number; currency: string } | null {
  const match = /^([\d,]+(?:\.\d+)?)\s*(CP|SP|EP|GP|PP)$/i.exec(raw.trim());
  if (!match) return null;
  const currency = CurrencySchema.safeParse(match[2]!.toLowerCase());
  if (!currency.success) return null;
  return { amount: Number(match[1]!.replace(/,/g, '')), currency: currency.data };
}

/** `5 lb.` -> 5, `1/4 lb.` -> 0.25, `—` -> null. */
export function parseWeight(raw: string): number | null {
  const trimmed = raw.trim();
  if (EM_DASH.test(trimmed)) return null;

  const fraction = /^(\d+)\s*\/\s*(\d+)\s*lb/i.exec(trimmed);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? null : Number(fraction[1]) / denominator;
  }

  const whole = /^([\d.]+)\s*lb/i.exec(trimmed);
  return whole ? Number(whole[1]) : null;
}

export interface ParsedWeaponProperties {
  properties: WeaponProperty[];
  versatileDamage: string | null;
  thrownRange: { normal: number; long: number } | null;
  ammunitionRange: { normal: number; long: number } | null;
  ammunitionType: string | null;
  propertyNotes: string | null;
}

const parseRange = (raw: string): { normal: number; long: number } | null => {
  const match = /Range\s+(\d+)\s*\/\s*(\d+)/i.exec(raw);
  return match ? { normal: Number(match[1]), long: Number(match[2]) } : null;
};

export function parseWeaponProperties(raw: string): ParsedWeaponProperties {
  const out: ParsedWeaponProperties = {
    properties: [],
    versatileDamage: null,
    thrownRange: null,
    ammunitionRange: null,
    ammunitionType: null,
    propertyNotes: null,
  };

  for (const part of splitTopLevel(raw)) {
    const withArgs = /^([A-Za-z-]+)\s*(?:\(([^)]*)\))?$/.exec(part.trim());
    if (!withArgs) continue;

    const name = withArgs[1]!.toLowerCase();
    const args = withArgs[2]?.trim() ?? null;

    const property = WeaponPropertySchema.safeParse(name);
    if (!property.success) continue;
    out.properties.push(property.data);

    if (args === null) continue;

    switch (property.data) {
      case 'versatile':
        out.versatileDamage = args;
        break;
      case 'thrown':
        out.thrownRange = parseRange(args);
        break;
      case 'ammunition': {
        out.ammunitionRange = parseRange(args);
        // `Range 100/400; Bolt` — the ammunition name follows the semicolon.
        const ammo = args.split(';')[1]?.trim();
        out.ammunitionType = ammo && ammo !== '' ? ammo : null;
        break;
      }
      default:
        // e.g. the Lance's `Two-Handed (unless mounted)`.
        out.propertyNotes = args;
        break;
    }
  }

  return out;
}

/** `1d8 Slashing` or `1 Piercing` (the Blowgun). */
function parseDamage(raw: string): { dice: string | null; fixed: number | null; type: string } | null {
  const match = /^(\d+d\d+|\d+)\s+([A-Za-z]+)$/.exec(raw.trim());
  if (!match) return null;

  const amount = match[1]!;
  const isDice = amount.includes('d');

  return {
    dice: isDice ? amount : null,
    fixed: isDice ? null : Number(amount),
    type: match[2]!.toLowerCase(),
  };
}

export interface ParsedArmorClass {
  baseAc: number | null;
  acBonus: number | null;
  addsDexModifier: boolean;
  maxDexBonus: number | null;
}

/** `11 + Dex modifier`, `14 + Dex modifier (max 2)`, `18`, or a Shield's `+2`. */
export function parseArmor(raw: string): ParsedArmorClass | null {
  const trimmed = raw.trim();

  const bonus = /^\+(\d+)$/.exec(trimmed);
  if (bonus) {
    return { baseAc: null, acBonus: Number(bonus[1]), addsDexModifier: false, maxDexBonus: null };
  }

  const base = /^(\d+)(\s*\+\s*Dex modifier(?:\s*\(max\s*(\d+)\))?)?$/i.exec(trimmed);
  if (!base) return null;

  return {
    baseAc: Number(base[1]),
    acBonus: null,
    addsDexModifier: base[2] !== undefined,
    maxDexBonus: base[3] === undefined ? null : Number(base[3]),
  };
}

interface Section {
  readonly label: string;
  readonly cells: readonly string[];
}

/**
 * Read a table's cells in document order, grouped by the `<th colspan>` section
 * heading they fall under.
 */
function readSections(table: string): Section[] {
  const sections: Section[] = [];
  let label: string | null = null;
  let cells: string[] = [];

  const token = /<th[^>]*colspan[^>]*>([\s\S]*?)<\/th>|<td>([\s\S]*?)<\/td>/g;
  let match: RegExpExecArray | null;

  while ((match = token.exec(table)) !== null) {
    if (match[1] !== undefined) {
      if (label !== null) sections.push({ label, cells });
      label = match[1].replace(/<[^>]+>/g, '').trim();
      cells = [];
    } else if (match[2] !== undefined && label !== null) {
      cells.push(match[2].replace(/<[^>]+>/g, '').trim());
    }
  }
  if (label !== null) sections.push({ label, cells });

  return sections;
}

/** Pull out the table that follows a given `## Heading`. */
function tableUnder(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`).test(l.trim()));
  if (start === -1) return null;

  const open = lines.findIndex((l, i) => i > start && l.trim() === '<table>');
  if (open === -1) return null;

  const close = lines.findIndex((l, i) => i > open && l.trim() === '</table>');
  if (close === -1) return null;

  return lines.slice(open, close + 1).join('\n');
}

const COLUMNS = 6;

export interface EquipmentOutput {
  readonly weapons: readonly Weapon[];
  readonly armor: readonly Armor[];
  readonly problems: readonly ParseProblem[];
}

export function parseEquipment(markdown: string, source: string): EquipmentOutput {
  const weapons: Weapon[] = [];
  const armor: Armor[] = [];
  const problems: ParseProblem[] = [];

  const problem = (entry: string, message: string): void => {
    problems.push({ source, entry, message });
  };

  const weaponTable = tableUnder(markdown, 'Weapons');
  if (weaponTable === null) {
    problem('Weapons', 'could not locate the weapons table');
  } else {
    for (const section of readSections(weaponTable)) {
      // "Simple Melee Weapons" / "Martial Ranged Weapons"
      const heading = /^(Simple|Martial)\s+(Melee|Ranged)\s+Weapons$/i.exec(section.label);
      if (!heading) continue;

      const category = heading[1]!.toLowerCase() as 'simple' | 'martial';
      const kind = heading[2]!.toLowerCase() as 'melee' | 'ranged';

      if (section.cells.length % COLUMNS !== 0) {
        problem(
          section.label,
          `expected a multiple of ${COLUMNS} cells, got ${section.cells.length}`,
        );
        continue;
      }

      for (let i = 0; i < section.cells.length; i += COLUMNS) {
        const [name, damageRaw, propertiesRaw, masteryRaw, weightRaw, costRaw] = section.cells.slice(
          i,
          i + COLUMNS,
        ) as [string, string, string, string, string, string];

        const damage = parseDamage(damageRaw);
        if (damage === null) {
          problem(name, `unparsable damage: "${damageRaw}"`);
          continue;
        }

        const mastery = WeaponMasterySchema.safeParse(masteryRaw.toLowerCase());
        if (!mastery.success) {
          problem(name, `unknown mastery property: "${masteryRaw}"`);
          continue;
        }

        const cost = parseCost(costRaw);
        if (cost === null) {
          problem(name, `unparsable cost: "${costRaw}"`);
          continue;
        }

        const candidate = {
          id: slugify(name),
          name,
          category,
          kind,
          damage,
          ...parseWeaponProperties(propertiesRaw),
          mastery: mastery.data,
          weightLb: parseWeight(weightRaw),
          cost,
        };

        const validated = WeaponSchema.safeParse(candidate);
        if (!validated.success) {
          problem(name, validated.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '));
          continue;
        }
        weapons.push(validated.data);
      }
    }
  }

  const armorTable = tableUnder(markdown, 'Armor');
  if (armorTable === null) {
    problem('Armor', 'could not locate the armor table');
  } else {
    for (const section of readSections(armorTable)) {
      // "Light Armor (1 Minute to Don or Doff)" / "Shield (Utilize Action ...)"
      const heading = /^(Light|Medium|Heavy|Shield)\b/i.exec(section.label);
      if (!heading) continue;

      const category = heading[1]!.toLowerCase() as Armor['category'];

      if (section.cells.length % COLUMNS !== 0) {
        problem(
          section.label,
          `expected a multiple of ${COLUMNS} cells, got ${section.cells.length}`,
        );
        continue;
      }

      for (let i = 0; i < section.cells.length; i += COLUMNS) {
        const [name, acRaw, strengthRaw, stealthRaw, weightRaw, costRaw] = section.cells.slice(
          i,
          i + COLUMNS,
        ) as [string, string, string, string, string, string];

        const ac = parseArmor(acRaw);
        if (ac === null) {
          problem(name, `unparsable armor class: "${acRaw}"`);
          continue;
        }

        const cost = parseCost(costRaw);
        if (cost === null) {
          problem(name, `unparsable cost: "${costRaw}"`);
          continue;
        }

        const strength = /Str\s*(\d+)/i.exec(strengthRaw);

        const candidate = {
          id: slugify(name),
          name,
          category,
          ...ac,
          strengthRequirement: strength ? Number(strength[1]) : null,
          stealthDisadvantage: /disadvantage/i.test(stealthRaw),
          weightLb: parseWeight(weightRaw),
          cost,
        };

        const validated = ArmorSchema.safeParse(candidate);
        if (!validated.success) {
          problem(name, validated.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '));
          continue;
        }
        armor.push(validated.data);
      }
    }
  }

  return { weapons, armor, problems };
}
