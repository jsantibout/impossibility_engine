import { err, ok, type Ability, type Result, type Skill } from '@ie/shared';
import type { ArmorTraining } from './character.js';
import type { ClassDefinition } from './progression.js';

/**
 * SRD 5.2.1 "Multiclassing" — the rules that only exist between classes.
 *
 * Kept in its own module because none of it belongs to any one class. A class
 * definition says what a Fighter is; these say what happens when a Fighter is
 * also a Wizard, and every one of them reads *across* the set.
 *
 * The four that actually change arithmetic:
 *
 * | Rule | What it does |
 * |---|---|
 * | Prerequisites | 13 in the primary ability of every class involved |
 * | Proficiency Bonus | from **total** character level, never a class level |
 * | Spell slots | one combined table, from a weighted sum of caster levels |
 * | Proficiencies | a *subset* from every class after the first |
 *
 * Hit Dice are the fifth and are simpler than they look: they pool by die
 * type, so a Fighter/Paladin has ten d10s and a Cleric/Paladin has five d8s
 * and five d10s.
 */

/** One class and how many levels of it a character has. */
export interface ClassLevel {
  readonly classId: string;
  readonly level: number;
  readonly subclassId?: string;
}

/**
 * SRD: "you must have a score of at least 13 in the primary ability of the new
 * class and your current classes."
 *
 * Both directions, which is the half that gets forgotten: a Barbarian taking a
 * level of Druid needs Strength 13 *and* Wisdom 13, not just the Wisdom.
 */
export const MULTICLASS_MINIMUM = 13;

export function meetsPrerequisites(
  scores: Readonly<Record<Ability, number>>,
  classes: readonly ClassDefinition[],
): Result<true> {
  const short = classes.filter((c) => (scores[c.primaryAbility] ?? 0) < MULTICLASS_MINIMUM);
  if (short.length === 0) return ok(true);

  const named = short
    .map((c) => `${c.name} needs ${c.primaryAbility.toUpperCase()} ${MULTICLASS_MINIMUM}`)
    .join('; ');
  return err('multiclass_prerequisite', named);
}

/** SRD: "your character level is the total of all your class levels." */
export const characterLevel = (levels: readonly ClassLevel[]): number =>
  levels.reduce((sum, entry) => sum + entry.level, 0);

/**
 * How much each class contributes to the combined spell-slot table.
 *
 * SRD: all levels in Bard, Cleric, Druid, Sorcerer and Wizard; **half, rounded
 * up**, in Paladin and Ranger. A class that does not cast contributes nothing,
 * and the Warlock contributes nothing *here* because Pact Magic is its own
 * table — see {@link pactSlotsOf}.
 */
const FULL_CASTERS: ReadonlySet<string> = new Set([
  'bard',
  'cleric',
  'druid',
  'sorcerer',
  'wizard',
]);
const HALF_CASTERS: ReadonlySet<string> = new Set(['paladin', 'ranger']);

export function casterLevel(levels: readonly ClassLevel[]): number {
  let total = 0;
  for (const entry of levels) {
    if (FULL_CASTERS.has(entry.classId)) total += entry.level;
    else if (HALF_CASTERS.has(entry.classId)) total += Math.ceil(entry.level / 2);
  }
  return total;
}

/**
 * SRD "Multiclass Spellcaster: Spell Slots per Spell Level".
 *
 * **Not transcribed a second time.** The printed table is identical to the
 * full-caster table every single-class caster already uses, so it is read off
 * one of them and a test asserts the two agree. Two copies of the same twenty
 * rows is two chances to typo one of them.
 */
export function multiclassSlots(
  levels: readonly ClassLevel[],
  fullCasterTable: readonly (readonly number[])[],
): Record<number, number> {
  const level = casterLevel(levels);
  const slots: Record<number, number> = {};
  if (level < 1) return slots;

  const row = fullCasterTable[Math.min(level, fullCasterTable.length) - 1] ?? [];
  row.forEach((count, index) => {
    if (count > 0) slots[index + 1] = count;
  });
  return slots;
}

/**
 * Pact Magic slots, which stay separate.
 *
 * SRD keeps them out of the combined table and then lets them be spent on
 * each other's spells: "you can use the spell slots you gain from Pact Magic
 * to cast spells you have prepared from classes with the Spellcasting
 * feature, and you can use the spell slots you gain from the Spellcasting
 * feature to cast Warlock spells."
 *
 * So they are a second pool at a possibly different level, not more of the
 * first. A Warlock 3 / Wizard 3 has two level 2 Pact slots *and* four level 1
 * and two level 2 ordinary slots, and merging them would invent a slot.
 */
export function pactSlotsOf(
  levels: readonly ClassLevel[],
  warlockTable: readonly ClassDefinition['table'][number][],
): Record<number, number> {
  const warlock = levels.find((entry) => entry.classId === 'warlock');
  if (warlock === undefined || warlock.level < 1) return {};

  const row = warlockTable[warlock.level - 1]?.spellSlots ?? [];
  const slots: Record<number, number> = {};
  row.forEach((count, index) => {
    if (count > 0) slots[index + 1] = count;
  });
  return slots;
}

/**
 * Hit Dice, pooled by die type.
 *
 * SRD: "If these dice are the same die type, you can pool them together... If
 * your classes give you Hit Dice of different types, track them separately."
 */
export function hitDicePools(
  levels: readonly ClassLevel[],
  dieOf: (classId: string) => number | null,
): Record<number, number> {
  const pools: Record<number, number> = {};
  for (const entry of levels) {
    const die = dieOf(entry.classId);
    if (die === null) continue;
    pools[die] = (pools[die] ?? 0) + entry.level;
  }
  return pools;
}

/**
 * What a class grants when it is **not** your first.
 *
 * SRD: "you gain only some of the new class's starting proficiencies, as
 * detailed in each class's description." Transcribed from each class's "As a
 * Multiclass Character" section, which is the only place the SRD says it.
 *
 * The pattern worth seeing: nobody gets saving throw proficiencies, nobody
 * gets the full skill list, and the three classes that grant nothing but a
 * Hit Die are the three whose power is entirely in their features — Monk,
 * Sorcerer and Wizard.
 */
export interface MulticlassGrant {
  /** Weapon categories, in the same vocabulary a class definition uses. */
  readonly weapons: readonly string[];
  readonly armorTraining: ArmorTraining;
  /** How many skills the character chooses, and from where. */
  readonly skills?: { readonly choose: number; readonly from?: readonly Skill[] };
  /** Tools granted outright, by name as the SRD prints them. */
  readonly tools: readonly string[];
}

const NONE: ArmorTraining = { light: false, medium: false, heavy: false, shields: false };
const LIGHT: ArmorTraining = { ...NONE, light: true };
const LIGHT_SHIELDS: ArmorTraining = { ...LIGHT, shields: true };
const LIGHT_MEDIUM_SHIELDS: ArmorTraining = { ...LIGHT_SHIELDS, medium: true };
const SHIELDS_ONLY: ArmorTraining = { ...NONE, shields: true };

export const MULTICLASS_GRANTS: Readonly<Record<string, MulticlassGrant>> = {
  barbarian: { weapons: ['martial'], armorTraining: SHIELDS_ONLY, tools: [] },
  bard: {
    weapons: [],
    armorTraining: LIGHT,
    skills: { choose: 1 },
    tools: ['Musical Instrument'],
  },
  cleric: { weapons: [], armorTraining: LIGHT_MEDIUM_SHIELDS, tools: [] },
  druid: { weapons: [], armorTraining: LIGHT_SHIELDS, tools: [] },
  fighter: { weapons: ['martial'], armorTraining: LIGHT_MEDIUM_SHIELDS, tools: [] },
  monk: { weapons: [], armorTraining: NONE, tools: [] },
  paladin: { weapons: ['martial'], armorTraining: LIGHT_MEDIUM_SHIELDS, tools: [] },
  ranger: {
    weapons: ['martial'],
    armorTraining: LIGHT_MEDIUM_SHIELDS,
    skills: { choose: 1 },
    tools: [],
  },
  rogue: {
    weapons: [],
    armorTraining: LIGHT,
    skills: { choose: 1 },
    tools: ["Thieves' Tools"],
  },
  sorcerer: { weapons: [], armorTraining: NONE, tools: [] },
  warlock: { weapons: [], armorTraining: LIGHT, tools: [] },
  wizard: { weapons: [], armorTraining: NONE, tools: [] },
};

/** Armour training from every class, the first in full and the rest in part. */
export function combinedArmorTraining(
  first: ClassDefinition,
  others: readonly string[],
): ArmorTraining {
  let training = first.armorTraining;
  for (const classId of others) {
    const grant = MULTICLASS_GRANTS[classId];
    if (grant === undefined) continue;
    training = {
      light: training.light || grant.armorTraining.light,
      medium: training.medium || grant.armorTraining.medium,
      heavy: training.heavy || grant.armorTraining.heavy,
      shields: training.shields || grant.armorTraining.shields,
    };
  }
  return training;
}

/**
 * What multiclassing deliberately does **not** decide.
 *
 * Recorded here rather than scattered, because each is a real rule that needs
 * a mechanism the engine does not have, and a caller reading the slot maths
 * should not have to guess which parts were finished.
 */
export const MULTICLASS_UNMODELLED: readonly string[] = [
  'Extra Attack does not stack across classes — but Extra Attack is not executed for any class, so nothing could stack yet.',
  'Only one Unarmoured Defense may apply at a time. None is applied, so the choice never arises.',
  'A cantrip scales on total character level rather than class level, which is already what `scaledDiceFor` reads.',
];
