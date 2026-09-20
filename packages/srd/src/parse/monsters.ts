import {
  CreatureSizeSchema,
  MonsterAttackSchema,
  MonsterSchema,
  slugify,
  type Feature,
  type Monster,
  type MonsterAttack,
  type MonsterDamage,
  type MonsterMultiattack,
  type MonsterRecharge,
  type MonsterTrait,
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

/**
 * The thirteen damage types the book prints, which is also the whole of what
 * the bestiary's attack lines use.
 *
 * Transcribed here rather than imported so `schemas.ts` stays the leaf the
 * engine buys its shapes from. A word this list does not hold is not a damage
 * type, and the line it appears in stays prose rather than becoming an attack
 * that deals damage of a type nothing downstream knows.
 */
const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;

/**
 * `_Melee Attack Roll:_ +4` and its two typographic variants.
 *
 * The bonus may be followed by "to hit" (one block) and by a parenthesised
 * qualification the engine cannot evaluate — "(with Advantage if the target is
 * Grappled by the ankheg)", nine blocks. The qualification is captured rather
 * than skipped: dropping it would take Advantage away from an attack the book
 * grants it to, silently, which is the class of failure this repository calls
 * its worst.
 */
const ATTACK_HEAD =
  /^_(Melee|Ranged|Melee or Ranged) Attack Roll:_\s*([+−–-]?\d+)(?:\s+to hit)?\s*(?:\(([^)]*)\))?\s*,\s*([\s\S]*)$/;

/**
 * `reach 5 ft.` — and `reach 5 feet`, which the Djinni's Storm Blade, the
 * Eagle's Talons and the Giant Rat's Bite print instead, as the Djinni's Storm
 * Bolt does with its range. Both spellings are the book's; requiring the
 * abbreviation left those lines unread and their creatures swinging at
 * nothing.
 */
const REACH = /reach\s+(\d+)\s*(?:ft|feet)/i;
const RANGE = /range\s+(\d+)(?:\/(\d+))?\s*(?:ft|feet)/i;

/** `5 (1d6 + 2) Piercing damage`, and the flat `1 Bludgeoning damage`. */
const ROLLED_DAMAGE = /^\s*(\d+)\s*\((\d+)d(\d+)(?:\s*([+−–-])\s*(\d+))?\)\s+([A-Za-z]+)\s+damage/;
const FLAT_DAMAGE = /^\s*(\d+)\s+([A-Za-z]+)\s+damage/;

/**
 * A component that is only dealt sometimes — and therefore is not a component.
 *
 * SRD Goblin Warrior: "5 (1d6 + 2) Slashing damage, plus 2 (1d4) Slashing
 * damage **if the attack roll had Advantage**." Read as a second component
 * that goblin deals 1d4 extra on every hit it ever makes. The condition is
 * attached to the damage it follows with no sentence between them, which is
 * what this recognises: a full stop before the clause makes it a rider on the
 * attack instead, and riders are kept as prose.
 */
const CONDITIONAL = /^\s+(?:if|unless|when|while)\b/i;

/** `, plus` and ` plus` — the only continuation that adds damage. */
const PLUS = /^\s*(?:,\s*)?plus\s+/;

/**
 * Two lines whose markup the source got wrong, corrected the way
 * `overrides.ts` corrects three ability tables: by naming the exact string.
 *
 * `Melee or _Ranged Attack Roll:_` opens its italics one word late (the
 * werebear and the wereboar). Left alone, two attacks stay prose for a
 * misplaced underscore.
 */
const normaliseAttackMarkup = (text: string): string =>
  text.replace(/^Melee or _Ranged Attack Roll:_/, '_Melee or Ranged Attack Roll:_');

/**
 * The numbers in a printed attack line, or null where there are none to read.
 *
 * **Null is the ordinary answer and the safe one.** Multiattack, a breath
 * weapon, a trait's sentence and anything written in a shape this does not
 * recognise all return it, and the line stays what every line used to be: a
 * name and the book's English. Nothing here guesses at a number.
 *
 * What it reads is the template the 2024 stat blocks are written to — the kind
 * of attack, the bonus, the reach or the range, and the damage components the
 * `_Hit:_` clause chains with "plus". What it stops at is the first thing that
 * is not one of those: an alternative damage ("or 18 (4d6 + 4) if the chimera
 * had Advantage"), a condition the hit imposes, a save the hit buys. All of it
 * comes back in `rider`, verbatim, for the command to report and a DM to
 * apply.
 */
export function parseAttackLine(text: string): MonsterAttack | null {
  const normalised = normaliseAttackMarkup(text.trim());
  const [head, ...afterHit] = normalised.split(/_Hit:_/);
  if (head === undefined || afterHit.length === 0) return null;

  const opening = ATTACK_HEAD.exec(head.trim());
  if (opening === null) return null;

  const [, kindWord, bonusRaw, qualification, where] = opening;
  const modifier = parseSignedNumber(bonusRaw!);
  if (modifier === null) return null;

  const kind =
    kindWord === 'Melee' ? 'melee' : kindWord === 'Ranged' ? 'ranged' : 'melee-or-ranged';

  const reachMatch = REACH.exec(where!);
  const rangeMatch = RANGE.exec(where!);
  const reach = reachMatch === null ? null : Number(reachMatch[1]);
  // "range 120 ft." with no second number is a spell-like attack whose normal
  // range is its long one — the Lich's Eldritch Burst and the Mage's Arcane
  // Burst. Treating the absent half as zero would put every such attack beyond
  // its own long range.
  const range =
    rangeMatch === null
      ? null
      : { normal: Number(rangeMatch[1]), long: Number(rangeMatch[2] ?? rangeMatch[1]) };

  // A melee attack with no reach and a ranged one with no range are lines this
  // did not understand, whatever else it matched.
  if (kind !== 'ranged' && reach === null) return null;
  if (kind !== 'melee' && range === null) return null;

  const { damage, rest } = parseDamageChain(afterHit.join('_Hit:_'));
  if (damage.length === 0) return null;

  const qualified = qualification?.trim() ?? '';

  const attack = {
    kind,
    modifier,
    reach,
    range,
    damage,
    qualification: qualified === '' ? null : qualified,
    rider: rest === '' ? null : rest,
  };

  // Validated here rather than trusted: this is the one place in the parser
  // that reads a rule out of a sentence, and a shape that does not satisfy its
  // own schema must leave the line as prose rather than reach the catalogue.
  const checked = MonsterAttackSchema.safeParse(attack);
  return checked.success ? checked.data : null;
}

/**
 * The damage the `_Hit:_` clause deals, and everything after it.
 *
 * The chain runs while the book says "plus" and the component it introduces
 * carries no condition of its own. Everything from the first thing that is
 * neither is `rest` — including a "plus" the chain refused, so nothing is lost
 * on the way out.
 */
function parseDamageChain(hit: string): {
  readonly damage: readonly MonsterDamage[];
  readonly rest: string;
} {
  const damage: MonsterDamage[] = [];
  let rest = hit;
  // Where to go back to if the component about to be read turns out to be
  // conditional: the text *including* the "plus" that introduced it, so the
  // book's own connective goes into the rider with the clause it belongs to.
  let resume = hit;

  for (;;) {
    const rolled = ROLLED_DAMAGE.exec(rest);
    const flat = rolled === null ? FLAT_DAMAGE.exec(rest) : null;
    const match = rolled ?? flat;
    if (match === null) break;

    const type = (rolled === null ? match[2]! : match[6]!).toLowerCase();
    if (!DAMAGE_TYPES.some((known) => known === type)) break;

    const after = rest.slice(match[0].length);
    // A component the book only deals sometimes is not one. Roll back to
    // before the connective that introduced it, so the whole clause lands in
    // the rider as the book wrote it.
    if (CONDITIONAL.test(after)) {
      rest = resume;
      break;
    }

    if (rolled === null) {
      damage.push({ dice: null, flat: Number(match[1]), type, average: Number(match[1]) });
    } else {
      const sign = match[4] === undefined ? 1 : match[4] === '+' ? 1 : -1;
      damage.push({
        dice: `${match[2]}d${match[3]}`,
        flat: match[5] === undefined ? 0 : sign * Number(match[5]),
        type,
        average: Number(match[1]),
      });
    }

    rest = after;
    const plus = PLUS.exec(rest);
    if (plus === null) break;
    resume = rest;
    rest = rest.slice(plus[0].length);
  }

  return {
    damage,
    // The sentence the damage ended, and the markup around it, are the book's
    // punctuation rather than anything a reader needs.
    rest: rest.replace(/^[\s.,;—–-]+/, '').replace(/<br>/g, ' ').replace(/\s+/g, ' ').trim(),
  };
}

/**
 * SRD Pack Tactics, read off the sentence rather than off the trait's name.
 *
 * Eighteen blocks print it in two wordings that differ by one word ("an attack
 * roll" against "attack rolls"), and both are matched here. Matching the
 * *rule* rather than the heading is what keeps this honest in both directions:
 * a block that printed the same sentence under another name would get the same
 * mechanic, and one that printed a different rule under this name would not.
 */
const PACK_TACTICS =
  /has Advantage on (?:an attack roll|attack rolls) against a creature if at least one of the .+?'s allies is within 5 feet of the creature and the ally doesn't have the Incapacitated condition/i;

/**
 * The mechanic a trait's sentence states, where the parser knows one.
 *
 * Null for all but a handful, and that is the honest answer: a stat block's
 * traits are English, and what is read here is one sentence somebody matched
 * by hand, not an interpreter.
 */
export function parseTraitShape(text: string): MonsterTrait | null {
  if (PACK_TACTICS.test(text)) {
    return { kind: 'advantage-when-ally-is-within-5-feet-of-the-target' };
  }
  return null;
}

/** The counts a Multiattack sentence is written with; the book uses no digits. */
const COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

/**
 * "The elemental makes " — the subject, which names nothing the engine reads.
 *
 * A few plain words and no punctuation, because a looser opening reads
 * sentences that are not this one: the dragons' "The dragon moves up to half
 * its Speed, **and it makes** one Rend attack" would match on a subject that
 * may contain anything, and the move would be silently dropped.
 */
const MAKES = /^The (?:[A-Za-z'’-]+ ){1,3}makes /;

/**
 * "two Thunderous Slam attacks" — a count, a printed name, and the noun.
 *
 * Every word of the name is capitalised, because that is how the book prints
 * an action's heading and because a lower-cased word inside one is the tell
 * that the clause is not a name at all: the Bugbear Stalker's "two Javelin
 * **or** Morningstar attacks" is a menu, and reading it as a name called
 * "Javelin or Morningstar" would invent an attack nothing prints.
 */
const NAME = "[A-Z][A-Za-z'’-]*";
const CLAUSE = new RegExp(
  `^(one|two|three|four|five|six) (${NAME}(?: ${NAME})*) (attack|attacks)$`,
);

/**
 * The named sequence a Multiattack states, or null where it states something
 * else.
 *
 * **Whole or nothing.** The sentence has to be accounted for end to end —
 * subject, clauses, connectives, full stop — or this reads none of it. That is
 * what keeps the honest half honest: "The barbed devil makes one Claws attack
 * and one Tail attack, **or** it makes two Hurl Flame attacks" contains a
 * sequence this grammar could match and is not one, because a reader that took
 * the first branch would have deleted the second from the book.
 *
 * What it does *not* check is that the names are lines the same block prints:
 * this reads one sentence and knows nothing about the block around it. The
 * bestiary is swept for that, and the engine binds each name to a printed
 * attack before it will spend one.
 */
export function parseMultiattack(text: string): MonsterMultiattack | null {
  const clean = text.replace(/[_*]/g, '').trim();
  if (!clean.endsWith('.')) return null;

  const sentence = clean.slice(0, -1);
  // A second sentence says something this grammar has not read — the dragons'
  // "It can replace one attack with a use of Spellcasting" — so the line is
  // prose rather than a sequence with a clause quietly dropped.
  if (sentence.includes('.')) return null;

  const subject = MAKES.exec(sentence);
  if (subject === null) return null;

  const entries: { count: number; attack: string }[] = [];
  for (const part of sentence.slice(subject[0].length).split(' and ')) {
    const clause = CLAUSE.exec(part.trim());
    if (clause === null) return null;
    const count = COUNT_WORDS[clause[1]!]!;
    // The book agrees with itself about the plural, and a sentence that does
    // not is one this grammar has misread rather than one it may round off.
    if ((count === 1) !== (clause[3] === 'attack')) return null;
    entries.push({ count, attack: clause[2]!.trim() });
  }

  return entries.length === 0 ? null : { entries };
}

/**
 * The recharge printed in a line's **name**, or null where it prints none.
 *
 * The name is the only place the book states it, which is precisely why it is
 * read here: nothing downstream may tell a breath weapon from a bite by
 * reading a string.
 */
export function parseRecharge(name: string): MonsterRecharge | null {
  const printed = /\(Recharge([^)]*)\)/i.exec(name);
  if (printed === null) return null;

  const die = /^\s*(\d)(?:\s*[–—-]\s*6)?\s*$/.exec(printed[1]!);
  if (die !== null) return { kind: 'die', low: Number(die[1]) };
  // "Recharge after a Short or Long Rest": still not an every-round attack,
  // and the rest it waits on is the clock's rather than a die's.
  if (/rest/i.test(printed[1]!)) return { kind: 'rest' };
  return null;
}

function parseFeatures(lines: readonly string[]): Feature[] {
  const features: Feature[] = [];
  let current: { name: string; text: string[] } | null = null;

  const flush = () => {
    if (current === null) return;
    const text = current.text.join('\n').trim();
    // The name and the sentence are what a line is; the optional fields are
    // what this parser could read out of the sentence, present only when it
    // read something. Every detector runs over every section, because what a
    // line *says* is not a property of the heading it is printed under.
    if (text !== '') {
      const attack = parseAttackLine(text);
      const trait = parseTraitShape(text);
      // **The one detector the heading is part of.** A sequence is the
      // composition of *the Attack action*, and the only line that says so is
      // the one the book prints it under: three legendary actions write the
      // same sentence — "The aboleth makes one Tentacle attack" — about a
      // different economy entirely, and reading one of those as the creature's
      // Multiattack would hand it a cage the book never printed. The
      // qualified headings ("Multiattack (Vampire Form Only)") are left alone
      // for the same reason every qualified thing here is: the engine cannot
      // evaluate the qualification.
      const multiattack = current.name === 'Multiattack' ? parseMultiattack(text) : null;
      // The one thing read out of the *name* rather than the sentence, and it
      // rides on the attack because that is what has to be told apart from a
      // creature's every-round swing.
      const recharge = parseRecharge(current.name);
      features.push({
        name: current.name,
        text,
        ...(attack === null
          ? {}
          : { attack: recharge === null ? attack : { ...attack, recharge } }),
        ...(trait === null ? {} : { trait }),
        ...(multiattack === null ? {} : { multiattack }),
      });
    }
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
