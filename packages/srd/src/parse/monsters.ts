import {
  CreatureSizeSchema,
  MonsterAttackSchema,
  MonsterSaveSchema,
  MonsterSchema,
  MonsterSpellcastingSchema,
  slugify,
  type Feature,
  type Monster,
  type MonsterAttack,
  type MonsterDamage,
  type MonsterMultiattack,
  type MonsterMultiattackEntry,
  type MonsterRecharge,
  type MonsterSave,
  type MonsterSpell,
  type MonsterSpellcasting,
  type MonsterTrait,
  type ParseOutput,
  type ParseProblem,
} from '../schemas.js';
import { ABILITY_OVERRIDES } from './overrides.js';
/**
 * The spell list, for one job: turning a printed spell **name** into the id
 * the rest of the system knows that spell by.
 *
 * Generated data importing generated data, and the direction is the safe one:
 * `spell-index.ts` is committed, holds no monster and imports nothing, so
 * there is no cycle. What it costs is an ordering — a *renamed* spell needs
 * `srd:index` run before `srd:ingest` reads the new name — and spell names do
 * not move.
 */
import { SPELL_INDEX } from '../spell-index.js';

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
 * The book's other opening, matched end to end.
 *
 * `_Dexterity Saving Throw:_ DC 12, each creature in a 15-foot Cone.
 * _Failure:_ 17 (5d6) Fire damage. _Success:_ Half damage.`
 *
 * The anchors are the whole of the discipline here. Every clause the SRD adds
 * to this sentence is a mechanism of its own — a condition after the damage,
 * a second rung of failure, a trigger before the save, a `_Failure or
 * Success:_` coda — and the `^`/`$` refuse each of them whole rather than
 * reading the line down to the part that fits. Those lines stay prose, which
 * is where they already were.
 */
const PRINTED_SAVE_LINE =
  /^_([A-Za-z]+) Saving Throw:_ DC (\d+), (.+?)\. _Failure:_ (\d+) \((\d+)d(\d+)(?:\s*([+−–-])\s*(\d+))?\) ([A-Za-z]+) damage\.( _Success:_ Half damage(?: only)?\.)?$/;

/** The book writes the ability out; the engine keys it in three letters. */
const ABILITY_KEYS: Readonly<Record<string, MonsterSave['ability']>> = {
  Strength: 'str',
  Dexterity: 'dex',
  Constitution: 'con',
  Intelligence: 'int',
  Wisdom: 'wis',
  Charisma: 'cha',
};

/**
 * The save a line forces, where its sentence is the template and nothing more.
 *
 * Null for every other line, including the ones that force a save in a shape
 * this cannot hold — those are still carried verbatim and still handed to a
 * DM, exactly as an unread rider is.
 *
 * **Never asked of a line that prints an attack roll**, and that is
 * structural rather than incidental: a save printed after a hit is the
 * attack's rider, and `readPrintedRider` is the one reader of it. Two readers
 * for one clause would be two answers to it.
 */
export function parseSaveLine(text: string): MonsterSave | null {
  const match = PRINTED_SAVE_LINE.exec(text);
  if (match === null) return null;

  const ability = ABILITY_KEYS[match[1]!];
  if (ability === undefined) return null;

  const type = match[9]!.toLowerCase();
  // The same guard the attack chain uses: a word in the damage slot that is
  // not a damage type is a sentence this did not understand.
  if (!DAMAGE_TYPES.some((known) => known === type)) return null;

  const sign = match[7] === undefined ? 1 : match[7] === '+' ? 1 : -1;
  const save = {
    ability,
    dc: Number(match[2]),
    targets: match[3]!,
    damage: {
      dice: `${match[5]}d${match[6]}`,
      flat: match[8] === undefined ? 0 : sign * Number(match[8]),
      type,
      average: Number(match[4]),
    },
    onSuccess: match[10] === undefined ? ('none' as const) : ('half' as const),
  };

  // Validated rather than trusted, for the reason `parseAttackLine` validates
  // its own: a shape that does not satisfy its schema leaves the line prose
  // rather than reaching the catalogue.
  const checked = MonsterSaveSchema.safeParse(save);
  return checked.success ? checked.data : null;
}

/**
 * The subject a stat block writes its own traits about: "The pudding", "the
 * giant crab", "The frog's".
 *
 * A noun and never a name. Every one of the sentences below is printed about
 * forty different creatures and the only thing that changes between them is
 * this phrase, so it is the one part matched loosely — and matching it at all
 * is what keeps the rest of each regex anchored end to end.
 */
const SUBJECT = "[A-Za-z' -]+";

/**
 * SRD Spider Climb: "The pudding can climb difficult surfaces, including along
 * ceilings, without needing to make an ability check."
 *
 * Anchored, which is what refuses the Swarm of Insects: its sentence gates the
 * same rule on "If the swarm has a Climb Speed", and the kind carries no field
 * for a gate. A gate read away is a rule nobody printed.
 */
const SPIDER_CLIMB = new RegExp(
  `^${SUBJECT} can climb difficult surfaces, including along ceilings, without needing to make an ability check\\.$`,
);

/**
 * SRD Flyby: "The gargoyle doesn't provoke an Opportunity Attack when it flies
 * out of an enemy's reach."
 */
const FLYBY = new RegExp(
  `^${SUBJECT} doesn['’]t provoke an Opportunity Attack when it flies out of an enemy['’]s reach\\.$`,
);

/**
 * SRD Standing Leap: "The frog's Long Jump is up to 10 feet and its High Jump
 * is up to 5 feet with or without a running start."
 */
const STANDING_LEAP = new RegExp(
  `^${SUBJECT}['’]s Long Jump is up to (\\d+) feet and its High Jump is up to (\\d+) feet with or without a running start\\.$`,
);

/**
 * SRD Amphibious: "The chuul can breathe air and water." — and SRD Limited
 * Amphibiousness, which is the same first clause with a limit after it.
 */
const AMPHIBIOUS = new RegExp(
  `^${SUBJECT} can breathe air and water(?:, but it must be submerged at least once every (\\d+) hours to avoid suffocating outside water)?\\.$`,
);

/**
 * SRD Water Breathing: "The seahorse can breathe only underwater." The
 * octopus's second sentence — "It can hold its breath for 1 hour outside
 * water" — is the optional half.
 */
const WATER_BREATHING = new RegExp(
  `^${SUBJECT} can breathe only underwater\\.(?: It can hold its breath for (\\d+) (hour|hours|minute|minutes) outside water\\.)?$`,
);

/** SRD Hold Breath: "The crocodile can hold its breath for 1 hour." */
const HOLD_BREATH = new RegExp(
  `^${SUBJECT} can hold its breath for (\\d+) (hour|hours|minute|minutes)\\.$`,
);

/**
 * SRD Sunlight Sensitivity: "While in sunlight, the kobold has Disadvantage on
 * ability checks and attack rolls." Five blocks print it word for word.
 *
 * Anchored end to end, which is what refuses the vampires: their Sunlight
 * prints this sentence *after* "The vampire takes 20 Radiant damage if it
 * starts its turn in sunlight", and the burning is a rule nothing here can
 * carry. A clause read away is a rule nobody printed, so the line stays prose
 * and the ledger goes on naming it.
 */
const SUNLIGHT_SENSITIVITY = new RegExp(
  `^While in sunlight, ${SUBJECT} has Disadvantage on ability checks and attack rolls\\.$`,
);

/**
 * SRD Sunlight Weakness: "While in sunlight, the shadow has Disadvantage on
 * D20 Tests."
 *
 * The same rule over the wider list the rules glossary defines: "D20 Tests
 * encompass the three main d20 rolls of the game: ability checks, attack
 * rolls, and saving throws. If something in the game affects D20 Tests, it
 * affects all three of these rolls."
 */
const SUNLIGHT_WEAKNESS = new RegExp(
  `^While in sunlight, ${SUBJECT} has Disadvantage on D20 Tests\\.$`,
);

/**
 * SRD Illumination: "The azer sheds Bright Light in a 10-foot radius and Dim
 * Light for an additional 10 feet."
 *
 * Anchored for the reason every regex here is: the magmin's Ignited
 * Illumination prints the same clause behind "While ablaze", and a magmin read
 * as an unconditional lamp is a rule nobody printed.
 */
const ILLUMINATION = new RegExp(
  `^${SUBJECT} sheds Bright Light in a (\\d+)-foot radius and Dim Light for an additional (\\d+) feet\\.$`,
);

/**
 * SRD Shadow Stealth: "While in Dim Light or Darkness, the shadow takes the
 * Hide action."
 */
const SHADOW_STEALTH = new RegExp(
  `^While in Dim Light or Darkness, ${SUBJECT} takes the Hide action\\.$`,
);

/**
 * The three actions the book actually offers in this sentence, and the words
 * it prints them as.
 *
 * A closed alternation rather than a capture of any capitalised word, for the
 * reason every regex here is anchored: a Scout's "Search" is an action the
 * engine cannot tell apart from any other spend, so reading one would put a
 * rule on a creature that nothing enforces.
 */
const BONUS_ACTION_NAME = '(?:Dash|Disengage|Hide)';

/**
 * SRD Nimble Escape: "The goblin takes the Disengage or Hide action." SRD
 * Cunning Action on the Spy — "the Dash, Disengage, or Hide action" — and SRD
 * Deathless Agility's "the Dash or Disengage action" are the same sentence
 * over a different menu.
 *
 * **The `or` is required**, which is what refuses the Clay Golem: its Hasten
 * prints "the Dash **and** Disengage **actions**", meaning it takes both, on
 * a recharge. A conjunction read as a menu is a choice nobody printed — and
 * the plural noun is the book's own tell, so the singular `action` is matched
 * end to end too.
 *
 * Anchored for the same reason as everything else here, which is also what
 * keeps {@link SHADOW_STEALTH} distinct: the shadow's sentence opens with a
 * clause this subject cannot swallow, because {@link SUBJECT} holds no comma.
 */
const TAKES_A_NAMED_ACTION = new RegExp(
  `^${SUBJECT} takes the (${BONUS_ACTION_NAME}(?:, ${BONUS_ACTION_NAME})*,? or ${BONUS_ACTION_NAME}) action\\.$`,
);

/**
 * SRD Bloodied Fury: "While Bloodied, the boar has Advantage on attack
 * rolls." SRD Bloodied Frenzy: "…on attack rolls and saving throws."
 *
 * Two printed breadths of one rule, exactly as the two sunlight sentences
 * are, and the alternation is closed so that a third breadth nobody printed
 * cannot be read out of a longer sentence. The Giant Boar's "melee attack
 * rolls while it is Bloodied" is refused whole: a narrowing the kind carries
 * no field for, written the other way round.
 */
const BLOODIED_ADVANTAGE = new RegExp(
  `^While Bloodied, ${SUBJECT} has Advantage on (attack rolls and saving throws|attack rolls)\\.$`,
);

/**
 * SRD Undead Fortitude, printed word for word on two blocks.
 *
 * Anchored end to end like everything else here, and this one has more to
 * refuse than most: the whole rule is in the clauses — a Constitution save, a
 * DC read off the damage, two exceptions, and the one Hit Point a success
 * leaves. A sentence read down to "it drops to 1 Hit Point instead" would be a
 * zombie that never dies.
 */
const UNDEAD_FORTITUDE = new RegExp(
  `^If damage reduces ${SUBJECT} to 0 Hit Points, it makes a Constitution saving throw ` +
    `\\(DC 5 plus the damage taken\\) unless the damage is Radiant or from a Critical Hit\\. ` +
    `On a successful save, ${SUBJECT} drops to 1 Hit Point instead\\.$`,
);

/**
 * SRD Magic Resistance: "The devil has Advantage on saving throws against
 * spells and other magical effects."
 *
 * Anchored, which is what refuses the Rakshasa: its Greater Magic Resistance
 * opens "automatically succeeds on saving throws against spells" and goes on
 * for two more clauses. A sentence read down to the words it shares with this
 * one would be a rakshasa the book did not print.
 */
const MAGIC_RESISTANCE = new RegExp(
  `^${SUBJECT} has Advantage on saving throws against spells and other magical effects\\.$`,
);

/** The book's nouns for the rolls, in the kind's own three words. */
const BLOODIED_ROLLS: Readonly<Record<string, readonly ('attack-roll' | 'saving-throw')[]>> = {
  'attack rolls': ['attack-roll'],
  'attack rolls and saving throws': ['attack-roll', 'saving-throw'],
};

/** A fresh array for the shape, because the schema's is a mutable one. */
const bloodiedRolls = (printed: string): ('attack-roll' | 'saving-throw')[] => [
  ...(BLOODIED_ROLLS[printed] ?? []),
];

/** A printed span, always in minutes — the book writes both units. */
const inMinutes = (count: string, unit: string): number =>
  Number(count) * (unit.startsWith('hour') ? 60 : 1);

/**
 * The mechanic a trait's sentence states, where the parser knows one.
 *
 * Null for all but a handful, and that is the honest answer: a stat block's
 * traits are English, and what is read here is one sentence somebody matched
 * by hand, not an interpreter.
 *
 * **Matched on the sentence and never on the heading**, which is the rule
 * `PACK_TACTICS` set and every addition follows: a block printing the same
 * rule under another name gets the same mechanic, and one printing something
 * else under a name quoted in a comment here gets nothing.
 */
export function parseTraitShape(text: string): MonsterTrait | null {
  if (PACK_TACTICS.test(text)) {
    return { kind: 'advantage-when-ally-is-within-5-feet-of-the-target' };
  }
  if (SPIDER_CLIMB.test(text)) return { kind: 'climbs-without-a-check' };
  if (FLYBY.test(text)) return { kind: 'does-not-provoke-when-flying-out-of-reach' };

  const leap = STANDING_LEAP.exec(text);
  if (leap !== null) {
    return {
      kind: 'jumps-without-a-running-start',
      longJumpFeet: Number(leap[1]),
      highJumpFeet: Number(leap[2]),
    };
  }

  const amphibious = AMPHIBIOUS.exec(text);
  if (amphibious !== null) {
    return {
      kind: 'breathes-air-and-water',
      ...(amphibious[1] === undefined
        ? {}
        : { mustSubmergeWithinHours: Number(amphibious[1]) }),
    };
  }

  const water = WATER_BREATHING.exec(text);
  if (water !== null) {
    return {
      kind: 'breathes-only-water',
      ...(water[1] === undefined
        ? {}
        : { holdsBreathMinutes: inMinutes(water[1], water[2]!) }),
    };
  }

  const held = HOLD_BREATH.exec(text);
  if (held !== null) return { kind: 'holds-its-breath', minutes: inMinutes(held[1]!, held[2]!) };

  // The two sunlight sentences, which are one kind at two breadths. The
  // wider one is the glossary's three rolls rather than an interpretation:
  // "If something in the game affects D20 Tests, it affects all three."
  if (SUNLIGHT_SENSITIVITY.test(text)) {
    return { kind: 'disadvantage-in-sunlight', rolls: ['ability-check', 'attack-roll'] };
  }
  if (SUNLIGHT_WEAKNESS.test(text)) {
    return {
      kind: 'disadvantage-in-sunlight',
      rolls: ['ability-check', 'attack-roll', 'saving-throw'],
    };
  }

  const lit = ILLUMINATION.exec(text);
  if (lit !== null) {
    return {
      kind: 'sheds-light',
      brightRadiusFeet: Number(lit[1]),
      dimBeyondFeet: Number(lit[2]),
    };
  }

  if (SHADOW_STEALTH.test(text)) return { kind: 'hides-in-dim-light-or-darkness' };

  // Asked **after** Shadow Stealth, which is belt and braces rather than a
  // dependency: the shadow's sentence opens with a clause `SUBJECT` cannot
  // match, so neither order reads one as the other.
  const menu = TAKES_A_NAMED_ACTION.exec(text);
  if (menu !== null) {
    return {
      kind: 'takes-a-named-action-as-a-bonus-action',
      actions: menu[1]!
        .split(/,? or |, /)
        .map((name) => name.toLowerCase() as 'dash' | 'disengage' | 'hide'),
    };
  }

  const bloodied = BLOODIED_ADVANTAGE.exec(text);
  if (bloodied !== null) {
    return { kind: 'advantage-while-bloodied', rolls: bloodiedRolls(bloodied[1]!) };
  }

  if (UNDEAD_FORTITUDE.test(text)) return { kind: 'undead-fortitude' };
  if (MAGIC_RESISTANCE.test(text)) return { kind: 'magic-resistance' };

  return null;
}

/**
 * The book's **third** opening, matched end to end.
 *
 * "The cultist casts one of the following spells, using Wisdom as the
 * spellcasting ability (spell save DC 12, +4 to hit with spell attacks):"
 *
 * Three clauses vary and are all optional: the components the casting does
 * without ("requiring no Material components", "no spell components", "no
 * Somatic or Material components"), the printed save DC, and the printed
 * attack bonus. A block that prints none of the three — SRD Priest Acolyte —
 * is read exactly as readily, and what it leaves absent the creature's own
 * sheet derives.
 *
 * **The Pit Fiend's Hellfire Spellcasting is what the anchors refuse.** "The
 * pit fiend casts _Fireball_ (level 5 version) **twice** … It can replace one
 * _Fireball_ with …" is a different sentence about a different economy, and
 * reading it down to the part that fits would give a devil a spell list it
 * does not have.
 */
const SPELLCASTING_PREAMBLE = new RegExp(
  `^The ${SUBJECT} casts one of the following spells,` +
    `(?: requiring no [A-Za-z ]+ components and)?` +
    ` using (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)` +
    ` as (?:the )?spellcasting ability` +
    `(?: \\(spell save DC (\\d+)(?:, \\+(\\d+) to hit with spell attacks)?\\))?:$`,
);

/**
 * One category of the list: "**At Will:**", "**2/Day:**", "**1/Day Each:**".
 *
 * The three the book prints and nothing else. "Each" is captured because it
 * is the difference between four spells with a budget of one apiece and four
 * sharing one — see {@link readSpellList}.
 */
const SPELL_CATEGORY = /^\*\*(?:At Will|(\d+)\/Day( Each)?):\*\* (.+)$/;

/**
 * A printed spell name to the SRD's own id.
 *
 * **Looked up rather than slugified**, and the Druid is why: its block prints
 * "Long-strider" where the spell list prints "Longstrider", so a blind slug
 * produces `long-strider`, which is not a spell — and a spell id nothing
 * defines is a casting that refuses for the wrong reason.
 *
 * The key drops everything that is not a letter or a digit, which is what
 * lets the hyphen the book introduced at a line break fall out. That it
 * collides for no two SRD spells is asserted in `monster-spellcasting.test.ts`
 * rather than assumed.
 */
const SPELL_IDS: ReadonlyMap<string, string> = new Map(
  SPELL_INDEX.map((spell) => [spell.name.toLowerCase().replace(/[^a-z0-9]+/g, ''), spell.id]),
);

const spellIdOf = (name: string): string | null =>
  SPELL_IDS.get(name.toLowerCase().replace(/[^a-z0-9]+/g, '')) ?? null;

/**
 * One category's list of spells, consumed to the last character or refused.
 *
 * The grammar is italic groups separated by `, `, each optionally followed by
 * one parenthetical: `_Light_, _Thaumaturgy_`, and
 * `_Animal Friendship, Charm Monster_ (lasts 24 hours; …), _Druidcraft_`.
 *
 * **A group may hold several names**, because the book italicises a run of
 * them together as readily as one at a time — and when a parenthetical
 * follows such a run it belongs to the **last** name in it, which is the only
 * one it can be about: the dryad's twenty-four hours are Charm Monster's, not
 * Animal Friendship's.
 *
 * **Refused whole on anything it cannot consume**, which is the discipline
 * every shape in this file keeps. A trailing clause the grammar does not
 * cover, a name the SRD index does not hold, or an unqualified `N/Day`
 * category naming more than one spell — two spells sharing one budget, which
 * is not what "N/Day **Each**" says and is a shape the structure has no field
 * for — leaves the whole line prose.
 */
function readSpellList(
  list: string,
  usesPerDay: number | null,
  each: boolean,
): MonsterSpell[] | null {
  const spells: MonsterSpell[] = [];
  let rest = list;

  while (rest.length > 0) {
    const group = /^_([^_]+)_/.exec(rest);
    if (group === null) return null;
    rest = rest.slice(group[0].length);

    // One parenthetical, with no nesting: every rider the book prints after a
    // spell's name is a flat clause, and a `(` inside one would be a sentence
    // this did not understand.
    const rider = /^ \(([^()]+)\)/.exec(rest);
    if (rider !== null) rest = rest.slice(rider[0].length);

    const names = group[1]!.split(', ').map((name) => name.trim());
    if (names.some((name) => name === '')) return null;
    for (const [index, name] of names.entries()) {
      const spellId = spellIdOf(name);
      if (spellId === null) return null;
      spells.push({
        spellId,
        name,
        ...(usesPerDay === null ? {} : { usesPerDay }),
        // The rider rides the last name of the group it followed, and on
        // nothing else.
        ...(rider === null || index !== names.length - 1 ? {} : { handOver: rider[1]! }),
      });
    }

    if (rest.startsWith(', ')) rest = rest.slice(2);
    else if (rest.length > 0) return null;
  }

  if (spells.length === 0) return null;
  // "2/Day: _Light_, _Thaumaturgy_" is two spells sharing one budget of two.
  // The SRD prints no such line; a homebrew one is refused rather than read as
  // the "Each" it does not say.
  if (usesPerDay !== null && !each && spells.length > 1) return null;
  return spells;
}

/**
 * The spells a printed Spellcasting line declares, or null for every other
 * line in the book.
 *
 * Read off the **sentence** and never off the heading, which is the rule
 * {@link parseTraitShape} set and every reader here follows: a block printing
 * this sentence under another name declares the same spells, and a block
 * printing something else under a heading called "Spellcasting" declares none.
 *
 * The source writes the line as a preamble and one `<br>`-separated segment
 * per category, each opening with a `&emsp;` indent. Both are markup rather
 * than content, so both come off before anything is matched.
 */
export function parseSpellcastingLine(text: string): MonsterSpellcasting | null {
  const segments = text
    .split('<br>')
    .map((segment) => segment.replace(/&emsp;/g, '').replace(/\s+/g, ' ').trim())
    .filter((segment) => segment !== '');

  const preamble = segments[0] === undefined ? null : SPELLCASTING_PREAMBLE.exec(segments[0]);
  if (preamble === null) return null;

  const ability = ABILITY_KEYS[preamble[1]!];
  if (ability === undefined) return null;

  const spells: MonsterSpell[] = [];
  for (const segment of segments.slice(1)) {
    const category = SPELL_CATEGORY.exec(segment);
    if (category === null) return null;
    const read = readSpellList(
      category[3]!,
      category[1] === undefined ? null : Number(category[1]),
      category[2] !== undefined,
    );
    if (read === null) return null;
    spells.push(...read);
  }

  const casting = {
    ability,
    ...(preamble[2] === undefined ? {} : { saveDc: Number(preamble[2]) }),
    ...(preamble[3] === undefined ? {} : { attackBonus: Number(preamble[3]) }),
    spells,
  };

  // Validated rather than trusted, for the reason `parseSaveLine` validates
  // its own: a shape that does not satisfy its schema leaves the line prose
  // rather than reaching the catalogue.
  const checked = MonsterSpellcastingSchema.safeParse(casting);
  return checked.success ? checked.data : null;
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
 * "two Thunderous Slam attacks" — a count, a printed name or a menu of them,
 * and the noun.
 *
 * Every word of a name is capitalised, because that is how the book prints an
 * action's heading and because a lower-cased word inside one is the tell that
 * the clause is not a single name: the Bugbear Stalker's "two Javelin **or**
 * Morningstar attacks" is a menu, and reading it as a name called "Javelin or
 * Morningstar" would invent an attack nothing prints. So ` or ` is the one
 * lower-cased word the clause admits, and what it separates are names.
 */
const NAME = "[A-Z][A-Za-z'’-]*";
const NAMES = `${NAME}(?: ${NAME})*`;
const COUNT = '(one|two|three|four|five|six)';
const CLAUSE = new RegExp(`^${COUNT} (${NAMES}(?: or ${NAMES})*) (attack|attacks)$`);

/**
 * "three attacks" and the Tarrasque's "three other attacks" — a count whose
 * names the sentence states once, in the tail below, rather than in the clause.
 */
const BARE = new RegExp(`^${COUNT} (?:other )?(attack|attacks)$`);

/**
 * ", using Scimitar and Pistol in any combination" — the book's other way of
 * printing a menu, and it always ends the sentence.
 *
 * The names inside are separated by "or", by "and" (the Bandit Captain and the
 * Scout write it that way and plainly mean "or" — "in any combination" is what
 * settles it) or by commas with an Oxford "or" before the last.
 */
const MENU_TAIL = /, using (.+) in any combination$/;
const MENU_SEPARATOR = /,\s+or\s+|,\s+and\s+|\s+or\s+|\s+and\s+|,\s+/;

/**
 * ", and it uses Dreadful Glare" — a trailing clause naming a *use*, which is
 * not a swing this grammar may grant.
 *
 * The connective is required, and that is the whole of what keeps the Roper's
 * "makes two Tentacle attacks, **uses Reel**, and makes two Bite attacks" out:
 * its use sits in the middle of the sequence rather than trailing it, so the
 * sentence is prose and stays prose.
 */
const TRAILING_USE = /,? (?:and|or) (?:it )?(?:can )?uses? [^.]*$/;

/**
 * ", and it uses Bite" — the whole of a trailing clause, when what it names is
 * one action and nothing else.
 *
 * Matched against the clause {@link TRAILING_USE} already found rather than
 * against the sentence, so the two can never disagree about where the clause
 * begins. Anchored at both ends, which is what keeps every clause that says
 * more than a name — "uses Bite **twice**", "uses Bite **if available**",
 * "uses Charm **or** Draining Kiss" — outside it: a count, a qualification and
 * a choice are each a rule this grammar does not read, and reading the name out
 * of one of them would grant a swing the sentence did not.
 *
 * The connective is `and` alone. The book's `or` offers the use *instead of*
 * the swings rather than beside them, which is an alternation and not an extra
 * entry.
 */
const NAMED_USE_CLAUSE = new RegExp(`^,? and (?:it )?(?:can )?uses? (${NAMES})$`);

/**
 * " if it used Hasten this turn" — the one gate the book prints on a branch.
 *
 * Anchored at the end of the branch it trails, and it names one thing: a line
 * the same block prints under Bonus Actions. Anything else the clause could
 * say — a condition on the target, a count, a qualification — does not match,
 * and a branch this does not clear is a branch {@link parseSequence} refuses,
 * which takes the whole sentence with it.
 */
const GATE = new RegExp(` if it used (${NAMES}) this turn$`);

/**
 * A heading with the parenthetical the book prints inside it taken off.
 *
 * "Hasten (Recharge 5–6)" is the heading and `Hasten` is what the sentence
 * beside it says, and the same is true of "(2/Day)" and of "(Recharge after a
 * Short or Long Rest)". The heading is what comes back from a bind, because
 * that is the string a caller spends and a log records; this is only how the
 * two are recognised as one line.
 */
const headingName = (name: string): string => name.replace(/\s*\([^)]*\)\s*$/, '').trim();

/**
 * The printed heading of a Bonus Action line a sentence names, or null.
 *
 * The same discipline {@link boundName} applies to an attack: a name is a name
 * until the block is shown to print a line by it, and a gate that binds to
 * nothing is not read at all.
 */
const boundLine = (printed: readonly string[], name: string): string | null =>
  printed.find((heading) => headingName(heading).toLowerCase() === name.trim().toLowerCase()) ??
  null;

/** "It can replace one attack with a Tail attack." — a swap for a printed line. */
const REPLACEMENT = new RegExp(`^It can replace ${COUNT} attacks? with an? (${NAMES}) attack\\.$`);

/**
 * "It can replace one attack with a use of Constrict." — the same swap, for
 * what the book calls a *use*.
 *
 * The book is consistent that "a **use of** X" is a save or a prose action
 * rather than a printed swing, and in the SRD it always is. That is a fact
 * about this corpus and not a rule, so what settles it here is the same thing
 * that settles the trailing clause: whether the block prints an attack by that
 * name. Where it does, the sentence is a swing traded for a swing, which is
 * exactly what {@link REPLACEMENT} reads.
 */
const REPLACEMENT_USE = new RegExp(`^It can replace ${COUNT} attacks? with a use of (${NAMES})\\.$`);

/** Whether a second sentence names a *use*, which is the thing handed over. */
const NAMES_A_USE = /\buses?\b/;

/**
 * The **printed** spelling of a name, where the block prints an attack by it.
 *
 * Case-insensitive, because a sentence and a heading are two places one word
 * gets typed; the heading's spelling is what comes back, because that is the
 * name a caller spends and the one the engine binds a sequence against.
 */
const boundName = (printed: readonly string[], name: string): string | null =>
  printed.find((line) => line.toLowerCase() === name.trim().toLowerCase()) ?? null;

/** Whether a sequence already spends a name, in any of its entries. */
const alreadyNamed = (
  branch: readonly MonsterMultiattackEntry[],
  name: string,
): boolean =>
  branch.some((entry) =>
    (entry.attacks ?? [entry.attack!]).some(
      (printed) => printed.toLowerCase() === name.toLowerCase(),
    ),
  );

/** The clauses of one sequence, or null where the text is not one. */
function parseSequence(text: string): MonsterMultiattackEntry[] | null {
  let menu: string[] | null = null;
  let body = text;

  const tail = MENU_TAIL.exec(body);
  if (tail !== null) {
    menu = tail[1]!.split(MENU_SEPARATOR).map((name) => name.trim());
    if (menu.some((name) => !new RegExp(`^${NAMES}$`).test(name))) return null;
    body = body.slice(0, tail.index);
  }

  const entries: MonsterMultiattackEntry[] = [];
  let spentMenu = false;
  // The Oxford comma is a connective like any other, and so is a bare one: the
  // Pit Fiend's "one Bite attack, two Devilish Claw attacks, and one Fiery Mace
  // attack" is a pure named sequence that ` and ` alone could not see.
  for (const raw of body.split(/,\s+and\s+|\s+and\s+|,\s+/)) {
    const part = raw.trim();
    const clause = CLAUSE.exec(part);
    const bare = clause === null ? BARE.exec(part) : null;
    if (clause === null && bare === null) return null;

    const count = COUNT_WORDS[(clause ?? bare)![1]!]!;
    // The book agrees with itself about the plural, and a sentence that does
    // not is one this grammar has misread rather than one it may round off.
    if ((count === 1) !== ((clause ?? bare)![clause === null ? 2 : 3] === 'attack')) return null;

    if (bare !== null) {
      if (menu === null) return null;
      spentMenu = true;
      entries.push({ count, attacks: menu });
      continue;
    }
    const names = clause![2]!.split(' or ').map((name) => name.trim());
    entries.push(names.length === 1 ? { count, attack: names[0]! } : { count, attacks: names });
  }

  // A tail nobody spent is a menu this read and then dropped, which is the one
  // outcome worse than reading nothing.
  if (menu !== null && !spentMenu) return null;
  return entries.length === 0 ? null : entries;
}

/**
 * The same sequence with one swing traded for another printed line — the Dragon
 * Turtle's "It can replace one attack with a Tail attack", written out.
 *
 * One entry in the base or nothing: with two, the sentence does not say which
 * of them the replaced swing came out of, and picking one would be the engine
 * choosing. No block in the book prints that, so none is read.
 */
function withOneReplaced(
  entries: readonly MonsterMultiattackEntry[],
  count: number,
  attack: string,
): MonsterMultiattackEntry[] | null {
  if (entries.length !== 1) return null;
  const only = entries[0]!;
  if (only.count <= count) return null;
  // And not a name the entry it comes out of already spends: the engine
  // assigns a turn's swings in one pass over entries no name appears in twice,
  // and "two Bites, one of which may be a Bite" would break that for nothing.
  if (alreadyNamed(entries, attack)) return null;
  return [{ ...only, count: only.count - count }, { count, attack }];
}

/**
 * What a Multiattack line states, or null where it states something this
 * grammar still cannot read.
 *
 * **Whole or nothing.** The line has to be accounted for end to end — subject,
 * clauses, connectives, a second sentence, full stop — or this reads none of
 * it. That is what keeps it honest: a sentence containing a sequence this
 * grammar could match is not thereby one, because a reader that took the first
 * branch of the Barbed Devil's line would have deleted the second from the
 * book.
 *
 * What it does *not* check is that a name in a *sequence* is a line the same
 * block prints: a count and a name are what the clause states, and the engine
 * binds each name to a printed attack before it will spend one.
 *
 * `printedAttacks` is the other half, and it is the one thing here that is a
 * fact about the **block** rather than about the sentence: the names of the
 * Actions lines this block prints an attack roll for. It decides one question
 * only — whether a clause naming a *use* is a swing or something to hand a DM
 * — and a sentence that names a use of something else is handed over exactly as
 * it always was. The default is the empty list, which is the reading this
 * parser gave before the argument existed: nothing binds, so every use is
 * prose. It can only ever refuse a swing, never invent one.
 */
export function parseMultiattack(
  text: string,
  printedAttacks: readonly string[] = [],
  printedBonusActions: readonly string[] = [],
): MonsterMultiattack | null {
  const clean = text.replace(/[_*]/g, '').trim();
  if (!clean.endsWith('.')) return null;

  const sentences = clean.slice(0, -1).split('. ');
  // Two is every shape the book prints; a third would be something nobody has
  // read, and reading two of it is how a clause goes quietly missing.
  if (sentences.length > 2) return null;
  const second = sentences.length === 2 ? `${sentences[1]!}.` : null;

  // The two clauses this sentence may hand over, kept apart until the end: a
  // trailing use can turn out to be a swing, and composing the string early
  // would take the *other* clause down with it.
  let trailingClause: string | null = null;
  let secondClause: string | null = null;
  // The printed name of the attack a trailing use names, where it names one.
  let trailingSwing: string | null = null;
  let stated = sentences[0]!;
  const trailing = TRAILING_USE.exec(stated);
  if (trailing !== null) {
    trailingClause = trailing[0].replace(/^,/, '').trim();
    const named = NAMED_USE_CLAUSE.exec(trailing[0]);
    trailingSwing = named === null ? null : boundName(printedAttacks, named[1]!);
    stated = stated.slice(0, trailing.index).replace(/,$/, '');
  }

  const subject = MAKES.exec(stated);
  if (subject === null) return null;

  const branchTexts = stated.slice(subject[0].length).split(', or it makes ');
  if (branchTexts.length > 2) return null;
  const branches: MonsterMultiattackEntry[][] = [];
  // The gate each branch trails, where it trails one. Kept beside the branches
  // rather than folded into them, because a branch is still the list of clauses
  // every reader below works in — the two are composed at the end, once.
  const gates: (string | null)[] = [];
  for (const raw of branchTexts) {
    // **Peeled before the clauses are read, and bound before either is kept.**
    // A gate naming a line the block does not print is a clause this grammar
    // cannot evaluate, so the sentence stays prose — the alternative being a
    // branch offered unconditionally that the book offers only sometimes.
    const gate = GATE.exec(raw);
    const bound = gate === null ? null : boundLine(printedBonusActions, gate[1]!);
    if (gate !== null && bound === null) return null;
    const branchText = gate === null ? raw : raw.slice(0, gate.index);

    const entries = parseSequence(branchText);
    if (entries === null) return null;
    branches.push(entries);
    gates.push(bound);
  }
  // A sentence that gates every branch leaves the creature no Attack action at
  // all on an ordinary turn, which is not something the book prints and not
  // something this reads half of.
  if (gates.every((gate) => gate !== null)) return null;

  if (second !== null) {
    // Nothing in the book prints both wordings of the alternation at once, and
    // a second sentence read onto a branch nobody could identify is a guess.
    if (branches.length > 1) return null;
    const replacement = REPLACEMENT.exec(second);
    if (replacement !== null) {
      const swapped = withOneReplaced(
        branches[0]!,
        COUNT_WORDS[replacement[1]!]!,
        replacement[2]!.trim(),
      );
      if (swapped === null) return null;
      branches.push(swapped);
      gates.push(null);
    } else {
      // "a use of X" where X is a line this block prints an attack for is the
      // same swap in the book's other words.
      const use = REPLACEMENT_USE.exec(second);
      const used = use === null ? null : boundName(printedAttacks, use[2]!);
      const swapped =
        used === null ? null : withOneReplaced(branches[0]!, COUNT_WORDS[use![1]!]!, used);
      if (swapped !== null) {
        branches.push(swapped);
        gates.push(null);
      }
      // **Knowing what the block prints may never make this read less.** A use
      // this grammar cannot write out as a swap — because the base sequence has
      // two entries, or because it already spends the name — is the hand-over
      // it was before the names were passed in, and not a refusal of the
      // sequence the first sentence already stated. Otherwise a block would
      // lose its whole Multiattack for having printed an attack by that name,
      // which is the opposite of what reading the name is for.
      else if (NAMES_A_USE.test(second)) secondClause = second;
      else return null;
    }
  }

  // **A trailing use of a printed attack is a swing, and joins the sequence.**
  // Only where the sentence prints one: with a choice of sequences nothing in
  // the clause says which of them the swing belongs to. And only where the
  // sequence does not already name it, because the engine assigns a turn's
  // swings in one pass over entries no name appears in twice — a rule the
  // bestiary is swept for, and one a block from anywhere else must keep too.
  if (
    trailingSwing !== null &&
    branches.length === 1 &&
    !alreadyNamed(branches[0]!, trailingSwing)
  ) {
    branches[0]!.push({ count: 1, attack: trailingSwing });
    trailingClause = null;
  }

  const clauses = [trailingClause, secondClause].filter((clause) => clause !== null);
  // A branch carries its gate or is the bare list of clauses it has always
  // been, so an alternation nothing gates comes out byte for byte as it did.
  const shape =
    branches.length === 1
      ? { entries: branches[0]! }
      : {
          alternatives: branches.map((entries, at) => {
            const gate = gates[at] ?? null;
            return gate === null ? entries : { entries, requires: { usedBonusAction: gate } };
          }),
        };
  return { ...shape, ...(clauses.length === 0 ? {} : { handOver: clauses.join(' ') }) };
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
  // "Recharge after a Short or Long Rest": the rest **alone**, with no die and
  // no turn-start roll, which is why the book prints it as a second notation
  // rather than as a shorter way of saying the first.
  if (/rest/i.test(printed[1]!)) return { kind: 'rest' };
  return null;
}

/**
 * The per-day limit printed in a line's **name**, or null where it prints
 * none: "Dominate Mind (2/Day)" is 2.
 *
 * Read here for the reason {@link parseRecharge} above it is: the heading is
 * the only place the book states it, and a heading is exactly what nothing
 * downstream may branch on. It is a **different rule** from a recharge and is
 * a different field — see `FeatureSchema.perDay`, which carries the whole
 * argument, including why the lair number is dropped and why a qualification
 * the parser cannot evaluate does not suppress the number it can.
 *
 * Matched at the front of the parenthesis the book prints it in — every one of
 * the sixty headings opens with the count — so the prose of a heading cannot
 * produce one, and the number taken is the first, which is the one printed
 * outside a lair.
 */
export function parsePerDay(name: string): number | null {
  // `\d+` rather than `\d`: nothing in the SRD prints a two-digit limit, and a
  // single digit would silently read a homebrew "12/Day" line as a 1/Day one,
  // which is the quiet class of wrongness this parser is strict about.
  const printed = /\((\d+)\s*\/\s*Day\b/i.exec(name);
  if (printed === null) return null;
  const uses = Number(printed[1]!);
  // A limit of nothing is not something the book prints; it is a misread line,
  // and a zero handed on would be a line no creature could ever use.
  return uses > 0 ? uses : null;
}

function parseFeatures(
  lines: readonly string[],
  printedAttacks: readonly string[] = [],
  printedBonusActions: readonly string[] = [],
): Feature[] {
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
      // **Only where the line prints no attack roll.** A save printed after a
      // hit is that attack's rider, and the swing's own reader is the one
      // reader of it; a second here would be two answers to one clause.
      const save = attack === null ? parseSaveLine(text) : null;
      // **The one detector the heading is part of.** A sequence is the
      // composition of *the Attack action*, and the only line that says so is
      // the one the book prints it under: three legendary actions write the
      // same sentence — "The aboleth makes one Tentacle attack" — about a
      // different economy entirely, and reading one of those as the creature's
      // Multiattack would hand it a cage the book never printed. The
      // qualified headings ("Multiattack (Vampire Form Only)") are left alone
      // for the same reason every qualified thing here is: the engine cannot
      // evaluate the qualification.
      const multiattack =
        current.name === 'Multiattack'
          ? parseMultiattack(text, printedAttacks, printedBonusActions)
          : null;
      // The two things read out of the *name* rather than the sentence, and
      // both ride on the **line**, which is what the book prints them on:
      // eighty-five of the eighty-seven lines that print a recharge print no
      // attack roll for it to have ridden on, and none of the sixty that print
      // a per-day limit does. They are two rules on two clocks — a d6 at a turn
      // boundary against a sunrise — and no heading in the SRD prints both.
      const recharge = parseRecharge(current.name);
      const perDay = parsePerDay(current.name);
      // The book's third opening, read off the sentence like the other two.
      // Asked of every line for the reason `save` is asked of every line: what
      // a line says is not a property of the heading it is printed under.
      const spellcasting = parseSpellcastingLine(text);
      features.push({
        name: current.name,
        text,
        ...(attack === null ? {} : { attack }),
        ...(trait === null ? {} : { trait }),
        ...(save === null ? {} : { save }),
        ...(multiattack === null ? {} : { multiattack }),
        ...(recharge === null ? {} : { recharge }),
        ...(perDay === null ? {} : { perDay }),
        ...(spellcasting === null ? {} : { spellcasting }),
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

  // **The one thing a line is read against the rest of its block for.** A
  // Multiattack's trailing "and uses X" is a swing where X is a line with an
  // attack roll on it and a hand-over where it is not, and the sentence cannot
  // say which. So the Actions section is read once for the names it prints an
  // attack under, and those names are handed to every section's reader — the
  // Actions section, because that is the one the engine binds a sequence
  // against. The first pass's own sequences are thrown away rather than kept:
  // they were read without this, and half of them is worse than none.
  const printedAttacks = parseFeatures(sections.actions).flatMap((line) =>
    line.attack === undefined ? [] : [line.name],
  );

  // **The second thing a line is read against the rest of its block for**, and
  // the headings are the whole of it: a branch gated on "if it used Hasten this
  // turn" is read only where the block prints a Bonus Action by that name, and
  // what the line under that heading *says* is nobody's business here. Read off
  // the section's own headings rather than through a detector, because a
  // heading is what a gate names and what a spend records.
  const printedBonusActions = parseFeatures(sections.bonusActions).map((line) => line.name);

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

    traits: parseFeatures(sections.traits, printedAttacks, printedBonusActions),
    actions: parseFeatures(sections.actions, printedAttacks, printedBonusActions),
    bonusActions: parseFeatures(sections.bonusActions, printedAttacks, printedBonusActions),
    reactions: parseFeatures(sections.reactions, printedAttacks, printedBonusActions),
    legendaryActions: parseFeatures(sections.legendaryActions, printedAttacks, printedBonusActions),
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
