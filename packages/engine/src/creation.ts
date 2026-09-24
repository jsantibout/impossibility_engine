import {
  ABILITIES,
  ABILITY_NAMES,
  SKILLS,
  type ConditionName,
  err,
  needsContext,
  ok,
  type Ability,
  type CharacterId,
  type Result,
  type Skill,
} from '@ie/shared';
// The subpath, never the barrel, for the reason `content.ts` gives: the
// barrel re-exports the parsed book. `schemas.ts` imports zod and nothing
// else, so the six size categories are the book's own list rather than a
// fourth copy of it.
import { CREATURE_SIZES, type CreatureSize } from '@ie/srd/schemas';
import { proficientWithCategories } from './attack.js';
import { parseNotation } from './dice.js';
import {
  ABILITY_SCORE_MAXIMUM,
  DEFAULT_HANDS,
  MAX_ABILITY_SCORE,
  abilityModifier,
  proficiencyBonusForLevel,
  type ArmorTraining,
  type BudgetPurchase,
  type CharacterSheet,
  type DropReward,
  type UnarmoredDefense,
} from './character.js';
import type {
  ActivatedFeature,
  ActivationSpan,
  HealAmount,
  FailedSaveDamage,
  HealingTouch,
  CastingOption,
  HitOption,
  KnownFact,
  ObjectMaker,
  PoolOption,
  RecoveryFeature,
  SelfHealFeature,
  ShapeShift,
  StandingEffect,
  StandingGrant,
  StrikeStyle,
  TradeFeature,
} from './standing.js';
import type { TurnAnchor } from './time.js';
import { statedDamageType, type SpellEffect } from './spell-definitions.js';
import { formIneligibility } from './monster.js';
import type {
  ConferrableReaction,
  ReactionAddend,
  ReactionAmount,
  ReactionEffect,
  ReactionFeature,
  FeatureReactionWindow,
} from './reactions.js';
import { goldToCopper, handsFor, itemStandingEffects, type CatalogueItem } from './catalogue.js';
import { issueItemCopies } from './commands/inventory.js';
import type { Content } from './content.js';
import { mergeItems } from './events.js';
import type { GameEvent, GameState, InventoryLine } from './events.js';
import {
  LANGUAGES_CHOSEN,
  POINT_BUY_BUDGET,
  POINT_COSTS,
  STANDARD_ARRAY,
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
  choiceAnswerKey,
  featureChoicesOf,
  featureGrants,
  featureOfAnswerKey,
  primaryChoiceOf,
  rechosenSpellKey,
  type ClassDefinition,
  type EquipmentEntry,
  type ClassLevelRow,
  type FeatureChoice,
  type FeatureDefinition,
  type PoolOptionGrant,
  type FeatureGrant,
  type GatedFeatureGrant,
  type HealGrant,
  type SpellcastingStyle,
  type SubclassDefinition,
  type ReactionGrantAmount,
  type ReactionGrantEffect,
  type ShapeShiftRow,
  type RestRechoice,
  type TradedAmount,
  type TradedResource,
} from './progression.js';
import type { RestKind } from './rest.js';
import {
  hitDieKey,
  pactSlotKey,
  spellSlotKey,
  type PoolDeclaration,
  type Recovery,
} from './resources.js';
import {
  countOf,
  highestSlotLevel,
  levelGrantedSpells,
  spellIds,
  type SpellbookEntry,
} from './spellbook.js';
import type { GrantedSpell, SpellcastingClass, SpellcastingState } from './spellcasting.js';
import {
  characterLevel,
  combinedArmorTraining,
  hitDicePools,
  meetsPrerequisites,
  multiclassSlots,
  pactSlotsOf,
  type ClassLevel,
} from './multiclass.js';

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
  /**
   * Ability Score Improvement and every Epic Boon: which scores the points go
   * into, **one entry per point**.
   *
   * The same units a feature's `ability-score` answer is written in, because
   * it is the same sentence at a different door: `['str','str']` is "one
   * ability score by 2" and `['str','dex']` is "two ability scores by 1". The
   * spread the player took is counted out of this rather than declared beside
   * it, so there is no second field for the two to disagree through.
   */
  readonly abilities?: readonly string[] | undefined;
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
  /**
   * Which of the sizes the species prints this character is.
   *
   * SRD prints a size on every species and lets two of them print more than
   * one: "Medium (about 4-7 feet tall) or Small (about 2-4 feet tall), chosen
   * when you select this species." So it is a choice like any other where the
   * species offers one, and where the species offers a single size it is not
   * asked and this is left out.
   *
   * **Matched by the printed word**, the way a language and an alignment are,
   * and case does not matter: the species writes "Medium" and the engine
   * spells the category `medium`, and neither is asked to shout at the other.
   */
  readonly size?: string | undefined;
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
  /**
   * Levels in classes other than the one this character started as.
   *
   * SRD's own framing: you begin as one class and "gain a level in a new class
   * whenever you advance in level". So `classId` and `level` stay the starting
   * class — which is the one that grants its *full* proficiencies — and these
   * are the rest. A character with none of these is single-classed and every
   * rule behaves exactly as it did before.
   *
   * Character level is the total. Proficiency Bonus, spell slots and hit
   * points all read the total rather than any one class's level.
   */
  readonly multiclass?: readonly ClassLevel[];
  readonly preparedSpells: readonly string[];
  /**
   * Spells chosen for a class the flat fields above do not describe.
   *
   * SRD Multiclassing: "You determine what spells you can prepare for each
   * class individually, as if you were a single-classed member of that class."
   * A level 4 Ranger / level 3 Sorcerer prepares five level 1 Ranger spells
   * *and* six Sorcerer spells of level 1 or 2 — two lists, two counts, two
   * spellcasting abilities — so one flat list cannot hold them.
   *
   * The asymmetry matches `multiclass` itself and is SRD's own framing: the
   * flat `cantrips`, `spellbook` and `preparedSpells` belong to the character's
   * one *default* casting class — the starting class where it casts, and
   * otherwise the single casting class that has no entry here. A character
   * casting from two classes names at least one of them here, and spells
   * belonging to no class at all are refused rather than quietly filed
   * somewhere.
   */
  readonly spellsByClass?: Readonly<Record<string, ClassSpellChoices>>;
  /** Which starting-equipment package, by the SRD's own label. */
  readonly classEquipment: string;
  readonly backgroundEquipment: string;
  /** Items actually worn or held, which is what Armour Class reads. */
  readonly equipped: readonly string[];
  readonly hitPoints: HitPointChoice;
  /** Choices a feature asks for, keyed by feature id. */
  readonly featureChoices: Readonly<Record<string, readonly string[]>>;
  /**
   * The spellcasting ability a feature that grants a spell asked for, keyed by
   * the feature that asked.
   *
   * `FeatChoice.spellcastingAbility`'s twin, on the other of the two sources
   * that grant a spell to somebody who may cast nothing. SRD Fiendish Legacy:
   * "Intelligence, Wisdom, or Charisma is your spellcasting ability for the
   * spells you cast with this trait (choose the ability when you select the
   * legacy)." A class's spells need none of this, because the class prints the
   * ability; a species prints a choice of three.
   *
   * Keyed by the **asking** feature, so a sibling written in terms of it reads
   * one answer rather than the player giving two — see `GrantGate.choiceFrom`,
   * which is where Otherworldly Presence says whose ability it uses.
   */
  readonly featureSpellcasting?: Readonly<Record<string, Ability>>;
  /** Feats, keyed by the feature that granted them. */
  readonly feats: Readonly<Record<string, FeatChoice>>;
  /** Required above level 1; see {@link DmGrants}. */
  /**
   * The forms a shape-shifting feature has learned — SRD Wild Shape's "You
   * know four Beast forms for this feature".
   *
   * Stat-block ids, checked against the row of the feature's own table for
   * the class level: the type the feature names, the Challenge Rating ceiling,
   * and whether a Fly Speed is allowed yet. A character with the feature and
   * no list has learned nothing yet, which is a real state — a Cleric who has
   * prepared nothing — and a list on a character with no such feature is
   * refused. The owner's ruling of 2026-09-20 makes this a choice re-made at a
   * Long Rest the way prepared spells are; the rest that re-chooses it is not
   * built yet, so today the list is the one the character was made with.
   */
  readonly knownForms?: readonly string[];
  readonly dmGrants?: DmGrants | undefined;
}

/** One casting class's spells, when the flat fields describe a different one. */
export interface ClassSpellChoices {
  readonly cantrips?: readonly string[];
  readonly spellbook?: readonly SpellbookEntry[];
  readonly preparedSpells?: readonly string[];
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
  /**
   * Pact Magic slots, which are a second pool rather than more of the first.
   *
   * SRD keeps them out of the combined Multiclass Spellcaster table and gives
   * them their own recovery, so a Warlock 3 / Wizard 3 has four level 2 slots
   * in total and only two of them come back on a Short Rest.
   */
  readonly pactSlots: Readonly<Record<number, number>>;
  /**
   * Every spellbook entry the character has, across classes.
   *
   * Cantrips and prepared spells are *not* repeated here: they live in
   * `spellcasting`, per class, because which class prepared a spell decides
   * the ability it is cast with. A book is different — it is a physical object
   * with an acquisition history — so it keeps its own field.
   */
  readonly spellbook: readonly SpellbookEntry[];
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
   * How much space this character takes up, derived from their species.
   *
   * Pinned into `creature-added` beside the creature type, for the reason a
   * monster's printed size is pinned there: it is a fact the book prints, the
   * fold opens no catalogue, and before this the only way a size reached the
   * engine was a caller *stating* one when the character was placed on a map.
   */
  readonly size: CreatureSize;
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

function resolveParts(content: Content, choices: CharacterChoices): { parts: Parts | null; problems: CreationProblem[] } {
  const problems: CreationProblem[] = [];

  const definition = content.classById(choices.classId);
  if (definition === null) {
    problems.push(
      problem('unknown_class', 'classId', `no class called ${choices.classId}; have ${content.classes.map((c) => c.id).join(', ')}`),
    );
  }
  const species = content.speciesById(choices.speciesId);
  if (species === null) {
    problems.push(
      problem('unknown_species', 'speciesId', `no species called ${choices.speciesId}; have ${content.species.map((s) => s.id).join(', ')}`),
    );
  }
  const background = content.backgroundById(choices.backgroundId);
  if (background === null) {
    problems.push(
      problem('unknown_background', 'backgroundId', `no background called ${choices.backgroundId}; have ${content.backgrounds.map((b) => b.id).join(', ')}`),
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
      subclass = content.subclassById(choices.subclassId);
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

/**
 * The points one feature adds to ability scores, from what the player chose
 * and from what the feature names outright.
 *
 * SRD writes both halves of the same subject: the Ability Score Improvement
 * feat's "Increase one ability score of your choice by 2, or increase two
 * ability scores of your choice by 1" is asked, and Primal Champion's "Your
 * Strength and Constitution scores increase by 4" is not — and `checkContent`
 * refuses a feature that does both, so at most one branch here contributes.
 *
 * **And the feat this feature granted answers it too**, which is where the
 * SRD puts the sentence: the class feature at level 4 says only "You gain the
 * Ability Score Improvement feat", and the *feat* says "Increase one ability
 * score of your choice by 2, or increase two ability scores of your choice by
 * 1". So the points of one advancement are the feature's own answer or the
 * feat's, summed under the feature that granted it — the key both halves are
 * already filed under, which is what lets {@link abilityMaximums} ask a
 * ceiling about the scores *this* advancement raised.
 *
 * Nothing here refuses; `checkAbilityChoice` and `checkFeatChoice` do, and
 * this is the derivation a legal character is built from.
 */
function abilityPointsFrom(
  content: Content,
  choices: CharacterChoices,
  feature: FeatureDefinition,
): Partial<Record<Ability, number>> {
  const points: Partial<Record<Ability, number>> = {};
  const add = (ability: Ability, amount: number): void => {
    points[ability] = (points[ability] ?? 0) + amount;
  };
  // One entry per point, which is the unit the SRD's sentence counts in —
  // the same units at both doors, so the same counting.
  const spend = (picked: readonly string[]): void => {
    for (const one of picked) {
      if ((ABILITIES as readonly string[]).includes(one)) add(one as Ability, 1);
    }
  };

  for (const grant of grantsOfKind(feature, 'ability-score-increase')) {
    for (const raise of grant.raises ?? []) add(raise.ability, raise.points);
  }

  const feat = choices.feats[feature.id];
  const raises = featureChoicesOf(feature).find((question) => question.kind === 'ability-score');
  if (raises !== undefined && feat === undefined) {
    spend(choices.featureChoices[choiceAnswerKey(feature.id, raises.key)] ?? []);
  }

  if (feat !== undefined) {
    const definition = content.featById(feat.featId);
    if (definition !== null) {
      const taken = definition.grants;
      if (taken?.kind === 'ability-score-increase') {
        for (const raise of taken.raises ?? []) add(raise.ability, raise.points);
      }
      if (definition.requires.kind === 'ability-score') spend(feat.abilities ?? []);
    }
  }

  return points;
}

/** The ceiling this advancement lifted, from the feature or from its feat. */
function abilityCeilingFrom(
  content: Content,
  choices: CharacterChoices,
  feature: FeatureDefinition,
): number | undefined {
  const own = grantOf(feature, 'ability-score-increase')?.maximum;
  const feat = choices.feats[feature.id];
  const definition = feat === undefined ? null : content.featById(feat.featId);
  const fromFeat =
    definition?.grants?.kind === 'ability-score-increase' ? definition.grants.maximum : undefined;
  if (own === undefined) return fromFeat;
  if (fromFeat === undefined) return own;
  return Math.max(own, fromFeat);
}

/** Every point every feature adds, summed across the character's sources. */
function featureAbilityPoints(
  content: Content,
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): Partial<Record<Ability, number>> {
  const total: Partial<Record<Ability, number>> = {};
  for (const feature of features) {
    for (const [ability, points] of Object.entries(abilityPointsFrom(content, choices, feature))) {
      total[ability as Ability] = (total[ability as Ability] ?? 0) + points;
    }
  }
  return total;
}

/**
 * The ceiling each of this character's six scores may reach.
 *
 * {@link ABILITY_SCORE_MAXIMUM} for every score, and higher for the ones an
 * `ability-score-increase` grant lifted — **only** those. An Epic Boon that
 * raised Strength lifts Strength's ceiling to 30 and leaves the other five at
 * 20; two capstones name their own pair and reach 25. The highest wins where
 * two features lift the same score, which is the move `criticalOn` already
 * makes with two thresholds.
 *
 * The grant is read off the feature **and off the feat the feature granted**,
 * because the SRD prints the boon's ceiling on the boon. Which scores it
 * covers is the same question either way: the ones this advancement raised.
 */
function abilityMaximums(
  content: Content,
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): Record<Ability, number> {
  const ceilings = Object.fromEntries(
    ABILITIES.map((ability) => [ability, ABILITY_SCORE_MAXIMUM]),
  ) as Record<Ability, number>;

  for (const feature of features) {
    const maximum = abilityCeilingFrom(content, choices, feature);
    if (maximum === undefined) continue;
    for (const ability of Object.keys(abilityPointsFrom(content, choices, feature)) as Ability[]) {
      ceilings[ability] = Math.max(ceilings[ability], maximum);
    }
  }
  return ceilings;
}

/** SRD: increase one by 2 and another by 1, or all three by 1. */
function checkAbilities(
  content: Content,
  choices: CharacterChoices,
  background: BackgroundDefinition,
  features: readonly FeatureDefinition[],
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const scores = choices.abilities.assignment;

  for (const ability of ABILITIES) {
    const score = scores[ability];
    if (!Number.isInteger(score) || score < 1 || score > MAX_ABILITY_SCORE) {
      problems.push(problem('bad_score', 'abilities', `${ability} must be a score from 1 to ${MAX_ABILITY_SCORE}, got ${score}`));
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

  for (const [ability] of increases) {
    if (!background.abilities.includes(ability as Ability)) {
      problems.push(
        problem('ability_not_offered', 'abilityIncreases', `${background.name} offers ${background.abilities.join(', ')}, not ${ability}`),
      );
    }
  }

  // The ceiling, asked once of the **final** score rather than of each thing
  // that raised it. It used to be the literal 20 inside the loop above, which
  // could only ever see the background's contribution; a feature raises
  // scores now and an Epic Boon lifts the ceiling for the one it raised, so
  // the question is what the score comes to and what that score's own
  // maximum is.
  const maximums = abilityMaximums(content, choices, features);
  const totals = finalScores(content, choices, features);
  const fromFeatures = featureAbilityPoints(content, choices, features);
  for (const ability of ABILITIES) {
    const ceiling = maximums[ability];
    if (totals[ability] <= ceiling) continue;
    problems.push(
      problem(
        'score_above_maximum',
        (fromFeatures[ability] ?? 0) > 0 ? 'featureChoices' : 'abilityIncreases',
        `${ability} would reach ${totals[ability]}, past the maximum of ${ceiling}`,
      ),
    );
  }

  return problems;
}

const finalScores = (
  content: Content,
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): Record<Ability, number> => {
  const scores = { ...choices.abilities.assignment } as Record<Ability, number>;
  const fromFeatures = featureAbilityPoints(content, choices, features);
  for (const ability of ABILITIES) {
    scores[ability] =
      (scores[ability] ?? 10) +
      (choices.abilityIncreases[ability] ?? 0) +
      (fromFeatures[ability] ?? 0);
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
    // No list means any skill — SRD's "Choose any 3 skills" — so the only
    // thing left to check is that it is a skill at all.
    if (!(SKILLS as readonly string[]).includes(skill)) {
      problems.push(problem('unknown_skill', 'classSkills', `${skill} is not a skill`));
      continue;
    }
    if (from !== undefined && !from.includes(skill)) {
      problems.push(
        problem('skill_not_offered', 'classSkills', `a ${definition.name} may choose ${from.join(', ')}, not ${skill}`),
      );
    }
  }
  return problems;
}

/**
 * Every class this character has levels in, starting class first.
 *
 * One place that answers it, because "which classes" is asked by the features,
 * the hit points, the slots, the armour training and the Proficiency Bonus,
 * and five answers would be five chances to forget the second class.
 */
function classLevelsOf(choices: CharacterChoices): readonly ClassLevel[] {
  return [
    {
      classId: choices.classId,
      level: choices.level,
      ...(choices.subclassId === undefined ? {} : { subclassId: choices.subclassId }),
    },
    ...(choices.multiclass ?? []),
  ];
}

/** SRD: "your character level is the total of all your class levels." */
function totalLevelOf(choices: CharacterChoices): number {
  return characterLevel(classLevelsOf(choices));
}

/**
 * Every feature beside each grant it carries — the pairs the passes below walk.
 *
 * A feature may carry more than one grant, and every compiling pass wants the
 * same thing: this grant, and the feature it came from, whose id names the
 * source and whose level reads the class table. Walking the pairs rather than
 * the features is what kept the two dozen passes from each having to remember
 * that `grants` is a list now.
 */
function* grantsIn(
  features: readonly FeatureDefinition[],
): Iterable<readonly [FeatureDefinition, GatedFeatureGrant]> {
  for (const feature of features) {
    for (const grant of featureGrants(feature)) yield [feature, grant];
  }
}

/** The grants of one kind a feature carries, narrowed to that kind. */
const grantsOfKind = <K extends FeatureGrant['kind']>(
  feature: FeatureDefinition | undefined,
  kind: K,
): readonly Extract<GatedFeatureGrant, { readonly kind: K }>[] =>
  featureGrants(feature).filter(
    (grant): grant is Extract<GatedFeatureGrant, { readonly kind: K }> => grant.kind === kind,
  );

/** The first grant of one kind a feature carries, or null. */
const grantOf = <K extends FeatureGrant['kind']>(
  feature: FeatureDefinition | undefined,
  kind: K,
): Extract<GatedFeatureGrant, { readonly kind: K }> | null =>
  grantsOfKind(feature, kind)[0] ?? null;

/**
 * Every feature the character has, from all four sources — and from every
 * class, at that class's own level.
 *
 * SRD: "When you gain a new level in a class, you get its features for that
 * level." A level 3 Fighter / level 2 Wizard has the Fighter's level 3
 * features and the Wizard's level 2 ones, not either at level 5.
 */
function grantedFeatures(content: Content, choices: CharacterChoices, parts: Parts): readonly FeatureDefinition[] {
  const extra: FeatureDefinition[] = [];
  for (const entry of choices.multiclass ?? []) {
    const definition = content.classById(entry.classId);
    if (definition === null) continue;
    extra.push(...cumulativeFeatures(definition, entry.level));
    const subclass = entry.subclassId === undefined ? null : content.subclassById(entry.subclassId);
    if (subclass !== null) extra.push(...cumulativeFeatures(subclass, entry.level));
  }

  return [
    ...cumulativeFeatures(parts.definition, choices.level),
    ...(parts.subclass === null ? [] : cumulativeFeatures(parts.subclass, choices.level)),
    ...extra,
    ...originFeatures(choices, parts),
  ].map((feature) => withGateMet(feature, choices));
}

/**
 * The species' and the background's own features, at the **character's** level.
 *
 * A class table is read at that class's level and an origin's is not: SRD
 * writes "When you reach character levels 3 and 5" on the lineages and the
 * legacies, and a Fighter 3 / Rogue 2 has reached level 5 of both. Gathered
 * once, here, because the spells an origin grants are read from this list and
 * everything else is read from the whole.
 */
function originFeatures(choices: CharacterChoices, parts: Parts): readonly FeatureDefinition[] {
  const level = totalLevelOf(choices);
  return [...cumulativeFeatures(parts.species, level), ...cumulativeFeatures(parts.background, level)];
}

/**
 * One feature, with a grant whose option was not taken removed.
 *
 * **The one place a gate is applied, and the reason it is one place.** SRD
 * writes "You gain one of the following options of your choice" over every
 * kind of grant there is, and a gate read inside the standing loop was a gate
 * the pools, the Reactions, the spells and the activations each had to
 * remember — which is a rule that holds until the next pass is written. Every
 * one of those passes walks the list this returns, so the grant an unchosen
 * option belongs to is not there to be compiled.
 *
 * The feature itself stays, and so does the question it asked: a Cleric who
 * took Protector has Divine Order, has answered it, and has none of what
 * Thaumaturge grants. That is different from granting something inert.
 */
function withGateMet(feature: FeatureDefinition, choices: CharacterChoices): FeatureDefinition {
  const all = featureGrants(feature);
  const level = totalLevelOf(choices);
  // Where the choice a grant reads was made: its own feature unless the grant
  // names a sibling, which is how the SRD writes a species — one trait asks
  // which ancestry, lineage or legacy you are and the later ones are written
  // in terms of it. The content validator has already held the name to a
  // sibling that offers the option.
  const kept = all.filter((grant) => {
    // And the other gate on a grant, which is a level rather than an option:
    // SRD's lineages and legacies are chosen at level 1 and hand over a spell
    // at character levels 3 and 5. Applied here so that every pass — the
    // spells, the pools they are cast out of, the sheet — agrees about what
    // has arrived.
    if (grant.kind === 'spells' && grant.fromLevel !== undefined && level < grant.fromLevel) {
      return false;
    }
    if (grant.onlyIfChoice === undefined) return true;
    // **The gate reads a feature's primary answer**, whichever question the
    // grant's content reads. A `choiceFrom` may name a keyed question — an
    // answer filed under `<feature id>:<key>` — and an option was never inside
    // that answer: it is the answer to the question the feature asked first,
    // under its own id.
    return (
      choices.featureChoices[featureOfAnswerKey(grant.choiceFrom ?? feature.id)] ?? []
    ).includes(grant.onlyIfChoice);
  });
  if (kept.length === all.length) return feature;
  return kept.length === 0 ? withoutGrant(feature) : { ...feature, grants: kept };
}

/** The same feature with no grant at all, which is what an unchosen option grants. */
const withoutGrant = ({ grants: _grants, ...rest }: FeatureDefinition): FeatureDefinition => rest;

/**
 * The multiclassing rules, checked before anything is derived from them.
 *
 * Three refusals, each of which would otherwise produce a character the rules
 * do not allow: a class nobody registered, the same class twice, and scores
 * below the 13 every class involved demands.
 */
function checkMulticlass(
  content: Content,
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): CreationProblem[] {
  const extra = choices.multiclass ?? [];
  if (extra.length === 0) return [];

  const problems: CreationProblem[] = [];
  const definitions: ClassDefinition[] = [];
  const seen = new Set<string>([choices.classId]);

  for (const entry of extra) {
    const definition = content.classById(entry.classId);
    if (definition === null) {
      problems.push(problem('unknown_class', 'multiclass', `no class called ${entry.classId}`));
      continue;
    }
    if (seen.has(entry.classId)) {
      problems.push(
        problem('duplicate_class', 'multiclass', `${definition.name} is listed twice; add its levels together instead`),
      );
      continue;
    }
    seen.add(entry.classId);
    definitions.push(definition);

    if (!Number.isInteger(entry.level) || entry.level < 1) {
      problems.push(
        problem('bad_level', 'multiclass', `${definition.name} needs at least one level, got ${entry.level}`),
      );
    }
    if (entry.subclassId !== undefined) {
      const subclass = content.subclassById(entry.subclassId);
      if (subclass === null || subclass.classId !== entry.classId) {
        problems.push(
          problem('wrong_subclass', 'multiclass', `${entry.subclassId} is not a ${definition.name} subclass`),
        );
      } else if (entry.level < definition.subclassLevel) {
        problems.push(
          problem('subclass_too_early', 'multiclass', `a ${definition.name} chooses a subclass at level ${definition.subclassLevel}`),
        );
      }
    }
  }

  const total = totalLevelOf(choices);
  if (total > MAX_LEVEL) {
    problems.push(
      problem('bad_level', 'multiclass', `character level ${total} is past ${MAX_LEVEL}`),
    );
  }

  const starting = content.classById(choices.classId);
  const all = starting === null ? definitions : [starting, ...definitions];
  const qualified = meetsPrerequisites(finalScores(content, choices, features), all);
  if (!qualified.ok) {
    problems.push(problem(qualified.code, 'multiclass', qualified.reason));
  }

  return problems;
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
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== kind) continue;
    // **An at-will grant is a route rather than a list entry.** SRD Armor of
    // Shadows says "you can cast _Mage Armor_ on yourself without expending a
    // spell slot" and does not say the spell is prepared, so a grant that
    // handed it to the class's prepared list would also hand over a slot route
    // the invocation never printed. `classFeatureAtWillCastings` compiles it
    // instead, into the `GrantedSpell` whose `atWill` already says exactly
    // this price.
    if (grant.kind === 'spells' && grant.atWill === true) continue;
    // A fixed grant is the feature's own answer; a choice is the player's.
    if (grant.kind === 'spells' && grant.fixed !== undefined) {
      picked.push(...grantedFixedSpells(choices, feature, grant));
      continue;
    }
    // **A keyed `choiceFrom` is read as content; a bare one is not.** The
    // field has two jobs and they part here: pointed at a *sibling* it says
    // where the gate's option was answered and nothing more — `content.ts`
    // says so in as many words, and reading a sibling's option names as spell
    // ids is exactly what that invariant forbids — while pointed at a keyed
    // question it names the second answer this grant is compiled from.
    const from = grant.choiceFrom;
    const keyed = from !== undefined && featureOfAnswerKey(from) !== from;
    picked.push(...(choices.featureChoices[keyed ? from : feature.id] ?? []));
  }
  return picked;
}

/**
 * What a `spells` grant hands over **now**: the spell it prints, or the one a
 * rest put in its place.
 *
 * SRD Elven Lineage's High Elf is the one writer, and every reader of a fixed
 * grant goes through here — because a grant read one way in one pass and
 * another way in the next is a cantrip on the sheet that nothing can cast.
 *
 * An unanswered mark hands over what the book prints, which is what "you know
 * the Prestidigitation cantrip" means on the morning of level 1.
 */
function grantedFixedSpells(
  choices: CharacterChoices,
  feature: FeatureDefinition,
  grant: Extract<FeatureGrant, { readonly kind: 'spells' }>,
): readonly string[] {
  const fixed = grant.fixed ?? [];
  const granted = fixed[0];
  if (grant.rechosenOn === undefined || granted === undefined) return fixed;
  const answer = choices.featureChoices[rechosenSpellKey(feature.id, granted)]?.[0];
  return answer === undefined ? fixed : [answer];
}

/** Skills a feature granted Expertise in, whichever feature it was. */
function expertiseSkills(content: Content, choices: CharacterChoices, parts: Parts): readonly string[] {
  return choicesGranting(choices, grantedFeatures(content, choices, parts), 'expertise');
}


/**
 * How many weapons a Weapon Mastery choice asks for, at this character's level
 * in the class that granted it.
 *
 * The one count in the vocabulary that is not a number on the definition: two
 * of the five classes print a column instead. Read at that class's own level,
 * which is the rule every other table-indexed number here follows.
 */
function weaponsAsked(
  asked: Extract<FeatureChoice, { kind: 'weapon' }>,
  choices: CharacterChoices,
  feature: FeatureDefinition,
): number {
  if (asked.chooseByLevel === undefined) return asked.choose ?? 0;
  const level = classLevelFor(choices, feature.id);
  const column = asked.chooseByLevel;
  return column[Math.max(0, Math.min(level, column.length) - 1)] ?? 0;
}

/**
 * How many options a choice asks for, at this character's level in the class
 * that granted the feature.
 *
 * {@link weaponsAsked} one member along, and for the same SRD sentence: "You
 * gain more invocations at higher levels, **as shown in the Invocations column
 * of the Warlock Features table**." Read at the granting class's own level,
 * which is the rule every table-indexed number in this file follows.
 */
function optionsAsked(
  asked: Extract<FeatureChoice, { kind: 'option' }>,
  choices: CharacterChoices,
  feature: FeatureDefinition,
): number {
  if (asked.chooseByLevel === undefined) return asked.choose ?? 0;
  const level = classLevelFor(choices, feature.id);
  const column = asked.chooseByLevel;
  return column[Math.max(0, Math.min(level, column.length) - 1)] ?? 0;
}

/**
 * Every prerequisite an answer to an option question failed to meet.
 *
 * SRD prints the line on the invocation — "**Prerequisite:** Level 5+ Warlock,
 * Pact of the Blade feature" — so both clauses are read per answer: the level
 * in the class that granted the feature, and another option of the same
 * question that this character also took.
 */
function unmetPrerequisites(
  asked: Extract<FeatureChoice, { kind: 'option' }>,
  made: readonly string[],
  choices: CharacterChoices,
  feature: FeatureDefinition,
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const level = classLevelFor(choices, feature.id);
  for (const line of asked.prerequisites ?? []) {
    if (!made.includes(line.option)) continue;
    if (line.level !== undefined && level < line.level) {
      problems.push(
        problem('prerequisite_not_met', 'featureChoices', `${feature.name} offers ${line.option} at level ${line.level}, and this character is level ${level} in the class that granted it`),
      );
    }
    if (line.requiresOption !== undefined && !made.includes(line.requiresOption)) {
      problems.push(
        problem('prerequisite_not_met', 'featureChoices', `${feature.name} offers ${line.option} to a character who has taken ${line.requiresOption}, and this one has not`),
      );
    }
  }
  return problems;
}

/**
 * Weapons a character could have mastery with and has not named.
 *
 * **A warning rather than a problem**, and the two halves of that are both the
 * SRD's. Naming fewer is legal — "Whenever you finish a Long Rest, you can
 * practice weapon drills and change one of those weapon choices", so which
 * weapons you have mastery with is a standing decision rather than a
 * proficiency fixed when the sheet was written, and "not yet" is a state a
 * character can be in. But a level 1 class feature quietly doing nothing is
 * the one outcome this engine rules out, so the plan says so: the same channel
 * a redundant proficiency is reported through, for the same reason — the table
 * decides, and nobody is left guessing.
 */
function unclaimedMasteries(
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): CreationProblem[] {
  const warnings: CreationProblem[] = [];
  for (const feature of features) {
    for (const asked of featureChoicesOf(feature)) {
      if (asked.kind !== 'weapon') continue;
      const ceiling = weaponsAsked(asked, choices, feature);
      const named = (choices.featureChoices[choiceAnswerKey(feature.id, asked.key)] ?? []).length;
      if (named < ceiling) {
        warnings.push(
          problem('unclaimed_masteries', 'featureChoices', `${feature.name} unlocks the mastery properties of ${ceiling} kinds of weapon, and ${named} were named; the rest are the table's to pick, on this Long Rest or a later one`),
        );
      }
    }
  }
  return warnings;
}

/**
 * Languages a feature offers and nobody has picked.
 *
 * **A warning rather than a problem, and for the reason this file has written
 * down twice already.** SRD Thieves' Cant really does say the Rogue knows one
 * other language, so an unanswered question is an incomplete sheet rather
 * than a legal state the way an unnamed weapon mastery is — but *every*
 * character written against this engine before the question existed omits it,
 * and "requiring the Weapon Mastery choice broke a corpus that spanned
 * worktrees" is the precedent, recorded in {@link sizeFor}'s own note along
 * with what it cost. Refusing here would refuse every Rogue in the repository
 * and every Rogue on a branch beside it, which is a **migration of the
 * character corpus** and wants deciding as one.
 *
 * So the plan says it: the Cant itself is granted either way, the other
 * language arrives when somebody names it, and nobody is left guessing why a
 * level 1 feature looks half-applied. Unlike a weapon mastery there is
 * nothing sensible to pin in its place — there is no "first" language the way
 * there is a first printed size — so the sheet is simply short one tongue
 * until the answer comes.
 */
function unclaimedLanguages(
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): CreationProblem[] {
  const warnings: CreationProblem[] = [];
  for (const feature of features) {
    for (const asked of askedOf(choices, feature)) {
      if (asked.kind !== 'language') continue;
      const named = (choices.featureChoices[choiceAnswerKey(feature.id, asked.key)] ?? []).length;
      if (named < asked.choose) {
        warnings.push(
          problem('unclaimed_languages', 'featureChoices', `${feature.name} lets this character learn ${asked.choose} more language(s), and ${named} were named; the sheet is short until somebody picks`),
        );
      }
    }
  }
  return warnings;
}

/**
 * The spellcasting ability a trait that grants spells asked the player for.
 *
 * SRD Fiendish Legacy prints the question once and two traits read the answer,
 * so a grant may name the feature that asked — the same `choiceFrom` a gate
 * uses, and for the same reason: one fact, one place, one answer.
 */
const spellcastingAbilityFor = (
  choices: CharacterChoices,
  feature: FeatureDefinition,
  grant: { readonly choiceFrom?: string },
): Ability | undefined => choices.featureSpellcasting?.[grant.choiceFrom ?? feature.id];

/**
 * A trait that offers a spellcasting ability, and the answer it was given.
 *
 * Two refusals, and both would otherwise be silent: a trait nobody answered
 * grants spells with no ability to cast them off, and an ability the trait
 * does not offer is the player writing their own sentence — SRD names three
 * and Strength is not one of them.
 */
function checkFeatureSpellcasting(
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  for (const feature of features) {
    // Asked once per feature rather than once per grant: SRD Fiendish Legacy
    // carries a cantrip and two levelled spells under one question, and a
    // player who answered it should not be told three times that they did not.
    const offered = [
      ...new Set(
        featureGrants(feature).flatMap((grant) =>
          grant.kind === 'spells' ? (grant.abilities ?? []) : [],
        ),
      ),
    ];
    if (offered.length === 0) continue;

    const answer = choices.featureSpellcasting?.[feature.id];
    if (answer === undefined) {
      problems.push(
        problem('missing_feature_spellcasting', 'featureSpellcasting', `${feature.name} casts its spells off ${offered.join(', ')}, and none was chosen`),
      );
    } else if (!offered.includes(answer)) {
      problems.push(
        problem('unknown_ability', 'featureSpellcasting', `${feature.name} offers ${offered.join(', ')}, and ${answer} is not one of them`),
      );
    }
  }
  return problems;
}

/**
 * The questions a feature really asks **this** character.
 *
 * A feature may ask more than one thing and gate the later ones on the answer
 * to the first — SRD Divine Order asks which cantrip only of a Thaumaturge —
 * so which questions were asked is a fact about the answers, and the gate is
 * read here exactly as `withGateMet` reads a grant's.
 */
const askedOf = (
  choices: CharacterChoices,
  feature: FeatureDefinition,
): readonly FeatureChoice[] => {
  const primary = choices.featureChoices[feature.id] ?? [];
  return featureChoicesOf(feature).filter(
    (question) => question.onlyIfChoice === undefined || primary.includes(question.onlyIfChoice),
  );
};

/**
 * Answers to questions this character was never asked.
 *
 * Two shapes and one refusal, because they are one mistake: a key nothing on
 * the feature declares, and a key it declares but gates on an option this
 * character did not take. Both are a list of spells or skills sitting on a
 * sheet that nothing will ever read, which is worse than a refusal — the
 * player believes they have it.
 *
 * Only a **keyed** answer is asked about. The bare feature id is the primary
 * question's, and a feature that asks nothing at all is allowed to carry a
 * leftover answer for the reason it always was: creation reads the choices a
 * character was made with, and a level-up must not refuse a sheet over a
 * question a subclass stopped asking.
 */
function unaskedAnswers(
  choices: CharacterChoices,
  feature: FeatureDefinition,
): CreationProblem[] {
  const asked = new Set([
    ...askedOf(choices, feature).flatMap((question) =>
      question.key === undefined ? [] : [question.key],
    ),
    // And the key a re-chosen `spells` grant files its replacement under, which
    // is a question nobody was asked at creation and an answer a rest may
    // nevertheless have written — SRD Elven Lineage's High Elf. A gate that was
    // not met leaves no grant here at all, so a Wood Elf carrying a High Elf's
    // answer is still refused.
    ...featureGrants(feature).flatMap((grant) =>
      grant.kind === 'spells' && grant.rechosenOn !== undefined
        ? ((grant.fixed ?? [])[0] === undefined ? [] : [(grant.fixed ?? [])[0] as string])
        : [],
    ),
  ]);
  const problems: CreationProblem[] = [];
  for (const [key, answer] of Object.entries(choices.featureChoices)) {
    if (!key.startsWith(`${feature.id}:`) || answer.length === 0) continue;
    const named = key.slice(feature.id.length + 1);
    if (asked.has(named)) continue;
    problems.push(
      problem('choice_not_asked', 'featureChoices', `${feature.name} did not ask this character for ${named}, and ${answer.join(', ')} answers it`),
    );
  }
  return problems;
}

/**
 * The spell a rest put in a fixed grant's place, held to the grant's own terms.
 *
 * SRD Elven Lineage, High Elf: "you can replace that cantrip with a different
 * cantrip from the **Wizard** spell list." Two of the three rules are the
 * grant's and are checked here — which list, and how high — so nothing here
 * knows that an Elf exists.
 *
 * **The third is not checkable from a set of choices**, and that is why it is
 * not here. "A *different* cantrip" is a rule about the swap rather than about
 * the answer: what the answer must differ from is what the character is
 * holding *now*, and a `CharacterChoices` holds only what they will be holding
 * afterwards. `rechoiceEvents` in `rest.ts` can see both, and does. Asking the
 * question here compared the answer to the spell the grant **prints**, which
 * is a different question and gives the wrong answer twice over: it refuses a
 * High Elf taking Prestidigitation back, and it permits replacing Fire Bolt
 * with Fire Bolt.
 *
 * Silence is the book's own answer and not a gap: an unanswered mark leaves
 * Prestidigitation where it was, which is what the first sentence of the trait
 * says.
 */
function checkRechosenSpells(
  content: Content,
  choices: CharacterChoices,
  feature: FeatureDefinition,
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  for (const grant of featureGrants(feature)) {
    if (grant.kind !== 'spells') continue;
    const rechosen = grant.rechosenOn;
    const granted = (grant.fixed ?? [])[0];
    if (rechosen === undefined || granted === undefined) continue;

    const answer = choices.featureChoices[rechosenSpellKey(feature.id, granted)];
    if (answer === undefined) continue;

    if (answer.length !== 1) {
      problems.push(
        problem('wrong_rechosen_count', 'featureChoices', `${feature.name} replaces ${granted} with one spell, and ${answer.length} were named`),
      );
      continue;
    }
    const replacement = answer[0] as string;
    problems.push(
      // A cantrip is level 0, and the floor follows the ceiling exactly as it
      // does for a feature's own spell choice.
      ...checkSpellId(content, replacement, 'featureChoices', rechosen.fromClass, {
        minLevel: rechosen.maxLevel === 0 ? 0 : 1,
        maxLevel: rechosen.maxLevel,
        what: feature.name,
      }),
    );
  }
  return problems;
}

function checkFeatureChoices(
  content: Content,
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
  proficient: ReadonlySet<Skill>,
  weaponCategories: readonly string[],
): CreationProblem[] {
  const problems: CreationProblem[] = [...checkFeatureSpellcasting(choices, features)];

  for (const feature of features) {
    problems.push(...checkRechosenSpells(content, choices, feature));

    // An answer to a question this character was never asked — a Protector who
    // named a cantrip, or a key nothing on the feature declares. Left alone it
    // is a line on a sheet nobody reads, which is how a player comes to believe
    // they have something; the same refusal covers both, because both are an
    // answer with no question.
    problems.push(...unaskedAnswers(choices, feature));

    for (const asked of askedOf(choices, feature)) {
      // Subclasses are resolved in `resolveParts`, and feats in `checkFeats`,
      // because both need more than a list of picked names.
      if (asked.kind === 'subclass' || asked.kind === 'feat') continue;
      const answerKey = choiceAnswerKey(feature.id, asked.key);

      // Ability points are answered one ability per point and may be answered
      // with a feat instead, so neither the length rule below nor the "one
      // answer, in one place" assumption behind it holds.
      if (asked.kind === 'ability-score') {
        problems.push(...checkAbilityChoice(choices, feature, asked));
        continue;
      }

      const made = choices.featureChoices[answerKey];

      // **A Weapon Mastery choice is a ceiling rather than a quota**, and the
      // SRD's own sentence is why: "Whenever you finish a Long Rest, you can
      // practice weapon drills and change one of those weapon choices." Which
      // weapons a character has mastery with is a standing decision they revisit,
      // not a proficiency frozen when the sheet was written — so a character who
      // has named none has named none, and the properties do not run for them.
      // Naming *more* than the column allows is still an answer the rules do not
      // permit, and is refused.
      if (asked.kind === 'weapon') {
        const ceiling = weaponsAsked(asked, choices, feature);
        // Under the ceiling is legal and reported as a **warning** instead — see
        // {@link unclaimedMasteries}, which is where it is said, because a
        // problem here would refuse the character.
        if ((made ?? []).length > ceiling) {
          problems.push(
            problem('too_many_masteries', 'featureChoices', `${feature.id} (${feature.name}) unlocks ${ceiling} kinds of weapon, and ${(made ?? []).length} were named`),
          );
          continue;
        }
        if (made === undefined) continue;
      }

      // **A choice a rest re-asks is a standing decision too**, and it is the
      // Weapon Mastery paragraph above with a different feature's name on it:
      // SRD Circle of the Land Spells opens "Whenever you finish a Long Rest,
      // choose one type of land", so the land follows the rest rather than the
      // sheet, and a Druid who has named none has named none. An answer that
      // *is* given is still held to the offer below.
      if (
        made === undefined &&
        featureGrants(feature).some((one) => one.kind === 'rechosen-on-a-rest')
      ) {
        continue;
      }

      // **A language a feature offers is a ceiling rather than a quota**, on
      // the Weapon Mastery reading one paragraph up and for the corpus reason
      // {@link unclaimedLanguages} states: naming fewer is reported as a
      // warning through the plan, and naming *more* is an answer the rules do
      // not permit and is refused here.
      if (asked.kind === 'language') {
        if ((made ?? []).length > asked.choose) {
          problems.push(
            problem('too_many_languages', 'featureChoices', `${feature.id} (${feature.name}) teaches ${asked.choose} language(s), and ${(made ?? []).length} were named`),
          );
          continue;
        }
        if (made === undefined) continue;
      }

      const wanted =
        asked.kind === 'weapon'
          ? (made ?? []).length
          : asked.kind === 'language'
            ? (made ?? []).length
            : asked.kind === 'option'
            ? optionsAsked(asked, choices, feature)
            : asked.choose;
      if (made === undefined || made.length !== wanted) {
        problems.push(
          problem('missing_feature_choice', 'featureChoices', `${answerKey} (${feature.name}) needs ${wanted} choice(s)`),
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
        // And the Prerequisite line the SRD prints over an option rather than
        // over the feature — a level in the granting class, or another option
        // of this same question.
        problems.push(...unmetPrerequisites(asked, made, choices, feature));
        continue;
      }

      if (asked.kind === 'weapon') {
        for (const picked of duplicates(made)) {
          problems.push(
            problem('weapon_not_mastered', 'featureChoices', `${feature.name} unlocks ${picked} once`),
          );
        }
        for (const picked of made) {
          const weapon = content.item(picked)?.weapon ?? null;
          if (weapon === null) {
            problems.push(
              problem('weapon_not_mastered', 'featureChoices', `${picked} is not a weapon`),
            );
            continue;
          }
          // SRD Barbarian: "Simple or Martial **Melee** weapons".
          if (asked.melee === true && weapon.kind !== 'melee') {
            problems.push(
              problem('weapon_not_mastered', 'featureChoices', `${feature.name} unlocks Melee weapons, and a ${weapon.name} is not one`),
            );
            continue;
          }
          // SRD Paladin, Ranger, Rogue: "weapons of your choice **with which you
          // have proficiency**" — and the two classes whose sentence omits it are
          // proficient with everything it offers, so asking all five says the
          // same thing about each.
          if (!proficientWithCategories(weaponCategories, weapon)) {
            problems.push(
              problem('weapon_not_mastered', 'featureChoices', `${feature.name} needs proficiency with a ${weapon.name} first`),
            );
          }
        }
        continue;
      }

      /**
       * SRD Thieves' Cant: "one **other** language of your choice, which you
       * choose from the language tables."
       *
       * Two rules, and the second is the word "other". The first is
       * membership — a language this world does not hold is a tongue nobody
       * speaks, refused with the same code and the same sentence creation
       * gives one named at Step 2, because it is the same mistake. A world
       * that names no language at all makes no claim, exactly as it makes
       * none there.
       *
       * The second is against every language the character already knows:
       * the free ones, the two they chose, the ones a feature granted — this
       * feature's own Thieves' Cant included — and the ones another
       * feature's question was answered with. `elsewhere` is that set built
       * *without* this answer, so the question can never refuse itself.
       */
      if (asked.kind === 'language') {
        const elsewhere = new Set([
          ...spokenByEveryone(content),
          ...choices.languages,
          ...languagesGranted(features),
          ...features
            .filter((one) => one.id !== feature.id)
            .flatMap((one) => languagesChosenOnFeatures(choices, [one])),
        ]);
        const offered = content.languages.map((one) => one.name);
        for (const picked of made) {
          if (offered.length > 0 && !offered.includes(picked)) {
            problems.push(
              problem('unknown_language', 'featureChoices', `${feature.name} offers the languages this world holds, and ${picked} is not one of them; choose from: ${offered.join(', ')}`),
            );
            continue;
          }
          if (elsewhere.has(picked)) {
            problems.push(
              problem('duplicate_language', 'featureChoices', `${feature.name} offers one other language, and this character already knows ${picked}`),
            );
          }
        }
        for (const picked of duplicates(made)) {
          problems.push(
            problem('duplicate_language', 'featureChoices', `${feature.name} takes ${picked} once`),
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
          if (grantOf(feature, 'expertise') !== null && !proficient.has(picked as Skill)) {
            problems.push(
              problem('expertise_without_proficiency', 'featureChoices', `${feature.name} needs proficiency in ${picked} first`),
            );
          }
        }
      }
    }
  }

  return problems;
}

/** A spread as the definition prints it: the points, largest first. */
const spreadOf = (points: readonly number[]): string =>
  [...points].sort((a, b) => b - a).join('+');

/**
 * Whether this character answered an `ability-score` choice legally.
 *
 * Three things, and the third is the one the shape exists for:
 *
 * - **An answer at all.** A feature that asks for points and got none is a
 *   sheet with an advancement missing, refused by name.
 * - **Abilities, not words.** A pick that is not one of the six raises
 *   nothing, and a spread counted out of it would be counted out of nonsense,
 *   so the spread is left unjudged when one is wrong.
 * - **A spread the feature's own sentence prints.** Counted out of the answer
 *   rather than declared beside it — see `FeatureChoice`'s `ability-score`
 *   member — so `['str', 'str']` is one score by 2 and `['str', 'dex']` is two
 *   by 1, and a feature offering only the second refuses the first.
 *
 * The last two are {@link spreadProblems}, shared with the feat that asks the
 * same sentence.
 *
 * The **ceiling is not asked here**: a score's maximum is a fact about the
 * whole character, since a background raised scores before any feature did,
 * and `checkAbilities` is where the sheet already enforces one.
 */
function checkAbilityChoice(
  choices: CharacterChoices,
  feature: FeatureDefinition,
  asked: Extract<FeatureChoice, { kind: 'ability-score' }>,
): CreationProblem[] {
  const answerKey = choiceAnswerKey(feature.id, asked.key);
  const made = choices.featureChoices[answerKey] ?? [];
  const offers = asked.spreads.map(spreadOf).join(', or ');

  if (made.length === 0) {
    return [
      problem('missing_feature_choice', 'featureChoices', `${answerKey} (${feature.name}) raises ${offers}, and nothing was chosen`),
    ];
  }

  return spreadProblems(made, asked.spreads, undefined, 'featureChoices', feature.name, offers);
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
  content: Content,
  id: string,
  field: string,
  classId: string,
  options: {
    readonly minLevel?: number;
    readonly maxLevel?: number;
    readonly school?: string;
    /**
     * SRD Pact of the Tome: "The spells can be from **any class's spell
     * list**" — the one sentence that widens the list, and it widens it to the
     * whole catalogue rather than to a second class.
     */
    readonly anyList?: true;
    /** SRD Pact of the Tome: "two level 1 spells that have the Ritual tag". */
    readonly ritual?: true;
    readonly what: string;
  },
): CreationProblem[] {
  const spell = content.spellEntry(id);
  if (spell === null) {
    return [problem('unknown_spell', field, `no SRD spell with the id ${id}`)];
  }

  const problems: CreationProblem[] = [];
  if (options.ritual === true && !spell.ritual) {
    problems.push(
      problem('spell_not_a_ritual', field, `${options.what} takes spells with the Ritual tag; ${spell.name} has none`),
    );
  }
  if (options.anyList !== true && !spell.classes.includes(classId)) {
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

/**
 * One casting class, at its own level, with the spells chosen for it.
 *
 * SRD Multiclassing: "You determine what spells you can prepare for each class
 * individually, as if you were a single-classed member of that class." Every
 * rule below reads this rather than the character — the class's own table, its
 * own spell list, its own slot ceiling, its own spellcasting ability.
 */
interface CasterChoices {
  readonly definition: ClassDefinition;
  readonly level: number;
  readonly subclassId: string | undefined;
  readonly cantrips: readonly string[];
  readonly spellbook: readonly SpellbookEntry[];
  readonly preparedSpells: readonly string[];
  /** Where a problem with these choices points a caller filling in a form. */
  readonly at: (field: string) => string;
}

/**
 * Which casting class the flat `cantrips`/`spellbook`/`preparedSpells` belong to.
 *
 * The starting class where it casts — a Wizard 3 / Fighter 2 writes the Wizard
 * spells where a single-classed Wizard would. Otherwise the one casting class
 * that has no `spellsByClass` entry, which is what lets a Fighter 3 / Wizard 2
 * keep the flat fields too. Null when that is genuinely ambiguous, and then
 * anything written in the flat fields is refused rather than filed by guess.
 */
function defaultSpellClass(content: Content, choices: CharacterChoices): string | null {
  const casters = classLevelsOf(choices).filter(
    (entry) => content.classById(entry.classId)?.spellcasting !== undefined,
  );
  const uncovered = casters.filter(
    (entry) => choices.spellsByClass?.[entry.classId] === undefined,
  );
  if (uncovered.some((entry) => entry.classId === choices.classId)) return choices.classId;
  return uncovered.length === 1 ? (uncovered[0]?.classId ?? null) : null;
}

/** Which of a character's classes cast, each with the spells chosen for it. */
function castingClassesOf(content: Content, choices: CharacterChoices): readonly CasterChoices[] {
  const flatOwner = defaultSpellClass(content, choices);
  const casters: CasterChoices[] = [];

  for (const entry of classLevelsOf(choices)) {
    const definition = content.classById(entry.classId);
    if (definition === null || definition.spellcasting === undefined) continue;

    const named = choices.spellsByClass?.[entry.classId];
    const flat = named === undefined && entry.classId === flatOwner;
    const at = flat
      ? (field: string) => field
      : (field: string) => `spellsByClass.${entry.classId}.${field}`;

    casters.push({
      definition,
      level: entry.level,
      subclassId: entry.subclassId,
      cantrips: flat ? choices.cantrips : (named?.cantrips ?? []),
      spellbook: flat ? choices.spellbook : (named?.spellbook ?? []),
      preparedSpells: flat ? choices.preparedSpells : (named?.preparedSpells ?? []),
      at,
    });
  }

  return casters;
}

/**
 * Spells a class's own features grant, at that class's level.
 *
 * Read per class rather than per character: Life Domain's always-prepared
 * spells are *Cleric* spells cast off Wisdom, and a Cleric/Wizard's Wizard
 * half must not inherit them.
 */
function classFeatureSpells(content: Content, choices: CharacterChoices, caster: CasterChoices): readonly string[] {
  return choicesGranting(choices, castingFeaturesOf(content, choices, caster), 'spells');
}

/**
 * The castings a class's features price at **nothing**.
 *
 * SRD Armor of Shadows, Fiendish Vigor, Mask of Many Faces, Misty Visions and
 * Otherworldly Leap: "You can cast _X_ on yourself without expending a spell
 * slot", with no count and no pool. {@link classFeatureFreeCastings}'s sibling
 * on the third price — `GrantedSpell.atWill`, which a stat block's "**At
 * Will:**" line has produced since it landed — and it brings nothing else with
 * it: `castOrRelease` writes `slotless`, and there is no resource to spend.
 *
 * The ability is the granting class's, for `classFeatureFreeCastings`'s own
 * reason: a feature belongs to exactly one class, and a multiclassed holder
 * has more than one spellcasting ability.
 */
function classFeatureAtWillCastings(
  content: Content,
  choices: CharacterChoices,
  caster: CasterChoices,
  ability: Ability,
): readonly GrantedSpell[] {
  const granted: GrantedSpell[] = [];
  for (const [feature, grant] of grantsIn(castingFeaturesOf(content, choices, caster))) {
    if (grant.kind !== 'spells' || grant.atWill !== true) continue;
    for (const spellId of grant.fixed ?? []) {
      granted.push({
        spellId,
        source: feature.id,
        ability,
        freeCastPool: null,
        slotCasting: false,
        atWill: true,
        ...(grant.maximisedDice === undefined ? {} : { maximisedDice: true }),
      });
    }
  }
  return granted;
}

/**
 * This class's features and its subclass's, at that class's own level.
 *
 * **Gated, like every other list of features a pass compiles from.** This one
 * is built out of `cumulativeFeatures` rather than out of `grantedFeatures`,
 * because it is read per casting class — so it has to apply `withGateMet`
 * itself, or a `spells` grant belonging to an option nobody took would be
 * granted here and its pool declared nowhere. One function, called by every
 * list-builder, is what "in one place" means.
 */
function castingFeaturesOf(
  content: Content,
  choices: CharacterChoices,
  caster: CasterChoices,
): readonly FeatureDefinition[] {
  const subclass = caster.subclassId === undefined ? null : content.subclassById(caster.subclassId);
  return [
    ...cumulativeFeatures(caster.definition, caster.level),
    ...(subclass === null ? [] : cumulativeFeatures(subclass, caster.level)),
  ].map((feature) => withGateMet(feature, choices));
}

/**
 * The castings a class's own features pay for out of a pool.
 *
 * SRD Favored Enemy: "You always have the _Hunter's Mark_ spell prepared. You
 * can cast it twice without expending a spell slot." The first sentence is
 * `classFeatureSpells` above; this is the second, and it comes out as a
 * {@link GrantedSpell} — the shape a feat's Magic Initiate has produced since
 * it landed, whose `freeCastPool` `choosePayment` already spends.
 *
 * **Per class, for `classFeatureSpells`'s own reason.** The ability is the
 * granting class's, because that is what "your spell save DC" means on a
 * feature the Ranger prints and the Sorcerer half of the same creature does
 * not.
 *
 * **`slotCasting` is false unless the feature prints the slot route.** The
 * feature's route is the free one: where the spell is also prepared, the
 * class's own route casts it with a slot, and a granted route that allowed
 * both would make the engine choose between a resource a player is saving and
 * one they are not. SRD Wild Companion is the exception the book prints —
 * "expend a spell slot or a use of Wild Shape" for a spell the class does not
 * otherwise prepare, so the feature's route is the only one and both prices
 * are its own; `choosePayment` still asks which.
 */
function classFeatureFreeCastings(
  content: Content,
  choices: CharacterChoices,
  caster: CasterChoices,
  ability: Ability,
): readonly GrantedSpell[] {
  const granted: GrantedSpell[] = [];
  for (const [feature, grant] of grantsIn(castingFeaturesOf(content, choices, caster))) {
    if (grant.kind !== 'spells' || grant.freeCasting === undefined) continue;
    granted.push({
      spellId: grant.freeCasting.spell,
      source: feature.id,
      ability,
      freeCastPool: grant.freeCasting.pool,
      slotCasting: grant.freeCasting.withSlots === true,
      ...castsAs(grant.freeCasting),
    });
  }
  return granted;
}

/**
 * Every spell choice, checked against the class that made it.
 *
 * Three jobs, and the first is the one multiclassing added: spells written
 * down for a class that cannot own them are refused, because filing them under
 * a guess would give them the wrong spellcasting ability for the rest of the
 * campaign.
 */
/**
 * The row of a shape-shifting table that holds at a class level: the last
 * whose `fromLevel` the character has reached, or null below the first.
 */
function shapeRowAt(rows: readonly ShapeShiftRow[], level: number): ShapeShiftRow | null {
  let held: ShapeShiftRow | null = null;
  for (const row of rows) if (row.fromLevel <= level) held = row;
  return held;
}

/**
 * The forms a character says it has learned, against the feature that learns
 * them.
 *
 * SRD Wild Shape: "chosen from among Beast stat blocks that have a maximum
 * Challenge Rating of 1/4 and that lack a Fly Speed", with the count and the
 * ceiling rising by the Beast Shapes table. The row is the class level's, so
 * the same list is checked once at level 2 and again at the level that widens
 * it — and a list on a character with nothing to shift into is refused rather
 * than carried as a fact nobody reads.
 */
function checkKnownForms(
  content: Content,
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): CreationProblem[] {
  const forms = choices.knownForms;
  if (forms === undefined) return [];

  const shifting = features.find((feature) => grantOf(feature, 'shape-shift') !== null);
  const grant = grantOf(shifting, 'shape-shift');
  if (shifting === undefined || grant === null) {
    return [
      problem(
        'forms_without_a_shape',
        'knownForms',
        'this character has no feature that takes a form, so there is nothing for a known form to be',
      ),
    ];
  }
  const row = shapeRowAt(grant.forms, classLevelFor(choices, shifting.id));
  if (row === null) {
    return [
      problem('forms_without_a_shape', 'knownForms', `${shifting.name} prints no forms at this level`),
    ];
  }

  const problems: CreationProblem[] = [];
  if (forms.length > row.known) {
    problems.push(
      problem(
        'too_many_forms',
        'knownForms',
        `${shifting.name} knows ${row.known} forms at this level, and ${forms.length} were named`,
      ),
    );
  }
  const seen = new Set<string>();
  forms.forEach((id, index) => {
    const field = `knownForms[${index}]`;
    if (seen.has(id)) {
      problems.push(problem('duplicate_form', field, `${id} is named twice`));
      return;
    }
    seen.add(id);
    const block = content.monsterById(id);
    if (block === null) {
      problems.push(problem('unknown_form', field, `no stat block with the id ${id}`));
      return;
    }
    const why = formIneligibility(block, grant.formType, row);
    if (why !== null) {
      problems.push(problem('form_not_eligible', field, `${block.name} is ${why}`));
    }
  });
  return problems;
}

function checkSpells(content: Content, choices: CharacterChoices, definition: ClassDefinition): CreationProblem[] {
  const casters = castingClassesOf(content, choices);
  const problems: CreationProblem[] = [...checkSpellAttribution(content, choices, casters)];

  // A character with no casting class at all casts nothing, and the difference
  // between that and "has none at this level" matters: a Fighter does not know
  // zero cantrips, a Fighter has no cantrips. Anything written down here is a
  // mistake rather than a spell, and the feat route is untouched — Magic
  // Initiate on a Fighter is a real character.
  if (casters.length === 0) {
    if (choices.cantrips.length > 0) {
      problems.push(problem('no_spellcasting', 'cantrips', `a ${definition.name} has no cantrips`));
    }
    if (choices.spellbook.length > 0) {
      problems.push(problem('no_spellbook', 'spellbook', `a ${definition.name} has no spellbook`));
    }
    if (choices.preparedSpells.length > 0) {
      problems.push(
        problem('no_spellcasting', 'preparedSpells', `a ${definition.name} prepares no spells`),
      );
    }
    return problems;
  }

  for (const caster of casters) {
    problems.push(...checkClassSpells(content, choices, caster));
  }
  return problems;
}

/**
 * Spells written down under a class that cannot hold them.
 *
 * Two ways to get here, and both would otherwise be absorbed silently: naming
 * `spellsByClass.fighter`, and leaving the flat fields filled in on a character
 * whose two casting classes both named their own lists.
 */
function checkSpellAttribution(
  content: Content,
  choices: CharacterChoices,
  casters: readonly CasterChoices[],
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const levels = new Map(classLevelsOf(choices).map((entry) => [entry.classId, entry.level]));

  for (const classId of Object.keys(choices.spellsByClass ?? {}).sort()) {
    const field = `spellsByClass.${classId}`;
    if (!levels.has(classId)) {
      problems.push(
        problem('not_a_class_of_this_character', field, `this character has no levels in ${classId}`),
      );
    } else if (content.classById(classId)?.spellcasting === undefined) {
      problems.push(problem('no_spellcasting', field, `a ${classId} casts nothing`));
    }
  }

  const flat =
    choices.cantrips.length > 0 ||
    choices.spellbook.length > 0 ||
    choices.preparedSpells.length > 0;
  if (flat && casters.length > 0 && defaultSpellClass(content, choices) === null) {
    problems.push(
      problem('unattributed_spells', 'spellsByClass', `${casters.map((c) => c.definition.name).join(' and ')} both cast, so every spell must say which class it belongs to; put these under spellsByClass`),
    );
  }

  return problems;
}

/** One casting class's spells, on that class's own terms. */
function checkClassSpells(content: Content, choices: CharacterChoices, caster: CasterChoices): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const { definition, level, at } = caster;

  const row = rowAt(definition, level);
  if (!row.ok) return problems;

  // SRD: "This table might give you spell slots of a higher level than the
  // spells you prepare." The ceiling on what may be prepared is the *class's
  // own* table, never the combined one — a level 4 Ranger / level 3 Sorcerer
  // has level 3 slots and still cannot prepare a level 2 Ranger spell.
  const topSlot = highestSlotLevel(slotsAt(definition, level));

  // Spells a feature writes into the book are in the book: preparation can
  // reach them even though the count rule does not measure them. Gathered by
  // what the feature grants rather than by naming the Evoker's, so a second
  // subclass with free spells needs no change here.
  const fromFeatures = classFeatureSpells(content, choices, caster);

  // — cantrips ————————————————————————————————————————————————————————————
  const cantrips = row.value.cantripsKnown ?? 0;
  if (caster.cantrips.length !== cantrips) {
    problems.push(
      problem('wrong_cantrip_count', at('cantrips'), `a level ${level} ${definition.name} knows ${cantrips} cantrips, got ${caster.cantrips.length}`),
    );
  }
  for (const id of duplicates(caster.cantrips)) {
    problems.push(problem('duplicate_spell', at('cantrips'), `${id} is known twice`));
  }
  for (const id of caster.cantrips) {
    problems.push(
      ...checkSpellId(content, id, at('cantrips'), definition.id, {
        minLevel: 0,
        maxLevel: 0,
        what: 'a cantrip',
      }),
    );
  }

  // — the spellbook ———————————————————————————————————————————————————————
  //
  // Only a class that *has* one. SRD gives a Cleric no book at all: they
  // prepare from the whole class list every morning, and a spellbook entry on
  // a Cleric is a mistake rather than a spell.
  const style = definition.spellcasting?.style ?? 'spellbook';

  if (style !== 'spellbook') {
    if (caster.spellbook.length > 0) {
      problems.push(
        problem('no_spellbook', at('spellbook'), `a ${definition.name} has no spellbook to write spells in`),
      );
    }
    problems.push(...checkPreparedFromList(content, caster, row.value, topSlot, style, fromFeatures));
    return problems;
  }

  // The count rule applies to the spells *levelling* granted. Spells copied
  // from a scroll in play ride along and are not counted, or a Wizard who had
  // adventured could not level up.
  const granted = countOf(caster.spellbook, 'level');
  const expected = levelGrantedSpells(level);
  if (granted !== expected) {
    problems.push(
      problem('wrong_spellbook_count', at('spellbook'), `a level ${level} ${definition.name} is granted ${expected} spells by levelling, got ${granted}; spells copied in play carry origin "copied" and are not counted`),
    );
  }
  for (const id of duplicates(spellIds(caster.spellbook))) {
    problems.push(problem('duplicate_spell', at('spellbook'), `${id} is written in the book twice`));
  }
  for (const entry of caster.spellbook) {
    problems.push(
      ...checkSpellId(content, entry.spellId, at('spellbook'), definition.id, {
        minLevel: 1,
        maxLevel: topSlot,
        what: 'a spellbook',
      }),
    );
    if (!Number.isInteger(entry.acquiredAt) || entry.acquiredAt < 1 || entry.acquiredAt > level) {
      problems.push(
        problem('bad_acquisition_level', at('spellbook'), `${entry.spellId} says it was acquired at level ${entry.acquiredAt}, which is not a level this character has reached`),
      );
    }
  }

  // — what is prepared ————————————————————————————————————————————————————
  const prepared = row.value.preparedSpells ?? 0;
  if (caster.preparedSpells.length !== prepared) {
    problems.push(
      problem('wrong_prepared_count', at('preparedSpells'), `a level ${level} ${definition.name} prepares ${prepared} spells, got ${caster.preparedSpells.length}`),
    );
  }
  for (const id of duplicates(caster.preparedSpells)) {
    problems.push(problem('duplicate_spell', at('preparedSpells'), `${id} is prepared twice`));
  }

  const book = new Set([...spellIds(caster.spellbook), ...fromFeatures]);
  for (const id of caster.preparedSpells) {
    if (!book.has(id)) {
      problems.push(
        problem('spell_not_in_spellbook', at('preparedSpells'), `${id} is not in the spellbook`),
      );
      continue;
    }
    // SRD: "The chosen spells must be of a level for which you have spell slots."
    const spell = content.spellEntry(id);
    if (spell !== null && spell.level > topSlot) {
      problems.push(
        problem('prepared_above_slot_level', at('preparedSpells'), `${spell.name} is level ${spell.level}, and this character has no slot above level ${topSlot}`),
      );
    }
  }

  return problems;
}

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
  content: Content,
  caster: CasterChoices,
  row: ClassLevelRow,
  topSlot: number,
  style: SpellcastingStyle,
  fromFeatures: readonly string[],
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const { definition, at } = caster;
  const expected = row.preparedSpells ?? 0;
  const what = style === 'known' ? 'knows' : 'prepares';

  if (caster.preparedSpells.length !== expected) {
    problems.push(
      problem('wrong_prepared_count', at('preparedSpells'), `a level ${caster.level} ${definition.name} ${what} ${expected} spells, got ${caster.preparedSpells.length}`),
    );
  }
  for (const id of duplicates(caster.preparedSpells)) {
    problems.push(problem('duplicate_spell', at('preparedSpells'), `${id} is prepared twice`));
  }

  const granted = new Set(fromFeatures);
  for (const id of caster.preparedSpells) {
    // A feature's free spells are already the character's; they need not be on
    // the class list, which is the whole point of a domain or subclass grant.
    if (granted.has(id)) continue;
    problems.push(
      ...checkSpellId(content, id, at('preparedSpells'), definition.id, {
        minLevel: 1,
        maxLevel: topSlot,
        what: `a ${definition.name} spell`,
      }),
    );
  }

  return problems;
}

/**
 * Spells a feature lets the player choose, checked on the feature's own terms.
 *
 * SRD Evocation Savant: "Choose two Wizard spells from the Evocation school,
 * each of which must be no higher than level 2, and add them to your spellbook
 * for free." The school and the level cap are the feature's, not the book's,
 * so a spell that fails them says which rule it broke. Any feature that
 * offers a spell choice and grants spells is checked this way — the feature
 * says what it allows, and nothing here knows which class or subclass it
 * belongs to.
 */
function checkFeatureSpellChoices(
  content: Content,
  choices: CharacterChoices,
  casters: readonly CasterChoices[],
): CreationProblem[] {
  const problems: CreationProblem[] = [];

  for (const caster of casters) {
    for (const feature of castingFeaturesOf(content, choices, caster)) {
      for (const asked of askedOf(choices, feature)) {
        if (asked.kind !== 'spell' || grantOf(feature, 'spells') === null) continue;
        const picked = choices.featureChoices[choiceAnswerKey(feature.id, asked.key)];
        if (picked === undefined) continue;
        const field = caster.at('featureChoices');

        for (const id of duplicates(picked)) {
          problems.push(problem('duplicate_spell', field, `${feature.name} chose ${id} twice`));
        }
        for (const id of picked) {
          problems.push(
            // **A cantrip is level 0 and the floor follows the ceiling.** A
            // feature that takes spells "no higher than level 2" takes levelled
            // ones, and SRD Divine Order's "one extra cantrip" takes exactly the
            // level a fixed floor of 1 refused.
            ...checkSpellId(content, id, field, caster.definition.id, {
              minLevel: asked.maxLevel === 0 ? 0 : 1,
              ...(asked.maxLevel === undefined ? {} : { maxLevel: asked.maxLevel }),
              ...(asked.school === undefined ? {} : { school: asked.school }),
              ...(asked.fromAnyList === undefined ? {} : { anyList: true as const }),
              ...(asked.ritualOnly === undefined ? {} : { ritual: true as const }),
              what: feature.name,
            }),
          );
        }

        // SRD Pact of the Tome: "they must be spells you **don't already have
        // prepared**." A feature that takes its spells from any class's list
        // is the only one that can collide with the class's own choices —
        // every other one is narrowed to a list the character was choosing
        // from anyway, where the collision is the point (Divine Order's extra
        // cantrip is a Cleric cantrip) — so the rule is read off the question
        // that widens rather than applied to every feature.
        if (asked.fromAnyList === true) {
          const held = new Set([...caster.cantrips, ...caster.preparedSpells]);
          for (const id of picked) {
            if (held.has(id)) {
              problems.push(
                problem('spell_already_known', field, `${feature.name} takes spells this character does not already have prepared, and ${id} is one they do`),
              );
            }
          }
        }

        // A spellbook class writes the free spells into the book, so they must
        // not already be in it; a class without a book has nothing to duplicate.
        if (caster.definition.spellcasting?.style === 'spellbook') {
          const fromLevels = new Set(
            caster.spellbook.filter((e) => e.origin !== 'feature').map((e) => e.spellId),
          );
          for (const id of picked) {
            if (fromLevels.has(id)) {
              problems.push(
                problem('spell_already_known', field, `${id} is already in the spellbook, so ${feature.name} would grant nothing`),
              );
            }
          }
        }
      }
    }
  }

  return problems;
}

/**
 * A feat filed under a question this character was never asked.
 *
 * {@link unaskedAnswers} on the other record, and it arrived with the same
 * change: a feat question may now be a feature's *second*, filed under
 * `<feature id>:<key>`, and a gate that is shut means nobody was asked it. Left
 * alone the entry is not merely unread — every compiler of a feat walks
 * `Object.values(choices.feats)` with no gate, so a Warlock who did not take
 * Lessons of the First Ones would hold its Origin feat anyway, and a level-up
 * that replaced the invocation would leave the feat behind.
 *
 * **Only a keyed answer is asked about**, which is the rule its twin keeps and
 * for the same reason: the bare feature id is where every answer ever written
 * is filed, and a level-up must not refuse a sheet over a question a subclass
 * stopped asking.
 */
function unaskedFeats(
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): CreationProblem[] {
  const asked = new Set<string>();
  for (const feature of features) {
    for (const question of askedOf(choices, feature)) {
      if (question.kind === 'feat') asked.add(choiceAnswerKey(feature.id, question.key));
    }
  }
  const problems: CreationProblem[] = [];
  for (const [key, feat] of Object.entries(choices.feats)) {
    if (featureOfAnswerKey(key) === key || asked.has(key)) continue;
    problems.push(
      problem('feat_not_asked', 'feats', `nothing this character holds asks for a feat under ${key}, and ${feat.featId} answers it`),
    );
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
  content: Content,
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): CreationProblem[] {
  const problems: CreationProblem[] = [...unaskedFeats(choices, features)];
  const taken: { feature: string; feat: FeatDefinition; choice: FeatChoice }[] = [];

  const level = totalLevelOf(choices);

  for (const feature of features) {
    const fixed = feature.grantsFeat;
    // **Whichever question asks for one, and where its answer is filed.**
    // `choices.feats` is keyed by the same key `featureChoices` is — the
    // feature's own id for its primary question, `<id>:<key>` for a later one
    // — so a feature whose first question is already spent on something else
    // can still ask for a feat. SRD Lessons of the First Ones is that feature:
    // it is one option of Eldritch Invocations, whose primary question is the
    // list of invocations taken, and the feat it grants is a second question
    // asked only of whoever took it.
    const asking = askedOf(choices, feature).filter((one) => one.kind === 'feat');
    const choice = asking[0];
    const asksForOne = choice !== undefined;
    const answerKey = choiceAnswerKey(feature.id, choice?.key);
    const made = choices.feats[answerKey];
    if (fixed === undefined && !asksForOne) continue;

    if (made === undefined) {
      problems.push(
        problem('missing_feat_choice', 'feats', `${answerKey} (${feature.name}) grants a feat, and none was chosen`),
      );
      continue;
    }

    const definition = content.featById(made.featId);
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
    // The category the feature's own sentence names: "an Epic Boon feat",
    // and SRD Lessons of the First Ones' "one Origin feat of your choice".
    const category = choice?.kind === 'feat' ? choice.category : undefined;
    if (category !== undefined && definition.category !== category) {
      problems.push(
        problem('wrong_feat_category', 'feats', `${feature.name} grants a ${category} feat; ${definition.name} is ${definition.category}`),
      );
      continue;
    }

    // SRD prints the bracket on the feat — "Prerequisite: Level 4+" — so it
    // is asked of whoever took it rather than of the feature that offered
    // one, and it is the *character's* level, which is what the bracket
    // means for a multiclassed character too.
    if (definition.minimumLevel !== undefined && level < definition.minimumLevel) {
      problems.push(
        problem('feat_level_too_low', 'feats', `${definition.name} is a level ${definition.minimumLevel}+ feat and this character is level ${level}`),
      );
      continue;
    }

    taken.push({ feature: answerKey, feat: definition, choice: made });
    problems.push(...checkFeatChoice(content, answerKey, definition, made, fixed?.spellList));
  }

  // SRD Magic Initiate: "you must choose a different spell list each time."
  const lists = taken
    .filter((t) => t.feat.requires.kind === 'magic-initiate')
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
  content: Content,
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
        problems.push(...checkSpellId(content, id, 'feats', list, { minLevel: 0, maxLevel: 0, what: where }));
      }
      const one = made.levelOneSpell;
      if (one === undefined) {
        problems.push(problem('missing_level_one_spell', 'feats', `${where} needs one level 1 spell`));
      } else {
        problems.push(...checkSpellId(content, one, 'feats', list, { minLevel: 1, maxLevel: 1, what: where }));
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

  // The Ability Score Improvement's sentence and every Epic Boon's, asked
  // where the book asks it. Judged by the same three rules a feature's own
  // answer is — an answer at all, abilities rather than words, and a spread
  // the sentence prints — plus the narrowing only a feat prints today.
  if (requires.kind === 'ability-score') {
    const offers = requires.spreads.map(spreadOf).join(', or ');
    const picked = made.abilities ?? [];
    if (picked.length === 0) {
      problems.push(
        problem('missing_ability_choice', 'feats', `${where} raises ${offers}, and no score was named`),
      );
      return problems;
    }
    problems.push(
      ...spreadProblems(picked, requires.spreads, requires.from, 'feats', where, offers),
    );
  }

  return problems;
}

/**
 * Whether an answer to an ability-score question is one the sentence prints.
 *
 * The counting half of the pair `abilitySpreadProblems` is the authoring half
 * of: that one asks whether the *branches* are answerable, this asks whether
 * this answer is one of them. Shared by the feature's door and the feat's for
 * the same reason the authoring check is — the two sentences are one sentence
 * printed in two places, and a rule kept at one of them is a rule with a hole
 * in it.
 */
function spreadProblems(
  picked: readonly string[],
  spreads: readonly (readonly number[])[],
  from: readonly Ability[] | undefined,
  field: string,
  who: string,
  offers: string,
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const counts = new Map<Ability, number>();
  let unknown = false;

  for (const one of picked) {
    if (!(ABILITIES as readonly string[]).includes(one)) {
      problems.push(
        problem('unknown_ability', field, `${who} raises ability scores, and ${one} is not one of the six`),
      );
      unknown = true;
      continue;
    }
    const ability = one as Ability;
    if (from !== undefined && !from.includes(ability)) {
      problems.push(
        problem('ability_not_offered', field, `${who} raises ${from.join(', ')}, not ${ability}`),
      );
      unknown = true;
      continue;
    }
    counts.set(ability, (counts.get(ability) ?? 0) + 1);
  }
  // A spread counted out of nonsense would be nonsense, so it is left
  // unjudged when one of the picks is.
  if (unknown) return problems;

  const taken = spreadOf([...counts.values()]);
  if (!spreads.some((spread) => spreadOf(spread) === taken)) {
    problems.push(
      problem('ability_spread_not_offered', field, `${who} raises ${offers}; this raises ${taken}`),
    );
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
function hitPointsFor(
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

/**
 * Hit points across every class the character has levels in.
 *
 * SRD: "You gain the Hit Points from your new class as described for levels
 * after 1. You gain the level 1 Hit Points for a class only when your total
 * character level is 1." So the starting class pays the maximum die once and
 * every level after it — in *any* class — takes the average or a roll.
 *
 * A single-classed character goes through exactly the same arithmetic it
 * always did, which is the property the existing tests hold this to.
 */
function multiclassHitPoints(content: Content, choices: CharacterChoices, constitution: number): number {
  const starting = content.classById(choices.classId);
  if (starting === null) return 1;

  const extra = choices.multiclass ?? [];
  if (extra.length === 0) {
    return hitPointsFor(starting, choices.level, constitution, choices.hitPoints);
  }

  // Level 1 in the starting class, at the full die.
  let total = starting.hitDie + constitution;
  let gained = 1;

  const after = (definition: ClassDefinition, levels: number): void => {
    const average = Math.floor(definition.hitDie / 2) + 1;
    for (let n = 0; n < levels; n += 1) {
      const die =
        choices.hitPoints.method === 'rolled'
          ? (choices.hitPoints.rolls[gained - 1] ?? average)
          : average;
      total += Math.max(1, die + constitution);
      gained += 1;
    }
  };

  after(starting, choices.level - 1);
  for (const entry of extra) {
    const definition = content.classById(entry.classId);
    if (definition !== null) after(definition, entry.level);
  }

  return Math.max(1, total);
}

/**
 * Hit points the character's own features add to the class table's total.
 *
 * **Part of the maximum rather than a grant hung on the creature**, which is
 * the whole of why this is here and not in the fold. A casting's maximum is a
 * loan with a source and an ending; a feature's is what the table says the
 * maximum *is* — `hpMax - hpMaxAdjustment` — so it is recomputed at every
 * level and released by nothing. `advanceCharacter` needs no word about it:
 * it subtracts the unadjusted maximum and asks what the difference is.
 *
 * The step is one hit point per level gained **after the one the feature
 * arrived at**, counted in the levels the grant names: a species trait's are
 * the character's, and a class feature's are that class's own, which is
 * `classLevelFor`'s fork and the reason a Sorcerer 3 / Fighter 2 gets three
 * Sorcerer levels' worth of Draconic Resilience and five character levels'
 * worth of Dwarven Toughness.
 */
function featureHitPoints(
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): number {
  let total = 0;
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'hit-point-maximum') continue;
    total += grant.flat;
    if (grant.perLevel === undefined) continue;
    const level =
      grant.perLevel === 'class' ? classLevelFor(choices, feature.id) : totalLevelOf(choices);
    total += Math.max(0, level - feature.level);
  }
  return total;
}

/**
 * Spells a species or a background grants, and the ability they are cast off.
 *
 * The gatherer the shape was missing. A class's features are read per casting
 * class, on that class's own ability; an origin has no ability of its own, so
 * the trait offers a set and the answer is on the character —
 * {@link CharacterChoices.featureSpellcasting}, read through the feature that
 * asked, which may be a sibling.
 *
 * A trait with no answer grants nothing rather than guessing at an ability;
 * `checkFeatureSpellcasting` is what refuses that at the door, so a plan only
 * reaches here once the question has been answered.
 */
function originGrantedSpells(
  choices: CharacterChoices,
  origins: readonly FeatureDefinition[],
): readonly GrantedSpell[] {
  const granted: GrantedSpell[] = [];
  for (const [feature, grant] of grantsIn(origins.map((one) => withGateMet(one, choices)))) {
    if (grant.kind !== 'spells') continue;
    const ability = spellcastingAbilityFor(choices, feature, grant);
    if (ability === undefined) continue;

    for (const spellId of grantedFixedSpells(choices, feature, grant)) {
      granted.push({
        spellId,
        source: feature.id,
        ability,
        freeCastPool: null,
        slotCasting: false,
      });
    }

    // "You can cast it once without a spell slot ... You can also cast the
    // spell using any spell slots you have of the appropriate level." Both
    // halves of one sentence, and the second is off unless the book prints it.
    const free = grant.freeCasting;
    if (free !== undefined) {
      granted.push({
        spellId: free.spell,
        source: feature.id,
        ability,
        freeCastPool: free.pool,
        slotCasting: free.withSlots === true,
        ...castsAs(free),
      });
    }
  }
  return granted;
}

/**
 * Spell slots, from one class's table or from the combined one.
 *
 * SRD: "If you multiclass but have the Spellcasting feature from only one
 * class, follow the rules for that class." So a Fighter/Wizard reads the
 * Wizard's own table, and only a character casting from *two* classes goes to
 * the weighted sum. Pact Magic stays its own pool either way.
 */
function slotsFor(content: Content, choices: CharacterChoices): SlotPools {
  const levels = classLevelsOf(choices);
  const casters = levels.filter((entry) => content.classById(entry.classId)?.spellcasting !== undefined);

  // SRD names Pact Magic as a feature distinct from Spellcasting, and keeps it
  // out of the combined table entirely. So it never joins the sum and never
  // shares a key: a Warlock 3 / Wizard 3 has two level 2 Pact slots *and* two
  // ordinary ones, and one key for both would lose half of them.
  const pact = casters.some((entry) => pactMagic(content, entry.classId))
    ? pactSlotsOf(levels, content.classById)
    : {};

  const spellcasters = casters.filter((entry) => !pactMagic(content, entry.classId));

  // SRD: "If you multiclass but have the Spellcasting feature from only one
  // class, follow the rules for that class." One caster reads its own table,
  // however many non-casting levels sit beside it.
  if (spellcasters.length === 0) return { slots: {}, pact };
  if (spellcasters.length === 1) {
    const only = spellcasters[0];
    const single = only === undefined ? null : content.classById(only.classId);
    const slots = single === null || only === undefined ? {} : slotsAt(single, only.level);
    return { slots, pact };
  }

  return { slots: multiclassSlots(levels, content.classById), pact };
}

/** The two slot pools a character can have, kept apart because SRD keeps them apart. */
interface SlotPools {
  readonly slots: Record<number, number>;
  readonly pact: Record<number, number>;
}

/** Whether this class's slots are Pact Magic's rather than Spellcasting's. */
const pactMagic = (content: Content, classId: string): boolean =>
  content.classById(classId)?.spellcasting?.feature === 'pact-magic';

/**
 * The languages this world hands out for nothing — the SRD's Common.
 *
 * Which language that is, or whether there is one, is the catalogue's answer;
 * the engine only knows that a character does not spend a choice on it.
 */
const spokenByEveryone = (content: Content): ReadonlySet<string> =>
  new Set(
    content.languages
      .filter((language) => language.availability === 'everyone')
      .map((language) => language.name),
  );

/**
 * The languages a feature simply grants — SRD Druidic, SRD Thieves' Cant.
 *
 * Read off the `language` grant rather than off any feature's id, so a
 * homebrew class printing the same sentence puts its tongue on the sheet with
 * no engine change. The gate is already applied: `withGateMet` takes the
 * grant off a feature whose option this character did not choose, so a
 * language behind an unchosen option is not here to be known.
 */
const languagesGranted = (features: readonly FeatureDefinition[]): readonly string[] =>
  [...grantsIn(features)].flatMap(([, grant]) => (grant.kind === 'language' ? grant.known : []));

/**
 * The languages a feature's own question was answered with — SRD Thieves'
 * Cant's "one other language of your choice".
 *
 * Through `askedOf`, like every other reader of an answer, so a question
 * gated on an option nobody took supplies nothing even where an answer was
 * filed. Whether the answer is *legal* is `checkFeatureChoices`' question;
 * this is what the sheet says once it is.
 */
const languagesChosenOnFeatures = (
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): readonly string[] =>
  features.flatMap((feature) =>
    askedOf(choices, feature)
      .filter((asked) => asked.kind === 'language')
      .flatMap((asked) => choices.featureChoices[choiceAnswerKey(feature.id, asked.key)] ?? []),
  );

/**
 * Every language a character ends up knowing: the free ones, the chosen, and
 * the ones a feature put there.
 *
 * **Deduplicated rather than concatenated**, because the three sources can
 * name the same tongue and a sheet listing Elvish twice is a sheet that is
 * wrong about one of them. The order is the order of arrival, which is what
 * every sheet written before features could grant a language already had.
 */
function languagesKnown(
  content: Content,
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): readonly string[] {
  const free = spokenByEveryone(content);
  const known: string[] = [...free];
  for (const language of [
    ...choices.languages,
    ...languagesGranted(features),
    ...languagesChosenOnFeatures(choices, features),
  ]) {
    if (!known.includes(language)) known.push(language);
  }
  return known;
}

/**
 * SRD "Choose Languages": "Common plus two languages you roll or choose from
 * the Standard Languages table."
 *
 * The count is the book's rule and the engine's number; *which* languages
 * exist, which one everybody speaks and which are a GM's to grant rather than
 * a character's to choose are the world's, and come from content. A catalogue
 * that names no language at all makes no claim about which exist, and the
 * membership check has nothing to say — the same rule `checkContent` applies
 * to a granted feat when a catalogue holds no feats.
 */
function checkLanguages(content: Content, choices: CharacterChoices): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const free = spokenByEveryone(content);
  const chosen = choices.languages.filter((language) => !free.has(language));

  if (chosen.length !== LANGUAGES_CHOSEN) {
    const rule =
      free.size === 0
        ? `a character chooses ${LANGUAGES_CHOSEN} languages`
        : `a character knows ${[...free].join(', ')} plus ${LANGUAGES_CHOSEN} more`;
    problems.push(
      problem('wrong_language_count', 'languages', `${rule}, got ${chosen.length}`),
    );
  }
  for (const language of duplicates(chosen)) {
    problems.push(problem('duplicate_language', 'languages', `${language} is listed twice`));
  }
  if (content.languages.length > 0) {
    const offered = content.languages.filter(
      (language) => (language.availability ?? 'standard') === 'standard',
    );
    for (const language of chosen) {
      if (!offered.some((one) => one.name === language)) {
        problems.push(
          problem('unknown_language', 'languages', `${language} is not one a character chooses here; choose from: ${offered.map((one) => one.name).join(', ')}`),
        );
      }
    }
  }
  return problems;
}

/**
 * The size category a printed word names, or null where it names none.
 *
 * Read off the one list of size categories there is, so a seventh cannot be
 * admitted by a literal nobody updated - which is the rule `positioning.ts`
 * states about ranking them and the same rule about spelling them.
 */
function sizeNamed(word: string): CreatureSize | null {
  const lowered = word.trim().toLowerCase();
  return CREATURE_SIZES.find((size) => size === lowered) ?? null;
}

/** What a species' printed sizes and a character's answer come to. */
interface SizeDecision {
  /** Null only where the problems beside it say why there is no answer. */
  readonly size: CreatureSize | null;
  readonly problems: readonly CreationProblem[];
  readonly warnings: readonly CreationProblem[];
}

/**
 * Which of its species' sizes a character is.
 *
 * **The species is read as a union, never by name.** Where it prints one size
 * that is the answer and nobody is asked; where it prints more than one the
 * choice is the player's, and an answer that is not one of the sizes offered
 * is refused - a wrong answer rather than a missing fact.
 *
 * **An unanswered choice is a warning and the first printed size is pinned**,
 * which is the one judgement here. A character always has a size, so "not yet"
 * is not a state the book allows, and the obvious reading is to refuse. But
 * every character written against this engine so far omits it, and this
 * repository has made that mistake once already: requiring the Weapon Mastery
 * choice broke a corpus that spanned worktrees, and the resolution was to warn
 * through the plan rather than refuse. The first printed size is also what
 * every one of those characters has always been placed at, so nothing that
 * folded before folds differently. Promoting this to a refusal is a migration
 * of the character corpus, and wants deciding as one.
 */
function sizeFor(species: SpeciesDefinition, choices: CharacterChoices): SizeDecision {
  const printed: CreatureSize[] = [];
  for (const word of species.sizes) {
    const size = sizeNamed(word);
    if (size === null) {
      return {
        size: null,
        problems: [
          problem(
            'unknown_size',
            'speciesId',
            `${species.id} prints a size of "${word}", which is no size category; have ${CREATURE_SIZES.join(', ')}`,
          ),
        ],
        warnings: [],
      };
    }
    printed.push(size);
  }

  const first = printed[0];
  if (first === undefined) {
    return {
      size: null,
      problems: [problem('unknown_size', 'speciesId', `${species.id} prints no size`)],
      warnings: [],
    };
  }

  const offered = species.sizes.join(' or ');
  const stated = choices.size;
  if (stated !== undefined && stated.trim() !== '') {
    const chosen = sizeNamed(stated);
    if (chosen === null || !printed.includes(chosen)) {
      return {
        size: null,
        problems: [problem('bad_size', 'size', `a ${species.name} is ${offered}, not ${stated}`)],
        warnings: [],
      };
    }
    return { size: chosen, problems: [], warnings: [] };
  }

  if (printed.length === 1) return { size: first, problems: [], warnings: [] };
  return {
    size: first,
    problems: [],
    warnings: [
      problem(
        'size_not_chosen',
        'size',
        `a ${species.name} is ${offered}, and nobody chose; ${species.sizes[0]} is pinned`,
      ),
    ],
  };
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
  content: Content,
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
    items: openPackages(content, [
      ...classKit.value.items,
      ...backgroundKit.value.items,
      ...(choices.dmGrants?.items ?? []),
    ]),
    goldPieces:
      classKit.value.goldPieces + backgroundKit.value.goldPieces + (choices.dmGrants?.goldPieces ?? 0),
  });
}

/**
 * Only what is owned can be worn or held.
 *
 * **Two of one charged item is not refused here**, and the record that used to
 * be missing is why: a copy with charges is born with an id of its own and a
 * pool keyed by it, so a character may start the campaign owning two wands and
 * spend one of them. Which of the two is in hand is creation's own pick — the
 * first — because `duplicate_equipped` below has already refused holding both,
 * and a character being created has no history that could make one copy the
 * meant one.
 */
function checkEquipped(
  content: Content,
  choices: CharacterChoices,
  owned: readonly InventoryLine[],
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const held = new Set(owned.map((line) => line.id));
  for (const itemId of choices.equipped) {
    if (content.item(itemId) === null) {
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
    const armor = content.item(itemId)?.armor;
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

  /**
   * **And a character is born with two hands like everybody else.** SRD
   * Two-Handed: "this weapon requires two hands"; a Shield is wielded in one.
   * `equipItem` refuses a third thing in two hands, and creation must refuse
   * it too — for the reason the slot rule above gives, one paragraph along:
   * otherwise a character can be born holding a Greatsword, a Longsword and a
   * Shield, and every reader of `equipped` has to decide which two are real.
   *
   * The count is {@link DEFAULT_HANDS} rather than the sheet's, because there
   * is no sheet yet where this runs and nothing creation builds writes
   * `CharacterSheet.hands`: a creature with more of them is content declaring
   * a stat block, which arrives through `adaptMonster` and not through here.
   */
  const wielded = choices.equipped
    .map((itemId) => content.item(itemId))
    .filter((item): item is CatalogueItem => item !== null)
    .reduce((total, item) => total + handsFor(item), 0);
  if (wielded > DEFAULT_HANDS) {
    problems.push(
      problem(
        'no_free_hand',
        'equipped',
        `what this character starts with in hand takes ${wielded} hands, and they have ${DEFAULT_HANDS}`,
      ),
    );
  }
  return problems;
}

/**
 * Everything a package puts in your hands, packs opened.
 *
 * SRD prices a pack as a bundle and lists its contents, so a Scholar's Pack is
 * nine things. A character who owns the label owns nothing useful.
 */
function openPackages(content: Content, items: readonly EquipmentEntry[]): readonly InventoryLine[] {
  const lines: InventoryLine[] = [];
  for (const entry of items) {
    for (const line of content.expandPack(entry.id)) {
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
  content: Content,
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

  // Any feature that asks the player to choose a skill grants proficiency in
  // it — the Human's Skillful, the Barbarian's Primal Knowledge, and whatever
  // comes next. Matching `human:skillful` by id was the third place in this
  // file doing that, and Primal Knowledge is what found it.
  //
  // Expertise is the exception, and it is the opposite rule: it asks for a
  // skill you are *already* proficient in and doubles the bonus, so granting
  // proficiency from it would make "Expertise without proficiency" impossible
  // to refuse.
  for (const feature of grantedFeatures(content, choices, parts)) {
    if (grantOf(feature, 'expertise') !== null) continue;
    for (const asked of askedOf(choices, feature)) {
      if (asked.kind !== 'skill') continue;
      for (const skill of choices.featureChoices[choiceAnswerKey(feature.id, asked.key)] ?? []) {
        add(skill, feature.name, 'featureChoices');
      }
    }
  }
  for (const feat of Object.values(choices.feats)) {
    for (const name of feat.proficiencies ?? []) add(name, 'Skilled', 'feats');
  }

  return { skills, tools, warnings };
}

/**
 * The weapon categories this character is proficient with.
 *
 * SRD: the starting class grants its weapon proficiencies in full, and a later
 * class grants the subset its "As a Multiclass Character" section prints. One
 * function because the sheet and the Weapon Mastery check ask the same
 * question, and a second copy is how the two come to disagree.
 *
 * **And a feature may grant one.** SRD Divine Order (Protector): "you gain
 * proficiency with Martial weapons" — folded in here rather than read beside
 * the sheet, so `proficientWith` and the Weapon Mastery check both see it and
 * nothing downstream learns that a feature can say this. The features are
 * already gated, so a Cleric who took the other option brings nothing.
 */
function weaponCategoriesOf(
  content: Content,
  choices: CharacterChoices,
  definition: ClassDefinition,
  features: readonly FeatureDefinition[],
): readonly string[] {
  return [
    ...new Set([
      ...definition.weaponProficiencies,
      ...(choices.multiclass ?? []).flatMap(
        (entry) => content.classById(entry.classId)?.multiclass.weapons ?? [],
      ),
      ...[...grantsIn(features)].flatMap(([, grant]) =>
        grant.kind === 'weapon-and-armor-training' ? (grant.weapons ?? []) : [],
      ),
    ]),
  ].sort();
}

/**
 * Armour training, with what a feature grants folded into what the classes do.
 *
 * `combinedArmorTraining`'s other side: the classes are `multiclass.ts`'s
 * question — the first in full and the rest in part — and a feature's training
 * is this file's, because only creation has the gated feature list. SRD Divine
 * Order (Protector) trains with Heavy armour and Primal Order (Warden) with
 * Medium, and a flag is set or it is not, so the union is the whole rule.
 */
function trainedArmor(
  base: ArmorTraining,
  features: readonly FeatureDefinition[],
): ArmorTraining {
  const granted = new Set(
    [...grantsIn(features)].flatMap(([, grant]) =>
      grant.kind === 'weapon-and-armor-training' ? (grant.armor ?? []) : [],
    ),
  );
  if (granted.size === 0) return base;
  return {
    light: base.light || granted.has('light'),
    medium: base.medium || granted.has('medium'),
    heavy: base.heavy || granted.has('heavy'),
    shields: base.shields || granted.has('shields'),
  };
}

/** Every problem with a set of choices, so a caller can show them all at once. */
export function checkCharacter(
  content: Content,
  choices: CharacterChoices,
  carried?: readonly InventoryLine[],
): readonly CreationProblem[] {
  const { parts, problems } = resolveParts(content, choices);
  if (parts === null) return problems;

  // The features come first now: what a score comes to, and what ceiling it
  // may reach, are both read off the features this character has.
  const features = grantedFeatures(content, choices, parts);

  const all = [
    ...problems,
    ...checkAbilities(content, choices, parts.background, features),
    ...checkSkills(choices, parts.definition),
    ...checkLanguages(content, choices),
    ...sizeFor(parts.species, choices).problems,
    ...checkDmGrants(choices),
    ...checkMulticlass(content, choices, features),
  ];

  const { skills } = gatherProficiencies(content, choices, parts);

  all.push(
    ...checkFeatureChoices(
      content,
      choices,
      features,
      skills,
      weaponCategoriesOf(content, choices, parts.definition, features),
    ),
  );
  all.push(...checkFeats(content, choices, features));
  all.push(...checkKnownForms(content, choices, features));
  all.push(...checkSpells(content, choices, parts.definition));
  all.push(...checkFeatureSpellChoices(content, choices, castingClassesOf(content, choices)));

  const owned = inventoryOf(content, choices, parts);
  if (!owned.ok) {
    all.push(problem(owned.code, 'classEquipment', owned.reason));
  } else {
    all.push(...checkEquipped(content, choices, carried ?? owned.value.items));
  }

  if (choices.name.trim() === '') {
    all.push(problem('no_name', 'name', 'a character needs a name'));
  }
  // A world that declares no alignment axis asks nothing about alignment; one
  // that declares an axis is exhaustive about it.
  if (content.alignments.length > 0 && content.alignmentNamed(choices.alignment) === null) {
    all.push(
      problem('unknown_alignment', 'alignment', `choose one of: ${content.alignments.map((one) => one.name).join(', ')}`),
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
  content: Content,
  choices: CharacterChoices,
  carried?: readonly InventoryLine[],
): Result<CharacterPlan> {
  const problems = checkCharacter(content, choices, carried);
  const first = problems[0];
  if (first !== undefined) return err(first.code, `${first.field}: ${first.reason}`);

  const { parts } = resolveParts(content, choices);
  if (parts === null) return err('unknown_class', 'the character has no class');
  const { definition, species } = parts;

  const sized = sizeFor(species, choices);
  if (sized.size === null) {
    // Unreachable: `checkCharacter` above collects these same problems and
    // this function has already returned on the first of them. It stands
    // because the size is pinned into an event below, and a null must not
    // reach one.
    const bad = sized.problems[0];
    return err(bad?.code ?? 'unknown_size', bad?.reason ?? `${species.id} prints no size`);
  }

  const features = grantedFeatures(content, choices, parts);
  const scores = finalScores(content, choices, features);
  const { skills: proficient, tools, warnings: gathered } = gatherProficiencies(content, choices, parts);
  const warnings = [
    ...gathered,
    ...unclaimedMasteries(choices, features),
    ...unclaimedLanguages(choices, features),
    ...sized.warnings,
  ];

  const expertise = new Set(expertiseSkills(content, choices, parts));
  const skills: Partial<Record<Skill, 'proficient' | 'expertise'>> = {};
  for (const skill of proficient) {
    skills[skill] = expertise.has(skill) ? 'expertise' : 'proficient';
  }

  // Armour Class reads what is *worn*, not what is owned. A suit of chain mail
  // in the backpack protects nobody.
  const equipped = choices.equipped.map((itemId) => content.item(itemId)?.armor ?? null);
  const worn = equipped.find((piece) => piece !== null && piece.category !== 'shield') ?? null;
  const held = equipped.find((piece) => piece !== null && piece.category === 'shield') ?? null;

  const casters = castingClassesOf(content, choices);

  // SRD writes the Paladin's three auras as benefits *inside* one aura, and
  // only two features say how big it is — Aura of Protection's 10 feet and
  // Aura Expansion's 30. Resolving the radius once, here, is what stops Aura of
  // Courage and Aura of Devotion disagreeing with Aura of Protection about
  // their own size after level 18.
  const auraFeet = [...grantsIn(features)].reduce(
    (widest, [, grant]) =>
      grant.kind === 'standing' ? Math.max(widest, grant.auraFeet ?? 0) : widest,
    0,
  );

  const byFeatureId = new Map(features.map((feature) => [feature.id, feature]));

  const standing: StandingEffect[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'standing') continue;
    // Where the choice this grant reads was made. Its own feature unless the
    // grant names a sibling — which is how the SRD writes a species: one trait
    // asks which ancestry, lineage or legacy you are and the later ones are
    // written in terms of it. The content validator has already held the name
    // to a sibling that asks something.
    const chooser = byFeatureId.get(featureOfAnswerKey(grant.choiceFrom ?? feature.id));
    const picked = choices.featureChoices[chooser?.id ?? feature.id] ?? [];

    // SRD "You gain one of the following options of your choice" is not asked
    // here any more: `withGateMet` has already taken the grant off a feature
    // whose player took the other option, for every kind of grant at once. See
    // `GrantGate`.

    // A feature that only resizes the aura grants no benefit of its own.
    for (const declared of grant.effects ?? []) {
      // SRD Elemental Affinity chooses its damage type at the table; the grant
      // says the types come from the choice rather than naming them, because
      // the feature does not know which one the player picked.
      //
      // And where the option is not itself a damage type — an ancestry, a
      // legacy — the feature that asked declares what each of its options
      // *means*, which is the other column of the table the book prints beside
      // the choice. Read from the chooser, because the table belongs to the
      // question rather than to any of the traits written in terms of it.
      const meanings = chooser?.optionMeans;
      const chosenTypes = (): readonly string[] =>
        picked
          .flatMap((option) =>
            meanings === undefined ? [option] : (meanings[option]?.damageTypes ?? []),
          )
          .map((type) => type.toLowerCase());
      let effect: StandingGrant =
        grant.damageTypesFromChoice !== true
          ? declared
          : declared.kind === 'damage-resistance'
            ? { ...declared, damageTypes: chosenTypes() }
            : // SRD Elemental Affinity writes both halves off one choice — "You
              // have Resistance to that damage type, and when you cast a spell
              // that deals damage of that type" — so the second half reads the
              // same answer rather than asking the player again.
              declared.kind === 'casting-damage'
              ? { ...declared, when: { ...declared.when, damageTypes: chosenTypes() } }
              : declared;

      // SRD Agonizing Blast: "Choose one of your known Warlock cantrips that
      // deals damage ... add your Charisma modifier to **that spell's** damage
      // rolls." The narrowing is the player's answer, read off the keyed
      // question the grant names — `choiceFrom`'s second job — rather than off
      // the primary answer the gate above reads.
      //
      // **No answer grants nothing.** A `casting-damage` grant whose `when`
      // named no spell would reach every casting the Warlock makes, which is a
      // benefit misapplied rather than one never applied; creation refuses the
      // sheet for the missing answer, and this makes sure a plan built past
      // that refusal hands out nothing.
      if (grant.spellFromChoice === true) {
        if (effect.kind !== 'casting-damage') continue;
        const named = choices.featureChoices[grant.choiceFrom ?? feature.id] ?? [];
        const spell = named[0];
        if (spell === undefined) continue;
        effect = { ...effect, when: { ...effect.when, spell } };
      }

      // SRD Sneak Attack's dice are a column of the Rogue table, read at that
      // class's own level — the same rule Rage Damage's flat bonus follows.
      if (grant.diceCountByLevel !== undefined && effect.kind === 'attack-damage') {
        const count = usesOf(choices, feature.id, grant.diceCountByLevel);
        const faces = (effect.dice ?? '1d6').split('d')[1] ?? '6';
        effect = { ...effect, dice: `${count}d${faces}` };
      }

      // SRD Unarmored Movement's feet are a column of the Monk table, read at
      // that class's own level — the same rule Sneak Attack's dice follow, and
      // the reason a Monk 2 / Fighter 3 gets the Monk 2 row rather than the
      // level 5 one.
      if (grant.feetByLevel !== undefined && effect.kind === 'speed') {
        effect = { ...effect, feet: usesOf(choices, feature.id, grant.feetByLevel) };
      }

      // SRD Slow Fall: "five times your Monk level" — the granting class's
      // own level, pinned here because a Monk 4 / Fighter 1 is a Monk 4 to
      // this sentence and the sheet holds only the total.
      if (effect.kind === 'fall-damage-reduction') {
        effect = { ...effect, classLevel: classLevelFor(choices, feature.id) };
      }

      standing.push({
        feature: feature.id,
        name: feature.name,
        reach: grant.reach === 'self' ? { kind: 'self' } : { kind: 'aura', feet: auraFeet },
        grant: effect,
        ...(grant.requires === undefined ? {} : { requires: grant.requires }),
      });
    }
  }

  standing.push(...standingFromFeats(content, choices));

  // A feature the character can switch on, and the standing effects it
  // switches on with it. The benefits are ordinary standing effects requiring
  // `feature-active`, so nothing about them is special-cased anywhere else.
  const activated: ActivatedFeature[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'activated') continue;

    activated.push({
      feature: feature.id,
      name: feature.name,
      action: grant.action,
      pool: grant.pool,
      lasts: activationSpanOf(grant),
      ...(grant.size === undefined ? {} : { size: grant.size }),
      ...(grant.capSeconds === undefined ? {} : { capSeconds: grant.capSeconds }),
      ...(grant.endsOn === undefined ? {} : { endsOn: grant.endsOn }),
      // SRD Divine Sense's radius and the three types it reports, carried
      // whole: neither is a column of any class table, and what reads them is
      // `detectedBy` at the moment somebody asks.
      ...(grant.detects === undefined ? {} : { detects: grant.detects }),
      ...(grant.forbidsCasting === undefined ? {} : { forbidsCasting: grant.forbidsCasting }),
      ...(grant.onlyIfUnmoved === undefined ? {} : { onlyIfUnmoved: grant.onlyIfUnmoved }),
      // Carried across whole, and read at the moment of use rather than here:
      // what a use hangs is a grant the command emits, not a class table to be
      // resolved at a level — see `HungGrant`.
      ...(grant.hangs === undefined ? {} : { hangs: grant.hangs }),
      // The same, for what a use hangs on an **object**: SRD Sacred Weapon's
      // ability is named by its own sentence and its floor is printed beside
      // it, so there is no column to read here — `activateFeature` names the
      // weapon and pins the rider.
      ...(grant.imbuesWeapon === undefined ? {} : { imbuesWeapon: grant.imbuesWeapon }),
    });

    for (const declared of grant.whileActive ?? []) {
      // SRD Rage Damage is a column of the class table, not a number the
      // feature can name, so creation reads it at that class's own level —
      // the same rule the pool's size follows.
      const effect =
        grant.flatByLevel !== undefined && declared.kind === 'attack-damage'
          ? { ...declared, flat: usesOf(choices, feature.id, grant.flatByLevel) }
          : declared;

      standing.push({
        feature: feature.id,
        name: feature.name,
        reach: { kind: 'self' },
        grant: effect,
        requires: [{ kind: 'feature-active', feature: feature.id }],
      });
    }
  }

  // A feature that lays a stat block over the sheet, with its table read at
  // the class level. The forms are the character's own answer, sorted so two
  // characters who learned the same four in a different order are one sheet.
  const shapeShifts: ShapeShift[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'shape-shift') continue;
    const level = classLevelFor(choices, feature.id);
    const row = shapeRowAt(grant.forms, level);
    if (row === null) continue;
    shapeShifts.push({
      feature: feature.id,
      name: feature.name,
      action: grant.action,
      pool: grant.pool,
      formType: grant.formType,
      known: row.known,
      maxChallengeRating: row.maxChallengeRating,
      flying: row.flying,
      // SRD "Round Down": half a Druid 5's level is two hours, not two and a half.
      hours: Math.floor(level * grant.hoursPerLevel),
      temporaryHitPoints: Math.floor(level * (grant.temporaryHitPointsPerLevel ?? 0)),
      keeps: grant.keeps.abilities,
      ...(grant.forbidsCasting === undefined ? {} : { forbidsCasting: grant.forbidsCasting }),
      knownForms: [...(choices.knownForms ?? [])].sort(),
    });
  }

  // A feature that makes a thing with statistics of its own — SRD Gnomish
  // Lineage's clockwork device. Everything it needs is printed on the trait
  // rather than read off a table, so it is carried across whole; what varies
  // between two holders is the room, not the sheet.
  const objectMakers: ObjectMaker[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'creates-object') continue;
    objectMakers.push({
      feature: feature.id,
      name: feature.name,
      castingSeconds: grant.castingSeconds,
      spell: grant.spell,
      size: grant.object.size,
      armorClass: grant.object.armorClass,
      hitPoints: grant.object.hitPoints,
      lastsSeconds: grant.lastsSeconds,
      atOnce: grant.atOnce,
      functions: grant.functions,
      activation: grant.activation,
    });
  }

  // A feature that lets its holder simply know something about a creature —
  // SRD Hunter's Lore. Nothing about it is read off a class table and nothing
  // is spent, so the declaration is carried across whole; what varies between
  // two holders is which creature their casting has marked, which is state.
  const knows: KnownFact[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'knowledge') continue;
    knows.push({
      feature: feature.id,
      name: feature.name,
      reveals: grant.reveals,
      about: grant.about,
    });
  }

  // A feature whose use is spent to heal its holder. The die is resolved here
  // because one of the two reads it off a class table — "roll your Martial
  // Arts die" is 1d6 at Monk 1 and 1d10 at Monk 11 — and the addend stays
  // symbolic because the other one is an ability modifier, which is a number
  // on the sheet at the moment the die is thrown.
  /**
   * The spellcasting ability a feature's own numbers are read with.
   *
   * SRD Turn Undead rolls against "your spell save DC", which on a Cleric
   * feature is the **Cleric's** — so it is the granting class's ability and
   * not the character's, which a multiclassed holder may have two of. A
   * subclass feature is its class's, found through the class that took it.
   *
   * Null where the granting class casts nothing at all, which no SRD class
   * that prints such a feature is; the command then falls back to the rule
   * `numbersForItem` already writes for a wielder with no ability.
   */
  const castingAbilityFor = (featureId: string): Ability | null => {
    const owner = featureId.split(':')[0] ?? '';
    const own = content.classById(owner);
    if (own !== null) return own.spellcasting?.ability ?? null;
    for (const entry of classLevelsOf(choices)) {
      if (entry.subclassId !== owner) continue;
      return content.classById(entry.classId)?.spellcasting?.ability ?? null;
    }
    return null;
  };

  const healFor = (featureId: string, heals: HealGrant): HealAmount | null => {
    const level = classLevelFor(choices, featureId);
    const dice =
      heals.diceByLevel === undefined
        ? heals.dice
        : heals.diceByLevel[Math.max(0, Math.min(level, heals.diceByLevel.length) - 1)];
    if (dice === undefined) return null;

    return {
      dice,
      plus:
        heals.plus === 'class-level'
          ? // "plus your **Fighter** level", so the class's own name is what
            // the log should say rather than a bare number.
            { kind: 'level', level, label: `${definition.name} level` }
          : { kind: 'ability', ability: heals.plus, label: ABILITY_NAMES[heals.plus] },
      ...(heals.minimum === undefined ? {} : { minimum: heals.minimum }),
    };
  };

  // A pool of hit points spent by touching somebody. What it can lift is the
  // union of what every feature says, because Restoring Touch lengthens a list
  // it does not own — the same move Improved Critical makes on a threshold,
  // with a union where that one takes a minimum.
  const healingTouch: HealingTouch[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'pool' || grant.touchHeals === undefined) continue;

    healingTouch.push({
      feature: feature.id,
      name: feature.name,
      action: grant.touchHeals.action,
      pool: grant.key,
      lifts: liftsFor(features, grant.key, grant.touchHeals.lifts),
      costPerCondition: grant.touchHeals.costPerCondition,
    });
  }

  const selfHeals: SelfHealFeature[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'pool' || grant.heals === undefined) continue;

    const heal = healFor(feature.id, grant.heals);
    if (heal === null) continue;

    // SRD Tactical Shift rides on Second Wind's use and arrives four levels
    // later, so the rider is compiled only for a character who really has the
    // feature that hands it over — `recoversSooner`'s rule one field along.
    const handsMove = grant.heals.handsMove;
    const hands =
      handsMove !== undefined && features.some((one) => one.id === handsMove.withFeature)
        ? { handsMove: { feature: handsMove.withFeature, share: handsMove.share } }
        : {};

    selfHeals.push({
      feature: feature.id,
      name: feature.name,
      action: grant.heals.action,
      pool: grant.key,
      ...hands,
      ...heal,
    });
  }

  // What a use of a pool buys, where what it buys is room in the turn's own
  // budget — SRD Action Surge's additional action, SRD Flurry of Blows' two
  // Unarmed Strikes.
  //
  // **Nothing is resolved here**, which is what tells this pass apart from the
  // one below it: no class table is read, because an extra action is one
  // action at every level and a Flurry is two strikes at every level the SRD
  // prints it at. It is compiled onto the sheet all the same, so the command
  // that spends a use reads a sheet rather than a catalogue — the rule every
  // other menu keeps, and the one that makes the numbers on the event pinned
  // rather than looked up.
  const budgetPurchases: BudgetPurchase[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'pool' || grant.buysBudget === undefined) continue;
    for (const purchase of grant.buysBudget) {
      budgetPurchases.push({
        feature: feature.id,
        featureName: feature.name,
        purchase: purchase.id,
        name: purchase.name,
        pool: grant.key,
        action: purchase.action,
        ...(purchase.extraAction === undefined ? {} : { extraAction: purchase.extraAction }),
        ...(purchase.extraAttacks === undefined ? {} : { extraAttacks: purchase.extraAttacks }),
        ...(purchase.oncePerTurn === undefined ? {} : { oncePerTurn: purchase.oncePerTurn }),
      });
    }
  }

  // What a use of a pool buys, where what it buys is an effect list. The dice
  // are resolved here for the same reason a self-heal's are — SRD Divine
  // Spark's die is a column of the Cleric table — and the spellcasting ability
  // is resolved here because it belongs to the *granting class*: "your spell
  // save DC" on a Cleric feature is the Cleric's, whatever else its holder
  // multiclassed into.
  //
  // **A menu is the host feature's, wherever its entries were written down.**
  // A subclass's `pool-options` grant is a door onto a menu the class feature
  // prints — SRD Preserve Life joining Channel Divinity's — so its forms are
  // compiled under the host's id, at the host's class level and on the host's
  // spellcasting ability, and the command that spends a use names Channel
  // Divinity exactly as it does for Turn Undead. A grant whose host this
  // character does not hold contributes nothing: `checkContent` refuses that
  // arrangement in the catalogue, where the level it arrives at is knowable.
  const poolOptions: PoolOption[] = [];
  const menus: {
    readonly host: FeatureDefinition;
    readonly pool: string;
    readonly options: readonly PoolOptionGrant[];
    /**
     * The damage type the player's own answer named, where the grant said the
     * options read one — SRD Breath Weapon's "of the type determined by your
     * Draconic Ancestry trait".
     *
     * Resolved where the grant is found rather than where the option is
     * compiled, because the table belongs to the feature that asked the
     * question and the gate that reads it is the grant's, not the menu's.
     */
    readonly damageType?: string;
  }[] = [];

  /**
   * The damage type a grant's own choice names, for a grant that says its
   * damage comes from one.
   *
   * The `standing` loop's `chosenTypes` asked of a second host and answered
   * with one type rather than a list: a `damage-resistance` resists everything
   * the answer named and one blow deals a single type, so a table entry that
   * meant two would have to say which. The SRD prints one type per dragon and
   * `checkContent` holds every meaning to naming some.
   */
  const chosenDamageTypeOf = (
    feature: FeatureDefinition,
    grant: { readonly choiceFrom?: string },
  ): string | undefined => {
    const chooser = byFeatureId.get(featureOfAnswerKey(grant.choiceFrom ?? feature.id));
    const picked = choices.featureChoices[chooser?.id ?? feature.id] ?? [];
    const meanings = chooser?.optionMeans;
    return picked
      .flatMap((option) => (meanings === undefined ? [option] : (meanings[option]?.damageTypes ?? [])))
      .map((type) => type.toLowerCase())[0];
  };
  /**
   * What a later feature changes about a form already on a menu, by host and
   * option — SRD Sear Undead's Radiant damage on Turn Undead's failed save.
   *
   * Gathered before the menus are compiled rather than merged into them,
   * because the amendment and the form it amends are written on two different
   * features and only one of them declares the option.
   */
  const amendments: {
    readonly host: string;
    readonly option: string;
    readonly damage: FailedSaveDamage;
  }[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind === 'pool' && grant.options !== undefined) {
      const typed =
        grant.damageTypesFromChoice === true ? chosenDamageTypeOf(feature, grant) : undefined;
      menus.push({
        host: feature,
        pool: grant.key,
        options: grant.options,
        ...(typed === undefined ? {} : { damageType: typed }),
      });
      continue;
    }
    if (grant.kind !== 'pool-options') continue;
    const host = features.find((one) => one.id === grant.feature);
    const hosted = grantOf(host, 'pool');
    if (host === undefined || hosted === null) continue;
    if (grant.options !== undefined) {
      menus.push({ host, pool: hosted.key, options: grant.options });
    }
    for (const amendment of grant.amends ?? []) {
      const sized = amendment.damagesFailures;
      amendments.push({
        host: host.id,
        option: amendment.option,
        damage: {
          // "a number of d8s equal to your Wisdom modifier (minimum of 1d8)",
          // counted by the one reader every printed sizing goes through — at
          // the *amending* feature's own class level, because the sentence is
          // that feature's rather than the host's.
          dice: withDiceCountOf(
            sized.die,
            poolSizeOf(content, choices, features, feature.id, sized.count),
          ),
          damageType: sized.damageType,
        },
      });
    }
  }

  /** The amendment for one form of one menu, or nothing where none was written. */
  const amendmentFor = (host: string, option: string): FailedSaveDamage | undefined =>
    amendments.find((one) => one.host === host && one.option === option)?.damage;

  for (const { host, pool, options, damageType } of menus) {
    const count =
      options.some((option) => option.diceCountByLevel !== undefined)
        ? classLevelFor(choices, host.id)
        : 0;

    for (const option of options) {
      // SRD Breath Weapon prints its own formula — "DC 8 plus your
      // Constitution modifier and Proficiency Bonus" — where SRD Channel
      // Divinity reads the granting class's. The option's own answer wins,
      // which is the rule an `on-hit` grant's `saveAbility` already keeps one
      // trigger along.
      const ability = option.saveAbility ?? castingAbilityFor(host.id);
      const counted =
        option.diceCountByLevel === undefined
          ? option.effects
          : withDiceCount(
              option.effects,
              option.diceCountByLevel[
                Math.max(0, Math.min(count, option.diceCountByLevel.length) - 1)
              ] ?? 1,
            );
      poolOptions.push({
        feature: host.id,
        featureName: host.name,
        option: option.id,
        name: option.name,
        action: option.action,
        pool,
        // The type the player's own answer named — SRD Breath Weapon's "of the
        // type determined by your Draconic Ancestry trait", written onto the
        // effects here with the substitution a stated damage type already goes
        // through, because the answer was given once and does not change.
        effects: statedDamageType(counted, damageType),
        // What a later feature hangs on this form's failed saving throw — SRD
        // Sear Undead on Turn Undead. Absent for every option nobody amended,
        // which is every option but one.
        ...(amendmentFor(host.id, option.id) === undefined
          ? {}
          : { damagesFailures: amendmentFor(host.id, option.id)! }),
        ability,
        ...(option.area === undefined ? {} : { area: option.area }),
        ...(option.areas === undefined ? {} : { areas: option.areas }),
        ...(option.reach === undefined ? {} : { reach: option.reach }),
        ...(option.mustBeType === undefined ? {} : { mustBeType: option.mustBeType }),
        ...(option.durationSeconds === undefined
          ? {}
          : { durationSeconds: option.durationSeconds }),
        ...(option.endsEarly === undefined ? {} : { endsEarly: option.endsEarly }),
        ...(option.damageTypeStated === undefined
          ? {}
          : { damageTypeStated: option.damageTypeStated }),
        // The budget, sized here for the reason the dice above are: SRD
        // Preserve Life's "five times your Cleric level" is a multiple of the
        // *host's* class level, and `poolSizeOf` is the one reader of every
        // sizing the SRD writes — asked of hit points rather than of uses,
        // which is the reading Lay On Hands' pool already has.
        ...(option.distributes === undefined
          ? {}
          : {
              distributes: {
                hitPoints: poolSizeOf(
                  content,
                  choices,
                  features,
                  host.id,
                  option.distributes.hitPoints,
                ),
                cap: option.distributes.cap,
                ...(option.distributes.excludesTypes === undefined
                  ? {}
                  : { excludesTypes: option.distributes.excludesTypes }),
              },
            }),
      });
    }
  }

  // What a *casting* may buy, where what it buys is a change to the casting
  // itself. SRD Metamagic's menu, filtered here by the answer the player gave
  // the feature's own `option` choice — "you gain two Metamagic options of
  // your choice" — so the sheet carries the two they took and none of the
  // eight they did not. A grant on a feature that asks nothing grants all of
  // its options, which is the homebrew feature with one entry on its menu.
  const castingOptions: CastingOption[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'casting-options') continue;

    const asked = primaryChoiceOf(feature)?.kind === 'option';
    const picked = choices.featureChoices[feature.id] ?? [];

    for (const option of grant.options) {
      if (asked && !picked.includes(option.name)) continue;
      castingOptions.push({
        feature: feature.id,
        featureName: feature.name,
        option: option.id,
        name: option.name,
        pool: grant.pool,
        cost: option.cost,
        perCasting: grant.perCasting,
        alters: option.alters,
      });
    }
  }

  // What a **hit** buys, which is the same effect list one trigger along. The
  // ability is resolved here for the pool option's reason and with one more
  // answer: SRD Monk's Focus prints its own ("8 plus your Wisdom modifier and
  // Proficiency Bonus") because a Monk casts nothing for a spell save DC to be
  // read off.
  const hitOptions: HitOption[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'on-hit') continue;

    const ability = grant.saveAbility ?? castingAbilityFor(feature.id);

    for (const option of grant.options) {
      const sizedTo = option.targetNoLargerThan ?? grant.targetNoLargerThan;
      hitOptions.push({
        feature: feature.id,
        featureName: feature.name,
        option: option.id,
        name: option.name,
        pool: grant.pool ?? null,
        // SRD prints "expend 1 Focus Point" and prints no other number, so one
        // is what an absent cost means — and a rider with no pool costs
        // nothing whatever this says.
        costs: grant.costs ?? 1,
        ...(grant.oncePerTurn === undefined ? {} : { oncePerTurn: grant.oncePerTurn }),
        ...(grant.weapons === undefined ? {} : { weapons: grant.weapons }),
        ...(grant.unarmedStrike === undefined ? {} : { unarmedStrike: grant.unarmedStrike }),
        // SRD Open Hand Technique: "an attack granted by your Flurry of
        // Blows" — a fact about what bought the swing rather than about what
        // is in the hand, asked of the budget at the moment of the swing.
        ...(grant.fromGrant === undefined ? {} : { fromGrant: grant.fromGrant }),
        // SRD Hill's Tumble: "when you hit a **Large or smaller** creature".
        // On the grant because the SRD writes it in the trigger sentence, and
        // carried onto each option because the swing is what reads it — or on
        // the option itself, where the book prints the clause on one of
        // several: SRD Cunning Strike gates Trip on a size and Poison on
        // nothing. The narrower sentence wins.
        ...(sizedTo === undefined ? {} : { targetNoLargerThan: sizedTo }),
        // SRD Cunning Strike: "the number of Sneak Attack damage dice you must
        // forgo". The feature whose dice pay is the grant's, because it is
        // written once in the trigger sentence; the count is the option's,
        // because the book writes it on each effect.
        ...(grant.forgoesDiceOf === undefined ? {} : { forgoesDiceOf: grant.forgoesDiceOf }),
        ...(option.costsDice === undefined ? {} : { costsDice: option.costsDice }),
        // "you must have a Poisoner's Kit on your person" — an item id, read
        // off the inventory at the swing.
        ...(option.requiresItem === undefined ? {} : { requiresItem: option.requiresItem }),
        // "you move up to half your Speed without provoking Opportunity
        // Attacks" — the feet SRD Tactical Shift already hands a turn.
        ...(option.handsMove === undefined ? {} : { handsMove: option.handsMove }),
        effects: option.effects,
        ability,
        ...(option.lasts === undefined ? {} : { lasts: option.lasts }),
        ...(option.lastsOn === undefined ? {} : { lastsOn: option.lastsOn }),
        ...(option.forcedMove === undefined ? {} : { forcedMove: option.forcedMove }),
        ...(option.durationSeconds === undefined
          ? {}
          : { durationSeconds: option.durationSeconds }),
        ...(option.endsEarly === undefined ? {} : { endsEarly: option.endsEarly }),
        // SRD Fire's Burn's "1d10 Fire damage" — a component of the blow
        // rather than an entry in the list above, gathered by the attack path
        // before the one damage roll the swing makes.
        ...(option.extraDamage === undefined ? {} : { extraDamage: option.extraDamage }),
      });
    }
  }

  // A Reaction a feature takes at one of the engine's named windows. The die
  // is resolved here for the same reason a self-heal's is: two of the nine
  // read it off a class table — the Bardic Inspiration die is a d6 at Bard 1
  // and a d12 at 15 — and the ability addends stay symbolic, because a
  // modifier is a number on the sheet at the moment the die is thrown.
  const reactions: ReactionFeature[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'reaction') continue;

    const level = classLevelFor(choices, feature.id);
    for (const declared of grant.does) {
      const resolved = reactionEffectOf(declared, level, definition.name);
      if (resolved === null) continue;

      reactions.push({
        feature: feature.id,
        name: feature.name,
        // Derived from what the effect acts on rather than declared beside it,
        // so the two can never disagree — and so Cutting Words, which answers
        // "a damage roll **or** a success on an ability check", is filed under
        // both windows from one grant.
        window: reactionWindowOf(resolved),
        costsReaction: grant.costsReaction,
        pool: grant.pool ?? null,
        reach: grant.reach,
        ...(grant.requiresSight === undefined ? {} : { requiresSight: grant.requiresSight }),
        does: resolved,
      });
    }
  }

  // SRD Deflect Energy: a second feature restating the first's damage-type
  // list. Applied after the list is built, because it names a feature that has
  // to be in it — and granting a second Reaction instead would let a Monk 13
  // deflect the same blow twice.
  for (const [, grant] of grantsIn(features)) {
    if (grant.kind !== 'widens-reaction') continue;
    for (let index = 0; index < reactions.length; index += 1) {
      const current = reactions[index];
      if (current === undefined || current.feature !== grant.feature) continue;
      if (current.does.kind !== 'reduce-damage') continue;
      const widened = { ...current.does };
      delete (widened as { damageTypes?: readonly string[] }).damageTypes;
      reactions[index] = { ...current, does: widened };
    }
  }

  // What a use of a pool buys, where what it buys is a Reaction somebody
  // **else** will hold. The same resolution as the loop above, at the same
  // level, and for the same reason — the die belongs to the giver's class
  // table — with the range, the hour and the sense clause coming through
  // untouched.
  const conferredReactions: ConferrableReaction[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'pool' || grant.confersReaction === undefined) continue;

    const declaration = grant.confersReaction;
    const level = classLevelFor(choices, feature.id);
    const confers: ReactionFeature[] = [];
    for (const declared of declaration.does) {
      const resolved = reactionEffectOf(declared, level, definition.name);
      if (resolved === null) continue;
      confers.push({
        feature: feature.id,
        name: feature.name,
        window: reactionWindowOf(resolved),
        costsReaction: declaration.costsReaction,
        // A conferred Reaction costs its holder no pool: the use was spent by
        // whoever gave it away, and what a use of it spends is the grant.
        pool: null,
        reach: declaration.reach,
        ...(declaration.requiresSight === undefined
          ? {}
          : { requiresSight: declaration.requiresSight }),
        does: resolved,
      });
    }
    if (confers.length === 0) continue;

    conferredReactions.push({
      feature: feature.id,
      name: feature.name,
      action: declaration.action,
      range: declaration.range,
      pool: grant.key,
      durationSeconds: declaration.durationSeconds,
      ...(declaration.requiresSightOrHearing === undefined
        ? {}
        : { requiresSightOrHearing: declaration.requiresSightOrHearing }),
      ...(declaration.excludesSelf === undefined ? {} : { excludesSelf: declaration.excludesSelf }),
      confers,
    });
  }

  // SRD Dark One's Blessing: what a feature pays when an enemy falls. The
  // class level is resolved here for the reason a Reaction's die is — "your
  // Warlock level" is a column of one class's table, and a Warlock 3 /
  // Fighter 5 is paid three — while the ability stays a name, because a
  // modifier is a number on the sheet at the moment the enemy falls.
  const onDroppingAHostile: DropReward[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'on-dropping-a-hostile') continue;
    onDroppingAHostile.push({
      feature: feature.id,
      name: feature.name,
      ability: grant.temporaryHitPoints.ability,
      classLevel:
        grant.temporaryHitPoints.plusClassLevel === true
          ? classLevelFor(choices, feature.id)
          : 0,
      minimum: grant.temporaryHitPoints.minimum,
      ...(grant.within === undefined ? {} : { within: grant.within }),
    });
  }

  // SRD Weapon Mastery: which weapons this character has mastery with, and
  // whatever a later feature lets them swap in. Gathered from the grant rather
  // than from the five class ids that write it, so a sixth needs no change
  // here, and sorted because it reaches serialised state.
  const weaponMasteries = [
    ...new Set(choicesGranting(choices, features, 'weapon-mastery')),
  ].sort();
  const masterySubstitutions = [
    ...new Set(
      [...grantsIn(features)].flatMap(([, grant]) =>
        grant.kind === 'weapon-mastery' ? (grant.substitutes ?? []) : [],
      ),
    ),
  ].sort();

  // A feature that gives some *other* pool's uses back. The key it refills is
  // resolved here rather than named by the feature, because Pact Magic's key
  // carries a slot level that moves as the Warlock levels — the same reason
  // Rage Damage's flat bonus is read at that class's own level rather than
  // written into the grant.
  const recoveries: RecoveryFeature[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'recovery') continue;

    // A Warlock has Pact slots at exactly **one** level at a time: the table is
    // written with zeros below, and `pactSlotsOf` keeps only the rows with a
    // count. So there is one key, not a list to choose from — a mutation
    // reversing a sort over it changed nothing, which is how the sort was
    // found to be a line that could never matter. A character with no Pact
    // slots is a grant that refills nothing, and is skipped rather than
    // pointed at a pool that does not exist.
    const pactLevels = Object.keys(slotsFor(content, choices).pact).map(Number);
    const restores =
      grant.restores.kind === 'pool'
        ? grant.restores.key
        : pactLevels.length === 1
          ? pactSlotKey(pactLevels[0] ?? 0)
          : undefined;
    if (restores === undefined) continue;

    recoveries.push({
      feature: feature.id,
      name: feature.name,
      pool: grant.pool,
      restores,
      upTo: grant.upTo,
      // "half your **Sorcerer** level" — that class's level, not the
      // character's, so a Sorcerer 5 / Fighter 5 still gets two.
      classLevel: classLevelFor(choices, feature.id),
      moment: grant.moment,
      ...(grant.heals === undefined
        ? {}
        : (() => {
            const heal = healFor(feature.id, grant.heals);
            return heal === null ? {} : { heal };
          })()),
    });
  }

  // A feature that pays for one resource with another. The keys are resolved
  // here for the reason a recovery's are: a spell slot's key carries a level,
  // and `spellSlotKey` is the engine's derivation rather than something a
  // class file may spell out. A slot the caller chooses the level of resolves
  // to null and is settled at the moment of the trade, which is the only thing
  // about a trade creation cannot know.
  const trades: TradeFeature[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'trade') continue;
    for (const one of grant.trades) {
      trades.push({
        feature: feature.id,
        name: one.name ?? feature.name,
        trade: one.id,
        action: one.action,
        spends:
          one.spends.kind === 'pool'
            ? { key: one.spends.key, uses: one.spends.uses }
            : {
                // `spell-slots` never appears on the end that is spent —
                // nothing in the book burns a handful at once — so the only
                // level-less slot here is the one SRD leaves to the caster.
                key:
                  one.spends.kind === 'spell-slot' && one.spends.level !== undefined
                    ? spellSlotKey(one.spends.level)
                    : null,
                uses: 1,
              },
        gains: gainedBy(one.gains),
        // "Half your Wizard level (round up)", read at *that* class's level
        // for the reason every pool's size is: a Wizard 1 / Fighter 4 recovers
        // one level of slots and not three.
        ...(one.gains.kind === 'spell-slots'
          ? {
              combinedLevel: Math.ceil(classLevelFor(choices, feature.id) / 2),
              maxSlotLevel: one.gains.maxLevel,
            }
          : {}),
        limit: one.limit,
        ...(one.moment === undefined ? {} : { moment: one.moment }),
        ...(one.pool === undefined ? {} : { pool: one.pool }),
        ...(one.onlyIfEmpty === undefined ? {} : { onlyIfEmpty: one.onlyIfEmpty }),
      });
    }
  }

  // SRD: the features "don't stack", so the most generous grant wins.
  const attacksPerAction = [...grantsIn(features)].reduce(
    (most, [, grant]) => (grant.kind === 'extra-attack' ? Math.max(most, grant.attacks) : most),
    1,
  );

  // The lowest threshold wins, for the same reason the highest Extra Attack
  // does: SRD restates the whole rule rather than stacking widenings.
  const criticalOn = [...grantsIn(features)].reduce(
    (lowest, [, grant]) => (grant.kind === 'critical-range' ? Math.min(lowest, grant.on) : lowest),
    20,
  );

  // A class's own way of striking. The die is a column of a class table, so it
  // is read at *that class's* level and pinned here — the same treatment
  // `feetByLevel` and a recovery's `diceByLevel` already get, and for the same
  // reason: a Monk 5 / Fighter 5 rolls a d8 rather than a level 10 die.
  const strikeStyles: StrikeStyle[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'strike-style') continue;
    const classLevel = classLevelFor(choices, feature.id);
    const die = grant.dieByLevel?.[Math.max(0, classLevel - 1)];
    strikeStyles.push({
      source: feature.id,
      name: feature.name,
      ...(grant.weapons === undefined ? {} : { weapons: grant.weapons }),
      ...(die === undefined ? {} : { die }),
      ...(grant.ability === undefined ? {} : { ability: grant.ability }),
      ...(grant.bonusUnarmedStrike === true ? { bonusUnarmedStrike: true } : {}),
      ...(grant.whileWieldingOnly === true ? { whileWieldingOnly: true } : {}),
      ...(grant.requires === undefined ? {} : { requires: grant.requires }),
    });
  }

  const alternatives: UnarmoredDefense[] = [];
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'unarmored-defense') continue;
    alternatives.push({
      source: feature.id,
      ability: grant.ability,
      shieldAllowed: grant.shieldAllowed,
    });
  }

  const sheet: CharacterSheet = {
    // SRD: the Proficiency Bonus is "based on your total character level, not
    // your level in a particular class", and the sheet's level is what derives
    // it. A level 3 Fighter / level 2 Rogue has a level 5 character's bonus.
    level: totalLevelOf(choices),
    abilities: scores,
    skills,
    // SRD gives no saving throw proficiencies for a class after the first —
    // but a *feature* may add some, and two do: Slippery Mind names Wisdom and
    // Charisma, Disciplined Survivor names all six. Union, never a count:
    // proficiency is binary, so adding one a character already has is a no-op
    // rather than a doubling, which is the same rule overlapping skill
    // proficiencies already follow.
    saveProficiencies: [
      ...new Set([
        ...definition.saveProficiencies,
        ...[...grantsIn(features)].flatMap(([, grant]) =>
          grant.kind === 'save-proficiency'
            ? grant.abilities === 'all'
              ? [...ABILITIES]
              : grant.abilities
            : [],
        ),
      ]),
    ].sort(),
    armor: worn,
    shield: held,
    armorTraining: trainedArmor(
      combinedArmorTraining(
        definition,
        (choices.multiclass ?? []).flatMap((entry) => {
          const other = content.classById(entry.classId);
          return other === null ? [] : [other];
        }),
      ),
      features,
    ),
    baseSpeed: species.speed,
    // SRD: the starting class grants its weapon proficiencies in full, and a
    // later class grants the subset its "As a Multiclass Character" section
    // prints — which for most of them is nothing at all.
    weaponProficiencies: weaponCategoriesOf(content, choices, definition, features),
    // SRD Unarmored Defense and Draconic Resilience. Gathered from whatever
    // features grant one rather than by naming the three classes that do, so a
    // fourth needs no change here. A character with none carries none, and
    // Armour Class is derived exactly as it was before.
    ...(alternatives.length === 0 ? {} : { unarmoredDefense: alternatives }),
    ...(standing.length === 0 ? {} : { standing }),
    ...(attacksPerAction > 1 ? { attacksPerAction } : {}),
    ...(criticalOn < 20 ? { criticalOn } : {}),
    ...(weaponMasteries.length === 0 ? {} : { weaponMasteries }),
    ...(masterySubstitutions.length === 0 ? {} : { masterySubstitutions }),
    ...(strikeStyles.length === 0 ? {} : { strikeStyles }),
    ...(activated.length === 0 ? {} : { activated }),
    ...(shapeShifts.length === 0 ? {} : { shapeShifts }),
    ...(objectMakers.length === 0 ? {} : { objectMakers }),
    ...(knows.length === 0 ? {} : { knows }),
    ...(reactions.length === 0 ? {} : { reactions }),
    ...(conferredReactions.length === 0 ? {} : { conferredReactions }),
    ...(onDroppingAHostile.length === 0 ? {} : { onDroppingAHostile }),
    ...(recoveries.length === 0 ? {} : { recoveries }),
    ...(trades.length === 0 ? {} : { trades }),
    ...(selfHeals.length === 0 ? {} : { selfHeals }),
    ...(healingTouch.length === 0 ? {} : { healingTouch }),
    ...(poolOptions.length === 0 ? {} : { poolOptions }),
    ...(budgetPurchases.length === 0 ? {} : { budgetPurchases }),
    // SRD Alert's Initiative Swap: a permission rather than a number, so it
    // reaches the sheet as a flag and is absent for everybody who has not been
    // granted it — which is the same shape `attacksPerAction` takes when
    // nothing has widened the Attack action.
    ...(declaresInitiativeSwap(content, choices, features) ? { initiativeSwap: true } : {}),
    ...(castingOptions.length === 0 ? {} : { castingOptions }),
    ...(hitOptions.length === 0 ? {} : { hitOptions }),
    // SRD Trance: "You can finish a Long Rest in 4 hours." The shortest any
    // feature this character holds makes it, because two traits that both
    // shortened it would be two permissions and the holder takes the one that
    // lets them up first. Absent where nobody printed one, which is every
    // character the book says nothing about — and the eight hours `rest.ts`
    // holds for everybody stays exactly where it was.
    ...(longRestSecondsFor(features) === null
      ? {}
      : { longRestSeconds: longRestSecondsFor(features)! }),
    // The *first* casting class's ability, and null for a character who casts
    // nothing. Falling back to the primary ability gave a Fighter a spell save
    // DC off Strength. A multiclassed caster has more than one, and every
    // number that depends on which is derived from the route rather than from
    // here — `spellSaveDcWith` takes the ability it is to use.
    spellcastingAbility: casters[0]?.definition.spellcasting?.ability ?? null,
  };

  const owned = inventoryOf(content, choices, parts);
  if (!owned.ok) return owned;

  // A feat's spells reach usable state here, rather than sitting in a record
  // nothing reads. Magic Initiate brings its own ability and its own free
  // daily casting; the class's prepared list is untouched by it.
  const granted: GrantedSpell[] = [];
  for (const [featureId, feat] of Object.entries(choices.feats)) {
    if (content.featById(feat.featId)?.requires.kind !== 'magic-initiate') continue;
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

  // And the third of the three things that grant a spell: a species or a
  // background trait, on a holder who may cast nothing at all.
  //
  // SRD writes it on four origin traits and every one of them reached nothing
  // before this — `classFeatureSpells` walks a **casting class's** features,
  // so a trait's cantrip was granted to nobody. What it produces is the
  // {@link GrantedSpell} the feat route has always produced: the payment fork,
  // the pool and the report are the ones Magic Initiate already uses.
  granted.push(...originGrantedSpells(choices, originFeatures(choices, parts)));

  // One entry per casting class, each holding that class's own list and its
  // own spellcasting ability. A class that does not cast contributes nothing
  // at all rather than an entry of zeros: a Fighter's primary ability is
  // Strength, and reading it as a spellcasting ability would give them a spell
  // save DC — for spells they cannot cast, off an ability that has nothing to
  // do with magic. A feat's granted spells carry their own ability.
  const book: SpellbookEntry[] = [];
  const classes: SpellcastingClass[] = [];

  for (const caster of casters) {
    const ability = caster.definition.spellcasting?.ability;
    if (ability === undefined) continue;

    // **Partitioned by level, because a cantrip is not a prepared spell.**
    // SRD Divine Order (Thaumaturge) grants "one extra cantrip from the Cleric
    // spell list", and a granted spell filed with the prepared ones would
    // reach `routesFor` as a `prepared` route — a cantrip that costs a slot,
    // which is a price the book never prints. Every other feature that grants
    // spells grants levelled ones and is untouched.
    const granting = classFeatureSpells(content, choices, caster);
    const fromFeatures = granting.filter((id) => (content.spellEntry(id)?.level ?? 1) > 0);
    const grantedCantrips = granting.filter((id) => content.spellEntry(id)?.level === 0);
    const style = caster.definition.spellcasting?.style ?? 'spellbook';

    // And the castings this class's features pay for themselves, on the
    // granting class's own ability. A feat's are above; these are the same
    // shape from the other of the two things that grant a spell.
    granted.push(...classFeatureFreeCastings(content, choices, caster, ability));
    // And the castings its features price at nothing at all — SRD Armor of
    // Shadows. The third price, beside the pool above and the slot below.
    granted.push(...classFeatureAtWillCastings(content, choices, caster, ability));

    if (style === 'spellbook') {
      // SRD Evocation Savant: the free spells join the book, marked as the
      // feature's, and the count rule does not measure them.
      book.push(
        ...caster.spellbook,
        ...fromFeatures.map((spellId) => ({
          spellId,
          acquiredAt: caster.level,
          origin: 'feature' as const,
        })),
      );
    }

    // SRD Life Domain Spells: "you thereafter always have the listed spells
    // prepared" — over and above what the class table allows, so they are added
    // rather than counted against it. A Wizard's feature spells went into the
    // spellbook instead, which is the same grant reaching a different place
    // because the two classes come by their spells differently.
    const alwaysPrepared =
      style === 'spellbook'
        ? []
        : fromFeatures.filter((spellId) => !caster.preparedSpells.includes(spellId));

    classes.push({
      classId: caster.definition.id,
      ability,
      cantrips: [
        ...caster.cantrips,
        ...grantedCantrips.filter((id) => !caster.cantrips.includes(id)),
      ],
      prepared: [...caster.preparedSpells, ...alwaysPrepared],
      slotKind: pactMagic(content, caster.definition.id) ? 'pact' : 'spell',
      // The book, for the one feature that reads it — SRD Ritual Adept casts
      // "any spell ... in your spellbook" as a Ritual, prepared or not.
      ...(style === 'spellbook'
        ? {
            book: [
              ...new Set([...caster.spellbook.map((entry) => entry.spellId), ...fromFeatures]),
            ].sort(),
          }
        : {}),
    });
  }

  const spellcasting: SpellcastingState = { classes, granted };

  const initiativeBonuses = declaredInitiativeBonuses(
    content,
    choices,
    features,
    proficiencyBonusForLevel(choices.level),
  );

  const pools = slotsFor(content, choices);

  return ok({
    sheet,
    proficiencyBonus: proficiencyBonusForLevel(choices.level),
    hitPointMaximum:
      multiclassHitPoints(content, choices, abilityModifier(scores.con)) +
      featureHitPoints(choices, features),
    hitDie: definition.hitDie,
    spellSlots: pools.slots,
    pactSlots: pools.pact,
    spellbook: book,
    inventory: owned.value.items,
    equipped: choices.equipped,
    goldPieces: owned.value.goldPieces,
    // SRD: "You begin with the minimum amount of XP required to reach your
    // starting level."
    experiencePoints: XP_THRESHOLDS[choices.level - 1] ?? 0,
    languages: languagesKnown(content, choices, features),
    alignment: choices.alignment,
    toolProficiencies: tools,
    magicItems: choices.dmGrants?.magicItems ?? [],
    creatureType: species.creatureType,
    size: sized.size,
    features,
    spellcasting,
    initiativeBonuses,
    feats: Object.entries(choices.feats).map(([featureId, feat]) => {
      const definitionOfFeat = content.featById(feat.featId);
      return `${definitionOfFeat?.name ?? feat.featId} (${featureId})`;
    }),
    warnings,
  });
}

/**
 * Everything that adds a number to this character's Initiative, **declared**.
 *
 * SRD Alert prints the benefit under a name: Initiative Proficiency, "When you
 * roll Initiative, you can add your Proficiency Bonus to the roll." This used
 * to be executed by reading that one feat's id, which is inviolable rule 4
 * broken mechanically — a catalogue without the feat lost the rule, and a
 * catalogue that spelled it differently never got it. Now the feat declares
 * `initiative` with `proficiency` and this reads the declaration, so a homebrew feat
 * saying the same thing gets the same bonus with no engine change.
 *
 * **Asked of features as well as feats**, because the grant is a member of the
 * one grant vocabulary and `READABLE_GRANT_KINDS` therefore lets a feature
 * declare it. A kind a feature may declare and no reader answers for is
 * precisely the failure `feature-schema.ts` exists to catch, so the reader
 * covers both holders rather than leaving one silently inert. No SRD class
 * feature declares it today; Feral Instinct's "Advantage on Initiative rolls"
 * is a `roll-mode` and goes down a different road.
 *
 * **Named, and deduplicated by name.** The source is what the log says the
 * number came from and what `rollInitiativeFor` deduplicates a caller's own
 * copy against, so two holders of one name contribute once — the reading a
 * repeatable feat taken twice would otherwise get wrong, and the same rule
 * `bonusesFor` keeps about a source granting twice.
 */
/**
 * Whether anything this character holds lets them swap Initiative.
 *
 * SRD Alert's second printed benefit, read exactly as its first one above is:
 * off the declaration rather than off the feat's id, and asked of features as
 * well as of feats because the grant is a member of the one vocabulary and a
 * homebrew class feature may print the same sentence. The answer is a flag
 * rather than a list because the permission does not stack — two ways to be
 * allowed one swap is still one swap.
 */
function declaresInitiativeSwap(
  content: Content,
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
): boolean {
  const grants = (grant: FeatureGrant | undefined): boolean =>
    grant?.kind === 'initiative' && grant.swap === true;

  if ([...grantsIn(features)].some(([, grant]) => grants(grant))) return true;
  return Object.values(choices.feats).some((feat) =>
    grants(content.featById(feat.featId)?.grants),
  );
}

/**
 * The benefits a **feat** simply has, compiled onto the sheet.
 *
 * The missing half of `FEAT_GRANT_KINDS`, which admits a grant kind only once
 * this file reads it off a feat. A class feature's `standing` grant is
 * compiled by the pass above, against a class table and the choices made on
 * the feature; a feat is not a feature and has neither, so what it may say is
 * the plain sentence — the effects, and what must hold for them.
 * `featStandingProblems` refuses the rest at the door rather than letting a
 * feat declare a field nothing here reads.
 *
 * SRD writes it on the Fighting Style feats: "You gain a +2 bonus to attack
 * rolls you make with Ranged weapons" is a standing effect and nothing more.
 * Read off the declaration rather than off any feat's id, so a homebrew style
 * saying the same thing is compiled by the same lines — which is the whole of
 * what makes this vocabulary rather than a special case.
 *
 * Every feat a character holds is one **taken choice**, so a repeatable feat
 * taken twice is two entries under two feature keys and the effect is compiled
 * under the feat's own id both times. `standingBonuses` keys the best by
 * `feature`, which is the SRD's own same-name rule, so the second copy does
 * not stack — the reading `declaredInitiativeBonuses` already takes of the
 * same arrangement.
 */
function standingFromFeats(
  content: Content,
  choices: CharacterChoices,
): readonly StandingEffect[] {
  const compiled: StandingEffect[] = [];

  for (const taken of Object.values(choices.feats)) {
    const definition = content.featById(taken.featId);
    const grant = definition?.grants;
    if (definition === null || grant?.kind !== 'standing') continue;

    for (const effect of grant.effects ?? []) {
      compiled.push({
        feature: definition.id,
        name: definition.name,
        // A feat belongs to no source that could declare a radius, so its
        // benefit is its holder's own — `featStandingProblems` refuses an
        // aura rather than letting one be granted at nought feet.
        reach: { kind: 'self' },
        grant: effect,
        ...(grant.requires === undefined ? {} : { requires: grant.requires }),
      });
    }
  }

  return compiled;
}

function declaredInitiativeBonuses(
  content: Content,
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
  proficiencyBonus: number,
): readonly { readonly source: string; readonly flat: number }[] {
  const named = new Map<string, number>();

  const declare = (source: string, grant: FeatureGrant | undefined): void => {
    if (grant?.kind !== 'initiative' || grant.proficiency !== true) return;
    named.set(source, proficiencyBonus);
  };

  for (const [feature, grant] of grantsIn(features)) declare(feature.name, grant);
  for (const feat of Object.values(choices.feats)) {
    const definition = content.featById(feat.featId);
    if (definition === null) continue;
    declare(definition.name, definition.grants);
  }

  return [...named].map(([source, flat]) => ({ source, flat }));
}

/**
 * How many uses a feature's pool holds, at the level of the class granting it.
 *
 * SRD prints these as a column of the class table — the Barbarian's Rages —
 * so the count is read at *that class's* level, never the character's. A
 * Barbarian 3 / Fighter 5 rages three times, not six.
 */
/**
 * How big a pool a feature declares is, the three ways the SRD sizes one.
 *
 * A column of the class table, an ability modifier with a floor, or a multiple
 * of the class level — each read at *that class's* own level, which is the
 * same rule the slot tables and Rage's uses already follow and the reason a
 * multiclassed Bard's inspiration does not grow with their Fighter levels.
 */
function poolSizeOf(
  content: Content,
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
  featureId: string,
  grant: {
    readonly usesByLevel?: readonly number[];
    readonly fromAbilityModifier?: Ability;
    readonly minimum?: number;
    readonly perClassLevel?: number;
    readonly perProficiencyBonus?: true;
  },
): number {
  if (grant.usesByLevel !== undefined) return usesOf(choices, featureId, grant.usesByLevel);

  // SRD "a number of times equal to your Proficiency Bonus": the character's,
  // by total level, because that is whose bonus it is — a species trait has
  // no class table and no class level to read one at.
  if (grant.perProficiencyBonus === true) {
    return proficiencyBonusForLevel(totalLevelOf(choices));
  }

  if (grant.perClassLevel !== undefined) {
    return grant.perClassLevel * classLevelFor(choices, featureId);
  }

  if (grant.fromAbilityModifier !== undefined) {
    const scores = finalScores(content, choices, features);
    const modifier = abilityModifier(scores[grant.fromAbilityModifier] ?? 10);
    return Math.max(grant.minimum ?? 0, modifier);
  }

  return grant.minimum ?? 1;
}

/**
 * A reaction grant with its class-table numbers read off.
 *
 * The die is resolved here because two of the nine features name a column
 * rather than a notation — the Bardic Inspiration die is a d6 at Bard 1 and a
 * d12 at 15 — and the ability addends stay symbolic, because a modifier is a
 * number on the sheet at the moment the die is thrown rather than at creation.
 *
 * Returns null when the column has no entry at this level, which is the same
 * answer `healFor` gives and means the feature simply does not apply yet.
 */
function reactionEffectOf(
  does: ReactionGrantEffect,
  level: number,
  className: string,
): ReactionEffect | null {
  const addendsOf = (plus: readonly ('class-level' | Ability)[] | undefined): ReactionAddend[] =>
    (plus ?? []).map((entry) =>
      entry === 'class-level'
        ? // "plus your **Monk** level", so the log names the class rather than
          // printing a bare number nobody can trace.
          ({ kind: 'level' as const, level, label: `${className} level` } as ReactionAddend)
        : ({ kind: 'ability' as const, ability: entry, label: ABILITY_NAMES[entry] } as ReactionAddend),
    );

  const amountOf = (amount: ReactionGrantAmount): ReactionAmount | null => {
    const dice =
      amount.diceByLevel === undefined
        ? amount.dice
        : amount.diceByLevel[Math.max(0, Math.min(level, amount.diceByLevel.length) - 1)];
    if (dice === undefined && amount.halve !== true) return null;

    const plus = addendsOf(amount.plus);
    return {
      ...(dice === undefined ? {} : { dice }),
      ...(plus.length === 0 ? {} : { plus }),
      ...(amount.halve === undefined ? {} : { halve: amount.halve }),
    };
  };

  if (does.kind === 'reduce-damage') {
    const amount = amountOf(does.amount);
    if (amount === null) return null;
    return {
      kind: 'reduce-damage',
      amount,
      ...(does.damageTypes === undefined ? {} : { damageTypes: does.damageTypes }),
      ...(does.fromAttackOnly === undefined ? {} : { fromAttackOnly: does.fromAttackOnly }),
    };
  }

  if (does.kind === 'intervene') {
    const amount = amountOf(does.amount);
    if (amount === null) return null;
    return {
      kind: 'intervene',
      amount,
      direction: does.direction,
      tests: does.tests,
      outcome: does.outcome,
      ...(does.refundedOnFailure === undefined ? {} : { refundedOnFailure: does.refundedOnFailure }),
    };
  }

  if (does.kind === 'reroll') {
    return {
      kind: 'reroll',
      // SRD Indomitable: "reroll it with a bonus equal to your Fighter level".
      ...(does.bonus === undefined
        ? {}
        : { bonus: { kind: 'level' as const, level, label: `${className} level` } }),
      ...(does.tests === undefined ? {} : { tests: does.tests }),
    };
  }

  // SRD Storm's Thunder: "deal 1d8 Thunder damage to that creature". Nothing a
  // class table sizes, so it compiles across unchanged — the dice are the
  // trait's own and the reach is printed.
  if (does.kind === 'damage-back') {
    return {
      kind: 'damage-back',
      dice: does.dice,
      damageType: does.damageType,
      within: does.within,
    };
  }

  return { kind: 'melee-attack', withinFeet: does.withinFeet };
}

/**
 * Which window a Reaction answers, derived from what its effect acts on.
 *
 * **Derived rather than declared beside it**, so the two can never disagree —
 * and so Cutting Words, which answers "a damage roll **or** a success on an
 * ability check or attack roll", is filed under both windows from one grant.
 *
 * One function for the two hosts that build a `ReactionFeature`, the feature's
 * own grant and the one a pool use confers, because a third member added to
 * `ReactionEffect` and filed at one of them would be a Reaction the query
 * could offer and the command could not take.
 */
function reactionWindowOf(resolved: ReactionEffect): FeatureReactionWindow {
  switch (resolved.kind) {
    case 'reduce-damage':
      return 'damage-rolled';
    // Both answers to damage that has **landed**: Retaliation swings back and
    // Storm's Thunder throws dice back, and neither can change the blow that
    // provoked it.
    case 'melee-attack':
    case 'damage-back':
      return 'damaged-by-creature';
    default:
      return 'test-rolled';
  }
}

/**
 * The level a feature's own class table is read at.
 *
 * *That class's* level and not the character's: a multiclassed Bard's
 * inspiration does not grow with their Fighter levels, and a Sorcerer 5 /
 * Fighter 5 gets back half of five rather than half of ten.
 *
 * A feature belonging to no class this character has — a species trait, a
 * background's — falls back to the **character** level, which is the only
 * reading available for one: a species has no table and its own sentences are
 * written in character levels.
 */
function classLevelFor(choices: CharacterChoices, featureId: string): number {
  const namespace = featureId.split(':')[0] ?? '';
  // **A subclass's namespace is its own id, not its class's**, and the
  // fallback made that silently wrong for anybody whose first class was
  // somebody else's: `draconic-sorcery:draconic-resilience` matched no class,
  // fell back to the *starting* class's level, and a Fighter 5 / Sorcerer 3
  // read five Sorcerer levels. The character says which subclass belongs to
  // which class, so the answer is on the choices rather than in the id.
  return (
    classLevelsOf(choices).find(
      (entry) => entry.classId === namespace || entry.subclassId === namespace,
    )?.level ?? totalLevelOf(choices)
  );
}

/**
 * What a trade buys, with the key resolved where the feature names a level.
 *
 * The mirror of what the spent end does two dozen lines above, and it says the
 * same thing: a slot's key carries a level, `spellSlotKey` is the engine's
 * derivation rather than a word a class file spells out, and a level the
 * **caller** picks cannot be resolved until they have. SRD Wild Resurgence
 * gives "a level 1 spell slot" and resolves here; SRD Font of Magic creates a
 * slot off a table and SRD Arcane Recovery a handful inside a budget, and both
 * wait.
 */
function gainedBy(gains: TradedResource): { readonly key: string | null; readonly uses: TradedAmount } {
  if (gains.kind === 'pool') return { key: gains.key, uses: gains.uses };
  if (gains.kind === 'spell-slots') return { key: null, uses: 1 };
  return { key: gains.level === undefined ? null : spellSlotKey(gains.level), uses: 1 };
}

/**
 * One amount's dice, with the count read off a class table.
 *
 * SRD Divine Spark: "Roll 1d8 ... This feature's die changes when you reach
 * certain Cleric levels: 2d8 at level 7". The die *size* is the feature's and
 * the *count* is the table's, which is the split `diceCountByLevel` already
 * makes for Sneak Attack — asked here of an effect's amount rather than of a
 * standing grant's notation.
 *
 * An amount that rolls nothing is left alone: a flat number has no count for a
 * table to move, and inventing one would turn a printed 10 into dice.
 */
const withDiceCountIn = <T extends { readonly dice?: string }>(amount: T, count: number): T =>
  amount.dice === undefined
    ? amount
    : { ...amount, dice: `${count}d${amount.dice.split('d')[1] ?? '6'}` };

/**
 * A feature option's effects with every amount's dice count resolved.
 *
 * The amounts an effect can write, named once: a heal's healing, a pool of
 * Temporary Hit Points, damage under a saving throw and the further types
 * beneath it. Every one of them scales together here, because the class table
 * prints one column and the SRD's sentence is about "this feature's die".
 */
function withDiceCount(
  effects: readonly SpellEffect[],
  count: number,
): readonly SpellEffect[] {
  return effects.map((effect) => {
    switch (effect.kind) {
      case 'heal':
        return { ...effect, healing: withDiceCountIn(effect.healing, count) };
      case 'temp-hp':
        return { ...effect, amount: withDiceCountIn(effect.amount, count) };
      case 'save-damage':
        return {
          ...effect,
          damage: withDiceCountIn(effect.damage, count),
          ...(effect.plus === undefined
            ? {}
            : {
                plus: effect.plus.map((part) => ({
                  ...part,
                  damage: withDiceCountIn(part.damage, count),
                })),
              }),
        };
      default:
        return effect;
    }
  });
}

/**
 * How long a Long Rest takes this character, or null where nothing says.
 *
 * SRD Trance is the only writer the book prints, and the reduction is a
 * permission rather than an obligation — so two of them would be two
 * permissions and the holder takes whichever lets them up first.
 */
function longRestSecondsFor(features: readonly FeatureDefinition[]): number | null {
  let shortest: number | null = null;
  for (const [, grant] of grantsIn(features)) {
    if (grant.kind !== 'long-rest-length') continue;
    shortest = shortest === null ? grant.seconds : Math.min(shortest, grant.seconds);
  }
  return shortest;
}

/**
 * One die's notation with the count an amending feature works out written in.
 *
 * **The sides are read by the parser rather than off the string**, which is the
 * difference between this and a `split('d')`: `parseNotation` lowercases before
 * it matches, so a feature written `D12` is dice the validator accepts and a
 * split would have silently turned into a d8. The one reader of a notation is
 * the one that decides what it says.
 *
 * The eight is a floor under a die the validator has already refused
 * (`bad_dice`), and it stands for the reason `planCharacter`'s size fallback
 * does: this returns a string a damage roll is made from, and `undefined` must
 * not reach one.
 */
const withDiceCountOf = (die: string, count: number): string => {
  const parsed = parseNotation(die);
  return `${Math.max(1, count)}d${parsed.ok ? parsed.value.sides : 8}`;
};

/**
 * The lifetime an activation is written with, in whichever of its two
 * spellings the grant used. Validated content always carries exactly one, so a
 * grant with neither is a programmer error rather than a refusal.
 */
function activationSpanOf(grant: {
  readonly lasts?: TurnAnchor;
  readonly lastsSeconds?: number;
}): ActivationSpan {
  if (grant.lastsSeconds !== undefined) return { kind: 'seconds', seconds: grant.lastsSeconds };
  if (grant.lasts !== undefined) return grant.lasts;
  throw new TypeError('an activated grant runs to a turn anchor or for a printed span');
}

function usesOf(
  choices: CharacterChoices,
  featureId: string,
  usesByLevel: readonly number[] | undefined,
): number {
  if (usesByLevel === undefined) return 1;
  const level = classLevelFor(choices, featureId);
  return usesByLevel[Math.max(0, Math.min(level, usesByLevel.length) - 1)] ?? 0;
}

/**
 * Every spell-slot pool a plan calls for, of both kinds.
 *
 * One function rather than two loops, because creation and advancement must
 * agree about the key, the label and the recovery — and because the recovery
 * is a property of the *pool*, not of the character's starting class. A
 * Warlock 3 / Wizard 3 who read it off the starting class would have every
 * ordinary Wizard slot coming back on a Short Rest.
 */
function slotPools(plan: CharacterPlan): readonly PoolDeclaration[] {
  const pools: PoolDeclaration[] = [];

  for (const [level, count] of Object.entries(plan.spellSlots)) {
    pools.push({
      key: spellSlotKey(Number(level)),
      label: `level ${level} spell slot`,
      max: count,
      recovers: 'long-rest',
    });
  }
  // SRD Pact Magic: "You regain all expended Pact Magic spell slots when you
  // finish a Short or Long Rest."
  for (const [level, count] of Object.entries(plan.pactSlots)) {
    pools.push({
      key: pactSlotKey(Number(level)),
      label: `level ${level} Pact Magic slot`,
      max: count,
      recovers: 'short-rest',
    });
  }

  return pools;
}

/**
 * The pool that holds a feat's free daily casting.
 *
 * SRD Magic Initiate: "You can cast it once without a spell slot, and you
 * regain the ability to cast it in that way when you finish a Long Rest." That
 * is a resource pool like any other, so it is one.
 */
export const freeCastPoolKey = (featureId: string): string => `${featureId}:free-cast`;

/**
 * What a feature's free casting fixes about the casting itself — see
 * `GrantedSpell.fixesChoice` and `keptUntilSummonerLongRests`. Carried
 * across whole; the casting reads them off its route.
 */
const castsAs = (free: {
  readonly fixesChoice?: string;
  readonly keptUntilSummonerLongRests?: true;
}): Pick<GrantedSpell, 'fixesChoice' | 'keptUntilSummonerLongRests'> => ({
  ...(free.fixesChoice === undefined ? {} : { fixesChoice: free.fixesChoice }),
  ...(free.keptUntilSummonerLongRests === undefined ? {} : { keptUntilSummonerLongRests: true }),
});

/**
 * Every condition a healing pool can lift: its own, plus whatever later
 * features add to *that* pool.
 *
 * Exported because it is the only way to reach the half that matters. There is
 * exactly one `lifts-conditions` grant in the SRD — Restoring Touch — so a
 * mutation dropping the pool match changed nothing, and no class can be built
 * that would catch it. The function is pure over a list of features, so a list
 * with two healing pools in it can simply be written.
 */
export function liftsFor(
  features: readonly FeatureDefinition[],
  pool: string,
  base: readonly ConditionName[],
): readonly ConditionName[] {
  const added = [...grantsIn(features)].flatMap(([, grant]) =>
    grant.kind === 'lifts-conditions' && grant.pool === pool ? grant.conditions : [],
  );
  return [...new Set([...base, ...added])].sort();
}

/**
 * The Hit Dice this character has, pooled the way the SRD pools them.
 *
 * SRD Multiclassing: "If these dice are the same die type, you can pool them
 * together... If your classes give you Hit Dice of different types, track them
 * separately." `hitDicePools` has been that derivation, and tested against
 * both of the SRD's own worked examples, since it was written; what was
 * missing was anything calling it. This is the call.
 *
 * Before it, one pool was declared from the **starting** class at that class's
 * level, which is wrong in both directions at once: a Cleric 4 / Fighter 1 had
 * four d8 and no d10 at all, and a Paladin 4 / Fighter 1 — who shares the die
 * — had four d10 where the SRD gives five.
 *
 * A single-class character is untouched, which is the whole compatibility
 * story: one class in, one entry out, at `choices.level`, with the same key
 * and the same label `hitDieKey` and the starting class always produced. Both
 * frozen logs depend on that and `class-pools.test.ts` asserts it directly.
 *
 * The classes are read off `choices` rather than taken beside them, for the
 * same reason `poolsFor` reads the level there: a caller that could hand in a
 * different class list is a caller that could hand in the wrong one.
 */
function hitDiePools(content: Content, choices: CharacterChoices): readonly PoolDeclaration[] {
  const byDie = hitDicePools(
    classLevelsOf(choices),
    (classId) => content.classById(classId)?.hitDie ?? null,
  );

  // Numeric keys iterate in ascending order, so the d8 pool of a Cleric /
  // Paladin always precedes the d10 — the declarations reach the log, so their
  // order has to be a property of the character rather than of the choices.
  return Object.entries(byDie).map(([sides, count]) => ({
    key: hitDieKey(Number(sides)),
    label: `Hit Die (d${sides})`,
    max: count,
    recovers: 'long-rest' as const,
  }));
}

/**
 * What refills a pool, once every feature the character actually holds has
 * been read.
 *
 * A pool's recovery is pinned when the pool is declared, and the SRD prints
 * features that move it later — "you regain all your expended uses ... when
 * you finish a Short Rest", four levels after the pool arrived. The rewrite is
 * declared on the pool and gated on the feature that prints it, so this is the
 * whole of the reading: the character holds that feature or they do not, and
 * the list handed in is already the one their level earned.
 *
 * A feature named here that this source does not print leaves the pool exactly
 * as declared, which is the conservative half — a rewrite nobody granted is a
 * rewrite that has not happened.
 */
function recoveryOf(
  grant: Extract<FeatureGrant, { kind: 'pool' }>,
  features: readonly FeatureDefinition[],
): Recovery {
  const sooner = grant.recoversSooner;
  if (sooner === undefined) return grant.recovers;
  return features.some((feature) => feature.id === sooner.withFeature)
    ? sooner.recovers
    : grant.recovers;
}

/**
 * Every pool a character of these choices has, at the level they are now.
 *
 * **One derivation, two callers.** Creation declares all of them; advancement
 * declares the ones that did not exist and resizes the ones the new level
 * moved. Before this was one function, advancement carried a second list of
 * its own, and that list held two of the seven kinds below — so a Paladin who
 * reached level 4 in play laid on fifteen hit points where the SRD prints
 * twenty, a Sorcerer's Font of Magic never grew, and a Fighter who reached
 * level 9 in play had Indomitable on the sheet and no pool to spend it from.
 * Two lists of pool kinds that have to agree is exactly the shape that bug
 * had, so there is one.
 *
 * The level is read off `choices` rather than passed beside it, for the same
 * reason: a caller that could hand in a different number is a caller that
 * could hand in the wrong one.
 */
function poolsFor(
  content: Content,
  plan: CharacterPlan,
  features: readonly FeatureDefinition[],
  choices: CharacterChoices,
): readonly PoolDeclaration[] {
  const pools: PoolDeclaration[] = [
    ...hitDiePools(content, choices),
    ...slotPools(plan),
  ];

  // The pools a **feature's** free castings come out of, named by the feature
  // rather than by the grant it produced.
  //
  // A feat's pool below is one casting per grant and nothing else could size
  // it; a feature's is the class table's — and a feature may spend a pool it
  // did not declare at all, as Cutting Words spends Bardic Inspiration. So
  // both are excluded from the loop below and the one that declares each is
  // the one that sizes it: the feature's own grant, further down.
  const featurePools = new Set(
    [...grantsIn(features)].flatMap(([, grant]) =>
      grant.kind === 'spells' && grant.freeCasting !== undefined ? [grant.freeCasting.pool] : [],
    ),
  );

  // A feat's free casting is a pool too, one per grant that has one.
  for (const grant of plan.spellcasting.granted) {
    if (grant.freeCastPool === null || featurePools.has(grant.freeCastPool)) continue;
    pools.push({
      key: grant.freeCastPool,
      label: `free casting of ${grant.spellId}`,
      max: 1,
      recovers: 'long-rest',
    });
  }

  // A feature that is its own limited resource declares its pool, sized by the
  // class table at the level it is read at. Arcane Recovery below is the one
  // that still has to be matched by id, because its single use is not a column
  // in any table.
  for (const [feature, grant] of grantsIn(features)) {
    // And an activation that spends a pool it did not print declares nothing,
    // for the reason Cutting Words declares nothing: SRD Sacred Weapon expends
    // a use of the Paladin's Channel Divinity, which the class feature sized.
    if (grant.kind !== 'activated' || grant.pool === null || grant.spendsOnly === true) continue;
    pools.push({
      key: grant.pool,
      label: grant.poolLabel ?? feature.name,
      // Every sizing, not the class-table column alone: SRD Stonecunning's
      // uses are a Proficiency Bonus and SRD Innate Sorcery's a flat two.
      max: poolSizeOf(content, choices, features, feature.id, grant),
      recovers: grant.recovers ?? 'long-rest',
      ...(grant.regainsOnShortRest === undefined
        ? {}
        : { regainsOnShortRest: grant.regainsOnShortRest }),
    });
  }

  // A feature that becomes another creature declares the pool its forms come
  // out of, exactly as an activation does: the same sentence prints both.
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'shape-shift') continue;
    pools.push({
      key: grant.pool,
      label: grant.poolLabel ?? feature.name,
      max: usesOf(choices, feature.id, grant.usesByLevel),
      recovers: grant.recovers ?? 'long-rest',
      ...(grant.regainsOnShortRest === undefined
        ? {}
        : { regainsOnShortRest: grant.regainsOnShortRest }),
    });
  }

  // A feature that *is* a named resource. Nine of these were marked executed
  // on the strength of a note saying the pool existed, and none did.
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'pool') continue;
    pools.push({
      key: grant.key,
      label: grant.label ?? feature.name,
      max: poolSizeOf(content, choices, features, feature.id, grant),
      // A later feature may rewrite this one's recovery, and the character
      // either holds that feature or does not — the same question the level
      // gate already answers, asked of the list it produced. See
      // `FeatureGrant` `pool`'s `recoversSooner`.
      recovers: recoveryOf(grant, features),
      ...(grant.regainsOnShortRest === undefined
        ? {}
        : { regainsOnShortRest: grant.regainsOnShortRest }),
    });
  }

  // A Reaction feature with a limit of its own. Indomitable's "twice before a
  // Long Rest starting at level 13" is a column of the Fighter table, which is
  // a pool; Cutting Words spends Bardic Inspiration, which is somebody else's
  // pool, and declares nothing.
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'reaction' || grant.declares === undefined || grant.pool === undefined) {
      continue;
    }
    pools.push({
      key: grant.pool,
      label: grant.poolLabel ?? feature.name,
      // The same three sizings every other pool uses, read by the same
      // function: Indomitable is a column of the Fighter table, Dark One's
      // Own Luck is a Charisma modifier with a floor.
      max: poolSizeOf(content, choices, features, feature.id, grant.declares),
      recovers: grant.declares.recovers,
    });
  }

  // A feature that pays for a casting out of a pool, where the feature is the
  // one that declares it. Favored Enemy's uses are a column of the Ranger
  // table and Faithful Steed's is the pool of one that "once ... until you
  // finish a Long Rest" always means; Wild Companion spends a use of Wild
  // Shape, declares nothing, and is skipped here for Cutting Words's reason.
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'spells') continue;
    const free = grant.freeCasting;
    if (free?.declares === undefined) continue;
    pools.push({
      key: free.pool,
      label: free.poolLabel ?? `free casting of ${free.spell}`,
      max: poolSizeOf(content, choices, features, feature.id, free.declares),
      recovers: free.declares.recovers,
    });
  }

  // A feature that gives another pool's uses back holds its own limit in a
  // pool of one. "Once you use this feature, you can't do so again until you
  // finish a Long Rest" is exactly what a pool already says, so it is one
  // rather than a second kind of limit sitting beside them.
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'recovery') continue;
    pools.push({
      key: grant.pool,
      label: grant.poolLabel ?? feature.name,
      max: 1,
      recovers: 'long-rest',
    });
  }

  // And a trade with the same clause on it, read the same way: SRD Wild
  // Resurgence's "you can't do so again until you finish a Long Rest" is a
  // pool of one, exactly as the recovery above it is. A trade limited once a
  // turn declares nothing — the turn's own ledger answers for that.
  //
  // **The unlimited arm declares one too, and it is the other sentence.** SRD
  // Holy Nimbus's "you can't use it again until you finish a Long Rest" is the
  // *feature's* own use rather than a limit on the trade, and the trade is
  // what buys it back — so the declaration is identical here and only
  // `tradeResource` tells the two apart, off the limit.
  for (const [feature, grant] of grantsIn(features)) {
    if (grant.kind !== 'trade') continue;
    // The pool the *feature* declares, which is the one its trades run
    // between — Cutting Words's `declares` one grant kind over, and here for
    // the reason it is there: `FeatureGrant` is singular and SRD Font of Magic
    // is one feature that both holds the Sorcery Points and prints the two
    // conversions. Sized off the class table like any other.
    if (grant.pool !== undefined && grant.declares !== undefined) {
      pools.push({
        key: grant.pool,
        label: grant.poolLabel ?? feature.name,
        max: poolSizeOf(content, choices, features, feature.id, grant.declares),
        recovers: grant.declares.recovers,
      });
    }
    for (const one of grant.trades) {
      if (one.pool === undefined) continue;
      pools.push({
        key: one.pool,
        label: one.poolLabel ?? one.name ?? feature.name,
        max: 1,
        recovers: 'long-rest',
      });
    }
  }

  return pools;
}

/**
 * What a character is born wearing, and everything those items carry.
 *
 * **Creation is a second door onto the room `equipItem` opens, and it has to
 * leave the room in the same state.** It cannot call the command: a command
 * takes a `GameState`, and this is producing the events that will make one. So
 * it writes the event itself — and what it must not do is write a *different*
 * event. An item carries three things now, not one: an armour record, standing
 * grants, and a charge pool, and a log that pins only the first pins a fact
 * that was never true of the creature. Since the fold opens no catalogue, that
 * log is wrong for good.
 *
 * The compilers are therefore shared rather than copied — `itemStandingEffects`
 * here and `issueItemCopies` above are what `equipItem` and `purchaseItem`
 * read, so an item that grows a grant tomorrow reaches both doors on the same
 * day.
 *
 * **The charges are not here**, and that is the same agreement rather than a
 * gap in it: a charged item's pool belongs to the copy and is declared when
 * the copy is *gained*, which for a character being created is the
 * `items-gained` above. `equipItem` declares nothing either. What this pins is
 * which copy went into the hand.
 */
function equipEvents(
  content: Content,
  id: CharacterId,
  choices: CharacterChoices,
  owned: readonly InventoryLine[],
): GameEvent[] {
  const events: GameEvent[] = [];
  for (const itemId of choices.equipped) {
    // `checkEquipped` has already refused an id the catalogue does not hold, so
    // a miss here is a caller who skipped the check; it pins nothing rather
    // than throwing, which is what the armour read has always done.
    const item = content.item(itemId);
    const grants = item === null ? [] : itemStandingEffects(item);
    // Which copy is in hand. The first of them, which is a real pick and not
    // an arbitrary one: the copies are identical at birth — each was just
    // issued its record and its pool full — so the only way they differ is
    // which id they carry.
    const copy = owned.find((line) => line.id === itemId && line.instance !== undefined);
    events.push({
      type: 'item-equipped',
      id,
      item: itemId,
      // Pinned, all of it: what the item *is*, what it *grants*, and which
      // copy it is. Omitted when there is nothing, so every mundane equip
      // event is the event it has always been — which is what keeps the
      // frozen logs where they are.
      armor: item?.armor ?? null,
      ...(grants.length === 0 ? {} : { grants }),
      ...(copy?.instance === undefined ? {} : { instance: copy.instance }),
    });
  }
  return events;
}

/** Creation declares the lot; nothing exists yet for any of them to grow from. */
function poolEvents(
  content: Content,
  id: CharacterId,
  plan: CharacterPlan,
  features: readonly FeatureDefinition[],
  choices: CharacterChoices,
): GameEvent[] {
  return poolsFor(content, plan, features, choices).map((pool) => ({
    type: 'resource-pool-declared',
    id,
    pool,
  }));
}

/**
 * Create a character: the creature, its pools, and the choices that made it.
 *
 * **`into` is the state these events are about to be folded into**, and it is
 * needed for one thing: an item copy with state of its own is given an id from
 * a counter on that state, and the fold checks the id is the next one. A
 * character starting with a charged item therefore has to be created against
 * the world it is joining — omit it and the copies are numbered from one,
 * which is right for the empty world every other caller creates into and which
 * the fold refuses loudly rather than silently if it is not.
 *
 * Optional, and last, because it is not what creation is *about*: a character
 * is made out of content and choices, and every caller who starts with rope
 * and a longsword may go on ignoring it.
 */
export function createCharacter(
  content: Content,
  choices: CharacterChoices,
  id: CharacterId,
  into?: GameState,
): Result<GameEvent[]> {
  const plan = planCharacter(content, choices);
  if (!plan.ok) return plan;

  const definition = content.classById(choices.classId);
  if (definition === null) return err('unknown_class', `no class called ${choices.classId}`);

  // The starting kit, split into stacks and copies by the same function a
  // purchase uses, so a wand bought and a wand started with are the same
  // record.
  const kit = issueItemCopies(into?.itemsIssued ?? 0, content, plan.value.inventory);

  return ok([
    {
      type: 'creature-added',
      id,
      name: choices.name,
      sheet: plan.value.sheet,
      maxHp: plan.value.hitPointMaximum,
      creatureType: plan.value.creatureType,
      // What the species prints, pinned like a monster's: the fold opens no
      // catalogue, and until this was here the only way a character's size
      // reached the engine was somebody stating one at the edge of a map.
      size: plan.value.size,
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
    ...(kit.items.length === 0
      ? []
      : [
          {
            type: 'items-gained' as const,
            id,
            items: kit.items,
            source: 'starting equipment',
          },
        ]),
    // The copies' charges, beside the copies they belong to: a wand is born
    // with three charges in it whether or not anybody picks it up.
    ...kit.pools.map((pool) => ({ type: 'resource-pool-declared' as const, id, pool })),
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
    // What a creature wears, and everything those items carry, pinned so it is
    // a fact of the log rather than of whichever catalogue folds it later.
    ...equipEvents(content, id, choices, kit.items),
    ...poolEvents(content, id, plan.value, plan.value.features, choices),
  ]);
}

/** What a level-up asks for, on top of what the character already chose. */
export interface AdvanceChoices {
  /**
   * Which class this level is taken in. Defaults to the starting class.
   *
   * SRD: "you gain a level in a new class whenever you advance in level
   * instead of gaining a level in one of your current classes." A level is
   * always taken in exactly one class, so this names it — the starting class
   * by default, an existing multiclass entry to deepen it, or a class the
   * character has never had, which begins it at level 1.
   */
  readonly classId?: string;
  readonly subclassId?: string;
  /**
   * Spell choices for a class the flat fields below do not describe.
   *
   * The same rule as at creation: with two casting classes, every spell says
   * which class it belongs to. A Wizard/Cleric taking a Cleric level re-states
   * the Cleric's prepared list here, because preparation is per class and the
   * count comes from that class's own table.
   */
  readonly spellsByClass?: Readonly<Record<string, ClassSpellChoices>>;
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
  /**
   * The spellcasting ability a trait gained at this level asks for — and the
   * answer a character made before the question existed.
   *
   * The second is the one that matters in a running campaign: the choices are
   * the character, so a Tiefling stored before their legacy granted anything
   * has no answer on the record and cannot level up until somebody gives one.
   * Patched exactly as {@link featureChoices} is, for that reason.
   */
  readonly featureSpellcasting?: Readonly<Record<string, Ability>>;
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
  content: Content,
  id: CharacterId,
  advance: AdvanceChoices,
): Result<GameEvent[]> {
  const creature = state.creatures[id];
  if (creature === undefined) return needsContext('unknown_creature', `${id} is not in this game`);

  const record = creature.character;
  if (record === null || record === undefined) {
    return err('not_a_character', `${id} was not created from character choices`);
  }

  // SRD: the ceiling is on *character* level, which is the total. A level 3
  // Fighter / level 3 Wizard is a level 6 character with fourteen to go.
  if (totalLevelOf(record.choices) >= MAX_LEVEL) {
    return err('bad_level', `${id} is already level ${MAX_LEVEL}`);
  }

  const into = advance.classId ?? record.choices.classId;
  const taken = levelInto(content, record.choices, into, advance.subclassId);
  if (!taken.ok) return taken;
  const { level, multiclass } = taken.value;

  const choices: CharacterChoices = {
    ...record.choices,
    level,
    ...(multiclass === null ? {} : { multiclass }),
    ...(advance.spellsByClass === undefined
      ? {}
      : {
          spellsByClass: {
            ...(record.choices.spellsByClass ?? {}),
            ...advance.spellsByClass,
          },
        }),
    ...(advance.subclassId === undefined
      ? {}
      : into === record.choices.classId
        ? { subclassId: advance.subclassId }
        : {}),
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
    // Absent where it has always been absent: a record that answered no such
    // question and is given no answer now keeps the shape it was written with,
    // which is the rule every optional field on a stored record follows.
    ...(Object.keys({
      ...record.choices.featureSpellcasting,
      ...(advance.featureSpellcasting ?? {}),
    }).length === 0
      ? {}
      : {
          featureSpellcasting: {
            ...record.choices.featureSpellcasting,
            ...(advance.featureSpellcasting ?? {}),
          },
        }),
    feats: { ...record.choices.feats, ...(advance.feats ?? {}) },
    ...(advance.dmGrants === undefined ? {} : { dmGrants: advance.dmGrants }),
    // What is worn is live state, not a choice made at level 1. A shirt bought
    // and put on in play is on; one taken off is off; and the record the new
    // level stores should say which.
    equipped: creature.equipped.map((held) => held.id),
  };

  return replanCharacter(state, content, id, choices);
}

/**
 * Re-derive a character from a new set of choices and emit only what moved.
 *
 * The body {@link advanceCharacter} has always been, lifted out because a
 * level is not the only thing that changes a character's answers: SRD Circle
 * of the Land chooses a type of land on every Long Rest and SRD Memorize Spell
 * swaps a prepared spell on every Short one, and both are "the choices are the
 * character" read a second time. What a level-up adds is the level; what this
 * does with any set of choices is what a level-up did with the next level's.
 *
 * Nothing here knows about rests, levels or features: it takes the whole
 * `CharacterChoices` the caller has already merged, plans it, and writes the
 * difference against the creature standing in `state`.
 */
function replanCharacter(
  state: GameState,
  content: Content,
  id: CharacterId,
  choices: CharacterChoices,
): Result<GameEvent[]> {
  const creature = state.creatures[id];
  if (creature === undefined) return needsContext('unknown_creature', `${id} is not in this game`);

  const plan = planCharacter(content, choices, creature.inventory);
  if (!plan.ok) return plan;

  const definition = content.classById(choices.classId);
  if (definition === null) return err('unknown_class', `no class called ${choices.classId}`);

  const events: GameEvent[] = [];

  // **The maximum the class table is answerable for, not the one on the
  // sheet.** A hit point maximum is the single number in `GameState` that is
  // folded rather than derived, and a running effect may be holding it up —
  // SRD Aid's five for eight hours. Subtracting the *effective* maximum made
  // the level's own hit points five short, and the five that were missing went
  // away with the spell, so a character who levelled during an Aid was
  // permanently poorer for it. `Vitals.hpMaxAdjustment` is exactly what has to
  // come off first, and the grant that put it there is untouched by any of
  // this: the derived pass adds it back on top of the new level.
  const standing = creature.vitals.hpMax - creature.vitals.hpMaxAdjustment;
  const gained = plan.value.hitPointMaximum - standing;
  if (gained > 0) events.push({ type: 'hit-point-maximum-raised', id, amount: gained });

  // Pools that already exist grow; pools that did not exist are declared; a
  // pool the level left alone says nothing, because a resize to the number
  // already stored is an event that records nothing happening. All three
  // leave what has been spent alone — `resize` changes only the maximum.
  //
  // **Every kind of pool, through the one derivation creation uses.** This
  // used to be a second list naming the Hit Die pool and the spell slots and
  // no other kind, which is why a Fighter who reached level 9 in play had
  // Indomitable on the sheet and nothing to spend.
  //
  // **And every *difference*, not only the size.** A level may move a pool's
  // recovery without touching its maximum — a later feature rewriting an
  // earlier one's rule — and a loop that compared maxima alone said nothing at
  // all for that, so the pool kept a tag `poolsFor` had already stopped
  // deriving. Two ways into one character that disagree is the shape the
  // paragraph above records for Indomitable, one field along.
  for (const pool of poolsFor(content, plan.value, plan.value.features, choices)) {
    const held = creature.resources.pools[pool.key];
    if (held === undefined) {
      events.push({ type: 'resource-pool-declared', id, pool });
      continue;
    }
    if (held.max !== pool.max) {
      events.push({ type: 'resource-pool-resized', id, key: pool.key, max: pool.max });
    }
    if (held.recovers !== pool.recovers) {
      events.push({
        type: 'resource-pool-recovery-changed',
        id,
        key: pool.key,
        recovers: pool.recovers,
      });
    }
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
      // The record's level is the choices' level, which is the one thing
      // `levelInto` already settled: a level taken in another class grows the
      // multiclass entry and leaves this where it was.
      level: choices.level,
      choices,
    },
  });

  return ok(events);
}

/** What a rest may hand back, out of everything a character chose. */
export interface RechoicePatch {
  readonly preparedSpells?: readonly string[];
  readonly spellsByClass?: Readonly<Record<string, ClassSpellChoices>>;
  readonly featureChoices?: Readonly<Record<string, readonly string[]>>;
}

/** The whole of what a re-choice may name, held at run time as well as in the type. */
const RECHOOSABLE: ReadonlySet<string> = new Set([
  'preparedSpells',
  'spellsByClass',
  'featureChoices',
]);

/** Structural equality over the plain JSON a `CharacterChoices` is made of. */
function sameAnswer(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((one, index) => sameAnswer(one, b[index]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameAnswer(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Answer one of a character's questions again, keeping everything else.
 *
 * The same call a level-up makes, minus the level: SRD Circle of the Land
 * Spells and SRD Memorize Spell both hand back an answer the character already
 * gave, and a re-choice is that answer merged in and the character re-planned.
 * `endRest` is its only caller today and decides *which* questions a given
 * rest re-asks; this decides nothing about rests at all, which is what keeps it
 * usable by the next feature that re-asks something.
 *
 * **It refuses anything a re-choice may not name**, at run time and not only in
 * the type: a level, a class, a species and the twenty other fields on
 * `CharacterChoices` are what the character *is*, and a door that quietly
 * accepted one would be a level-up with no level check in front of it.
 *
 * **And an identical patch emits nothing.** A rest taken without changing one's
 * mind is not an event — the record would be re-written to the bytes it already
 * holds, and every log would grow a `character-advanced` per night's sleep.
 */
export function rechooseCharacter(
  state: GameState,
  content: Content,
  id: CharacterId,
  patch: RechoicePatch,
): Result<GameEvent[]> {
  const creature = state.creatures[id];
  if (creature === undefined) return needsContext('unknown_creature', `${id} is not in this game`);

  const record = creature.character;
  if (record === null || record === undefined) {
    return err('not_a_character', `${id} was not created from character choices`);
  }

  for (const key of Object.keys(patch)) {
    if (!RECHOOSABLE.has(key)) {
      return err(
        'not_rechosen',
        `a rest re-asks ${[...RECHOOSABLE].join(', ')}; ${key} is what the character is, and only a level-up changes it`,
      );
    }
  }

  const choices: CharacterChoices = {
    ...record.choices,
    ...(patch.preparedSpells === undefined ? {} : { preparedSpells: patch.preparedSpells }),
    ...(patch.spellsByClass === undefined
      ? {}
      : { spellsByClass: { ...(record.choices.spellsByClass ?? {}), ...patch.spellsByClass } }),
    ...(patch.featureChoices === undefined
      ? {}
      : { featureChoices: { ...record.choices.featureChoices, ...patch.featureChoices } }),
    // What is worn is live state, exactly as it is at a level-up, and for a
    // sharper version of the same reason: a re-plan is checked against the
    // inventory the creature is *holding*, so a shirt sold since the character
    // was made would make the stored list refuse the character — and a rest
    // that refused a Druid a land because they had dropped a shield would be
    // the stale record deciding what the rules allow.
    equipped: creature.equipped.map((held) => held.id),
  };

  if (sameAnswer(choices, record.choices)) return ok([]);

  return replanCharacter(state, content, id, choices);
}

/** One question a feature re-asks, and the rest that re-asks it. */
export interface RestRechoiceOffer {
  readonly feature: string;
  readonly featureName: string;
  readonly rest: RestKind;
  readonly rechooses: RestRechoice;
}

/**
 * The questions this character's features re-ask on a rest.
 *
 * Read off the grants rather than off any list of feature ids, so `endRest` can
 * ask what a rest re-asks without the engine knowing that a Druid exists. The
 * same derivation creation uses, on the same gated feature list, so a feature
 * whose option was not taken re-asks nothing either.
 */
export function restRechoices(
  content: Content,
  choices: CharacterChoices,
): readonly RestRechoiceOffer[] {
  const offers: RestRechoiceOffer[] = [];
  const { parts } = resolveParts(content, choices);
  if (parts === null) return offers;
  for (const [feature, grant] of grantsIn(grantedFeatures(content, choices, parts))) {
    if (grant.kind === 'rechosen-on-a-rest') {
      offers.push({
        feature: feature.id,
        featureName: feature.name,
        rest: grant.rest,
        rechooses: grant.rechooses,
      });
      continue;
    }
    // SRD Elven Lineage's High Elf, whose re-choice is a mark on the grant that
    // prints the cantrip rather than a grant of its own — so the terms of the
    // offer are read off that grant, which is the only place they are written.
    // A grant whose gate was not met is not in this list at all, so a Wood Elf
    // is offered nothing without anything here naming a lineage.
    const rechosen = grant.kind === 'spells' ? grant.rechosenOn : undefined;
    const granted = grant.kind === 'spells' ? (grant.fixed ?? [])[0] : undefined;
    if (rechosen === undefined || granted === undefined) continue;
    offers.push({
      feature: feature.id,
      featureName: feature.name,
      rest: rechosen.rest,
      rechooses: {
        kind: 'granted-spell',
        granted,
        fromClass: rechosen.fromClass,
        maxLevel: rechosen.maxLevel,
      },
    });
  }
  return offers;
}

/**
 * Where the new level goes: the starting class, or one of the others.
 *
 * SRD's framing again — `classId` and `level` stay the starting class, so
 * taking a level of Wizard as a Fighter leaves `level` alone and grows the
 * `multiclass` entry instead. The subclass a *multiclass* entry needs is named
 * on that entry, not on `advance.subclassId`, which belongs to the starting
 * class.
 */
function levelInto(
  content: Content,
  choices: CharacterChoices,
  into: string,
  subclassId: string | undefined,
): Result<{ level: number; multiclass: readonly ClassLevel[] | null }> {
  if (content.classById(into) === null) return err('unknown_class', `no class called ${into}`);

  if (into === choices.classId) {
    return ok({ level: choices.level + 1, multiclass: null });
  }

  const existing = choices.multiclass ?? [];
  const subclass = subclassId === undefined ? {} : { subclassId };
  const already = existing.some((entry) => entry.classId === into);
  const multiclass = already
    ? existing.map((entry) =>
        entry.classId === into ? { ...entry, level: entry.level + 1, ...subclass } : entry,
      )
    : [...existing, { classId: into, level: 1, ...subclass }];

  return ok({ level: choices.level, multiclass });
}

const rollsFor = (current: HitPointChoice, level: number, roll: number): HitPointChoice => {
  const rolls = current.method === 'rolled' ? [...current.rolls] : [];
  rolls[level - 2] = roll;
  return { method: 'rolled', rolls };
};
