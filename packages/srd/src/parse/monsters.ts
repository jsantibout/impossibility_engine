import {
  CreatureSizeSchema,
  MonsterAcAddendSchema,
  MonsterAttackSchema,
  MonsterCastLineSchema,
  MonsterRollAddendSchema,
  MonsterSaveSchema,
  MonsterSchema,
  MonsterFormsSchema,
  MonsterSpellcastingSchema,
  MonsterTeleportSchema,
  slugify,
  type Feature,
  type Monster,
  type MonsterAcAddend,
  type MonsterAttack,
  type MonsterCastLine,
  type MonsterDamage,
  type MonsterForm,
  type MonsterForms,
  type MonsterMultiattack,
  type MonsterMultiattackEntry,
  type MonsterRecharge,
  type MonsterRollAddend,
  type MonsterSave,
  type MonsterSpell,
  type MonsterSpellcasting,
  type MonsterTeleport,
  type MonsterTrait,
  type ParseOutput,
  type ParseProblem,
} from '../schemas.js';
import { ABILITY_OVERRIDES } from './overrides.js';
import { parsePrintedSave } from './printed-save.js';
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
 * The save a line forces, read as an effect list by `parsePrintedSave` in
 * `printed-save.ts` — the ability, the DC, the damage where there is damage,
 * and the regular clauses a failure prints besides it, with every sentence it
 * did not read carried in `handedOver`.
 *
 * Null for every line that does not begin with the template, and for the
 * families that reader refuses whole. Those are still carried verbatim and
 * still handed to a DM, exactly as an unread rider is.
 *
 * **Never asked of a line that prints an attack roll**, and that is
 * structural rather than incidental: a save printed after a hit is the
 * attack's rider, and `readPrintedRider` is the one reader of it. Two readers
 * for one clause would be two answers to it.
 */
export function parseSaveLine(text: string): MonsterSave | null {
  const save = parsePrintedSave(text);
  if (save === null) return null;
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

/**
 * SRD Blood Frenzy: "The sahuagin has Advantage on attack rolls against any
 * creature that doesn't have all its Hit Points."
 *
 * Anchored end to end like everything else, which is what keeps it apart from
 * {@link BLOODIED_ADVANTAGE}: both sentences are Advantage on attack rolls and
 * they differ in *whose* Hit Points are being read. A sentence read down to the
 * words they share would give a sahuagin Advantage on every swing it made.
 */
const BLOOD_FRENZY = new RegExp(
  `^${SUBJECT} has Advantage on attack rolls against any creature that doesn['’]t have all its Hit Points\\.$`,
);

/**
 * The lists of rolls the book actually prints in a sentence of this shape, in
 * its own nouns.
 *
 * A closed alternation for {@link BLOODIED_ADVANTAGE}'s reason: a third
 * breadth nobody printed must not be readable out of a longer sentence.
 */
const ROLL_LIST = 'attack rolls and saving throws|attack rolls|saving throws';

/** The same three phrasings, in the kind's own words. */
const ROLL_LISTS: Readonly<Record<string, readonly ('attack-roll' | 'saving-throw')[]>> = {
  'attack rolls': ['attack-roll'],
  'saving throws': ['saving-throw'],
  'attack rolls and saving throws': ['attack-roll', 'saving-throw'],
};

/**
 * SRD Aura of Authority: "While in a 10-foot Emanation originating from the
 * hobgoblin, the hobgoblin and its allies have Advantage on attack rolls and
 * saving throws, provided the hobgoblin doesn't have the Incapacitated
 * condition."
 *
 * The Incapacitated clause is **required** rather than optional, for the
 * reason every regex here is anchored: an aura without a gate is a different
 * rule, and reading the clause away would hand a Stunned captain's allies a
 * benefit the book takes off them.
 */
const ALLY_AURA = new RegExp(
  `^While in a (\\d+)-foot Emanation originating from ${SUBJECT}, ${SUBJECT} and its allies have ` +
    `Advantage on (${ROLL_LIST}), provided ${SUBJECT} doesn['’]t have the Incapacitated condition\\.$`,
);

/**
 * SRD Agile, on the Deer and the Rat: "The deer doesn't provoke an Opportunity
 * Attack when it moves out of an enemy's reach."
 *
 * {@link FLYBY} with one word changed, and the word is the whole rule — so
 * they are two patterns rather than an alternation, and a block printing one
 * never reaches the other's kind.
 */
const AGILE = new RegExp(
  `^${SUBJECT} doesn['’]t provoke an Opportunity Attack when it moves out of an enemy['’]s reach\\.$`,
);

/**
 * SRD Running Leap: "With a 10-foot running start, the lion can Long Jump up
 * to 25 feet."
 *
 * Both numbers, because both are the rule: the jump is bought with the first
 * and reaches the second. {@link STANDING_LEAP} is the sentence that says the
 * opposite and is matched separately.
 */
const RUNNING_LEAP = new RegExp(
  `^With a (\\d+)-foot running start, ${SUBJECT} can Long Jump up to (\\d+) feet\\.$`,
);

/** SRD Siege Monster: "The elemental deals double damage to objects and structures." */
const SIEGE_MONSTER = new RegExp(
  `^${SUBJECT} deals double damage to objects and structures\\.$`,
);

/**
 * SRD Aberrant Ground: "The ground in a 10-foot Emanation originating from the
 * mouther is Difficult Terrain."
 *
 * One sentence and nothing else in it, which is what makes the Emanation
 * readable: a second clause about what the ground also does would be a rule
 * the kind carries no field for.
 */
const ABERRANT_GROUND = new RegExp(
  `^The ground in a (\\d+)-foot Emanation originating from ${SUBJECT} is Difficult Terrain\\.$`,
);

/**
 * SRD Lightning Absorption: "Whenever the golem is subjected to Lightning
 * damage, it regains a number of Hit Points equal to the Lightning damage
 * dealt."
 *
 * The back-reference is the anchor doing its work: the type absorbed and the
 * type read off the blow are the same word in both blocks that print this, and
 * a sentence that named two would be a rule nobody wrote.
 */
const ABSORBS_DAMAGE = new RegExp(
  `^Whenever ${SUBJECT} is subjected to (\\w+) damage, it regains a number of Hit Points ` +
    `equal to the \\1 damage dealt\\.$`,
);

/**
 * SRD Aversion to Fire: "If the golem takes Fire damage, it has Disadvantage
 * on attack rolls and ability checks until the end of its next turn."
 *
 * The span is matched and not captured, for {@link MonsterTraitSchema}'s
 * stated reason at the kind: one block prints this and prints one span.
 */
const AVERSION_TO_A_TYPE = new RegExp(
  `^If ${SUBJECT} takes (\\w+) damage, it has Disadvantage on ` +
    `(attack rolls and ability checks|ability checks and attack rolls|attack rolls|ability checks) ` +
    `until the end of its next turn\\.$`,
);

/** The book's other order for the same two nouns, in the kind's own words. */
const PENALISED_ROLLS: Readonly<Record<string, readonly ('ability-check' | 'attack-roll')[]>> = {
  'attack rolls': ['attack-roll'],
  'ability checks': ['ability-check'],
  // Listed in the glossary's order whichever order the block printed them in,
  // because the kind is a set and a log that reordered with the sentence would
  // compare two spellings of one rule as two rules.
  'attack rolls and ability checks': ['ability-check', 'attack-roll'],
  'ability checks and attack rolls': ['ability-check', 'attack-roll'],
};

/** The words the book writes a damage type in, lower-cased, or null. */
const damageTypeOf = (printed: string): string | null => {
  const word = printed.toLowerCase();
  return DAMAGE_TYPES.some((known) => known === word) ? word : null;
};

/**
 * SRD Fire Aura: "At the end of each of the azer's turns, each creature of the
 * azer's choice in a 5-foot Emanation originating from the azer takes 5 (1d10)
 * Fire damage unless the azer has the Incapacitated condition."
 *
 * The choice clause and the Incapacitated clause are **captured** rather than
 * matched loosely, because the book prints each of them on some blocks and not
 * on others and either read away is a rule nobody printed: a Balor that chose
 * its victims, or an Azer that burned while Stunned.
 *
 * Anchored end to end like everything else, which is what refuses the Fire
 * Elemental: its sentence ends "Creatures and flammable objects in the
 * Emanation start burning", and there is no burning here.
 */
const EMANATION_DAMAGE = new RegExp(
  `^At the (start|end) of each of ${SUBJECT} turns, each creature (of ${SUBJECT} choice )?` +
    `in a (\\d+)-foot Emanation originating from ${SUBJECT} takes \\d+ \\((\\d+d\\d+)\\) (\\w+) damage` +
    `( unless ${SUBJECT} has the Incapacitated condition)?\\.$`,
);

/**
 * SRD Barbed Hide: "At the start of each of its turns, the devil deals 5
 * (1d10) Piercing damage to any creature it is grappling or any creature
 * grappling it."
 *
 * Both directions of the hold, because the sentence prints both and a reader
 * that took one would be enforcing half of it.
 */
const HELD_CREATURE_DAMAGE = new RegExp(
  `^At the (start|end) of each of its turns, ${SUBJECT} deals \\d+ \\((\\d+d\\d+)\\) (\\w+) damage ` +
    `to any creature it is grappling or any creature grappling it\\.$`,
);

/**
 * SRD Freeze: "If the elemental takes Cold damage, its Speed decreases by 20
 * feet until the end of its next turn."
 *
 * {@link AVERSION_TO_A_TYPE}'s sibling, and anchored end to end for the same
 * reason: the span is the sentence's and a line naming another is a different
 * rule.
 */
const SPEED_CUT_BY_A_TYPE = new RegExp(
  `^If ${SUBJECT} takes (\\w+) damage, its Speed decreases by (\\d+) feet until the end of its next turn\\.$`,
);

/**
 * SRD Blurred Form: "Attack rolls against the mephit are made with
 * Disadvantage unless the mephit has the Incapacitated condition."
 *
 * The Incapacitated clause is required, for {@link ALLY_AURA}'s reason: a
 * blur without a gate is a different rule, and reading the clause away would
 * keep a Stunned mephit hard to hit.
 */
const BLURRED_FORM = new RegExp(
  `^Attack rolls against ${SUBJECT} are made with Disadvantage unless ${SUBJECT} ` +
    `has the Incapacitated condition\\.$`,
);

/**
 * SRD Beast of Burden: "The mule counts as one size larger for the purpose of
 * determining its carrying capacity."
 *
 * The book writes the step in words and prints exactly one of them, so the
 * word is matched and the number it stands for is the shape.
 */
const CARRIES_AS_A_LARGER_CREATURE = new RegExp(
  `^${SUBJECT} counts as one size larger for the purpose of determining its carrying capacity\\.$`,
);

/**
 * The sentences the parser reads so that the **table** gets them, and that no
 * rule will ever consult.
 *
 * `docs/design/content.md` settles the test — "a table fact that a rule then
 * reads is a debt; a table fact nothing reads afterwards is a handover" — and
 * every regex below is on the second side of it. They are anchored exactly as
 * hard as the rest: a sentence that says one more thing than the one quoted is
 * a different sentence and gets nothing, because a kind is a claim about what
 * was read and not a label somebody stuck on a heading.
 *
 * Each of them is named in `HANDOVER_TRAIT_KINDS`, which carries the reason in
 * the sentence's own terms and is pinned the opposite way round from the
 * reader roster: a kind on that list must be named **nowhere** in
 * `packages/engine/src`, because a handover with a reader is a mislabelled
 * debt.
 */
const HANDOVERS: readonly (readonly [RegExp, MonsterTrait['kind']])[] = [
  // SRD Mimicry, two sentences at two DCs: the hag's voices and the raven's
  // whisper. What a mimic *is* is the same either way, and the check is the
  // table's to call for.
  [
    new RegExp(
      `^${SUBJECT} can mimic animal sounds and humanoid voices\\. A creature that hears the sounds ` +
        `can tell they are imitations only with a successful DC \\d+ Wisdom \\(Insight\\) check\\.$`,
    ),
    'mimics-sounds',
  ],
  [
    new RegExp(
      `^${SUBJECT} can mimic simple sounds it has heard, such as a whisper or chitter\\. ` +
        `A hearer can discern the sounds are imitations with a successful DC \\d+ Wisdom \\(Insight\\) check\\.$`,
    ),
    'mimics-sounds',
  ],

  // SRD Telepathic Bond, and SRD Vampiric Connection which is that bond with
  // a second clause: the master sees through the familiar's eyes. Two kinds,
  // because they are two sentences and the second says more.
  [
    new RegExp(
      `^While ${SUBJECT} is on the same plane of existence as its master, the two of them can ` +
        `communicate telepathically with each other\\.$`,
    ),
    'speaks-telepathically-with-its-master',
  ],
  [
    new RegExp(
      `^While ${SUBJECT} are on the same plane of existence, the vampire can communicate with the ` +
        `familiar telepathically, and the vampire can perceive through the familiar['’]s senses\\.$`,
    ),
    'is-perceived-through-by-its-master',
  ],

  // SRD Shark Telepathy.
  [
    new RegExp(
      `^${SUBJECT} can magically control [a-z]+ within \\d+ feet of itself, using a special telepathy\\.$`,
    ),
    'controls-a-kind-of-creature',
  ],

  // SRD Iron Scent and SRD Treasure Sense.
  [
    new RegExp(`^${SUBJECT} can pinpoint the location of [a-z ]+ within \\d+ feet of itself\\.$`),
    'pinpoints-a-substance',
  ],

  // SRD Speak with Beasts and Plants.
  [
    new RegExp(
      `^${SUBJECT} can communicate with Beasts and Plants as if they shared a language\\.$`,
    ),
    'speaks-with-a-kind-of-creature',
  ],

  // SRD Ethereal Sight, printed two ways: the ghost looks one way and the
  // phase spider both.
  [
    new RegExp(
      `^${SUBJECT} can see \\d+ feet into the Ethereal Plane (?:when it is on|while on) the ` +
        `Material Plane(?: and vice versa)?\\.$`,
    ),
    'sees-into-another-plane',
  ],

  // SRD Transparent.
  [
    new RegExp(
      `^Even when ${SUBJECT} is in plain sight, a creature must succeed on a DC \\d+ Wisdom ` +
        `\\(Perception\\) check to notice ${SUBJECT} if the creature hasn['’]t witnessed ` +
        `${SUBJECT} move or otherwise act\\.$`,
    ),
    'goes-unnoticed-until-it-moves',
  ],

  // SRD Shielded Mind.
  [
    new RegExp(
      `^${SUBJECT}['’]s thoughts can['’]t be read by any means, and other creatures can ` +
        `communicate with it telepathically only if it allows them\\.$`,
    ),
    'thoughts-cannot-be-read',
  ],

  // SRD Immutable Form.
  [new RegExp(`^${SUBJECT} can['’]t shape-shift\\.$`), 'cannot-shape-shift'],

  // SRD Diabolical Restoration and SRD Hellish Restoration.
  [
    new RegExp(
      `^If ${SUBJECT} dies outside the Nine Hells, its body disappears in sulfurous smoke, and it ` +
        `gains a new body instantly, reviving with all its Hit Points somewhere in the Nine Hells\\.$`,
    ),
    'revives-on-another-plane',
  ],
  [
    new RegExp(
      `^If ${SUBJECT} dies in the Nine Hells, it revives with all its Hit Points in \\d+d\\d+ days ` +
        `unless it is killed by a creature under the effects of a _Bless_ spell or its remains are ` +
        `sprinkled with Holy Water\\.$`,
    ),
    'revives-on-another-plane',
  ],

  // SRD Sense Magic.
  [
    new RegExp(
      `^${SUBJECT} senses magic within \\d+ feet of itself\\. This trait otherwise works like the ` +
        `_Detect Magic_ spell but isn['’]t itself magical\\.$`,
    ),
    'senses-magic-nearby',
  ],

  // SRD Training.
  [
    new RegExp(
      `^${SUBJECT} has proficiency in one skill of the GM['’]s choice and has Advantage whenever ` +
        `it makes an ability check using that skill\\.$`,
    ),
    'has-a-skill-the-gm-chooses',
  ],

  // SRD Draconic Origin.
  [
    new RegExp(
      `^${SUBJECT} is related to a type of dragon associated with one of the following damage types ` +
        `\\(GM['’]s choice\\): [A-Za-z, ]+\\. This choice affects other aspects of the stat block\\.$`,
    ),
    'has-a-damage-type-the-gm-chooses',
  ],

  // SRD Water Susceptibility and SRD Running Water.
  [
    new RegExp(
      `^${SUBJECT} takes \\d+ \\(\\d+d\\d+\\) \\w+ damage for every \\d+ feet ${SUBJECT} moves in ` +
        `water or for every gallon of water splashed on it\\.$`,
    ),
    'is-hurt-by-water',
  ],
  [
    new RegExp(`^${SUBJECT} takes \\d+ \\w+ damage if it ends its turn in running water\\.$`),
    'is-hurt-by-water',
  ],

  // SRD Forbiddance.
  [
    new RegExp(
      `^${SUBJECT} can['’]t enter a residence without an invitation from an occupant\\.$`,
    ),
    'cannot-enter-a-home-uninvited',
  ],

  // SRD Vampire Weakness: a heading, and a rule of nothing on its own.
  [new RegExp(`^${SUBJECT} has these weaknesses:$`), 'a-heading-over-the-lines-that-follow'],

  // SRD Goblin Boss, Redirect Attack. Read whole, and every clause of it is
  // why: the window is a swing **before** the roll is decided, and the
  // response swaps two creatures' spaces and re-aims the attack.
  [
    new RegExp(
      `^_Trigger:_ A creature ${SUBJECT} can see makes an attack roll against it\\. ` +
        `_Response:_ ${SUBJECT} chooses a Small or Medium ally within \\d+ feet of itself\\. ` +
        `${SUBJECT} and that ally swap places, and the ally becomes the target of the attack ` +
        `instead\\.$`,
    ),
    'swaps-places-with-an-ally-to-take-an-attack',
  ],

  // SRD Black Pudding and SRD Ochre Jelly, Split. Two creatures that did not
  // exist a moment ago, in the Initiative order, sharing the original's Hit
  // Points.
  [
    new RegExp(
      `^_Trigger:_ While ${SUBJECT} is Large or Medium and has \\d+\\+ Hit Points, it becomes ` +
        `Bloodied or is subjected to Lightning or Slashing damage\\. _Response:_ ${SUBJECT} ` +
        `splits into two new \\*\\*${SUBJECT}\\*\\*\\. Each new ${SUBJECT} is one size smaller ` +
        `than the original ${SUBJECT} and acts on its Initiative\\. The original ${SUBJECT}['’]s ` +
        `Hit Points are divided evenly between the new ${SUBJECT} \\(round down\\)\\.$`,
    ),
    'splits-into-two-creatures',
  ],

  // SRD Shrieker Fungus, Shriek. A noise, which nothing in this engine hears.
  [
    new RegExp(
      `^_Trigger:_ A creature or a source of Bright Light moves within \\d+ feet of ${SUBJECT}\\. ` +
        `_Response:_ ${SUBJECT} emits a shriek audible within \\d+ feet of itself for ` +
        `\\d+ minutes? or until ${SUBJECT} dies\\.$`,
    ),
    'makes-a-noise',
  ],

  // ------------------------------------------------------------------
  // The sentences that describe a **world** rather than a creature: a gap
  // narrower than five feet, solid rock, a web, a sheet of ice, a heart. The
  // scene holds creatures, landmarks, declared objects and declared regions
  // and no substance at all, so each of these names a fact nothing can be
  // told and no rule would read. See `HANDOVER_TRAIT_KINDS` for the reason
  // per kind, and the note on this table for why they are matched last.
  // ------------------------------------------------------------------

  // SRD Amorphous, on four blocks, and SRD Compression on the octopus: one
  // sentence under two headings.
  [
    new RegExp(
      `^${SUBJECT} can move through a space as narrow as 1 inch without expending extra movement ` +
        `to do so\\.$`,
    ),
    'moves-through-a-one-inch-gap',
  ],

  // SRD Air Form and SRD Water Form — the same two clauses, and the book
  // writes "a creature's space" for one elemental and "an enemy's space" for
  // the other two.
  [
    new RegExp(
      `^${SUBJECT} can enter an? (?:creature|enemy)['’]s space and stop there\\. It can move ` +
        `through a space as narrow as 1 inch without expending extra movement to do so\\.$`,
    ),
    'enters-a-creature-space-and-a-one-inch-gap',
  ],

  // SRD Fire Form: those two clauses in the other order, with damage on the
  // end of it. Its own entry because a regex loose enough to read it as the
  // one above would have dropped the damage without saying so.
  [
    new RegExp(
      `^${SUBJECT} can move through a space as narrow as 1 inch without expending extra movement ` +
        `to do so, and it can enter a creature['’]s space and stop there\\. The first time it ` +
        `enters a creature['’]s space on a turn, that creature takes \\d+ \\(\\d+d\\d+\\) \\w+ ` +
        `damage\\.$`,
    ),
    'burns-a-creature-whose-space-it-enters',
  ],

  // SRD Incorporeal Movement, on the ghost, the specter, the wisp and the
  // wraith.
  [
    new RegExp(
      `^${SUBJECT} can move through other creatures and objects as if they were Difficult ` +
        `Terrain\\. It takes \\d+ \\(\\d+d\\d+\\) \\w+ damage if it ends its turn inside an ` +
        `object\\.$`,
    ),
    'moves-through-creatures-and-objects',
  ],

  // SRD Earth Glide.
  [
    new RegExp(
      `^${SUBJECT} can burrow through nonmagical, unworked earth and stone\\. While doing so, ` +
        `${SUBJECT} doesn['’]t disturb the material it moves through\\.$`,
    ),
    'burrows-through-earth-and-stone',
  ],

  // SRD Tunneler.
  [
    new RegExp(
      `^${SUBJECT} can burrow through solid rock at half its Burrow Speed and leaves a ` +
        `\\d+-foot-diameter tunnel in its wake\\.$`,
    ),
    'burrows-through-solid-rock',
  ],

  // SRD Web Walker. The second clause names the creature again on four blocks
  // and says "it" on the fifth.
  [
    new RegExp(
      `^${SUBJECT} ignores movement restrictions caused by webs, and (?:it|${SUBJECT}) knows the ` +
        `location of any other creature in contact with the same web\\.$`,
    ),
    'ignores-a-webs-restrictions',
  ],

  // SRD Ice Walk. Not SRD Spider Climb: the surfaces are named by what they
  // are made of, and a patch of Difficult Terrain here has no composition.
  [
    new RegExp(
      `^${SUBJECT} can move across and climb icy surfaces without needing to make an ability ` +
        `check\\. Additionally, Difficult Terrain composed of ice or snow doesn['’]t cost it ` +
        `extra movement\\.$`,
    ),
    'walks-on-ice',
  ],

  // SRD Ephemeral.
  [new RegExp(`^${SUBJECT} can['’]t wear or carry anything\\.$`), 'cannot-wear-or-carry-anything'],

  // SRD Adhesive. The grapple and its DC are rules the engine holds; one
  // thing *touching* another is not.
  [
    new RegExp(
      `^${SUBJECT} adheres to anything that touches it\\. A \\w+ or smaller creature adhered to ` +
        `${SUBJECT} has the Grappled condition \\(escape DC \\d+\\)\\. Ability checks made to ` +
        `escape this grapple have Disadvantage\\.$`,
    ),
    'adheres-to-what-touches-it',
  ],

  // SRD Confer Fire Resistance. Nothing here is ridden.
  [
    new RegExp(
      `^${SUBJECT} can grant Resistance to \\w+ damage to a rider while it is on ${SUBJECT}\\.$`,
    ),
    'confers-a-resistance-to-a-rider',
  ],

  // SRD Stake to the Heart, printed twice as two different rules: the spawn
  // is destroyed and the vampire is Paralyzed until the weapon is drawn out.
  [
    new RegExp(
      `^${SUBJECT} is destroyed if a weapon that deals \\w+ damage is driven into ` +
        `${SUBJECT}['’]s heart while ${SUBJECT} has the Incapacitated condition\\.$`,
    ),
    'destroyed-by-a-stake-through-the-heart',
  ],
  [
    new RegExp(
      `^If a weapon that deals \\w+ damage is driven into ${SUBJECT}['’]s heart while ` +
        `${SUBJECT} has the Incapacitated condition in its resting place, ${SUBJECT} has the ` +
        `Paralyzed condition until the weapon is removed\\.$`,
    ),
    'paralyzed-by-a-stake-through-the-heart',
  ],
];

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
  if (AGILE.test(text)) return { kind: 'does-not-provoke-when-leaving-reach' };

  const running = RUNNING_LEAP.exec(text);
  if (running !== null) {
    return {
      kind: 'long-jump-with-a-running-start',
      runningStartFeet: Number(running[1]),
      longJumpFeet: Number(running[2]),
    };
  }

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

  // Asked **after** the bloodied sentence, which is belt and braces rather
  // than a dependency: both are Advantage on attack rolls and each is anchored
  // from the first word, so neither order reads one as the other.
  if (BLOOD_FRENZY.test(text)) return { kind: 'advantage-against-a-wounded-target' };
  if (SIEGE_MONSTER.test(text)) return { kind: 'deals-double-damage-to-objects' };

  const aura = ALLY_AURA.exec(text);
  if (aura !== null) {
    const rolls = ROLL_LISTS[aura[2]!];
    if (rolls !== undefined) {
      return {
        kind: 'allies-in-emanation-have-advantage',
        feet: Number(aura[1]),
        rolls: [...rolls],
      };
    }
  }

  const ground = ABERRANT_GROUND.exec(text);
  if (ground !== null) {
    return { kind: 'emanation-is-difficult-terrain', feet: Number(ground[1]) };
  }

  const absorbs = ABSORBS_DAMAGE.exec(text);
  if (absorbs !== null) {
    const damageType = damageTypeOf(absorbs[1]!);
    if (damageType !== null) return { kind: 'absorbs-a-damage-type', damageType };
  }

  const aversion = AVERSION_TO_A_TYPE.exec(text);
  if (aversion !== null) {
    const damageType = damageTypeOf(aversion[1]!);
    const rolls = PENALISED_ROLLS[aversion[2]!];
    if (damageType !== null && rolls !== undefined) {
      return { kind: 'penalised-after-taking-a-damage-type', damageType, rolls: [...rolls] };
    }
  }

  const slowed = SPEED_CUT_BY_A_TYPE.exec(text);
  if (slowed !== null) {
    const damageType = damageTypeOf(slowed[1]!);
    if (damageType !== null) {
      return { kind: 'speed-cut-after-taking-a-damage-type', damageType, feet: Number(slowed[2]) };
    }
  }

  const burns = EMANATION_DAMAGE.exec(text);
  if (burns !== null) {
    const damageType = damageTypeOf(burns[5]!);
    if (damageType !== null) {
      return {
        kind: 'damages-creatures-in-an-emanation',
        moment: burns[1] as 'start' | 'end',
        feet: Number(burns[3]),
        dice: burns[4]!,
        damageType,
        chosen: burns[2] !== undefined,
        unlessIncapacitated: burns[6] !== undefined,
      };
    }
  }

  const barbs = HELD_CREATURE_DAMAGE.exec(text);
  if (barbs !== null) {
    const damageType = damageTypeOf(barbs[3]!);
    if (damageType !== null) {
      return {
        kind: 'damages-creatures-it-is-holding',
        moment: barbs[1] as 'start' | 'end',
        dice: barbs[2]!,
        damageType,
      };
    }
  }

  if (BLURRED_FORM.test(text)) return { kind: 'disadvantage-on-attacks-against-it' };
  if (CARRIES_AS_A_LARGER_CREATURE.test(text)) {
    return { kind: 'carries-as-a-larger-creature', sizesLarger: 1 };
  }

  // Last, because every sentence above states a mechanic and these state
  // none: a handover that matched first would be a rule read as fiction.
  for (const [pattern, kind] of HANDOVERS) {
    if (pattern.test(text)) return { kind } as MonsterTrait;
  }

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

/**
 * The book's **fourth** opening, matched end to end.
 *
 * "The priest casts _Bless, Dispel Magic, Healing Word,_ or _Lesser
 * Restoration,_ using the same spellcasting ability as Spellcasting." "The
 * mephit casts the _Sleep_ spell, requiring no spell components and using
 * Charisma as the spellcasting ability (spell save DC 10)."
 *
 * Three clauses vary and are all optional: the word "the" and the noun
 * "spell" a single-spell line wraps its name in, the components the casting
 * does without, and the printed save DC. The ability clause is the one that
 * says something the other opening's does not — "the same spellcasting ability
 * as Spellcasting" is a **reference** to another line of the same block, and
 * it is carried as one.
 *
 * **A fourth clause varies and is a field rather than a refusal:** "on
 * itself". SRD Imp, Quasit and Sprite print "The imp casts _Invisibility_ **on
 * itself**" and SRD Oni prints it under Bonus Actions — a target the sentence
 * fixes rather than one the caller chooses, which is one flag and no second
 * shape. Every other word of those four lines is what every cast line says.
 *
 * **And the word the book hyphenated at a line break is the same word.** SRD
 * Imp prints "using Charisma as the spell-casting ability", where the hyphen
 * is typesetting rather than content — the reading `spellIdOf` already takes
 * of the Druid's "Long-strider".
 *
 * **What the anchors refuse is the point of them.** SRD Vampire's Beguile and
 * SRD Mummy's Dread Command each print a second sentence about a second rule;
 * SRD Unicorn's Blessing touches a creature first and names a target; SRD
 * Lich's Protective Magic casts "in response to the spell's trigger". Every
 * one of those is a clause this shape has no field for, and a line read down
 * to the part that fits is a creature doing something nobody printed — which
 * is why the target clause is anchored to the two words the book prints and
 * not to a target at all.
 */
const CAST_LINE = new RegExp(
  `^The ${SUBJECT} casts (?:the )?(.+?)(?: spell)?( on itself)?,? ` +
    `(?:requiring no [A-Za-z ]+ components and )?` +
    `using (?:(the same) spellcasting ability as Spellcasting` +
    `|(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) as (?:the )?spell-?casting ability)` +
    `(?: \\(spell save DC (\\d+)\\))?\\.$`,
);

/**
 * The menu one cast line offers, consumed to the last character or refused.
 *
 * The grammar is italic groups joined by `, `, `, or ` or ` or `, and a group
 * may hold several names because the book italicises a run of them together as
 * readily as one at a time: `_Bless_, _Lesser Restoration_, or _Sanctuary_`
 * and `_Bless, Dispel Magic, Healing Word,_ or _Lesser Restoration,_` are the
 * same menu typeset two ways.
 *
 * **A trailing comma inside the italics is punctuation and not an empty
 * name** — the book closes the run with one — so it is dropped where it ends a
 * group and refused anywhere else, which is what keeps `_Bless, , Sanctuary_`
 * from reading as two spells.
 *
 * Refused whole on anything it cannot consume, on a name the SRD's own index
 * does not hold, and on a menu offering one spell twice: a duplicate is two
 * routes to one spell and the engine picks between them without being asked.
 */
function readCastMenu(menu: string): string[] | null {
  const names: string[] = [];
  let rest = menu;

  while (rest.length > 0) {
    const group = /^_([^_]+)_/.exec(rest);
    if (group === null) return null;
    rest = rest.slice(group[0].length);

    const inside = group[1]!.split(',').map((name) => name.trim());
    for (const [at, name] of inside.entries()) {
      // The run's closing comma, which the book prints inside the italics.
      if (name === '' && at === inside.length - 1 && inside.length > 1) continue;
      if (name === '') return null;
      names.push(name);
    }

    if (rest === '') break;
    const joiner = /^(?:,? or |, )/.exec(rest);
    if (joiner === null) return null;
    rest = rest.slice(joiner[0].length);
  }

  if (names.length === 0) return null;

  const ids: string[] = [];
  for (const name of names) {
    const spellId = spellIdOf(name);
    if (spellId === null) return null;
    ids.push(spellId);
  }
  // One spell at two places in one menu is two ways to choose it, and nothing
  // downstream could tell them apart. The SRD prints no such line.
  return new Set(ids).size === ids.length ? ids : null;
}

/**
 * The spells a line casts, or null for every other line in the book.
 *
 * Read off the **sentence** and never off the heading, which is the rule every
 * reader here follows. What the heading says is how often the line may be
 * taken, and that is `parseRecharge` and `parsePerDay`'s answer rather than
 * this one's.
 */
export function parseCastLine(text: string): MonsterCastLine | null {
  const matched = CAST_LINE.exec(text.replace(/\s+/g, ' ').trim());
  if (matched === null) return null;

  const spells = readCastMenu(matched[1]!);
  if (spells === null) return null;

  const stated = matched[4] === undefined ? undefined : ABILITY_KEYS[matched[4]];
  if (matched[4] !== undefined && stated === undefined) return null;

  const line = {
    spells,
    ability: stated ?? ('spellcasting' as const),
    // "on itself" — the two words the book prints, and the whole of what they
    // say. A target this line fixes is not a target the caller offers.
    ...(matched[2] === undefined ? {} : { selfOnly: true as const }),
    ...(matched[5] === undefined ? {} : { saveDc: Number(matched[5]) }),
  };

  // Validated rather than trusted, for the reason `parseSaveLine` validates
  // its own: a shape that does not satisfy its schema leaves the line prose.
  const checked = MonsterCastLineSchema.safeParse(line);
  return checked.success ? checked.data : null;
}

/**
 * SRD Blink Dog: "The dog teleports up to 40 feet to an unoccupied space it
 * can see." SRD Marilith and SRD Nalfeshnee print it at 120.
 *
 * Anchored end to end, which is what refuses the four longer sentences the
 * book writes about teleporting: the Lich's damage around the space it left,
 * the Solar's saving throw at the destination, the Balor's willing demon and
 * the Dryad's pair of trees. Each says something this shape has no field for.
 */
const TELEPORT_LINE = new RegExp(
  `^The ${SUBJECT} teleports up to (\\d+) feet to an unoccupied space it can see\\.$`,
);

/** Where this line teleports its creature, or null for every other line. */
export function parseTeleportLine(text: string): MonsterTeleport | null {
  const matched = TELEPORT_LINE.exec(text.replace(/\s+/g, ' ').trim());
  if (matched === null) return null;
  const checked = MonsterTeleportSchema.safeParse({
    feet: Number(matched[1]!),
    mustSee: true,
  });
  return checked.success ? checked.data : null;
}

/**
 * SRD Shape-Shift's first sentence, in the two openings the book writes it in:
 * "The werewolf shape-shifts **into** a Large wolf-humanoid hybrid or a Medium
 * wolf, or it returns to its true humanoid form" and "The imp shape-shifts
 * **to resemble** a rat (Speed 20 ft.), a raven (20 ft., Fly 60 ft.), or a
 * spider (20 ft., Climb 20 ft.), or it returns to its true form".
 *
 * Two captures: the alternatives, and the noun the book gives the form it
 * returns to. Anchored end to end, which is what refuses the Vampire's — its
 * sentence opens on a condition ("If the vampire isn't in sunlight or running
 * water") the engine cannot evaluate, and its line goes on to say the opposite
 * of what every other printing says about equipment.
 */
const SHAPE_SHIFT_LINE = new RegExp(
  `^The ${SUBJECT} shape-shifts (?:into|to resemble) (.+), or it returns to its ` +
    `(?:true |)([a-z]*) ?form\\.$`,
);

/**
 * One alternative of that sentence: an article, optional sizes, the noun, and
 * the Speeds two blocks print in brackets after it.
 *
 * The **last word** of the descriptor is the form's name, because that is what
 * the block's own headings gate on: "Large wolf-humanoid hybrid" is `hybrid`
 * and "Medium wolf" is `wolf`. A trailing "form" is dropped for the same
 * reason — SRD Werebear writes "a Large bear-humanoid hybrid form" and SRD
 * Wereboar writes the same alternative without the word.
 */
const FORM_ALTERNATIVE =
  /^an? ((?:(?:Tiny|Small|Medium|Large|Huge|Gargantuan)(?: or )?)*)\s*([A-Za-z-]+(?: [a-z-]+)*?)(?: form)?(?: while retaining its game statistics)?(?: \((.+)\))?$/;

/**
 * One Speed clause of such an alternative: "Speed 20 ft.", "Fly 60 ft.",
 * "Climb 20 ft.", "Swim 40 ft.", "Fly Speed 30 ft. [hover]".
 */
const FORM_SPEED = /^(?:(Fly|Climb|Swim|Burrow) )?(?:Speed )?(\d+) ft\.(?: \[hover\])?$/;

/**
 * The promises the book repeats under every printing of Shape-Shift, which
 * this engine honours by doing nothing.
 *
 * "Its game statistics, other than its size, are the same in each form" is the
 * sentence the `sizes` field above *is*; "Any equipment it is wearing or
 * carrying isn't transformed" is what the command already does by not touching
 * an inventory. A sentence not on this list is carried verbatim.
 */
const INERT_FORM_SENTENCES: readonly RegExp[] = [
  /^Its game statistics, other than its (?:size|speed), are the same in each form\.$/i,
  /^Other than its (?:size|speed), its game statistics are the same in each form\.$/i,
  /^Its game statistics are the same in each form, except for its (?:size|Speed)\.$/i,
  /^Any equipment it is wearing or carrying isn['’]t transformed\.$/i,
];

/**
 * A printed line's sentences, split where one ends and the next begins.
 *
 * On a full stop followed by a capital, which leaves "(Speed 20 ft.)" and
 * "(20 ft., Fly 60 ft.)" whole: every stop inside a Speed clause is followed
 * by a comma or a bracket.
 */
const formSentences = (text: string): readonly string[] =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=\.) (?=[A-Z])/)
    .map((one) => one.trim())
    .filter((one) => one !== '');

/**
 * One alternative's Speeds — null where the line prints none for it, and
 * `undefined` for a bracket this grammar could not read whole, which leaves
 * the whole line prose the way every other reader here does.
 */
function formSpeed(printed: string | undefined): MonsterForm['speed'] | undefined {
  if (printed === undefined) return null;
  const speed: {
    walk: number;
    burrow: number | null;
    climb: number | null;
    fly: number | null;
    swim: number | null;
    hover: boolean;
  } = { walk: 0, burrow: null, climb: null, fly: null, swim: null, hover: false };
  for (const clause of printed.split(', ')) {
    const matched = FORM_SPEED.exec(clause.trim());
    if (matched === null) return undefined;
    const feet = Number(matched[2]);
    if (matched[1] === undefined) speed.walk = feet;
    else speed[matched[1].toLowerCase() as 'burrow' | 'climb' | 'fly' | 'swim'] = feet;
  }
  return speed;
}

/**
 * The forms one line offers, or null for every line that offers none.
 *
 * SRD Shape-Shift and nothing else: read sentence by sentence, with the first
 * carrying the forms and every one after it either a promise the engine keeps
 * by doing nothing or a clause handed to the table verbatim.
 */
export function parseFormLine(text: string): MonsterForms | null {
  const sentences = formSentences(text);
  const first = sentences[0];
  if (first === undefined) return null;
  const matched = SHAPE_SHIFT_LINE.exec(first);
  if (matched === null) return null;

  // "a Large wolf-humanoid hybrid or a Medium wolf" — the book separates the
  // alternatives with a comma, with "or", or with both, and **every one of
  // them opens on an article**. Splitting on the word alone would have cut
  // "a Medium or Small Humanoid" in half, which is one form offered at two
  // sizes rather than two forms; the same lookahead leaves the commas inside
  // a Speed bracket ("20 ft., Fly 60 ft.") alone.
  const alternatives = matched[1]!.split(/(?:, or |, | or )(?=an? )/);
  const forms: MonsterForm[] = [];
  for (const alternative of alternatives) {
    const read = FORM_ALTERNATIVE.exec(alternative.trim());
    if (read === null) return null;
    const words = read[2]!.trim().split(' ');
    const name = words[words.length - 1]!.toLowerCase();
    const speed = formSpeed(read[3]);
    if (speed === undefined) return null;
    forms.push({
      name,
      sizes: (read[1] ?? '')
        .split(' or ')
        .map((size) => size.trim().toLowerCase())
        .filter((size) => size !== '')
        .map((size) => CreatureSizeSchema.parse(size)),
      speed,
    });
  }

  // "or it returns to its true humanoid form" — the noun where the book gives
  // one, and `true` where it does not. The block's own headings gate on it:
  // the Werewolf's Longbow is "(Humanoid or Hybrid Form Only)".
  forms.push({ name: matched[2] === '' ? 'true' : matched[2]!.toLowerCase(), sizes: [], speed: null });

  const handedOver = sentences
    .slice(1)
    .filter((sentence) => !INERT_FORM_SENTENCES.some((inert) => inert.test(sentence)));

  const checked = MonsterFormsSchema.safeParse({ forms, handedOver });
  return checked.success ? checked.data : null;
}

/**
 * SRD Werewolf: "Bite (**Wolf or Hybrid Form Only**)". The forms a heading
 * says its line may be used in, or null where it says nothing.
 *
 * Read off the name rather than the sentence, because that is where the book
 * prints it — the same place a recharge and a day's count are printed, and for
 * the same reason it is read here once: a name is what nothing downstream may
 * branch on.
 */
export function parseFormQualification(name: string): readonly string[] | null {
  const matched = /\(([A-Za-z]+(?: or [A-Za-z]+)*) Form Only\)\s*$/.exec(name);
  if (matched === null) return null;
  return matched[1]!.split(' or ').map((word) => word.toLowerCase());
}

/**
 * SRD Sphinx of Wonder: "_Trigger:_ The sphinx or another creature within 30
 * feet makes an ability check or a saving throw. _Response:_ The sphinx adds 2
 * to the roll."
 *
 * The book's `_Trigger:_` / `_Response:_` template, read for the one shape the
 * engine has a window for. The nine other lines that write it add to an
 * **Armour Class** against one attack — SRD Parry, SRD Riposte, the Mummy's
 * Whirlwind of Sand — which is a different instant and a rule nothing here
 * holds, so they are refused by the same anchors and stay prose.
 */
const ROLL_ADDEND_LINE = new RegExp(
  `^_Trigger:_ (?:The ${SUBJECT} or )?[Aa]nother creature within (\\d+) feet ` +
    `makes (.+?)\\. _Response:_ The ${SUBJECT} adds (\\d+) to the roll\\.$`,
);

/**
 * The D20 Tests one trigger phrase names, in the glossary's order.
 *
 * "an ability check or a saving throw" is two of the three; "a D20 Test" is
 * all three, which the rules glossary settles in as many words. Anything else
 * refuses the line, because a trigger read down to the rolls the reader
 * recognised is a Reaction offered at moments nobody printed.
 */
const ROLL_NAMES: Readonly<Record<string, readonly MonsterRollAddend['tests'][number][]>> = {
  'an ability check': ['ability-check'],
  'an attack roll': ['attack-roll'],
  'a saving throw': ['saving-throw'],
  'a D20 Test': ['ability-check', 'attack-roll', 'saving-throw'],
};

const ORDERED_ROLLS: readonly MonsterRollAddend['tests'][number][] = [
  'ability-check',
  'attack-roll',
  'saving-throw',
];

function readTriggeringRolls(phrase: string): MonsterRollAddend['tests'] | null {
  const named = new Set<MonsterRollAddend['tests'][number]>();
  for (const term of phrase.split(' or ')) {
    const rolls = ROLL_NAMES[term.trim()];
    if (rolls === undefined) return null;
    for (const roll of rolls) named.add(roll);
  }
  const tests = ORDERED_ROLLS.filter((roll) => named.has(roll));
  return tests.length === 0 ? null : tests;
}

/** The flat addend this Reaction puts on a roll, or null for every other line. */
export function parseRollAddendLine(text: string): MonsterRollAddend | null {
  const matched = ROLL_ADDEND_LINE.exec(text.replace(/\s+/g, ' ').trim());
  if (matched === null) return null;

  const tests = readTriggeringRolls(matched[2]!);
  if (tests === null) return null;

  const checked = MonsterRollAddendSchema.safeParse({
    addend: Number(matched[3]!),
    withinFeet: Number(matched[1]!),
    // "The sphinx **or** another creature": present, the holder's own roll is
    // one the trigger names; absent, the sentence is about somebody else only.
    includesSelf: matched[0]!.startsWith('_Trigger:_ The'),
    tests,
  });
  return checked.success ? checked.data : null;
}

/**
 * SRD Parry: "_Trigger:_ The knight is hit by a melee attack roll while
 * holding a weapon. _Response:_ The knight adds 2 to its AC against that
 * attack, possibly causing it to miss."
 *
 * The book's second `_Trigger:_` / `_Response:_` template and the commonest
 * one — seven blocks print it, five of them at CR 5 or below. It is read
 * because the engine holds the instant it names: `hit-by-attack` is SRD
 * *Shield*'s own window, where the roll is known and the damage is not.
 *
 * Anchored end to end, which refuses the three lines that add a number to an
 * Armour Class and then say something else: the Pirate Captain's Riposte
 * swings back on a miss, the Mummy Lord's Whirlwind of Sand answers *any*
 * attack roll and teleports, and the Shield Guardian's Protection raises
 * somebody else's Armour Class until its next turn.
 */
const AC_ADDEND_LINE = new RegExp(
  `^_Trigger:_ The ${SUBJECT} is hit by a melee attack roll while holding a weapon\\. ` +
    `_Response:_ The ${SUBJECT} adds (\\d+) to its AC against that attack, ` +
    `possibly causing it to miss\\.$`,
);

/** What this Reaction adds to its Armour Class, or null for every other line. */
export function parseAcAddendLine(text: string): MonsterAcAddend | null {
  const matched = AC_ADDEND_LINE.exec(text.replace(/\s+/g, ' ').trim());
  if (matched === null) return null;

  const checked = MonsterAcAddendSchema.safeParse({
    addend: Number(matched[1]!),
    // Both printed by every line of this shape, and both anchored above — see
    // {@link MonsterAcAddendSchema} for why they are written down anyway.
    meleeOnly: true,
    requiresWeapon: true,
  });
  return checked.success ? checked.data : null;
}

/**
 * SRD Rust Monster, Reflexive Antennae: "_Trigger:_ An attack roll hits the
 * rust monster. _Response:_ The rust monster uses Antennae."
 *
 * The third `_Trigger:_` template the engine can read, and the first whose
 * *response* is another line of the same block rather than a rule. What is
 * read is the trigger — which is `hit-by-attack`, the window the two above it
 * answer — and the **name** of the line the response performs; what that line
 * does is that line's own business, and the SRD's is a save nothing reads yet.
 *
 * The capture is the shape a printed heading has: capitalised words, which is
 * the same claim `NAMES` makes below about a Multiattack's menu. Anchored end
 * to end, which refuses the Nalfeshnee's Pursuit — a different trigger, and a
 * clause about where the response may put the creature.
 */
const REACTION_USE_LINE = new RegExp(
  `^_Trigger:_ An attack roll hits ${SUBJECT}\\. ` +
    `_Response:_ ${SUBJECT} uses ([A-Z][A-Za-z'’-]*(?: [A-Z][A-Za-z'’-]*)*)\\.$`,
);

/** The printed line this Reaction performs, or null for every other line. */
export function parseReactionUseLine(text: string): string | null {
  const matched = REACTION_USE_LINE.exec(text.replace(/\s+/g, ' ').trim());
  return matched === null ? null : matched[1]!;
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

/**
 * Whether a save this reader read may live on the section it was printed
 * under.
 *
 * **The question the heading answers is what a line costs**, and a save
 * answers it two ways. A save with no {@link MonsterSave.trigger} is one a
 * creature *spends*: `forcePrintedSave` takes the Action or the Bonus Action
 * the heading names, and a trait carrying one would be a save nothing could
 * ever roll — which is why traits were held away from this reader entirely for
 * two batches. A save with a trigger is forced by a **moment** — a death, a
 * turn beginning inside an aura — and the fold raises it wherever it is
 * printed, so the heading is not its gate.
 *
 * So the gate is the trigger and not the section, and the SRD agrees from
 * both sides: every triggered line at this tier is a trait, and no trait
 * prints an untriggered save.
 */
function spendableSave(save: MonsterSave | null, spendable: boolean): MonsterSave | null {
  if (save === null) return null;
  return save.trigger !== undefined || spendable ? save : null;
}

function parseFeatures(
  lines: readonly string[],
  printedAttacks: readonly string[] = [],
  printedBonusActions: readonly string[] = [],
  /**
   * Whether a line under this heading is one a creature *spends* — Actions
   * and Bonus Actions. See {@link spendableSave}, which is what reads it.
   */
  spendable = false,
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
      const save = attack === null ? spendableSave(parseSaveLine(text), spendable) : null;
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
      // The book's fourth opening, read off the sentence like the other three
      // and asked of every line for the same reason: what a line says is not a
      // property of the heading it is printed under. **Including a heading
      // that prints a recharge** — how often a line may be taken is the
      // economy's answer, which `printed-line-expended` and `line_expended`
      // already give correctly for every line in the book.
      const casts = parseCastLine(text);
      const teleports = parseTeleportLine(text);
      // The book's fifth opening — a line that puts its creature into a form —
      // read off the sentence for the reason the four above are, and the
      // qualification the *heading* prints beside it, read off the name for
      // the reason the recharge and the day's count are.
      const forms = parseFormLine(text);
      const onlyInForms = parseFormQualification(current.name);
      const addsToRoll = parseRollAddendLine(text);
      // The Reactions section's other two templates, read off the sentence for
      // the reason every detector here is: SRD Parry's number goes on an
      // Armour Class, and SRD Reflexive Antennae's response is the name of
      // another line of this same block.
      const addsToAc = parseAcAddendLine(text);
      const usesLine = parseReactionUseLine(text);
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
        ...(casts === null ? {} : { casts }),
        ...(teleports === null ? {} : { teleports }),
        ...(forms === null ? {} : { forms }),
        ...(onlyInForms === null ? {} : { onlyInForms: [...onlyInForms] }),
        ...(addsToRoll === null ? {} : { addsToRoll }),
        ...(addsToAc === null ? {} : { addsToAc }),
        ...(usesLine === null ? {} : { usesLine }),
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
    actions: parseFeatures(sections.actions, printedAttacks, printedBonusActions, true),
    bonusActions: parseFeatures(sections.bonusActions, printedAttacks, printedBonusActions, true),
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
