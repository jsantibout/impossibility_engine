import { ABILITIES, err, ok, SKILL_ABILITY, type Result } from '@ie/shared';
import { CONFERRED_LEVEL, itemChargePool, type CatalogueItem } from './catalogue.js';
import { MAX_ABILITY_SCORE } from './character.js';
import {
  abilityGrantProblemsOf,
  abilitySpreadProblems,
  checkFeatureDefinition,
  duplicateFeatureIds,
  parseFeatureDefinition,
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
  type SubclassDefinition,
} from './progression.js';
import { parseNotation } from './dice.js';
import { SENSE_NAMES } from './positioning.js';
import { dawnRollProblem, type Recovery } from './resources.js';
import { EFFECT_END_CAUSES } from './timers.js';
import { rollSelectorProblems } from './roll-modifiers.js';
import type { SpellDefinition } from './spell-definitions.js';
import { checkEffectValue, checkSpellDefinition, parseSpellDefinition } from './spell-schema.js';

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
  'critical-range',
  'expertise',
  'extra-attack',
  'initiative-proficiency',
  'lifts-conditions',
  'pool',
  'reaction',
  'recovery',
  'save-proficiency',
  'spells',
  'standing',
  'unarmored-defense',
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
export const FEAT_GRANT_KINDS: ReadonlySet<string> = new Set([
  'initiative-proficiency',
  // SRD prints the ceiling on a feat and on nothing else: every Epic Boon is
  // "Increase one ability score of your choice by 1, **to a maximum of 30**",
  // and the level 19 class feature says only that you gain one. Read by
  // `abilityPointsFrom` and `abilityMaximums` in `creation.ts`, beside the
  // feature's own.
  'ability-score-increase',
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
  'flat-bonus',
  'condition-immunity',
  'damage-resistance',
  'evasion',
  'attack-damage',
  'sense',
  'ability-score-set',
]);

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
export const CONFERRED_EFFECT_KINDS: ReadonlySet<string> = new Set([
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
 * The three riders, which every one of them needs a casting for.
 *
 * A condition instance is welded to a casting in the fold, a granted modifier
 * carries the casting as its source, and a `damage-scheduled` names the
 * casting that promised it. `applyRiders` reaches for all three through
 * `EffectContext.casting`, which a conferral has none of.
 */
const RIDER_FIELDS: readonly string[] = ['conditions', 'modifiers', 'delayed'];

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
      hangs = true;
      outlasts = true;
      conditions += 1;
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
      if (effect.kind === 'ability-score-set') {
        for (const problem of abilitySetProblems(effect as unknown as Record<string, unknown>, on)) {
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
  }

  const classOf = byId(classes);
  const featureSources: {
    readonly where: string;
    readonly levels: number;
    readonly features: readonly FeatureDefinition[];
    readonly executedBySource?: ReadonlySet<string>;
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
      ...(executedBySource === undefined ? {} : { executedBySource }),
    });
  }

  for (const subclass of subclasses) {
    const where = `subclasses[${subclass.id}]`;
    const parent = classOf.get(subclass.classId);
    if (parent === undefined) {
      problems.push({ field: `${where}.classId`, code: 'unknown_class', reason: `${subclass.id} belongs to ${subclass.classId}, which this content does not hold` });
    }
    featureSources.push({ where, levels: parent?.table.length ?? MAX_LEVEL, features: subclass.features });
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
      if (feature.grants?.kind === 'standing') {
        (feature.grants.requires ?? []).forEach((requirement, position) => {
          if (ITEM_ONLY_REQUIREMENTS.has(requirement.kind)) {
            problems.push({
              field: `${where}.grants.requires[${position}]`,
              code: 'item_requirement_on_a_feature',
              reason: `"${requirement.kind}" is read against the id of the item granting it, and a class feature is not an item, so this would never hold`,
            });
          }
        });
        // And the narrowing, which is the same door in the same wall: it is
        // keyed on the granting item's id, and a class feature has none, so
        // the benefit would never reach a roll at all. Both members that carry
        // the clause are refused here — a flat bonus's "made with this magic
        // weapon" and an extra die's "this magic weapon deals" — because a
        // rule enforced on one of two spellings is a rule with a hole in it.
        (feature.grants.effects ?? []).forEach((effect, position) => {
          if (
            (effect.kind === 'flat-bonus' || effect.kind === 'attack-damage') &&
            effect.onlyWithItem === true
          ) {
            problems.push({
              field: `${where}.grants.effects[${position}].onlyWithItem`,
              code: 'item_narrowing_on_a_feature',
              reason: `"made with this item" is read against the id of the item granting it, and a class feature is not an item, so ${feature.id} would grant nothing`,
            });
          }
          // A sense, judged by the same rule an item's is — see
          // {@link senseProblems}. A species prints the commonest one in the
          // book and an untyped species definition may get it wrong in
          // exactly the ways an untyped item can.
          if (effect.kind === 'sense') {
            for (const problem of senseProblems(
              effect as unknown as Record<string, unknown>,
              `${where}.grants.effects[${position}]`,
            )) {
              problems.push({ field: problem.field, code: problem.code, reason: problem.reason });
            }
          }
          // And a set score, by the same rule at the same two doors.
          if (effect.kind === 'ability-score-set') {
            for (const problem of abilitySetProblems(
              effect as unknown as Record<string, unknown>,
              `${where}.grants.effects[${position}]`,
            )) {
              problems.push({ field: problem.field, code: problem.code, reason: problem.reason });
            }
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
      // inventory. A feature that resolves an effect list declares it with an
      // `activated` grant, which is executed.
      if (feature.grants?.kind === 'confers') {
        problems.push({
          field: `${where}.grants`,
          code: 'item_conferral_on_a_feature',
          reason: `"confers" is an item conferring an effect without casting a spell, and the item is used up doing it; ${feature.id} is not an item, so nothing would be spent and nothing would execute it`,
        });
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

  const spellMap = byId(spells);
  const entryMap = byId(entries);
  const classMap = byId(classes);
  const subclassMap = byId(subclasses);
  const speciesMap = byId(species);
  const backgroundMap = byId(backgrounds);
  const featMap = byId(feats);
  const itemMap = byId(items);
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
    spell: (id) => spellMap.get(id) ?? null,
    spellEntry: (id) => entryMap.get(id) ?? null,
    classById: (id) => classMap.get(id) ?? null,
    subclassById: (id) => subclassMap.get(id) ?? null,
    speciesById: (id) => speciesMap.get(id) ?? null,
    backgroundById: (id) => backgroundMap.get(id) ?? null,
    featById: (id) => featMap.get(id) ?? null,
    item: (id) => itemMap.get(id) ?? null,
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
  };
  if (problems.length > 0) return err('bad_content', problems.slice(0, 5).join('; '));
  return createContent(input);
}
