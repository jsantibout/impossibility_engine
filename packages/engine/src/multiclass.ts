import { err, ok, type Ability, type Result } from '@ie/shared';
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
 * SRD: all levels in a full caster; **half, rounded up**, in a half caster. A
 * class that does not cast contributes nothing, and a Pact Magic class
 * contributes nothing *here* because Pact Magic is its own table — see
 * {@link pactSlotsOf}. Which a class is, the class says: nothing here names
 * one.
 */
export function casterLevel(
  levels: readonly ClassLevel[],
  classOf: (classId: string) => ClassDefinition | null,
): number {
  let total = 0;
  for (const entry of levels) {
    const casting = classOf(entry.classId)?.spellcasting;
    if (casting === undefined || (casting.feature ?? 'spellcasting') !== 'spellcasting') continue;
    if (casting.progression === 'full') total += entry.level;
    else if (casting.progression === 'half') total += Math.ceil(entry.level / 2);
  }
  return total;
}

/**
 * SRD "Multiclass Spellcaster: Spell Slots per Spell Level", by caster level.
 *
 * A rule of the multiclassing chapter, printed once, so it is held here as
 * one. It is identical to every full caster's own slot column, and the SRD
 * content's tests hold each of those against this table rather than
 * transcribing it a sixth time.
 */
export const MULTICLASS_SPELL_SLOTS: readonly (readonly number[])[] = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** The combined slots for these class levels, off the printed table. */
export function multiclassSlots(
  levels: readonly ClassLevel[],
  classOf: (classId: string) => ClassDefinition | null,
): Record<number, number> {
  const level = casterLevel(levels, classOf);
  const slots: Record<number, number> = {};
  if (level < 1) return slots;

  const row = MULTICLASS_SPELL_SLOTS[Math.min(level, MULTICLASS_SPELL_SLOTS.length) - 1] ?? [];
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
 * first. Read off whichever class declares `feature: 'pact-magic'`; the SRD
 * has one, and a homebrew catalogue may have another.
 */
export function pactSlotsOf(
  levels: readonly ClassLevel[],
  classOf: (classId: string) => ClassDefinition | null,
): Record<number, number> {
  const slots: Record<number, number> = {};
  for (const entry of levels) {
    const definition = classOf(entry.classId);
    if (definition?.spellcasting?.feature !== 'pact-magic' || entry.level < 1) continue;
    const row = definition.table[entry.level - 1]?.spellSlots ?? [];
    row.forEach((count, index) => {
      if (count > 0) slots[index + 1] = (slots[index + 1] ?? 0) + count;
    });
  }
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

/** Armour training from every class, the first in full and the rest in part. */
export function combinedArmorTraining(
  first: ClassDefinition,
  others: readonly ClassDefinition[],
): ArmorTraining {
  let training = first.armorTraining;
  for (const other of others) {
    const grant = other.multiclass;
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
