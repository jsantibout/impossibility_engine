import {
  ABILITIES,
  SKILLS,
  err,
  ok,
  type Ability,
  type CharacterId,
  type Result,
  type Skill,
} from '@ie/shared';
import { abilityModifier, proficiencyBonusForLevel, type CharacterSheet } from './character.js';
import { expandPack, goldToCopper, itemFor } from './catalogue.js';
import { mergeItems } from './events.js';
import type { GameEvent, GameState, InventoryLine } from './events.js';
import {
  ALIGNMENTS,
  BACKGROUNDS,
  COMMON,
  LANGUAGES_CHOSEN,
  POINT_BUY_BUDGET,
  POINT_COSTS,
  SPECIES,
  STANDARD_ARRAY,
  STANDARD_LANGUAGES,
  backgroundById,
  featById,
  speciesById,
  type BackgroundDefinition,
  type FeatDefinition,
  type SpeciesDefinition,
} from './origins.js';
import {
  MAX_LEVEL,
  XP_THRESHOLDS,
  cumulativeFeatures,
  rowAt,
  slotsAt,
  type ClassDefinition,
  type EquipmentEntry,
  type ClassLevelRow,
  type FeatureDefinition,
  type FeatureGrant,
  type SpellcastingStyle,
  type SubclassDefinition,
} from './progression.js';
import { spellSlotKey } from './resources.js';
import { hitDieKey } from './rest.js';
import {
  countOf,
  highestSlotLevel,
  levelGrantedSpells,
  lookupSpell,
  spellIds,
  type SpellbookEntry,
} from './spellbook.js';
import type { GrantedSpell, SpellcastingState } from './spellcasting.js';
import { CLERIC, CLERIC_SUBCLASSES } from './cleric.js';
import { FIGHTER, FIGHTER_SUBCLASSES } from './fighter.js';
import { PALADIN, PALADIN_SUBCLASSES } from './paladin.js';
import { ROGUE, ROGUE_SUBCLASSES } from './rogue.js';
import { SORCERER, SORCERER_SUBCLASSES } from './sorcerer.js';
import { WARLOCK, WARLOCK_SUBCLASSES } from './warlock.js';
import { WIZARD, WIZARD_SUBCLASSES } from './wizard.js';

/**
 * Character creation: choices in, a validated character out.
 *
 * The three jobs `progression.ts` describes stay apart here. Progression says
 * what a level grants; this file turns choices into a character and refuses
 * the ones that are not legal; execution of a feature happens elsewhere or,
 * where it happens nowhere yet, the feature says so.
 *
 * **The choices are the character.** They are stored on the creature, so the
 * sheet can be rebuilt from them exactly, and so advancing a level is a matter
 * of adding to a record rather than rebuilding a creature and losing every
 * wound, condition and spent slot it had.
 *
 * Validation returns *every* problem, not the first. A caller filling in a
 * character does not want to be told about one mistake at a time.
 */

const CLASSES: readonly ClassDefinition[] = [
  CLERIC,
  FIGHTER,
  PALADIN,
  ROGUE,
  SORCERER,
  WARLOCK,
  WIZARD,
];
const SUBCLASSES: readonly SubclassDefinition[] = [
  ...CLERIC_SUBCLASSES,
  ...FIGHTER_SUBCLASSES,
  ...PALADIN_SUBCLASSES,
  ...ROGUE_SUBCLASSES,
  ...SORCERER_SUBCLASSES,
  ...WARLOCK_SUBCLASSES,
  ...WIZARD_SUBCLASSES,
];

export const classById = (id: string): ClassDefinition | null =>
  CLASSES.find((c) => c.id === id) ?? null;

export const subclassById = (id: string): SubclassDefinition | null =>
  SUBCLASSES.find((s) => s.id === id) ?? null;

export type AbilityMethod = 'standard-array' | 'point-buy' | 'manual';

export interface AbilityChoice {
  readonly method: AbilityMethod;
  /** Scores as generated, before the background's increases. */
  readonly assignment: Readonly<Record<Ability, number>>;
}

export type HitPointChoice =
  /** SRD Fixed Hit Points by Class: the average, rounded up. */
  | { readonly method: 'fixed' }
  /** One roll per level after the first; level 1 is always the maximum die. */
  | { readonly method: 'rolled'; readonly rolls: readonly number[] };

/** What taking a feat requires the player to decide. */
export interface FeatChoice {
  readonly featId: string;
  /** Magic Initiate: which class list the spells come from. */
  readonly spellList?: string | undefined;
  /** Magic Initiate: "Intelligence, Wisdom, or Charisma is your spellcasting ability". */
  readonly spellcastingAbility?: Ability | undefined;
  /** Magic Initiate: two cantrip ids. */
  readonly cantrips?: readonly string[] | undefined;
  /** Magic Initiate: one level 1 spell id. */
  readonly levelOneSpell?: string | undefined;
  /** Skilled: three skills or tools. */
  readonly proficiencies?: readonly string[] | undefined;
}

/**
 * What the GM handed out beyond the standard package.
 *
 * SRD "Starting at Higher Levels": "The GM decides whether your character
 * starts with more than the standard equipment for a level 1 character,
 * possibly even one or more magic items." That is a decision the engine cannot
 * make and must not guess, so above level 1 it has to be stated — an empty
 * grant with a note saying so is a fine answer, an absent one is not.
 */
export interface DmGrants {
  readonly items: readonly EquipmentEntry[];
  readonly goldPieces: number;
  readonly magicItems: readonly string[];
  /** Why, in the GM's own words. Recorded so the decision is visible later. */
  readonly note: string;
}

export interface CharacterChoices {
  readonly name: string;
  readonly classId: string;
  readonly level: number;
  readonly speciesId: string;
  readonly backgroundId: string;
  readonly abilities: AbilityChoice;
  /** SRD: one ability by 2 and another by 1, or all three by 1. */
  readonly abilityIncreases: Readonly<Partial<Record<Ability, number>>>;
  readonly classSkills: readonly Skill[];
  /** SRD: "Common plus two languages" from the Standard Languages table. */
  readonly languages: readonly string[];
  /** SRD Step 4. A required choice; nothing in 2024 hangs off it mechanically. */
  readonly alignment: string;
  readonly subclassId?: string | undefined;
  /** Cantrip ids, checked against the class list. */
  readonly cantrips: readonly string[];
  /** The book, each entry saying when it arrived and why. */
  readonly spellbook: readonly SpellbookEntry[];
  readonly preparedSpells: readonly string[];
  /** Which starting-equipment package, by the SRD's own label. */
  readonly classEquipment: string;
  readonly backgroundEquipment: string;
  /** Items actually worn or held, which is what Armour Class reads. */
  readonly equipped: readonly string[];
  readonly hitPoints: HitPointChoice;
  /** Choices a feature asks for, keyed by feature id. */
  readonly featureChoices: Readonly<Record<string, readonly string[]>>;
  /** Feats, keyed by the feature that granted them. */
  readonly feats: Readonly<Record<string, FeatChoice>>;
  /** Required above level 1; see {@link DmGrants}. */
  readonly dmGrants?: DmGrants | undefined;
}

export interface CreationProblem {
  readonly code: string;
  readonly reason: string;
  /** The choice at fault, for a caller pointing at a form field. */
  readonly field: string;
}

export interface CharacterPlan {
  readonly sheet: CharacterSheet;
  readonly proficiencyBonus: number;
  readonly hitPointMaximum: number;
  readonly hitDie: number;
  readonly spellSlots: Readonly<Record<number, number>>;
  readonly cantrips: readonly string[];
  readonly spellbook: readonly SpellbookEntry[];
  readonly preparedSpells: readonly string[];
  /** Everything owned: class package, background package, and any GM grant. */
  readonly inventory: readonly InventoryLine[];
  /** The subset actually worn or held. Armour Class reads this, not the pack. */
  readonly equipped: readonly string[];
  readonly goldPieces: number;
  readonly experiencePoints: number;
  readonly languages: readonly string[];
  readonly alignment: string;
  readonly toolProficiencies: readonly string[];
  /** Magic items the GM granted, recorded rather than modelled. */
  readonly magicItems: readonly string[];
  /** The species' creature type, which some spells demand. */
  readonly creatureType: string;
  /**
   * Choices that were legal but wasteful — a proficiency picked twice, say.
   *
   * Warnings, not errors: SRD 5.2.1 gives no rule letting a player re-pick a
   * proficiency they already have, so the engine will not invent one. It
   * unions the proficiencies, says the pick was redundant, and leaves the
   * decision to the table.
   */
  readonly warnings: readonly CreationProblem[];
  /** Every feature the character has, each saying whether the engine runs it. */
  readonly features: readonly FeatureDefinition[];
  /** Feat names, recorded rather than executed. */
  readonly feats: readonly string[];
  /** What the character can cast, and by what route. */
  readonly spellcasting: SpellcastingState;
  /**
   * Bonuses a feat contributes to a roll the engine already makes.
   *
   * SRD Alert: "When you roll Initiative, you can add your Proficiency Bonus
   * to the roll." Named, so the log says why, and optional in the SRD's own
   * words — a caller passes them in or does not.
   */
  readonly initiativeBonuses: readonly { readonly source: string; readonly flat: number }[];
}

/** What is stored on the creature so the character can be rebuilt. */
export interface CharacterRecord {
  readonly classId: string;
  readonly subclassId: string | null;
  readonly speciesId: string;
  readonly backgroundId: string;
  readonly level: number;
  readonly choices: CharacterChoices;
}

const problem = (code: string, field: string, reason: string): CreationProblem => ({
  code,
  field,
  reason,
});

// — the pieces, each checked on its own ————————————————————————————————————

interface Parts {
  readonly definition: ClassDefinition;
  readonly species: SpeciesDefinition;
  readonly background: BackgroundDefinition;
  readonly subclass: SubclassDefinition | null;
}

function resolveParts(choices: CharacterChoices): { parts: Parts | null; problems: CreationProblem[] } {
  const problems: CreationProblem[] = [];

  const definition = classById(choices.classId);
  if (definition === null) {
    problems.push(
      problem('unknown_class', 'classId', `no class called ${choices.classId}; have ${CLASSES.map((c) => c.id).join(', ')}`),
    );
  }
  const species = speciesById(choices.speciesId);
  if (species === null) {
    problems.push(
      problem('unknown_species', 'speciesId', `no species called ${choices.speciesId}; have ${SPECIES.map((s) => s.id).join(', ')}`),
    );
  }
  const background = backgroundById(choices.backgroundId);
  if (background === null) {
    problems.push(
      problem('unknown_background', 'backgroundId', `no background called ${choices.backgroundId}; have ${BACKGROUNDS.map((b) => b.id).join(', ')}`),
    );
  }

  if (!Number.isInteger(choices.level) || choices.level < 1 || choices.level > MAX_LEVEL) {
    problems.push(
      problem('bad_level', 'level', `a level runs from 1 to ${MAX_LEVEL}, got ${choices.level}`),
    );
  }

  let subclass: SubclassDefinition | null = null;
  if (definition !== null && choices.level >= 1 && choices.level <= MAX_LEVEL) {
    const due = choices.level >= definition.subclassLevel;
    if (choices.subclassId === undefined) {
      if (due) {
        problems.push(
          problem('subclass_required', 'subclassId', `a ${definition.name} chooses a subclass at level ${definition.subclassLevel}`),
        );
      }
    } else if (!due) {
      problems.push(
        problem('subclass_too_early', 'subclassId', `a ${definition.name} has no subclass until level ${definition.subclassLevel}`),
      );
    } else {
      subclass = subclassById(choices.subclassId);
      if (subclass === null || subclass.classId !== definition.id) {
        problems.push(
          problem('unknown_subclass', 'subclassId', `no ${definition.name} subclass called ${choices.subclassId}`),
        );
        subclass = null;
      }
    }
  }

  if (definition === null || species === null || background === null) {
    return { parts: null, problems };
  }
  return { parts: { definition, species, background, subclass }, problems };
}

/** SRD: increase one by 2 and another by 1, or all three by 1. */
function checkAbilities(
  choices: CharacterChoices,
  background: BackgroundDefinition,
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const scores = choices.abilities.assignment;

  for (const ability of ABILITIES) {
    const score = scores[ability];
    if (!Number.isInteger(score) || score < 1 || score > 30) {
      problems.push(problem('bad_score', 'abilities', `${ability} must be a score from 1 to 30, got ${score}`));
    }
  }

  if (choices.abilities.method === 'standard-array') {
    const given = ABILITIES.map((a) => scores[a]).sort((a, b) => b - a);
    const expected = [...STANDARD_ARRAY].sort((a, b) => b - a);
    if (JSON.stringify(given) !== JSON.stringify(expected)) {
      problems.push(
        problem('not_standard_array', 'abilities', `the standard array is ${STANDARD_ARRAY.join(', ')}`),
      );
    }
  }

  if (choices.abilities.method === 'point-buy') {
    let spent = 0;
    for (const ability of ABILITIES) {
      const cost = POINT_COSTS[scores[ability]];
      if (cost === undefined) {
        problems.push(
          problem('score_out_of_range', 'abilities', `point buy runs from 8 to 15, got ${ability} ${scores[ability]}`),
        );
      } else {
        spent += cost;
      }
    }
    if (spent > POINT_BUY_BUDGET) {
      problems.push(
        problem('over_point_budget', 'abilities', `that spread costs ${spent} of ${POINT_BUY_BUDGET} points`),
      );
    }
  }

  const increases = Object.entries(choices.abilityIncreases).filter(([, n]) => n !== undefined);
  const amounts = increases.map(([, n]) => n ?? 0).sort((a, b) => b - a);
  const shape = JSON.stringify(amounts);
  if (shape !== JSON.stringify([2, 1]) && shape !== JSON.stringify([1, 1, 1])) {
    problems.push(
      problem('bad_ability_increase', 'abilityIncreases', 'a background raises one ability by 2 and another by 1, or all three by 1'),
    );
  }

  for (const [ability, amount] of increases) {
    if (!background.abilities.includes(ability as Ability)) {
      problems.push(
        problem('ability_not_offered', 'abilityIncreases', `${background.name} offers ${background.abilities.join(', ')}, not ${ability}`),
      );
      continue;
    }
    const total = (scores[ability as Ability] ?? 0) + (amount ?? 0);
    if (total > 20) {
      problems.push(
        problem('score_above_twenty', 'abilityIncreases', `raising ${ability} to ${total} passes the limit of 20`),
      );
    }
  }

  return problems;
}

const finalScores = (choices: CharacterChoices): Record<Ability, number> => {
  const scores = { ...choices.abilities.assignment } as Record<Ability, number>;
  for (const ability of ABILITIES) {
    scores[ability] = (scores[ability] ?? 10) + (choices.abilityIncreases[ability] ?? 0);
  }
  return scores;
};

function checkSkills(choices: CharacterChoices, definition: ClassDefinition): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const { choose, from } = definition.skillChoices;

  if (choices.classSkills.length !== choose) {
    problems.push(
      problem('wrong_skill_count', 'classSkills', `a ${definition.name} chooses ${choose} skills, got ${choices.classSkills.length}`),
    );
  }
  if (new Set(choices.classSkills).size !== choices.classSkills.length) {
    problems.push(problem('duplicate_skill', 'classSkills', 'the same skill was chosen twice'));
  }
  for (const skill of choices.classSkills) {
    if (!from.includes(skill)) {
      problems.push(
        problem('skill_not_offered', 'classSkills', `a ${definition.name} may choose ${from.join(', ')}, not ${skill}`),
      );
    }
  }
  return problems;
}

/** Every feature the character has, from all four sources. */
function grantedFeatures(choices: CharacterChoices, parts: Parts): readonly FeatureDefinition[] {
  return [
    ...cumulativeFeatures(parts.definition, choices.level),
    ...(parts.subclass === null ? [] : cumulativeFeatures(parts.subclass, choices.level)),
    ...cumulativeFeatures(parts.species, choices.level),
    ...cumulativeFeatures(parts.background, choices.level),
  ];
}

/**
 * The choices made for every feature that grants a particular kind of thing.
 *
 * Finding a feature by what it *does* rather than by its id is the difference
 * between one class working and twelve working: the Rogue's Expertise and the
 * Wizard's Scholar are the same rule, and a second subclass with free spells
 * needs no new string match here.
 */
function choicesGranting(
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
  kind: FeatureGrant['kind'],
): readonly string[] {
  const picked: string[] = [];
  for (const feature of features) {
    const grant = feature.grants;
    if (grant?.kind !== kind) continue;
    // A fixed grant is the feature's own answer; a choice is the player's.
    if (grant.kind === 'spells' && grant.fixed !== undefined) {
      picked.push(...grant.fixed);
      continue;
    }
    picked.push(...(choices.featureChoices[feature.id] ?? []));
  }
  return picked;
}

/** Skills a feature granted Expertise in, whichever feature it was. */
function expertiseSkills(choices: CharacterChoices, parts: Parts): readonly string[] {
  return choicesGranting(choices, grantedFeatures(choices, parts), 'expertise');
}

/**
 * Spells a feature added outside the class table's counts.
 *
 * Takes `parts` when the caller has them and rebuilds what it can when it does
 * not — `checkSpells` runs before a subclass is necessarily resolved, and the
 * class's own features are enough there.
 */
function spellsFromFeatures(
  choices: CharacterChoices,
  definition: ClassDefinition,
  parts?: Parts,
): readonly string[] {
  const features =
    parts === undefined
      ? [
          ...cumulativeFeatures(definition, choices.level),
          ...(subclassById(choices.subclassId ?? '') === null
            ? []
            : cumulativeFeatures(subclassById(choices.subclassId ?? '')!, choices.level)),
        ]
      : grantedFeatures(choices, parts);
  return choicesGranting(choices, features, 'spells');
}

function checkFeatureChoices(
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
  proficient: ReadonlySet<Skill>,
): CreationProblem[] {
  const problems: CreationProblem[] = [];

  for (const feature of features) {
    const asked = feature.choice;
    // Subclasses are resolved in `resolveParts`, and feats in `checkFeats`,
    // because both need more than a list of picked names.
    if (asked === undefined || asked.kind === 'subclass' || asked.kind === 'feat') continue;

    const made = choices.featureChoices[feature.id];
    if (made === undefined || made.length !== asked.choose) {
      problems.push(
        problem('missing_feature_choice', 'featureChoices', `${feature.id} (${feature.name}) needs ${asked.choose} choice(s)`),
      );
      continue;
    }

    if (asked.kind === 'option') {
      for (const picked of made) {
        if (!asked.from.includes(picked)) {
          problems.push(
            problem('option_not_offered', 'featureChoices', `${feature.name} offers ${asked.from.join(', ')}, not ${picked}`),
          );
        }
      }
      for (const picked of duplicates(made)) {
        problems.push(
          problem('duplicate_option', 'featureChoices', `${feature.name} takes ${picked} once`),
        );
      }
      continue;
    }

    if (asked.kind === 'skill') {
      for (const picked of made) {
        if (!(SKILLS as readonly string[]).includes(picked)) {
          problems.push(
            problem('unknown_skill', 'featureChoices', `${picked} is not a skill`),
          );
          continue;
        }
        if (asked.from !== undefined && !asked.from.includes(picked as Skill)) {
          problems.push(
            problem('skill_not_offered', 'featureChoices', `${feature.name} offers ${asked.from.join(', ')}, not ${picked}`),
          );
        }
        // SRD Expertise: "Choose one of the following skills **in which you
        // have proficiency**." Expertise without proficiency is not a thing.
        // Found by what the feature grants, not by its id: the Rogue's
        // Expertise is the same rule under a different name.
        if (feature.grants?.kind === 'expertise' && !proficient.has(picked as Skill)) {
          problems.push(
            problem('expertise_without_proficiency', 'featureChoices', `${feature.name} needs proficiency in ${picked} first`),
          );
        }
      }
    }
  }

  return problems;
}

/**
 * Check one spell id against the parsed SRD.
 *
 * Everything here is a lookup rather than a guess: the id has to name a spell
 * the SRD publishes, and that spell has to be on the class list, at an allowed
 * level, and — where a feature says so — of the right school. An unknown id is
 * the important one to catch: a typo in a spell name used to sail straight
 * through and leave a character holding a spell that does not exist.
 */
function checkSpellId(
  id: string,
  field: string,
  classId: string,
  options: {
    readonly minLevel?: number;
    readonly maxLevel?: number;
    readonly school?: string;
    readonly what: string;
  },
): CreationProblem[] {
  const spell = lookupSpell(id);
  if (spell === null) {
    return [problem('unknown_spell', field, `no SRD spell with the id ${id}`)];
  }

  const problems: CreationProblem[] = [];
  if (!spell.classes.includes(classId)) {
    problems.push(
      problem('spell_not_on_class_list', field, `${spell.name} is not on the ${classId} spell list`),
    );
  }
  const min = options.minLevel ?? 0;
  const max = options.maxLevel ?? 9;
  if (spell.level < min || spell.level > max) {
    problems.push(
      problem('spell_level_not_allowed', field, `${options.what} takes spells of level ${min} to ${max}; ${spell.name} is level ${spell.level}`),
    );
  }
  if (options.school !== undefined && spell.school !== options.school) {
    problems.push(
      problem('spell_school_not_allowed', field, `${options.what} takes ${options.school} spells; ${spell.name} is ${spell.school}`),
    );
  }
  return problems;
}

const duplicates = (ids: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) twice.add(id);
    seen.add(id);
  }
  return [...twice];
};

function checkSpells(choices: CharacterChoices, definition: ClassDefinition): CreationProblem[] {
  // Spells a feature writes into the book are in the book: preparation can
  // reach them even though the count rule does not measure them. Gathered by
  // what the feature grants rather than by naming the Evoker's, so a second
  // subclass with free spells needs no change here.
  const fromFeatures = spellsFromFeatures(choices, definition);
  const problems: CreationProblem[] = [];
  const row = rowAt(definition, choices.level);
  if (!row.ok) return problems;

  // A class with no spellcasting block casts nothing, and the difference
  // between that and "has none at this level" matters: a Fighter does not know
  // zero cantrips, a Fighter has no cantrips. Anything written down here is a
  // mistake rather than a spell, and the feat route is untouched — Magic
  // Initiate on a Fighter is a real character.
  if (definition.spellcasting === undefined) {
    if (choices.cantrips.length > 0) {
      problems.push(
        problem('no_spellcasting', 'cantrips', `a ${definition.name} has no cantrips`),
      );
    }
    if (choices.spellbook.length > 0) {
      problems.push(
        problem('no_spellbook', 'spellbook', `a ${definition.name} has no spellbook`),
      );
    }
    if (choices.preparedSpells.length > 0) {
      problems.push(
        problem('no_spellcasting', 'preparedSpells', `a ${definition.name} prepares no spells`),
      );
    }
    return problems;
  }

  const slots = slotsAt(definition, choices.level);
  const topSlot = highestSlotLevel(slots);

  // — cantrips ————————————————————————————————————————————————————————————
  const cantrips = row.value.cantripsKnown ?? 0;
  if (choices.cantrips.length !== cantrips) {
    problems.push(
      problem('wrong_cantrip_count', 'cantrips', `a level ${choices.level} ${definition.name} knows ${cantrips} cantrips, got ${choices.cantrips.length}`),
    );
  }
  for (const id of duplicates(choices.cantrips)) {
    problems.push(problem('duplicate_spell', 'cantrips', `${id} is known twice`));
  }
  for (const id of choices.cantrips) {
    problems.push(
      ...checkSpellId(id, 'cantrips', definition.id, { minLevel: 0, maxLevel: 0, what: 'a cantrip' }),
    );
  }

  // — the spellbook ———————————————————————————————————————————————————————
  //
  // Only a class that *has* one. SRD gives a Cleric no book at all: they
  // prepare from the whole class list every morning, and a spellbook entry on
  // a Cleric is a mistake rather than a spell.
  const style = definition.spellcasting?.style ?? 'spellbook';

  if (style !== 'spellbook') {
    if (choices.spellbook.length > 0) {
      problems.push(
        problem('no_spellbook', 'spellbook', `a ${definition.name} has no spellbook to write spells in`),
      );
    }
    problems.push(...checkPreparedFromList(choices, definition, row.value, topSlot, style));
    return problems;
  }

  // The count rule applies to the spells *levelling* granted. Spells copied
  // from a scroll in play ride along and are not counted, or a Wizard who had
  // adventured could not level up.
  const granted = countOf(choices.spellbook, 'level');
  const expected = levelGrantedSpells(choices.level);
  if (granted !== expected) {
    problems.push(
      problem('wrong_spellbook_count', 'spellbook', `a level ${choices.level} ${definition.name} is granted ${expected} spells by levelling, got ${granted}; spells copied in play carry origin "copied" and are not counted`),
    );
  }
  for (const id of duplicates(spellIds(choices.spellbook))) {
    problems.push(problem('duplicate_spell', 'spellbook', `${id} is written in the book twice`));
  }
  for (const entry of choices.spellbook) {
    problems.push(
      ...checkSpellId(entry.spellId, 'spellbook', definition.id, {
        minLevel: 1,
        maxLevel: topSlot,
        what: 'a spellbook',
      }),
    );
    if (!Number.isInteger(entry.acquiredAt) || entry.acquiredAt < 1 || entry.acquiredAt > choices.level) {
      problems.push(
        problem('bad_acquisition_level', 'spellbook', `${entry.spellId} says it was acquired at level ${entry.acquiredAt}, which is not a level this character has reached`),
      );
    }
  }

  // — what is prepared ————————————————————————————————————————————————————
  const prepared = row.value.preparedSpells ?? 0;
  if (choices.preparedSpells.length !== prepared) {
    problems.push(
      problem('wrong_prepared_count', 'preparedSpells', `a level ${choices.level} ${definition.name} prepares ${prepared} spells, got ${choices.preparedSpells.length}`),
    );
  }
  for (const id of duplicates(choices.preparedSpells)) {
    problems.push(problem('duplicate_spell', 'preparedSpells', `${id} is prepared twice`));
  }

  const book = new Set([...spellIds(choices.spellbook), ...fromFeatures]);
  for (const id of choices.preparedSpells) {
    if (!book.has(id)) {
      problems.push(
        problem('spell_not_in_spellbook', 'preparedSpells', `${id} is not in the spellbook`),
      );
      continue;
    }
    // SRD: "The chosen spells must be of a level for which you have spell slots."
    const spell = lookupSpell(id);
    if (spell !== null && spell.level > topSlot) {
      problems.push(
        problem('prepared_above_slot_level', 'preparedSpells', `${spell.name} is level ${spell.level}, and this character has no slot above level ${topSlot}`),
      );
    }
  }

  return problems;
}

/**
 * SRD Evocation Savant: "Choose two Wizard spells from the Evocation school,
 * each of which must be no higher than level 2, and add them to your spellbook
 * for free."
 *
 * Checked on its own terms rather than folded into the spellbook rules: the
 * school and the level cap are the feature's, not the book's, and a spell that
 * fails them should say which rule it broke.
 */
/**
 * Preparation for a class whose spells come from its own list.
 *
 * SRD Cleric: "You prepare the list of spells that are available for you to
 * cast... choosing from the Cleric spell list." There is no book in between,
 * so the only questions are how many, whether they are on the list, and
 * whether the character has slots of that level — which is the same last rule
 * a Wizard obeys, reached by a different route.
 *
 * A `known` class never prepares at all: the same list is what it knows, and
 * the count is the table's. The difference between the two is when the list
 * may change, which is a rest rule rather than a creation rule.
 */
function checkPreparedFromList(
  choices: CharacterChoices,
  definition: ClassDefinition,
  row: ClassLevelRow,
  topSlot: number,
  style: SpellcastingStyle,
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const expected = row.preparedSpells ?? 0;
  const what = style === 'known' ? 'knows' : 'prepares';

  if (choices.preparedSpells.length !== expected) {
    problems.push(
      problem('wrong_prepared_count', 'preparedSpells', `a level ${choices.level} ${definition.name} ${what} ${expected} spells, got ${choices.preparedSpells.length}`),
    );
  }
  for (const id of duplicates(choices.preparedSpells)) {
    problems.push(problem('duplicate_spell', 'preparedSpells', `${id} is prepared twice`));
  }

  const granted = new Set(spellsFromFeatures(choices, definition));
  for (const id of choices.preparedSpells) {
    // A feature's free spells are already the character's; they need not be on
    // the class list, which is the whole point of a domain or subclass grant.
    if (granted.has(id)) continue;
    problems.push(
      ...checkSpellId(id, 'preparedSpells', definition.id, {
        minLevel: 1,
        maxLevel: topSlot,
        what: `a ${definition.name} spell`,
      }),
    );
  }

  return problems;
}

function checkEvocationSavant(
  choices: CharacterChoices,
  definition: ClassDefinition,
): CreationProblem[] {
  const picked = choices.featureChoices['evoker:evocation-savant'];
  if (picked === undefined) return [];

  const problems: CreationProblem[] = [];
  for (const id of duplicates(picked)) {
    problems.push(problem('duplicate_spell', 'featureChoices', `Evocation Savant chose ${id} twice`));
  }
  for (const id of picked) {
    problems.push(
      ...checkSpellId(id, 'featureChoices', definition.id, {
        minLevel: 1,
        maxLevel: 2,
        school: 'evocation',
        what: 'Evocation Savant',
      }),
    );
  }

  // The free spells go into the book, so they must not already be in it.
  const fromLevels = new Set(
    choices.spellbook.filter((e) => e.origin !== 'feature').map((e) => e.spellId),
  );
  for (const id of picked) {
    if (fromLevels.has(id)) {
      problems.push(
        problem('spell_already_known', 'featureChoices', `${id} is already in the spellbook, so Evocation Savant would grant nothing`),
      );
    }
  }

  return problems;
}

/**
 * Feats, and the choices each one demands.
 *
 * The engine does not execute feats; it does make sure the choices they
 * require were actually made, because a missing one must be an actionable
 * error rather than a silent gap on a sheet.
 */
function checkFeats(
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const taken: { feature: string; feat: FeatDefinition; choice: FeatChoice }[] = [];

  for (const feature of features) {
    const fixed = feature.grantsFeat;
    const asksForOne = feature.choice?.kind === 'feat';
    if (fixed === undefined && !asksForOne) continue;

    const made = choices.feats[feature.id];
    if (made === undefined) {
      problems.push(
        problem('missing_feat_choice', 'feats', `${feature.id} (${feature.name}) grants a feat, and none was chosen`),
      );
      continue;
    }

    const definition = featById(made.featId);
    if (definition === null) {
      problems.push(problem('unknown_feat', 'feats', `no Origin feat with the id ${made.featId}`));
      continue;
    }
    if (fixed !== undefined && made.featId !== fixed.featId) {
      problems.push(
        problem('wrong_feat', 'feats', `${feature.name} grants ${fixed.featId}, not ${made.featId}`),
      );
      continue;
    }
    if (feature.choice?.kind === 'feat' && feature.choice.category !== undefined
        && definition.category !== feature.choice.category) {
      problems.push(
        problem('wrong_feat_category', 'feats', `${feature.name} grants a ${feature.choice.category} feat; ${definition.name} is ${definition.category}`),
      );
      continue;
    }

    taken.push({ feature: feature.id, feat: definition, choice: made });
    problems.push(...checkFeatChoice(feature.id, definition, made, fixed?.spellList));
  }

  // SRD Magic Initiate: "you must choose a different spell list each time."
  const lists = taken
    .filter((t) => t.feat.id === 'magic-initiate')
    .map((t) => t.choice.spellList);
  for (const list of duplicates(lists.filter((l): l is string => l !== undefined))) {
    problems.push(
      problem('repeated_spell_list', 'feats', `Magic Initiate was taken twice from the ${list} list; each must be a different list`),
    );
  }

  // Nothing but Magic Initiate may be taken twice.
  const ids = taken.filter((t) => !t.feat.repeatable).map((t) => t.feat.id);
  for (const id of duplicates(ids)) {
    problems.push(problem('repeated_feat', 'feats', `${id} cannot be taken more than once`));
  }

  return problems;
}

function checkFeatChoice(
  featureId: string,
  definition: FeatDefinition,
  made: FeatChoice,
  fixedList: string | undefined,
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const where = `${featureId} → ${definition.name}`;
  const requires = definition.requires;

  if (requires.kind === 'magic-initiate') {
    const list = made.spellList;
    if (list === undefined) {
      problems.push(problem('missing_spell_list', 'feats', `${where} needs a spell list: ${requires.lists.join(', ')}`));
    } else if (!requires.lists.includes(list)) {
      problems.push(problem('unknown_spell_list', 'feats', `${where} offers ${requires.lists.join(', ')}, not ${list}`));
    } else if (fixedList !== undefined && list !== fixedList) {
      problems.push(problem('wrong_spell_list', 'feats', `${where} is fixed to the ${fixedList} list`));
    }

    // SRD: "Intelligence, Wisdom, or Charisma is your spellcasting ability for
    // this feat's spells (choose when you select this feat)."
    const ability = made.spellcastingAbility;
    if (ability === undefined || !['int', 'wis', 'cha'].includes(ability)) {
      problems.push(
        problem('missing_spellcasting_ability', 'feats', `${where} needs a spellcasting ability of Intelligence, Wisdom or Charisma`),
      );
    }

    const cantrips = made.cantrips ?? [];
    if (cantrips.length !== 2) {
      problems.push(problem('wrong_cantrip_count', 'feats', `${where} learns two cantrips, got ${cantrips.length}`));
    }
    for (const id of duplicates(cantrips)) {
      problems.push(problem('duplicate_spell', 'feats', `${where} chose ${id} twice`));
    }
    if (list !== undefined && requires.lists.includes(list)) {
      for (const id of cantrips) {
        problems.push(...checkSpellId(id, 'feats', list, { minLevel: 0, maxLevel: 0, what: where }));
      }
      const one = made.levelOneSpell;
      if (one === undefined) {
        problems.push(problem('missing_level_one_spell', 'feats', `${where} needs one level 1 spell`));
      } else {
        problems.push(...checkSpellId(one, 'feats', list, { minLevel: 1, maxLevel: 1, what: where }));
      }
    }
  }

  if (requires.kind === 'proficiencies') {
    const picked = made.proficiencies ?? [];
    if (picked.length !== requires.choose) {
      problems.push(
        problem('wrong_proficiency_count', 'feats', `${where} grants ${requires.choose} proficiencies, got ${picked.length}`),
      );
    }
    for (const id of duplicates(picked)) {
      problems.push(problem('duplicate_proficiency', 'feats', `${where} chose ${id} twice`));
    }
  }

  return problems;
}

function equipmentFrom(
  packages: readonly { option: string; items: readonly EquipmentEntry[]; goldPieces: number }[],
  option: string,
  field: string,
): Result<{ items: readonly EquipmentEntry[]; goldPieces: number }> {
  const chosen = packages.find((p) => p.option === option);
  if (chosen === undefined) {
    return err(
      'unknown_equipment_option',
      `${field}: no package ${option}; have ${packages.map((p) => p.option).join(' or ')}`,
    );
  }
  return ok({ items: chosen.items, goldPieces: chosen.goldPieces });
}

/**
 * SRD: level 1 grants the maximum die; later levels the fixed value or a roll,
 * plus the Constitution modifier, "minimum of 1" per level.
 */
export function hitPointsFor(
  definition: ClassDefinition,
  level: number,
  constitution: number,
  hitPoints: HitPointChoice,
): number {
  const fixed = Math.floor(definition.hitDie / 2) + 1;
  let total = definition.hitDie + constitution;

  for (let gained = 2; gained <= level; gained += 1) {
    const die =
      hitPoints.method === 'rolled' ? (hitPoints.rolls[gained - 2] ?? fixed) : fixed;
    total += Math.max(1, die + constitution);
  }

  return Math.max(1, total);
}

/** SRD "Choose Languages": Common, plus two from the Standard Languages table. */
function checkLanguages(choices: CharacterChoices): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const chosen = choices.languages.filter((language) => language !== COMMON);

  if (chosen.length !== LANGUAGES_CHOSEN) {
    problems.push(
      problem('wrong_language_count', 'languages', `a character knows Common plus ${LANGUAGES_CHOSEN} more, got ${chosen.length}`),
    );
  }
  for (const language of duplicates(chosen)) {
    problems.push(problem('duplicate_language', 'languages', `${language} is listed twice`));
  }
  for (const language of chosen) {
    if (!STANDARD_LANGUAGES.includes(language)) {
      problems.push(
        problem('unknown_language', 'languages', `${language} is not on the Standard Languages table`),
      );
    }
  }
  return problems;
}

/**
 * SRD "Starting at Higher Levels": the GM decides what a character above level
 * 1 starts with beyond the standard package.
 *
 * Not a default the engine can supply, so above level 1 the decision has to be
 * stated. An empty grant with a note is a perfectly good answer; an absent one
 * means nobody decided, and that is what this refuses.
 */
function checkDmGrants(choices: CharacterChoices): CreationProblem[] {
  if (choices.level === 1) return [];
  if (choices.dmGrants === undefined) {
    return [
      problem('missing_dm_grants', 'dmGrants', `a character created at level ${choices.level} starts with what the GM decides beyond the standard package — state it, even if it is nothing`),
    ];
  }
  if (choices.dmGrants.note.trim() === '') {
    return [problem('unexplained_dm_grants', 'dmGrants', 'say why, so the decision is legible later')];
  }
  return [];
}

/** Everything owned: both packages, plus whatever the GM added. */
function inventoryOf(
  choices: CharacterChoices,
  parts: Parts,
): Result<{ items: readonly InventoryLine[]; goldPieces: number }> {
  const classKit = equipmentFrom(parts.definition.startingEquipment, choices.classEquipment, 'classEquipment');
  if (!classKit.ok) return classKit;
  const backgroundKit = equipmentFrom(parts.background.startingEquipment, choices.backgroundEquipment, 'backgroundEquipment');
  if (!backgroundKit.ok) return backgroundKit;

  return ok({
    // SRD offers "Choose A or B": the package *or* the money. Each package
    // contributes exactly one of its halves, and both halves come from the
    // same chosen option, so nothing is granted twice.
    items: openPackages([
      ...classKit.value.items,
      ...backgroundKit.value.items,
      ...(choices.dmGrants?.items ?? []),
    ]),
    goldPieces:
      classKit.value.goldPieces + backgroundKit.value.goldPieces + (choices.dmGrants?.goldPieces ?? 0),
  });
}

/** Only what is owned can be worn or held. */
function checkEquipped(
  choices: CharacterChoices,
  owned: readonly InventoryLine[],
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const held = new Set(owned.map((line) => line.id));
  for (const itemId of choices.equipped) {
    if (itemFor(itemId) === null) {
      problems.push(problem('unknown_item', 'equipped', `${itemId} is not in the catalogue`));
      continue;
    }
    if (!held.has(itemId)) {
      problems.push(problem('not_owned', 'equipped', `${itemId} is equipped but not owned`));
    }
  }
  for (const itemId of duplicates(choices.equipped)) {
    problems.push(problem('duplicate_equipped', 'equipped', `${itemId} is equipped twice`));
  }

  // SRD wears one suit of body armour and holds one Shield. `equipItem`
  // already refuses a second of either; creation must refuse it too, or a
  // character can be born wearing two suits and the sheet has to pick one.
  const slots = new Map<string, string>();
  for (const itemId of choices.equipped) {
    const armor = itemFor(itemId)?.armor;
    if (armor == null) continue;
    const slot = armor.category === 'shield' ? 'shield' : 'body armour';
    const taken = slots.get(slot);
    if (taken === undefined) {
      slots.set(slot, itemId);
    } else {
      problems.push(
        problem('slot_taken', 'equipped', `${taken} and ${itemId} cannot both be worn as ${slot}`),
      );
    }
  }
  return problems;
}

/**
 * Everything a package puts in your hands, packs opened.
 *
 * SRD prices a pack as a bundle and lists its contents, so a Scholar's Pack is
 * nine things. A character who owns the label owns nothing useful.
 */
function openPackages(items: readonly EquipmentEntry[]): readonly InventoryLine[] {
  const lines: InventoryLine[] = [];
  for (const entry of items) {
    for (const line of expandPack(entry.id)) {
      lines.push({ id: line.id, quantity: line.quantity * entry.quantity });
    }
  }
  return mergeItems([], lines);
}

/**
 * Skill and tool proficiencies, gathered from every source.
 *
 * SRD 5.2.1 gives **no** rule letting a player re-pick a proficiency they
 * already have — the 2014 guidance to that effect is not reproduced. So the
 * engine does not invent one. Proficiency is binary, as the glossary says, so
 * overlapping grants union; a pick that was already covered is reported as a
 * *warning* and the table decides what to do about it.
 */
function gatherProficiencies(
  choices: CharacterChoices,
  parts: Parts,
): {
  skills: ReadonlySet<Skill>;
  tools: readonly string[];
  warnings: CreationProblem[];
} {
  const warnings: CreationProblem[] = [];
  const skills = new Set<Skill>();
  const tools: string[] = [];

  const add = (name: string, source: string, field: string): void => {
    if ((SKILLS as readonly string[]).includes(name)) {
      if (skills.has(name as Skill)) {
        warnings.push(
          problem('redundant_proficiency', field, `${source} grants ${name}, which this character already has; the SRD gives no rule for swapping it, so it is simply not doubled`),
        );
      }
      skills.add(name as Skill);
      return;
    }
    if (tools.includes(name)) {
      warnings.push(
        problem('redundant_proficiency', field, `${source} grants ${name}, which this character already has`),
      );
      return;
    }
    tools.push(name);
  };

  for (const skill of parts.background.skillProficiencies) add(skill, parts.background.name, 'backgroundId');
  add(parts.background.toolProficiency, parts.background.name, 'backgroundId');
  for (const skill of choices.classSkills) add(skill, parts.definition.name, 'classSkills');
  for (const skill of choices.featureChoices['human:skillful'] ?? []) add(skill, 'Skillful', 'featureChoices');
  for (const feat of Object.values(choices.feats)) {
    for (const name of feat.proficiencies ?? []) add(name, 'Skilled', 'feats');
  }

  return { skills, tools, warnings };
}

/** Every problem with a set of choices, so a caller can show them all at once. */
export function checkCharacter(
  choices: CharacterChoices,
  carried?: readonly InventoryLine[],
): readonly CreationProblem[] {
  const { parts, problems } = resolveParts(choices);
  if (parts === null) return problems;

  const all = [
    ...problems,
    ...checkAbilities(choices, parts.background),
    ...checkSkills(choices, parts.definition),
    ...checkLanguages(choices),
    ...checkDmGrants(choices),
  ];

  const { skills } = gatherProficiencies(choices, parts);
  const features = grantedFeatures(choices, parts);

  all.push(...checkFeatureChoices(choices, features, skills));
  all.push(...checkFeats(choices, features));
  all.push(...checkSpells(choices, parts.definition));
  all.push(...checkEvocationSavant(choices, parts.definition));

  const owned = inventoryOf(choices, parts);
  if (!owned.ok) {
    all.push(problem(owned.code, 'classEquipment', owned.reason));
  } else {
    all.push(...checkEquipped(choices, carried ?? owned.value.items));
  }

  if (choices.name.trim() === '') {
    all.push(problem('no_name', 'name', 'a character needs a name'));
  }
  if (!ALIGNMENTS.includes(choices.alignment)) {
    all.push(
      problem('unknown_alignment', 'alignment', `choose one of: ${ALIGNMENTS.join(', ')}`),
    );
  }

  return all;
}

/**
 * Turn choices into everything derived from them, or refuse.
 *
 * The first problem is returned as the error, because `Result` carries one —
 * `checkCharacter` is there for a caller that wants the whole list.
 *
 * `carried` is what the creature *actually* owns, for a character who already
 * exists. At creation there is no such thing, and the packages are the answer;
 * once the character is playing, the inventory is state and the packages are a
 * record of one decision made at level 1. Levelling up has to read the first,
 * or a GM note that does not re-list last season's chain shirt takes it away.
 */
export function planCharacter(
  choices: CharacterChoices,
  carried?: readonly InventoryLine[],
): Result<CharacterPlan> {
  const problems = checkCharacter(choices, carried);
  const first = problems[0];
  if (first !== undefined) return err(first.code, `${first.field}: ${first.reason}`);

  const { parts } = resolveParts(choices);
  if (parts === null) return err('unknown_class', 'the character has no class');
  const { definition, species } = parts;

  const scores = finalScores(choices);
  const features = grantedFeatures(choices, parts);
  const { skills: proficient, tools, warnings } = gatherProficiencies(choices, parts);

  const expertise = new Set(expertiseSkills(choices, parts));
  const skills: Partial<Record<Skill, 'proficient' | 'expertise'>> = {};
  for (const skill of proficient) {
    skills[skill] = expertise.has(skill) ? 'expertise' : 'proficient';
  }

  // Armour Class reads what is *worn*, not what is owned. A suit of chain mail
  // in the backpack protects nobody.
  const equipped = choices.equipped.map((itemId) => itemFor(itemId)?.armor ?? null);
  const worn = equipped.find((piece) => piece !== null && piece.category !== 'shield') ?? null;
  const held = equipped.find((piece) => piece !== null && piece.category === 'shield') ?? null;

  const sheet: CharacterSheet = {
    level: choices.level,
    abilities: scores,
    skills,
    saveProficiencies: definition.saveProficiencies,
    armor: worn,
    shield: held,
    armorTraining: definition.armorTraining,
    baseSpeed: species.speed,
    spellcastingAbility: definition.primaryAbility,
  };

  const owned = inventoryOf(choices, parts);
  if (!owned.ok) return owned;

  const savant = spellsFromFeatures(choices, definition, parts).map((spellId) => ({
    spellId,
    acquiredAt: choices.level,
    origin: 'feature' as const,
  }));

  // A feat's spells reach usable state here, rather than sitting in a record
  // nothing reads. Magic Initiate brings its own ability and its own free
  // daily casting; the class's prepared list is untouched by it.
  const granted: GrantedSpell[] = [];
  for (const [featureId, feat] of Object.entries(choices.feats)) {
    if (feat.featId !== 'magic-initiate') continue;
    const ability = feat.spellcastingAbility;
    if (ability === undefined) continue;

    for (const cantrip of feat.cantrips ?? []) {
      granted.push({
        spellId: cantrip,
        source: featureId,
        ability,
        freeCastPool: null,
        slotCasting: false,
      });
    }
    if (feat.levelOneSpell !== undefined) {
      granted.push({
        spellId: feat.levelOneSpell,
        source: featureId,
        ability,
        freeCastPool: freeCastPoolKey(featureId),
        slotCasting: true,
      });
    }
  }

  // SRD Life Domain Spells: "you thereafter always have the listed spells
  // prepared" — over and above what the class table allows, so they are added
  // rather than counted against it. A Wizard's feature spells went into the
  // spellbook instead, which is the same grant reaching a different place
  // because the two classes come by their spells differently.
  const alwaysPrepared =
    definition.spellcasting?.style === 'spellbook'
      ? []
      : spellsFromFeatures(choices, definition, parts).filter(
          (spellId) => !choices.preparedSpells.includes(spellId),
        );

  const spellcasting: SpellcastingState = {
    // Null for a class that does not cast. A Fighter's primary ability is
    // Strength, and reading it as a spellcasting ability would give them a
    // spell save DC — for spells they cannot cast, off an ability that has
    // nothing to do with magic. A feat's granted spells carry their own.
    ability: definition.spellcasting?.ability ?? null,
    cantrips: choices.cantrips,
    prepared: [...choices.preparedSpells, ...alwaysPrepared],
    granted,
  };

  // SRD Alert: "When you roll Initiative, you can add your Proficiency Bonus."
  const hasAlert = Object.values(choices.feats).some((feat) => feat.featId === 'alert');
  const initiativeBonuses = hasAlert
    ? [{ source: 'Alert', flat: proficiencyBonusForLevel(choices.level) }]
    : [];

  return ok({
    sheet,
    proficiencyBonus: proficiencyBonusForLevel(choices.level),
    hitPointMaximum: hitPointsFor(definition, choices.level, abilityModifier(scores.con), choices.hitPoints),
    hitDie: definition.hitDie,
    spellSlots: slotsAt(definition, choices.level),
    cantrips: choices.cantrips,
    // The Evoker's free Evocation spells join the book, marked as the feature's.
    spellbook: [...choices.spellbook, ...savant],
    preparedSpells: choices.preparedSpells,
    inventory: owned.value.items,
    equipped: choices.equipped,
    goldPieces: owned.value.goldPieces,
    // SRD: "You begin with the minimum amount of XP required to reach your
    // starting level."
    experiencePoints: XP_THRESHOLDS[choices.level - 1] ?? 0,
    languages: [COMMON, ...choices.languages.filter((l) => l !== COMMON)],
    alignment: choices.alignment,
    toolProficiencies: tools,
    magicItems: choices.dmGrants?.magicItems ?? [],
    creatureType: species.creatureType,
    features,
    spellcasting,
    initiativeBonuses,
    feats: Object.entries(choices.feats).map(([featureId, feat]) => {
      const definitionOfFeat = featById(feat.featId);
      return `${definitionOfFeat?.name ?? feat.featId} (${featureId})`;
    }),
    warnings,
  });
}

/**
 * The pool that holds a feat's free daily casting.
 *
 * SRD Magic Initiate: "You can cast it once without a spell slot, and you
 * regain the ability to cast it in that way when you finish a Long Rest." That
 * is a resource pool like any other, so it is one.
 */
export const freeCastPoolKey = (featureId: string): string => `${featureId}:free-cast`;

/** The pools a character of this class and level has. */
function poolEvents(
  id: CharacterId,
  definition: ClassDefinition,
  plan: CharacterPlan,
  level: number,
  features: readonly FeatureDefinition[],
): GameEvent[] {
  const events: GameEvent[] = [
    {
      type: 'resource-pool-declared',
      id,
      pool: {
        key: hitDieKey(definition.hitDie),
        label: `Hit Die (d${definition.hitDie})`,
        max: level,
        recovers: 'long-rest',
      },
    },
  ];

  for (const [slotLevel, count] of Object.entries(plan.spellSlots)) {
    events.push({
      type: 'resource-pool-declared',
      id,
      pool: {
        key: spellSlotKey(Number(slotLevel)),
        label: `level ${slotLevel} spell slot`,
        max: count,
        // A Warlock's Pact Magic slots come back on a Short Rest.
        recovers: definition.spellcasting?.slotRecovery ?? 'long-rest',
      },
    });
  }

  // A feat's free casting is a pool too, one per grant that has one.
  for (const grant of plan.spellcasting.granted) {
    if (grant.freeCastPool === null) continue;
    events.push({
      type: 'resource-pool-declared',
      id,
      pool: {
        key: grant.freeCastPool,
        label: `free casting of ${grant.spellId}`,
        max: 1,
        recovers: 'long-rest',
      },
    });
  }

  // A feature that is its own limited resource declares its pool. Arcane
  // Recovery is the only one at this level; the list is data, not a special case.
  if (features.some((f) => f.id === 'wizard:arcane-recovery')) {
    events.push({
      type: 'resource-pool-declared',
      id,
      pool: {
        key: 'wizard:arcane-recovery',
        label: 'Arcane Recovery',
        max: 1,
        recovers: 'long-rest',
      },
    });
  }

  return events;
}

/** Create a character: the creature, its pools, and the choices that made it. */
export function createCharacter(
  choices: CharacterChoices,
  id: CharacterId,
): Result<GameEvent[]> {
  const plan = planCharacter(choices);
  if (!plan.ok) return plan;

  const definition = classById(choices.classId);
  if (definition === null) return err('unknown_class', `no class called ${choices.classId}`);

  return ok([
    {
      type: 'creature-added',
      id,
      name: choices.name,
      sheet: plan.value.sheet,
      maxHp: plan.value.hitPointMaximum,
      creatureType: plan.value.creatureType,
    },
    {
      type: 'character-created',
      id,
      spellcasting: plan.value.spellcasting,
      initiativeBonuses: plan.value.initiativeBonuses,
      record: {
        classId: choices.classId,
        subclassId: choices.subclassId ?? null,
        speciesId: choices.speciesId,
        backgroundId: choices.backgroundId,
        level: choices.level,
        choices,
      },
    },
    ...(plan.value.inventory.length === 0
      ? []
      : [
          {
            type: 'items-gained' as const,
            id,
            items: plan.value.inventory,
            source: 'starting equipment',
          },
        ]),
    ...(plan.value.goldPieces === 0
      ? []
      : [
          {
            type: 'coins-changed' as const,
            id,
            copper: goldToCopper(plan.value.goldPieces),
            source: 'starting money',
          },
        ]),
    ...choices.equipped.map((itemId) => ({ type: 'item-equipped' as const, id, item: itemId })),
    ...poolEvents(id, definition, plan.value, choices.level, plan.value.features),
  ]);
}

/** What a level-up asks for, on top of what the character already chose. */
export interface AdvanceChoices {
  readonly subclassId?: string;
  readonly cantrips?: readonly string[];
  /**
   * The spells this level grants — two, for a Wizard. Added to the book as
   * `level`, which is the subset the count rule measures.
   */
  readonly newSpells?: readonly string[];
  /**
   * Spells copied from scrolls or other books since the last level.
   *
   * Added as `copied` and therefore *not* counted. A Wizard who looted a spell
   * scroll last session must not be told their book is the wrong size.
   */
  readonly copiedSpells?: readonly string[];
  readonly preparedSpells?: readonly string[];
  readonly hitPointRoll?: number;
  readonly featureChoices?: Readonly<Record<string, readonly string[]>>;
  readonly feats?: Readonly<Record<string, FeatChoice>>;
  readonly dmGrants?: DmGrants;
}

/**
 * Gain a level, keeping everything the character currently is.
 *
 * Emphatically *not* a rebuild. A wizard who levels up mid-dungeon keeps their
 * wounds, their conditions and the slots they have already spent — so this
 * emits the differences: the new hit points, the pools that grew, the choices
 * that changed. Re-creating the creature would silently heal them and refill
 * everything, which is the kind of bug nobody notices until a boss fight.
 */
export function advanceCharacter(
  state: GameState,
  id: CharacterId,
  advance: AdvanceChoices,
): Result<GameEvent[]> {
  const creature = state.creatures[id];
  if (creature === undefined) return err('unknown_creature', `${id} is not in this game`);

  const record = creature.character;
  if (record === null || record === undefined) {
    return err('not_a_character', `${id} was not created from character choices`);
  }

  const level = record.level + 1;
  if (level > MAX_LEVEL) {
    return err('bad_level', `${id} is already level ${MAX_LEVEL}`);
  }

  const choices: CharacterChoices = {
    ...record.choices,
    level,
    ...(advance.subclassId === undefined ? {} : { subclassId: advance.subclassId }),
    ...(advance.cantrips === undefined ? {} : { cantrips: advance.cantrips }),
    spellbook: [
      ...record.choices.spellbook,
      ...(advance.newSpells ?? []).map((spellId) => ({
        spellId,
        acquiredAt: level,
        origin: 'level' as const,
      })),
      ...(advance.copiedSpells ?? []).map((spellId) => ({
        spellId,
        acquiredAt: level,
        origin: 'copied' as const,
      })),
    ],
    ...(advance.preparedSpells === undefined ? {} : { preparedSpells: advance.preparedSpells }),
    ...(advance.hitPointRoll === undefined
      ? {}
      : { hitPoints: rollsFor(record.choices.hitPoints, level, advance.hitPointRoll) }),
    featureChoices: { ...record.choices.featureChoices, ...(advance.featureChoices ?? {}) },
    feats: { ...record.choices.feats, ...(advance.feats ?? {}) },
    ...(advance.dmGrants === undefined ? {} : { dmGrants: advance.dmGrants }),
    // What is worn is live state, not a choice made at level 1. A shirt bought
    // and put on in play is on; one taken off is off; and the record the new
    // level stores should say which.
    equipped: [...creature.equipped],
  };

  const plan = planCharacter(choices, creature.inventory);
  if (!plan.ok) return plan;

  const definition = classById(choices.classId);
  if (definition === null) return err('unknown_class', `no class called ${choices.classId}`);

  const events: GameEvent[] = [];

  const gained = plan.value.hitPointMaximum - creature.vitals.hpMax;
  if (gained > 0) events.push({ type: 'hit-point-maximum-raised', id, amount: gained });

  // Pools that already exist grow; pools that did not exist are declared. Both
  // leave what has been spent alone.
  const hitDice = hitDieKey(definition.hitDie);
  events.push({ type: 'resource-pool-resized', id, key: hitDice, max: level });

  for (const [slotLevel, count] of Object.entries(plan.value.spellSlots)) {
    const key = spellSlotKey(Number(slotLevel));
    events.push(
      creature.resources.pools[key] === undefined
        ? {
            type: 'resource-pool-declared',
            id,
            pool: {
              key,
              label: `level ${slotLevel} spell slot`,
              max: count,
              recovers: definition.spellcasting?.slotRecovery ?? 'long-rest',
            },
          }
        : { type: 'resource-pool-resized', id, key, max: count },
    );
  }

  events.push({
    type: 'character-advanced',
    id,
    sheet: plan.value.sheet,
    spellcasting: plan.value.spellcasting,
    initiativeBonuses: plan.value.initiativeBonuses,
    record: {
      classId: choices.classId,
      subclassId: choices.subclassId ?? null,
      speciesId: choices.speciesId,
      backgroundId: choices.backgroundId,
      level,
      choices,
    },
  });

  return ok(events);
}

const rollsFor = (current: HitPointChoice, level: number, roll: number): HitPointChoice => {
  const rolls = current.method === 'rolled' ? [...current.rolls] : [];
  rolls[level - 2] = roll;
  return { method: 'rolled', rolls };
};
