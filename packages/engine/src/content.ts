import { err, ok, SKILL_ABILITY, type Result } from '@ie/shared';
import { itemChargePool, type CatalogueItem } from './catalogue.js';
import {
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
import { dawnRollProblem, type Recovery } from './resources.js';
import { rollSelectorProblems } from './roll-modifiers.js';
import type { SpellDefinition } from './spell-definitions.js';
import { checkSpellDefinition, parseSpellDefinition } from './spell-schema.js';

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
  'activated',
  'critical-range',
  'expertise',
  'extra-attack',
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
]);

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
  if (!Number.isInteger(grant.uses) || (grant.uses ?? 0) < 1) {
    say(
      'item_pool_without_uses',
      `${item.id} declares charges without saying how many; the SRD prints a number on the item's own line`,
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

  if (!Number.isInteger(grant.charges) || grant.charges < 1) {
    say(
      'bad_charge_cost',
      `the SRD prints what a casting from an item costs on the item's own line, and ${item.id} names ${String(grant.charges)}`,
      `${at}.charges`,
    );
  }
  if (grant.upToCharges !== undefined) {
    if (!Number.isInteger(grant.upToCharges) || grant.upToCharges <= grant.charges) {
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

  // The charges come out of the item's own pool, which is the mechanism
  // `resources.ts` named "a magic item with seven charges" on the day it was
  // written. An item that casts for a price and declares no pool has an
  // economy with nothing behind it, and `itemRoute` would refuse every casting.
  if (itemChargePool(item) === null) {
    say(
      'casts_without_charges',
      `${item.id} casts ${String(grant.spell)} for charges and declares no charge pool for them to come out of`,
      `${at}.charges`,
    );
  }

  return found;
}

/**
 * What an item is allowed to grant, judged once for both input paths.
 *
 * Typed content and parsed JSON both arrive at `checkContent`, so this is the
 * one gate — which is why it reads defensively rather than trusting the type.
 *
 * **A `standing` grant and a `pool` grant.** Those are the two an item's
 * readers execute — a benefit derived on every read, and charges. The rest are
 * real and are coming, but a grant nothing executes is an item whose line in
 * the book quietly does nothing.
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

  let pools = 0;
  const casts = new Set<string>();

  (item.grants ?? []).forEach((grant, index) => {
    const at = `${where}[${index}]`;
    if (grant === null || typeof grant !== 'object' || !isString((grant as { kind?: unknown }).kind)) {
      say('bad_item_grant', 'an item grant is an object naming its kind', at);
      return;
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
    if (grant.kind !== 'standing') {
      say(
        'item_grant_not_read',
        `nothing executes a "${grant.kind}" grant from an item yet; only a standing grant, a charge pool and a spell it casts are read from one`,
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
        : { kind: 'none' };
  const definition: FeatDefinition = {
    id: s.string(value, 'id'),
    name: s.string(value, 'name'),
    category: s.string(value, 'category') as FeatDefinition['category'],
    requires,
    repeatable: s.bool(value, 'repeatable'),
    note: s.string(value, 'note'),
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
