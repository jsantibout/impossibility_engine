import { ABILITIES, DAMAGE_TYPES, err, ok, SKILL_ABILITY, SKILLS, type Result } from '@ie/shared';
// The subpath, never the barrel: `@ie/srd` re-exports the parsed book, so
// importing a schema from it loads the catalogue into every process that
// imports the engine. `srd-barrel.test.ts` is the guard.
import { CREATURE_SIZES, MonsterSchema, type Monster } from '@ie/srd/schemas';
import { CONFERRED_LEVEL, itemChargePool, type CatalogueItem } from './catalogue.js';
import { MAX_ABILITY_SCORE } from './character.js';
import {
  abilityGrantProblemsOf,
  abilitySpreadProblems,
  checkFeatureDefinition,
  duplicateFeatureIds,
  parseFeatureDefinition,
  speedGrantProblems,
  weaponSelectorProblems,
  type FeatureContext,
} from './feature-schema.js';
import type {
  AlignmentDefinition,
  BackgroundDefinition,
  FeatDefinition,
  LanguageDefinition,
  SpeciesDefinition,
} from './origins.js';
import {
  MAX_LEVEL,
  type ClassDefinition,
  type FeatureDefinition,
  type FeatureGrant,
  type CastingOptionGrant,
  type PoolOptionGrant,
  type SubclassDefinition,
} from './progression.js';
import { parseNotation } from './dice.js';
import { SEES_THROUGH, type StandingGrant, type StandingRequirement } from './standing.js';
import { SENSE_NAMES } from './positioning.js';
import { dawnRollProblem, type Recovery } from './resources.js';
import { EFFECT_END_CAUSES } from './timers.js';
import type { ActionRule } from './combat.js';
import { TURN_ANCHORS } from './time.js';
import { oneShotProblem, rollSelectorProblems } from './roll-modifiers.js';
import type { ObjectMaterial, ObjectSize } from './objects.js';
import { CREATURE_TYPES } from './spell-definitions.js';
import type { SpellDefinition } from './spell-definitions.js';
import {
  checkActionRule,
  checkEffectValue,
  checkSpellDefinition,
  parseSpellDefinition,
  ROLL_FAMILIES,
} from './spell-schema.js';

/**
 * Content: what exists in a campaign's world, as opposed to how the world works.
 *
 * The engine owns the *mechanics* — the closed vocabularies a spell effect, a
 * class feature or an item can be written in, and the rules that execute
 * them. It owns no spell, no class, no item. Those are **content**, supplied
 * by whoever runs the engine: the SRD 5.2.1 catalogue in `@ie/content`, a
 * DM's homebrew, or both. Every catalogue enters through {@link createContent}
 * (typed) or {@link loadContent} (untyped JSON), and both run the same checks,
 * so the built-in book has no privileged path.
 *
 * A `Content` is a plain immutable value. Commands take it beside the dice
 * (see `Supply`), creation takes it as its first argument, and the fold never
 * reads it at all: a command pins whatever it read into the events it emits,
 * so replaying a log does not depend on which catalogue is loaded today. The
 * one exception is a log written before the engine pinned those facts — see
 * `fold(seed, events, legacy)`.
 */

/**
 * A spell that exists: its identity and who may learn it.
 *
 * Separate from {@link SpellDefinition}, which says what a spell *does*. The
 * SRD prints every spell's identity and the engine executes a subset, so the
 * two are different populations; a homebrew spell supplies both, an entry to
 * put it on a class list and a definition to make it castable.
 */
export interface SpellEntry {
  readonly id: string;
  readonly name: string;
  /** 0 for a cantrip. */
  readonly level: number;
  readonly school: string;
  /** Class ids whose spell list carries it. */
  readonly classes: readonly string[];
  /** As printed: `Action`, `Bonus Action`, `1 minute`. */
  readonly castingTime: string;
  readonly ritual: boolean;
  readonly concentration: boolean;
}

/** Everything a catalogue may contribute. Every field is optional and additive. */
export interface ContentInput {
  readonly spells?: readonly SpellDefinition[];
  readonly spellEntries?: readonly SpellEntry[];
  readonly classes?: readonly ClassDefinition[];
  readonly subclasses?: readonly SubclassDefinition[];
  readonly species?: readonly SpeciesDefinition[];
  readonly backgrounds?: readonly BackgroundDefinition[];
  readonly feats?: readonly FeatDefinition[];
  readonly items?: readonly CatalogueItem[];
  readonly languages?: readonly LanguageDefinition[];
  readonly alignments?: readonly AlignmentDefinition[];
  /**
   * The bestiary: every stat block this world holds.
   *
   * A monster is content on exactly the terms an item is — a catalogue a
   * command looks something up in and pins what it read — so it enters by the
   * same door and there is no second registry to hold it. The vocabulary is
   * `@ie/srd`'s `Monster`, which is what the parser produces and what
   * `adaptMonster` reads; a `MonsterDefinition` of the engine's own would be a
   * twin of it waiting for a second consumer there is none of.
   */
  readonly monsters?: readonly Monster[];
  /**
   * The substances an object can be made of, with the Armour Class each
   * suggests.
   *
   * Content because the SRD's own word for the table is *suggests*, and
   * because a world that holds mithral holds voidsteel on the same terms. See
   * `objects.ts` for the line between this table and the rule beside it: the
   * numbers are here, "objects have Immunity to Poison and Psychic damage" is
   * the engine's.
   */
  readonly objectMaterials?: readonly ObjectMaterial[];
  /**
   * Hit points by size, fragile and resilient, for an object Large or smaller.
   *
   * The SRD stops at Large and says to divide anything bigger into sections,
   * which is the GM's to do — so a missing row is a refusal rather than a
   * number to extrapolate.
   */
  readonly objectSizes?: readonly ObjectSize[];
}

export interface Content {
  readonly spells: readonly SpellDefinition[];
  readonly spellEntries: readonly SpellEntry[];
  readonly classes: readonly ClassDefinition[];
  readonly subclasses: readonly SubclassDefinition[];
  readonly species: readonly SpeciesDefinition[];
  readonly backgrounds: readonly BackgroundDefinition[];
  readonly feats: readonly FeatDefinition[];
  readonly items: readonly CatalogueItem[];
  readonly languages: readonly LanguageDefinition[];
  readonly alignments: readonly AlignmentDefinition[];
  /** See {@link ContentInput.monsters}. */
  readonly monsters: readonly Monster[];
  /** See {@link ContentInput.objectMaterials}. */
  readonly objectMaterials: readonly ObjectMaterial[];
  /** See {@link ContentInput.objectSizes}. */
  readonly objectSizes: readonly ObjectSize[];

  /** The executable definition, or null: the engine can look a spell up but only executes the ones it has been given. */
  readonly spell: (id: string) => SpellDefinition | null;
  /** What exists under this id, whether or not it executes. */
  readonly spellEntry: (id: string) => SpellEntry | null;
  readonly classById: (id: string) => ClassDefinition | null;
  readonly subclassById: (id: string) => SubclassDefinition | null;
  readonly speciesById: (id: string) => SpeciesDefinition | null;
  readonly backgroundById: (id: string) => BackgroundDefinition | null;
  readonly featById: (id: string) => FeatDefinition | null;
  readonly item: (id: string) => CatalogueItem | null;
  /** The stat block, or null: `addCreature` takes the id and this is how it comes by the block. */
  readonly monsterById: (id: string) => Monster | null;
  /** The substance, or null: `declareObject` takes the name a DM said and this is how it comes by the Armour Class. */
  readonly objectMaterial: (id: string) => ObjectMaterial | null;
  /** The Object Hit Points row for a size, or null where the table prints none. */
  readonly objectSize: (size: string) => ObjectSize | null;
  /** By the name written on a character sheet, which is what a choice names. */
  readonly languageNamed: (name: string) => LanguageDefinition | null;
  readonly alignmentNamed: (name: string) => AlignmentDefinition | null;
  /**
   * Everything a pack puts in your hands, the pack itself included.
   *
   * SRD prices a pack as a bundle and lists its contents, so buying one gets
   * you the pack and everything in it. An item that is not a pack is itself.
   */
  readonly expandPack: (id: string) => readonly { readonly id: string; readonly quantity: number }[];
}

/** One thing wrong with a catalogue, and where. */
export interface ContentProblem {
  /** `spells[fireball].effects[0].damage`, `classes[wizard].features[3].note`. */
  readonly field: string;
  readonly code: string;
  readonly reason: string;
}

/**
 * The pools one feature declares, which is what another may spend.
 *
 * The five arms `poolsFor` in `creation.ts` pushes a declaration from, read
 * here so that "this feature spends a pool nobody declares" can be asked at
 * the door. A list rather than a single key because the question is
 * membership, and a feature that declared two would answer for both.
 */
const poolKeysOf = (feature: FeatureDefinition): readonly string[] => {
  const grant = feature.grants;
  if (grant === undefined) return [];
  if (grant.kind === 'pool') return [grant.key];
  if (grant.kind === 'activated' && grant.pool !== null) return [grant.pool];
  if (grant.kind === 'reaction' && grant.declares !== undefined && grant.pool !== undefined) {
    return [grant.pool];
  }
  if (grant.kind === 'recovery') return [grant.pool];
  if (grant.kind === 'spells' && grant.freeCasting?.declares !== undefined) {
    return [grant.freeCasting.pool];
  }
  // The pool a feature's trades run between, where the feature holds it. SRD
  // Font of Magic is the whole of this arm: the Sorcery Points and both
  // conversions are one printed feature, so Metamagic spends a key this grant
  // declares. A trade's *own* `pool` is the pool of one its daily limit lives
  // in, which no other feature has ever named and so is not membership here.
  if (grant.kind === 'trade' && grant.pool !== undefined && grant.declares !== undefined) {
    return [grant.pool];
  }
  return [];
};

/**
 * The `FeatureGrant` kinds the engine's readers execute.
 *
 * A feature that claims `automation: 'engine'` must declare a grant one of
 * the readers discriminates on, or nothing executes it. This is the list as
 * data, for a catalogue validated at runtime; `feature-schema.test.ts` derives
 * the same set from the readers' source and holds the two equal, so a reader
 * added or removed without this line changing fails there.
 */
export const READABLE_GRANT_KINDS: ReadonlySet<string> = new Set([
  'ability-score-increase',
  'activated',
  'casting-options',
  'critical-range',
  'expertise',
  'extra-attack',
  'initiative',
  'lifts-conditions',
  'on-hit',
  'pool',
  'pool-options',
  'reaction',
  'recovery',
  'save-proficiency',
  'spells',
  'standing',
  'strike-style',
  'trade',
  'unarmored-defense',
  'weapon-mastery',
  'widens-reaction',
]);

/**
 * The `FeatureGrant` kinds a **feat** may declare.
 *
 * Narrower than {@link READABLE_GRANT_KINDS}, and the difference is where the
 * grant is read from rather than what it means. A class feature's grant is
 * compiled onto the sheet by a dozen passes in `creation.ts` and evaluated by
 * `standing.ts` on every read; a feat is not a feature and goes through none
 * of that — creation reads a feat's declaration on its own, one kind at a
 * time. So the list is the kinds that reader answers for, and a feat
 * declaring anything else is refused rather than accepted and never executed.
 *
 * The same argument `CONFERRED_EFFECT_KINDS` makes for an item, and it grows
 * the same way: a kind joins this list in the commit that teaches creation to
 * read it off a feat, with the test that proves it arrives.
 */
const FEAT_GRANT_KINDS: ReadonlySet<string> = new Set([
  'initiative',
  // SRD prints the ceiling on a feat and on nothing else: every Epic Boon is
  // "Increase one ability score of your choice by 1, **to a maximum of 30**",
  // and the level 19 class feature says only that you gain one. Read by
  // `abilityPointsFrom` and `abilityMaximums` in `creation.ts`, beside the
  // feature's own.
  'ability-score-increase',
  // A benefit that simply holds, which is the whole of what a Fighting Style
  // feat is: "a +2 bonus to attack rolls you make with Ranged weapons" is a
  // standing effect and nothing else. `standingFromFeats` in `creation.ts`
  // compiles it onto the sheet beside a class feature's, and
  // {@link featStandingProblems} refuses the fields of that grant only a
  // **class table** could answer for — a feat has no table and no level.
  'standing',
]);

/** The optional `FeatureDefinition` fields a reader dereferences — see {@link READABLE_GRANT_KINDS}. */
export const READABLE_FEATURE_FIELDS: ReadonlySet<string> = new Set([
  'choice',
  'grants',
  'grantsFeat',
  'optionMeans',
]);

/**
 * The `StandingGrant` kinds an item may carry, and the one it may not.
 *
 * Exported for the reason {@link READABLE_GRANT_KINDS} is: this is a union in
 * `standing.ts` written out as data, and `content.test.ts` derives the same
 * set from that file and holds the two equal in both directions — so a kind
 * added to the union without this line changing fails there rather than
 * turning every item that uses it into a `bad_item_effect` nobody expected.
 *
 * `speed` is the exception and it is deliberate: `speedOf` gathers Speed from
 * the creature's own sheet alone, because it is the function `has-speed` asks
 * and reading an item's grants there would be a question asked of its own
 * answer. An item granting a Swim Speed is a real SRD item and a real gap;
 * refusing it by name is how the gap stays visible instead of becoming a
 * transcribed item whose benefit silently never applies.
 */
export const ITEM_EFFECT_KINDS: ReadonlySet<string> = new Set([
  'roll-mode',
  'save-bonus',
  'check-bonus',
  'flat-bonus',
  'condition-immunity',
  'damage-resistance',
  'evasion',
  'attack-damage',
  'sense',
  // The one grant beside a sense that the sight question reads, and admitted
  // for the sense's own reason: `seesThroughOf` walks `standingFor`, so a
  // worn item that let its wearer see in Darkness reaches the answer by the
  // route Goggles of Night already take. SRD prints the sentence on an
  // invocation rather than on an item; the list's rule is what a reader
  // reaches, not what the book happens to have written.
  'sees-through',
  'ability-score-set',
  // A rule about the dice a swing throws, on the same test as the three
  // below: the gatherer is `standingDamageEffects`, which walks `standingFor`,
  // and a worn item's grants are already part of that. No SRD item prints the
  // sentence today; the list's rule is what a reader reaches, not what the
  // book happens to have written.
  'attack-die-rule',
  // Read from an item exactly as it is read from a feature: the gatherer is
  // `standingFor`, which folds a worn item's effects in beside a class's, so a
  // staff that empowered its wielder's Evocations would be executed rather than
  // transcribed and ignored. No SRD item prints the sentence today; the list's
  // rule is what a reader reaches, not what the book happens to have written.
  'casting-damage',
  // And the healing half of the same sentence, admitted for the same reason
  // and read by the same gatherer: `castingHealingBonus` walks `standingFor`,
  // which a worn item's grants are already part of.
  'casting-healing',
  // A rule about the action economy, on the same test as the two above: the
  // gatherer is `actionRulesOn`, which reads `standingFor`, so a pair of boots
  // whose wearer may Dash out of a Bonus Action would be executed rather than
  // transcribed and ignored. No SRD item prints the sentence today; the list's
  // rule is what a reader reaches, not what the book happens to have written.
  'action-rule',
]);

/**
 * Every kind of standing benefit there is, for the holders that are not items.
 *
 * Derived rather than restated: it is {@link ITEM_EFFECT_KINDS} plus the one
 * member that list withholds, and `content.test.ts` holds that list equal to
 * the union in `standing.ts` in both directions — so this stays exactly the
 * union without anybody keeping it so. The withheld member is `speed`, and the
 * reason it is withheld from an *item* is the reason it belongs here: `speedOf`
 * gathers Speed from the sheet alone, and a feat's grant is compiled onto the
 * sheet.
 */
export const STANDING_GRANT_KINDS: ReadonlySet<string> = new Set([...ITEM_EFFECT_KINDS, 'speed']);

/**
 * What a feat says about ability scores: the question it asks, the ceiling it
 * lifts, and the level the bracket gates it on.
 *
 * The feat half of the pair `checkFeatureDefinition` already runs on a
 * feature, calling the same two checkers, so the rules are one set of rules
 * with two doors rather than two sets that will drift. What is not shared is
 * the level, because only a feat prints one.
 *
 * Untyped input reaches here as well as typed — `loadContent` parses a blob —
 * so every field is judged rather than believed.
 */
function abilityProblemsOfFeat(feat: FeatDefinition): readonly ContentProblem[] {
  const problems: ContentProblem[] = [];
  const at = `feats[${feat.id}]`;
  const requires: unknown = (feat as { readonly requires?: unknown }).requires;
  const asks =
    typeof requires === 'object' &&
    requires !== null &&
    (requires as { kind?: unknown }).kind === 'ability-score';

  if (asks) {
    const asked = requires as { spreads?: unknown; from?: unknown };
    for (const problem of abilitySpreadProblems(asked.spreads, asked.from, 'requires')) {
      problems.push({ ...problem, field: `${at}.${problem.field}` });
    }
  }

  for (const problem of abilityGrantProblemsOf(feat.grants, asks, feat.id)) {
    problems.push({ ...problem, field: `${at}.${problem.field}` });
  }

  // SRD prints the bracket as a character level — "Prerequisite: Level 4+",
  // "Level 19+" — so a number outside the twenty levels there are gates on a
  // level nobody reaches, in one direction or the other.
  const level: unknown = (feat as { readonly minimumLevel?: unknown }).minimumLevel;
  if (level !== undefined && (!Number.isInteger(level) || (level as number) < 1 || (level as number) > MAX_LEVEL)) {
    problems.push({
      field: `${at}.minimumLevel`,
      code: 'bad_feat_level',
      reason: `a feat's prerequisite is one of the ${MAX_LEVEL} character levels, not ${String(level)}`,
    });
  }

  return problems;
}

/**
 * Everything wrong with an `ability-score-set` grant, wherever one is written.
 *
 * {@link senseProblems}' neighbour and the same argument: the grant reaches
 * the one reader through an item's door and a feature's, so the rule is kept
 * once. The range is {@link MAX_ABILITY_SCORE}, the highest score anything in
 * the rules reaches and the bound `checkAbilities` holds a raw assignment to,
 * and a set that named a seventh ability would silently set nothing.
 */
function abilitySetProblems(
  effect: Record<string, unknown>,
  at: string,
): readonly { readonly code: string; readonly reason: string; readonly field: string }[] {
  const found: { code: string; reason: string; field: string }[] = [];
  const ability = effect['ability'];
  if (!isString(ability) || !(ABILITIES as readonly string[]).includes(ability)) {
    found.push({
      code: 'bad_ability_set',
      reason: `"${String(ability)}" is not one of the six abilities`,
      field: `${at}.ability`,
    });
  }
  const score = effect['score'];
  if (!Number.isInteger(score) || (score as number) < 1 || (score as number) > MAX_ABILITY_SCORE) {
    found.push({
      code: 'bad_ability_set',
      reason: `a score a creature can have is a whole number from 1 to ${MAX_ABILITY_SCORE}, not ${JSON.stringify(score)}`,
      field: `${at}.score`,
    });
  }
  return found;
}

/**
 * Everything wrong with a `sense` grant, wherever one is written.
 *
 * Shared by the two doors a standing grant comes through — an item's and a
 * feature's — because a rule enforced on one of two spellings is a rule with
 * a hole in it, which is the reasoning `item_narrowing_on_a_feature` already
 * states next door. Every field this dereferences is one an untyped blob
 * could have got wrong, so each is judged rather than believed.
 */
function senseProblems(
  effect: Record<string, unknown>,
  at: string,
): readonly { readonly code: string; readonly reason: string; readonly field: string }[] {
  const found: { code: string; reason: string; field: string }[] = [];
  const named = effect['sense'];
  if (!isString(named) || !(SENSE_NAMES as readonly string[]).includes(named)) {
    found.push({
      code: 'bad_sense',
      reason: `"${String(named)}" is not one of the senses the rules glossary defines: ${SENSE_NAMES.join(', ')}`,
      field: `${at}.sense`,
    });
  }
  const feet = effect['feet'];
  if (!Number.isInteger(feet) || (feet as number) < 0) {
    found.push({
      code: 'bad_sense_range',
      reason: `a sense reaches a whole number of feet, not ${JSON.stringify(feet)}`,
      field: `${at}.feet`,
    });
  } else if (feet === 0) {
    // The same failure `bonus_of_nothing` names: a line in the book that
    // silently does nothing at all.
    found.push({
      code: 'sense_of_no_range',
      reason: 'a sense with a range of 0 feet reaches nobody, so nothing would ever read it',
      field: `${at}.feet`,
    });
  }
  return found;
}

/**
 * Everything wrong with a `sees-through` grant, wherever one is written.
 *
 * {@link senseProblems}' argument applied to the grant that sits beside a
 * sense and is not one: both doors write it, so the rule is kept once, and
 * both fields are ones an untyped blob could get wrong. The zero range is the
 * same failure `sense_of_no_range` names — a printed line that reaches nobody
 * and that nothing would ever read.
 */
function seesThroughProblems(
  effect: Record<string, unknown>,
  at: string,
): readonly { readonly code: string; readonly reason: string; readonly field: string }[] {
  const found: { code: string; reason: string; field: string }[] = [];
  const through = effect['through'];
  if (!isString(through) || !(SEES_THROUGH as readonly string[]).includes(through)) {
    found.push({
      code: 'bad_sees_through',
      reason: `"${String(through)}" is not something a creature can be granted sight through: ${SEES_THROUGH.join(', ')}`,
      field: `${at}.through`,
    });
  }
  const feet = effect['feet'];
  if (!Number.isInteger(feet) || (feet as number) <= 0) {
    found.push({
      code: 'bad_sees_through_range',
      reason: `seeing through something reaches a whole number of feet greater than nought, not ${JSON.stringify(feet)}`,
      field: `${at}.feet`,
    });
  }
  return found;
}

/**
 * Everything wrong with a `check-bonus` grant, wherever one is written.
 *
 * {@link senseProblems}' argument on the newest member of the same union: it
 * arrives through an item's door and a feature's, so the rule is kept once.
 * Two things can be written here that nothing downstream could recover from —
 * a bonus over **no** skills, which looks like a bonus to every ability check
 * and is one `standingCheckBonuses` would give on none, and a skill this
 * engine does not have, which is a benefit that could never hold.
 */
function checkBonusProblems(
  effect: Record<string, unknown>,
  at: string,
): readonly { readonly code: string; readonly reason: string; readonly field: string }[] {
  const found: { code: string; reason: string; field: string }[] = [];
  const ability = effect['fromAbility'];
  if (!isString(ability) || !(ABILITIES as readonly string[]).includes(ability)) {
    found.push({
      code: 'bad_check_bonus',
      reason: `"${String(ability)}" is not one of the six abilities`,
      field: `${at}.fromAbility`,
    });
  }
  const minimum = effect['minimum'];
  if (!Number.isInteger(minimum) || (minimum as number) < 0) {
    found.push({
      code: 'bad_check_bonus',
      reason: `SRD's "(minimum of +1)" is a floor of a whole number of points, not ${JSON.stringify(minimum)}`,
      field: `${at}.minimum`,
    });
  }
  const skills = effect['skills'];
  if (!Array.isArray(skills) || skills.length === 0) {
    found.push({
      code: 'bonus_over_no_skills',
      reason:
        'a bonus sized by an ability modifier names the skills it reaches; one that names none would be a bonus to every ability check, which is the sentence a flat bonus writes',
      field: `${at}.skills`,
    });
  } else {
    for (const skill of skills) {
      if (!isString(skill) || !SKILL_NAMES.has(skill)) {
        found.push({
          code: 'unknown_skill',
          reason: `"${String(skill)}" is not a skill this engine knows, so the bonus would never reach a check`,
          field: `${at}.skills`,
        });
      }
    }
  }
  return found;
}

/**
 * Everything wrong with one standing effect declared by something that is
 * **not an item** — a class feature, a species trait, or a feat.
 *
 * Two families of refusal, and the first is the reason the function exists.
 *
 * **What only an item can mean.** `onlyWithItem` is keyed on the id of the
 * thing granting the benefit, and a feature has no copy in anybody's pack, so
 * a feature writing it would grant nothing at all and say nothing about it.
 * Both members that carry the clause are refused — a flat bonus's "made with
 * this magic weapon" and an extra die's "this magic weapon deals" — because a
 * rule enforced on one of two spellings is a rule with a hole in it.
 *
 * **What is judged the same wherever it is written.** A sense's range, an
 * ability-sized bonus's skills, a casting's healing, a set score, a weapon
 * narrowing and a rule about the dice are all checked by the helpers an item's
 * door already calls: the SRD writes several of these on a class feature *and*
 * on an item, and untyped input reaches both.
 *
 * One function for all three holders, so a fourth inherits the whole list the
 * day it compiles rather than the day somebody remembers.
 */
function ownedStandingEffectProblems(
  effect: StandingGrant,
  at: string,
  holder: string,
): readonly { readonly code: string; readonly reason: string; readonly field: string }[] {
  const found: { code: string; reason: string; field: string }[] = [];

  if (
    (effect.kind === 'flat-bonus' || effect.kind === 'attack-damage') &&
    effect.onlyWithItem === true
  ) {
    found.push({
      field: `${at}.onlyWithItem`,
      code: 'item_narrowing_on_a_feature',
      reason: `"made with this item" is read against the id of the item granting it, and ${holder} is not an item, so it would grant nothing`,
    });
  }
  // And the *other* narrowing, which a feature may write and an item may too:
  // it is a description of a weapon rather than a name of one, so nothing
  // about a feature stops it holding — what is checked is that it describes a
  // weapon the equipment tables print, and that the roll it narrows is one
  // somebody makes *with* a weapon.
  if (
    (effect.kind === 'flat-bonus' || effect.kind === 'attack-die-rule') &&
    effect.onlyWithWeapon !== undefined
  ) {
    found.push(...weaponNarrowingProblems(effect.onlyWithWeapon, `${at}.onlyWithWeapon`));
    if (
      effect.kind === 'flat-bonus' &&
      Array.isArray(effect.applies) &&
      effect.applies.some((aimed) => !MADE_WITH_AN_ITEM.has(aimed))
    ) {
      found.push({
        field: `${at}.onlyWithWeapon`,
        code: 'narrowing_without_a_roll',
        reason: `only ${[...MADE_WITH_AN_ITEM].join(' and ')} rolls are made *with* a weapon, so "with weapons like this" could never hold for the rest`,
      });
    }
  }
  if (effect.kind === 'attack-die-rule') {
    found.push(...attackDieRuleProblems(effect as unknown as Record<string, unknown>, at));
  }
  if (effect.kind === 'sense') {
    found.push(...senseProblems(effect as unknown as Record<string, unknown>, at));
  }
  if (effect.kind === 'sees-through') {
    found.push(...seesThroughProblems(effect as unknown as Record<string, unknown>, at));
  }
  if (effect.kind === 'check-bonus') {
    found.push(...checkBonusProblems(effect as unknown as Record<string, unknown>, at));
  }
  if (effect.kind === 'casting-healing') {
    found.push(...castingHealingProblems(effect as unknown as Record<string, unknown>, at));
  }
  if (effect.kind === 'ability-score-set') {
    found.push(...abilitySetProblems(effect as unknown as Record<string, unknown>, at));
  }
  // **The Speed a grant gives, and the one door that would otherwise miss
  // it.** `checkFeatureDefinition` holds a class, a subclass, a species and a
  // background feature to `speedGrantProblems`; a *feat* reaches none of it —
  // `featStandingProblems` is its whole door — so a feat granting a halved
  // Climb Speed validated, compiled onto the sheet and was skipped by
  // `speedOf`, which gathers a grant under `add` and `match-walk` alone. That
  // is the benefit-nothing-reads failure this validator exists for, arriving
  // through the third holder rather than the first two.
  if (effect.kind === 'speed') {
    found.push(...speedGrantProblems(effect as unknown as Record<string, unknown>, at));
  }
  return found;
}

/**
 * Everything wrong with a weapon narrowing, wherever one is written.
 *
 * `WeaponNarrowing` is a *description* of a weapon rather than a list of ids,
 * which is what keeps rule 4 — and the cost of a description is that one
 * naming a category nobody prints matches no weapon at all and says nothing
 * about it. That is the quiet failure this whole validator exists to turn into
 * a refusal at authoring, and the reason `weaponSelectorProblems` is reused
 * rather than restated: a `strike-style` and an `on-hit` rider already hold
 * their selectors to the same three closed sets.
 *
 * Its own function because three doors write the clause — an item's grant, a
 * class feature's, and now a feat's — and a rule enforced at two of three is a
 * rule with a hole in it.
 */
function weaponNarrowingProblems(
  narrowing: unknown,
  at: string,
): readonly { readonly code: string; readonly reason: string; readonly field: string }[] {
  const found: { code: string; reason: string; field: string }[] = [];
  if (!isShape(narrowing)) {
    return [
      {
        code: 'bad_weapon_narrowing',
        reason: 'a weapon narrowing is an object naming the weapons it covers, how they are held, or both',
        field: at,
      },
    ];
  }
  const weapons = narrowing['weapons'];
  if (weapons !== undefined) {
    if (!Array.isArray(weapons) || weapons.length === 0) {
      found.push({
        code: 'bad_weapon_narrowing',
        reason: 'the weapons a narrowing covers are a non-empty list of selectors; one that asks nothing of the weapon omits the field',
        field: `${at}.weapons`,
      });
    } else {
      weapons.forEach((selector, index) => {
        for (const problem of weaponSelectorProblems(
          selector as Parameters<typeof weaponSelectorProblems>[0],
          `${at}.weapons[${index}]`,
        )) {
          found.push({ code: problem.code, reason: problem.reason, field: problem.field });
        }
      });
    }
  }
  const held = narrowing['heldInTwoHands'];
  if (held !== undefined && held !== true) {
    found.push({
      code: 'bad_weapon_narrowing',
      reason: 'SRD\'s "holding it with two hands" is asked or not asked; `false` is a clause that says nothing, so the field is omitted instead',
      field: `${at}.heldInTwoHands`,
    });
  }
  if (weapons === undefined && held === undefined) {
    found.push({
      code: 'bad_weapon_narrowing',
      reason: 'a narrowing that narrows nothing withholds a benefit from nobody; omit the field rather than writing an empty one',
      field: at,
    });
  }
  return found;
}

/**
 * Everything wrong with an `attack-die-rule` grant, wherever one is written.
 *
 * The arm is SRD Great Weapon Fighting's substitution — "treat any 1 or 2 on a
 * damage die as a 3" — and the two numbers are the sentence's own. A
 * replacement no higher than the threshold is a rule that changes nothing, and
 * a threshold of zero reaches no face a die can show: both are benefits that
 * could never hold, which is what this door refuses.
 */
function attackDieRuleProblems(
  effect: Record<string, unknown>,
  at: string,
): readonly { readonly code: string; readonly reason: string; readonly field: string }[] {
  const found: { code: string; reason: string; field: string }[] = [];
  const rule = effect['rule'];
  if (!isShape(rule)) {
    return [
      {
        code: 'bad_die_rule',
        reason: 'a rule about the dice an attack throws is an object saying which kind it is',
        field: `${at}.rule`,
      },
    ];
  }
  if (rule['kind'] !== 'treat-low-rolls-as') {
    found.push({
      code: 'bad_die_rule',
      reason: `"${String(rule['kind'])}" is not a rule this engine reads off a feature; the substitution is the one arm a printed sentence writes`,
      field: `${at}.rule.kind`,
    });
    return found;
  }
  const atMost = rule['atMost'];
  const as = rule['as'];
  if (!Number.isInteger(atMost) || (atMost as number) < 1) {
    found.push({
      code: 'bad_die_rule',
      reason: `SRD's "any 1 or 2" is a face a die can show, not ${JSON.stringify(atMost)}`,
      field: `${at}.rule.atMost`,
    });
  }
  if (!Number.isInteger(as) || (as as number) <= (atMost as number)) {
    found.push({
      code: 'bad_die_rule',
      reason: `SRD's "as a 3" counts a low face as a higher one; ${JSON.stringify(as)} is not higher than ${JSON.stringify(atMost)}, so the rule would change nothing`,
      field: `${at}.rule.as`,
    });
  }
  return found;
}

/**
 * Everything wrong with a `casting-healing` grant, wherever one is written.
 *
 * {@link checkBonusProblems}' neighbour, and the same two doors. One thing can
 * be written here that nothing downstream could recover from: an addition of
 * **nothing at all** — a flat of zero with no slot level to add to it — which
 * is a feature claiming to be executed whose sentence adds no hit point. That
 * is `bonus_of_nothing`'s failure, on the member next door.
 */
function castingHealingProblems(
  effect: Record<string, unknown>,
  at: string,
): readonly { readonly code: string; readonly reason: string; readonly field: string }[] {
  const found: { code: string; reason: string; field: string }[] = [];
  const alters = effect['alters'];
  if (alters === null || typeof alters !== 'object') {
    found.push({
      code: 'bad_casting_healing',
      reason: 'a feature that reaches a casting’s healing says what it does to it',
      field: `${at}.alters`,
    });
    return found;
  }
  const { flat, plusSlotLevel } = alters as { flat?: unknown; plusSlotLevel?: unknown };
  if (!Number.isInteger(flat)) {
    found.push({
      code: 'bad_casting_healing',
      reason: `hit points added to a casting are a whole number, not ${JSON.stringify(flat)}`,
      field: `${at}.alters.flat`,
    });
  } else if (flat === 0 && plusSlotLevel !== true) {
    found.push({
      code: 'healing_of_nothing',
      reason:
        'a feature that adds no hit points and reads no slot level restores nothing, so nothing would ever read it',
      field: `${at}.alters.flat`,
    });
  }
  return found;
}

/**
 * What a flat bonus may be aimed at — `StandingBonusApplies`, written out as
 * data for a catalogue validated at runtime.
 *
 * Exported and held equal to the union by a derived test, for the reason
 * {@link ITEM_EFFECT_KINDS} is: a member added to the type and not to this
 * line would turn every item that used it into a refusal nobody meant, and a
 * member here that the type does not have would be a benefit nothing applies.
 *
 * **`attack` is a weapon attack roll**, and an item whose line says "spell
 * attack rolls" may not be written with it: the member that says that is
 * `a-bonus-to-spell-attack-rolls` and it does not exist yet. See
 * `StandingBonusApplies` for why it is a member of its own rather than a
 * widening of this one.
 */
export const BONUS_APPLIES: ReadonlySet<string> = new Set([
  'attack',
  'save',
  'ability-check',
  'ac',
  'damage',
]);

/**
 * The two a roll can be *made with*, and so the two a narrowing may name.
 *
 * SRD Weapon, +1 writes "attack rolls and damage rolls made with this magic
 * weapon" and stops there, because there is nothing else an object is used to
 * gain: an Armour Class and a saving throw are had rather than made.
 */
const MADE_WITH_AN_ITEM: ReadonlySet<string> = new Set(['attack', 'damage']);

/**
 * What an item's standing grant may require: every member of the union, held
 * equal to it by the same derived test {@link ITEM_EFFECT_KINDS} answers to.
 */
export const REQUIREMENT_KINDS: ReadonlySet<string> = new Set([
  'not-incapacitated',
  'feature-active',
  'has-speed',
  'not-wearing-heavy-armor',
  'unarmored',
  'while-attuned',
  'while-worn',
  // Where the holder is standing and how bright it is there, read on every
  // question through `lightAt` — the same derivation `has-speed` makes of a
  // Speed. An item that printed SRD Sunlight Sensitivity's sentence would be
  // executed rather than transcribed and ignored.
  'in-sunlight',
  // The other end of the same scale, read through the same `lightAt`, and the
  // creature's own hit points against its own maximum. Both are here for
  // `in-sunlight`'s reason: an item whose first clause is "while you are in
  // Dim Light" or "while you are Bloodied" is a sentence this vocabulary can
  // execute, and the set is held equal to the union rather than curated.
  'in-dim-light-or-darkness',
  'while-bloodied',
]);

/**
 * The two requirements only an item can meet.
 *
 * Both are looked up by the *item's* id, which a class feature does not have —
 * so a feature carrying one would name no item, never hold, and grant nothing
 * while looking perfectly well-formed.
 */
const ITEM_ONLY_REQUIREMENTS: ReadonlySet<string> = new Set(['while-attuned', 'while-worn']);

/** The four things a pool may recover on — `Recovery`, written out as data. */
const RECOVERIES: ReadonlySet<string> = new Set<Recovery>([
  'short-rest',
  'long-rest',
  'dawn',
  'special',
]);

/**
 * What an item's charge pool has to say, and what it may not.
 *
 * Charges are the pool mechanism reused, so this judges the same shape a class
 * feature declares a pool in — with the three class-table sizings ruled out,
 * because an item has no class level and no ability score and `poolSizeOf`
 * would read a number that is not there. A flat `uses` is how the SRD prints
 * an item's charges and is therefore required.
 */
function itemPoolProblems(
  item: CatalogueItem,
  grant: Extract<FeatureGrant, { kind: 'pool' }>,
  at: string,
): readonly ContentProblem[] {
  const found: ContentProblem[] = [];
  const say = (code: string, reason: string, field: string): void => {
    found.push({ field, code, reason });
  };

  for (const field of ['usesByLevel', 'perClassLevel', 'fromAbilityModifier', 'minimum'] as const) {
    if (grant[field] !== undefined) {
      say(
        'item_grant_reads_a_level',
        `an item has no class level and no ability scores, so ${field} would never size its charges`,
        `${at}.${field}`,
      );
    }
  }
  // A recovery a later feature rewrites is a class table's step, and an item
  // has no feature list for the gate to read: `recoveryOf` in `creation.ts`
  // asks whether the character holds the feature named, and the answer for a
  // wand's charges is that nothing ever asks. Refused for the reason the four
  // sizings above are — a field this host could never apply is a rule the
  // writer believes is in force.
  if (grant.recoversSooner !== undefined) {
    say(
      'item_grant_reads_a_level',
      "an item's charges are not a class feature's pool, so a later feature has no table here to step and recoversSooner would never be read",
      `${at}.recoversSooner`,
    );
  }
  // Both hang a *feature's* payout off the pool — hit points for its holder,
  // and a touch that lifts conditions — and nothing runs either from an item.
  for (const field of ['heals', 'touchHeals'] as const) {
    if (grant[field] !== undefined) {
      say(
        'item_pool_not_read',
        `nothing spends an item's charges on ${field} yet; this pool's charges are spent by expendCharges and nothing else`,
        `${at}.${field}`,
      );
    }
  }
  // And the third thing a use of a *feature's* pool buys, refused for the
  // sharper half of the same reason: what pays for an option is a pool use
  // `usePoolOption` spends, and what its numbers come from is a sheet. An
  // item's charges are spent by `expendCharges`, and what a charge buys is the
  // item's own `casts` or `confers` grant — the mirror of
  // `item_sizing_on_a_feature`, in the other direction.
  if (grant.options !== undefined) {
    say(
      'feature_options_on_an_item',
      `a menu of options is what a feature's pool use buys, priced in uses and rolled against its holder's sheet, and ${item.id} is not a feature; what a charge buys is the item's own "casts" or "confers" grant`,
      `${at}.options`,
    );
  }

  if (!isString(grant.key) || grant.key.trim() === '') {
    say('bad_pool_key', 'a pool is found by its key, and a blank one finds nothing', `${at}.key`);
  }
  // Two sizings, and exactly one of them. The book prints a number on most
  // items' lines and rolls for a few — "A necklace has 1d6 + 3 beads" — so a
  // pool that names neither is sized by nothing and a pool that names both is
  // sized twice, which is a choice nothing downstream could make.
  const rolled: unknown = grant.usesRolled;
  if (rolled !== undefined) {
    if (grant.uses !== undefined) {
      say(
        'item_pool_sized_twice',
        `${item.id} prints a charge count and rolls for one; an item's line does one or the other`,
        `${at}.usesRolled`,
      );
    }
    // The same reading `regainsAtDawn` is held to, by the same parser: dice,
    // and never a stated number, which is what `uses` is for.
    if (!isString(rolled) || !parseNotation(rolled).ok) {
      say(
        'bad_rolled_uses',
        `"${String(rolled)}" is not dice a charge maximum can be rolled from; a printed count is "uses"`,
        `${at}.usesRolled`,
      );
    }
  } else if (!Number.isInteger(grant.uses) || (grant.uses ?? 0) < 1) {
    say(
      'item_pool_without_uses',
      `${item.id} declares charges without saying how many; the SRD prints a number on the item's own line, or dice to roll one from`,
      `${at}.uses`,
    );
  }
  if (!RECOVERIES.has(grant.recovers)) {
    say('bad_recovery', `"${String(grant.recovers)}" is not something a pool recovers on`, `${at}.recovers`);
  } else {
    // The same question `declarePool` asks, asked by the same function, so a
    // catalogue cannot hold a pool the fold would throw on.
    const dawn = dawnRollProblem(grant.regainsAtDawn, grant.recovers);
    if (dawn !== null) say(dawn.code, dawn.reason, `${at}.regainsAtDawn`);
  }

  return found;
}

/**
 * Whether what an item declares it does *not* do is readable.
 *
 * The same two rules `checkSpellDefinition` makes about the same field, in the
 * same words, because it is the same field: a note that is not a list of
 * strings is honesty nothing can read, and an empty one declares nothing.
 * `undefined` is absent — the answer for everything mundane — and every other
 * value is judged against the declared type, `null` included, which is the
 * rule this validator keeps for every optional field.
 *
 * Nothing here asks whether the notes are *enough*. Whether a transcription
 * left out more than it admits is a question about the SRD's text, which is
 * the catalogue's own business and is answered where the text is: this only
 * refuses a note that could never be read aloud.
 */
function itemUnmodelledProblems(item: CatalogueItem): readonly ContentProblem[] {
  if (item.unmodelled === undefined) return [];
  const where = `items[${item.id}].unmodelled`;
  if (!Array.isArray(item.unmodelled)) {
    return [
      {
        field: where,
        code: 'bad_unmodelled',
        reason: 'what an item declares it does not do is a list of notes',
      },
    ];
  }
  const found: ContentProblem[] = [];
  item.unmodelled.forEach((note, index) => {
    if (!isString(note) || note.trim().length === 0) {
      found.push({
        field: `${where}[${index}]`,
        code: 'empty_note',
        reason: 'an empty note declares nothing',
      });
    }
  });
  return found;
}

/**
 * What an item's `casts` grant has to say, and what it may not.
 *
 * SRD "Spells Cast from Items" decides all of it. The spell has to be one the
 * catalogue can actually execute, because the whole point of the grant is that
 * the casting runs down the ordinary pipeline; the charges have to come out of
 * a pool the item declares, because "expend 1 charge" is the item's own
 * economy and `resources.ts` is where it lives; and the charge range has to
 * make sense, because "no more than 3 charges" is a maximum above a minimum
 * rather than an invitation to spend nothing.
 *
 * **Two grants naming one spell is refused**, because two prices for one
 * casting is a choice nothing could make: `itemCasting` reads the first, and
 * an item whose second line silently never applied is exactly the failure
 * `unmodelled` exists to prevent.
 */
function itemCastsProblems(
  item: CatalogueItem,
  grant: Extract<FeatureGrant, { kind: 'casts' }>,
  at: string,
  spellExists: (id: string) => boolean,
  seen: Set<string>,
): readonly ContentProblem[] {
  const found: ContentProblem[] = [];
  const say = (code: string, reason: string, field: string): void => {
    found.push({ field, code, reason });
  };

  if (!isString(grant.spell) || grant.spell.trim() === '') {
    say('bad_item_spell', 'an item that casts a spell names which', `${at}.spell`);
  } else if (!spellExists(grant.spell)) {
    say(
      'unknown_spell',
      `${item.id} casts ${grant.spell}, which this content has no executable definition of`,
      `${at}.spell`,
    );
  } else if (seen.has(grant.spell)) {
    say(
      'two_item_castings',
      `${item.id} casts ${grant.spell} twice, and two prices for one casting is a choice nothing can make`,
      `${at}.spell`,
    );
  } else {
    seen.add(grant.spell);
  }

  // **What the casting costs, and the one item that may answer "nothing".**
  //
  // SRD Helm of Comprehending Languages prints no charge count, no per-dawn
  // sentence and no other limit, so `atWill` is the licence to be free — and
  // it is a *licence*, declared, rather than an absence read as one. A grant
  // that names neither is refused, because a dropped field and a free casting
  // would otherwise be the same record; a grant that names both is refused,
  // because an item prices its casting once.
  const atWill = grant.atWill === true;
  if (atWill && grant.charges !== undefined) {
    say(
      'at_will_and_a_price',
      `${item.id} casts ${String(grant.spell)} at will and for ${String(grant.charges)} charges, and an item's line prices a casting once`,
      `${at}.atWill`,
    );
  } else if (!atWill && grant.charges === undefined) {
    say(
      'casts_for_no_price',
      `${item.id} casts ${String(grant.spell)} and says neither what it costs nor that the book charges nothing for it; an item whose line prints no limit says so with "atWill"`,
      `${at}.charges`,
    );
  } else if (!atWill && (!Number.isInteger(grant.charges) || (grant.charges ?? 0) < 1)) {
    say(
      'bad_charge_cost',
      `the SRD prints what a casting from an item costs on the item's own line, and ${item.id} names ${String(grant.charges)}`,
      `${at}.charges`,
    );
  }
  if (grant.upToCharges !== undefined) {
    if (atWill) {
      say(
        'at_will_and_a_charge_range',
        `"no more than N charges" is a range of prices, and ${item.id} casts ${String(grant.spell)} for none`,
        `${at}.upToCharges`,
      );
    } else if (!Number.isInteger(grant.upToCharges) || grant.upToCharges <= (grant.charges ?? 0)) {
      say(
        'bad_charge_range',
        `"no more than N charges" is a maximum above the cost, and ${item.id} names ${String(grant.upToCharges)}`,
        `${at}.upToCharges`,
      );
    }
  }
  if (grant.level !== undefined && (!Number.isInteger(grant.level) || grant.level < 0 || grant.level > 9)) {
    say('bad_level', `a spell's level runs from 0 to 9, got ${String(grant.level)}`, `${at}.level`);
  }
  for (const field of ['saveDc', 'attackBonus'] as const) {
    const printed = grant[field];
    if (printed !== undefined && !Number.isInteger(printed)) {
      say('bad_printed_number', `${field} is the number the item's line prints`, `${at}.${field}`);
    }
  }

  // **A use that can fail, and the count behind the chance.**
  //
  // SRD Wind Fan: "Each subsequent time the fan is used before the next dawn,
  // it has a cumulative 20 percent chance of not working; if the fan fails to
  // work, it tears into useless, nonmagical tatters." Three fields and a rule
  // for each: a percentage a die can be rolled against, a key to count the
  // uses under, and what failing costs — which is stated rather than assumed,
  // because an item that failed and stayed whole would be a better item than
  // the book prints.
  const failing = grant.failsCumulatively;
  if (failing !== undefined) {
    if (!Number.isInteger(failing.percent) || failing.percent < 1 || failing.percent > 100) {
      say(
        'bad_failure_chance',
        `a cumulative chance of not working is a percentage from 1 to 100, and ${item.id} names ${String(failing.percent)}`,
        `${at}.failsCumulatively.percent`,
      );
    }
    if (!isString(failing.key) || failing.key.trim() === '') {
      say(
        'bad_failure_key',
        `${item.id} counts the uses behind its chance of failing, and names nothing to count them under`,
        `${at}.failsCumulatively.key`,
      );
    } else if (itemChargePool(item)?.key === failing.key) {
      // One name never means two things: the fold spends a pool and counts a
      // tally, and a key that is both is a log it cannot read either way.
      say(
        'failure_key_is_a_pool',
        `${item.id} counts its uses under ${failing.key}, which is also its charge pool; a count of uses and a pool of charges cannot share a name`,
        `${at}.failsCumulatively.key`,
      );
    }
    if (failing.destroyed !== true) {
      say(
        'failure_costs_nothing',
        `${item.id} can fail to work and says nothing about what that costs; the SRD's one such item tears into tatters, and a failure with no consequence is a better item than the book prints`,
        `${at}.failsCumulatively.destroyed`,
      );
    }
  }

  // The charges come out of the item's own pool, which is the mechanism
  // `resources.ts` named "a magic item with seven charges" on the day it was
  // written. An item that casts for a price and declares no pool has an
  // economy with nothing behind it, and `itemRoute` would refuse every casting.
  //
  // **Asked only of a casting that has a price.** An at-will casting spends
  // nothing, so there is nothing for a pool to be behind, and requiring one
  // would put a limit on the page that the page does not print.
  if (!atWill && itemChargePool(item) === null) {
    say(
      'casts_without_charges',
      `${item.id} casts ${String(grant.spell)} for charges and declares no charge pool for them to come out of`,
      `${at}.charges`,
    );
  }

  return found;
}

/**
 * The effect kinds an item may confer **without casting a spell**, as data.
 *
 * Two rules decide the list, and both are about what a casting has that an
 * item's conferral does not:
 *
 * - **A casting id.** `dispel` and `interrupt-casting` read a casting from
 *   both ends, and `teleport`'s destination is stated at a casting.
 * - **An attack modifier nobody printed.** `attack` is refused by name, and so
 *   is `attack-damage`, which rides on an attack this is not.
 *
 * **A saving throw is not on that list any more.** SRD writes the DC as the
 * *item's* own clause — Wand of Fireballs' "(save DC 15)" — so `saveDc` on the
 * grant is a number the item printed and `save-damage` resolves against it
 * through the resolver a casting uses.
 *
 * **Nor is a condition any more.** SRD Potion of Invisibility confers one with
 * nothing cast at all, and what it is filed under is `item:<id>` — a source
 * `castingIdOf` answers null for, so `releaseCasting`, `releaseOnTarget` and
 * the Dispel resolver pass over it by construction. What ends it is the
 * condition's own timer, whose deadline is the conferral's `durationSeconds`
 * and whose `endsEarly` is the item's printed sentence. The rider fields that
 * would need a casting are refused one by one below, which is why admitting
 * the kind admits no casting with it.
 *
 * **Nor is `save`, which was the last of that weld.** Its `condition` is a
 * required field and its `repeats` is the repeat save that goes with one, and
 * a `PendingSave` now names the **source** rather than a casting id — so a
 * condition a flask's saving throw imposes repeats its save at the boundary
 * like a spell's, and a success ends it on the timer the conferral's own hour
 * filed. The flat fields that still need a casting are refused one by one
 * below, `repeats`' `end-casting` among them, which is why admitting the kind
 * admits no casting with it.
 */
const CONFERRED_EFFECT_KINDS: ReadonlySet<string> = new Set([
  'heal',
  'temp-hp',
  'save-damage',
  'save',
  'condition',
  'end-condition',
  'buff',
  'roll-mode',
  'armor-class',
  'damage-defense',
  'speed',
  'attack-rider',
  'condition-immunity',
  'turn-payout',
]);

/**
 * The conferred kinds that **hang a sourced grant** on somebody.
 *
 * The eight families `grantsOf` enumerates, which is the same list
 * `commands/spell-effect-grants.ts` resolves. The question this set answers is
 * one a conferral has to answer and a casting does not: a casting's grant ends
 * when the casting does, and there is no casting here — so an item that hangs
 * one of these says for how long, and an item that hangs none of them may not.
 */
const CONFERRED_GRANT_KINDS: ReadonlySet<string> = new Set([
  'buff',
  'roll-mode',
  'armor-class',
  'damage-defense',
  'speed',
  'attack-rider',
  'condition-immunity',
  'turn-payout',
]);

/**
 * The `DiceScaling` fields that read a level nothing here has.
 *
 * A conferral resolves at {@link CONFERRED_LEVEL} with no slot and no caster,
 * so every one of these would quietly come to nothing. Refused by name,
 * because a printed number that never applies is what `unmodelled` exists to
 * prevent, one field lower down.
 */
const SCALES_WITH_A_CASTING: readonly string[] = [
  'perSlotLevelAbove',
  'flatPerSlotLevelAbove',
  'cantripUpgradesAt',
];

/** Where an admitted effect kind writes its dice, for the rule above. */
const scalingFieldOf = (kind: unknown): string | null =>
  kind === 'heal'
    ? 'healing'
    : kind === 'temp-hp'
      ? 'amount'
      : kind === 'save-damage'
        ? 'damage'
        : null;

/**
 * Every amount an admitted effect writes down, with the path each is at.
 *
 * One kind writes more than one: `save-damage` carries its own amount and a
 * `plus` list of further types under the same saving throw, and each of them
 * scales on its own.
 */
function scalingsOf(
  record: Record<string, unknown>,
  on: string,
): readonly (readonly [string, Record<string, unknown>])[] {
  const found: (readonly [string, Record<string, unknown>])[] = [];
  const field = scalingFieldOf(record['kind']);
  const own = field === null ? undefined : record[field];
  if (field !== null && typeof own === 'object' && own !== null) {
    found.push([`${on}.${field}`, own as Record<string, unknown>]);
  }
  const plus = record['plus'];
  if (Array.isArray(plus)) {
    plus.forEach((part, index) => {
      const amount = (part as Record<string, unknown> | null)?.['damage'];
      if (typeof amount === 'object' && amount !== null) {
        found.push([`${on}.plus[${index}].damage`, amount as Record<string, unknown>]);
      }
    });
  }
  return found;
}

/**
 * The effect kinds that roll a saving throw, and therefore need a DC.
 *
 * `save-damage` is one by construction; a `buff` is one only when it names an
 * `ability`, because that field is what makes it Bane's shape rather than
 * Bless's. Both reach `EffectContext.saveDc`, which is where the item's
 * printed number arrives.
 */
const rollsASave = (record: Record<string, unknown>): boolean =>
  record['kind'] === 'save-damage' ||
  record['kind'] === 'save' ||
  (record['kind'] === 'buff' && record['ability'] !== undefined);

/**
 * The four riders, which every one of them needs a casting for.
 *
 * A condition instance is welded to a casting in the fold, a granted modifier
 * carries the casting as its source, and a `damage-scheduled` names the
 * casting that promised it. `applyRiders` reaches for all three through
 * `EffectContext.casting`, which a conferral has none of.
 *
 * **The shove is the fourth, and it needs a casting for a different reason
 * from the other three.** Nothing about a push is welded to a casting id: it
 * writes one `creature-moved` and is over. What it needs is the road, and the
 * road is `applyRiders` — which only the casting arm of the two rolling
 * resolvers takes. Their conferral arms hand back the conditions a failure
 * imposed and nothing else, so a bottle or a pool use carrying this field
 * would carry one nothing would read. It lifts on the day a conferral executes
 * one, and the sentence that will want it is a feature's rather than an
 * item's: SRD Open Hand Technique pushes a failed saver fifteen feet.
 */
const RIDER_FIELDS: readonly string[] = ['conditions', 'modifiers', 'delayed', 'movement'];

/**
 * The field that says a save's verdict is kept, which needs a casting to keep
 * it on.
 *
 * `save.recordsOutcome` writes the answer onto `OngoingSpell.saves` — the
 * record of a *running casting*. An item's conferral and a feature's pool use
 * have no casting id, no ongoing record and nothing for `observe()` to publish
 * the verdict from, so the field would be set and read by nobody: the silent
 * wrong answer this file exists to refuse.
 *
 * Named rather than inlined so the two hosts refuse one spelling, in the shape
 * {@link RIDER_FIELDS} already uses beside it.
 */
const RECORDED_VERDICT = 'recordsOutcome';

/**
 * The admitted kinds whose `conditions` is **their own required list**.
 *
 * Two rules met here and contradicted each other. `CONFERRED_EFFECT_KINDS`
 * admits `condition-immunity` — SRD writes "has Immunity to the Charmed
 * condition" on items as readily as on spells — and the rule above refuses any
 * conferred effect carrying a field called `conditions`, because an
 * {@link OutcomeRiders} `conditions` is a list of {@link ConditionRider}s
 * welded to the casting that hung it. But `conditions` is also the name of
 * `condition-immunity`'s required list, the one saying what the creature is
 * immune *to*, and of `end-condition`'s, the one saying what it lifts. So the
 * one Immunity a potion wanted was refused by a rule that was never about it.
 *
 * Fixed by making the refusal about the rider rather than about the spelling.
 * Both kinds are leaves — neither can host a rider at all, which is what their
 * own docstrings in `spell-definitions.ts` say and what the type says — so on
 * these two the field is the kind's own and the rider rule has nothing to
 * refuse. `modifiers` and `delayed` are untouched: no admitted kind spells
 * either of those as something of its own.
 *
 * Read after `checkEffectValue` has passed, which is what makes a list of
 * kinds honest here: by then the effect is known to be well formed for the
 * kind it says it is, so the name of the field really does mean what that
 * kind's declaration says it means.
 */
const CONDITIONS_IS_THE_KINDS_OWN: ReadonlySet<string> = new Set([
  'condition-immunity',
  'end-condition',
]);

/**
 * What a {@link ConditionRider} can say that a conferral has no casting for.
 *
 * The `condition` kind is conferrable — SRD Potion of Invisibility — and what
 * makes that safe is that none of these arrives with it:
 *
 * | Field | What it needs |
 * |---|---|
 * | `lasts` | a lifetime the *casting* owns; a conferral's is `durationSeconds`, on the grant |
 * | `check` | an escape whose `effect-check-resolved` releases the casting the instance names |
 * | `outlivesCasting` | a mark that says the casting does not keep it, on a thing with no casting |
 *
 * **`repeats` is the fourth and is not here, because on a `condition` it is
 * already refused one step earlier and for a better reason.**
 * `checkEffectValue` answers `repeats_without_save` for *every* `condition`
 * host, cast or conferred: SRD writes "the target repeats **the** save" and
 * this kind rolled none. A second refusal of the same field would report two
 * codes for one defect, and the one that fires first names the rule the
 * author actually broke.
 *
 * **On a `save` it is admitted**, because that host did roll one: a
 * `PendingSave` names the source rather than a casting id, so a flask's
 * condition repeats its save at the boundary and a success ends it on the
 * conferral's own timer. Only `onSuccess: 'end-casting'` is refused there, by
 * `conferral_repeat_needs_a_casting`, and only because a spell that ends needs
 * to have been cast.
 *
 * **This list is read twice**, because `save` spells the same three fields
 * flat where `condition` nests them in its rider — one rule, asked at two
 * paths, rather than two lists to keep in step.
 *
 * Refused one by one rather than by admitting a narrowed type, because the
 * validator reads untyped JSON as well as a typed value and the compiler is
 * not there for half of its input. The day an item prints an escape check —
 * Iron Bands of Binding, Rope of Entanglement — this is the list that shortens
 * and `fold/timers.ts` is the guard that narrows with it.
 */
const CONFERRED_CONDITION_FIELDS: readonly string[] = ['lasts', 'check', 'outlivesCasting'];

/**
 * Whether a rolled span is dice and a unit, judged defensively.
 *
 * SRD Potion of Diminution: "for 1d4 hours". Two fields because the book
 * writes two things — the dice and the unit they count — and both are held to
 * exactly the reading their printed counterparts are: the notation goes
 * through `parseNotation`, the same parser `usesRolled` and `regainsAtDawn`
 * answer to, so a stated number is refused here as it is there and "a while"
 * is refused wherever it is written; and the unit is a whole number of seconds
 * above zero, because that is what `durationSeconds` is.
 *
 * One code for the whole shape. A caller who wrote the field wrong has written
 * one thing wrong — the span — and three codes for one clause would be three
 * ways of saying a lifetime this item cannot have.
 */
function rolledSpanProblems(span: unknown, field: string): readonly ContentProblem[] {
  const bad = (reason: string): readonly ContentProblem[] => [
    { field, code: 'bad_rolled_span', reason },
  ];
  if (span === null || typeof span !== 'object') {
    return bad('a rolled span is the dice the line prints and what one point of them is worth');
  }
  const { dice, secondsEach } = span as { dice?: unknown; secondsEach?: unknown };
  if (!isString(dice) || !parseNotation(dice).ok) {
    return bad(
      `"${String(dice)}" is not dice a lifetime can be rolled from; a printed span is "durationSeconds"`,
    );
  }
  if (!Number.isInteger(secondsEach) || (secondsEach as number) <= 0) {
    return bad(
      `one point of "${dice}" is worth a whole number of seconds above zero — 3600 for an hour — and this says ${String(secondsEach)}`,
    );
  }
  return [];
}

/**
 * What one of a feature's pool options has to say, and what it may not.
 *
 * The conferral's rules asked of the other host, and every difference between
 * the two lists is one fact: **a feature has a caster and an item does not.**
 * So "your spellcasting ability modifier" is admitted here and refused on a
 * bottle, a save's DC is the holder's sheet rather than a number the grant
 * prints, and the plural sentence SRD Turn Undead writes — "the Frightened
 * **and** Incapacitated conditions" off one save — is admitted because the
 * resolver files each instance under `feature:<id>` and the timer this
 * option's own span files ends them all.
 *
 * Everything that would need the **casting** is refused exactly as it is on an
 * item, because a feature has one no more than a potion does: a rider's
 * lifetime, its escape check, its `outlivesCasting`, a repeat whose success
 * would end a casting, a granted modifier, a delayed hit, and every
 * `DiceScaling` field that reads a slot level or a caster level.
 *
 * **The effects themselves are judged by `checkEffectValue`**, the spell
 * validator's own two passes, so a feature's list is held to the rules a
 * spell's list is held to rather than to a third vocabulary kept in step by
 * hand.
 */
function featureOptionProblems(
  featureId: string,
  option: PoolOptionGrant,
  at: string,
  levels: number,
  /**
   * Which host prints this option — the pool's menu, or a hit's.
   *
   * The two differ in what an option *may say* and agree in every rule about
   * what its effects are, which is why they share this function rather than
   * having one each: a second copy of the conferral rules is a second place
   * for a rules fix to be missed, and the fields that differ are the ones an
   * action owns. A hit names no action, fills no area, reaches nothing it did
   * not already hit, and its span may be a moment in the turn order.
   */
  host: 'pool' | 'hit' = 'pool',
): readonly ContentProblem[] {
  const found: ContentProblem[] = [];
  const say = (code: string, reason: string, field: string): void => {
    found.push({ field, code, reason });
  };

  if (!isString(option.id) || option.id.trim() === '') {
    say(
      'bad_option_id',
      'an option is named by the caller who spends the use, and a blank id names nothing',
      `${at}.id`,
    );
  }
  if (!isString(option.name) || option.name.trim() === '') {
    say(
      'bad_option_name',
      'an option is what the log calls what happened, and a blank name says nothing',
      `${at}.name`,
    );
  }
  if (host === 'pool' && option.action !== 'action' && option.action !== 'bonus-action') {
    say(
      'bad_option_action',
      `SRD prints what a use costs — "As a Magic action" — and "${String(option.action)}" is neither an Action nor a Bonus Action`,
      `${at}.action`,
    );
  }

  // The fields an action owns, refused where the trigger is a hit: the swing
  // has already paid for itself, chosen its creature and measured its reach,
  // so an option that named any of them would describe a rule nothing reads.
  if (host === 'hit') {
    for (const field of ['action', 'area', 'reach', 'mustBeType', 'diceCountByLevel', 'damageTypeStated'] as const) {
      if ((option as unknown as Record<string, unknown>)[field] === undefined) continue;
      say(
        'action_field_on_a_hit_rider',
        `"${field}" belongs to an option somebody spends an action on; ${featureId} is bought by an attack that has already chosen its target and paid for itself`,
        `${at}.${field}`,
      );
    }
  }

  // **An area or a reach, never both.** SRD writes one or the other on every
  // option in the book — "Each Undead of your choice within 30 feet of you"
  // against "you point your Holy Symbol at another creature" — and one that said
  // both would take a target it then ignored.
  if (host === 'pool' && option.area !== undefined && option.reach !== undefined) {
    say(
      'feature_option_reaches_twice',
      `${featureId} fills an area and reaches a target it names; an option does one or the other`,
      `${at}.area`,
    );
  }
  if (
    host === 'pool' &&
    option.reach !== undefined &&
    (!Number.isInteger(option.reach) || option.reach < 0)
  ) {
    say(
      'bad_option_reach',
      `a reach is a whole number of feet, got ${String(option.reach)}`,
      `${at}.reach`,
    );
  }
  // The filter is an *area's*: a named target is checked as itself, and
  // "each Undead" is the sentence an area prints.
  if (host === 'pool' && option.mustBeType !== undefined && option.area === undefined) {
    say(
      'feature_option_type_without_area',
      `"each ${String(option.mustBeType)}" is what an area filters by, and ${featureId} fills none`,
      `${at}.mustBeType`,
    );
  }

  // A column of the class table, judged as every other column is: as long as
  // the table and a whole number of dice at every row.
  if (host === 'pool' && option.diceCountByLevel !== undefined) {
    if (!Array.isArray(option.diceCountByLevel) || option.diceCountByLevel.length !== levels) {
      say(
        'bad_option_dice_column',
        `a column of this source's table has ${levels} entries, not ${Array.isArray(option.diceCountByLevel) ? option.diceCountByLevel.length : String(option.diceCountByLevel)}`,
        `${at}.diceCountByLevel`,
      );
    } else {
      const bad = option.diceCountByLevel.findIndex(
        (count: unknown) => !Number.isInteger(count) || (count as number) < 1,
      );
      if (bad >= 0) {
        say(
          'bad_option_dice_column',
          `a class table prints a whole number of dice of at least one, not ${String(option.diceCountByLevel[bad])}`,
          `${at}.diceCountByLevel[${bad}]`,
        );
      }
    }
  }

  // **A budget of hit points the caller divides, and it is the one purchase
  // that resolves no effect at all.** SRD Preserve Life hands the *amounts* to
  // the Cleric, where an effect carries its own and reaches each target alike,
  // so the two are alternatives rather than halves: an option that wrote both
  // would run a list over creatures a share had already paid for.
  const divides = (option as unknown as { readonly distributes?: unknown }).distributes;
  if (divides !== undefined) {
    if (host === 'hit') {
      say(
        'action_field_on_a_hit_rider',
        `"distributes" belongs to an option somebody spends an action on; ${featureId} is bought by an attack that has already chosen its target`,
        `${at}.distributes`,
      );
    }
    found.push(...hitPointDivisionProblems(featureId, option, divides, at, levels));
  }

  if (!Array.isArray(option.effects)) {
    say('bad_option_effects', 'an option confers a list of effects', `${at}.effects`);
    return found;
  }
  if (option.effects.length === 0 && divides === undefined) {
    say('empty_feature_option', 'an option that confers an empty list buys nothing', `${at}.effects`);
  }

  let hangs = false;
  let outlasts = false;
  let conditions = 0;
  let types = false;
  option.effects.forEach((effect: unknown, index: number) => {
    const on = `${at}.effects[${index}]`;
    const problems = checkEffectValue(effect, CONFERRED_LEVEL, on);
    found.push(...problems);
    if (problems.length > 0) return;

    const record = effect as unknown as Record<string, unknown>;
    const kind = String(record['kind']);
    if (!CONFERRED_EFFECT_KINDS.has(kind)) {
      say(
        'feature_effect_not_read',
        `"${kind}" needs the casting a feature has none of — an id to weld a condition to, an attack modifier nobody rolled, or a destination stated at the cast — so ${featureId} may not confer one`,
        `${on}.kind`,
      );
      return;
    }
    if (CONFERRED_GRANT_KINDS.has(kind)) {
      hangs = true;
      outlasts = true;
    }
    // Temporary Hit Points outlast the moment without demanding a span, which
    // is the owner's ruling of 2026-09-18 read here as it is read for an item.
    if (kind === 'temp-hp') outlasts = true;
    if (record['damageType'] !== undefined || record['damageTypes'] !== undefined) types = true;

    // **A rider deals no damage, and the attack it rides on is why.** The
    // engine holds one damage roll at a time — `damage-rolled` is refused by
    // the fold while another is waiting — and a blow whose target has a
    // Reaction to it is already holding one when a rider fires. A second would
    // be a log that cannot be folded rather than a refusal, which is the one
    // outcome worth refusing at authoring for. Every SRD sentence of this
    // shape imposes a condition or forces a save and not one of them deals
    // damage, so what this refuses is a homebrew the engine would break on and
    // never a rule the book prints; it lifts the day the attack path folds a
    // rider's damage into the blow's own.
    if (host === 'hit' && (kind === 'save-damage' || record['damage'] !== undefined)) {
      say(
        'rider_deals_damage',
        `${featureId} is bought by a hit and deals damage of its own, and an attack holds one damage roll at a time; a rider imposes conditions and forces saves`,
        `${on}.kind`,
      );
    }

    if (kind === 'condition') {
      hangs = true;
      outlasts = true;
      conditions += 1;
      found.push(...castingOwnedFields(featureId, record['condition'], `${on}.condition`));
    }

    // **`save` writes its first rider flat and the rest in a list**, and both
    // layouts are asked the same question. The list itself is admitted, which
    // is the one rule a conferral does not share: a bottle hangs one condition
    // and a feature hangs the two SRD Turn Undead prints.
    //
    // **What it hangs is counted only when it hangs one.** `save.condition`
    // is optional since SRD Slow — a failure may hand out grants and impose
    // nothing — and a feature's pool use may carry no rider at all, so a
    // conferred save with no condition confers nothing and must not be
    // credited with a lifetime it has nothing to spend on.
    // `save_imposes_nothing` is what refuses the effect itself, at the
    // authoring door every effect here has already been through.
    if (kind === 'save') {
      if (record['condition'] !== undefined) {
        hangs = true;
        outlasts = true;
        conditions += 1;
      }
      for (const field of CONFERRED_CONDITION_FIELDS) {
        if (record[field] === undefined) continue;
        say(
          'feature_condition_needs_a_casting',
          `"${field}" is owned by the casting that imposed the condition — a lifetime, an escape check, a mark that the casting does not keep it — and ${featureId} casts nothing; an option's lifetime is durationSeconds and what ends it early is endsEarly`,
          `${on}.${field}`,
        );
      }
      // **And the repeat, at both doors a rider opens.** The host writes one
      // flat, and a feature is the first conferring host whose *further*
      // conditions may carry one of their own — `conditionRiderOf` hands each
      // to `repeatSaveFrom`, so a second door exists and is asked here. Being
      // caught again at the moment of use by `applyConditionTo` is not the
      // same thing: `content.md` says end-casting is refused at every door
      // that could write one, and this is now such a door.
      const further = record['conditions'];
      if (Array.isArray(further)) {
        further.forEach((rider, position) => {
          found.push(
            ...castingOwnedFields(featureId, rider, `${on}.conditions[${position}]`),
          );
        });
      }
      found.push(...endsACasting(featureId, record, on));
    }

    // The riders a *failure* carries, which are welded to a casting wherever
    // they are hung. `conditions` is left out on a `save`, where it is the
    // kind's own plural list and is resolved under the feature's source; it is
    // refused everywhere else, and so are the other two at every host.
    for (const rider of RIDER_FIELDS) {
      if (rider === 'conditions' && (kind === 'save' || CONDITIONS_IS_THE_KINDS_OWN.has(kind))) {
        continue;
      }
      if (record[rider] !== undefined) {
        say(
          'feature_rider_needs_a_casting',
          `a "${rider}" rider is welded to the casting that hung it — a condition instance, a granted modifier's source, a scheduled hit's link — and ${featureId} casts nothing`,
          `${on}.${rider}`,
        );
      }
    }
    // The verdict is filed **against a casting** — see {@link RECORDED_VERDICT}.
    if (record[RECORDED_VERDICT] !== undefined) {
      say(
        'feature_verdict_needs_a_casting',
        `a recorded verdict is written onto the casting that threw the save, and ${featureId} casts nothing`,
        `${on}.${RECORDED_VERDICT}`,
      );
    }

    // **The scaling fields, and only the ones that read a casting.** A feature's
    // dice scale on its own class table — `diceCountByLevel` above — because
    // every field here reads a slot level or a caster level and a pool use has
    // neither.
    for (const [where, scaling] of scalingsOf(record, on)) {
      for (const scaled of SCALES_WITH_A_CASTING) {
        if (scaling[scaled] !== undefined) {
          say(
            'feature_scales_with_a_casting',
            `${scaled} reads a slot level or a caster level, and a feature's use spends neither; a feature's dice scale on its class table through diceCountByLevel`,
            `${where}.${scaled}`,
          );
        }
      }
    }
  });

  // **Required exactly when something hangs, and refused when nothing could
  // outlast the moment** — the rule an item's conferral already keeps, for the
  // same reason: there is no casting for `releaseCasting` to end, so a grant
  // with no deadline would run for ever, and a deadline with nothing to end
  // would file a timer that takes nothing away.
  //
  // A hit's rider has the second spelling as well: SRD Stunning Strike ends
  // "until the start of your next turn", which is a moment in the order rather
  // than a number of seconds. Exactly one of the two, because two deadlines
  // for one effect is a choice nothing could make.
  const anchored = (option as unknown as { readonly lasts?: unknown }).lasts;
  if (host === 'hit' && anchored !== undefined) {
    if (!(TURN_ANCHORS as readonly string[]).includes(String(anchored))) {
      say(
        'bad_option_anchor',
        `an option that ends at a turn boundary ends at ${TURN_ANCHORS.join(' or ')}, not "${String(anchored)}"`,
        `${at}.lasts`,
      );
    }
    if (option.durationSeconds !== undefined) {
      say(
        'feature_option_lasts_twice',
        `${featureId} prints a span in seconds and a moment in the turn order, and one effect ends once`,
        `${at}.lasts`,
      );
    }
    if (!hangs && !outlasts) {
      say(
        'feature_option_lifetime_ends_nothing',
        `${featureId} confers nothing that outlasts the moment it is used, so a duration would end nothing`,
        `${at}.lasts`,
      );
    }
  } else if (option.durationSeconds === undefined) {
    if (hangs) {
      say(
        'feature_option_without_lifetime',
        `${featureId} hangs something no casting ends, so its line has to say how long that lasts`,
        `${at}.durationSeconds`,
      );
    }
  } else if (!Number.isInteger(option.durationSeconds) || option.durationSeconds <= 0) {
    say(
      'bad_option_duration',
      `an option lasts a whole number of seconds, got ${String(option.durationSeconds)}`,
      `${at}.durationSeconds`,
    );
  } else if (!hangs && !outlasts) {
    say(
      'feature_option_lifetime_ends_nothing',
      `${featureId} confers nothing that outlasts the moment it is used, so a duration would end nothing`,
      `${at}.durationSeconds`,
    );
  }

  if (option.endsEarly !== undefined) {
    if (!Array.isArray(option.endsEarly) || option.endsEarly.length === 0) {
      say(
        'bad_option_end_trigger',
        'what ends a conferred condition early is a non-empty list of causes, and an option that prints no such sentence omits the field',
        `${at}.endsEarly`,
      );
    } else {
      option.endsEarly.forEach((cause: unknown, index: number) => {
        if ((EFFECT_END_CAUSES as readonly string[]).includes(String(cause))) return;
        say(
          'unknown_option_end_trigger',
          `"${String(cause)}" is not something the engine can see happen to the creature a timer sits on`,
          `${at}.endsEarly[${index}]`,
        );
      });
      if (conditions === 0) {
        say(
          'feature_option_end_trigger_ends_nothing',
          `${featureId} confers no condition, and what a trigger ends early is the condition's own timer — so this sentence could never fire`,
          `${at}.endsEarly`,
        );
      }
    }
  }

  // **A choice the caller is offered, and something for it to reach.** SRD
  // Divine Spark prints "Necrotic or Radiant damage (your choice)"; a list
  // over effects that name no damage type at all is a question whose answer
  // nothing reads — `statedDamageType` would substitute into nothing.
  if (host === 'pool' && option.damageTypeStated !== undefined) {
    if (!Array.isArray(option.damageTypeStated) || option.damageTypeStated.length < 2) {
      say(
        'bad_option_type_choice',
        'a choice of damage type is at least two of them; an option that prints one writes it on the effect',
        `${at}.damageTypeStated`,
      );
    } else if (!types) {
      say(
        'feature_option_type_choice_reaches_nothing',
        `${featureId} offers a choice of damage type and confers nothing that deals damage, so the answer would reach no die`,
        `${at}.damageTypeStated`,
      );
    }
  }

  return found;
}

/**
 * The three fields a {@link ConditionRider} carries that only a casting can
 * answer for, refused wherever a feature writes one.
 *
 * `CONFERRED_CONDITION_FIELDS` asked of a rider object rather than of a flat
 * record — one rule, two layouts, exactly as the conferral's own validator
 * reads the list twice.
 */
function castingOwnedFields(
  featureId: string,
  rider: unknown,
  at: string,
): readonly ContentProblem[] {
  if (typeof rider !== 'object' || rider === null) return [];
  const found: ContentProblem[] = [];
  for (const field of CONFERRED_CONDITION_FIELDS) {
    if ((rider as Record<string, unknown>)[field] === undefined) continue;
    found.push({
      field: `${at}.${field}`,
      code: 'feature_condition_needs_a_casting',
      reason: `"${field}" is owned by the casting that imposed the condition — a lifetime, an escape check, a mark that the casting does not keep it — and ${featureId} casts nothing; an option's lifetime is durationSeconds and what ends it early is endsEarly`,
    });
  }
  found.push(...endsACasting(featureId, rider as Record<string, unknown>, at));
  return found;
}

/**
 * A repeat save whose success would end the casting, wherever it is written.
 *
 * SRD writes "the target repeats the save" on a host and the engine lets the
 * success end either the condition on its target or the spell; the second
 * needs a spell. Asked of the flat host and of every further rider, because
 * both reach `repeatSaveFrom` and a rule enforced at one of two doors is a
 * rule with a hole in it.
 */
function endsACasting(
  featureId: string,
  record: unknown,
  at: string,
): readonly ContentProblem[] {
  if (typeof record !== 'object' || record === null) return [];
  const repeats = (record as Record<string, unknown>)['repeats'];
  if (
    typeof repeats !== 'object' ||
    repeats === null ||
    (repeats as Record<string, unknown>)['onSuccess'] !== 'end-casting'
  ) {
    return [];
  }
  return [
    {
      field: `${at}.repeats.onSuccess`,
      code: 'feature_repeat_needs_a_casting',
      reason: `a repeat save that ends the casting on a success needs one, and ${featureId} casts nothing; what a success can end here is the condition on its target`,
    },
  ];
}

/**
 * Every option a feature's pool offers, judged together.
 *
 * Two options of one feature sharing an id is the one rule that is about the
 * list rather than about a member of it: `usePoolOption` finds an option by
 * name on the sheet, and a second of the same name is one the caller could
 * never reach.
 */
function featureOptionsProblems(
  featureId: string,
  options: readonly PoolOptionGrant[],
  at: string,
  levels: number,
  /** Which host prints the menu — see {@link featureOptionProblems}. */
  host: 'pool' | 'hit' = 'pool',
): readonly ContentProblem[] {
  if (!Array.isArray(options)) {
    return [
      {
        field: at,
        code: 'bad_feature_options',
        reason: `a ${host === 'pool' ? 'pool' : 'rider'} offers a list of options`,
      },
    ];
  }
  const found: ContentProblem[] = [];
  const seen = new Set<string>();
  options.forEach((option, index) => {
    const on = `${at}[${index}]`;
    if (isString(option?.id)) {
      if (seen.has(option.id)) {
        found.push({
          field: `${on}.id`,
          code: 'duplicate_feature_option',
          reason: `${featureId} offers "${option.id}" twice, and a caller naming it could reach only the first`,
        });
      }
      seen.add(option.id);
    }
    found.push(...featureOptionProblems(featureId, option, on, levels, host));
  });
  return found;
}

/**
 * The budget a distributing option mints, judged as a pool's size is.
 *
 * `poolSizeOf` is the one reader of every sizing the SRD writes and it is the
 * reader here too, so the rules are the pool's rules asked of hit points: one
 * shape, a column as long as this source's table, whole numbers. What is added
 * is the two clauses only a division has — the ceiling it restores to and the
 * creature types it refuses — and the fields it may not print beside, each of
 * which would describe something the division does not do.
 */
function hitPointDivisionProblems(
  featureId: string,
  option: PoolOptionGrant,
  divides: unknown,
  at: string,
  levels: number,
): readonly ContentProblem[] {
  const found: ContentProblem[] = [];
  const say = (code: string, reason: string, field: string): void => {
    found.push({ field, code, reason });
  };

  if (typeof divides !== 'object' || divides === null) {
    say(
      'bad_hit_point_division',
      'a division names how many hit points one use mints, and what the cap is',
      `${at}.distributes`,
    );
    return found;
  }
  const record = divides as Record<string, unknown>;

  // An area catches whoever is in it and a filter leaves the rest alone; a
  // division names its creatures and refuses the ones it cannot touch, which
  // is what `excludesTypes` is for. Damage is the other one: nothing here
  // deals any, so a choice of type would reach no die.
  for (const field of ['area', 'mustBeType', 'damageTypeStated', 'diceCountByLevel'] as const) {
    if (option[field] === undefined) continue;
    say(
      'division_does_not_take',
      `"${field}" belongs to an option that resolves effects; ${featureId} divides hit points among the creatures its caller names`,
      `${at}.${field}`,
    );
  }

  if (record['cap'] !== 'half-maximum') {
    say(
      'bad_division_cap',
      `a division restores a creature to no more than half its Hit Point maximum, and "${String(record['cap'])}" is not a ceiling this engine measures`,
      `${at}.distributes.cap`,
    );
  }

  const sizing = record['hitPoints'];
  if (typeof sizing !== 'object' || sizing === null) {
    say(
      'bad_division_sizing',
      'a division says how many hit points one use mints, sized the way a pool is',
      `${at}.distributes.hitPoints`,
    );
  } else {
    const sized = sizing as Record<string, unknown>;
    const shapes = ['usesByLevel', 'fromAbilityModifier', 'perClassLevel'].filter(
      (shape) => sized[shape] !== undefined,
    );
    if (shapes.length > 1) {
      say(
        'ambiguous_division_sizing',
        `${shapes.join(' and ')} both size this budget, and poolSizeOf reads exactly one`,
        `${at}.distributes.hitPoints`,
      );
    }
    // A column is as long as this source's table and prints whole numbers, and
    // a multiple or a floor is at least one — `isCount`'s rule in
    // `feature-schema.ts`, which is where the same question is asked of a
    // pool's own size. A budget of zero is `empty_feature_option`'s failure
    // under another name: every use of it would be refused `too_much_divided`.
    const column = sized['usesByLevel'];
    if (column !== undefined) {
      if (!Array.isArray(column) || column.length !== levels) {
        say(
          'bad_division_sizing',
          `a column of this source's table has ${levels} entries, not ${Array.isArray(column) ? column.length : String(column)}`,
          `${at}.distributes.hitPoints.usesByLevel`,
        );
      } else {
        const bad = column.findIndex(
          (entry: unknown) => !Number.isInteger(entry) || (entry as number) < 0,
        );
        if (bad >= 0) {
          say(
            'bad_division_sizing',
            `a class table prints a whole number of hit points, not ${String(column[bad])}`,
            `${at}.distributes.hitPoints.usesByLevel[${bad}]`,
          );
        }
      }
    }
    for (const field of ['perClassLevel', 'minimum'] as const) {
      const value = sized[field];
      if (value === undefined) continue;
      if (!Number.isInteger(value) || (value as number) < 1) {
        say(
          'bad_division_sizing',
          `${field} is a whole number of hit points of at least one, not ${String(value)}`,
          `${at}.distributes.hitPoints.${field}`,
        );
      }
    }
    if (shapes.length === 0 && sized['minimum'] === undefined) {
      say(
        'bad_division_sizing',
        'a division says how many hit points one use mints, and this one names no sizing at all',
        `${at}.distributes.hitPoints`,
      );
    }
    const ability = sized['fromAbilityModifier'];
    if (ability !== undefined && !(ABILITIES as readonly string[]).includes(String(ability))) {
      say(
        'bad_division_sizing',
        `"${String(ability)}" is not an ability score`,
        `${at}.distributes.hitPoints.fromAbilityModifier`,
      );
    }
  }

  const types = record['excludesTypes'];
  if (types !== undefined) {
    if (!Array.isArray(types) || types.length === 0) {
      say(
        'bad_division_exclusion',
        'what a division refuses is a non-empty list of creature types, and an option that refuses nobody omits the field',
        `${at}.distributes.excludesTypes`,
      );
    } else {
      // The book's own vocabulary, held to as `mustBeType` already is: a
      // mistyped "undead" would validate and then match nobody, so a homebrew
      // Preserve Life would quietly heal the Undead it printed a refusal of.
      types.forEach((type: unknown, index: number) => {
        if (CREATURE_TYPES.includes(String(type))) return;
        say(
          'bad_division_exclusion',
          `"${String(type)}" is not one of the creature types the SRD prints`,
          `${at}.distributes.excludesTypes[${index}]`,
        );
      });
    }
  }

  return found;
}

/**
 * A menu of things a casting may buy, judged together — SRD Metamagic.
 *
 * The rules a feature cannot check one option at a time, and every one of them
 * is about **reachability**: an option a caller cannot name, cannot name
 * twice, or cannot ever have chosen is a line on a class table that looks
 * executed and is not. That is the failure `feature-schema.ts` exists for,
 * asked of the one grant whose menu is filtered by an answer given somewhere
 * else.
 *
 * **The pool key is not cross-checked**, which is the reading `recovery`'s
 * `restores.pool` already takes: a subclass feature may spend a pool the class
 * declared, and this file sees one source at a time. A key nothing declares is
 * a rules-legal refusal at the casting — the caster has none of it — rather
 * than a catalogue that will not load.
 */
function castingOptionProblems(
  feature: FeatureDefinition,
  grant: Extract<FeatureGrant, { kind: 'casting-options' }>,
  at: string,
): readonly ContentProblem[] {
  const found: ContentProblem[] = [];
  const say = (code: string, reason: string, field: string): void => {
    found.push({ field, code, reason });
  };

  if (!isString(grant.pool) || grant.pool.length === 0) {
    say(
      'casting_options_without_a_pool',
      `${feature.id} prices its options in a pool and names none; the pool is another feature's, because one feature carries one grant`,
      `${at}.pool`,
    );
  }

  if (!Number.isInteger(grant.perCasting) || grant.perCasting < 1) {
    say(
      'bad_options_per_casting',
      `${feature.id} lets a casting take ${String(grant.perCasting)} of its options, and a menu nobody can take from is a feature that does nothing`,
      `${at}.perCasting`,
    );
  }

  if (!Array.isArray(grant.options) || grant.options.length === 0) {
    say('casting_options_empty', `${feature.id} offers a menu with nothing on it`, `${at}.options`);
    return found;
  }

  // The menu the player is offered. A feature that asks nothing grants all of
  // its options, and a feature that asks for something *other* than an option
  // has no answer creation could filter the menu by.
  const asks = feature.choice;
  const offered =
    asks === undefined ? null : asks.kind === 'option' ? new Set(asks.from) : new Set<string>();
  if (asks !== undefined && asks.kind !== 'option') {
    say(
      'casting_options_not_chosen',
      `${feature.id} offers a menu of casting options and asks the player for a ${asks.kind}, and creation filters the menu by the names an "option" choice answered with`,
      `${at}.options`,
    );
  }

  const seen = new Set<string>();
  grant.options.forEach((option, index) => {
    const on = `${at}.options[${index}]`;
    if (!isString(option?.id) || option.id.length === 0) {
      say('bad_casting_option', `${feature.id} offers an option with no id`, `${on}.id`);
      return;
    }
    if (seen.has(option.id)) {
      say(
        'duplicate_casting_option',
        `${feature.id} offers "${option.id}" twice, and a casting naming it could reach only the first`,
        `${on}.id`,
      );
    }
    seen.add(option.id);

    if (!isString(option.name) || option.name.length === 0) {
      say('bad_casting_option', `${feature.id} offers an option with no name`, `${on}.name`);
    } else if (offered !== null && !offered.has(option.name)) {
      say(
        'casting_option_not_offered',
        `${feature.id} prices "${option.name}" and does not offer it to the player, so nobody could ever have chosen it`,
        `${on}.name`,
      );
    }

    if (!Number.isInteger(option.cost) || option.cost < 0) {
      say(
        'bad_casting_option_cost',
        `${feature.id} prices "${option.id}" at ${String(option.cost)}, and a price is a whole number of what the pool holds`,
        `${on}.cost`,
      );
    }

    found.push(...castingAlterationProblems(feature.id, option, `${on}.alters`));
  });

  return found;
}

/** The arithmetic one option's alteration has to make sense as. */
function castingAlterationProblems(
  featureId: string,
  option: CastingOptionGrant,
  at: string,
): readonly ContentProblem[] {
  const alters = option?.alters;
  const bad = (reason: string): readonly ContentProblem[] => [
    { field: at, code: 'bad_casting_alteration', reason },
  ];
  if (alters === null || typeof alters !== 'object' || !isString(alters.kind)) {
    return bad(`${featureId} offers "${option?.id}" and does not say what it alters`);
  }
  switch (alters.kind) {
    case 'range':
      return typeof alters.multiplier === 'number' && alters.multiplier > 0
        ? []
        : bad(`${featureId} multiplies a range by ${String(alters.multiplier)}`);
    case 'duration':
      return typeof alters.multiplier === 'number' && alters.multiplier > 0
        ? []
        : bad(`${featureId} multiplies a duration by ${String(alters.multiplier)}`);
    case 'casting-time':
      return alters.from === alters.to
        ? bad(
            `${featureId} changes a casting time of ${alters.from} to ${alters.to}, which is what leaving the option off already does`,
          )
        : [];
    case 'effective-level':
      return Number.isInteger(alters.by) && alters.by > 0
        ? []
        : bad(
            `${featureId} raises a casting's level by ${String(alters.by)}, and a level goes up by whole levels`,
          );
    default:
      return bad(`${featureId} offers "${option.id}", which alters nothing the engine reads`);
  }
}

/**
 * What a rider bought by a hit has to say, and what it may not.
 *
 * {@link featureOptionsProblems} judges the menu; this judges the trigger. The
 * three things that can be wrong about one are the three the SRD sentence
 * prints: what it spends, how often, and which swings it rides on.
 *
 * **The pool is another feature's and that is the point** — SRD Stunning
 * Strike spends Monk's Focus — so it is checked as a name rather than as a
 * declaration, and whether that pool exists is a question the sheet answers at
 * the swing: a rider naming a pool its holder has none of finds none left and
 * is refused `exhausted`, which is the same answer a spent pool gives.
 */
function hitRiderProblems(
  featureId: string,
  grant: Extract<FeatureGrant, { kind: 'on-hit' }>,
  at: string,
  levels: number,
): readonly ContentProblem[] {
  const found: ContentProblem[] = [];
  const say = (code: string, reason: string, field: string): void => {
    found.push({ field, code, reason });
  };

  if (grant.pool !== undefined && (!isString(grant.pool) || grant.pool.trim() === '')) {
    say(
      'bad_rider_pool',
      'the pool a rider spends is named by the feature that declared it, and a blank name names nothing',
      `${at}.pool`,
    );
  }
  if (grant.costs !== undefined) {
    if (!Number.isInteger(grant.costs) || grant.costs < 1) {
      say(
        'bad_rider_cost',
        `a rider costs a whole number of uses of at least one, got ${String(grant.costs)}`,
        `${at}.costs`,
      );
    }
    // SRD prints a price on a pool and never on nothing: a cost with nothing
    // to take it from is a number the swing would silently not spend.
    if (grant.pool === undefined) {
      say(
        'rider_cost_without_a_pool',
        `${featureId} prices a rider and names no pool to take it from; a feature the book charges nothing for omits both`,
        `${at}.costs`,
      );
    }
  }

  // "with a Monk weapon **or an Unarmed Strike**": two clauses, because an
  // Unarmed Strike is in no set of weapons. A rider that names an empty set
  // rides on nothing at all, which is a rule that could never fire.
  if (grant.weapons !== undefined) {
    if (!Array.isArray(grant.weapons) || grant.weapons.length === 0) {
      say(
        'bad_rider_weapons',
        'the weapons a rider rides on are a non-empty list of selectors; a rider that asks nothing of the swing omits the field',
        `${at}.weapons`,
      );
    } else {
      grant.weapons.forEach((selector, index) => {
        found.push(...weaponSelectorProblems(selector, `${at}.weapons[${index}]`));
      });
    }
  }

  if (grant.saveAbility !== undefined && !(ABILITIES as readonly string[]).includes(grant.saveAbility)) {
    say(
      'bad_rider_save_ability',
      `a save DC is derived from one of the six abilities, not "${String(grant.saveAbility)}"`,
      `${at}.saveAbility`,
    );
  }

  if (!Array.isArray(grant.options) || grant.options.length === 0) {
    say(
      'rider_without_options',
      `${featureId} is bought by a hit and buys nothing; a rider prints at least one named effect`,
      `${at}.options`,
    );
    return found;
  }

  found.push(
    ...featureOptionsProblems(
      featureId,
      grant.options as unknown as readonly PoolOptionGrant[],
      `${at}.options`,
      levels,
      'hit',
    ),
  );
  return found;
}

/**
 * What an item's `confers` grant has to say, and what it may not.
 *
 * SRD "Magic Items" decides the shape: "Many items, such as Potions, bypass
 * the casting of a spell and confer the spell's effects with its usual
 * duration." So this is an effect list with no casting behind it, and every
 * rule below is one consequence of the casting's absence.
 *
 * **The effects themselves are judged by `checkEffectValue`**, which is the
 * spell validator's own two passes — so an item's list is held to the rules a
 * spell's list is held to rather than to a second vocabulary kept in step by
 * hand. What is added here is only what is true of an item and false of a
 * casting.
 */
function itemConfersProblems(
  item: CatalogueItem,
  grant: Extract<FeatureGrant, { kind: 'confers' }>,
  at: string,
): readonly ContentProblem[] {
  const found: ContentProblem[] = [];
  const say = (code: string, reason: string, field: string): void => {
    found.push({ field, code, reason });
  };

  if (grant.action !== 'action' && grant.action !== 'bonus-action') {
    say(
      'bad_conferral_action',
      `SRD prints what using the item costs — "Drinking a potion ... requires a Bonus Action" — and "${String(grant.action)}" is neither an Action nor a Bonus Action`,
      `${at}.action`,
    );
  }

  // **What one use costs, judged by the rules a casting's price is judged by.**
  // SRD prints both on the item's own line — "you can expend 1 charge to cast
  // _Web_" and "you can expend up to 3 charges" — and the three rules are the
  // same three: a whole number of at least one, a maximum strictly above the
  // cost, and a pool on the same item for the charges to come out of.
  //
  // **Written out again rather than shared with `itemCastsProblems`.** Each
  // host names its own code and its own path, so a caller repairing an entry
  // is told which of the two they wrote — the reason `casts_without_charges`
  // and `confers_without_charges` are two codes for one economy rather than
  // one code reported at two paths.
  //
  // **Absent stays the common case and stays a bottle.** A conferral that
  // names no price is used up, declares no pool and is refused nothing here.
  if (grant.charges !== undefined && (!Number.isInteger(grant.charges) || grant.charges < 1)) {
    say(
      'bad_conferral_charge_cost',
      `the SRD prints what one use of an item costs on the item's own line, and ${item.id} names ${String(grant.charges)}`,
      `${at}.charges`,
    );
  }
  if (grant.upToCharges !== undefined) {
    if (grant.charges === undefined) {
      say(
        'conferral_range_without_a_price',
        `"up to N charges" is a maximum above a price, and ${item.id} confers for none — an item that is used up rather than spent names neither`,
        `${at}.upToCharges`,
      );
    } else if (!Number.isInteger(grant.upToCharges) || grant.upToCharges <= grant.charges) {
      say(
        'bad_conferral_charge_range',
        `"up to N charges" is a maximum above the cost, and ${item.id} names ${String(grant.upToCharges)}`,
        `${at}.upToCharges`,
      );
    }
  }
  // An item that confers for a price and declares no pool is an economy with
  // nothing behind it, and `useItem` would refuse every use of it — the same
  // refusal `casts_without_charges` makes one grant along.
  if (grant.charges !== undefined && itemChargePool(item) === null) {
    say(
      'confers_without_charges',
      `${item.id} confers for charges and declares no charge pool for them to come out of`,
      `${at}.charges`,
    );
  }
  // **The DC is the item's own number**, so it is a whole number to beat and
  // not a derivation of anybody's sheet. Required exactly when something on
  // the list rolls against it and refused when nothing does, which is the rule
  // `durationSeconds` already keeps about the other thing a grant can print.
  if (grant.saveDc !== undefined && (!Number.isInteger(grant.saveDc) || grant.saveDc < 1)) {
    say(
      'bad_conferral_dc',
      `a save DC is a whole number to beat, got ${String(grant.saveDc)}`,
      `${at}.saveDc`,
    );
  }

  if (!Array.isArray(grant.effects)) {
    say('bad_conferral_effects', 'an item confers a list of effects', `${at}.effects`);
    return found;
  }
  if (grant.effects.length === 0) {
    say('empty_conferral', 'an item that confers an empty list confers nothing', `${at}.effects`);
  }

  let hangs = false;
  let outlasts = false;
  let rolls = false;
  let conditions = 0;
  grant.effects.forEach((effect, index) => {
    const on = `${at}.effects[${index}]`;
    // The engine's own rules for an effect, whoever hosts the list.
    const problems = checkEffectValue(effect, CONFERRED_LEVEL, on);
    found.push(...problems);
    if (problems.length > 0) return;

    const record = effect as unknown as Record<string, unknown>;
    const kind = String(record['kind']);
    if (!CONFERRED_EFFECT_KINDS.has(kind)) {
      say(
        'conferral_effect_not_read',
        `"${kind}" needs the casting an item bypasses — an id to weld a condition to, an attack modifier nobody printed, or a destination stated at the cast — so ${item.id} may not confer one`,
        `${on}.kind`,
      );
      return;
    }
    if (CONFERRED_GRANT_KINDS.has(kind)) {
      hangs = true;
      outlasts = true;
    }
    // **Temporary Hit Points outlast the moment without demanding a lifetime,
    // and they are the only thing here that does both.** SRD Potion of
    // Heroism states an hour on them, so a duration is not a number that ends
    // nothing; and the owner's ruling of 2026-09-18 is that Temporary Hit
    // Points with no stated duration last until they are spent or until a
    // Long Rest, so an item that states none is complete rather than
    // unfinished. `useItem` files the deadline on the pool when one is
    // stated — see `EffectTarget` `temporary-hit-points`.
    if (kind === 'temp-hp') outlasts = true;
    if (rollsASave(record)) rolls = true;

    // **A condition hangs too, and not as a grant.** It is a condition
    // instance filed under the item's source, which nothing but its own timer
    // can take off — so the lifetime rule below is the same rule, asked of a
    // second kind of thing left behind. What it must not carry is anything
    // that needs the casting it has not got.
    if (kind === 'condition') {
      hangs = true;
      outlasts = true;
      conditions += 1;
      const rider = record['condition'];
      if (typeof rider === 'object' && rider !== null) {
        for (const field of CONFERRED_CONDITION_FIELDS) {
          if ((rider as Record<string, unknown>)[field] === undefined) continue;
          say(
            'conferral_condition_needs_a_casting',
            `"${field}" is owned by the casting that imposed the condition — a lifetime, an escape check, a mark that the casting does not keep it — and ${item.id} casts nothing; a conferral's lifetime is durationSeconds and what ends it early is endsEarly`,
            `${on}.condition.${field}`,
          );
        }
      }
    }

    // **A saving throw that imposes one hangs it too**, and it says the same
    // three fields flat rather than inside a rider — `save` is the one host
    // that keeps that layout. So the rule above is asked again of the record
    // itself, at the paths this kind writes them at.
    if (kind === 'save') {
      // Counted only where there is one to count — see the feature side, and
      // `save.condition`, optional since SRD Slow.
      if (record['condition'] !== undefined) {
        hangs = true;
        outlasts = true;
        conditions += 1;
      }
      for (const field of CONFERRED_CONDITION_FIELDS) {
        if (record[field] === undefined) continue;
        say(
          'conferral_condition_needs_a_casting',
          `"${field}" is owned by the casting that imposed the condition — a lifetime, an escape check, a mark that the casting does not keep it — and ${item.id} casts nothing; a conferral's lifetime is durationSeconds and what ends it early is endsEarly`,
          `${on}.${field}`,
        );
      }
      // **And the repeat that ends a casting.** The other spelling is the one
      // an item can mean: a `PendingSave` names the source now, so a flask's
      // condition repeats its save and a success ends it on the timer the
      // conferral filed — but "the spell ends" needs a spell. Refused rather
      // than read as `end-on-target`, which would be a rule the item did not
      // print, applied on its behalf.
      const repeats = record['repeats'];
      if (
        typeof repeats === 'object' &&
        repeats !== null &&
        (repeats as Record<string, unknown>)['onSuccess'] === 'end-casting'
      ) {
        say(
          'conferral_repeat_needs_a_casting',
          `a repeat save that ends the casting on a success needs one, and ${item.id} casts nothing; what a success can end here is the condition on its target`,
          `${on}.repeats.onSuccess`,
        );
      }
    }

    // "Your spellcasting ability modifier" is the caster's, and a conferral
    // has no caster: the modifier would silently be zero.
    if (record['addSpellcastingModifier'] === true) {
      say(
        'conferral_has_no_caster',
        'an item confers its effect without casting a spell, so there is no spellcasting ability modifier to add',
        `${on}.addSpellcastingModifier`,
      );
    }
    // A rider hangs off the outcome and is welded to the casting that hung it.
    // Admitting the saving throw does not admit what a spell's failure branch
    // carries — see {@link RIDER_FIELDS}. What it also does not do is refuse a
    // kind its own required list because the list shares a rider's name; see
    // {@link CONDITIONS_IS_THE_KINDS_OWN}.
    for (const rider of RIDER_FIELDS) {
      if (rider === 'conditions' && CONDITIONS_IS_THE_KINDS_OWN.has(kind)) continue;
      if (record[rider] !== undefined) {
        say(
          'conferral_rider_needs_a_casting',
          `a "${rider}" rider is welded to the casting that hung it — a condition instance, a granted modifier's source, a scheduled hit's link — and ${item.id} casts nothing`,
          `${on}.${rider}`,
        );
      }
    }
    // The verdict is filed **against a casting** — see {@link RECORDED_VERDICT}.
    if (record[RECORDED_VERDICT] !== undefined) {
      say(
        'conferral_verdict_needs_a_casting',
        `a recorded verdict is written onto the casting that threw the save, and ${item.id} casts nothing`,
        `${on}.${RECORDED_VERDICT}`,
      );
    }
    for (const [where, scaling] of scalingsOf(record, on)) {
      for (const scaled of SCALES_WITH_A_CASTING) {
        if (scaling[scaled] !== undefined) {
          say(
            'conferral_scales_with_a_casting',
            `${scaled} reads a slot level or a caster level, and an item's printed line is the same whoever uses it`,
            `${where}.${scaled}`,
          );
        }
      }
    }
  });

  // **Required exactly when something rolls against it**, the rule the
  // lifetime below keeps about the other number a grant prints. A save with no
  // DC would be rolled against zero and never fail; a DC nothing rolls against
  // is a number that never reaches a die.
  if (grant.saveDc === undefined && rolls) {
    say(
      'conferral_save_without_dc',
      `${item.id} confers a saving throw and prints no DC, and a save against no number is a save nobody can fail`,
      `${at}.saveDc`,
    );
  } else if (grant.saveDc !== undefined && !rolls) {
    say(
      'conferral_dc_rolls_nothing',
      `${item.id} confers nothing that rolls a saving throw, so its printed DC would be a number no die is thrown against`,
      `${at}.saveDc`,
    );
  }

  // **Required exactly when something hangs, and refused when nothing could
  // outlast the moment.** There is no casting for `releaseCasting` to end, so
  // a grant with no deadline would run for ever; and a deadline with nothing
  // to end would file a timer that takes nothing away.
  //
  // **The two questions are not the same one**, and Temporary Hit Points are
  // where they come apart: a stated hour ends them, so a duration is not a
  // number that ends nothing — but they need no deadline to be complete,
  // because unstated they last until they are spent or until a Long Rest. So
  // `hangs` decides whether a lifetime is *required* and `outlasts` whether
  // one is *allowed*, and every other kind sets both together.
  //
  // **And the lifetime is one clause however the line writes it.** SRD Potion
  // of Diminution rolls for its span — "for 1d4 hours" — where Potion of
  // Heroism prints one, so the two fields answer the same question and an item
  // that names both has been sized twice. Every rule below is asked of
  // whichever one the item wrote.
  const rolledSpan: unknown = grant.durationRolled;
  const stated = grant.durationSeconds !== undefined;
  if (rolledSpan !== undefined && stated) {
    say(
      'conferral_span_twice',
      `${item.id} prints how long its benefit lasts and rolls for it too; an item's line does one or the other`,
      `${at}.durationRolled`,
    );
  }
  if (rolledSpan !== undefined) {
    found.push(...rolledSpanProblems(rolledSpan, `${at}.durationRolled`));
  }

  if (!stated && rolledSpan === undefined) {
    if (hangs) {
      say(
        'conferral_without_lifetime',
        `${item.id} hangs a grant and no casting ends it, so its line has to say how long that lasts`,
        `${at}.durationSeconds`,
      );
    }
  } else if (stated && (!Number.isInteger(grant.durationSeconds) || (grant.durationSeconds ?? 0) <= 0)) {
    say(
      'bad_conferral_duration',
      `a conferral lasts a whole number of seconds, got ${String(grant.durationSeconds)}`,
      `${at}.durationSeconds`,
    );
  } else if (!hangs && !outlasts) {
    say(
      'conferral_lifetime_ends_nothing',
      `${item.id} confers nothing that outlasts the moment it is used, so a duration would end nothing`,
      stated ? `${at}.durationSeconds` : `${at}.durationRolled`,
    );
  }

  // **And the same rule about the other half of the same clause.** SRD Potion
  // of Invisibility prints the duration and what cuts it short in one breath —
  // "for 1 hour. The effect ends early if you make an attack roll ..." — so a
  // trigger with no condition to end is `conferral_lifetime_ends_nothing`
  // asked about the sentence rather than about the number: a line that reads as
  // transcribed and could never fire.
  if (grant.endsEarly !== undefined) {
    if (!Array.isArray(grant.endsEarly) || grant.endsEarly.length === 0) {
      say(
        'bad_conferral_end_trigger',
        'what ends a conferred condition early is a non-empty list of causes, and an item that prints no such sentence omits the field',
        `${at}.endsEarly`,
      );
    } else {
      grant.endsEarly.forEach((cause, index) => {
        if (EFFECT_END_CAUSES.includes(cause)) return;
        say(
          'unknown_conferral_end_trigger',
          `"${String(cause)}" is not something the engine can see happen to the creature a timer sits on; a conferral has no caster, so the one cause that needs one is not among them either`,
          `${at}.endsEarly[${index}]`,
        );
      });
      if (conditions === 0) {
        say(
          'conferral_end_trigger_ends_nothing',
          `${item.id} confers no condition, and what a trigger ends early is the condition's own timer — so this sentence could never fire`,
          `${at}.endsEarly`,
        );
      }
    }
  }

  return found;
}

/**
 * What an item is allowed to grant, judged once for both input paths.
 *
 * Typed content and parsed JSON both arrive at `checkContent`, so this is the
 * one gate — which is why it reads defensively rather than trusting the type.
 *
 * **A `standing` grant, a `pool` grant, a `casts` grant and a `confers`
 * grant.** Those are the four an item's readers execute — a benefit derived on
 * every read, charges, a spell it casts, and the effects it confers without
 * casting one. The rest are real and are coming, but a grant nothing executes
 * is an item whose line in the book quietly does nothing.
 */
function itemGrantProblems(
  item: CatalogueItem,
  /** Whether this catalogue holds an executable definition of that spell. */
  spellExists: (id: string) => boolean,
): readonly ContentProblem[] {
  const found: ContentProblem[] = [];
  const where = `items[${item.id}].grants`;
  const say = (code: string, reason: string, field = where): void => {
    found.push({ field, code, reason });
  };

  // Where the rolled charge maximum used to live, and where nothing reads it
  // any more. Refused rather than ignored, because an unknown field is data
  // written against a later engine and this one is data written against an
  // earlier one: a necklace carrying it would load clean and be beadless.
  if ((item as unknown as Record<string, unknown>)['chargesRolled'] !== undefined) {
    found.push({
      field: `items[${item.id}].chargesRolled`,
      code: 'rolled_uses_without_a_pool',
      reason: `a rolled charge maximum is a sizing of the item's charge pool and belongs in its "pool" grant as "usesRolled"; on ${item.id} itself nothing reads it`,
    });
  }

  let pools = 0;
  let conferrals = 0;
  const casts = new Set<string>();

  (item.grants ?? []).forEach((grant, index) => {
    const at = `${where}[${index}]`;
    if (grant === null || typeof grant !== 'object' || !isString((grant as { kind?: unknown }).kind)) {
      say('bad_item_grant', 'an item grant is an object naming its kind', at);
      return;
    }
    // A rolled charge maximum sizes a **pool**, and only `itemChargeRoll`
    // reads one, off the item's first pool grant. Written anywhere else it is
    // the failure the field's old home had — inert, and indistinguishable
    // from a line the transcriber thought had landed.
    if (grant.kind !== 'pool' && (grant as Record<string, unknown>)['usesRolled'] !== undefined) {
      say(
        'rolled_uses_without_a_pool',
        `${item.id} rolls for a charge maximum on a "${grant.kind}" grant, and a rolled maximum sizes the item's charge pool; nothing would read it here`,
        `${at}.usesRolled`,
      );
    }
    // And the same refusal about the other rolled field, for the same reason.
    // A rolled span is a **conferral's** lifetime — `useItem` throws it and
    // hangs the deadline it decided — and a benefit had by wearing the item or
    // by casting from it has no such moment to end at. Written on one of those
    // it would be inert, which is indistinguishable from a line the transcriber
    // thought had landed.
    if (
      grant.kind !== 'confers' &&
      (grant as Record<string, unknown>)['durationRolled'] !== undefined
    ) {
      say(
        'rolled_span_without_a_conferral',
        `${item.id} rolls for how long a "${grant.kind}" grant lasts, and a rolled span is the lifetime of what the item confers when it is used; nothing would read it here`,
        `${at}.durationRolled`,
      );
    }
    if (grant.kind === 'pool') {
      pools += 1;
      if (pools > 1) {
        // "This wand has 7 charges" is one sentence and one pool. Two would be
        // two pools on one id, and `itemChargePool` reads the first.
        say('two_item_pools', `${item.id} declares two charge pools, and an item has one`, at);
      }
      found.push(...itemPoolProblems(item, grant, at));
      return;
    }
    if (grant.kind === 'casts') {
      found.push(...itemCastsProblems(item, grant, at, spellExists, casts));
      return;
    }
    if (grant.kind === 'confers') {
      conferrals += 1;
      if (conferrals > 1) {
        // "When you drink this potion" is one sentence and one thing that
        // happens; `itemConferral` reads the first, and an item whose second
        // line silently never applied is the failure `unmodelled` prevents.
        say(
          'two_item_conferrals',
          `${item.id} confers twice, and two things happening when one item is used is a choice nothing can make`,
          at,
        );
      }
      found.push(...itemConfersProblems(item, grant, at));
      return;
    }
    if (grant.kind !== 'standing') {
      say(
        'item_grant_not_read',
        `nothing executes a "${grant.kind}" grant from an item yet; only a standing grant, a charge pool, a spell it casts and the effects it confers are read from one`,
        at,
      );
      return;
    }

    // An item has no class level and makes no choices, so the fields a class
    // feature reads off its table have nothing here to read.
    for (const field of [
      'diceCountByLevel',
      'feetByLevel',
      'onlyIfChoice',
      'damageTypesFromChoice',
      // And where a choice was made, which is the same answer one step out: an
      // item has no siblings to read one from either.
      'choiceFrom',
    ] as const) {
      if ((grant as unknown as Record<string, unknown>)[field] !== undefined) {
        say('item_grant_reads_a_level', `an item has no class level and no feature choices, so ${field} would never be read`, `${at}.${field}`);
      }
    }

    if (grant.reach !== 'self' && grant.reach !== 'aura') {
      say('bad_reach', `"${String(grant.reach)}" is neither "self" nor "aura"`, `${at}.reach`);
    }
    // A feature's aura borrows its size from whichever feature declares one;
    // an item is on its own, so an aura with no size would reach nobody.
    if (grant.reach === 'aura' && !(typeof grant.auraFeet === 'number' && grant.auraFeet > 0)) {
      say('aura_without_size', 'an item granting an aura says how big it is; no feature is there to declare it', `${at}.auraFeet`);
    }

    const effects = grant.effects ?? [];
    if (effects.length === 0) {
      say('empty_item_grant', 'an item grant with no effects grants nothing', `${at}.effects`);
    }
    effects.forEach((effect, position) => {
      const on = `${at}.effects[${position}]`;
      if (effect === null || typeof effect !== 'object' || !isString((effect as { kind?: unknown }).kind)) {
        say('bad_item_effect', 'a standing effect is an object naming its kind', on);
        return;
      }
      if (effect.kind === 'speed') {
        say('item_speed_grant', 'a Speed granted by an item is not read yet: `speedOf` gathers Speed from the sheet alone, because it is the function a `has-speed` requirement asks', on);
        return;
      }
      if (!ITEM_EFFECT_KINDS.has(effect.kind)) {
        say('bad_item_effect', `"${effect.kind}" is not a standing effect this engine grants`, on);
        return;
      }
      if (effect.kind === 'sense') {
        for (const problem of senseProblems(effect as unknown as Record<string, unknown>, on)) {
          say(problem.code, problem.reason, problem.field);
        }
        return;
      }
      // **The same rule a feature's is held to, and for a worse reason.** A
      // worn item's grants reach `actionRulesOn` through `itemStandingOf`, so
      // an allowance no command charges is data nothing reads — and a rule
      // that is not an object at all reaches `allowsPrice`, which reads its
      // `kind` and would throw where rule 6 wants a returned refusal. One
      // validator for all three doors.
      if (effect.kind === 'action-rule') {
        const problems: { field: string; code: string; reason: string }[] = [];
        checkActionRule(
          (effect as unknown as { readonly rule?: ActionRule }).rule,
          `${on}.rule`,
          problems,
        );
        for (const problem of problems) say(problem.code, problem.reason, problem.field);
        return;
      }
      if (effect.kind === 'ability-score-set') {
        for (const problem of abilitySetProblems(effect as unknown as Record<string, unknown>, on)) {
          say(problem.code, problem.reason, problem.field);
        }
        return;
      }
      if (effect.kind === 'check-bonus') {
        for (const problem of checkBonusProblems(effect as unknown as Record<string, unknown>, on)) {
          say(problem.code, problem.reason, problem.field);
        }
        return;
      }
      if (effect.kind === 'casting-healing') {
        for (const problem of castingHealingProblems(
          effect as unknown as Record<string, unknown>,
          on,
        )) {
          say(problem.code, problem.reason, problem.field);
        }
        return;
      }
      if (effect.kind === 'flat-bonus') {
        const applies = Array.isArray(effect.applies) ? effect.applies : null;
        if (applies === null) {
          say('bad_bonus_applies', 'a flat bonus names what it applies to as a list', `${on}.applies`);
          return;
        }
        if (applies.length === 0) {
          say(
            'bonus_applies_to_nothing',
            'a bonus that applies to nothing is a bonus nothing reads',
            `${on}.applies`,
          );
        }
        for (const aimed of applies) {
          if (!BONUS_APPLIES.has(aimed)) {
            say('bad_bonus_applies', `"${String(aimed)}" is not something a flat bonus reaches`, `${on}.applies`);
          }
        }
        // A number, and a number that does something: the SRD's rarities print
        // 1, 2 and 3, and a +0 is an item whose line silently does nothing.
        if (!Number.isInteger(effect.flat)) {
          say('bad_bonus_amount', 'a flat bonus is a whole number of points', `${on}.flat`);
        } else if (effect.flat === 0) {
          say('bonus_of_nothing', 'a bonus of zero adds nothing to anything', `${on}.flat`);
        }
        // "Made with this magic weapon" is a clause about a roll somebody makes
        // with an object in hand. An Armour Class is not one, so a narrowing on
        // it could never hold, and a benefit that never holds is the failure
        // this validator exists to refuse.
        if (effect.onlyWithItem === true && applies.some((aimed) => !MADE_WITH_AN_ITEM.has(aimed))) {
          say(
            'narrowing_without_a_roll',
            `only ${[...MADE_WITH_AN_ITEM].join(' and ')} rolls are made *with* an item, so "made with this item" could never hold for the rest`,
            `${on}.onlyWithItem`,
          );
        }
        // And the other narrowing, at the same door and by the same argument:
        // "with Ranged weapons" is a clause about a roll made *with* a weapon,
        // and an Armour Class is not one either.
        if (effect.onlyWithWeapon !== undefined) {
          for (const problem of weaponNarrowingProblems(effect.onlyWithWeapon, `${on}.onlyWithWeapon`)) {
            say(problem.code, problem.reason, problem.field);
          }
          if (applies.some((aimed) => !MADE_WITH_AN_ITEM.has(aimed))) {
            say(
              'narrowing_without_a_roll',
              `only ${[...MADE_WITH_AN_ITEM].join(' and ')} rolls are made *with* a weapon, so "with weapons like this" could never hold for the rest`,
              `${on}.onlyWithWeapon`,
            );
          }
        }
        return;
      }
      if (effect.kind === 'attack-die-rule') {
        for (const problem of attackDieRuleProblems(
          effect as unknown as Record<string, unknown>,
          on,
        )) {
          say(problem.code, problem.reason, problem.field);
        }
        if (effect.onlyWithWeapon !== undefined) {
          for (const problem of weaponNarrowingProblems(
            effect.onlyWithWeapon,
            `${on}.onlyWithWeapon`,
          )) {
            say(problem.code, problem.reason, problem.field);
          }
        }
        return;
      }
      if (effect.kind === 'roll-mode') {
        const modifier = effect.modifier;
        if (modifier === undefined || modifier === null || typeof modifier !== 'object') {
          say('bad_roll_modifier', 'a roll-mode effect carries a modifier', `${on}.modifier`);
          return;
        }
        if (modifier.mode !== 'advantage' && modifier.mode !== 'disadvantage') {
          say('bad_roll_mode', 'a granted mode is Advantage or Disadvantage; "normal" grants nothing', `${on}.modifier.mode`);
        }
        const selector = modifier.selector;
        if (selector === undefined || selector === null || typeof selector !== 'object') {
          say('bad_roll_selector', 'a modifier says which rolls it reaches', `${on}.modifier.selector`);
          return;
        }
        for (const problem of rollSelectorProblems(selector, (skill) => SKILL_ABILITY[skill])) {
          say(problem.code, problem.reason, `${on}.modifier.selector`);
        }
        // **Which roll it is, before anything is asked about that roll.**
        // `rollSelectorProblems` judges combinations — an ability on a roll
        // that has none, a counterpart on a roll that records none — and takes
        // the family as given, because its other caller has already refused an
        // unknown one. This door had not, so `{ roll: 'Attack' }` loaded clean
        // and picked out nothing for ever: a whole grant that never matched a
        // roll, which is the silent failure this validator exists to convert
        // into a refusal at authoring.
        if (!ROLL_FAMILIES.has(selector.roll)) {
          say(
            'bad_roll_family',
            `"${String(selector.roll)}" is not a kind of roll; a mode reaches ${[...ROLL_FAMILIES].join(', ')}`,
            `${on}.modifier.selector.roll`,
          );
          return;
        }
        // **And how it ends, which the selector says nothing about.** A grant
        // flagged `oneShot` is spent by the roll it changes, and only the two
        // attack rollers spend one — so on any other family the flag compiles,
        // the ring lands, and the grant then runs to its deadline like any
        // durable one. `spell-schema.ts` has refused that since the flag
        // existed and this door validated the modifier through its selector
        // alone, so the same sentence could be written on an item and quietly
        // mean something else. Asked below the family check for the reason it
        // is asked below one there: a family that is not a family draws that
        // problem and not a second one about its ending.
        if (modifier.oneShot === true) {
          const wrong = oneShotProblem(selector.roll);
          if (wrong !== null) say(wrong.code, wrong.reason, `${on}.modifier.oneShot`);
        }
      }
    });

    (grant.requires ?? []).forEach((requirement, position) => {
      if (!REQUIREMENT_KINDS.has(requirement?.kind)) {
        say('bad_requirement', `"${String(requirement?.kind)}" is not a standing requirement`, `${at}.requires[${position}]`);
      }
    });
  });

  return found;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The engine's own skill vocabulary, which is the one a stat block is held to. */
const SKILL_NAMES: ReadonlySet<string> = new Set<string>(SKILLS);

/** The same, for the two tables an object's numbers come out of. */
const DAMAGE_TYPE_NAMES: ReadonlySet<string> = new Set<string>(DAMAGE_TYPES);
const CREATURE_SIZE_NAMES: ReadonlySet<string> = new Set<string>(CREATURE_SIZES);

const byId = <T extends { readonly id: string }>(rows: readonly T[]): ReadonlyMap<string, T> =>
  new Map(rows.map((row) => [row.id, row]));

function duplicates(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of ids) (seen.has(id) ? twice : seen).add(id);
  return [...twice];
}

/**
 * Whether a catalogue is coherent. Every problem, not the first.
 *
 * Three kinds of rule, kept apart on purpose:
 *
 * - **each definition is well formed** — the spell validator and the feature
 *   validator, run on every spell and on every feature of every class,
 *   subclass, species and background, exactly as they would run on homebrew;
 * - **the population is consistent** — no two things share an id, a subclass
 *   names a class that exists, a fixed spell grant names a spell that exists,
 *   an entry and a definition for the same spell agree on level and school;
 * - **nothing here asks whether the content is official.** That is the SRD
 *   oracle's question, and it lives with the SRD content, because a DM's
 *   invented spell is valid engine data and is not in the book.
 */
/**
 * A grant about Initiative has to change something about Initiative.
 *
 * SRD Alert prints two benefits under one heading and the grant carries both
 * as flags, so either alone is a whole sentence and neither is a sentence
 * somebody meant to finish. Asked of a feat and of a feature alike, because
 * the kind is a member of the one vocabulary and `creation.ts` reads it off
 * both holders.
 */
function initiativeGrantProblems(
  declared: unknown,
  where: string,
  who: string,
): readonly ContentProblem[] {
  const grant = declared as Record<string, unknown>;
  if (grant['kind'] !== 'initiative') return [];
  if (grant['proficiency'] === true || grant['swap'] === true) return [];
  return [
    {
      field: where,
      code: 'empty_initiative_grant',
      reason: `${who} declares a grant about Initiative that neither adds the Proficiency Bonus nor allows the swap, so it changes nothing about Initiative`,
    },
  ];
}

/**
 * What a feat's `standing` grant may say, and the fields of it a feat cannot
 * mean.
 *
 * **A feat is not a feature and goes through none of the class-feature
 * passes.** `standingFromFeats` reads a feat's declaration on its own, and
 * what it can read is the plain sentence: the effects, and what must hold for
 * them. Every other field of the grant is resolved against something a feat
 * has not got —
 *
 * | Field | What answers it for a feature |
 * |---|---|
 * | `diceCountByLevel`, `feetByLevel` | a column of that class's own table |
 * | `onlyIfChoice`, `damageTypesFromChoice`, `choiceFrom` | a choice made on that feature or a sibling |
 * | `auraFeet` | whichever feature of the source declares the radius |
 *
 * — so each is refused rather than accepted and silently never read, which is
 * the whole argument `feat_grant_not_read` makes one level up.
 *
 * `reach` is the same refusal wearing the radius's clothes: an aura's size is
 * declared by a feature of the granting source and a feat belongs to no
 * source, so a feat's benefit is its holder's own.
 */
function featStandingProblems(
  declared: unknown,
  where: string,
  who: string,
): readonly ContentProblem[] {
  const problems: ContentProblem[] = [];
  const grant = declared as Record<string, unknown>;

  for (const field of [
    'diceCountByLevel',
    'feetByLevel',
    'onlyIfChoice',
    'damageTypesFromChoice',
    'choiceFrom',
    'auraFeet',
  ] as const) {
    if (grant[field] !== undefined) {
      problems.push({
        field: `${where}.${field}`,
        code: 'feat_grant_not_read',
        reason: `a feat has no class table and no feature choices, so ${field} would never be read off ${who}`,
      });
    }
  }

  if (grant['reach'] !== undefined && grant['reach'] !== 'self') {
    problems.push({
      field: `${where}.reach`,
      code: 'feat_grant_not_read',
      reason: `an aura's size is declared by a feature of the source granting it, and ${who} is a feat and belongs to no source, so its benefit is its holder's own`,
    });
  }

  const effects = grant['effects'];
  if (!Array.isArray(effects) || effects.length === 0) {
    problems.push({
      field: `${where}.effects`,
      code: 'empty_feat_grant',
      reason: `${who} declares a standing grant with no effects, which grants nothing`,
    });
    return problems;
  }

  effects.forEach((effect, position) => {
    const kind = (effect as { readonly kind?: unknown }).kind;
    if (effect === null || typeof effect !== 'object' || !isString(kind)) {
      problems.push({
        field: `${where}.effects[${position}]`,
        code: 'bad_feat_grant',
        reason: 'a standing effect is an object naming its kind',
      });
      return;
    }
    // The same refusal the item door makes with `ITEM_EFFECT_KINDS`, against
    // the whole union rather than against the one an item withholds. A kind
    // nothing grants is compiled onto the sheet and matched by no reader,
    // which is indistinguishable from a benefit that simply never applies.
    if (!STANDING_GRANT_KINDS.has(kind)) {
      problems.push({
        field: `${where}.effects[${position}]`,
        code: 'bad_feat_grant',
        reason: `"${kind}" is not a standing effect this engine grants, so ${who} would put a benefit on the sheet that no reader ever matches`,
      });
      return;
    }
    problems.push(
      ...ownedStandingEffectProblems(
        effect as StandingGrant,
        `${where}.effects[${position}]`,
        who,
      ),
    );
  });

  // The two requirements a grant's is looked up by an *item's* id — the same
  // door `item_requirement_on_a_feature` refuses one step along, and a feat is
  // no more an item than a class feature is.
  const requires = grant['requires'];
  if (Array.isArray(requires)) {
    requires.forEach((requirement, position) => {
      const kind = (requirement as { readonly kind?: unknown })?.kind;
      if (!isString(kind) || !REQUIREMENT_KINDS.has(kind)) {
        // The item door's refusal, at the door beside it: a clause
        // `requirementsHold` does not know is a clause it answers `true` to,
        // so a benefit gated on a condition nobody evaluates would simply
        // always apply — the confident wrong answer rather than the missing
        // one.
        problems.push({
          field: `${where}.requires[${position}]`,
          code: 'bad_feat_grant',
          reason: `"${String(kind)}" is not a requirement this engine evaluates, so ${who} would grant its benefit unconditionally`,
        });
        return;
      }
      if (ITEM_ONLY_REQUIREMENTS.has(kind)) {
        problems.push({
          field: `${where}.requires[${position}]`,
          code: 'item_requirement_on_a_feature',
          reason: `"${kind}" is read against the id of the item granting it, and ${who} is a feat rather than an item, so this would never hold`,
        });
      }
    });
  }

  return problems;
}

export function checkContent(input: ContentInput): readonly ContentProblem[] {
  const problems: ContentProblem[] = [];
  const spells = input.spells ?? [];
  const entries = input.spellEntries ?? [];
  const classes = input.classes ?? [];
  const subclasses = input.subclasses ?? [];
  const species = input.species ?? [];
  const backgrounds = input.backgrounds ?? [];
  const feats = input.feats ?? [];
  const items = input.items ?? [];
  const languages = input.languages ?? [];
  const alignments = input.alignments ?? [];
  const monsters = input.monsters ?? [];
  const objectMaterials = input.objectMaterials ?? [];
  const objectSizes = input.objectSizes ?? [];

  for (const [what, rows] of [
    ['spells', spells],
    ['spellEntries', entries],
    ['classes', classes],
    ['subclasses', subclasses],
    ['species', species],
    ['backgrounds', backgrounds],
    ['feats', feats],
    ['items', items],
    ['languages', languages],
    ['alignments', alignments],
    ['monsters', monsters],
    ['objectMaterials', objectMaterials],
    ['objectSizes', objectSizes],
  ] as const) {
    for (const id of duplicates(rows.map((row) => row.id))) {
      problems.push({ field: `${what}[${id}]`, code: 'duplicate_id', reason: `${what} holds ${id} twice` });
    }
    for (const row of rows) {
      if (!ID.test(row.id)) {
        problems.push({ field: `${what}[${row.id}]`, code: 'bad_id', reason: `"${row.id}" is not a lower-case hyphenated id` });
      }
    }
  }

  // The two object tables, held to the same judgement whichever door they came
  // through. A suggested Armour Class or a suggested hit point total that is
  // not a positive whole number is a row nothing could be built from, and a
  // hit points row keyed by something that is not a size is a row nobody could
  // ever look up: `declareObject` asks for `medium` and gets nothing back.
  for (const material of objectMaterials) {
    if (!Number.isInteger(material.armorClass) || material.armorClass < 1) {
      problems.push({
        field: `objectMaterials[${material.id}].armorClass`,
        code: 'bad_armor_class',
        reason: `an Armour Class is a whole number of at least 1, not ${material.armorClass}`,
      });
    }
    for (const type of Object.keys(material.defenses ?? {})) {
      if (DAMAGE_TYPE_NAMES.has(type)) continue;
      problems.push({
        field: `objectMaterials[${material.id}].defenses`,
        code: 'unknown_damage_type',
        reason: `"${type}" is not a damage type this engine knows, so the defence would never be applied`,
      });
    }
  }
  for (const row of objectSizes) {
    if (!CREATURE_SIZE_NAMES.has(row.id)) {
      problems.push({
        field: `objectSizes[${row.id}]`,
        code: 'unknown_size',
        reason: `"${row.id}" is not a size, and this table is keyed by the size it is for`,
      });
    }
    for (const [which, value] of [
      ['fragile', row.fragile],
      ['resilient', row.resilient],
    ] as const) {
      if (Number.isInteger(value) && value >= 1) continue;
      problems.push({
        field: `objectSizes[${row.id}].${which}`,
        code: 'bad_hit_points',
        reason: `a hit point maximum is a whole number of at least 1, not ${value}`,
      });
    }
  }

  // Languages and alignments are matched by the name on the sheet, so two of
  // either sharing a name is the same incoherence a duplicate id is.
  for (const [what, rows] of [
    ['languages', languages],
    ['alignments', alignments],
  ] as const) {
    for (const name of duplicates(rows.map((row) => row.name))) {
      problems.push({ field: `${what}[${name}]`, code: 'duplicate_name', reason: `${what} holds two things called ${name}, and a character's choice names one of them` });
    }
  }

  const entryOf = byId(entries);
  const known = new Set([...entries.map((e) => e.id), ...spells.map((s) => s.id)]);
  const spellExists = (id: string): boolean => known.has(id);

  for (const spell of spells) {
    for (const problem of checkSpellDefinition(spell)) {
      problems.push({ ...problem, field: `spells[${spell.id}].${problem.field}` });
    }
    const entry = entryOf.get(spell.id);
    if (entry !== undefined && (entry.level !== spell.level || entry.school !== spell.school)) {
      problems.push({
        field: `spells[${spell.id}]`,
        code: 'entry_disagrees',
        reason: `the definition says level ${spell.level} ${spell.school} and the entry says level ${entry.level} ${entry.school}`,
      });
    }
  }

  // **What a feat declares, held to what creation reads off one.** The same
  // rule an item's conferral keeps, for the same reason: a grant nothing
  // executes is a line in the book that quietly does nothing. Untyped input
  // reaches here as well as typed, so the shape is asked before the kind.
  for (const feat of feats) {
    problems.push(...abilityProblemsOfFeat(feat));
    const declared: unknown = (feat as { readonly grants?: unknown }).grants;
    if (declared === undefined) continue;
    const where = `feats[${feat.id}].grants`;
    if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
      problems.push({
        field: where,
        code: 'bad_feat_grant',
        reason: 'what a feat confers is one grant object, written in the feature grant vocabulary',
      });
      continue;
    }
    const kind: unknown = (declared as Record<string, unknown>)['kind'];
    if (typeof kind !== 'string') {
      problems.push({
        field: `${where}.kind`,
        code: 'bad_feat_grant',
        reason: 'a grant says which kind it is, as a string',
      });
      continue;
    }
    if (!FEAT_GRANT_KINDS.has(kind)) {
      problems.push({
        field: `${where}.kind`,
        code: 'feat_grant_not_read',
        reason: `nothing reads "${kind}" off a feat — creation compiles a class feature's grants onto the sheet and a feat goes through none of that — so ${feat.id} would declare a benefit nobody ever pays`,
      });
    }
    problems.push(...initiativeGrantProblems(declared, where, feat.id));
    if (kind === 'standing') problems.push(...featStandingProblems(declared, where, feat.id));
  }

  const classOf = byId(classes);
  const featureSources: {
    readonly where: string;
    readonly levels: number;
    readonly features: readonly FeatureDefinition[];
    readonly executedBySource?: ReadonlySet<string>;
    /**
     * Whether the class these features belong to casts at all.
     *
     * Asked because one member is read only off a **casting** class:
     * `classFeatureFreeCastings` in `creation.ts` runs over the classes that
     * have a `spellcasting` block, on that block's own ability, so a free
     * casting written anywhere else reaches no reader. A subclass inherits
     * the answer from its parent, which is where a class's spellcasting is
     * declared; a species and a background have no class and no ability.
     */
    readonly casts?: boolean;
    /**
     * Features of this source that a pool key may be looked up against —
     * this source's own, and its parent class's where it has one.
     *
     * A subclass feature spending a pool its class declared is a legal thing
     * to write and `poolsFor` reads both lists, so a check that asked only
     * about siblings would refuse the one arrangement the SRD's own
     * subclasses are in.
     */
    readonly inScope?: readonly FeatureDefinition[];
  }[] = [];
  const featOf = byId(feats);

  for (const definition of classes) {
    const where = `classes[${definition.id}]`;
    if (definition.table.length !== MAX_LEVEL) {
      problems.push({ field: `${where}.table`, code: 'bad_table', reason: `a class table has ${MAX_LEVEL} rows, not ${definition.table.length}` });
    }
    definition.table.forEach((row, index) => {
      if (row.level !== index + 1) {
        problems.push({ field: `${where}.table[${index}]`, code: 'bad_table', reason: `row ${index} is level ${row.level}` });
      }
    });
    if (definition.spellcasting !== undefined) {
      const casting = definition.spellcasting;
      const feature = casting.feature ?? 'spellcasting';
      if (feature === 'spellcasting' && casting.progression === undefined) {
        problems.push({ field: `${where}.spellcasting.progression`, code: 'no_progression', reason: 'a Spellcasting class says whether it is a full or a half caster; the multiclass slot table reads it' });
      }
      if (feature === 'pact-magic' && casting.progression !== undefined) {
        problems.push({ field: `${where}.spellcasting.progression`, code: 'pact_progression', reason: 'Pact Magic stays out of the multiclass slot table, so it has no progression' });
      }
    }
    if (!Number.isInteger(definition.hitDie) || definition.hitDie < 4) {
      problems.push({ field: `${where}.hitDie`, code: 'bad_hit_die', reason: `a Hit Die has at least four faces, not ${definition.hitDie}` });
    }
    // The class's own spellcasting block executes exactly one of its features.
    const casting = definition.spellcasting;
    const executedBySource =
      casting === undefined
        ? undefined
        : new Set([`${definition.id}:${casting.feature ?? 'spellcasting'}`]);
    featureSources.push({
      where,
      levels: definition.table.length,
      features: definition.features,
      casts: casting !== undefined,
      ...(executedBySource === undefined ? {} : { executedBySource }),
    });
  }

  for (const subclass of subclasses) {
    const where = `subclasses[${subclass.id}]`;
    const parent = classOf.get(subclass.classId);
    if (parent === undefined) {
      problems.push({ field: `${where}.classId`, code: 'unknown_class', reason: `${subclass.id} belongs to ${subclass.classId}, which this content does not hold` });
    }
    featureSources.push({
      where,
      levels: parent?.table.length ?? MAX_LEVEL,
      features: subclass.features,
      casts: parent?.spellcasting !== undefined,
      inScope: [...subclass.features, ...(parent?.features ?? [])],
    });
  }
  for (const one of species) {
    featureSources.push({ where: `species[${one.id}]`, levels: MAX_LEVEL, features: one.features });
  }
  for (const one of backgrounds) {
    featureSources.push({ where: `backgrounds[${one.id}]`, levels: MAX_LEVEL, features: one.features });
  }

  for (const source of featureSources) {
    const context: FeatureContext = {
      levels: source.levels,
      readableGrants: READABLE_GRANT_KINDS,
      readableFields: READABLE_FEATURE_FIELDS,
      spellExists,
      ...(source.executedBySource === undefined ? {} : { executedBySource: source.executedBySource }),
    };
    const own = byId(source.features);
    source.features.forEach((feature, index) => {
      const where = `${source.where}.features[${index}]`;
      for (const problem of checkFeatureDefinition(feature, context)) {
        problems.push({ ...problem, field: `${where}.${problem.field}` });
      }
      // The two requirements an item's grant is looked up by — see
      // {@link ITEM_ONLY_REQUIREMENTS}. On a class feature they name nothing.
      //
      // **Asked of every grant that carries a gate, not of `standing` alone.**
      // `requirementsHold` is one evaluator over one vocabulary, so a second
      // member carrying `requires` inherits the trap along with the clause: a
      // style written "while worn" would look the clause up against a feature
      // id, hold never, and say nothing about it — which is precisely the
      // silence this refusal exists to break.
      //
      // Asked of the **field** rather than of a list of kinds that carry it,
      // so a third member joining them is covered by the day it compiles. A
      // list would be exhaustive only as long as somebody kept it so, and this
      // refusal exists because the last thing nobody kept was believed.
      const gated: readonly StandingRequirement[] =
        feature.grants !== undefined && 'requires' in feature.grants
          ? (feature.grants.requires ?? [])
          : [];
      gated.forEach((requirement, position) => {
        if (ITEM_ONLY_REQUIREMENTS.has(requirement.kind)) {
          problems.push({
            field: `${where}.grants.requires[${position}]`,
            code: 'item_requirement_on_a_feature',
            reason: `"${requirement.kind}" is read against the id of the item granting it, and a class feature is not an item, so this would never hold`,
          });
        }
      });
      if (feature.grants?.kind === 'standing') {
        (feature.grants.effects ?? []).forEach((effect, position) => {
          // **`checkFeatureDefinition` above already held this one**, at this
          // very path, and a problem reported twice is a problem an author
          // fixes once and sees again. It is in the shared function because a
          // **feat** reaches neither this loop's sibling nor that call — see
          // `speedGrantProblems` — and it is skipped here because a feature
          // reaches both.
          if (effect.kind === 'speed') return;
          for (const problem of ownedStandingEffectProblems(
            effect,
            `${where}.grants.effects[${position}]`,
            feature.id,
          )) {
            problems.push({ field: problem.field, code: problem.code, reason: problem.reason });
          }
        });
      }
      // A trade, and the four things a catalogue can write here that nothing
      // downstream could recover from: two trades a command could not tell
      // apart, a slot bought at no level (`spellSlotKey` throws on one, which
      // is a refusal arriving as a crash), a trade of no uses, and a limit
      // with nowhere to be counted — "you can't do so again until you finish a
      // Long Rest" with no pool of one behind it is no limit at all.
      if (feature.grants?.kind === 'trade') {
        const trades = feature.grants.trades ?? [];
        if (trades.length === 0) {
          problems.push({
            field: `${where}.grants.trades`,
            code: 'empty_trade',
            reason: `${feature.id} trades nothing for anything, so nothing would ever read it`,
          });
        }
        // The pool the feature itself declares, which is a key and a sizing or
        // neither: a key with no sizing is a pool nothing gives a maximum, and
        // a sizing with no key is a maximum on nothing.
        const declaring = feature.grants.pool !== undefined;
        const sizing = feature.grants.declares !== undefined;
        if (declaring !== sizing) {
          problems.push({
            field: declaring ? `${where}.grants.declares` : `${where}.grants.pool`,
            code: 'half_a_declared_pool',
            reason: `${feature.id} declares ${declaring ? 'a pool with no sizing' : 'a sizing with no pool key'}, and a pool is both`,
          });
        }
        if (declaring && feature.grants.pool!.trim() === '') {
          problems.push({
            field: `${where}.grants.pool`,
            code: 'bad_trade_pool',
            reason: 'a pool is found by its key, and a blank one names nothing',
          });
        }
        const seen = new Set<string>();
        trades.forEach((trade, position) => {
          const at = `${where}.grants.trades[${position}]`;
          if (typeof trade?.id !== 'string' || trade.id.trim() === '') {
            problems.push({
              field: `${at}.id`,
              code: 'bad_trade_id',
              reason: 'a trade is named, because a command says which of a feature’s trades it means',
            });
          } else if (seen.has(trade.id)) {
            problems.push({
              field: `${at}.id`,
              code: 'duplicate_trade',
              reason: `${feature.id} offers two trades called ${trade.id}, and a command naming one would find either`,
            });
          } else {
            seen.add(trade.id);
          }

          for (const [side, end] of [
            ['spends', trade?.spends],
            ['gains', trade?.gains],
          ] as const) {
            // The other end, which is what a `the-slot-level` amount reads and
            // what a price table is indexed by.
            //
            // **The level it reads is the one the *caller* names**, and that
            // is the whole of the rule rather than a detail of it: the command
            // has a slot level in hand only where the spent end is a slot the
            // grant left unlevelled, so `the-slot-level` anywhere else sizes
            // itself from nothing and the trade runs for a zero it does not
            // refuse. Exactly the shape of `price_table_without_a_choice`
            // below, which is the same mistake at the other end.
            const other = side === 'spends' ? trade?.gains : trade?.spends;
            const readsASlot =
              side === 'gains' && other?.kind === 'spell-slot' && other.level === undefined;
            if (end?.kind === 'pool') {
              if (typeof end.key !== 'string' || end.key.trim() === '') {
                problems.push({
                  field: `${at}.${side}.key`,
                  code: 'bad_trade_pool',
                  reason: 'a pool is found by its key, and a blank one names nothing',
                });
              }
              // SRD Font of Magic: "a number of Sorcery Points equal to the
              // slot's level". There must *be* a slot in the trade for it to
              // read, and on a trade of two pools it would read nothing.
              if (end.uses === 'the-slot-level') {
                if (!readsASlot) {
                  problems.push({
                    field: `${at}.${side}.uses`,
                    code: 'no_slot_level_to_read',
                    reason: `${feature.id} sizes what it ${side} by a slot's level, and this trade expends no spell slot whose level the caster names, so there is no level to read`,
                  });
                }
              } else if (typeof end.uses === 'object' && end.uses !== null) {
                // The Created Spell Slots table prices a slot that is bought
                // at a level the caller names. On the gained end it would be a
                // price nobody paid; against a slot the *grant* levels it
                // would be a table with one readable row and no choice.
                const costs = (end.uses as { byBoughtSlotLevel?: unknown }).byBoughtSlotLevel;
                if (side === 'gains') {
                  problems.push({
                    field: `${at}.gains.uses`,
                    code: 'price_table_on_what_is_bought',
                    reason:
                      'a price table is what an end pays, and on the end that is gained it would be a price nothing charged',
                  });
                } else if (!(other?.kind === 'spell-slot' && other.level === undefined)) {
                  problems.push({
                    field: `${at}.spends.uses`,
                    code: 'price_table_without_a_choice',
                    reason: `${feature.id} prices a slot by the level bought, and this trade buys no slot whose level the caller names`,
                  });
                }
                if (!Array.isArray(costs) || costs.length === 0 || costs.length > 9) {
                  problems.push({
                    field: `${at}.${side}.uses.byBoughtSlotLevel`,
                    code: 'bad_slot_price_table',
                    reason: `a price table has a row for each slot level it creates, from one to nine, not ${JSON.stringify(costs)}`,
                  });
                } else if (costs.some((cost) => !Number.isInteger(cost) || cost < 1)) {
                  problems.push({
                    field: `${at}.${side}.uses.byBoughtSlotLevel`,
                    code: 'bad_slot_price',
                    reason: `a slot costs a whole number of at least one, and ${JSON.stringify(costs)} has a row that is not`,
                  });
                }
              } else if (!Number.isInteger(end.uses) || end.uses < 1) {
                problems.push({
                  field: `${at}.${side}.uses`,
                  code: 'bad_trade_amount',
                  reason: `a trade moves a whole number of uses of at least one, not ${JSON.stringify(end.uses)}`,
                });
              }
            } else if (end?.kind === 'spell-slot') {
              // The level is the caster's where a slot is *spent*, and where
              // one is bought it is either the grant's — "give yourself **a
              // level 1** spell slot" — or the caller's, which is what the
              // other end's price table makes it. A bought slot with neither
              // is a level nothing supplies.
              const pricedByTheOtherEnd =
                other?.kind === 'pool' && typeof other.uses === 'object' && other.uses !== null;
              if (side === 'gains' && end.level === undefined && !pricedByTheOtherEnd) {
                problems.push({
                  field: `${at}.gains.level`,
                  code: 'slot_without_a_level',
                  reason:
                    'a slot given back is of a level the feature names, or of one the caller names and the other end prices; this one has neither',
                });
              }
              if (end.level !== undefined && (!Number.isInteger(end.level) || end.level < 1 || end.level > 9)) {
                problems.push({
                  field: `${at}.${side}.level`,
                  code: 'bad_slot_level',
                  reason: `spell slots run from level 1 to 9, not ${JSON.stringify(end.level)}`,
                });
              }
            } else if (end?.kind === 'spell-slots') {
              // SRD Arcane Recovery is the one sentence of this shape and it
              // is on the bought end. Nothing in the book burns a handful of
              // slots at once, and `tradeResource` spends exactly one key.
              if (side === 'spends') {
                problems.push({
                  field: `${at}.spends`,
                  code: 'slots_spent_together',
                  reason:
                    'a budget of combined slot levels is what a trade buys; nothing in the book expends several slots in one act',
                });
              }
              if (end.combinedLevel !== 'half-class-level-round-up') {
                problems.push({
                  field: `${at}.${side}.combinedLevel`,
                  code: 'bad_combined_level',
                  reason: `the one budget the SRD prints is half the class level rounded up, and "${String((end as { combinedLevel?: unknown }).combinedLevel)}" is not it`,
                });
              }
              if (!Number.isInteger(end.maxLevel) || end.maxLevel < 1 || end.maxLevel > 9) {
                problems.push({
                  field: `${at}.${side}.maxLevel`,
                  code: 'bad_slot_level',
                  reason: `spell slots run from level 1 to 9, not ${JSON.stringify(end.maxLevel)}`,
                });
              }
            } else {
              problems.push({
                field: `${at}.${side}`,
                code: 'bad_trade_resource',
                reason: `"${String((end as { kind?: unknown })?.kind)}" is not something this engine trades: a pool, a spell slot, or slots inside a combined-level budget`,
              });
            }
          }

          if (trade?.moment !== undefined && trade.moment !== 'short-rest') {
            problems.push({
              field: `${at}.moment`,
              code: 'bad_trade_moment',
              reason: `the one moment the SRD hangs a trade on is the end of a Short Rest, and "${String((trade as { moment?: unknown }).moment)}" is not it`,
            });
          }

          if (trade?.limit === 'once-per-long-rest' && trade.pool === undefined) {
            problems.push({
              field: `${at}.pool`,
              code: 'limit_without_a_pool',
              reason:
                'a once-a-day limit is a pool of one, the reading a recovery grant already takes; without one nothing counts the use',
            });
          }
          if (trade?.limit === 'once-per-turn' && trade.pool !== undefined) {
            problems.push({
              field: `${at}.pool`,
              code: 'pool_without_a_limit',
              reason:
                'a once-a-turn trade is counted by the turn’s own ledger, so a pool declared beside it is one nothing ever spends',
            });
          }
          // And the third arm, whose pool is the other sentence: an unlimited
          // trade declares a pool of one only when that pool is what it fills
          // — SRD Holy Nimbus's own single use, which the feature has no
          // second grant to declare. One declared anywhere else is a pool
          // nothing ever spends, which is `pool_without_a_limit`'s failure
          // wearing the new member's name.
          if (
            trade?.limit === 'unlimited' &&
            trade.pool !== undefined &&
            !(trade.gains?.kind === 'pool' && trade.gains.key === trade.pool)
          ) {
            problems.push({
              field: `${at}.pool`,
              code: 'pool_without_a_limit',
              reason: `${feature.id} prints no limit, so the pool of one it declares is the use it buys back; "${trade.pool}" is not what this trade fills, and nothing would ever spend it`,
            });
          }
          if (
            trade?.limit !== 'once-per-turn' &&
            trade?.limit !== 'once-per-long-rest' &&
            trade?.limit !== 'unlimited'
          ) {
            problems.push({
              field: `${at}.limit`,
              code: 'bad_trade_limit',
              reason: `a trade is limited once a turn, once a Long Rest, or not at all, and "${String((trade as { limit?: unknown } | undefined)?.limit)}" is none of the three`,
            });
          }
        });
      }
      // The item's own sizing, on a class feature. `poolSizeOf` reads a column,
      // a modifier or a multiple of the level and never a flat count, so a
      // feature naming one would be sized by a number nothing reads — the same
      // failure `item_requirement_on_a_feature` above names, in the other
      // direction.
      if (feature.grants?.kind === 'pool' && feature.grants.uses !== undefined) {
        problems.push({
          field: `${where}.grants.uses`,
          code: 'item_sizing_on_a_feature',
          reason: `a flat number of uses is how an item's line sizes its charges, and poolSizeOf sizes a feature's pool from its class table, so ${feature.id} would be sized by a number nothing reads`,
        });
      }
      // What a use of the pool buys, where what it buys is an effect list.
      // Judged by the conferral's own rules with the one difference a feature
      // makes — it has a caster — and against this source's own table, whose
      // length is what a class-table column has to match.
      if (feature.grants?.kind === 'pool' && feature.grants.options !== undefined) {
        problems.push(
          ...featureOptionsProblems(
            feature.id,
            feature.grants.options,
            `${where}.grants.options`,
            source.levels,
          ),
        );
      }
      // A form another feature's menu takes — SRD Preserve Life joining
      // Channel Divinity's. The options themselves are judged by the rules the
      // host's own menu is judged by, because they *are* that menu's; what is
      // checked here is the half a definition cannot check for itself, and it
      // is `free_casting_pool_arrives_later`'s rule one grant along. A form
      // that names a menu nobody in scope prints, one that arrives before the
      // menu does, or one whose id the host already uses is a line on a class
      // table that looks executed and reaches nobody.
      // The same sentence asked of a feature, because the kind is a member of
      // the one vocabulary and a homebrew class feature may print it.
      if (feature.grants !== undefined) {
        problems.push(
          ...initiativeGrantProblems(feature.grants, `${where}.grants`, feature.id),
        );
      }

      // What a use of this pool buys in the turn budget. A purchase that adds
      // nothing is the failure `empty_feature_option` names one menu along,
      // and a count of zero attacks is the same thing wearing a number.
      if (feature.grants?.kind === 'pool' && feature.grants.buysBudget !== undefined) {
        const purchases = feature.grants.buysBudget;
        const seen = new Set<string>();
        purchases.forEach((purchase, at) => {
          const field = `${where}.grants.buysBudget[${at}]`;
          if (purchase.extraAction === undefined && purchase.extraAttacks === undefined) {
            problems.push({
              field,
              code: 'empty_budget_purchase',
              reason: `${feature.id}'s "${purchase.name}" spends a use and adds nothing to the turn`,
            });
          }
          if (purchase.extraAttacks !== undefined && purchase.extraAttacks.count < 1) {
            problems.push({
              field: `${field}.extraAttacks.count`,
              code: 'empty_budget_purchase',
              reason: `${feature.id}'s "${purchase.name}" buys no attacks at all`,
            });
          }
          if (seen.has(purchase.id)) {
            problems.push({
              field: `${field}.id`,
              code: 'duplicate_budget_purchase',
              reason: `${feature.id} sells two things called "${purchase.id}", and the caller names one`,
            });
          }
          seen.add(purchase.id);
        });
      }

      if (feature.grants?.kind === 'pool-options') {
        const grant = feature.grants;
        if (!isString(grant.feature) || grant.feature.trim() === '') {
          problems.push({
            field: `${where}.grants.feature`,
            code: 'option_menu_unnamed',
            reason: `${feature.id} adds a form to a menu and names none; the menu belongs to the feature that declares the pool`,
          });
        }
        if (!Array.isArray(grant.options) || grant.options.length === 0) {
          problems.push({
            field: `${where}.grants.options`,
            code: 'empty_option_menu',
            reason: `${feature.id} adds nothing to the menu it names`,
          });
        } else {
          problems.push(
            ...featureOptionsProblems(
              feature.id,
              grant.options,
              `${where}.grants.options`,
              source.levels,
            ),
          );
        }

        const hosts = (source.inScope ?? source.features).filter(
          (one) => one.id === grant.feature && one.grants?.kind === 'pool',
        );
        const host = hosts[0];
        if (host === undefined) {
          problems.push({
            field: `${where}.grants.feature`,
            code: 'unknown_option_menu',
            reason: `${feature.id} adds a form to "${String(grant.feature)}", and no feature of ${source.where} declares a pool by that name — a menu is a pool grant's, and a subclass may join its own class's`,
          });
        } else if (host.level > feature.level) {
          problems.push({
            field: `${where}.grants.feature`,
            code: 'option_menu_arrives_later',
            reason: `${feature.id} arrives at level ${feature.level} and joins a menu ${host.id} does not print until ${host.level}, so every use in between would find no such option`,
          });
        } else {
          const taken = new Set(
            (host.grants?.kind === 'pool' ? (host.grants.options ?? []) : []).map((one) => one.id),
          );
          for (const option of Array.isArray(grant.options) ? grant.options : []) {
            if (!taken.has(option?.id)) continue;
            problems.push({
              field: `${where}.grants.options`,
              code: 'duplicate_feature_option',
              reason: `${host.id} already offers "${option.id}", and a caller naming it could reach only the first`,
            });
          }
        }
      }
      // What a **hit** buys, judged by the same rules one trigger along: the
      // effects are the conferral's, the fields an action owns are refused,
      // and what is checked here is the trigger's own — the pool it spends,
      // what one costs, and the weapons the swing has to have been made with.
      if (feature.grants?.kind === 'on-hit') {
        problems.push(
          ...hitRiderProblems(feature.id, feature.grants, `${where}.grants`, source.levels),
        );
      }
      // And the item's other sizing, refused for the sharper half of the same
      // reason: no class table has ever rolled, and only the doors that hand
      // an item copy over can roll one.
      if (feature.grants?.kind === 'pool' && feature.grants.usesRolled !== undefined) {
        problems.push({
          field: `${where}.grants.usesRolled`,
          code: 'item_rolled_sizing_on_a_feature',
          reason: `a rolled charge maximum is an item copy's, rolled once by the door that hands the copy over; a class table has never rolled, so ${feature.id} would be sized by dice nothing throws`,
        });
      }
      // The item's own route, on a class feature — the same door again. SRD
      // "Spells Cast from Items" is about an item, the charges it spends are
      // looked up by the granting item's id, and a class feature has none. A
      // feature that grants spells has `kind: 'spells'`, which is executed.
      if (feature.grants?.kind === 'casts') {
        problems.push({
          field: `${where}.grants`,
          code: 'item_casting_on_a_feature',
          reason: `"casts" is an item casting a spell from its own charges, looked up by the granting item's id, and ${feature.id} is not an item; a feature that grants a spell declares it with a "spells" grant`,
        });
      }
      // And the other half of the same SRD sentence, refused for the same
      // reason: a conferral is used up and the thing used up is the *item*,
      // so `useItem` looks it up by catalogue id and takes one off the
      // inventory. A feature confers an effect list too, and what pays for it
      // is a use of its own pool — so the message names the grant that does
      // it rather than sending an author to a shape that cannot.
      if (feature.grants?.kind === 'confers') {
        problems.push({
          field: `${where}.grants`,
          code: 'item_conferral_on_a_feature',
          reason: `"confers" is an item conferring an effect without casting a spell, and the item is used up doing it; ${feature.id} is not an item, so nothing would be spent — a feature confers an effect list through the "options" its own "pool" grant carries`,
        });
      }
      // A menu of things a casting may buy — SRD Metamagic. The half a
      // definition cannot check for itself: the options are filtered at
      // creation by the answer the player gave *this feature's* own `option`
      // choice, so an option the choice does not offer can never be taken and
      // would sit on the class table unreachable. That is the failure this
      // whole file exists to catch, and it looks perfectly well formed.
      if (feature.grants?.kind === 'casting-options') {
        problems.push(
          ...castingOptionProblems(feature, feature.grants, `${where}.grants`),
        );
      }
      // A feature executed by another names one on the same source that
      // actually declares something; otherwise the claim just moves.
      if (feature.executedBy !== undefined) {
        const executor = own.get(feature.executedBy);
        const declares =
          executor !== undefined &&
          [...READABLE_FEATURE_FIELDS].some(
            (field) => (executor as unknown as Record<string, unknown>)[field] !== undefined,
          );
        if (executor === undefined || executor.id === feature.id || !declares) {
          problems.push({
            field: `${where}.executedBy`,
            code: 'bad_executed_by',
            reason: `${feature.id} says ${feature.executedBy} executes it, and no feature of that id on ${source.where} declares anything a reader reads`,
          });
        }
      }
      // A pool whose recovery a later feature rewrites names a feature this
      // character could actually hold, which is `executedBy`'s reason with its
      // failure: the rewrite is gated on holding the feature named, so an id
      // nobody prints is a sentence that never fires, and the pool keeps the
      // tag it was declared with while the class file reads as though it does
      // not. Silence rather than a refusal is what this file turns into a
      // problem.
      //
      // **Read against `inScope` rather than against siblings**, for the
      // reason that field exists: `recoveryOf` gates on the whole feature
      // list a character earned, class and subclass together, so a subclass
      // pool a class feature moves is a legal thing to write and asking only
      // about siblings would refuse it.
      if (feature.grants?.kind === 'pool' && feature.grants.recoversSooner !== undefined) {
        const named = feature.grants.recoversSooner.withFeature;
        const rewriter = byId(source.inScope ?? source.features).get(named);
        if (rewriter === undefined || rewriter.id === feature.id) {
          problems.push({
            field: `${where}.grants.recoversSooner.withFeature`,
            code: 'bad_recovery_rewrite',
            reason: `${feature.id} says ${named} rewrites its recovery, and no other feature ${source.where} reaches carries that id`,
          });
        }
      }
      // A casting the feature pays for out of a pool, judged by the two
      // things a definition cannot check for itself: whether anything here
      // will ever read it, and whether the pool it spends exists.
      //
      // The first is the door `item_casting_on_a_feature` above is: a free
      // casting is compiled by the loop over this character's **casting
      // classes**, on that class's own spellcasting ability, so one written
      // on a species, a background or a class that casts nothing declares a
      // pool nothing can spend and a route nobody has. The second is the
      // reading `choiceFrom` below takes of a sibling — a pool a feature
      // spends without declaring is another feature's, and a key that names
      // none is a casting that refuses at the table rather than here.
      if (feature.grants?.kind === 'spells' && feature.grants.freeCasting !== undefined) {
        const free = feature.grants.freeCasting;
        if (source.casts !== true) {
          problems.push({
            field: `${where}.grants.freeCasting`,
            code: 'free_casting_without_a_caster',
            reason: `a casting without a slot is made with the granting class's own spellcasting ability, and ${source.where} supplies none, so ${feature.id} would declare a pool nothing spends`,
          });
        }
        if (free.declares === undefined && typeof free.pool === 'string') {
          const declaring = (source.inScope ?? source.features).filter((one) =>
            poolKeysOf(one).includes(free.pool),
          );
          if (declaring.length === 0) {
            problems.push({
              field: `${where}.grants.freeCasting.pool`,
              code: 'unknown_free_casting_pool',
              reason: `${feature.id} spends "${free.pool}" and declares nothing, and no feature of ${source.where} declares a pool by that name — a free casting sizes its own pool through "declares" or comes out of one a feature beside it declared`,
            });
          } else if (declaring.every((one) => one.level > feature.level)) {
            problems.push({
              field: `${where}.grants.freeCasting.pool`,
              code: 'free_casting_pool_arrives_later',
              reason: `${feature.id} arrives at level ${feature.level} and spends a pool ${declaring[0]!.id} does not declare until ${declaring[0]!.level}, so every casting in between would be refused for want of a pool`,
            });
          }
        }
      }
      // A grant written in terms of another feature's choice — the SRD's
      // ancestries, lineages and legacies. The half a definition cannot check
      // for itself: whether the feature it names is a sibling that asks
      // anything, and whether the table on that sibling supplies what this
      // grant came to read. Both failures look perfectly well formed one
      // definition at a time and grant nothing at all.
      if (feature.grants?.kind === 'standing') {
        const grant = feature.grants;
        const from = grant.choiceFrom;
        const chooser = from === undefined ? feature : own.get(from);
        if (from !== undefined && (chooser === undefined || chooser.id === feature.id)) {
          problems.push({
            field: `${where}.grants.choiceFrom`,
            code: 'bad_choice_from',
            reason:
              chooser === undefined
                ? `${feature.id} reads the choice made on ${from}, and ${source.where} has no such feature — a choice is read from a sibling of the same source, because that is the only place one is guaranteed to have been asked`
                : `${feature.id} names itself as where its choice was made, which is what leaving the field out already says`,
          });
        } else if (chooser !== undefined) {
          if (from !== undefined && chooser.choice === undefined) {
            problems.push({
              field: `${where}.grants.choiceFrom`,
              code: 'choice_from_asks_nothing',
              reason: `${feature.id} reads the choice made on ${chooser.id}, and ${chooser.id} asks the player for nothing`,
            });
          } else if (from !== undefined && chooser.level > feature.level) {
            problems.push({
              field: `${where}.grants.choiceFrom`,
              code: 'choice_from_arrives_later',
              reason: `${feature.id} arrives at level ${feature.level} and reads a choice ${chooser.id} does not ask until ${chooser.level}, so it would grant nothing in between and say so nowhere`,
            });
          }
          // And the table, wherever it sits: a grant reading damage types out
          // of one needs every meaning to carry some. A meaning carrying
          // nothing this engine knows is legal until something reads it.
          const table = chooser.optionMeans;
          if (table !== undefined && grant.damageTypesFromChoice === true) {
            // The path points at the table, which is on the feature that asked
            // the question rather than on the one reading the answer.
            const at = source.features.indexOf(chooser);
            for (const [option, meaning] of Object.entries(table)) {
              if (meaning?.damageTypes === undefined) {
                problems.push({
                  field: `${source.where}.features[${at}].optionMeans.${option}`,
                  code: 'option_means_unusable',
                  reason: `${feature.id} reads damage types out of ${chooser.id}'s table, and ${option} names none, so a character who took it would resist nothing`,
                });
              }
            }
          }
        }
      }
      // A feat a feature grants outright has to exist, when the catalogue holds feats at all.
      const granted = feature.grantsFeat?.featId;
      if (granted !== undefined && feats.length > 0 && !featOf.has(granted)) {
        problems.push({
          field: `${where}.grantsFeat.featId`,
          code: 'unknown_feat',
          reason: `${feature.id} grants the feat ${granted}, which this content does not hold`,
        });
      }
    });
  }
  for (const id of duplicateFeatureIds(featureSources.flatMap((source) => source.features))) {
    problems.push({ field: `features[${id}]`, code: 'duplicate_feature_id', reason: `two features share the id ${id}` });
  }

  const itemOf = byId(items);
  /**
   * One key, one pool. Two items sharing a charge key would be one pool on
   * whoever held both: the wand's charges would empty the staff's, and
   * `declarePool` would refuse the second item outright at the moment it was
   * picked up. Cross-item because that is the scope a collision has.
   */
  const poolKeys = new Map<string, string>();
  for (const item of items) {
    const pool = itemChargePool(item);
    if (pool === null) continue;
    const owner = poolKeys.get(pool.key);
    if (owner !== undefined) {
      problems.push({
        field: `items[${item.id}].grants`,
        code: 'duplicate_pool_key',
        reason: `${item.id} and ${owner} both keep their charges under ${pool.key}, and a creature holding both would have one pool`,
      });
    } else {
      poolKeys.set(pool.key, item.id);
    }
  }
  /**
   * What a spell conjures has to be a thing this catalogue holds, and has to
   * be a thing with **nothing to remember**.
   *
   * The first half is the rule `contents` already keeps one loop down: an id
   * that names nothing would be a spell that puts nothing in a hand.
   *
   * The second is the one gain semantics, kept. A copy whose record has state
   * of its own — today, a charge pool — is labelled at the door it is gained
   * through and its pool declared beside it (`issueItemCopies`). A conjured
   * handful is a **stack** by construction: ten berries appear as ten of one
   * line, and labelling them would be ten copies and ten pools for one
   * sentence. So rather than a fourth labelling door, a thing that lasts only
   * as long as a casting may not have charges to keep — which is also what it
   * means for a thing that disappears when the spell ends.
   *
   * A catalogue with no items at all judges nothing, on the rule `byClass`
   * above already follows: a fixture that holds only spells is not a catalogue
   * whose conjurings are broken.
   */
  if (items.length > 0) {
    for (const spell of spells) {
      const conjures = spell.conjures;
      if (conjures === undefined) continue;
      const conjured = itemOf.get(conjures.item);
      if (conjured === undefined) {
        problems.push({
          field: `spells[${spell.id}].conjures.item`,
          code: 'unknown_item',
          reason: `${spell.id} conjures ${conjures.item}, which this content does not hold`,
        });
        continue;
      }
      if (itemChargePool(conjured) !== null) {
        problems.push({
          field: `spells[${spell.id}].conjures.item`,
          code: 'conjured_item_has_charges',
          reason: `${conjures.item} keeps charges of its own, and a conjured handful is one line rather than one copy per thing; a thing that lasts as long as a casting has nothing to remember`,
        });
      }
    }
  }

  for (const item of items) {
    for (const line of item.contents) {
      if (!itemOf.has(line.id)) {
        problems.push({ field: `items[${item.id}].contents`, code: 'unknown_item', reason: `${item.id} contains ${line.id}, which this content does not hold` });
      }
    }
    // "Requires attunement by a Druid" names a class this catalogue has to
    // hold, on the same rule a subclass's parent class does.
    for (const wanted of item.attunement?.byClass ?? []) {
      if (classes.length > 0 && !classOf.has(wanted)) {
        problems.push({ field: `items[${item.id}].attunement.byClass`, code: 'unknown_class', reason: `${item.id} may be attuned by a ${wanted}, which this content does not hold` });
      }
    }
    problems.push(...itemUnmodelledProblems(item));
    // A catalogue with no spells at all judges nothing about which spells an
    // item casts, on the same rule `byClass` already follows above: a fixture
    // that holds only items is not a catalogue whose wands cast nothing.
    problems.push(
      ...itemGrantProblems(item, (id) => spells.length === 0 || spells.some((s) => s.id === id)),
    );
  }

  /**
   * **What a stat block claims, held to what the adapter reads.**
   *
   * Two questions, and the first is asked with `MonsterSchema` rather than a
   * transcription of it. **Is the block a block at all** — ability scores in
   * range, an Armour Class of at least 1, average hit points of at least 1, a
   * size drawn from the enum `positioning.ts` reads, and the forty fields
   * `adaptMonster` walks without looking. It is asked *here* rather than only
   * in `parseMonster`, because `parseMonster` is the untyped door and
   * `createContent` and `extendContent` are the other one: a caller who hands
   * in a half-written stat block past the compiler would otherwise reach
   * `Object.keys(undefined)` and get a **thrown** TypeError where the rule
   * says a refusal is a value. So this is the one gate both doors pass
   * through, which is what `content.test.ts` exists to prove of every other
   * kind of content and now proves of this one.
   *
   * The second is the one the schema cannot ask: **does the engine have a
   * vocabulary for what the block names?** `adaptMonster` drops a skill key it
   * does not recognise **silently**, which for a homebrew stat block is a
   * printed line that quietly buys nothing. The same rule an item's conferral
   * keeps, and the reason `feat_grant_not_read` exists.
   *
   * It asks nothing else. A **qualified** defence ("Charmed (except from its
   * vampire master)") and an unrecognised one are both things the SRD itself
   * prints; `addCreature` classifies them and reports them through
   * `unverified`, so refusing them here would refuse the printed book.
   */
  for (const monster of monsters) {
    const shaped = MonsterSchema.safeParse(monster);
    if (!shaped.success) {
      for (const issue of shaped.error.issues.slice(0, 5)) {
        problems.push({
          field: `monsters[${(monster as { readonly id?: string }).id ?? '?'}].${issue.path.join('.')}`,
          code: 'bad_monster',
          reason: issue.message,
        });
      }
      continue;
    }
    for (const skill of Object.keys(shaped.data.skills)) {
      if (SKILL_NAMES.has(skill)) continue;
      problems.push({
        field: `monsters[${monster.id}].skills`,
        code: 'unknown_skill',
        reason: `${monster.id} is proficient in "${skill}", which is not a skill this engine knows, so the bonus would be dropped without a word`,
      });
    }
  }

  return problems;
}

/**
 * A catalogue, validated, or the first few things wrong with it.
 *
 * Typed input: the compiler has already shaped it, and this checks what the
 * compiler cannot. Untyped input goes through {@link loadContent}, which parses
 * first and then arrives here; the two share every rule.
 */
export function createContent(input: ContentInput): Result<Content> {
  const problems = checkContent(input);
  if (problems.length > 0) {
    const shown = problems.slice(0, 5).map((p) => `${p.field}: ${p.reason}`);
    const more = problems.length > 5 ? `; and ${problems.length - 5} more` : '';
    return err('invalid_content', `${shown.join('; ')}${more}`);
  }

  const spells = input.spells ?? [];
  const entries = [
    ...(input.spellEntries ?? []),
    // A definition with no entry still exists: it can be declared and cast,
    // it is just on nobody's class list until an entry says whose.
    ...spells
      .filter((spell) => (input.spellEntries ?? []).every((entry) => entry.id !== spell.id))
      .map((spell) => entryOf(spell)),
  ];
  const classes = input.classes ?? [];
  const subclasses = input.subclasses ?? [];
  const species = input.species ?? [];
  const backgrounds = input.backgrounds ?? [];
  const feats = input.feats ?? [];
  const items = input.items ?? [];
  const languages = input.languages ?? [];
  const alignments = input.alignments ?? [];
  const monsters = input.monsters ?? [];
  const objectMaterials = input.objectMaterials ?? [];
  const objectSizes = input.objectSizes ?? [];

  const spellMap = byId(spells);
  const entryMap = byId(entries);
  const classMap = byId(classes);
  const subclassMap = byId(subclasses);
  const speciesMap = byId(species);
  const backgroundMap = byId(backgrounds);
  const featMap = byId(feats);
  const itemMap = byId(items);
  const monsterMap = byId(monsters);
  const materialMap = byId(objectMaterials);
  const objectSizeMap = byId(objectSizes);
  const languageMap = new Map(languages.map((language) => [language.name, language]));
  const alignmentMap = new Map(alignments.map((alignment) => [alignment.name, alignment]));

  return ok({
    spells,
    spellEntries: entries,
    classes,
    subclasses,
    species,
    backgrounds,
    feats,
    items,
    languages,
    alignments,
    monsters,
    objectMaterials,
    objectSizes,
    spell: (id) => spellMap.get(id) ?? null,
    spellEntry: (id) => entryMap.get(id) ?? null,
    classById: (id) => classMap.get(id) ?? null,
    subclassById: (id) => subclassMap.get(id) ?? null,
    speciesById: (id) => speciesMap.get(id) ?? null,
    backgroundById: (id) => backgroundMap.get(id) ?? null,
    featById: (id) => featMap.get(id) ?? null,
    item: (id) => itemMap.get(id) ?? null,
    monsterById: (id) => monsterMap.get(id) ?? null,
    objectMaterial: (id) => materialMap.get(id) ?? null,
    objectSize: (size) => objectSizeMap.get(size) ?? null,
    languageNamed: (name) => languageMap.get(name) ?? null,
    alignmentNamed: (name) => alignmentMap.get(name) ?? null,
    expandPack: (id) => {
      const item = itemMap.get(id);
      if (item === undefined) return [];
      if (item.contents.length === 0) return [{ id, quantity: 1 }];
      return [{ id, quantity: 1 }, ...item.contents.map((line) => ({ ...line }))];
    },
  });
}

const entryOf = (spell: SpellDefinition): SpellEntry => ({
  id: spell.id,
  name: spell.name,
  level: spell.level,
  school: spell.school,
  classes: [],
  castingTime: spell.castingTime,
  ritual: spell.ritual === true,
  concentration: spell.concentration,
});

/**
 * More content on top of what is already loaded — homebrew beside the book.
 *
 * Rebuilt and re-checked as one population, so a homebrew subclass may name a
 * printed class and a homebrew spell may not shadow a printed one: the same
 * duplicate rule applies across the seam as within either side.
 */
export function extendContent(base: Content, extra: ContentInput): Result<Content> {
  return createContent({
    spells: [...base.spells, ...(extra.spells ?? [])],
    spellEntries: [...base.spellEntries, ...(extra.spellEntries ?? [])],
    classes: [...base.classes, ...(extra.classes ?? [])],
    subclasses: [...base.subclasses, ...(extra.subclasses ?? [])],
    species: [...base.species, ...(extra.species ?? [])],
    backgrounds: [...base.backgrounds, ...(extra.backgrounds ?? [])],
    feats: [...base.feats, ...(extra.feats ?? [])],
    items: [...base.items, ...(extra.items ?? [])],
    languages: [...base.languages, ...(extra.languages ?? [])],
    alignments: [...base.alignments, ...(extra.alignments ?? [])],
    monsters: [...base.monsters, ...(extra.monsters ?? [])],
    objectMaterials: [...base.objectMaterials, ...(extra.objectMaterials ?? [])],
    objectSizes: [...base.objectSizes, ...(extra.objectSizes ?? [])],
  });
}

/** An empty world: no spells, no classes, nothing to buy. */
export const emptyContent = (): Content => {
  const built = createContent({});
  if (!built.ok) throw new Error(`empty content failed its own checks: ${built.reason}`);
  return built.value;
};

// ---------------------------------------------------------------------------
// Untyped input: JSON in, the same checks, a Content out.
// ---------------------------------------------------------------------------

type Shape = Record<string, unknown>;

const isShape = (value: unknown): value is Shape =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);
const isInt = (value: unknown): value is number => Number.isInteger(value);

class Shaped {
  private readonly bad: string[] = [];
  constructor(private readonly where: string) {}

  string(shape: Shape, key: string): string {
    const value = shape[key];
    if (!isString(value) || value.length === 0) this.bad.push(`${key} must be a non-empty string`);
    return isString(value) ? value : '';
  }

  optionalString(shape: Shape, key: string): string | undefined {
    const value = shape[key];
    if (value !== undefined && !isString(value)) this.bad.push(`${key} must be a string`);
    return isString(value) ? value : undefined;
  }

  int(shape: Shape, key: string): number {
    const value = shape[key];
    if (!isInt(value)) this.bad.push(`${key} must be a whole number`);
    return isInt(value) ? value : 0;
  }

  optionalInt(shape: Shape, key: string): number | undefined {
    const value = shape[key];
    if (value !== undefined && !isInt(value)) this.bad.push(`${key} must be a whole number`);
    return isInt(value) ? value : undefined;
  }

  bool(shape: Shape, key: string): boolean {
    const value = shape[key];
    if (typeof value !== 'boolean') this.bad.push(`${key} must be true or false`);
    return value === true;
  }

  strings(shape: Shape, key: string): readonly string[] {
    const value = shape[key];
    if (!isStringList(value)) this.bad.push(`${key} must be a list of strings`);
    return isStringList(value) ? value : [];
  }

  list(shape: Shape, key: string): readonly unknown[] {
    const value = shape[key];
    if (!Array.isArray(value)) this.bad.push(`${key} must be a list`);
    return Array.isArray(value) ? value : [];
  }

  object(shape: Shape, key: string): Shape {
    const value = shape[key];
    if (!isShape(value)) this.bad.push(`${key} must be an object`);
    return isShape(value) ? value : {};
  }

  problems(): readonly string[] {
    return this.bad.map((reason) => `${this.where}: ${reason}`);
  }
}

function parseFeatures(
  value: readonly unknown[],
  where: string,
  problems: string[],
  executedBySource?: ReadonlySet<string>,
): FeatureDefinition[] {
  const features: FeatureDefinition[] = [];
  // Shape only, at this step: the coherence checks run again in checkContent
  // with the real table length and the real spell population.
  const shapeOnly: FeatureContext = {
    levels: MAX_LEVEL,
    readableGrants: READABLE_GRANT_KINDS,
    readableFields: READABLE_FEATURE_FIELDS,
    spellExists: () => true,
    ...(executedBySource === undefined ? {} : { executedBySource }),
  };
  value.forEach((raw, index) => {
    const parsed = parseFeatureDefinition(raw, shapeOnly);
    if (parsed.ok) features.push(parsed.value);
    else problems.push(`${where}.features[${index}]: ${parsed.reason}`);
  });
  return features;
}

function parseArmorTraining(shape: Shape, where: string, problems: string[]) {
  const s = new Shaped(`${where}.armorTraining`);
  const training = {
    light: s.bool(shape, 'light'),
    medium: s.bool(shape, 'medium'),
    heavy: s.bool(shape, 'heavy'),
    shields: s.bool(shape, 'shields'),
  };
  problems.push(...s.problems());
  return training;
}

/**
 * A class definition out of untyped input.
 *
 * Structural: every field the engine reads is present and of the right shape,
 * and every feature goes through `parseFeatureDefinition`. Whether the class
 * is *coherent* — a twenty-row table, a progression on a caster, features at
 * reachable levels — is {@link checkContent}'s question, asked once the whole
 * catalogue is assembled, because half of those rules read across definitions.
 */
export function parseClassDefinition(value: unknown): Result<ClassDefinition> {
  if (!isShape(value)) return err('bad_class', 'a class definition is an object');
  const problems: string[] = [];
  const id = isString(value['id']) ? value['id'] : '?';
  const where = `classes[${id}]`;
  const s = new Shaped(where);

  const table = s.list(value, 'table').map((row, index) => {
    const r = new Shaped(`${where}.table[${index}]`);
    const shape = isShape(row) ? row : {};
    if (!isShape(row)) problems.push(`${where}.table[${index}]: a row is an object`);
    const parsed = {
      level: r.int(shape, 'level'),
      proficiencyBonus: r.int(shape, 'proficiencyBonus'),
      ...(shape['cantripsKnown'] === undefined ? {} : { cantripsKnown: r.int(shape, 'cantripsKnown') }),
      ...(shape['preparedSpells'] === undefined ? {} : { preparedSpells: r.int(shape, 'preparedSpells') }),
      ...(shape['spellSlots'] === undefined
        ? {}
        : { spellSlots: r.list(shape, 'spellSlots').map((slot) => (isInt(slot) ? slot : 0)) }),
    };
    problems.push(...r.problems());
    return parsed;
  });

  const skillChoices = s.object(value, 'skillChoices');
  const sc = new Shaped(`${where}.skillChoices`);
  const choose = sc.int(skillChoices, 'choose');
  const from = skillChoices['from'] === undefined ? undefined : sc.strings(skillChoices, 'from');
  problems.push(...sc.problems());

  const multiclassShape = s.object(value, 'multiclass');
  const mc = new Shaped(`${where}.multiclass`);
  const multiclass = {
    weapons: mc.strings(multiclassShape, 'weapons'),
    armorTraining: parseArmorTraining(mc.object(multiclassShape, 'armorTraining'), `${where}.multiclass`, problems),
    tools: mc.strings(multiclassShape, 'tools'),
    ...(multiclassShape['skills'] === undefined
      ? {}
      : {
          skills: (() => {
            const sk = mc.object(multiclassShape, 'skills');
            const parsed = {
              choose: mc.int(sk, 'choose'),
              ...(sk['from'] === undefined ? {} : { from: mc.strings(sk, 'from') }),
            };
            return parsed;
          })(),
        }),
  };
  problems.push(...mc.problems());

  const castingShape = value['spellcasting'];
  let spellcasting: ClassDefinition['spellcasting'];
  if (castingShape !== undefined) {
    const cs = new Shaped(`${where}.spellcasting`);
    const shape = isShape(castingShape) ? castingShape : {};
    if (!isShape(castingShape)) problems.push(`${where}.spellcasting: an object`);
    const feature = cs.optionalString(shape, 'feature');
    const progression = cs.optionalString(shape, 'progression');
    spellcasting = {
      ability: cs.string(shape, 'ability') as ClassDefinition['primaryAbility'],
      style: cs.string(shape, 'style') as NonNullable<ClassDefinition['spellcasting']>['style'],
      startsAtLevel: cs.int(shape, 'startsAtLevel'),
      ...(feature === undefined ? {} : { feature: feature as 'spellcasting' | 'pact-magic' }),
      ...(progression === undefined ? {} : { progression: progression as 'full' | 'half' }),
    };
    problems.push(...cs.problems());
  }

  const startingEquipment = s.list(value, 'startingEquipment').map((pack, index) => {
    const p = new Shaped(`${where}.startingEquipment[${index}]`);
    const shape = isShape(pack) ? pack : {};
    const parsed = {
      option: p.string(shape, 'option'),
      goldPieces: p.int(shape, 'goldPieces'),
      items: p.list(shape, 'items').map((line) => {
        const l = isShape(line) ? line : {};
        const detail = p.optionalString(l, 'detail');
        return {
          id: p.string(l, 'id'),
          quantity: p.int(l, 'quantity'),
          ...(detail === undefined ? {} : { detail }),
        };
      }),
    };
    problems.push(...p.problems());
    return parsed;
  });

  const definition: ClassDefinition = {
    id: s.string(value, 'id'),
    name: s.string(value, 'name'),
    primaryAbility: s.string(value, 'primaryAbility') as ClassDefinition['primaryAbility'],
    hitDie: s.int(value, 'hitDie'),
    saveProficiencies: s.strings(value, 'saveProficiencies') as ClassDefinition['saveProficiencies'],
    skillChoices: from === undefined ? { choose } : { choose, from: from as NonNullable<ClassDefinition['skillChoices']['from']> },
    weaponProficiencies: s.strings(value, 'weaponProficiencies'),
    armorTraining: parseArmorTraining(s.object(value, 'armorTraining'), where, problems),
    subclassLevel: s.int(value, 'subclassLevel'),
    table,
    startingEquipment,
    multiclass: multiclass as ClassDefinition['multiclass'],
    // The class's own spellcasting block executes the feature it names.
    features: parseFeatures(
      s.list(value, 'features'),
      where,
      problems,
      spellcasting === undefined ? undefined : new Set([`${id}:${spellcasting.feature ?? 'spellcasting'}`]),
    ),
    ...(spellcasting === undefined ? {} : { spellcasting }),
  };
  problems.push(...s.problems());

  if (problems.length > 0) return err('bad_class', problems.join('; '));
  return ok(definition);
}

export function parseSubclassDefinition(value: unknown): Result<SubclassDefinition> {
  if (!isShape(value)) return err('bad_subclass', 'a subclass definition is an object');
  const problems: string[] = [];
  const id = isString(value['id']) ? value['id'] : '?';
  const where = `subclasses[${id}]`;
  const s = new Shaped(where);
  const definition: SubclassDefinition = {
    id: s.string(value, 'id'),
    name: s.string(value, 'name'),
    classId: s.string(value, 'classId'),
    features: parseFeatures(s.list(value, 'features'), where, problems),
  };
  problems.push(...s.problems());
  if (problems.length > 0) return err('bad_subclass', problems.join('; '));
  return ok(definition);
}

function parseSpeciesDefinition(value: unknown): Result<SpeciesDefinition> {
  if (!isShape(value)) return err('bad_species', 'a species definition is an object');
  const problems: string[] = [];
  const where = `species[${isString(value['id']) ? value['id'] : '?'}]`;
  const s = new Shaped(where);
  const definition: SpeciesDefinition = {
    id: s.string(value, 'id'),
    name: s.string(value, 'name'),
    creatureType: s.string(value, 'creatureType'),
    sizes: s.strings(value, 'sizes'),
    speed: s.int(value, 'speed'),
    features: parseFeatures(s.list(value, 'features'), where, problems),
  };
  problems.push(...s.problems());
  if (problems.length > 0) return err('bad_species', problems.join('; '));
  return ok(definition);
}

function parseBackgroundDefinition(value: unknown): Result<BackgroundDefinition> {
  if (!isShape(value)) return err('bad_background', 'a background definition is an object');
  const problems: string[] = [];
  const where = `backgrounds[${isString(value['id']) ? value['id'] : '?'}]`;
  const s = new Shaped(where);
  const definition: BackgroundDefinition = {
    id: s.string(value, 'id'),
    name: s.string(value, 'name'),
    abilities: s.strings(value, 'abilities') as BackgroundDefinition['abilities'],
    feat: s.string(value, 'feat'),
    skillProficiencies: s.strings(value, 'skillProficiencies') as BackgroundDefinition['skillProficiencies'],
    toolProficiency: s.string(value, 'toolProficiency'),
    startingEquipment: s.list(value, 'startingEquipment').map((pack) => {
      const shape = isShape(pack) ? pack : {};
      return {
        option: s.string(shape, 'option'),
        goldPieces: s.int(shape, 'goldPieces'),
        items: s.list(shape, 'items').map((line) => {
          const l = isShape(line) ? line : {};
          return { id: s.string(l, 'id'), quantity: s.int(l, 'quantity') };
        }),
      };
    }),
    features: parseFeatures(s.list(value, 'features'), where, problems),
  };
  problems.push(...s.problems());
  if (problems.length > 0) return err('bad_background', problems.join('; '));
  return ok(definition);
}

function parseFeatDefinition(value: unknown): Result<FeatDefinition> {
  if (!isShape(value)) return err('bad_feat', 'a feat definition is an object');
  const where = `feats[${isString(value['id']) ? value['id'] : '?'}]`;
  const s = new Shaped(where);
  const requiresShape = s.object(value, 'requires');
  const kind = s.string(requiresShape, 'kind');
  const requires: FeatDefinition['requires'] =
    kind === 'magic-initiate'
      ? { kind, lists: s.strings(requiresShape, 'lists') }
      : kind === 'proficiencies'
        ? { kind, choose: s.int(requiresShape, 'choose') }
        : kind === 'ability-score'
          ? // Shape only, exactly as the grant below: whether the branches are
            // answerable and the narrowing names abilities is `checkContent`'s
            // question, asked of typed and untyped input alike.
            ({
              kind,
              spreads: requiresShape['spreads'],
              ...(requiresShape['from'] === undefined ? {} : { from: requiresShape['from'] }),
            } as FeatDefinition['requires'])
          : { kind: 'none' };
  // Shape only, exactly as `checkFeatureShape` reads a feature's grant: an
  // object with a string kind. Whether the kind is one creation reads off a
  // feat is `checkContent`'s question, asked of typed and untyped input alike.
  const declared: unknown = value['grants'];
  if (declared !== undefined && !(isShape(declared) && typeof declared['kind'] === 'string')) {
    return err('bad_feat', `${where}.grants: a grant is an object saying which kind it is`);
  }
  const grants = declared as FeatDefinition['grants'];

  const definition: FeatDefinition = {
    id: s.string(value, 'id'),
    name: s.string(value, 'name'),
    category: s.string(value, 'category') as FeatDefinition['category'],
    requires,
    repeatable: s.bool(value, 'repeatable'),
    note: s.string(value, 'note'),
    // Carried through as it arrived: what a legal level is, `checkContent`
    // asks, for the reason the grant's kind is asked there.
    ...(value['minimumLevel'] === undefined
      ? {}
      : { minimumLevel: value['minimumLevel'] as number }),
    ...(grants === undefined ? {} : { grants }),
  };
  const problems = s.problems();
  if (problems.length > 0) return err('bad_feat', problems.join('; '));
  return ok(definition);
}

const AVAILABILITY: ReadonlySet<string> = new Set(['everyone', 'standard', 'rare']);

function parseLanguage(value: unknown): Result<LanguageDefinition> {
  if (!isShape(value)) return err('bad_language', 'a language is an object');
  const s = new Shaped(`languages[${isString(value['id']) ? value['id'] : '?'}]`);
  const availability = s.optionalString(value, 'availability');
  const language: LanguageDefinition = {
    id: s.string(value, 'id'),
    name: s.string(value, 'name'),
    ...(availability === undefined ? {} : { availability: availability as NonNullable<LanguageDefinition['availability']> }),
  };
  const problems = [...s.problems()];
  if (availability !== undefined && !AVAILABILITY.has(availability)) {
    problems.push(`languages[${language.id}]: availability is one of ${[...AVAILABILITY].join(', ')}, not "${availability}"`);
  }
  if (problems.length > 0) return err('bad_language', problems.join('; '));
  return ok(language);
}

function parseAlignment(value: unknown): Result<AlignmentDefinition> {
  if (!isShape(value)) return err('bad_alignment', 'an alignment is an object');
  const s = new Shaped(`alignments[${isString(value['id']) ? value['id'] : '?'}]`);
  const alignment: AlignmentDefinition = {
    id: s.string(value, 'id'),
    name: s.string(value, 'name'),
  };
  const problems = s.problems();
  if (problems.length > 0) return err('bad_alignment', problems.join('; '));
  return ok(alignment);
}

function parseSpellEntry(value: unknown): Result<SpellEntry> {
  if (!isShape(value)) return err('bad_spell_entry', 'a spell entry is an object');
  const s = new Shaped(`spellEntries[${isString(value['id']) ? value['id'] : '?'}]`);
  const entry: SpellEntry = {
    id: s.string(value, 'id'),
    name: s.string(value, 'name'),
    level: s.int(value, 'level'),
    school: s.string(value, 'school'),
    classes: s.strings(value, 'classes'),
    castingTime: s.string(value, 'castingTime'),
    ritual: s.bool(value, 'ritual'),
    concentration: s.bool(value, 'concentration'),
  };
  const problems = s.problems();
  if (problems.length > 0) return err('bad_spell_entry', problems.join('; '));
  return ok(entry);
}

function parseItem(value: unknown): Result<CatalogueItem> {
  if (!isShape(value)) return err('bad_item', 'an item is an object');
  const s = new Shaped(`items[${isString(value['id']) ? value['id'] : '?'}]`);
  const kind = s.string(value, 'kind');
  const bundleSize = s.optionalInt(value, 'bundleSize');
  // Presence is the requirement, so `{}` is a complete answer and has to
  // survive the round trip: an item that requires attunement of anybody is the
  // commonest kind there is.
  let attunement: CatalogueItem['attunement'] | null = null;
  if (value['attunement'] !== undefined) {
    // Through the collector like every other field, so a malformed one is
    // reported beside whatever else is wrong rather than short-circuiting the
    // rest of the item — `checkContent` reports every problem, not the first.
    const shape = s.object(value, 'attunement');
    attunement = {
      ...(shape['byClass'] === undefined ? {} : { byClass: s.strings(shape, 'byClass') }),
      ...(shape['bySpellcaster'] === undefined
        ? {}
        : { bySpellcaster: s.bool(shape, 'bySpellcaster') }),
    };
  }
  const weightLb = value['weightLb'];
  const costCp = value['costCp'];
  const item: CatalogueItem = {
    id: s.string(value, 'id'),
    name: s.string(value, 'name'),
    kind: kind as CatalogueItem['kind'],
    weightLb: typeof weightLb === 'number' ? weightLb : null,
    costCp: typeof costCp === 'number' ? costCp : null,
    // Armour and weapon records are the SRD's own schema; untyped input
    // carries them as given and the engine reads only the fields it names.
    armor: isShape(value['armor']) ? (value['armor'] as CatalogueItem['armor']) : null,
    weapon: isShape(value['weapon']) ? (value['weapon'] as CatalogueItem['weapon']) : null,
    contents: (Array.isArray(value['contents']) ? value['contents'] : []).map((line) => {
      const l = isShape(line) ? line : {};
      return { id: s.string(l, 'id'), quantity: s.int(l, 'quantity') };
    }),
    ...(bundleSize === undefined ? {} : { bundleSize }),
    ...(attunement === null ? {} : { attunement }),
    // Carried as given and judged by `checkContent`, which is the one gate
    // both the typed and the untyped path pass through — so a homebrew magic
    // item gets exactly the answers a transcribed one would.
    ...(Array.isArray(value['grants'])
      ? { grants: value['grants'] as NonNullable<CatalogueItem['grants']> }
      : {}),
    // Carried as given for the reason `grants` is: `checkContent` is the one
    // gate, so a homebrew item's honesty is judged by the same rule a
    // transcribed one's is rather than being quietly dropped here.
    ...(value['unmodelled'] === undefined
      ? {}
      : { unmodelled: value['unmodelled'] as NonNullable<CatalogueItem['unmodelled']> }),
  };
  const problems = s.problems();
  if (problems.length > 0) return err('bad_item', problems.join('; '));
  return ok(item);
}

/**
 * A stat block out of untyped input, through the schema the parser already has.
 *
 * **`MonsterSchema` rather than a hand-written twin.** Every other parser here
 * narrows a shape the engine declared, so the engine's reader is the only one;
 * a monster's shape is `@ie/srd`'s, and a second transcription of forty fields
 * would drift from the parser that writes them — which is the failure this
 * repository keeps refusing rather than the shape of the code it prefers.
 *
 * What this adds over `checkContent`, which runs the same schema, is only the
 * **narrowing**: `unknown` has to become a `Monster` before `ContentInput`
 * will hold it. The judgement is `checkContent`'s and is asked of typed input
 * too, so a half-written stat block gets the same answer whichever door it
 * came through.
 *
 * Zod's issues are flattened into the same `path: message` prose the `Shaped`
 * collector produces, so a malformed monster reads like a malformed item.
 */
function parseMonster(value: unknown): Result<Monster> {
  const parsed = MonsterSchema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  const id = isShape(value) && isString(value['id']) ? value['id'] : '?';
  const said = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  return err('bad_monster', `monsters[${id}]: ${said}`);
}

/**
 * One row of the Object Armour Class table, from untyped JSON.
 *
 * The `defenses` record is parsed rather than trusted because it is the one
 * field a homebrew table writes freely — "our paper burns" — and a typo in a
 * damage type there would be a Vulnerability nothing ever applied.
 */
function parseObjectMaterial(value: unknown): Result<ObjectMaterial> {
  if (!isShape(value)) return err('bad_object_material', 'an object material is an object');
  const where = `objectMaterials[${isString(value['id']) ? value['id'] : '?'}]`;
  const s = new Shaped(where);
  const material: ObjectMaterial = {
    id: s.string(value, 'id'),
    name: s.string(value, 'name'),
    armorClass: s.int(value, 'armorClass'),
  };
  const problems = [...s.problems()];

  const defenses = value['defenses'];
  const parsed: Record<string, { immune?: boolean; resistant?: boolean; vulnerable?: boolean }> = {};
  if (defenses !== undefined) {
    if (!isShape(defenses)) {
      problems.push(`${where}: defenses must be an object keyed by damage type`);
    } else {
      for (const [type, entry] of Object.entries(defenses)) {
        if (!DAMAGE_TYPE_NAMES.has(type)) {
          problems.push(`${where}: "${type}" is not a damage type`);
          continue;
        }
        if (!isShape(entry)) {
          problems.push(`${where}: defenses.${type} must be an object`);
          continue;
        }
        const one: { immune?: boolean; resistant?: boolean; vulnerable?: boolean } = {};
        for (const kind of ['immune', 'resistant', 'vulnerable'] as const) {
          const flag = entry[kind];
          if (flag === undefined) continue;
          if (typeof flag !== 'boolean') {
            problems.push(`${where}: defenses.${type}.${kind} must be a boolean`);
            continue;
          }
          one[kind] = flag;
        }
        parsed[type] = one;
      }
    }
  }

  if (problems.length > 0) return err('bad_object_material', problems.join('; '));
  return ok(defenses === undefined ? material : { ...material, defenses: parsed });
}

/** One row of the Object Hit Points table, from untyped JSON. */
function parseObjectSize(value: unknown): Result<ObjectSize> {
  if (!isShape(value)) return err('bad_object_size', 'an object size is an object');
  const where = `objectSizes[${isString(value['id']) ? value['id'] : '?'}]`;
  const s = new Shaped(where);
  const id = s.string(value, 'id');
  const size: ObjectSize = {
    id: id as ObjectSize['id'],
    fragile: s.int(value, 'fragile'),
    resilient: s.int(value, 'resilient'),
  };
  const examples = value['examples'];
  const problems = [...s.problems()];
  if (examples !== undefined && !isStringList(examples)) {
    problems.push(`${where}: examples must be a list of strings`);
  }
  if (id.length > 0 && !CREATURE_SIZE_NAMES.has(id)) {
    problems.push(`${where}: "${id}" is not a size — the row is keyed by the size it is for`);
  }
  if (problems.length > 0) return err('bad_object_size', problems.join('; '));
  return ok(isStringList(examples) ? { ...size, examples } : size);
}

function parseAll<T>(
  value: unknown,
  what: string,
  parse: (raw: unknown) => Result<T>,
  problems: string[],
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    problems.push(`${what} must be a list`);
    return [];
  }
  const parsed: T[] = [];
  value.forEach((raw, index) => {
    const one = parse(raw);
    if (one.ok) parsed.push(one.value);
    else problems.push(`${what}[${index}]: ${one.code}: ${one.reason}`);
  });
  return parsed;
}

/**
 * A catalogue out of untyped input — a JSON file, a database row, a model's
 * proposal — through exactly the checks the typed path runs.
 *
 * Parsing narrows the shape; {@link createContent} judges the meaning. A
 * definition that parses and is incoherent is refused there with the same
 * path-bearing problem the built-in catalogue would get.
 */
export function loadContent(value: unknown): Result<Content> {
  if (!isShape(value)) return err('bad_content', 'content is an object with lists of definitions');
  const problems: string[] = [];
  const input: ContentInput = {
    spells: parseAll(value['spells'], 'spells', parseSpellDefinition, problems),
    spellEntries: parseAll(value['spellEntries'], 'spellEntries', parseSpellEntry, problems),
    classes: parseAll(value['classes'], 'classes', parseClassDefinition, problems),
    subclasses: parseAll(value['subclasses'], 'subclasses', parseSubclassDefinition, problems),
    species: parseAll(value['species'], 'species', parseSpeciesDefinition, problems),
    backgrounds: parseAll(value['backgrounds'], 'backgrounds', parseBackgroundDefinition, problems),
    feats: parseAll(value['feats'], 'feats', parseFeatDefinition, problems),
    items: parseAll(value['items'], 'items', parseItem, problems),
    languages: parseAll(value['languages'], 'languages', parseLanguage, problems),
    alignments: parseAll(value['alignments'], 'alignments', parseAlignment, problems),
    monsters: parseAll(value['monsters'], 'monsters', parseMonster, problems),
    objectMaterials: parseAll(
      value['objectMaterials'],
      'objectMaterials',
      parseObjectMaterial,
      problems,
    ),
    objectSizes: parseAll(value['objectSizes'], 'objectSizes', parseObjectSize, problems),
  };
  if (problems.length > 0) return err('bad_content', problems.slice(0, 5).join('; '));
  return createContent(input);
}
