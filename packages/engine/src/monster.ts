import {
  CONDITIONS,
  DAMAGE_TYPES,
  SKILLS,
  type Ability,
  type CharacterId,
  type ConditionName,
  type DamageType,
  type Skill,
} from '@ie/shared';
import type { CreatureSize, Monster, MonsterMultiattack, MonsterTrait } from '@ie/srd';
import type { DamageDefenses } from './attack.js';
import type { CharacterSheet, StatedAttack, StatedValues } from './character.js';
import { vitals, type Vitals } from './vitals.js';

/**
 * Turning a parsed stat block into something the engine can fight.
 *
 * The two halves of the model express the same quantities differently: a
 * character's Armour Class follows from their armour and Dexterity, while a
 * monster's is simply printed, and a stat block routinely carries saves and
 * skills that no derivation would produce. So a monster's numbers are carried
 * across as *stated* rather than being reverse-engineered into proficiencies
 * that happen to add up.
 */

export interface MonsterDefenses {
  /** Per damage type, for `applyDamage`. Unconditional entries only. */
  readonly byDamageType: Readonly<Record<string, DamageDefenses>>;
  /** Conditions the creature cannot be given at all. Unconditional only. */
  readonly conditionImmunities: readonly ConditionName[];
  /**
   * Defences the stat block qualifies, which the engine will not apply on its
   * own. "Charmed (except from its vampire master)" is a real restriction that
   * no boolean captures, and treating it as unconditional immunity is simply
   * wrong — it makes the vampire's own hold on its spawn impossible.
   */
  readonly qualified: readonly QualifiedDefense[];
}

export interface QualifiedDefense {
  readonly kind: 'immunity' | 'resistance' | 'vulnerability';
  /** Whichever of the two this entry names. */
  readonly condition: ConditionName | null;
  readonly damageType: string | null;
  /** The qualification itself: "except from its vampire master". */
  readonly qualification: string;
  /** The entry exactly as printed, for narration. */
  readonly printed: string;
}

/**
 * Whether a condition can be applied, and if not, why not.
 *
 * Three outcomes rather than a boolean, because they mean different things to
 * the layer above: proceed, refuse outright, or ask the DM. Collapsing the
 * third into either of the others is how a qualified immunity turns into an
 * unconditional one.
 */
export type ConditionApplicability =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'immune'; readonly reason: string }
  | {
      readonly kind: 'needs-adjudication';
      readonly qualification: string;
      readonly printed: string;
    };

export interface AdaptedMonster {
  readonly id: CharacterId;
  readonly name: string;
  readonly sheet: CharacterSheet;
  readonly vitals: Vitals;
  readonly defenses: MonsterDefenses;
  /**
   * What the stat block says this creature **is** — `Fey`, `Giant`, `Undead`.
   *
   * Carried because a rule reads it: Hold Person says "Choose a Humanoid", and
   * a Goblin Warrior is `Small Fey (Goblinoid)` in 2024. The parser has held
   * this since the bestiary was first ingested and this adapter dropped it, so
   * a creature built from an SRD stat block reached `creature-added` with no
   * type at all — and the engine then had to *ask* whoever was driving it for
   * a fact it had already parsed and thrown away.
   *
   * That is the failure this field exists to make impossible. An authoritative
   * fact the Engine holds must reach the creature record; a caller may be
   * asked for what nobody knows, never for what the SRD prints.
   */
  readonly creatureType: string;
  /** The parenthesised tag — `Goblinoid`. Narrative; no rule reads it yet. */
  readonly subtype: string | null;
  readonly size: CreatureSize;
  readonly speed: Monster['speed'];
  /** The stat block's Initiative modifier, for rolling or for a passive score. */
  readonly initiativeModifier: number;
  readonly cr: number;
  readonly xp: number;
  /**
   * Entries that carried a caveat the engine cannot enforce, kept verbatim so
   * narration and the DM still have them — "Charmed (except from its vampire
   * master)" is a real restriction that no boolean captures.
   */
  readonly caveats: readonly string[];
}

const DAMAGE_SET = new Set<string>(DAMAGE_TYPES);
const CONDITION_SET = new Set<string>(CONDITIONS);
const SKILL_SET = new Set<string>(SKILLS);

interface Classified {
  readonly damage: DamageType[];
  readonly conditions: ConditionName[];
  readonly qualified: Omit<QualifiedDefense, 'kind'>[];
  readonly caveats: string[];
}

/**
 * Split a defence list into damage types and conditions.
 *
 * The stat block prints them in one run — a Zombie's immunities are "Poison,
 * Exhaustion, Poisoned", which is one damage type and two conditions — and the
 * engine treats the two completely differently. Anything parenthesised is a
 * restriction the engine cannot express, so the entry still counts but the
 * caveat is kept for narration rather than dropped.
 */
function classify(entries: readonly string[]): Classified {
  const damage: DamageType[] = [];
  const conditions: ConditionName[] = [];
  const qualified: Omit<QualifiedDefense, 'kind'>[] = [];
  const caveats: string[] = [];

  for (const entry of entries) {
    const printed = entry.trim();
    const qualifier = /\(([^)]*)\)/.exec(printed);

    const bare = printed
      .replace(/\([^)]*\)/g, '')
      .replace(/[_*]/g, '')
      .trim()
      .toLowerCase();

    const asDamage = DAMAGE_SET.has(bare) ? (bare as DamageType) : null;
    const asCondition = CONDITION_SET.has(bare) ? (bare as ConditionName) : null;

    // A qualified entry is recognised but *not* applied: the qualification is
    // a rule the engine cannot evaluate, so it goes to whoever can.
    if (qualifier !== null && (asDamage !== null || asCondition !== null)) {
      qualified.push({
        condition: asCondition,
        damageType: asDamage,
        qualification: qualifier[1]!.replace(/[_*]/g, '').trim(),
        printed,
      });
      continue;
    }

    if (asDamage !== null) damage.push(asDamage);
    else if (asCondition !== null) conditions.push(asCondition);
    else if (bare !== '') caveats.push(printed);
  }

  return { damage, conditions, qualified, caveats };
}

function buildDefenses(monster: Monster): { defenses: MonsterDefenses; caveats: string[] } {
  const immune = classify(monster.immunities);
  const resistant = classify(monster.resistances);
  const vulnerable = classify(monster.vulnerabilities);

  const byDamageType: Record<string, DamageDefenses> = {};
  const set = (type: string, patch: Partial<DamageDefenses>): void => {
    byDamageType[type] = { ...byDamageType[type], ...patch };
  };

  for (const type of immune.damage) set(type, { immune: true });
  for (const type of resistant.damage) set(type, { resistant: true });
  for (const type of vulnerable.damage) set(type, { vulnerable: true });

  const qualified: QualifiedDefense[] = [
    ...immune.qualified.map((q) => ({ ...q, kind: 'immunity' as const })),
    ...resistant.qualified.map((q) => ({ ...q, kind: 'resistance' as const })),
    ...vulnerable.qualified.map((q) => ({ ...q, kind: 'vulnerability' as const })),
  ];

  return {
    defenses: { byDamageType, conditionImmunities: immune.conditions, qualified },
    caveats: [...immune.caveats, ...resistant.caveats, ...vulnerable.caveats],
  };
}

const ABILITIES_IN_ORDER: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * The attacks the block's **Actions** section prints, and only that section.
 *
 * A heading in a stat block says what the thing under it costs. A Bonus Action
 * attack carried across as an Attack action's would let a creature swing twice
 * for one action, and a Reaction's would let it swing on somebody else's turn
 * for free — both are wrong in the direction that matters, and neither is
 * visible once the line has been flattened into a list. So one section is
 * carried, the one whose cost the attack path already spends, and the rest are
 * reported as prose a DM still applies.
 *
 * Legendary actions are outside this for the same reason and one more: they
 * have an economy of their own that the engine does not yet hold.
 */
function printedAttacks(monster: Monster): readonly StatedAttack[] {
  return monster.actions.flatMap((line) =>
    line.attack === undefined ? [] : [{ name: line.name, ...line.attack }],
  );
}

/** The trait shapes the parser read, in printed order. */
const printedTraits = (monster: Monster): readonly MonsterTrait[] =>
  monster.traits.flatMap((line) => (line.trait === undefined ? [] : [line.trait]));

/**
 * The sequence the block's Multiattack states, **bound to the lines it names**.
 *
 * The parser reads one sentence and knows nothing about the block around it,
 * so a name it read is a name and not yet an attack. Here the two meet: every
 * entry has to name an attack this creature can actually make, and a sequence
 * with one loose end is dropped whole rather than carried with a hole in it —
 * a creature owed three attacks of which one can never be rolled is worse off
 * than one whose Multiattack stayed prose.
 *
 * The bound name is the **printed** one, so what the sheet states and what a
 * caller names an attack by are the same string.
 */
function printedMultiattack(
  monster: Monster,
  attacks: readonly StatedAttack[],
): MonsterMultiattack | undefined {
  // An Action, and one that is not itself an attack: a line that states both a
  // sequence and a swing of its own is two mechanisms under one heading, and
  // the engine has no reading of it that is not a guess. The rule is
  // mechanical rather than a heading nobody here may name — content that
  // arrived from somewhere other than the SRD parser meets the same one.
  const line = monster.actions.find(
    (action) => action.multiattack !== undefined && action.attack === undefined,
  );
  if (line?.multiattack === undefined) return undefined;

  const entries: MonsterMultiattack['entries'][number][] = [];
  for (const entry of line.multiattack.entries) {
    const wanted = entry.attack.toLowerCase();
    const printed = attacks.find((attack) => attack.name.toLowerCase() === wanted);
    if (printed === undefined) return undefined;
    entries.push({ count: entry.count, attack: printed.name });
  }
  return { entries };
}

/** How many swings a stated sequence adds up to. */
const sequenceTotal = (sequence: MonsterMultiattack): number =>
  sequence.entries.reduce((sum, entry) => sum + entry.count, 0);

/** The sequence this creature's block states, or null where it states none. */
export const multiattackOf = (sheet: CharacterSheet): MonsterMultiattack | null =>
  sheet.stated?.multiattack ?? null;

/**
 * How many of one printed attack a stated sequence holds.
 *
 * Summed across entries rather than found in one, because a sentence may name
 * the same line twice and the engine has no business deciding that it did not
 * mean it.
 */
export function multiattackAllowance(sequence: MonsterMultiattack, name: string): number {
  const wanted = name.trim().toLowerCase();
  return sequence.entries
    .filter((entry) => entry.attack.toLowerCase() === wanted)
    .reduce((sum, entry) => sum + entry.count, 0);
}

/**
 * Whether a turn's swings, counted by name, are swings the sequence prints.
 *
 * The whole multiset rather than the latest swing, which is what makes this
 * the *composition* and not a per-name tally: a Ghoul that has clawed once has
 * not thereby earned a Bite, because "one Claw and one Bite" is not what its
 * block prints either.
 */
export const multiattackAllows = (
  sequence: MonsterMultiattack,
  made: Readonly<Record<string, number>>,
): boolean =>
  Object.entries(made).every(([name, count]) => count <= multiattackAllowance(sequence, name));

/**
 * The attack a creature reaches for when it is provoked and nobody names one.
 *
 * SRD: "take a Reaction to make **one melee attack** with a weapon or an
 * Unarmed Strike." A monster carries neither, and the two answers the engine
 * used to have were both wrong: refuse the Reaction the book grants, or swing
 * an Unarmed Strike at a Strength modifier the block never printed.
 *
 * So it is the best of what the block *does* print, by three stated rules:
 *
 * - **Melee**, because that is the attack the sentence names. A line that is
 *   only ranged never wins this, however hard it hits.
 * - **Not on a recharge**, because a line the creature may not have available
 *   is not the one it reaches for by default.
 * - **The highest summed printed average**, the book's own arithmetic, so
 *   nothing is rolled and nothing is re-derived from notation. Ties go to the
 *   first line printed, which is a rule rather than an accident of sorting.
 *
 * Null for every character and for a block that prints no melee line, which is
 * where the caller's weapon or an Unarmed Strike takes over as before.
 */
export function bestPrintedMeleeAttack(sheet: CharacterSheet): StatedAttack | null {
  let best: StatedAttack | null = null;
  let most = -1;

  for (const attack of sheet.stated?.attacks ?? []) {
    if (attack.kind === 'ranged') continue;
    if (attack.recharge !== undefined) continue;
    const average = attack.damage.reduce((sum, part) => sum + part.average, 0);
    // Strictly greater, so the first line printed keeps a tie.
    if (average > most) {
      most = average;
      best = attack;
    }
  }

  return best;
}

/**
 * Find an attack a creature's stat block prints, by the name it prints it
 * under.
 *
 * Case-insensitive, because the name is something a caller types and `Bite`
 * and `bite` are the same attack. Null where the sheet states no such attack —
 * which is every character, and every monster whose line nobody could read.
 */
export function printedAttackOf(sheet: CharacterSheet, name: string): StatedAttack | null {
  const wanted = name.trim().toLowerCase();
  return (
    sheet.stated?.attacks?.find((attack) => attack.name.toLowerCase() === wanted) ?? null
  );
}

/** Whether this creature's stat block states a trait of the given shape. */
export const hasPrintedTrait = (sheet: CharacterSheet, kind: MonsterTrait['kind']): boolean =>
  sheet.stated?.traits?.some((trait) => trait.kind === kind) === true;

export function adaptMonster(monster: Monster, id: CharacterId): AdaptedMonster {
  const { defenses, caveats } = buildDefenses(monster);

  const saves: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES_IN_ORDER) saves[ability] = monster.abilities[ability].save;

  // Stat blocks name their skills in the same vocabulary the engine uses, but
  // an unrecognised one is dropped rather than crashing a fight.
  const skills: Partial<Record<Skill, number>> = {};
  for (const [name, bonus] of Object.entries(monster.skills)) {
    if (SKILL_SET.has(name)) skills[name as Skill] = bonus;
  }

  const attacks = printedAttacks(monster);
  const traits = printedTraits(monster);
  const multiattack = printedMultiattack(monster, attacks);

  const stated: StatedValues = {
    armorClass: monster.ac,
    proficiencyBonus: monster.proficiencyBonus,
    // Printed Initiative is authoritative and often differs from Dexterity.
    initiative: monster.initiative,
    saves,
    skills,
    // Omitted rather than empty when the block prints none this parser could
    // read, so a creature that does nothing the engine can roll carries no
    // field saying so — the reading every optional field on the sheet takes.
    ...(attacks.length === 0 ? {} : { attacks }),
    ...(traits.length === 0 ? {} : { traits }),
    ...(multiattack === undefined ? {} : { multiattack }),
  };

  // **The count follows the composition.** A block that states a sequence
  // states how many swings its Attack action holds, and the two must be one
  // number rather than two that could disagree; a block that states none is
  // left where it was, at the one attack the action has always held.
  const attacksPerAction = multiattack === undefined ? 1 : sequenceTotal(multiattack);

  const sheet: CharacterSheet = {
    // A monster has no level. Every derivation that would have used one is
    // stated instead, so this is inert — but it has to be something, and 1 is
    // the least misleading.
    level: 1,
    abilities: {
      str: monster.abilities.str.score,
      dex: monster.abilities.dex.score,
      con: monster.abilities.con.score,
      int: monster.abilities.int.score,
      wis: monster.abilities.wis.score,
      cha: monster.abilities.cha.score,
    },
    skills: {},
    saveProficiencies: [],
    // A stat block's AC already accounts for whatever it is wearing.
    armor: null,
    shield: null,
    // SRD: "A monster has training with any armor in its stat block."
    armorTraining: { light: true, medium: true, heavy: true, shields: true },
    baseSpeed: monster.speed.walk,
    spellcastingAbility: null,
    // Omitted at one, which is the sheet's own reading of the field: "one,
    // unless a feature says otherwise", and an explicit 1 on every stat block
    // would be a number where there was an absence.
    ...(attacksPerAction > 1 ? { attacksPerAction } : {}),
    stated,
  };

  return {
    id,
    name: monster.name,
    sheet,
    // SRD: "A monster dies the instant it drops to 0 Hit Points."
    vitals: vitals(monster.hp.average, { diesAtZero: true }),
    defenses,
    creatureType: monster.type,
    subtype: monster.subtype,
    size: monster.size,
    speed: monster.speed,
    initiativeModifier: monster.initiative,
    cr: monster.cr,
    xp: monster.xp,
    caveats,
  };
}

/**
 * Whether a condition can be applied, given the stat block's immunities.
 *
 * A qualified immunity returns `needs-adjudication` rather than resolving
 * either way, because the qualification is a rule the engine cannot evaluate.
 * Silently treating it as unconditional makes a vampire unable to charm its
 * own spawn; silently ignoring it makes the immunity meaningless.
 */
export function conditionApplicability(
  adapted: AdaptedMonster,
  condition: ConditionName,
): ConditionApplicability {
  if (adapted.defenses.conditionImmunities.includes(condition)) {
    return { kind: 'immune', reason: `${adapted.name} is immune to the ${condition} condition` };
  }

  const qualified = adapted.defenses.qualified.find(
    (q) => q.kind === 'immunity' && q.condition === condition,
  );
  if (qualified !== undefined) {
    return {
      kind: 'needs-adjudication',
      qualification: qualified.qualification,
      printed: qualified.printed,
    };
  }

  return { kind: 'allowed' };
}

/**
 * The blunt form, for callers that only need yes or no.
 *
 * A qualified immunity counts as *allowed* here, because the default when
 * nobody has adjudicated is that the condition lands — the qualification is a
 * narrower exception, not a broader one.
 */
export function monsterCanReceive(
  adapted: AdaptedMonster,
  condition: ConditionName,
): boolean {
  return conditionApplicability(adapted, condition).kind !== 'immune';
}
