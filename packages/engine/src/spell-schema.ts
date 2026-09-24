import {
  ABILITIES,
  CONDITIONS,
  DAMAGE_TYPES,
  err,
  ok,
  SKILL_ABILITY,
  SKILLS,
  type Ability,
  type Result,
  type Skill,
} from '@ie/shared';
import { counterpartProblem, oneShotProblem, rollSelectorProblems } from './roll-modifiers.js';
import { parseNotation } from './dice.js';
import type { Recovery } from './resources.js';
import { PASSIVE_DEFENSE_KINDS } from './passive-defenses.js';
import { SENSE_NAMES } from './positioning.js';
import { LONG_CASTING_SECONDS } from './spells.js';
import {
  conditionRiderOf,
  CREATURE_TYPES,
  DM_DECIDES,
  modifierRidersOf,
  persists as castingPersists,
  statedChoiceCollides,
  statedChoiceReaches,
} from './spell-definitions.js';
import type {
  AreaTrigger,
  AttackRollCount,
  ConditionRider,
  DiceScaling,
  LightRider,
  ModifierRider,
  SequencedBurst,
  RiderDuration,
  SpellArea,
  SpellCheck,
  SpellDefinition,
  SpellEffect,
  SpellRepeatSave,
  SpentBudget,
  StatedChoiceOf,
  SummonedNumber,
} from './spell-definitions.js';
import { TURN_MOMENTS } from './time.js';
import { type PayoutKind } from './timers.js';
import type { DefenseKind } from './attack.js';
import type { SpeedChange } from './standing.js';
import { MOVEMENT_MODES, type MovementMode } from './character.js';
import {
  ACTION_SLOTS,
  isStatablePrice,
  NAMED_ACTIONS,
  SLOTS_WITH_NAMED_ACTIONS,
  STATABLE_PRICES,
  type ActionRule,
} from './combat.js';
import type { Bonus, BonusApplies, BonusNarrowing } from './bonuses.js';
import type { RollModifier } from './roll-modifiers.js';
import { DIFFICULT_TERRAIN, LIGHT_LEVELS, OBSCUREMENT_DEGREES } from './positioning.js';

/**
 * Whether a spell definition is *coherent*, asked of a value rather than of a
 * compilation.
 *
 * The catalogue in `spell-definitions.ts` is already pure declarative data —
 * 125 object literals, no expressions, no hooks, and no spell-name special
 * case anywhere in the runtime. What it never had is anything that checks a
 * definition at **runtime**: the TypeScript compiler was the only guard, so a
 * definition that did not arrive through `tsc` — authored by a DM, read from a
 * file, proposed by a model — had nothing to check it at all.
 *
 * This is that guard, and it is deliberately three things kept apart:
 *
 * | | |
 * |---|---|
 * | **schema validity** (here) | the shape is coherent: closed vocabularies, dice that parse, combinations that mean something. True of homebrew as readily as of the book |
 * | **SRD conformance** (`scripts/spell-oracle.ts`) | this definition agrees with the spell the book prints. Only applies to a definition whose id *is* a printed spell |
 * | **this casting** (`commands/`) | range, slot, sight, creature type, action economy — the world, not the definition |
 *
 * Conflating the first two is how "valid" comes to mean "official", which is
 * the one thing a definition layer must not do: a DM's invented spell is valid
 * engine data and is not SRD-conformant, and both halves of that sentence are
 * load-bearing.
 *
 * **Every rule below was run against all 125 catalogue definitions before it
 * was written, and none of them fires.** These are the rules the catalogue
 * already obeys, moved to where a *new* definition meets them — instead of
 * being discovered by a sweep test casting the spell and finding nothing
 * happened.
 */

/** One thing wrong with a definition, and where. */
export interface SpellDefinitionProblem {
  /**
   * The path to the offending field, e.g. `effects[0].damageType`.
   *
   * A path rather than a name for the same reason `CharacterProblem` carries
   * one: an author fixing a definition wants to be pointed at the line, and a
   * spell's mechanics are nested two and three deep.
   */
  readonly field: string;
  readonly code: string;
  readonly reason: string;
}

const SCHOOLS: ReadonlySet<string> = new Set([
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
]);

const DAMAGE: ReadonlySet<string> = new Set(DAMAGE_TYPES);
const CONDITION_NAMES: ReadonlySet<string> = new Set(CONDITIONS);
const SENSES: ReadonlySet<string> = new Set(SENSE_NAMES);
/**
 * The four things a casting can be asked to choose, as data for untyped
 * input — {@link StatedChoiceOf}, which the compiler enforces on a definition
 * that arrived through `tsc` and cannot on one read from a file.
 */
const STATED_CHOICE_KINDS: ReadonlySet<string> = new Set<StatedChoiceOf>([
  'condition',
  'ability',
  'skill',
  'creature-type',
]);
/** The three answers `DamageDefenses` holds, as data, for untyped input. */
const DEFENSE_KINDS: ReadonlySet<string> = new Set<DefenseKind>([
  'resistant',
  'immune',
  'vulnerable',
]);
/** Every operation {@link SpeedChange} names, as data, for untyped input. */
const SPEED_CHANGES: ReadonlySet<string> = new Set<SpeedChange>([
  'add',
  'halve',
  'zero',
  'match-walk',
]);
/** The three things {@link PayoutKind} hands over, as data, for untyped input. */
const PAYOUT_KINDS: ReadonlySet<string> = new Set<PayoutKind>([
  'temporary-hit-points',
  'healing',
  'damage',
]);
/**
 * The two boundaries a turn has, read off the vocabulary rather than listed.
 *
 * The other sets here transcribe a union because the union is declared as a
 * type and a validator needs it as data; `TURN_MOMENTS` is already data, so
 * the transcription would be the copy this file exists to avoid.
 */
const TURN_MOMENT_NAMES: ReadonlySet<string> = new Set<string>(TURN_MOMENTS);
const CASTING_TIMES: ReadonlySet<string> = new Set([
  'action',
  'bonus-action',
  'reaction',
  'long',
]);

/**
 * The die behaviours a definition may ask for, and the caps they may be bounded
 * by — `DieRule` and `DieRuleCap` written out as data.
 *
 * Written out rather than derived because the validator's whole job is to judge
 * input the compiler never saw. A kind joins this set in the commit that
 * teaches `declaredDieEffects` to build it, which is the rule
 * `FEAT_GRANT_KINDS` states for a feat's grant and `CONFERRED_EFFECT_KINDS` for
 * an item's: a vocabulary member with no reader is a promise the engine does
 * not keep.
 */
const DIE_RULE_KINDS: ReadonlySet<string> = new Set(['bonus-die-on-max']);
const DIE_RULE_CAPS: ReadonlySet<string> = new Set(['spellcasting-modifier']);

/**
 * The effect kinds that roll a casting's **own** damage dice.
 *
 * What a die rule has to find on a definition for the rule to be about
 * anything. The three are the attack, the damaging save and the pool of hits
 * that neither decides — the trio `resolveAttackEffect`,
 * `resolveSaveDamageEffect` and `resolveAutoDamageEffect` roll — and a kind
 * joins them here the day its resolver carries the effects through.
 */
const ROLLS_ITS_OWN_DAMAGE: ReadonlySet<string> = new Set([
  'attack',
  'save-damage',
  'auto-damage',
]);

/**
 * Whether a casting of this definition rolls its damage **more than once**.
 *
 * `DieRule`'s cap is a budget for the whole casting — SRD caps "the maximum
 * number of these d8s you can add to **the spell's damage**" — and `roll()`
 * counts an effect's bonus dice against the call it is in. So a definition that
 * throws its damage twice would be allowed the cap twice.
 *
 * The ways one casting reaches a damage roll again — a list rather than a
 * count, so that adding one is adding a bullet and a clause:
 *
 * - **Two damaging effects.**
 * - **A payload printed in a second damage type** — `plus`, which
 *   `resolveSaveDamageEffect` rolls part by part. Only `save-damage` carries
 *   one; an `attack` has no such field.
 * - **More than one target**, which the per-target loop rolls for one at a
 *   time.
 * - **More than one aimed roll out of one effect** — Scorching Ray's rays,
 *   Magic Missile's darts — each of which rolls its own damage. Every SRD
 *   spell that has them also names several targets, so the clause above
 *   already answered for all of them; it is written down because a homebrew
 *   spell may hurl three darts at exactly one creature, and the budget would
 *   then be handed out three times.
 * - **The targets a bigger slot adds**: `targetCountFor` is
 *   `count + extraPerSlotLevelAbove × above`, so the base count alone does not
 *   answer this.
 * - **A count the definition never states** — `unlimited`, which requires a
 *   base count of zero beside it and so scores nothing against the clause
 *   above.
 * - **An area**, which resolves per creature caught, and `targetsWithin`
 *   beside it, which bounds a choice with the same geometry.
 * - **An activation.** SRD Vampiric Touch: "you can make the attack again on
 *   each of your turns." The later action resolves its own effects under the
 *   *same* casting, so the rule is read off the same definition and handed a
 *   fresh cap every turn, which is a budget spent once a round rather than once
 *   a casting.
 *
 * Two shapes deliberately absent: `onMiss: 'half'` is the other arm of an
 * either/or and rolls instead of the hit rather than beside it, and an
 * `areaTrigger` is refused without an `area`, which the area clause already
 * catches.
 *
 * Refused rather than answered wrongly, and the refusal is the honest form of
 * the limit: the day the budget is carried across the rolls of one casting,
 * this function is what goes so that they can be admitted.
 */
function rollsDamageTwice(definition: SpellDefinition): boolean {
  const rollers = definition.effects.filter((effect) => ROLLS_ITS_OWN_DAMAGE.has(effect.kind));
  if (rollers.length > 1) return true;
  const targets = definition.targets;
  if (targets.count > 1 || (targets.extraPerSlotLevelAbove ?? 0) > 0 || targets.unlimited === true) {
    return true;
  }
  if (definition.area !== undefined || definition.targetsWithin !== undefined) return true;
  if (
    rollers.some(
      (effect) =>
        'rolls' in effect &&
        effect.rolls !== undefined &&
        (effect.rolls.count > 1 ||
          (effect.rolls.extraPerSlotLevelAbove ?? 0) > 0 ||
          (effect.rolls.cantripUpgradesAt ?? []).length > 0),
    )
  ) {
    return true;
  }
  if (
    (definition.activation?.effects ?? []).some((effect) =>
      ROLLS_ITS_OWN_DAMAGE.has(effect.kind),
    )
  ) {
    return true;
  }
  return rollers.some((effect) => 'plus' in effect && (effect.plus ?? []).length > 0);
}
const ABILITY_NAMES_SET: ReadonlySet<Ability> = new Set(ABILITIES);
const SKILL_NAMES: ReadonlySet<Skill> = new Set(SKILLS);
/**
 * Every kind of roll a granted mode can pick out — see `RollFamily`.
 *
 * Exported for the item door: `content.ts` asks the same question of an item's
 * standing `roll-mode` grant, and a second copy of this list there would be a
 * second place for the vocabulary to go stale. It reads the *untyped* name the
 * way this file does, which is why the set is strings rather than the union.
 */
/**
 * The four things a count or a pool may recover on — `Recovery` as data.
 *
 * {@link ROLL_FAMILIES}' rule and for its reason: `content.ts` asks the same
 * question of an item's charge pool, and a second copy of the vocabulary there
 * would be a second place for it to go stale. It reads the *untyped* name the
 * way this file does, which is why the set is strings rather than the union.
 */
export const RECOVERIES: ReadonlySet<string> = new Set<Recovery>([
  'short-rest',
  'long-rest',
  'dawn',
  'special',
]);

export const ROLL_FAMILIES: ReadonlySet<string> = new Set([
  'attack',
  'ability-check',
  'saving-throw',
  'initiative',
  'death-save',
]);
const AREA_KINDS: ReadonlySet<string> = new Set([
  'sphere',
  'cylinder',
  'cone',
  'cube',
  'line',
  'emanation',
  // The seventh, and the only one the SRD does not list among its areas of
  // effect: SRD Wind Wall's "one continuous path along the ground" is a shape
  // the caster draws rather than a template the book prints, and it is here
  // because a definition has to be able to say how long and how high the book
  // lets them draw it.
  'wall',
]);

/** The shapes whose origin is a creature rather than a coordinate. */
const selfOrigin = (area: SpellArea): boolean => area.origin === 'self';

/**
 * The one code a field the engine cannot read reports, wherever it is found.
 *
 * **A validator that throws on the input it exists to judge has judged
 * nothing.** {@link parseSpellDefinition} takes `unknown` and returns a
 * `Result`, and {@link checkShape} deliberately establishes very little: that
 * a definition is an object, that its handful of primitives are primitives,
 * and that each effect names a `kind` this engine knows. Everything below that
 * is unchecked on purpose, because *a field the engine does not know is not an
 * error* — so every field a rule goes on to dereference can arrive missing,
 * null, or some other type entirely.
 *
 * That was found three times one at a time: twice in the branches the granted
 * defence added, and once as a real regression in {@link grantCarried}, where
 * a loop conversion dropped a null guard and this function began throwing
 * where it had reported `unknown_condition`. Three is a class, so the guard is
 * a shared reader rather than a habit each branch is trusted to remember.
 *
 * **One code over many fields, not one code each.** This is a single defect —
 * *this field is not the shape the rules read* — arriving at every site that
 * reads one, exactly as `grant_without_lifetime` is one code over four things
 * a casting can leave standing. Two codes for one defect would be the second
 * place to get one sentence wrong, and the `field` path is what tells an
 * author which one it was.
 *
 * It is deliberately **not** {@link checkShape}'s `missing_field`: those are a
 * different phase, reported before the semantic pass runs at all, and a field
 * that is present and wrong is not a field that is missing.
 */
const MALFORMED = 'malformed_field';

/**
 * Whether this value can have fields read off it, reporting if it cannot.
 *
 * An array is refused along with the primitives: nothing in the format is both
 * a record and a list, so an array where an object belongs is as unreadable as
 * a number — and reading one as a record is how a rider that is a list came to
 * draw a problem about a lifetime it could never have had.
 */
function readsAsObject(
  value: unknown,
  path: string,
  shape: string,
  found: SpellDefinitionProblem[],
): boolean {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return true;
  found.push({ field: path, code: MALFORMED, reason: `${shape}, and this is ${nameOf(value)}` });
  return false;
}

/** The same, for the fields the rules walk rather than read fields off. */
function readsAsList(
  value: unknown,
  path: string,
  shape: string,
  found: SpellDefinitionProblem[],
): value is readonly unknown[] {
  if (Array.isArray(value)) return true;
  found.push({ field: path, code: MALFORMED, reason: `${shape}, and this is ${nameOf(value)}` });
  return false;
}

/** What to call the thing that arrived, so the reason says what was wrong. */
function nameOf(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'absent';
  if (Array.isArray(value)) return 'a list';
  return `a ${typeof value}`;
}

/**
 * Every notation a scaling carries, with the path each was found at.
 *
 * `scaledDiceFor` splits a notation on `d` and does arithmetic on the halves,
 * so a malformed one does not throw — it produces `NaNd6`, which is a spell
 * that silently rolls nothing. Checking the notation is the cheapest place to
 * catch that, and it is the same `validateBonusDice` discipline: parse
 * everything before anything is thrown.
 */
function checkScaling(
  scaling: DiceScaling,
  level: number,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (!readsAsObject(scaling, path, 'a dice scaling is an object naming the dice it rolls', found)) {
    return;
  }

  for (const [key, notation] of [
    ['dice', scaling.dice],
    ['perSlotLevelAbove', scaling.perSlotLevelAbove],
  ] as const) {
    if (notation === undefined) continue;
    if (typeof notation !== 'string' || !parseNotation(notation).ok) {
      found.push({
        field: `${path}.${key}`,
        code: 'bad_dice',
        reason: `"${String(notation)}" is not dice notation`,
      });
    }
  }

  // **An amount may roll nothing, and may not be nothing.** SRD Potion of
  // Heroism's "10 Temporary Hit Points" is a `flat` with no notation beside
  // it; an amount carrying neither would resolve, silently, to a zero that
  // every reader would hand over as if the line had printed it.
  if (scaling.dice === undefined) {
    if (typeof scaling.flat !== 'number') {
      found.push({
        field: path,
        code: 'amounts_to_nothing',
        reason:
          'an amount rolls dice, states a flat number, or both; this states neither, and nothing is not an amount',
      });
    }
    // The two fields that add dice **to the base notation**, on an amount that
    // has none: `scaledDiceFor` would have to invent the die they are counted
    // in, so the upcast would silently come to nothing. `flatPerSlotLevelAbove`
    // is deliberately not here — `scaledFlatFor` never reads a notation, so a
    // printed number that grows flatly with the slot is perfectly sayable.
    for (const key of ['perSlotLevelAbove', 'cantripUpgradesAt'] as const) {
      if (scaling[key] !== undefined) {
        found.push({
          field: `${path}.${key}`,
          code: 'scaling_without_dice',
          reason: `${key} adds dice to the amount's own notation, and this amount rolls none`,
        });
      }
    }
  }

  // A cantrip has no slot, so nothing about it can grow with one: SRD gives it
  // a Cantrip Upgrade read off the *caster*. `scaledDiceFor` takes the cantrip
  // branch and never looks at a per-slot field, so the number would simply be
  // ignored — the quietest possible way to be wrong.
  if (level === 0) {
    for (const key of ['perSlotLevelAbove', 'flatPerSlotLevelAbove'] as const) {
      if (scaling[key] !== undefined) {
        found.push({
          field: `${path}.${key}`,
          code: 'slot_scaling_on_cantrip',
          reason: 'a cantrip is cast with no spell slot, so nothing about it scales with one',
        });
      }
    }
  } else if (scaling.cantripUpgradesAt !== undefined) {
    // And the mirror, which is the exact confusion that had a level 3 Wizard
    // throwing Fire Bolt for 2d10: a levelled spell scales with its slot.
    found.push({
      field: `${path}.cantripUpgradesAt`,
      code: 'cantrip_scaling_on_spell',
      reason: 'the Cantrip Upgrade applies to cantrips; a levelled spell scales with its slot',
    });
  }
}

/**
 * How many attack rolls an effect makes, held to the same two rules the dice
 * beside it are held to.
 *
 * **A roll is a whole thing and there is at least one of them.** A count of
 * zero is an attack effect that attacks nobody, and a fractional one is a
 * number `rollsDealtTo` would deal and never finish dealing; both would
 * resolve silently, which is the failure mode every rule in this file exists
 * to convert into a refusal.
 *
 * The cantrip/slot fork is `checkScaling`'s word for word, because it is the
 * same mistake: `attackRollsFor` takes one branch or the other and would
 * simply ignore the field belonging to the one it did not take, so a Scorching
 * Ray written with a Cantrip Upgrade would hurl three rays for ever.
 */
function checkRollCount(
  rolls: AttackRollCount,
  level: number,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (!readsAsObject(rolls, path, 'a roll count is an object naming how many rolls', found)) {
    return;
  }

  if (!Number.isInteger(rolls.count) || rolls.count < 1) {
    found.push({
      field: `${path}.count`,
      code: 'bad_roll_count',
      reason: `an attack makes a whole number of rolls and at least one; "${String(rolls.count)}" is not one`,
    });
  }

  if (rolls.extraPerSlotLevelAbove !== undefined) {
    if (!Number.isInteger(rolls.extraPerSlotLevelAbove) || rolls.extraPerSlotLevelAbove < 0) {
      found.push({
        field: `${path}.extraPerSlotLevelAbove`,
        code: 'bad_roll_count',
        reason: `a bigger slot adds a whole number of rolls and never takes one away; "${String(rolls.extraPerSlotLevelAbove)}" is not one`,
      });
    }
    if (level === 0) {
      found.push({
        field: `${path}.extraPerSlotLevelAbove`,
        code: 'slot_scaling_on_cantrip',
        reason: 'a cantrip is cast with no spell slot, so nothing about it scales with one',
      });
    }
  }

  if (rolls.cantripUpgradesAt !== undefined) {
    if (level !== 0) {
      found.push({
        field: `${path}.cantripUpgradesAt`,
        code: 'cantrip_scaling_on_spell',
        reason: 'the Cantrip Upgrade applies to cantrips; a levelled spell scales with its slot',
      });
    } else if (
      !readsAsList(
        rolls.cantripUpgradesAt,
        `${path}.cantripUpgradesAt`,
        'a Cantrip Upgrade is a list of the character levels that add a roll',
        found,
      )
    ) {
      return;
    } else {
      rolls.cantripUpgradesAt.forEach((at, i) => {
        if (!Number.isInteger(at) || at < 1 || at > 20) {
          found.push({
            field: `${path}.cantripUpgradesAt[${i}]`,
            code: 'bad_roll_count',
            reason: `a Cantrip Upgrade happens at a character level, 1 to 20; "${String(at)}" is not one`,
          });
        }
      });
    }
  }
}

/**
 * A clause that varies an outcome by the target's creature type.
 *
 * Two hosts carry one and the payloads differ — a saving throw's outcome, or
 * extra damage dice — so what the clause *does* is checked by the caller and
 * the half they share is checked here: that it names creature types, that it
 * names at least one, and that it names none of them twice.
 *
 * **Defensive about the value's shape, deliberately.**
 * `parseSpellDefinition` takes `unknown` and `checkShape` establishes an
 * effect's `kind` and nothing below it, so a clause that is a string or a
 * number can reach this reader. A validator that throws on the input it exists
 * to judge has judged nothing — the shape the re-review of the first union
 * task caught in a neighbouring branch, which is why this one does not match
 * that precedent.
 *
 * The list is the SRD glossary's fourteen, closed because the book closes it:
 * "These are the game's creature types". A clause naming `Goblinoid` is naming
 * a **subtype tag**, which the book gives no rules of its own — and a runtime
 * matcher that compared loosely enough to accept one would also let a rule
 * naming Humanoid reach a Goblin Warrior, which is Fey.
 */
function checkAgainstType(
  clause: unknown,
  path: string,
  found: SpellDefinitionProblem[],
): clause is { readonly types: readonly string[] } {
  const types = (clause as { types?: unknown } | null)?.types;
  if (typeof clause !== 'object' || clause === null || !Array.isArray(types)) {
    found.push({
      field: path,
      code: 'bad_typed_clause',
      reason: 'a clause that varies by creature type names the types it singles out',
    });
    return false;
  }

  if (types.length === 0) {
    found.push({
      field: `${path}.types`,
      code: 'varies_by_nobody',
      reason:
        'a clause that singles no creature type out varies nothing; name the types the SRD prints',
    });
  }

  const seen = new Set<unknown>();
  types.forEach((type, i) => {
    if (typeof type !== 'string' || !CREATURE_TYPES.includes(type)) {
      found.push({
        field: `${path}.types[${i}]`,
        code: 'unknown_creature_type',
        reason: `"${String(type)}" is not one of the SRD's fourteen creature types; a subtype tag such as Goblinoid is not a type and has no rules of its own`,
      });
    }
    if (seen.has(type)) {
      found.push({
        field: `${path}.types[${i}]`,
        code: 'duplicate_creature_type',
        reason: `${String(type)} is named twice, and one sentence cannot apply to it twice`,
      });
    }
    seen.add(type);
  });

  return true;
}

function checkDamageType(
  type: string,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (!DAMAGE.has(type)) {
    found.push({
      field: path,
      code: 'unknown_damage_type',
      reason: `"${type}" is not one of the SRD's thirteen damage types`,
    });
  }
}

/**
 * One printed option, checked against the vocabulary its kind belongs to.
 *
 * A switch over the kind rather than one set of everything, because a
 * condition named where an ability was meant is a spell the caster can cast
 * and nobody can read — and the three vocabularies have nothing in common to
 * make the confusion visible later.
 */
function checkChoiceOption(
  of: StatedChoiceOf,
  option: string,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  switch (of) {
    case 'condition':
      checkCondition(option, path, found);
      return;
    case 'ability':
      if (!ABILITY_NAMES_SET.has(option as Ability)) {
        found.push({ field: path, code: 'bad_ability', reason: `"${option}" is not an ability` });
      }
      return;
    case 'skill':
      if (!SKILL_NAMES.has(option as Skill)) {
        found.push({ field: path, code: 'bad_skill', reason: `"${option}" is not a skill` });
      }
      return;
    case 'creature-type':
      if (!CREATURE_TYPES.includes(option)) {
        found.push({
          field: path,
          code: 'unknown_creature_type',
          reason: `"${option}" is not one of the SRD's fourteen creature types`,
        });
      }
      return;
    default: {
      const unhandled: never = of;
      throw new Error(`no vocabulary for the choice ${String(unhandled)}`);
    }
  }
}

function checkCondition(
  name: string,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (!CONDITION_NAMES.has(name)) {
    found.push({
      field: path,
      code: 'unknown_condition',
      reason: `"${name}" is not one of the SRD's fifteen conditions`,
    });
  }
}

/**
 * A check a spell offers, wherever it sits.
 *
 * Three places carry one — the definition's own `check`, a condition rider's,
 * and the flat `check` on a `save` — and until now **no field of any of them
 * was checked at all**, which the fourth whole-engine audit (2026-09-13, §3.3)
 * named: a check keyed to a skill of the wrong ability compiled and validated.
 *
 * What the existing vocabulary can answer is checked and nothing else. The
 * ability and the skill are closed sets the engine already holds, the pairing
 * between them is `SKILL_ABILITY`, and the outcome is the two values
 * {@link SpellCheck.onSuccess} declares. A printed DC is a whole number worth
 * beating, because `EffectCheck.dc` is compared against a total.
 *
 * **The pairing is the rule worth having.** SRD always prints a check as
 * "Intelligence (Investigation)" — the ability the skill belongs to, in front
 * of the skill — and a pair that disagrees rolls one ability's modifier
 * against the other's proficiency. Nothing downstream would notice:
 * `rollAbilityCheck` reads `ability` for the modifier and `skill` for
 * proficiency and is right to trust both.
 */
function checkSpellCheck(
  check: SpellCheck,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (
    !readsAsObject(check, path, 'a check is an object naming the ability it is rolled with', found)
  ) {
    return;
  }

  const ability = check.ability as unknown as string;
  if (!ABILITY_NAMES_SET.has(check.ability)) {
    found.push({
      field: `${path}.ability`,
      code: 'bad_ability',
      reason: `"${ability}" is not an ability`,
    });
  }

  if (check.skill !== undefined) {
    if (!SKILL_NAMES.has(check.skill)) {
      found.push({
        field: `${path}.skill`,
        code: 'bad_skill',
        reason: `"${String(check.skill)}" is not a skill`,
      });
    } else if (ABILITY_NAMES_SET.has(check.ability) && SKILL_ABILITY[check.skill] !== check.ability) {
      found.push({
        field: `${path}.skill`,
        code: 'skill_ability_mismatch',
        reason: `SRD writes a check as "Intelligence (Investigation)"; ${String(check.skill)} is a ${SKILL_ABILITY[check.skill]} skill and this names ${ability}`,
      });
    }
  }

  if (check.dc !== undefined && (!Number.isInteger(check.dc) || check.dc < 1)) {
    found.push({
      field: `${path}.dc`,
      code: 'bad_check_dc',
      reason: 'a printed DC is a whole number a creature could roll against',
    });
  }

  if (check.onSuccess !== 'none' && check.onSuccess !== 'end-on-target') {
    found.push({
      field: `${path}.onSuccess`,
      code: 'bad_check_outcome',
      reason: `"${String(check.onSuccess)}" is not something succeeding at a check does; a check changes nothing or ends the effect on its own attempter`,
    });
  }
}

/**
 * A deadline a rider carries of its own, wherever it is carried.
 *
 * **One rule, two slots.** A condition rider has said `lasts` since Color
 * Spray needed a Blinded to outlive an Instantaneous casting, and IE-033's
 * `speed-change` rider says it for the same reason on the `modifiers` slot —
 * Ray of Frost is a cantrip, so its reduction has no casting to belong to.
 * Two near-identical blocks is the drift this file records everywhere else, so
 * the check is shared rather than spelled twice.
 *
 * **`typeof lasts === 'object'` is true of `null` as well**, so a rider that
 * carried one reached `.seconds` and threw. `RiderDuration` is five named
 * moments or a span of seconds, and anything else is a value no reader of this
 * field can do anything with.
 *
 * The moments are checked by name rather than against a derived set, because
 * the union is a closed list the compiler already holds a definition to — what
 * this guards is *untyped* input, where the compiler was never there.
 */
function checkRiderDuration(
  lasts: RiderDuration | undefined,
  riderPath: string,
  found: SpellDefinitionProblem[],
): void {
  if (lasts === undefined) return;
  if (typeof lasts === 'object' && lasts !== null && !Array.isArray(lasts)) {
    // A span of nothing is not a duration, it is the absence of one — the same
    // argument `durationSeconds` already makes on the definition.
    if (!Number.isFinite(lasts.seconds) || lasts.seconds <= 0) {
      found.push({
        field: `${riderPath}.lasts.seconds`,
        code: 'bad_rider_duration',
        reason:
          'a rider that lasts no seconds does not last; omit it to borrow the casting’s own deadline',
      });
    }
  } else if (
    lasts !== 'start-of-casters-next-turn' &&
    lasts !== 'end-of-casters-next-turn' &&
    lasts !== 'start-of-targets-next-turn' &&
    lasts !== 'end-of-targets-next-turn' &&
    lasts !== 'end-of-current-turn'
  ) {
    found.push({
      field: `${riderPath}.lasts`,
      code: MALFORMED,
      reason: `a rider lasts until a moment in the turn order or for a span of seconds, and this is ${nameOf(lasts)}`,
    });
  }
}

/**
 * The fields a Speed change carries, wherever it is carried.
 *
 * **One rule, two carriers**, for the reason above: the standalone `speed`
 * effect and the `speed-change` rider say the same sentence, and a second copy
 * is a second place for the pairing to be got wrong.
 *
 * The pairing *is* the rule worth having. SRD writes the operation and its
 * number together — "increases by 10 feet", "reduced by 10 feet" — and writes
 * no number at all for "is halved" or "a Speed of 0". So `feet` without `add`
 * is a number nothing reads, and `add` without `feet` is a change of nothing:
 * `speedOf` would add `0` and the spell would silently do nothing, which is
 * the wrong-number-with-no-symptom this repository calls its worst failure.
 */
function checkSpeedChange(
  value: { readonly change?: unknown; readonly feet?: unknown },
  path: string,
  found: SpellDefinitionProblem[],
  carries: SpeedModes = 'no-modes',
): void {
  const { change, feet } = value;
  if (typeof change !== 'string' || !SPEED_CHANGES.has(change)) {
    found.push({
      field: `${path}.change`,
      code: 'bad_speed_change',
      reason: `"${String(change)}" is not something an effect does to a Speed; the SRD adds feet to one, halves one, sets one to 0, or gives one in a mode equal to the walking Speed`,
    });
    return;
  }

  checkSpeedMode(value, change, path, found, carries);

  if (change === 'add') {
    if (!Number.isInteger(feet) || feet === 0) {
      found.push({
        field: `${path}.feet`,
        code: 'bad_speed_change',
        reason:
          'a Speed that changes by a number of feet needs the number, and a change of no feet is no change; the SRD prints it signed — Longstrider adds 10 and Ray of Frost takes 10 away',
      });
    }
    return;
  }

  if (feet !== undefined) {
    found.push({
      field: `${path}.feet`,
      code: 'bad_speed_change',
      reason: `"${change}" names the whole operation and the SRD prints no number beside it, so these feet are read by nothing`,
    });
  }
}

/**
 * Whether the thing carrying a Speed change may also name a mode.
 *
 * Three carriers and only one of them may: the standalone `speed` effect is
 * what SRD Fly and Spider Climb are written as, while the `speed-change`
 * rider and `areaStanding` hold no `mode` field at all — a rider says "its
 * Speed is reduced by 10 feet" and an area says "Speed is halved in the
 * Emanation", and neither sentence is about a mode. Untyped JSON reaches all
 * three, so the two that cannot read the field say so rather than dropping
 * it.
 */
type SpeedModes = 'modes' | 'no-modes';

function checkSpeedMode(
  value: { readonly change?: unknown; readonly feet?: unknown },
  change: string,
  path: string,
  found: SpellDefinitionProblem[],
  carries: SpeedModes,
): void {
  const { mode, hover } = value as { readonly mode?: unknown; readonly hover?: unknown };

  if (carries === 'no-modes') {
    for (const [field, present] of [
      ['mode', mode !== undefined],
      ['hover', hover !== undefined],
    ] as const) {
      if (!present) continue;
      found.push({
        field: `${path}.${field}`,
        code: 'bad_speed_change',
        reason: `only the standalone \`speed\` effect names a mode; a rider and an area both say "its Speed" and nothing reads a ${field} here`,
      });
    }
    if (change === 'match-walk') {
      found.push({
        field: `${path}.change`,
        code: 'bad_speed_change',
        reason:
          '"match-walk" gives a Speed in a mode, and a rider and an area have no mode to give it in',
      });
    }
    return;
  }

  // **A mode is legal on what gives a Speed and refused on what takes one
  // away**, which is `speedOf`'s own ruling read back at the door: SRD writes
  // Grappled's 0, Slow's halving and Ray of Frost's ten feet about the
  // creature rather than about a mode, so a `halve` naming one would promise
  // a narrowing no reader performs.
  const gives = change === 'add' || change === 'match-walk';
  if (mode !== undefined && !gives) {
    found.push({
      field: `${path}.mode`,
      code: 'bad_speed_change',
      reason: `"${change}" takes Speed away, and the SRD prints no sentence that takes it away in one mode and not another, so this mode is read by nothing`,
    });
  } else if (mode !== undefined && !MOVEMENT_MODES.includes(mode as MovementMode)) {
    found.push({
      field: `${path}.mode`,
      code: 'bad_speed_change',
      reason: `"${String(mode)}" is not one of the five Speeds the SRD prints: ${MOVEMENT_MODES.join(', ')}`,
    });
  }

  if (change === 'match-walk' && (mode === undefined || mode === 'walk')) {
    found.push({
      field: `${path}.mode`,
      code: 'bad_speed_change',
      reason:
        '"a Climb Speed equal to its Speed" names the mode it gives; matching the walking Speed to itself changes nothing',
    });
  }

  if (hover !== undefined && (hover !== true || mode !== 'fly')) {
    found.push({
      field: `${path}.hover`,
      code: 'bad_speed_change',
      reason:
        'hovering is the Fly Speed\'s exception to the fall and means nothing without one; the only value is true, beside a granted Fly Speed',
    });
  }
}

/**
 * A condition rider, wherever an effect carries one.
 *
 * One function for the four kinds that impose a condition, because they carry
 * one {@link ConditionRider} between them — so a rider on an `attack` is held
 * to exactly what a rider on a `save-damage` is, and a field added to the
 * rider is checked in one place rather than three.
 *
 * `rider` is optional and read through `?.` because this also meets untyped
 * input: `checkShape` establishes the effect's `kind` and nothing below it, so
 * a `condition` effect whose rider is missing outright must be *reported*
 * rather than throw.
 *
 * **The caller supplies both whole paths**, rather than this appending `.name`
 * and `.check`, because `save` holds its rider flat: a problem reported
 * against `effects[0].condition.name` on a definition whose field is
 * `effects[0].condition` points at nothing an author can fix, and the same
 * goes for the check, which `save` writes at `effects[0].check` and every
 * other carrier at `effects[0].condition.check`.
 */
/**
 * A repeat save the **casting** hosts, rather than a condition.
 *
 * SRD Searing Smite: "At the start of each of its turns until the spell ends,
 * the target takes 1d6 Fire damage and then makes a Constitution saving throw.
 * On a failed save, the spell continues. On a successful save, the spell
 * ends." The spell imposes no condition, so there is no instance for the
 * repeat to be filed on and the hook rides on the casting's own deadline —
 * which decides every rule below.
 *
 * - **The ability is required**, because the host rolled no save for this one
 *   to repeat. It is the one place the book prints it, and it is refused on
 *   every rider whose host *did* roll one: see {@link SpellRepeatSave.ability}.
 * - **A success ends the casting**, because there is nothing else it could
 *   end. `end-on-target` releases what a casting hung on one creature, and
 *   this casting has hung nothing.
 * - **A failure deepens nothing**, for the same reason: `onFailure` applies a
 *   condition "under the same source" as the one it replaces, and there is no
 *   first condition here. SRD writes "on a failed save, the spell continues",
 *   which is what a repeat with no failure branch already does.
 * - **And the damage it deals before the die** is an amount like any other.
 */
function checkCastingRepeat(
  repeats: SpellRepeatSave | undefined,
  level: number,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (repeats === undefined) return;
  if (!readsAsObject(repeats, path, 'a repeat save is an object naming when it fires', found)) {
    return;
  }

  if (!TURN_MOMENT_NAMES.has(repeats.at as unknown as string)) {
    found.push({
      field: `${path}.at`,
      code: 'bad_moment',
      reason: `"${String(repeats.at)}" is not a moment in a turn`,
    });
  }

  if (repeats.ability === undefined || !ABILITY_NAMES_SET.has(repeats.ability)) {
    found.push({
      field: `${path}.ability`,
      code: 'repeat_without_an_ability',
      reason: `"${String(repeats.ability)}" is not an ability, and a repeat on an effect that rolled no save of its own has none to repeat — the book prints this one`,
    });
  }

  if (repeats.onSuccess !== 'end-casting') {
    found.push({
      field: `${path}.onSuccess`,
      code: 'casting_repeat_ends_the_casting',
      reason:
        'a repeat save hosted by the casting has nothing on a target to release, so a success ends the casting; "end-on-target" would find nothing',
    });
  }

  if (repeats.onFailure !== undefined) {
    found.push({
      field: `${path}.onFailure`,
      code: 'deepening_without_a_condition',
      reason:
        'a failure deepens the condition the first save imposed, and an effect that imposes none has nothing to deepen; SRD writes "on a failed save, the spell continues", which is a repeat with no failure branch',
    });
  }

  const burns = repeats.beforeTheSave;
  if (
    burns !== undefined &&
    readsAsObject(
      burns,
      `${path}.beforeTheSave`,
      'damage dealt before the save is an object naming its dice and their type',
      found,
    )
  ) {
    checkScaling(burns.damage, level, `${path}.beforeTheSave.damage`, found);
    checkDamageType(burns.damageType, `${path}.beforeTheSave.damageType`, found);
  }
}

function checkConditionRider(
  rider: ConditionRider | undefined,
  namePath: string,
  riderPath: string,
  host: RiderHost,
  found: SpellDefinitionProblem[],
): void {
  checkCondition(String(rider?.name), namePath, found);

  // **The check hangs off the rider's own base, in both layouts**, which is
  // why one path is enough where the docstring above asks for two. A nested
  // rider at `X` writes `X.check`; `save` writes its rider flat, so the base
  // *is* the effect and the check is `effects[0].check`. The name is the one
  // field that does not follow — `save` calls it `condition` — and it stays
  // the caller's to supply for exactly that reason.
  if (rider?.check !== undefined) checkSpellCheck(rider.check, `${riderPath}.check`, found);

  // **A rider that repeats a save needs a host that rolled one.** SRD writes
  // "the target repeats the save" — the one the spell already asked for — so
  // an `attack` host, which rolls an attack, and a `condition` host, which
  // rolls nothing at all, have none to repeat. The type cannot say this: one
  // `ConditionRider` is shared by all four hosts, which is the whole point of
  // it, and the docstring on the `condition` kind had been making the argument
  // in prose since that kind arrived.
  if (rider?.repeats !== undefined && !host.rollsSave) {
    found.push({
      field: `${riderPath}.repeats`,
      code: 'repeats_without_save',
      reason: `a repeat save repeats the one its host rolled, and a "${host.kind}" effect rolls none`,
    });
  }

  // **And a rider's repeat names neither an ability nor damage**, which are
  // the two fields the *casting*-hosted repeat one kind away carries and this
  // one may not.
  //
  // The ability, because SRD writes "the target repeats **the** save" — the
  // one the host already rolled — so a second one here would be a second
  // answer to one sentence, which is the argument `SpellRepeatSave` makes in
  // the field itself. The damage, because a rider's repeat is raised from the
  // condition instance and the payout is collected from the *casting*'s own
  // hook: nothing carries it across, so a definition writing one here would be
  // promising damage no boundary would ever deal.
  if (rider?.repeats?.ability !== undefined) {
    found.push({
      field: `${riderPath}.repeats.ability`,
      code: 'repeat_states_an_ability',
      reason:
        'SRD writes "the target repeats the save" — the one this effect already rolled — so a repeat on a rider names no ability of its own',
    });
  }
  if (rider?.repeats?.beforeTheSave !== undefined) {
    found.push({
      field: `${riderPath}.repeats.beforeTheSave`,
      code: 'repeat_deals_no_damage',
      reason:
        'damage before a repeat save is collected from the casting’s own hook, and a rider’s repeat is raised from the condition it landed on; written here it would be dealt by nothing',
    });
  }

  // **And a repeat that ends the casting needs one the rider has not
  // disowned.** `outlivesCasting` is exactly the field that records the
  // condition under the spell's bare name with no casting mark in it, so a
  // success that ends "the spell" would look up a source `castingIdOf` answers
  // null for. The rule is the one `applyConditionTo` and `checkContent`
  // already keep at their own doors — a repeat under a source that is not a
  // casting may only end on its target — caught here, at authoring, which is
  // where a definition's defects belong. A `lasts` rider is untouched: it
  // shortens the casting's hold on the condition and does not sever the link.
  if (rider?.repeats?.onSuccess === 'end-casting' && rider.outlivesCasting === true) {
    found.push({
      field: `${riderPath}.repeats.onSuccess`,
      code: 'repeat_ends_no_casting',
      reason:
        'outlivesCasting records the condition under the spell\'s name with no casting in it, so a repeat save that ends the casting on a success has none to end; such a rider ends on its target',
    });
  }

  // **A deepening names a condition, out of the same fifteen.** SRD Sleep's
  // "the target has the Unconscious condition for the duration" is the failure
  // branch of the repeat above, and the only thing there is to be wrong about
  // is the name: the source, the lifetime and the end of the timer are all the
  // first condition's, which is what makes this one field rather than a second
  // rider.
  if (rider?.repeats?.onFailure !== undefined) {
    checkCondition(
      String(rider.repeats.onFailure.condition),
      `${riderPath}.repeats.onFailure.condition`,
      found,
    );

    // **And the deeper condition may carry a span, where the first may not.**
    // The rule the comment below states is about the condition the *repeat*
    // sits on: its deadline and the save's moment are the same moment, so one
    // silently eats the other. A deepening is applied at a moment that has
    // already arrived and scheduled there, so its own span races nothing —
    // which is the whole difference, and why this is checked rather than
    // refused. A span on the clock only: see `SpellRepeatSave.onFailure`.
    const deepened: unknown = rider.repeats.onFailure.lasts;
    if (
      deepened !== undefined &&
      (typeof deepened !== 'object' ||
        deepened === null ||
        !Number.isFinite((deepened as { seconds: number }).seconds) ||
        (deepened as { seconds: number }).seconds <= 0)
    ) {
      found.push({
        field: `${riderPath}.repeats.onFailure.lasts`,
        code: 'bad_rider_duration',
        reason:
          'the condition a failure deepens to lasts for a span of seconds — SRD Brass Dragon Wyrmling prints a minute — and a span of none does not last; omit it for a deepening that runs for whatever imposed the first condition',
      });
    }

    // **And the condition that carries one takes no deadline of its own.**
    // SRD Sleep names one moment twice — "until the end of its next turn, at
    // which point it must repeat the save" — and what the moment does is
    // *change* the condition rather than end it. A `lasts` beside a deepening
    // is the same moment written as an ending, and the two passes that read it
    // would race: `expireEffects` deletes the timer and `dropOrphanedSaves`
    // drops the pending save, so the sentence the author wrote would silently
    // do nothing. The condition runs for the casting's own duration instead,
    // and this refuses the pair rather than leaving four docstrings to claim a
    // rule nothing keeps.
    if (rider.lasts !== undefined) {
      found.push({
        field: `${riderPath}.lasts`,
        code: 'deepening_with_a_deadline',
        reason:
          'a repeat save whose failure deepens the condition is the moment that changes it, so the condition runs for the casting and carries no deadline of its own; a "lasts" here would expire the timer and drop the save before anybody rolled it',
      });
    }
  }

  checkRiderDuration(rider?.lasts, riderPath, found);

  // **A rider with no lifetime is checked once, and not here.** The rule that
  // an effect the casting owns needs something to end it is
  // {@link checkGrantLifetimes}, which reads the definition rather than the
  // host — so it also reaches a `buff`, a `roll-mode` and an `armor-class`,
  // which are grants with the same problem and no rider at all. Two places
  // reporting one defect under two codes is the second place to get one
  // sentence wrong.
}

/**
 * A `save` whose failure imposes no condition, and the four things it may not
 * then say.
 *
 * SRD Slow and SRD Faerie Fire roll a saving throw whose failure hands out
 * **grants and nothing else**, which is why {@link save.condition} is
 * optional — but the sentence its old requirement was standing in for is
 * still true one field along, and so are three others that only mean
 * something beside a condition.
 *
 * | Refused | Why |
 * |---|---|
 * | nothing imposed, nothing hung and nothing recorded | the die is thrown and no reader, at the table or in the rules, is told anything |
 * | `conditions` with no `condition` | the flat fields are the *first* rider, so a list alone is a second spelling of one sentence |
 * | `repeats` | a repeat is filed on the condition instance the failure created, and there is none |
 * | `lasts`, `check`, `outlivesCasting` | each is a sentence about how long a condition holds or how a creature escapes it |
 *
 * **The first has three ways out now rather than two, and the third is the
 * door this paragraph used to say did not exist.**
 * {@link save.recordsOutcome} writes the verdict onto the casting and
 * `observe()` publishes it, which is exactly the condition the gate set: the
 * engine may hold a fact only the table reads when the fact is the recorded
 * outcome of a roll it made **and a door publishes it**. SRD Zone of Truth's
 * "You know whether a creature succeeds or fails" is the sentence that was
 * waiting, and the reason it was refused was never the bare save — it was
 * that the answer reached nobody, which is the same defect `ends_nothing`
 * refuses one kind along. A save that records nothing and imposes nothing is
 * still that defect and is still refused.
 *
 * The other three rows are untouched: `recordsOutcome` says the *verdict* is
 * kept, not that a condition was imposed, so a `repeats` or a `lasts` beside
 * it still has no condition instance to hang on.
 */
function checkSaveWithoutCondition(
  effect: Extract<SpellEffect, { kind: 'save' }>,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  const further = Array.isArray(effect.conditions) ? effect.conditions : [];
  // **Every rider slot this host carries**, because the question is whether
  // the die decided anything at all: a failure that only makes its target glow
  // is SRD's sentence perfectly well, and reading `modifiers` alone would call
  // it a die thrown for nothing.
  const hangs =
    further.length > 0 ||
    (effect.modifiers ?? []).length > 0 ||
    effect.light !== undefined ||
    // SRD Gust of Wind: "must succeed on a Strength saving throw **or be
    // pushed 15 feet away from you**", and SRD Levitate's lift. A failure
    // whose whole content is a movement decided plenty, and reading the slots
    // above without this one would call the wind a die thrown for nothing.
    effect.movement !== undefined ||
    effect.breaksConcentration === true;

  if (!hangs && effect.recordsOutcome !== true) {
    found.push({
      field: `${path}.condition`,
      code: 'save_imposes_nothing',
      reason:
        'a saving throw whose failure imposes no condition, hangs no rider and records no outcome is a die thrown for nothing; name the condition, or the grants the failure hands out, or set recordsOutcome where the sentence says somebody knows the answer',
    });
  }

  if (further.length > 0) {
    found.push({
      field: `${path}.conditions`,
      code: 'further_conditions_without_a_first',
      reason:
        '"conditions" is the rest of what a failure imposes and "condition" is the first of them; a save that imposes one condition writes it flat',
    });
  }

  if (effect.repeats !== undefined) {
    found.push({
      field: `${path}.repeats`,
      code: 'repeat_without_condition',
      reason:
        'a repeat save is filed on the condition instance the failure created, and this failure creates none, so no turn boundary would ever raise it',
    });
  }

  for (const field of ['lasts', 'check', 'outlivesCasting'] as const) {
    if (effect[field] === undefined) continue;
    found.push({
      field: `${path}.${field}`,
      code: 'condition_field_without_a_condition',
      reason: `"${field}" says how long the condition this failure imposes lasts or how a creature escapes it, and this failure imposes none`,
    });
  }
}

/**
 * Which host a rider is hanging on, as the one fact a rider rule reads.
 *
 * Not the effect: a rider knows nothing about its host beyond whether there
 * was a saving throw to repeat. Passing the effect would let a rule here start
 * switching on the kind, which is the branching the whole design exists to
 * keep out — and the `kind` that *is* here is for the refusal's wording, never
 * for a decision.
 *
 * It carried a second fact for one commit, `castingLasts`, and the rule that
 * read it turned out to be {@link checkGrantLifetimes} written twice. That one
 * reads the definition, so it needs nothing from the host at all.
 */
interface RiderHost {
  readonly kind: SpellEffect['kind'];
  /** Whether the host rolled a saving throw a rider could repeat. */
  readonly rollsSave: boolean;
}

/** The action economy's own vocabulary, as sets, for untyped input. */
const SLOT_NAMES: ReadonlySet<string> = new Set(ACTION_SLOTS);
const ACTION_NAMES: ReadonlySet<string> = new Set(NAMED_ACTIONS);

/** What each named action normally costs, so an allowance granting nothing is refused. */
const NORMAL_PRICE: Readonly<Record<string, string>> = {
  attack: 'action',
  dash: 'action',
  disengage: 'action',
  dodge: 'action',
  magic: 'action',
  'opportunity-attack': 'reaction',
};

/** Every member of a list that is not in the vocabulary, named. */
const strangers = (list: unknown, known: ReadonlySet<string>): readonly string[] =>
  Array.isArray(list) ? list.filter((v) => typeof v !== 'string' || !known.has(v)).map(String) : [];

/**
 * A rule about a turn, held to the spenders that could enforce it.
 *
 * **The vocabulary is `combat.ts`'s, read as data rather than restated.** A
 * slot is a field of the turn budget and a named action is one a spender can
 * tell apart; both lists are exported from the module that enforces them, so
 * a rule this validator accepts is one some primitive actually refuses. A
 * second copy written out here is how a definition comes to name an action
 * nothing checks — which is a sentence that reads as adjudicated and is not.
 *
 * **Exported, because a feature holds one of these now.** `StandingGrant`'s
 * `action-rule` member is the same vocabulary written on a class table, so
 * `checkFeatureDefinition` asks this rather than a second copy of it: a
 * homebrew feature offering a Dodge out of a Bonus Action is refused at
 * authoring with the sentence a spell is refused with, and the two validators
 * cannot drift about which prices exist. The problem shape is the same three
 * fields either side, which is why nothing had to be generalised to share it.
 */
export function checkActionRule(
  rule: ActionRule | undefined,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  const bad = (reason: string): void => {
    found.push({ field: path, code: 'bad_action_rule', reason });
  };
  const noSuchSlot = (v: unknown): string =>
    `"${String(v)}" is not a slot a turn is spent out of; the engine has ${[...SLOT_NAMES].join(', ')}`;
  const noSuchAction = (v: unknown): string =>
    `"${String(v)}" is not an action a spender can tell apart; the engine names ${[...ACTION_NAMES].join(', ')}`;

  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
    bad(
      `a rule about a turn is an object saying what it forbids, permits or allows, and this is ${nameOf(rule)}`,
    );
    return;
  }

  if (rule.kind === 'forbids') {
    if (rule.slots !== undefined && !Array.isArray(rule.slots)) {
      bad('the slots a rule forbids are a list');
      return;
    }
    if (rule.actions !== undefined && !Array.isArray(rule.actions)) {
      bad('the actions a rule forbids are a list');
      return;
    }
    const slots = strangers(rule.slots, SLOT_NAMES);
    if (slots.length > 0) {
      bad(noSuchSlot(slots.join('", "')));
      return;
    }
    const actions = strangers(rule.actions, ACTION_NAMES);
    if (actions.length > 0) {
      bad(noSuchAction(actions.join('", "')));
      return;
    }
    // **A rule that forbids nothing is a sentence somebody meant to finish.**
    // It would validate, load, land on a creature and refuse nothing at all,
    // which is the silent wrong answer this whole file exists to refuse.
    if ((rule.slots?.length ?? 0) + (rule.actions?.length ?? 0) === 0) {
      bad('a rule that forbids no slot and no action forbids nothing; name what the spell takes away');
    }
    return;
  }

  if (rule.kind === 'permits-only') {
    if (typeof rule.slot !== 'string' || !SLOT_NAMES.has(rule.slot)) {
      bad(noSuchSlot(rule.slot));
      return;
    }
    // **A slot nothing is ever named in cannot be narrowed to a few.** It can
    // only be narrowed to nothing, which is what `forbids` already says — and
    // one sentence with two spellings is two places for it to go wrong.
    if (!SLOTS_WITH_NAMED_ACTIONS.includes(rule.slot)) {
      bad(`no action is ever taken by name out of ${rule.slot}, so narrowing it to a named few says nothing; forbid it instead`);
      return;
    }
    if (!Array.isArray(rule.actions)) {
      bad('the actions a narrowed slot still permits are a list');
      return;
    }
    const actions = strangers(rule.actions, ACTION_NAMES);
    if (actions.length > 0) bad(noSuchAction(actions.join('", "')));
    // **An empty list is legal, and is not the mistake `forbids` makes with
    // one.** SRD Confusion's fallback row is "the target takes no action",
    // which is exactly a slot narrowed to nothing and says so on purpose.
    return;
  }

  if (rule.kind === 'allows') {
    // **One action or a bundle of them, and never both.** SRD Conjure
    // Woodland Beings moves one action to a cheaper slot and SRD Patient
    // Defense buys two with one, so the member carries both spellings — but a
    // rule writing both has two answers to what the slot buys, and one writing
    // neither buys nothing at all.
    if ((rule.action === undefined) === (rule.actions === undefined)) {
      bad(
        'an allowance names one action it moves to a cheaper slot, or a list of the actions one spend buys together, and exactly one of the two',
      );
      return;
    }
    if (rule.actions !== undefined && !Array.isArray(rule.actions)) {
      bad('the actions one spend of an allowance buys together are a list');
      return;
    }
    // **A bundle of one is the other spelling**, and two ways of writing one
    // sentence is two places for it to be wrong: `actionRuleKey` reads the
    // list, so `{ actions: ['dash'] }` and `{ action: 'dash' }` would be two
    // rules that mean the same thing and could stand together.
    if (rule.actions !== undefined && rule.actions.length < 2) {
      bad('an allowance buying one action writes it as `action`; `actions` is for a spend that buys two or more together');
      return;
    }
    const buys = rule.action === undefined ? (rule.actions ?? []) : [rule.action];
    const strange = strangers(buys, ACTION_NAMES);
    if (strange.length > 0) {
      bad(noSuchAction(strange.join('", "')));
      return;
    }
    if (typeof rule.from !== 'string' || !SLOT_NAMES.has(rule.from)) {
      bad(noSuchSlot(rule.from));
      return;
    }
    // A bundle with a repeated action is a sentence that says one thing twice
    // and would hand the turn a granted action for something it already took.
    if (new Set(buys).size !== buys.length) {
      bad('an allowance that names the same action twice buys it once; say it once');
      return;
    }
    // **An allowance has to change the price**, or it grants what the rules
    // already grant. SRD Conjure Woodland Beings is worth writing because
    // Disengage costs an Action and this one costs a Bonus Action; "you may
    // Disengage as an Action" is simply the book. Reported before the pair
    // check below, because it is the more useful complaint about the same
    // clause: it says the sentence is redundant rather than unsupported.
    if (rule.action !== undefined && NORMAL_PRICE[rule.action] === rule.from) {
      bad(`the ${rule.action} action already costs ${rule.from}, so this allowance grants nothing`);
      return;
    }
    // **The pair has to reach a command that will charge it.** Not the action
    // alone: a command that offers a Bonus Action price does not thereby
    // offer a Reaction one, and an allowance naming a slot no command can
    // charge is a clause that validates, loads, lands and is never read —
    // and, before this was a pair, one whose command spent a different slot
    // than the one the spell named. `STATABLE_PRICES` is that map, and
    // `takeDisengage` refuses against the same one.
    //
    // **A bundle needs one such member and not all of them**, because the
    // spend happens once: the action taken first pays the slot, which only a
    // command that charges that pair can do, and the rest are handed to the
    // turn and spent out of what was bought. SRD Patient Defense is exactly
    // that asymmetry — a Disengage can be bought with a Bonus Action and a
    // Dodge never can, and the pair is legal because the Disengage opens it.
    if (!buys.some((action) => isStatablePrice(action, rule.from))) {
      const offered = Object.entries(STATABLE_PRICES)
        .map(([named, slots]) => `${named} as ${(slots ?? []).join(' or ')}`)
        .join('; ');
      bad(
        buys.length === 1
          ? `no command will charge ${rule.from} for the ${buys[0]} action, so an allowance saying so would be read by nothing; the engine offers ${offered}`
          : `no command will charge ${rule.from} for any of ${buys.join(', ')}, so one spend could never open this bundle; the engine offers ${offered}`,
      );
    }
    return;
  }

  if (rule.kind === 'one-of') {
    if (!Array.isArray(rule.slots)) {
      bad('the slots a rule couples to one another are a list');
      return;
    }
    const slots = strangers(rule.slots, SLOT_NAMES);
    if (slots.length > 0) {
      bad(noSuchSlot(slots.join('", "')));
      return;
    }
    // **A choice needs something to choose between.** One slot forecloses
    // nothing but itself, which is what `forbids` says in fewer words, and a
    // list of none says nothing at all — the same complaint a `forbids`
    // naming nothing gets, for the same reason.
    if (rule.slots.length < 2) {
      bad(
        'a rule that couples slots names at least two of them; one slot on its own forecloses nothing, which is what forbidding it says in fewer words',
      );
      return;
    }
    // And the same slot twice is a rule that closes the instant it is read:
    // the first spend of it would foreclose the very slot it was spent on.
    if (new Set(rule.slots as readonly string[]).size !== rule.slots.length) {
      bad('a rule that names the same slot twice would foreclose the slot it was just spent on; say each one once');
    }
    return;
  }

  if (rule.kind === 'grants') {
    // **The moment is not optional and has no default**, because the wrong one
    // is silent either way: a per-turn Expeditious Retreat is a free Dash
    // action every round for ten minutes, and a once-only Haste does nothing
    // after the turn it landed on.
    if (rule.at !== 'casting' && rule.at !== 'each-turn') {
      bad(
        `"${String(rule.at)}" is not a moment a turn could be handed an action; an extra action arrives at the casting or at the start of each of the creature's turns`,
      );
      return;
    }
    if (rule.only === undefined) return;
    if (!Array.isArray(rule.only)) {
      bad('the actions a granted action may be spent on are a list');
      return;
    }
    const actions = strangers(rule.only, ACTION_NAMES);
    if (actions.length > 0) {
      bad(noSuchAction(actions.join('", "')));
      return;
    }
    // **And an empty list is the mistake here, where `permits-only` may write
    // one.** Narrowing an existing slot to nothing is SRD Confusion's "the
    // target takes no action" and says something; handing over an extra action
    // that may be spent on nothing at all hands over nothing, and a sentence
    // that grants nothing is one somebody meant to finish.
    if (rule.only.length === 0) {
      bad(
        'an extra action that may be spent on no named action at all is an extra action that grants nothing; name what the spell hands over, or leave the narrowing off',
      );
    }
    return;
  }

  bad(
    `"${String((rule as { readonly kind?: unknown }).kind)}" is not something a spell does to a turn; a spell forbids, permits only, allows, grants, or couples one of several slots`,
  );
}

/**
 * A slot of the target's own turn the outcome spends, held to what a spender
 * could actually charge.
 *
 * {@link checkActionRule}'s neighbour, and the same discipline: the vocabulary
 * is `combat.ts`'s, read as data, so a rider this accepts is one a primitive
 * actually spends. Three rules, one per way the sentence can be unfinished.
 */
function checkBudgetSpend(
  spends: SpentBudget | undefined,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  const bad = (reason: string): void => {
    found.push({ field: path, code: 'bad_budget_spend', reason });
  };

  if (typeof spends !== 'object' || spends === null || Array.isArray(spends)) {
    bad(
      `a spend of somebody's turn is an object naming the slots it takes and what the book says they went on, and this is ${nameOf(spends)}`,
    );
    return;
  }

  if (!Array.isArray(spends.slots)) {
    bad('the slots a spell spends are a list');
    return;
  }
  // **Movement is the one slot this may not name**, and the refusal is here
  // rather than in the type because untyped input reaches this function first:
  // movement is measured in feet and spent by the foot, so a rider naming it
  // would spend nothing and say it worked. A spell that takes movement away
  // changes a Speed.
  const wrong = (spends.slots as readonly unknown[]).filter(
    (slot) =>
      typeof slot !== 'string' ||
      !(SLOTS_WITH_NAMED_ACTIONS as readonly string[]).includes(slot),
  );
  if (wrong.length > 0) {
    bad(
      `"${wrong.map(String).join('", "')}" is not a slot a spell can use up; the engine spends ${SLOTS_WITH_NAMED_ACTIONS.join(', ')}, and movement is measured in feet rather than in slots`,
    );
    return;
  }
  if (spends.slots.length === 0) {
    bad('a spend that takes no slot takes nothing; name what the sentence uses up');
    return;
  }

  // The phrase is what the table narrates from, and the engine performs
  // nothing — so without it the log says a Reaction vanished and nothing says
  // why. See {@link SpentBudget.on}.
  if (typeof spends.on !== 'string' || spends.on.trim() === '') {
    bad(
      'a spend says what the book says the slot went on; the engine performs none of it, so the phrase is the whole of what a log could tell anybody',
    );
  }
}

/**
 * A grant an outcome imposes, held to exactly what the standalone kinds are.
 *
 * `bonus` is `buff` minus its saving throw and `mode` is `roll-mode` minus
 * its selector's own, so the rules are the ones those two branches already
 * apply — shared rather than restated, because a second copy is a second
 * place for a rolled Armour Class to slip through.
 */
function checkModifierRider(
  rider: ModifierRider | undefined,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (rider?.kind === 'bonus') {
    checkBonusGrant(rider.bonus, rider.applies, path, found);
    return;
  }
  if (rider?.kind === 'mode') {
    checkRollModifier(rider.modifier, `${path}.modifier`, found);
    // The third rider that may carry a deadline of its own. Whether it *must*
    // is {@link checkGrantLifetimes}', exactly as for `speed-change`: SRD
    // Vicious Mockery hangs a Disadvantage off an Instantaneous cantrip, so
    // the casting is over before anything could lift it.
    checkRiderDuration(rider.lasts, path, found);
    // **And the other participant, where the sentence names one.** A role
    // rather than an id — the definition is written once and cast at whoever
    // is standing there — so the vocabulary is checked here and the rule about
    // *which rolls can carry one* comes from the same {@link
    // counterpartProblem} that judges a selector already holding an id. One
    // rule, one wording, two askers.
    if (rider.counterpart !== undefined) {
      if (rider.counterpart !== 'caster' && rider.counterpart !== 'target') {
        found.push({
          field: `${path}.counterpart`,
          code: 'bad_counterpart',
          reason: `"${String(rider.counterpart)}" is not a role a casting can bind; the other creature in a rider's world is the caster or the target`,
        });
      } else if (ROLL_FAMILIES.has(rider.modifier?.selector?.roll)) {
        const wrong = counterpartProblem(rider.modifier.selector.roll);
        if (wrong !== null) found.push({ field: `${path}.counterpart`, ...wrong });
      }
    }
    return;
  }
  if (rider?.kind === 'speed-change') {
    checkSpeedChange(rider, path, found);
    // **The one rider that may carry a deadline of its own.** Whether it
    // *must* is {@link checkGrantLifetimes}', which reads the definition: a
    // rider on a casting that never becomes ongoing has nothing that could end
    // it, and that is one rule over everything a definition leaves standing
    // rather than a second one here.
    checkRiderDuration(rider.lasts, path, found);
    return;
  }
  if (rider?.kind === 'action') {
    checkActionRule(rider.rule, `${path}.rule`, found);
    // **And one arm of that vocabulary a rider may not carry**, which is one
    // arm rather than the member because only one of the two is silent here.
    //
    // A rider writes `action-rule-granted` and nothing else, so what it hangs
    // is a rule standing on the creature. `each-turn` is read from there by
    // `extraActionsOwedAtTurnStart` at every boundary, whichever door hung it,
    // so a rider carrying one works and is accepted. `casting` is not read
    // from there by anything: the standalone kind's resolver diverts it into
    // the budget *instead of* hanging it, and a rider has no such branch — so
    // one arriving here would stand on the creature for the life of the
    // casting and be read by nobody. That is the silence {@link ActionRule.at}
    // says must not be possible, reached by the other door.
    if (rider.rule?.kind === 'grants' && rider.rule.at === 'casting') {
      found.push({
        field: `${path}.rule`,
        code: 'bad_action_rule',
        reason:
          'an extra action handed over at the casting goes into the turn that is running rather than onto the creature, and a rider has nowhere to put it; write it as an "action-rule" effect, whose resolver does, or say "each-turn" if the sentence means every turn',
      });
    }
    // The second rider that may carry a deadline of its own. Whether it
    // *must* is {@link checkGrantLifetimes}', exactly as for `speed-change`.
    checkRiderDuration(rider.lasts, path, found);
    return;
  }
  if (rider?.kind === 'healing') {
    checkHealingRule(rider.rule, `${path}.rule`, found);
    // The fourth rider that may carry a deadline of its own. Whether it *must*
    // is {@link checkGrantLifetimes}', exactly as for the three above: SRD
    // Chill Touch hangs its refusal off an Instantaneous cantrip, so the
    // casting is over before anything could lift it.
    checkRiderDuration(rider.lasts, path, found);
    return;
  }
  if (rider?.kind === 'benefit') {
    // The same fifteen words a condition rider and a removal are held to, so
    // Starry Wisp and Lesser Restoration are refused in one wording for one
    // mistake.
    checkCondition(String(rider.denies), `${path}.denies`, found);
    // SRD Mind Spike's "against you": the caster, and the only role the
    // sentence can name — see the member's own note, where the other role is
    // argued to be a denial against nobody.
    if (rider.against !== undefined && rider.against !== 'caster') {
      found.push({
        field: `${path}.against`,
        code: 'bad_denial_target',
        reason:
          'a denial narrowed to one creature names the caster; "against you" is the only such sentence the book writes, and a denial against the creature it is hung on is a denial against nobody',
      });
    }
    // The fifth rider that may carry a deadline of its own, and its only
    // writer is a cantrip too: SRD Starry Wisp denies the benefit "until the
    // end of your next turn" off an Instantaneous host, and without the
    // rider's own deadline nothing could ever hand it back.
    checkRiderDuration(rider.lasts, path, found);
    return;
  }
  found.push({
    field: `${path}.kind`,
    code: 'unknown_modifier_rider',
    reason: `"${String((rider as { kind?: unknown } | undefined)?.kind)}" is not a grant a rider carries; a rider adds a bonus, grants a mode, changes a Speed, changes what a turn permits, changes what healing does, or denies a condition's benefit`,
  });
}

/**
 * Which of the two things the SRD says about regaining hit points.
 *
 * The vocabulary as data, because this meets untyped input — and shared by the
 * standalone kind and the rider, so Beacon of Hope and Chill Touch are refused
 * in the same words for the same mistake.
 */
export function checkHealingRule(
  rule: unknown,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (rule !== 'maximised' && rule !== 'prevented') {
    found.push({
      field: path,
      code: 'unknown_healing_rule',
      reason: `"${String(rule)}" is not something the book says about healing; a rule maximises what is restored or forbids it outright`,
    });
  }
}

/** What a rider slot is, said once because three slots say it. */
const RIDER_LIST = 'a rider slot is a list of the riders the outcome hangs';

/**
 * The same effect, with a `conditions` slot no reader could walk taken off.
 *
 * {@link conditionRiderOf} is shared with the runtime and takes a *typed*
 * effect, so it reads the slot as a list — returning it outright for an
 * `attack`, spreading it for a `save`. Neither is iterable when untyped input
 * puts a number or a bare object there, and both threw one call before
 * anything could report it.
 *
 * So the slot is read here and the reader is handed an effect it can answer
 * for. **Removed rather than bailed out of**: a `save` whose extra riders are
 * unreadable still has its flat first rider, and a guard that dropped the
 * whole effect would turn a reported `grant_without_lifetime` into a missing
 * one. What is wrong with the slot itself is {@link checkRiders}' to report,
 * which is the same division of labour each individual unreadable rider
 * already follows.
 */
function withReadableRiders<E extends SpellEffect>(effect: E): E {
  const slot = (effect as { readonly conditions?: unknown }).conditions;
  return slot === undefined || Array.isArray(slot) ? effect : { ...effect, conditions: undefined };
}

/**
 * A rider slot a reader can walk: absent, or genuinely a list.
 *
 * The sibling of {@link withReadableRiders} for the `modifiers` slot, and it
 * is a *predicate* rather than a stripped copy because the two slots are read
 * in different places. `conditions` is handed to `conditionRiderOf`, which is
 * shared with the runtime and takes a typed effect, so the slot has to come
 * off before that reader sees it; `modifiers` is walked by
 * {@link grantCarried} directly, so declining to walk it is enough — and
 * stripping it would take the slot away from `checkRiders`, which is the thing
 * that reports what is actually wrong with it.
 */
const readableRiderList = (slot: unknown): boolean => slot === undefined || Array.isArray(slot);

/** Every rider one host carries, in the order `applyRiders` applies them. */
/**
 * A sentence about shed light, wherever it is written.
 *
 * Two hosts — the `light` effect kind and {@link OutcomeRiders.light} — so one
 * checker, for the reason `lightShedOn` is one landing: a second reading of
 * "a 10-foot radius" is a second place for it to mean something else.
 */
function checkShedLight(
  light: { readonly level?: unknown; readonly radius?: unknown; readonly dimBeyond?: unknown },
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (!(LIGHT_LEVELS as readonly string[]).includes(light.level as string)) {
    found.push({
      field: `${path}.level`,
      code: 'bad_light_level',
      reason: `"${String(light.level)}" is not a level of light; the glossary prints ${LIGHT_LEVELS.join(', ')}`,
    });
  }
  if (!Number.isInteger(light.radius) || (light.radius as number) < 5) {
    found.push({
      field: `${path}.radius`,
      code: 'bad_light_radius',
      reason: `light reaches a whole number of feet, at least one space, not ${String(light.radius)}`,
    });
  }
  if (
    light.dimBeyond !== undefined &&
    (!Number.isInteger(light.dimBeyond) || (light.dimBeyond as number) < 5)
  ) {
    found.push({
      field: `${path}.dimBeyond`,
      code: 'bad_light_radius',
      reason: `dim light beyond the bright reaches a whole number of feet, at least one space, not ${String(light.dimBeyond)}`,
    });
  }
}

/**
 * The ways a settled outcome moves a creature, as data.
 *
 * {@link ForcedMovement.kind}'s members, restated here for the reason every
 * other vocabulary in this file is: content arrives as JSON through
 * `loadContent` and the compiler was never asked. A member added to the type
 * and not here is refused rather than silently accepted, which is the safe
 * direction — `applyRiders` dispatches on this value, and a kind it does not
 * know would land as a push.
 */
const MOVEMENT_KINDS: ReadonlySet<string> = new Set(['push', 'lift']);

function checkRiders(
  riders: {
    readonly conditions?: readonly ConditionRider[];
    readonly modifiers?: readonly ModifierRider[];
    readonly delayed?: { readonly damage: DiceScaling; readonly damageType: string };
    readonly movement?: { readonly feet: number; readonly kind?: string };
    readonly spends?: SpentBudget;
    readonly light?: LightRider;
    readonly breaksConcentration?: true;
  },
  level: number,
  path: string,
  host: RiderHost,
  found: SpellDefinitionProblem[],
): void {
  // **A slot that is present and not a list is reported, not skipped.** `??`
  // reads `null` as absent, which is the right answer for a field the author
  // left out and the wrong one for a field they filled in wrongly: a
  // `conditions` that is a string has no `forEach`, and walking it was a
  // throw rather than an answer.
  if (riders.conditions !== undefined) {
    if (readsAsList(riders.conditions, `${path}.conditions`, RIDER_LIST, found)) {
      riders.conditions.forEach((rider, i) =>
        checkConditionRider(
          rider as ConditionRider | undefined,
          `${path}.conditions[${i}].name`,
          `${path}.conditions[${i}]`,
          host,
          found,
        ),
      );
    }
  }
  if (riders.modifiers !== undefined) {
    if (readsAsList(riders.modifiers, `${path}.modifiers`, RIDER_LIST, found)) {
      riders.modifiers.forEach((rider, i) =>
        checkModifierRider(rider as ModifierRider | undefined, `${path}.modifiers[${i}]`, found),
      );
    }
  }
  if (riders.delayed !== undefined) {
    if (
      readsAsObject(
        riders.delayed,
        `${path}.delayed`,
        'a later hit is an object naming the dice it deals and their type',
        found,
      )
    ) {
      const before = found.length;
      checkScaling(riders.delayed.damage, level, `${path}.delayed.damage`, found);
      checkDamageType(riders.delayed.damageType, `${path}.delayed.damageType`, found);
      // **The one host of an amount that may not be dice-free.** A delayed hit
      // is filed as `ScheduledDamage.notation` and rolled at the boundary it
      // falls due — randomness enters the log at the roll, never at the cast —
      // so the debt is carried as a notation and nothing else. An amount with
      // no dice has none to carry, and `scheduleDelayed` would have nowhere to
      // put the number. Refused here rather than dropped there.
      //
      // Only where the amount itself read cleanly, so a malformed one is
      // reported as the one defect it is.
      if (found.length === before && riders.delayed.damage.dice === undefined) {
        found.push({
          field: `${path}.delayed.damage`,
          code: 'delayed_rolls_nothing',
          reason:
            'a later hit is filed as a notation and rolled when it falls due, so it has to have dice to roll',
        });
      }
    }
  }
  // A movement says two things and there are two ways to get it wrong. SRD
  // writes "pushed 10 feet away from you" and "rises vertically up to 20
  // feet", and the lattice everything else is measured on has no spaces
  // smaller than five feet: a movement of nought feet is a sentence the book
  // never prints and an event that would move nobody while reading as though
  // it had.
  //
  // **And the way it goes is a closed vocabulary**, because `applyRiders`
  // dispatches on it: a kind nothing performs is a rider that would land
  // silently as a push, which is the confident wrong answer rather than the
  // missing one.
  if (riders.movement !== undefined) {
    if (
      readsAsObject(
        riders.movement,
        `${path}.movement`,
        'a movement is an object naming how far the creature goes',
        found,
      )
    ) {
      const { feet, kind } = riders.movement;
      if (!Number.isInteger(feet) || feet < 5 || feet % 5 !== 0) {
        found.push({
          field: `${path}.movement.feet`,
          code: 'bad_push_distance',
          reason: `a movement covers a whole number of spaces of the 5-foot lattice everything else is measured on, and "${String(feet)}" is not one`,
        });
      }
      if (kind !== undefined && !MOVEMENT_KINDS.has(kind)) {
        found.push({
          field: `${path}.movement.kind`,
          code: 'bad_push_kind',
          reason: `"${String(kind)}" is not a way a settled outcome moves a creature; the engine performs ${[...MOVEMENT_KINDS].join(' and ')}`,
        });
      }
    }
  }
  // The fifth slot, and the one that reaches the action economy: see
  // {@link SpentBudget}.
  if (riders.spends !== undefined) {
    checkBudgetSpend(riders.spends as SpentBudget | undefined, `${path}.spends`, found);
  }
  // The seventh, and the only one with nothing to be wrong about but its own
  // value: a clause the book either prints or does not — see
  // {@link OutcomeRiders.breaksConcentration}.
  if (riders.breaksConcentration !== undefined && riders.breaksConcentration !== true) {
    found.push({
      field: `${path}.breaksConcentration`,
      code: 'malformed_field',
      reason:
        'a spell either prints "and lose Concentration" or does not; the only value is true',
    });
  }
  // The sixth: a glow the outcome hangs on its target, checked by the same
  // rule the `light` effect kind is — see {@link checkShedLight}.
  if (riders.light !== undefined) {
    if (
      readsAsObject(
        riders.light,
        `${path}.light`,
        'shed light is an object naming its level and how far it reaches',
        found,
      )
    ) {
      checkShedLight(riders.light, `${path}.light`, found);
    }
  }
}

/** The `buff` rules, shared with the `bonus` rider that is `buff` minus its save. */
function checkBonusGrant(
  bonus: Bonus,
  applies: readonly BonusApplies[],
  path: string,
  found: SpellDefinitionProblem[],
  only?: BonusNarrowing,
): void {
  // The two are independent fields, so each is read on its own terms and a bad
  // one does not hide the other: a `buff` can perfectly well have an
  // unreadable bonus *and* apply to nothing, and an author wants both.
  const readable = readsAsObject(
    bonus,
    `${path}.bonus`,
    'a bonus is an object naming its source and what it adds',
    found,
  );
  const applied = readsAsList(
    applies,
    `${path}.applies`,
    'a bonus names the kinds of roll it reaches as a list',
    found,
  );

  const dice = readable ? bonus.dice : undefined;
  if (dice !== undefined && (typeof dice !== 'string' || !parseNotation(dice).ok)) {
    found.push({
      field: `${path}.bonus.dice`,
      code: 'bad_dice',
      reason: `"${String(dice)}" is not dice notation`,
    });
  }
  // SRD writes no rolled Armour Class and there is no moment at which a die
  // could be thrown for a standing number, so `armorClassOf` reads only the
  // flat half. A rolled bonus aimed at `ac` is therefore data nothing can
  // apply — silently, which is what makes it worth refusing here.
  if (applied && applies.includes('ac') && dice !== undefined) {
    found.push({
      field: `${path}.bonus.dice`,
      code: 'rolled_armor_class',
      reason:
        'an Armour Class is a standing number rather than a roll, so only a flat bonus reaches one',
    });
  }
  if (applied && applies.length === 0) {
    found.push({
      field: `${path}.applies`,
      code: 'bonus_applies_to_nothing',
      reason: 'a bonus that applies to no kind of roll is a bonus nothing reads',
    });
  }

  if (
    only !== undefined &&
    readsAsObject(
      only,
      `${path}.only`,
      'a narrowing is an object naming the ability or the skill the bonus reaches',
      found,
    )
  ) {
    checkBonusNarrowing(only, applied ? applies : [], path, found);
  }
}

/**
 * The rules a bonus's narrowing has to keep, which are the selector's rules
 * over a different field.
 *
 * Three of the four are {@link rollSelectorProblems} said about a bonus: a
 * value out of its vocabulary, a skill on a roll that uses none, and a skill
 * and an ability that disagree. They are stated again rather than shared
 * because the *families* differ — a selector names one `RollFamily` and a
 * bonus names a list of {@link BonusApplies} — and folding the two would mean
 * translating a list into a family that does not exist.
 *
 * **The fourth is this engine's rather than the book's, and is worth the
 * refusal for exactly that reason.** A narrowing is only ever *read* where a
 * gatherer is told the fact, and the two gatherers are told **one fact each**:
 * `checkBonuses` takes a skill and `savingSupport` takes the ability the save
 * is made with. So the readable pairings are the two the SRD writes — a skill
 * on an ability check (Guidance, Pass without Trace, Enthrall) and an ability
 * on a saving throw (Slow's "−2 penalty to … Dexterity saving throws") — and
 * every other pairing is refused rather than left to land and reach nothing.
 *
 * Three of the refusals are worth naming. An ability on an **attack** would
 * widen silently back to every swing its holder made, because that gatherer is
 * told nothing at all; an **Armour Class** is not a roll and is made with
 * nothing; and an ability on an **ability check** is refused even though the
 * roll knows one, because `checkBonuses` is not handed it — a filter nothing
 * answers withholds the bonus from every check there is, which is the *quiet*
 * direction of the same failure. A skill names its own governing ability, so
 * "Dexterity (Stealth)" is `{ skill: 'stealth' }` and loses nothing.
 *
 * Each of those lifts the day the gatherer passes what it already knows —
 * `RollQuery.ability` holds it for an attack, and the four check callers all
 * have one — and this is the single place that would stop refusing.
 */
function checkBonusNarrowing(
  only: BonusNarrowing,
  applies: readonly BonusApplies[],
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (only.ability === undefined && only.skill === undefined) {
    found.push({
      field: `${path}.only`,
      code: 'narrowing_narrows_nothing',
      reason: 'a narrowing that names neither an ability nor a skill is the bonus unnarrowed',
    });
    return;
  }

  const abilityKnown = only.ability === undefined || ABILITY_NAMES_SET.has(only.ability);
  const skillKnown = only.skill === undefined || SKILL_NAMES.has(only.skill);
  if (!abilityKnown) {
    found.push({
      field: `${path}.only.ability`,
      code: 'bad_ability',
      reason: `"${String(only.ability)}" is not an ability`,
    });
  }
  if (!skillKnown) {
    found.push({
      field: `${path}.only.skill`,
      code: 'bad_skill',
      reason: `"${String(only.skill)}" is not a skill`,
    });
  }

  // Only once both are known good: reading a value that is not a skill at all
  // would report a second, less useful problem about the first one.
  if (abilityKnown && skillKnown && only.ability !== undefined && only.skill !== undefined) {
    const owner = SKILL_ABILITY[only.skill];
    if (owner !== only.ability) {
      found.push({
        field: `${path}.only`,
        code: 'skill_ability_mismatch',
        reason: `${only.skill} is a ${owner} skill, so a ${only.ability} check never uses it`,
      });
    }
  }

  // One readable family per filter, and the filters are asked separately so a
  // narrowing that names both draws the problem each half has.
  const unreadable = (filter: 'skill' | 'ability', reads: BonusApplies): void => {
    if (only[filter] === undefined) return;
    const wrong = applies.filter((kind) => kind !== reads);
    if (wrong.length === 0) return;
    found.push({
      field: `${path}.only.${filter}`,
      code: 'narrowing_unreadable',
      reason:
        filter === 'skill'
          ? `a ${wrong.join(' or ')} uses no skill`
          : `nothing narrows a bonus on ${wrong.join(' or ')} by an ability: only the saving throw gatherer is told which ability the roll was made with`,
    });
  };
  unreadable('skill', 'ability-check');
  unreadable('ability', 'save');
}

/** The `roll-mode` rules, shared with the `mode` rider that is that kind minus its save. */
function checkRollModifier(
  modifier: RollModifier,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  // The selector's own coherence — an ability on a roll made with none, a
  // skill on a roll that uses none, a skill and an ability that disagree,
  // or "against the holder" on a roll the engine records no target for.
  // Every one of these compiles and then matches nothing for ever, or
  // matches far more than the spell says, which is what makes them worth
  // a refusal at authoring rather than a surprise at the table.
  if (
    !readsAsObject(
      modifier,
      path,
      'a granted mode is an object naming the mode and the rolls it reaches',
      found,
    )
  ) {
    return;
  }

  // **The selector is read once and the mode is checked once**, which is why
  // this is three guarded blocks rather than an early return with the mode
  // rule copied into it. The mode is the modifier's own field and is worth
  // answering for whatever the selector turns out to be; writing it twice
  // would be one rule in two places, and the copy nothing could reach would
  // be the one that drifted.
  const selector = modifier.selector;
  const readable = readsAsObject(
    selector,
    `${path}.selector`,
    'a selector is an object naming the kind of roll it picks out',
    found,
  );

  if (readable) {
    if (!ROLL_FAMILIES.has(selector.roll)) {
      found.push({
        field: `${path}.selector.roll`,
        code: 'bad_roll_family',
        reason: `"${String(selector.roll)}" is not a kind of roll the engine makes`,
      });
    }
    if (selector.relation !== 'roller' && selector.relation !== 'against-holder') {
      found.push({
        field: `${path}.selector.relation`,
        code: 'bad_roll_relation',
        reason: `"${String(selector.relation)}" is not a relation; a mode is the roller's or it is on rolls against the holder`,
      });
    }
  }

  // Between the two blocks, so a readable selector's problems collect in the
  // order they always did.
  if (modifier.mode !== 'advantage' && modifier.mode !== 'disadvantage') {
    found.push({
      field: `${path}.mode`,
      code: 'bad_roll_mode',
      reason: 'a granted mode is Advantage or Disadvantage; "normal" grants nothing',
    });
  }

  // **A grant that says it is spent by a roll, on a roll that spends nothing.**
  // The attack rollers and the ability-check rollers emit
  // `roll-modifier-consumed` and nothing else does, so on any other family the
  // flag is a promise about an ending nothing keeps — and the grant would run
  // to its deadline while the definition read as a one-shot. Which families
  // those are is `oneShotProblem`'s to say rather than this comment's.
  // Asked of a readable selector only, for the reason the combination rules
  // below are: a family that is not a family draws its own problem first.
  if (modifier.oneShot === true && readable && ROLL_FAMILIES.has(selector.roll)) {
    const wrong = oneShotProblem(selector.roll);
    if (wrong !== null) found.push({ field: `${path}.oneShot`, ...wrong });
  }

  if (!readable) return;

  if (selector.ability !== undefined && !ABILITY_NAMES_SET.has(selector.ability)) {
    found.push({
      field: `${path}.selector.ability`,
      code: 'bad_ability',
      reason: `"${String(selector.ability)}" is not an ability`,
    });
  }
  if (selector.skill !== undefined && !SKILL_NAMES.has(selector.skill)) {
    found.push({
      field: `${path}.selector.skill`,
      code: 'bad_skill',
      reason: `"${String(selector.skill)}" is not a skill`,
    });
  }
  // Only once the vocabulary is known good: the combination rules read
  // the values, and reading a value that is not an ability at all would
  // report a second, less useful problem about the first one.
  if (
    ROLL_FAMILIES.has(selector.roll) &&
    (selector.ability === undefined || ABILITY_NAMES_SET.has(selector.ability)) &&
    (selector.skill === undefined || SKILL_NAMES.has(selector.skill))
  ) {
    for (const problem of rollSelectorProblems(selector, (skill: Skill) => SKILL_ABILITY[skill])) {
      found.push({ field: `${path}.selector`, ...problem });
    }
  }
}

/**
 * A second resolution sequenced after the first — see `SequencedBurst`.
 *
 * Three rules, and the third is the one that matters: a Sphere and nothing
 * else, because that is the only shape the SRD prints where nobody is left to
 * state a direction; a list with something in it, because a burst that does
 * nothing is the `resolves_nothing` mistake one storey down; and **no burst
 * below a burst**, which is the recursion the rider design refuses arriving
 * one storey up. The child effects themselves are checked as effects by
 * {@link effectLists}, which walks this list.
 */
function checkSequencedBurst(
  burst: SequencedBurst,
  level: number,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (
    !readsAsObject(
      burst,
      path,
      'a second roll is an object naming the area it covers and what it does',
      found,
    )
  ) {
    return;
  }

  const area = (burst as { readonly area?: unknown }).area;
  if (
    !readsAsObject(area, `${path}.area`, 'a burst names the Sphere it fills', found) ||
    (area as { readonly kind?: unknown }).kind !== 'sphere'
  ) {
    found.push({
      field: `${path}.area`,
      code: 'burst_is_not_a_sphere',
      reason:
        'a second roll fills a Sphere centred on the space the first one reached; a Cone or a Line needs a direction and there is nobody left to state one',
    });
  } else {
    const radius = (area as { readonly radius?: unknown }).radius;
    if (!Number.isInteger(radius) || (radius as number) < 5) {
      found.push({
        field: `${path}.area.radius`,
        code: 'bad_burst_radius',
        reason: `a burst reaches a whole number of feet, at least one space, not ${String(radius)}`,
      });
    }
  }

  if (
    readsAsList(
      (burst as { readonly effects?: unknown }).effects,
      `${path}.effects`,
      'a second roll names what it does as a list of effects',
      found,
    )
  ) {
    const effects = burst.effects;
    if (effects.length === 0) {
      found.push({
        field: `${path}.effects`,
        code: 'burst_resolves_nothing',
        reason: 'a second roll that resolves nothing is a second roll nobody makes',
      });
    }
    effects.forEach((child, i) => {
      if (typeof child !== 'object' || child === null || Array.isArray(child)) return;
      if ((child as { readonly then?: unknown }).then !== undefined) {
        found.push({
          field: `${path}.effects[${i}].then`,
          code: 'nested_sequenced_roll',
          reason:
            'a second roll may not carry a third: a sequence of two is data and a sequence without end is a program',
        });
        return;
      }
      // **And the child by the rules every effect is held to**, because it is
      // an effect: the burst is a parent, so what hangs under it is checked
      // exactly as the spell's own list is rather than by a second reading.
      if (!EFFECT_KINDS.has(String((child as { readonly kind?: unknown }).kind))) return;
      checkEffect(child, level, `${path}.effects[${i}]`, found);
    });
  }
}

/** One effect, wherever it was found: the spell's own list, an activation, a trigger. */
function checkEffect(
  effect: SpellEffect,
  level: number,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  const host = (rollsSave: boolean): RiderHost => ({ kind: effect.kind, rollsSave });

  switch (effect.kind) {
    case 'attack':
      checkScaling(effect.damage, level, `${path}.damage`, found);
      checkDamageType(effect.damageType, `${path}.damageType`, found);
      if (effect.rolls !== undefined) {
        checkRollCount(effect.rolls, level, `${path}.rolls`, found);
      }
      // SRD Vampiric Touch's "within reach": a whole number of feet, at least
      // one space of the lattice everything else is measured on, and only on
      // the arm that has one — a ranged spell attack's distance is the
      // spell's own Range, and a second number there would be a second place
      // to get it wrong.
      if (effect.reach !== undefined) {
        if (effect.attack !== 'melee') {
          found.push({
            field: `${path}.reach`,
            code: 'reach_without_a_melee_attack',
            reason:
              'a reach is how far the caster’s arm goes; a ranged spell attack is bounded by the spell’s own Range',
          });
        } else if (!Number.isInteger(effect.reach) || (effect.reach as number) < 5) {
          found.push({
            field: `${path}.reach`,
            code: 'bad_reach',
            reason: `a reach is a whole number of feet, at least one space, not ${String(effect.reach)}`,
          });
        }
      }
      // An attack rolls an attack, so nothing it hangs has a save to repeat.
      checkRiders(effect, level, path, host(false), found);
      // **And the second roll, where the spell prints one.** The child
      // effects are checked as effects by `effectLists`' own walk — they are
      // effects — so what is left here is the shape of the slot and the one
      // rule that keeps the format data: a burst may not carry a burst.
      if (effect.then !== undefined) {
        checkSequencedBurst(effect.then, level, `${path}.then`, found);
      }
      return;

    // Damage that simply lands: the same two fields an attack's damage is
    // checked as, the same count of hits, and **no riders at all** — the
    // member carries no `& OutcomeRiders`, so there is nothing here to check
    // and a rider written beside one is refused by the shape rather than by a
    // rule. See the union member for why there is no outcome to ride.
    case 'auto-damage':
      checkScaling(effect.damage, level, `${path}.damage`, found);
      checkDamageType(effect.damageType, `${path}.damageType`, found);
      if (effect.rolls !== undefined) {
        checkRollCount(effect.rolls, level, `${path}.rolls`, found);
      }
      return;

    case 'save-damage':
      checkScaling(effect.damage, level, `${path}.damage`, found);
      checkDamageType(effect.damageType, `${path}.damageType`, found);
      // SRD Blight's "A Plant creature automatically fails the save" and
      // Shatter's "A Construct has Disadvantage on the save" — two outcomes
      // and not three, because nothing in the book gives a *named type*
      // Advantage on a save.
      if (effect.againstType !== undefined) {
        if (checkAgainstType(effect.againstType, `${path}.againstType`, found)) {
          const outcome = (effect.againstType as { outcome?: unknown }).outcome;
          if (outcome !== 'automatic-failure' && outcome !== 'disadvantage') {
            found.push({
              field: `${path}.againstType.outcome`,
              code: 'bad_typed_outcome',
              reason: `"${String(outcome)}" is not something a creature type does to a saving throw; the SRD prints an automatic failure and a Disadvantage`,
            });
          }
        }
      }
      if (effect.plus !== undefined) {
        if (
          readsAsList(
            effect.plus,
            `${path}.plus`,
            'extra damage is a list of the components the spell adds',
            found,
          )
        ) {
          effect.plus.forEach((extra, i) => {
            if (
              readsAsObject(
                extra,
                `${path}.plus[${i}]`,
                'a damage component is an object naming its dice and their type',
                found,
              )
            ) {
              checkScaling(extra.damage, level, `${path}.plus[${i}].damage`, found);
              checkDamageType(extra.damageType, `${path}.plus[${i}].damageType`, found);
            }
          });
        }
      }
      checkRiders(effect, level, path, host(true), found);
      return;

    case 'attack-damage':
      checkScaling(effect.damage, level, `${path}.damage`, found);
      checkDamageType(effect.damageType, `${path}.damageType`, found);
      checkCastingRepeat(effect.repeats, level, `${path}.repeats`, found);
      // SRD Divine Smite: "The damage increases by 1d8 if the target is a
      // Fiend or an Undead." A bare notation rather than a `DiceScaling`, so
      // `checkScaling`'s cantrip and slot rules have nothing to say about it —
      // what a malformed one would do is what a malformed one always does,
      // which is roll `NaN` dice.
      if (effect.againstType !== undefined) {
        if (checkAgainstType(effect.againstType, `${path}.againstType`, found)) {
          const extra = (effect.againstType as { extraDice?: unknown }).extraDice;
          if (typeof extra !== 'string' || !parseNotation(extra).ok) {
            found.push({
              field: `${path}.againstType.extraDice`,
              code: 'bad_dice',
              reason: `"${String(extra)}" is not dice notation`,
            });
          }
        }
      }
      return;

    // `save` spells its **first** rider flat and `condition` nests its only
    // one; both go through the reader that knows, so the two layouts cannot be
    // validated by two rules — and each names the field its own author wrote,
    // which is the whole reason the *name* path is the caller's to supply. The
    // extra riders a `save` carries are at their own path, because that is
    // where an author would look for them.
    // **The extra riders are read before `conditionRiderOf` rather than by
    // it.** That reader is shared with the runtime and takes a typed effect,
    // so it spreads `effect.conditions` to build its list — and a non-array
    // there is not iterable, which threw one call before anything could
    // report it. Reporting it here and then handing the reader the same
    // effect *without* the slot keeps the flat rider checked, rather than
    // rebuilding it and becoming a second place that knows how `save` spells
    // its first condition.
    case 'save': {
      const extra = (effect as { readonly conditions?: unknown }).conditions;
      if (extra !== undefined) readsAsList(extra, `${path}.conditions`, RIDER_LIST, found);
      // SRD Sleep's "Immunity to the Exhaustion condition": one condition the
      // glossary names, read off the target rather than stated by the caster.
      const spares = (effect as { readonly autoSucceedIf?: unknown }).autoSucceedIf;
      if (spares !== undefined) {
        const named = (spares as { readonly immuneTo?: unknown })?.immuneTo;
        if (typeof named !== 'string' || !CONDITION_NAMES.has(named)) {
          found.push({
            field: `${path}.autoSucceedIf.immuneTo`,
            code: 'unknown_condition',
            reason: `"${String(named)}" is not a condition the rules glossary names`,
          });
        }
      }
      const source = withReadableRiders(effect);
      if (effect.condition === undefined) checkSaveWithoutCondition(effect, path, found);
      else {
        checkConditionRider(
          conditionRiderOf(source)[0],
          `${path}.condition`,
          path,
          host(true),
          found,
        );
      }
      checkRiders(source, level, path, host(true), found);
      return;
    }

    case 'condition':
      checkConditionRider(
        effect.condition,
        `${path}.condition.name`,
        `${path}.condition`,
        // A condition imposed with no saving throw has none to repeat, which
        // this kind's own docstring has said in prose since it arrived.
        host(false),
        found,
      );
      return;

    // A removal names conditions and nothing else — no rider, no lifetime, no
    // roll — so the only thing there is to be wrong about is the list itself.
    // **An empty one is refused**, because a spell that ends no condition is a
    // definition claiming to do something and doing nothing, which is the
    // `resolves_nothing` mistake arriving one level down; and a repeat is
    // refused because a second `condition-removed` for the same name removes an
    // instance that is already gone, exactly as `duplicate_condition` refuses a
    // Paladin naming one twice and being charged for it twice.
    case 'end-condition': {
      if (
        !readsAsList(
          effect.conditions,
          `${path}.conditions`,
          'a removal names the conditions it ends as a list',
          found,
        )
      ) {
        return;
      }
      if (effect.conditions.length === 0) {
        found.push({
          field: `${path}.conditions`,
          code: 'ends_nothing',
          reason: 'a spell that ends no condition ends nothing; name the conditions the SRD prints',
        });
      }
      const seen = new Set<string>();
      effect.conditions.forEach((condition, i) => {
        checkCondition(condition, `${path}.conditions[${i}]`, found);
        if (seen.has(condition)) {
          found.push({
            field: `${path}.conditions[${i}]`,
            code: 'duplicate_condition',
            reason: `the ${condition} condition is ended twice, and the second removal has nothing left to take`,
          });
        }
        seen.add(condition);
      });
      return;
    }

    case 'heal':
      checkScaling(effect.healing, level, `${path}.healing`, found);
      return;

    case 'temp-hp':
      checkScaling(effect.amount, level, `${path}.amount`, found);
      return;

    /**
     * A payout at a turn boundary: when, what, and how much.
     *
     * Four rules, and each is a sentence the SRD either prints or refuses to:
     *
     * - **The moment** is the start or the end of a turn and nothing vaguer,
     *   the same two words `AreaTrigger.at` transcribes — where they fall is a
     *   full round apart.
     * - **The kind** is one of the three the book pays out on this schedule.
     * - **The amount** must be *something*. Dice, a printed number, the
     *   caster's modifier: a payout that names none of the three hands over
     *   nothing every turn for a minute, and it compiles — the reading that
     *   refuses an `end-condition` list that removes nothing and a granted
     *   defence that defends against nothing.
     * - **A damage type is required exactly when the payout is damage**, and
     *   refused otherwise. A typed pool of healing is a sentence the engine
     *   would have to invent a meaning for, and untyped damage is one nothing
     *   downstream could meet a Resistance with.
     */
    case 'turn-payout': {
      if (!TURN_MOMENT_NAMES.has(effect.at)) {
        found.push({
          field: `${path}.at`,
          code: 'bad_payout_moment',
          reason: `"${String(effect.at)}" is not the start or the end of a turn, and the two are a round apart`,
        });
      }
      if (!PAYOUT_KINDS.has(effect.payout)) {
        found.push({
          field: `${path}.payout`,
          code: 'unknown_payout',
          reason: `"${String(effect.payout)}" is not damage, healing or Temporary Hit Points`,
        });
      }
      // `typeof` first, exactly as `checkScaling` does: `parseNotation` reads a
      // string and this function meets untyped input, so judging it must not
      // throw on it.
      if (
        effect.dice !== undefined &&
        (typeof effect.dice !== 'string' || !parseNotation(effect.dice).ok)
      ) {
        found.push({
          field: `${path}.dice`,
          code: 'bad_dice',
          reason: `"${String(effect.dice)}" is not dice notation`,
        });
      }
      if (effect.flat !== undefined && !Number.isInteger(effect.flat)) {
        found.push({
          field: `${path}.flat`,
          code: 'bad_payout_amount',
          reason: `a printed payout is a whole number, got "${String(effect.flat)}"`,
        });
      }
      if (
        effect.dice === undefined &&
        effect.flat === undefined &&
        effect.addSpellcastingModifier !== true
      ) {
        found.push({
          field: path,
          code: 'pays_nothing',
          reason:
            'a payout that names no dice, no printed number and no spellcasting modifier hands over nothing at every turn boundary',
        });
      }
      if (effect.payout === 'damage') {
        if (effect.damageType === undefined) {
          found.push({
            field: `${path}.damageType`,
            code: 'missing_damage_type',
            reason: 'damage meets a creature’s defences by type, so a payout of damage names one',
          });
        } else {
          checkDamageType(effect.damageType, `${path}.damageType`, found);
        }
      } else if (effect.damageType !== undefined) {
        found.push({
          field: `${path}.damageType`,
          code: 'damage_type_on_a_payout',
          reason: `a payout of ${String(effect.payout)} has no damage type; nothing reads one`,
        });
      }
      return;
    }

    /**
     * A rule standing in front of healing: which of the two the SRD writes.
     *
     * There is nothing else to be wrong about. The rule names no amount, no
     * target and no moment of its own — the standalone kind runs for the
     * casting's own duration, which `checkGrantLifetimes` is what holds it to
     * — so the vocabulary *is* the whole check, shared with the `healing`
     * rider that says the same sentence off an attack.
     */
    case 'healing-rule':
      checkHealingRule(effect.rule, `${path}.rule`, found);
      return;

    /**
     * A hit point maximum a spell holds up: how much, and that it is upwards.
     *
     * Two rules beyond the amount's own, and each is a sentence this member
     * either prints or refuses to print:
     *
     * - **It goes up.** The kind carries a raise and no reduction, for the
     *   reason argued where it is declared, so a negative or a zero here is an
     *   author writing a member that does not exist rather than a number that
     *   is out of range.
     * - **No dice, today.** Every SRD sentence of this shape states a printed
     *   number, and a rolled maximum would be a die thrown once and then
     *   carried for eight hours with nothing in the log to say what it was.
     *   `flat` and `flatPerSlotLevelAbove` are exactly Aid's two sentences,
     *   and a notation is refused until something prints one.
     */
    case 'hit-point-maximum': {
      checkScaling(effect.amount, level, `${path}.amount`, found);
      if (!readsAsObject(effect.amount, `${path}.amount`, 'an amount is an object', found)) return;
      if (effect.amount.dice !== undefined) {
        found.push({
          field: `${path}.amount.dice`,
          code: 'rolled_hit_point_maximum',
          reason:
            'a hit point maximum is held up by a printed number; no SRD sentence rolls one, and a die thrown once and carried for hours is a number the log cannot account for',
        });
      }
      for (const key of ['flat', 'flatPerSlotLevelAbove'] as const) {
        const value = effect.amount[key];
        if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
          found.push({
            field: `${path}.amount.${key}`,
            code: 'bad_hit_point_maximum',
            reason: `a hit point maximum is raised by a positive whole number, got "${String(value)}"; this kind carries no reduction`,
          });
        }
      }
      return;
    }

    /**
     * A defence the attack path consults, with nobody taking a Reaction.
     *
     * Three shapes under one kind, and every rule below is about keeping a
     * definition from promising something no reader would keep:
     *
     * - **A decoy count and its threshold are whole and positive.** Zero
     *   duplicates is a spell that does nothing, and a threshold above the
     *   die's own faces is one that never deflects — both compile, and both
     *   are an author writing a sentence the book does not print.
     * - **A retaliation names a damage type**, because the flames have to be
     *   of something; and where it prints a pair to take the complement of,
     *   the pair is exactly two and holds the type the effect carries. A pair
     *   that did not hold it would invert to nothing and quietly fall back.
     * - **A ward names a real ability.** The attacker rolls it.
     *
     * What is deliberately *not* checked here is that the casting lasts long
     * enough to be attacked during — `checkGrantLifetimes` asks that of every
     * sourced grant through {@link grantCarried}, and this kind answers it
     * there like the thirteen before it.
     */
    case 'passive-defense': {
      const defense = effect.defense;
      if (!readsAsObject(defense, `${path}.defense`, 'a defence is an object', found)) return;
      if (!PASSIVE_DEFENSE_KINDS.has(defense.kind)) {
        found.push({
          field: `${path}.defense.kind`,
          code: 'unknown_passive_defense',
          reason: `"${String(defense.kind)}" is not a passive defence; the three are ${[...PASSIVE_DEFENSE_KINDS].join(', ')}`,
        });
        return;
      }

      if (defense.kind === 'decoys') {
        for (const key of ['count', 'deflectsOn'] as const) {
          const value = defense[key];
          if (!Number.isInteger(value) || value <= 0) {
            found.push({
              field: `${path}.defense.${key}`,
              code: 'bad_decoy_count',
              reason: `a decoy ${key} is a positive whole number, got "${String(value)}"`,
            });
          }
        }
        const notation = parseNotation(defense.die);
        if (!notation.ok) {
          found.push({
            field: `${path}.defense.die`,
            code: 'bad_decoy_die',
            reason: `"${String(defense.die)}" is not dice notation`,
          });
        } else if (
          Number.isInteger(defense.deflectsOn) &&
          defense.deflectsOn > notation.value.sides
        ) {
          found.push({
            field: `${path}.defense.deflectsOn`,
            code: 'unreachable_decoy_threshold',
            reason: `a ${defense.die} never rolls ${defense.deflectsOn}, so no blow could ever be deflected`,
          });
        }
        for (const sense of defense.unlessPerceivedWith ?? []) {
          if (!SENSES.has(sense)) {
            found.push({
              field: `${path}.defense.unlessPerceivedWith`,
              code: 'bad_sense',
              reason: `"${String(sense)}" is not a sense`,
            });
          }
        }
        for (const condition of defense.unlessCondition ?? []) {
          if (!CONDITION_NAMES.has(condition)) {
            found.push({
              field: `${path}.defense.unlessCondition`,
              code: 'bad_condition',
              reason: `"${String(condition)}" is not a condition`,
            });
          }
        }
        return;
      }

      if (defense.kind === 'ward') {
        if (!ABILITY_NAMES_SET.has(defense.ability)) {
          found.push({
            field: `${path}.defense.ability`,
            code: 'bad_ability',
            reason: `"${String(defense.ability)}" is not an ability`,
          });
        }
        return;
      }

      if (!parseNotation(defense.damage).ok) {
        found.push({
          field: `${path}.defense.damage`,
          code: 'bad_retaliation_damage',
          reason: `"${String(defense.damage)}" is not dice notation`,
        });
      }
      if (effect.damageType === undefined || !DAMAGE.has(effect.damageType)) {
        found.push({
          field: `${path}.damageType`,
          code: 'missing_damage_type',
          reason: 'damage dealt back to an attacker has a type, and it sits on the effect so that a casting may state it',
        });
      } else if (defense.complementOf !== undefined) {
        const pair = defense.complementOf;
        if (pair.length !== 2 || !pair.includes(effect.damageType)) {
          found.push({
            field: `${path}.defense.complementOf`,
            code: 'bad_complement',
            reason: `a complement is one of two printed types and must hold the one this effect carries; got ${JSON.stringify(pair)} beside "${effect.damageType}"`,
          });
        }
        for (const type of pair) {
          if (!DAMAGE.has(type)) {
            found.push({
              field: `${path}.defense.complementOf`,
              code: 'unknown_damage_type',
              reason: `"${String(type)}" is not a damage type`,
            });
          }
        }
      }
      if (
        defense.withinFeet !== undefined &&
        (!Number.isInteger(defense.withinFeet) || defense.withinFeet <= 0)
      ) {
        found.push({
          field: `${path}.defense.withinFeet`,
          code: 'bad_reach',
          reason: `a retaliation's reach is a positive whole number of feet, got "${String(defense.withinFeet)}"`,
        });
      }
      return;
    }

    case 'buff':
      checkBonusGrant(effect.bonus, effect.applies, path, found, effect.only);
      return;

    case 'roll-mode':
      checkRollModifier(effect.modifier, `${path}.modifier`, found);
      return;

    // A Speed change names an operation and, for one of the three, a number.
    // There is nothing else to be wrong about: it hangs no rider, offers no
    // escape and asks for no roll, so the pairing is the whole rule — shared
    // with the `speed-change` rider, which says the same sentence.
    case 'speed':
      checkSpeedChange(effect, path, found, 'modes');
      return;

    // Light a creature carries for the casting: a level the glossary names and
    // two radii in whole feet. The definition it sits on has to leave a record
    // — a duration, Concentration or "until dispelled" — because the patch is
    // sourced to the casting and lapses with it; `checkSpellDefinition` says
    // so at the definition, where the duration is.
    case 'light':
      checkShedLight(effect, path, found);
      return;

    // A sense conferred for the casting: one the glossary names, to a range.
    // SRD *Jump*: "can jump up to 30 feet by spending 10 feet of movement."
    // Both numbers are distances on the 5-foot lattice everything else is
    // measured on, and both are refused at zero: a jump of nothing is not a
    // jump, and one that costs nothing is a sentence the book does not print
    // and would hand a creature an unlimited number of free leaps a turn.
    case 'jump-allowance': {
      if (!Number.isInteger(effect.feet) || effect.feet <= 0 || effect.feet % 5 !== 0) {
        found.push({
          field: `${path}.feet`,
          code: 'bad_jump_distance',
          reason: `a jump covers a whole number of 5-foot spaces, not ${String(effect.feet)}`,
        });
      }
      if (
        !Number.isInteger(effect.costsMovement) ||
        effect.costsMovement <= 0 ||
        effect.costsMovement % 5 !== 0
      ) {
        found.push({
          field: `${path}.costsMovement`,
          code: 'bad_jump_cost',
          reason: `a jump is paid for in whole 5-foot spaces of movement, not ${String(effect.costsMovement)}`,
        });
      }
      return;
    }

    case 'sense': {
      if (!(SENSE_NAMES as readonly string[]).includes(effect.sense)) {
        found.push({
          field: `${path}.sense`,
          code: 'bad_sense',
          reason: `"${String(effect.sense)}" is not a sense the rules glossary names`,
        });
      }
      if (!Number.isInteger(effect.feet) || effect.feet < 5) {
        found.push({
          field: `${path}.feet`,
          code: 'bad_sense_range',
          reason: `a sense reaches a whole number of feet, at least one space, not ${String(effect.feet)}`,
        });
      }
      return;
    }

    case 'action-rule':
      checkActionRule(effect.rule, `${path}.rule`, found);
      return;

    // Two printed numbers and nothing else to be wrong about: how far, and
    // whether the space has to be one the caster can see. Where it goes is the
    // casting's to state, so the definition carries no destination at all.
    case 'teleport': {
      if (!Number.isInteger(effect.feet) || (effect.feet as number) < 5) {
        found.push({
          field: `${path}.feet`,
          code: 'bad_teleport_distance',
          reason:
            'a teleport covers a whole number of feet, and at least one space of the 5-foot lattice everything else is measured on',
        });
      }
      const sight = (effect as { requiresSight?: unknown }).requiresSight;
      if (sight !== undefined && sight !== true) {
        found.push({
          field: `${path}.requiresSight`,
          code: 'malformed_field',
          reason: 'a spell either prints "a space you can see" or does not; the only value is true',
        });
      }
      return;
    }

    /**
     * A stat block by its id, and the two numbers a spell may print over it.
     *
     * The id is checked for *shape* here and for *existence* nowhere: this
     * validator judges a definition on its own, and whether a world holds the
     * block is a question about the world. `summonCreature` answers it with
     * `unknown_monster` at the cast, which is the same refusal `addCreature`
     * has always made and the same reading `conjures.item` takes — its
     * catalogue check lives in `checkContent`, where both halves are present.
     */
    case 'summon': {
      checkSummonedForm(effect.monster, `${path}.monster`, found);
      if (
        effect.creatureType !== undefined &&
        !CREATURE_TYPES.includes(effect.creatureType as string)
      ) {
        found.push({
          field: `${path}.creatureType`,
          code: 'unknown_creature_type',
          reason: `"${String(effect.creatureType)}" is not one of the SRD's fourteen creature types`,
        });
      }
      checkKeptSummons(effect.kept, `${path}.kept`, found);
      checkPrintedSummonSpeeds(effect.speeds, `${path}.speeds`, found);
      const cannotAttack = (effect as { cannotAttack?: unknown }).cannotAttack;
      if (cannotAttack !== undefined && cannotAttack !== true) {
        found.push({
          field: `${path}.cannotAttack`,
          code: 'malformed_field',
          reason: 'a spell either prints "can\'t attack" or does not; the only value is true',
        });
      }
      for (const field of ['armorClass', 'hitPoints'] as const) {
        const scaled = effect[field];
        if (scaled === undefined) continue;
        if (
          typeof scaled !== 'object' ||
          scaled === null ||
          !Number.isInteger((scaled as SummonedNumber).base) ||
          (scaled as SummonedNumber).base < 1 ||
          !Number.isInteger((scaled as SummonedNumber).perSpellLevel) ||
          (scaled as SummonedNumber).perSpellLevel < 0
        ) {
          found.push({
            field: `${path}.${field}`,
            code: 'bad_summon_scaling',
            reason:
              'a number a spell prints over its own stat block is a whole base of at least 1 and a whole amount per spell level; SRD Find Steed writes "10 + 1 per spell level"',
          });
        }
      }
      const shares = (effect as { sharesCastersInitiative?: unknown }).sharesCastersInitiative;
      if (shares !== undefined && shares !== true) {
        found.push({
          field: `${path}.sharesCastersInitiative`,
          code: 'malformed_field',
          reason:
            'a spell either prints "it shares your Initiative count" or does not; the only value is true',
        });
      }
      return;
    }

    // Two arms, and the pair is the rule: a spell either supplies a base the
    // calculation competes over (Mage Armor) or a floor under the finished
    // total (Barkskin), and never both — the two are read at different points
    // of one sum, so an effect claiming both would be two rules in one field.
    case 'armor-class': {
      const minimum = (effect as { readonly minimum?: unknown }).minimum;
      const base = (effect as { readonly base?: unknown }).base;
      if (minimum !== undefined && base !== undefined) {
        found.push({
          field: path,
          code: 'armor_class_base_and_floor',
          reason:
            'an Armour Class a spell supplies is either a base the calculation competes over or a floor under the finished total, never both',
        });
        return;
      }
      if (minimum !== undefined) {
        if (!Number.isInteger(minimum) || (minimum as number) < 1) {
          found.push({
            field: `${path}.minimum`,
            code: 'bad_armor_class',
            reason: 'a floor under an Armour Class is a whole number of at least 1',
          });
        }
        return;
      }
      if (!Number.isInteger(base) || (base as number) < 1) {
        found.push({
          field: `${path}.base`,
          code: 'bad_armor_class',
          reason: 'a base Armour Class is a whole number of at least 1',
        });
      }
      return;
    }

    // A granted defence names types and says one thing about all of them, so
    // the only things to be wrong about are the list and the answer.
    //
    // **An empty list is refused**, for the reason an empty `end-condition`
    // list is: a definition that resists nothing resists nothing, and it
    // compiles. A repeat is refused too — Resistance is a boolean and
    // "multiple instances ... count as only one", so a second copy of a type
    // is a sentence the SRD has already answered rather than a second grant.
    case 'damage-defense': {
      // The list and the answer are independent fields, so an unreadable list
      // does not take the answer's own problem down with it.
      if (
        readsAsList(
          effect.damageTypes,
          `${path}.damageTypes`,
          'a granted defence names the damage types it answers as a list',
          found,
        )
      ) {
        if (effect.damageTypes.length === 0) {
          found.push({
            field: `${path}.damageTypes`,
            code: 'defends_nothing',
            reason:
              'a granted defence that names no damage type defends against nothing; name the types the SRD prints',
          });
        }
        const seen = new Set<string>();
        effect.damageTypes.forEach((type, i) => {
          checkDamageType(type, `${path}.damageTypes[${i}]`, found);
          if (seen.has(type)) {
            found.push({
              field: `${path}.damageTypes[${i}]`,
              code: 'duplicate_damage_type',
              reason: `${type} is named twice, and Resistance is a boolean rather than a tally`,
            });
          }
          seen.add(type);
        });
      }
      if (!DEFENSE_KINDS.has(effect.defense)) {
        found.push({
          field: `${path}.defense`,
          code: 'unknown_defense',
          reason: `"${String(effect.defense)}" is not Resistance, Immunity or Vulnerability`,
        });
      }
      return;
    }

    // The **adjustment** half of the printed line above, and the same three
    // rules about the list — SRD Resistance's "damage of the chosen type",
    // where the defence's is "Resistance to Fire damage". What is extra is the
    // notation, because this one rolls: a reduction with no dice takes nothing
    // off, and the ledger that caps it needs a value it can key on.
    case 'damage-reduction': {
      if (
        readsAsList(
          effect.damageTypes,
          `${path}.damageTypes`,
          'a reduction names the damage types it answers as a list',
          found,
        )
      ) {
        if (effect.damageTypes.length === 0) {
          found.push({
            field: `${path}.damageTypes`,
            code: 'reduces_nothing',
            reason:
              'a reduction that names no damage type never meets a blow it is about; name the types the SRD prints',
          });
        }
        const named = new Set<string>();
        effect.damageTypes.forEach((type, i) => {
          checkDamageType(type, `${path}.damageTypes[${i}]`, found);
          if (named.has(type)) {
            found.push({
              field: `${path}.damageTypes[${i}]`,
              code: 'duplicate_damage_type',
              reason: `${type} is named twice, and one blow of a type is one blow`,
            });
          }
          named.add(type);
        });
      }
      const reduces = effect.reduces?.dice;
      if (typeof reduces !== 'string' || !parseNotation(reduces).ok) {
        found.push({
          field: `${path}.reduces.dice`,
          code: 'bad_dice',
          reason: `"${String(reduces)}" is not dice notation`,
        });
      }
      // **`true` is the only value, and it is required.** Every SRD sentence
      // of this shape prints the limit, and a definition that left it out
      // would be granting a much larger rule by omission than by statement.
      if (effect.oncePerTurn !== true) {
        found.push({
          field: `${path}.oncePerTurn`,
          code: 'malformed_field',
          reason:
            'a reduction states the once-per-turn limit the SRD prints beside it; the only value is true',
        });
      }
      return;
    }

    // The condition half of the same sentence, and the same three rules — with
    // one field fewer, because there is no Vulnerability to a condition and no
    // halfway house: the list is the whole of what a definition states.
    //
    // **The vocabulary is the one every other reader of a condition name
    // uses**, so a granted Immunity to "bewildered" is refused by the same
    // `unknown_condition` a rider and a removal already report. A grant that
    // named a condition the engine does not apply would be a promise nothing
    // could keep — `conditionImmunitiesOf` would carry a name
    // `applyConditionTo` never compares against.
    case 'condition-immunity': {
      if (
        !readsAsList(
          effect.conditions,
          `${path}.conditions`,
          'a granted Immunity names the conditions it refuses as a list',
          found,
        )
      ) {
        return;
      }
      if (effect.conditions.length === 0) {
        found.push({
          field: `${path}.conditions`,
          code: 'immune_to_nothing',
          reason:
            'a granted Immunity that names no condition refuses nothing; name the conditions the SRD prints',
        });
      }
      const immune = new Set<string>();
      effect.conditions.forEach((condition, i) => {
        checkCondition(condition, `${path}.conditions[${i}]`, found);
        if (immune.has(condition)) {
          // An Immunity is a boolean, exactly as Resistance is, so a second
          // copy of a name is a sentence the SRD has already answered rather
          // than a second grant — `duplicate_damage_type`'s reasoning on the
          // other half of the printed line.
          found.push({
            field: `${path}.conditions[${i}]`,
            code: 'duplicate_condition',
            reason: `the ${condition} condition is named twice, and an Immunity is a boolean rather than a tally`,
          });
        }
        immune.add(condition);
      });
      return;
    }

    // A rider on later attacks names dice and a damage type, and there is
    // nothing else to be wrong about: the two clauses it transcribes —
    // "with weapons" and "to the target" — are booleans the SRD either prints
    // or does not. Both notation and type are **required**, which is what
    // separates this from the feature grant it mirrors: a feature may leave
    // the type absent and deal the weapon's own, and no SRD *spell* of this
    // shape does.
    case 'attack-rider':
      if (typeof effect.dice !== 'string' || !parseNotation(effect.dice).ok) {
        found.push({
          field: `${path}.dice`,
          code: 'bad_dice',
          reason: `"${String(effect.dice)}" is not dice notation`,
        });
      }
      checkDamageType(effect.damageType, `${path}.damageType`, found);
      return;

    // What the casting does to one weapon, and the three ways a definition can
    // write a sentence the SRD does not print.
    //
    // **A rider that changes nothing.** Every field below is optional, because
    // Shillelagh writes three of them and Magic Weapon one, and a rider with
    // none at all is a casting that names a weapon and then leaves it exactly
    // as it was — the `amounts_to_nothing` reading `DiceScaling` already takes.
    //
    // **A band with no base.** `bonusAtSlot` and `dieAtLevel` are both read as
    // "the highest key at or below the level, or the base", so a table with no
    // base is a spell that does nothing at its own level and something at a
    // higher one. `durationAtSlot` is the same table and gets the same rule.
    //
    // **Dice that are not dice**, in the base and in every band alike: the
    // notation reaches a grant in the log and is rolled a minute later, where
    // a refusal has nowhere to go.
    case 'weapon-rider': {
      if (
        effect.bonus === undefined &&
        effect.die === undefined &&
        effect.castingAbility !== true &&
        effect.damageTypes === undefined
      ) {
        found.push({
          field: path,
          code: 'rider_does_nothing',
          reason:
            'a weapon rider that adds no bonus, changes no die and offers neither an ability nor a damage type leaves the weapon exactly as it was',
        });
      }
      if (effect.bonus !== undefined && !Number.isInteger(effect.bonus)) {
        found.push({
          field: `${path}.bonus`,
          code: 'bad_bonus',
          reason: `${String(effect.bonus)} is not a whole number of plusses`,
        });
      }
      if (effect.bonusAtSlot !== undefined && effect.bonus === undefined) {
        found.push({
          field: `${path}.bonusAtSlot`,
          code: 'band_without_base',
          reason: 'a band table with no bonus beneath it does nothing at the spell’s own level',
        });
      }
      if (effect.dieAtLevel !== undefined && effect.die === undefined) {
        found.push({
          field: `${path}.dieAtLevel`,
          code: 'band_without_base',
          reason: 'a band table with no die beneath it does nothing at the spell’s own level',
        });
      }
      // **Both tables are judged before either is read**, because both are
      // read with `Object.keys` and a null arriving from JSON would throw
      // there. That is the rule every reader in this file keeps: a validator
      // that throws on the input it exists to judge has judged nothing.
      const bonusBands = readableBand(effect.bonusAtSlot, `${path}.bonusAtSlot`, found);
      const dieBands = readableBand(effect.dieAtLevel, `${path}.dieAtLevel`, found);
      checkBandKeys(bonusBands, `${path}.bonusAtSlot`, found);
      checkBandKeys(dieBands, `${path}.dieAtLevel`, found);
      if (
        effect.die !== undefined &&
        (typeof effect.die !== 'string' || !parseNotation(effect.die).ok)
      ) {
        found.push({
          field: `${path}.die`,
          code: 'bad_dice',
          reason: `"${String(effect.die)}" is not dice notation`,
        });
      }
      for (const [level, die] of Object.entries(dieBands ?? {})) {
        if (typeof die !== 'string' || !parseNotation(die).ok) {
          found.push({
            field: `${path}.dieAtLevel.${level}`,
            code: 'bad_dice',
            reason: `"${String(die)}" is not dice notation`,
          });
        }
      }
      if (effect.weapons !== undefined && !Array.isArray(effect.weapons)) {
        found.push({
          field: `${path}.weapons`,
          code: MALFORMED,
          reason: `a list of weapon ids, and this is ${nameOf(effect.weapons)}`,
        });
      } else if (effect.weapons !== undefined && effect.weapons.length === 0) {
        found.push({
          field: `${path}.weapons`,
          code: 'empty_weapon_list',
          reason:
            'a spell that names no weapon at all writes no list; an empty one would match nothing and refuse every casting',
        });
      }
      // **The offer made at each later swing**, held to the same two rules the
      // weapon list is: a list, and not an empty one. An empty offer is a
      // choice with nothing on it, which is a definition saying it offers a
      // type and offering none — and a type the engine has no defences for
      // would meet none of them.
      if (effect.damageTypes !== undefined && !Array.isArray(effect.damageTypes)) {
        found.push({
          field: `${path}.damageTypes`,
          code: MALFORMED,
          reason: `a list of damage types, and this is ${nameOf(effect.damageTypes)}`,
        });
      } else if (effect.damageTypes !== undefined) {
        if (effect.damageTypes.length === 0) {
          found.push({
            field: `${path}.damageTypes`,
            code: 'empty_damage_type_offer',
            reason:
              'a rider that offers no type at all writes no list; an empty one is a choice with nothing on it',
          });
        }
        effect.damageTypes.forEach((type, i) => {
          if (typeof type !== 'string' || !DAMAGE.has(type)) {
            found.push({
              field: `${path}.damageTypes[${i}]`,
              code: 'bad_damage_type',
              reason: `"${String(type)}" is not a damage type this engine knows`,
            });
          }
        });
      }
      return;
    }

    // The swing the casting makes itself. Three things to judge and the
    // definition-level rule is `checkWeaponAttack`'s: what is here is the
    // substitution, the offer and the band table, held to exactly the rules
    // the neighbouring `weapon-rider` holds its own offer and its own table
    // to — one reader for both, so a Cantrip Upgrade keyed by character level
    // cannot come to be validated two ways.
    case 'weapon-attack': {
      // Read back off an untyped shape, for the reason `againstType.outcome`
      // is: the field is a union of one, so the compiler narrows it to
      // `never` inside the branch that judges it — and what arrives here from
      // JSON is whatever the author wrote.
      const substituted = (effect as { readonly ability?: unknown }).ability;
      if (substituted !== 'spellcasting') {
        found.push({
          field: `${path}.ability`,
          code: 'bad_substitution',
          reason: `"${String(substituted)}" is not an ability a casting substitutes into its own swing; the SRD names the caster's spellcasting ability`,
        });
      }
      if (effect.damageTypes !== undefined && !Array.isArray(effect.damageTypes)) {
        found.push({
          field: `${path}.damageTypes`,
          code: MALFORMED,
          reason: `a list of damage types, and this is ${nameOf(effect.damageTypes)}`,
        });
      } else if (effect.damageTypes !== undefined) {
        if (effect.damageTypes.length === 0) {
          found.push({
            field: `${path}.damageTypes`,
            code: 'empty_damage_type_offer',
            reason:
              'a swing that offers no type at all writes no list; an empty one is a choice with nothing on it',
          });
        }
        effect.damageTypes.forEach((type, i) => {
          if (typeof type !== 'string' || !DAMAGE.has(type)) {
            found.push({
              field: `${path}.damageTypes[${i}]`,
              code: 'bad_damage_type',
              reason: `"${String(type)}" is not a damage type this engine knows`,
            });
          }
        });
      }
      const extra = effect.extraDamage;
      if (
        extra !== undefined &&
        readsAsObject(
          extra,
          `${path}.extraDamage`,
          'extra damage on the swing is an object naming its type and the levels its dice arrive at',
          found,
        )
      ) {
        checkDamageType(extra.damageType, `${path}.extraDamage.damageType`, found);
        const bands = readableBand(
          extra.diceAtLevel,
          `${path}.extraDamage.diceAtLevel`,
          found,
        );
        checkBandKeys(bands, `${path}.extraDamage.diceAtLevel`, found);
        // **A table with nothing in it adds nothing at every level**, which is
        // the `rider_does_nothing` reading one member up: a definition that
        // says it deals extra damage and names no level to deal it at is a
        // sentence the reader would silently answer "none" to for ever.
        if (bands !== undefined && Object.keys(bands).length === 0) {
          found.push({
            field: `${path}.extraDamage.diceAtLevel`,
            code: 'empty_band_table',
            reason:
              'a band table with no band in it adds dice at no level at all; a swing that adds none writes no extra damage',
          });
        }
        for (const [level, dice] of Object.entries(bands ?? {})) {
          if (typeof dice !== 'string' || !parseNotation(dice).ok) {
            found.push({
              field: `${path}.extraDamage.diceAtLevel.${level}`,
              code: 'bad_dice',
              reason: `"${String(dice)}" is not dice notation`,
            });
          }
        }
      }
      return;
    }

    case 'dispel':
    case 'interrupt-casting':
      return;

    // **Its own arm rather than a third name on the fall-through above**,
    // because it is the only one of the three with fields to check. A
    // percentage is a number a die is thrown against, so the range is the
    // whole of what makes one readable: at or below zero is an outcome already
    // decided, which the resolver would refuse to throw for, and above a
    // hundred is a face no d100 has. `cumulativeChance` caps a *running* total
    // at a hundred, and that is a different rule from a printed number the
    // author got wrong.
    case 'chance': {
      const printed = effect.percent;
      if (typeof printed === 'number') {
        if (!Number.isFinite(printed) || printed <= 0 || printed > 100) {
          found.push({
            field: `${path}.percent`,
            code: 'bad_percentage',
            reason: `${String(printed)} is not a chance a d100 can be thrown against; a percentage is above 0 and at most 100`,
          });
        }
      } else if (typeof printed !== 'object' || printed === null || Array.isArray(printed)) {
        found.push({
          field: `${path}.percent`,
          code: MALFORMED,
          reason: `a percentage, or a rule for growing one, and this is ${nameOf(printed)}`,
        });
      } else {
        const each = (printed as { readonly perPriorCasting?: unknown }).perPriorCasting;
        if (typeof each !== 'number' || !Number.isFinite(each) || each <= 0 || each > 100) {
          found.push({
            field: `${path}.percent.perPriorCasting`,
            code: 'bad_percentage',
            reason: `${String(each)} is not what each prior casting adds; a percentage is above 0 and at most 100`,
          });
        }
        // **A cumulative chance that counts nothing is a flat one spelled
        // wrong.** The count is what makes "each casting after the first"
        // mean anything, and nothing declares a tally — so the key and the
        // rest that empties it arrive with the effect or the growth is a
        // number nobody could ever read.
        const counted = (printed as { readonly countedBy?: unknown }).countedBy;
        if (typeof counted !== 'object' || counted === null || Array.isArray(counted)) {
          found.push({
            field: `${path}.percent.countedBy`,
            code: 'uncounted_chance',
            reason: `a chance that grows with the castings before it says where the count is kept, and this is ${nameOf(counted)}`,
          });
        } else {
          const key = (counted as { readonly key?: unknown }).key;
          if (typeof key !== 'string' || key.trim() === '') {
            found.push({
              field: `${path}.percent.countedBy.key`,
              code: 'uncounted_chance',
              reason: 'a count is kept under a key, and this names none',
            });
          }
          const recovers = (counted as { readonly recovers?: unknown }).recovers;
          if (typeof recovers !== 'string' || !RECOVERIES.has(recovers)) {
            found.push({
              field: `${path}.percent.countedBy.recovers`,
              code: 'bad_recovery',
              reason: `"${String(recovers)}" is not something a count recovers on; the engine knows ${[...RECOVERIES].join(', ')}`,
            });
          }
        }
      }
      if (effect.onFailure !== 'no-answer') {
        found.push({
          field: `${path}.onFailure`,
          code: 'bad_failure',
          reason: `"${String(effect.onFailure)}" is not something a failed chance does; the engine withholds what the spell hands to the table ("no-answer")`,
        });
      }
      return;
    }
  }
}

/**
 * A band table that can be read at all, or undefined with the reason reported.
 *
 * `Object.keys` on a null throws, and a definition that arrived as JSON is
 * exactly where a null gets written — so this is the gate in front of both
 * readers, and it reports rather than throwing, which is the rule the whole
 * file keeps.
 */
function readableBand(
  bands: unknown,
  at: string,
  found: SpellDefinitionProblem[],
): Readonly<Record<number, unknown>> | undefined {
  if (bands === undefined) return undefined;
  if (typeof bands !== 'object' || bands === null || Array.isArray(bands)) {
    found.push({
      field: at,
      code: MALFORMED,
      reason: `a band table keyed by level, and this is ${nameOf(bands)}`,
    });
    return undefined;
  }
  return bands as Readonly<Record<number, unknown>>;
}

/**
 * A band table's keys, held to the levels a band could be opened at.
 *
 * Both tables are keyed by a level — a slot's or a character's — and both are
 * read by "the highest key at or below". A key that is not a positive whole
 * number is a band that opens at no level the game has, and a table whose keys
 * arrived as JSON is exactly where that gets written by accident.
 */
function checkBandKeys(
  bands: Readonly<Record<number, unknown>> | undefined,
  at: string,
  found: SpellDefinitionProblem[],
): void {
  for (const key of Object.keys(bands ?? {})) {
    const level = Number(key);
    if (!Number.isInteger(level) || level < 1) {
      found.push({
        field: `${at}.${key}`,
        code: 'bad_band_level',
        reason: `${key} is not a level a band could open at`,
      });
    }
  }
}

/**
 * What a grant needs from the casting it hangs on.
 *
 * Everything a definition can leave standing after it resolves, and every one
 * of them is removed by `releaseCasting` or `releaseOnTarget` when the casting
 * ends: the sourced grants {@link grantCarried} enumerates — a `buff`, a
 * granted `roll-mode`, an `armor-class`, a `damage-defense`, a `speed`, an
 * `attack-rider`, a `condition-immunity` — and a condition whose rider says
 * neither `lasts` nor `outlivesCasting` and therefore "lasts as long as the
 * casting does". An **Instantaneous** casting is over the moment it resolves,
 * so each of those is a grant with no moment that could ever end it — a Bless
 * adding its d4 for ever, a paralysis with nothing to lift it, or a creature
 * that can never be Charmed again.
 *
 * The two escapes are the two the SRD writes and the rider already carries.
 * Color Spray is Instantaneous and blinds "until the end of your next turn",
 * which is a deadline of the rider's own; Grease's Prone outlives the Grease,
 * because Prone ends when the creature stands up. So the rule reads the rider
 * rather than the effect kind.
 *
 * **No definition in the catalogue violates it** — all of them were driven
 * through before it was written, as every rule in this file was — which is
 * what makes it a guard against the next one rather than a fix for this lot.
 */
function checkGrantLifetimes(
  definition: SpellDefinition,
  lasts: boolean,
  found: SpellDefinitionProblem[],
): void {
  const persists = lasts || definition.untilDispelled === true || definition.concentration;
  if (persists) return;

  // **The same enumeration `checkShape` walks**, rather than a second copy of
  // the same three lists. This used to name them itself and dereferenced two
  // of the holders directly, so a `areaTrigger` that untyped input made a
  // string threw here one call after the rules that report what is wrong with
  // it. {@link effectLists} answers the one question — which effect lists does
  // this definition carry — and a list nobody can walk simply does not appear,
  // so this contributes nothing for it and the report stays at the container,
  // which is the division of labour {@link grantCarried} already follows for a
  // rider it cannot read.
  for (const [where, effects] of effectLists(definition as unknown as Record<string, unknown>)) {
    (effects as readonly SpellEffect[]).forEach((effect, i) => {
      const carries = grantCarried(effect);
      if (carries === null) return;
      found.push({
        field: `${where}[${i}]`,
        code: 'grant_without_lifetime',
        // A `modifiers` rider can take neither escape the sentence offers, so
        // for that one the first half is the only advice there is — see
        // {@link grantCarried}, which is where the asymmetry is argued.
        reason: `${carries} lasts as long as the casting, and this casting is over the moment it resolves; give the spell a duration, or the rider a deadline of its own`,
      });
    });
  }
}

/**
 * The causes a trigger may name, as a set.
 *
 * The second place a runtime value restates a union, and here for the reason
 * {@link EFFECT_KINDS} is: the reducer switches on the cause and the compiler
 * makes that exhaustive, while untyped input needs the vocabulary as data. A
 * cause added to the type and not here is caught by the sweep that drives the
 * whole catalogue through this function.
 */
export const END_TRIGGER_CAUSES: ReadonlySet<string> = new Set([
  'target-attacks',
  'target-deals-damage',
  'target-casts',
  'target-dons-armor',
  'caster-or-ally-damages-target',
  'target-takes-damage',
  'target-drops-to-0',
  'summon-takes-damage',
  'shaken-awake',
]);

/** What a trigger may end: the casting, or the casting on one creature. */
const END_TRIGGER_SCOPES: ReadonlySet<string> = new Set(['casting', 'target']);

/**
 * The causes whose creature is not one the casting is **on**.
 *
 * `releaseOnTarget` lifts what a creature is holding of a casting, and a
 * summon is holding nothing — the casting is holding *it*. So `ends: 'target'`
 * on such a cause is a sentence that would find nothing to release and leave
 * the spell running, which compiles and is silently inert. Named as a set
 * rather than tested by hand so that the next cause of this shape joins it in
 * one place.
 */
const CAUSES_OUTSIDE_THE_CASTING: ReadonlySet<string> = new Set(['summon-takes-damage']);

/**
 * A trigger that ends a casting needs a casting that could still be running.
 *
 * The same sentence {@link checkGrantLifetimes} enforces about a grant, about
 * the other thing a definition can leave standing. A casting that never
 * becomes ongoing — no seconds, no turn-anchored deadline, no Concentration,
 * not "until dispelled" — is over the moment it resolves, and nothing ever
 * enters `state.ongoing` for the derived pass to find. A trigger on such a
 * definition is a sentence nothing could ever read, which compiles.
 *
 * **Its own code rather than `grant_without_lifetime`**, because it is a
 * different defect with a different fix: a grant is repaired by giving the
 * rider a deadline, and there is no rider here. It is reported at
 * `endsEarly`, where the field is.
 *
 * And the two vocabulary rules sit here rather than in `checkShape` because
 * they are value rules over a field the compiler already types for anything
 * written in this repository — what `checkShape` guarantees is that the list
 * is a list of objects, which is what the entry-level division IE-024 recorded
 * asks of it.
 */
function checkEndsEarly(
  definition: SpellDefinition,
  lasts: boolean,
  found: SpellDefinitionProblem[],
): void {
  const triggers = definition.endsEarly;
  if (triggers === undefined) return;
  if (!readsAsList(triggers, 'endsEarly', 'the triggers that end a casting early are a list', found)) {
    return;
  }

  if (triggers.length === 0) {
    found.push({
      field: 'endsEarly',
      code: MALFORMED,
      reason: 'a spell that prints no such sentence omits the field rather than writing an empty list',
    });
    return;
  }

  const persists = lasts || definition.untilDispelled === true || definition.concentration;
  if (!persists) {
    found.push({
      field: 'endsEarly',
      code: 'end_trigger_without_casting',
      reason:
        'this casting is over the moment it resolves, so it never becomes ongoing and nothing could end it early; give the spell a duration',
    });
  }

  const seen = new Set<string>();
  triggers.forEach((trigger, i) => {
    const path = `endsEarly[${i}]`;
    if (!readsAsObject(trigger, path, 'a trigger is an object naming what happens and what it ends', found)) {
      return;
    }

    const { on, ends } = trigger as { on?: unknown; ends?: unknown };

    if (typeof on !== 'string' || !END_TRIGGER_CAUSES.has(on)) {
      found.push({
        field: `${path}.on`,
        code: 'unknown_end_trigger',
        reason: `"${String(on)}" is not something the engine can see happen; a trigger whose fact the log does not hold is a missing shape rather than a definition`,
      });
    } else if (seen.has(on)) {
      // Two scopes for one cause is one sentence written twice, and the second
      // could never fire: the first match ends the casting or releases the
      // target, and there is nothing left for the other reading to do.
      found.push({
        field: `${path}.on`,
        code: 'duplicate_end_trigger',
        reason: `"${on}" is already written on this definition, and one sentence has one scope`,
      });
    } else {
      seen.add(on);
    }

    if (typeof ends !== 'string' || !END_TRIGGER_SCOPES.has(ends)) {
      found.push({
        field: `${path}.ends`,
        code: 'unknown_end_scope',
        reason: `"${String(ends)}" is neither "casting" nor "target"; the SRD prints one or the other and defaulting would pick for it`,
      });
    } else if (ends === 'target' && typeof on === 'string' && CAUSES_OUTSIDE_THE_CASTING.has(on)) {
      found.push({
        field: `${path}.ends`,
        code: 'inert_end_scope',
        reason: `"${on}" names a creature the casting is not on, so releasing the casting on it would lift nothing and leave the spell running; this sentence ends the casting`,
      });
    }
  });
}

/**
 * What this effect leaves standing, or null if it leaves nothing.
 *
 * **Every rider, not the first**, because a host carries several: Hideous
 * Laughter's failed save imposes the Prone *and* the Incapacitated, and a
 * definition whose second condition had no deadline would have gone unreported
 * behind a first one that did.
 *
 * **A `modifiers` rider is in the list unless it says how long it lasts**, and
 * not every member can. `bonus` carries no `lasts` and no `outlivesCasting`,
 * so on a spell with no casting to end it there is no way to write it
 * correctly and the only honest answer is to refuse; `speed-change`, `action`
 * and `mode` may each name a deadline of their own, and `EffectTarget.grants`
 * is what then takes the grant away. That asymmetry is the *reason* this walks
 * every modifier rider rather than the first: while every member carried
 * unconditionally the two readings agreed, and a member that may carry a
 * lifetime or not is one a Ray of Frost written beside a Bless would have
 * hidden behind.
 *
 * **Every rider is read through `?.`, because this meets untyped input like
 * every other reader in this file.** `checkShape` establishes an effect's
 * `kind` and nothing below it, so a rider can arrive missing, null, or not an
 * object at all — and `parseSpellDefinition` exists to hand back a *problem*
 * for exactly that. A validator that throws on the input it exists to judge
 * has judged nothing, which is the sentence `checkConditionRider` has carried
 * since it was written; this was the one reader that did not obey it. A rider
 * nobody can read carries no lifetime worth reporting, so it falls through to
 * the reader that will report what is actually wrong with it.
 */
function grantCarried(effect: SpellEffect): string | null {
  switch (effect.kind) {
    case 'buff':
      return 'a bonus';
    case 'roll-mode':
      return 'a granted Advantage or Disadvantage';
    case 'armor-class':
      return 'a base Armour Class';
    // The fifteenth sourced grant. It carries no deadline of its own, for the
    // reason the fifth, sixth and seventh do not: every SRD sentence of this
    // shape runs "until the spell ends", and a passive defence that outlived
    // its casting would answer a blow struck after the spell was over.
    case 'passive-defense':
      return 'a defence that answers a later attack';
    case 'damage-defense':
      return 'a granted Resistance, Immunity or Vulnerability';
    // The standalone kind carries no `lasts` at all — SRD Longstrider runs for
    // the hour the spell does, and no spell changes a Speed for less than its
    // own casting without a roll to hang the change on. A rider is where the
    // shorter deadline lives, because a rider is what Ray of Frost writes.
    case 'speed':
      return 'a changed Speed';
    // Light carried for the casting and a sense conferred for it: sourced to
    // the casting like the Speed above, and gone with it.
    case 'light':
      return 'light the target carries';
    case 'sense':
      return 'a sense the target gains';
    // And the two a creature carries about gravity. Neither carries a deadline
    // of its own, for the reason the light and the sense above do not: SRD
    // Feather Fall's ward runs "until the spell ends" by the same sentence
    // that ends it on a landing, and SRD Jump's allowance runs "until the
    // spell ends" in as many words — so an Instantaneous casting of either
    // would leave a creature that never pays for a landing again, or one that
    // jumps thirty feet for ten for the rest of its life.
    case 'fall-ward':
      return 'a fall this casting will not charge for';
    case 'jump-allowance':
      return 'a jump this casting bought';
    // The seventeenth sourced grant, and it carries no deadline of its own for
    // the reason the fifth, sixth and seventh do not: SRD Resistance says
    // "before the spell ends", so the casting is the only thing that could
    // stop the subtraction — and an Instantaneous casting would take a d4 off
    // every hit of that type for ever.
    case 'damage-reduction':
      return 'an amount taken off later damage';
    // The sixth sourced grant, and it carries no deadline of its own for the
    // reason `speed` does not: every SRD sentence of this shape says "until
    // the spell ends", so the casting is the only thing that could take the
    // die away and an Instantaneous one never could.
    case 'attack-rider':
      return 'extra damage on later attacks';
    // The fourteenth sourced grant, and the other half of the sixth's family.
    // It carries no deadline of its own for the same reason: SRD Shillelagh
    // runs "for the duration" and SRD Magic Weapon "until the spell ends", so
    // the casting is the only thing that could give the weapon back — and an
    // Instantaneous one would leave a Quarterstaff enchanted for ever.
    case 'weapon-rider':
      return 'a weapon this casting imbued';
    // The seventh, and it carries no deadline of its own for the reason the
    // fifth and sixth do not: every SRD sentence of this shape says "until the
    // spell ends" or prints a span the definition carries, and an Instantaneous
    // casting has no moment at which the Immunity could ever lift.
    case 'condition-immunity':
      return 'a granted Immunity to a condition';
    // The eighth, and it carries no deadline of its own for the reason the
    // fifth, sixth and seventh do not: SRD Heroism says "until the spell ends"
    // and Regenerate prints a span the definition carries, so the casting is
    // the only thing that could stop the payments — and an Instantaneous
    // casting would be an arrangement with no turns left to pay out on.
    case 'turn-payout':
      return 'a payout at every turn boundary';
    // The ninth, and it carries no deadline of its own for the reason the
    // fifth through eighth do not: every SRD sentence in the standalone
    // position runs for the spell's own duration, and an Instantaneous
    // casting would forbid a creature an action with nothing able to lift it.
    case 'action-rule':
      // **Except the member that leaves nothing standing.** `grants` at the
      // casting puts one action in the turn that is running, and a turn either
      // spends what it was handed or loses it with the turn — so there is
      // nothing an Instantaneous casting would fail to lift, and requiring a
      // duration would refuse a sentence the SRD prints on a cantrip's terms.
      // `each-turn` is the ordinary case and is held to the ordinary rule: it
      // is read at every boundary for as long as the casting runs.
      return effect.rule?.kind === 'grants' && effect.rule.at === 'casting'
        ? null
        : 'a rule about what a turn may be spent on';
    // The tenth and eleventh, and they carry no deadline of their own for the
    // reason the fifth through ninth do not: SRD Beacon of Hope runs for the
    // minute the spell does and SRD Aid for its eight hours, so the casting is
    // the only thing that could take either away. An Instantaneous one would
    // leave a creature unable to regain hit points for ever, or five points
    // richer for ever — the two directions of the same missing ending.
    case 'healing-rule':
      return 'a rule standing in front of healing';
    case 'hit-point-maximum':
      return 'a hit point maximum held up';
    default: {
      // **The rider whose undoing is part of the sentence that imposed it.**
      // SRD Levitate: "remains suspended there for the duration ... When the
      // spell ends, the target floats gently to the ground." The landing is
      // `releaseCasting`'s, so a casting that is over the moment it resolves
      // would leave a creature in the air with nothing that could ever bring
      // it down — the same defect a Feather Fall with no duration is, arriving
      // through a rider rather than through an effect kind.
      //
      // A push carries no such debt and is deliberately not here: a shove is
      // finished the instant it lands, and Thunderwave is Instantaneous.
      const moved = (effect as { readonly movement?: { readonly kind?: unknown } }).movement;
      if (typeof moved === 'object' && moved !== null && moved.kind === 'lift') {
        return 'a creature this casting is holding in the air';
      }
      for (const rider of conditionRiderOf(withReadableRiders(effect))) {
        // Unreadable first, lifetime second. A rider that is missing, null or
        // not an object at all has no lifetime to be wrong about, and is
        // `checkConditionRider`'s to report.
        //
        // **An array is unreadable too**, and saying so is the whole of the
        // difference: `typeof [] === 'object'` and it is not null, so a list
        // walked straight past this guard, found no `lasts` and no
        // `outlivesCasting`, and drew a second problem about "the undefined
        // condition" — a grant it never carried, reported beside the real
        // complaint.
        if (typeof rider !== 'object' || rider === null || Array.isArray(rider)) continue;
        if (rider.lasts !== undefined || rider.outlivesCasting === true) continue;
        return `the ${String(rider.name)} condition`;
      }
      // **Every modifier rider, not the first**, for the reason the condition
      // loop above walks every one: a plural slot is exactly where a second
      // offender hides behind a first that is fine. It read `[0]` while both
      // members carried unconditionally, so the two readings agreed; the
      // `speed-change` rider is the first that may carry a lifetime *or* not,
      // and a Ray of Frost written beside a Bless would have gone unreported.
      //
      // **A slot nobody can walk is not walked**, exactly as an unreadable
      // `conditions` is not: `modifierRidersOf` spreads the slot, so untyped
      // input putting a number there threw one call before anything could
      // report it. What is wrong with the slot is `checkRiders`' to say.
      if (!readableRiderList((effect as { readonly modifiers?: unknown }).modifiers)) return null;
      for (const rider of modifierRidersOf(effect)) {
        // `?.` on the discriminant, so absent, null and a kind this engine does
        // not know take the same branch — and it is the branch that reports
        // nothing, because `checkModifierRider` is what says what is wrong.
        switch (rider?.kind) {
          case 'bonus':
            return 'a bonus';
          case 'mode':
            // The third rider with an escape of its own, and it arrived with
            // SRD Vicious Mockery: a Disadvantage on "the next attack roll it
            // makes before the end of its next turn", hung off a cantrip whose
            // casting ends the instant it resolves. `lasts` is the rider's own
            // deadline and `EffectTarget.grants` is what takes the mode away.
            if (rider.lasts === undefined) return 'a granted Advantage or Disadvantage';
            break;
          case 'speed-change':
            // The one rider with an escape of its own. `lasts` is a deadline
            // the rider owns, so a casting that ends the instant it resolves
            // still has something that takes the Speed back.
            if (rider.lasts === undefined) return 'a changed Speed';
            break;
          case 'action':
            // The second, for the same reason: SRD Shocking Grasp forbids an
            // Opportunity Attack "until the start of its next turn" on an
            // Instantaneous cantrip, and without the rider's own deadline
            // nothing could ever hand the Reaction back.
            if (rider.lasts === undefined) return 'a rule about what a turn may be spent on';
            break;
          case 'healing':
            // The fourth, and its only writer is a cantrip too: SRD Chill
            // Touch stops a target regaining hit points "until the end of your
            // next turn", and without the rider's own deadline nothing could
            // ever let them regain any again.
            if (rider.lasts === undefined) return 'a rule standing in front of healing';
            break;
          case 'benefit':
            // The fifth, and a cantrip's again: SRD Starry Wisp denies the
            // Invisible condition's benefit "until the end of your next turn"
            // off an Instantaneous host, so nothing but the rider's own
            // deadline could ever hand it back.
            if (rider.lasts === undefined) return 'a benefit taken off a condition';
            break;
          default:
            break;
        }
      }
      // **And the sixth slot, which is not a `modifiers` member.** A glow the
      // outcome hangs is sourced to the casting and lapses with its record, so
      // an Instantaneous host would lay a patch on the lattice that nothing
      // could ever put out — the same ending the standalone `light` kind is
      // held to one branch up. It carries no `lasts`, for the reason that kind
      // carries none: every SRD sentence in this position runs for the spell's
      // own duration.
      if ((effect as { readonly light?: unknown }).light !== undefined) {
        return 'light the target sheds';
      }
      return null;
    }
  }
}

/**
 * Everything wrong with a definition, rather than the first thing.
 *
 * The shape `checkCharacter` already uses, for the same reason: somebody
 * filling in a definition does not want to be told about one mistake at a
 * time. {@link parseSpellDefinition} is the `Result` half, for a caller that
 * wants a definition or a refusal.
 */
export function checkSpellDefinition(
  definition: SpellDefinition,
): readonly SpellDefinitionProblem[] {
  const found: SpellDefinitionProblem[] = [];

  if (!/^[a-z0-9-]+$/.test(definition.id)) {
    found.push({
      field: 'id',
      code: 'bad_id',
      reason: 'an id is lower-case letters, digits and hyphens; it is the join to the parsed SRD',
    });
  }

  if (definition.name.length === 0) {
    found.push({ field: 'name', code: 'bad_name', reason: 'a spell needs a name' });
  }

  // `castingSource` encodes the link as `Hold Person#cast:3` and `castingIdOf`
  // reads it back, so a `#` in a name forges a casting link — which is why
  // `castSpell` already refuses one. Catching it here catches it at authoring,
  // before a definition carrying it is ever cast.
  if (definition.name.includes('#')) {
    found.push({
      field: 'name',
      code: 'forged_casting_link',
      reason: 'a "#" in a spell name would forge the casting link effects are tied to',
    });
  }

  if (!Number.isInteger(definition.level) || definition.level < 0 || definition.level > 9) {
    found.push({
      field: 'level',
      code: 'bad_level',
      reason: 'a spell level is a whole number from 0 (cantrip) to 9',
    });
  }

  if (!SCHOOLS.has(definition.school)) {
    found.push({
      field: 'school',
      code: 'unknown_school',
      reason: `"${definition.school}" is not one of the eight schools of magic`,
    });
  }

  if (!CASTING_TIMES.has(definition.castingTime)) {
    found.push({
      field: 'castingTime',
      code: 'unknown_casting_time',
      reason: `"${definition.castingTime}" is not a casting time the engine has`,
    });
  }

  // SRD "Longer Casting Times": "minutes or even hours". `long` is a bucket
  // rather than a span, so a definition in it has to say which — the engine
  // cannot defer a casting to a moment nobody named, and it will not invent
  // one. The floor of a minute is what the bucket *means*, so a `long` casting
  // shorter than one is incoherent rather than merely unusual.
  if (definition.castingTime === 'long') {
    const seconds = definition.castingSeconds;
    if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < LONG_CASTING_SECONDS) {
      found.push({
        field: 'castingSeconds',
        code: 'bad_casting_seconds',
        reason:
          'a casting time of "1 minute or more" is a whole number of seconds, at least 60; the engine defers the casting to that moment and will not invent one',
      });
    }
  } else if (definition.castingSeconds !== undefined) {
    found.push({
      field: 'castingSeconds',
      code: 'casting_seconds_without_long',
      reason:
        'only a casting time of a minute or more takes a span of seconds; an Action, a Bonus Action and a Reaction are moments in a turn',
    });
  }

  if (definition.range.kind === 'ranged' && definition.range.feet <= 0) {
    found.push({
      field: 'range.feet',
      code: 'bad_range',
      reason: 'a ranged spell reaches more than nothing',
    });
  }

  /**
   * A Range the DM decides is a Range the engine measures nothing against, so
   * the printed words have to reach the table or nobody ever learns there was
   * a question. The two halves of the handover are checked against each other
   * here and nowhere else: `dmDecides` may stand alone — a spell with an
   * ordinary Range may still print a sentence only the DM can answer — and
   * `range: { kind: 'dm' }` may not.
   */
  if (definition.range.kind === 'dm' && (definition.dmDecides ?? []).length === 0) {
    found.push({
      field: 'dmDecides',
      code: 'silent_dm_range',
      reason:
        'a Range the DM decides has to say what the book printed, or the casting silently measures nothing and never says why',
    });
  }

  // — targeting ————————————————————————————————————————————————————————————

  if (definition.targets.unlimited === true && definition.targets.count !== 0) {
    found.push({
      field: 'targets.count',
      code: 'unlimited_with_count',
      reason:
        'SRD "each creature of your choice" names no number, so `count` must be 0 alongside `unlimited`',
    });
  }

  if (definition.targets.count < 0) {
    found.push({
      field: 'targets.count',
      code: 'bad_target_count',
      reason: 'a target count is not negative',
    });
  }

  /*
   * The creature type a spell demands, held to the same fourteen an outcome
   * clause is.
   *
   * `againstType.types` has been checked against the glossary since it
   * arrived and this was a bare string, so `mustBeType: 'Goblinoid'` validated
   * while `againstType.types: ['Goblinoid']` did not — one asymmetry, two
   * answers to one question.
   *
   * SRD 5.2.1 prints a Goblin Warrior as "Small Fey (Goblinoid)". The glossary
   * gives the fourteen types rules and gives a subtype tag none at all, so a
   * spell demanding one names nobody: `isCreatureType` compares the type and
   * never a substring of it, which is exactly what makes a tag unmatchable
   * rather than loosely matchable. The same code as the outcome clause,
   * because it is the same defect.
   */
  /*
   * The three clauses that narrow what an **area** catches, held to a
   * definition whose catch is the one they are read at.
   *
   * Each is read in `areaTargets` — the seam where a **casting** settles who
   * it caught — and nowhere else. Two definitions could therefore carry one
   * with no reader, and both are refused here rather than being applied to
   * half of the spell:
   *
   * | | |
   * |---|---|
   * | `area_filter_without_area` | a spell cast at named targets: there is no catch, so the field is a sentence the author believed they had said and nothing ever reads |
   * | `area_filter_and_a_later_catch` | a **persistent** area: `creaturesStandingInCastingArea` re-derives the catch off the pinned record at every boundary the spell triggers on, and reads `unaffected` and nothing else — so the filter would hold for the casting and let go of it a turn later |
   *
   * The second is the one worth naming. `areaTrigger` and `areaStanding` are
   * the two clauses that make an area go on catching people, and a Web that
   * spared its caster at the cast and Restrained her when she stepped back in
   * would be the silent half-applied rule this whole discipline is about. The
   * day a spell prints both sentences the reader is written first and this row
   * goes; until then the refusal is what says the reader is missing.
   *
   * The other two target clauses need no such guard, because they are checked
   * wherever a caller *names* somebody and every definition does.
   */
  for (const clause of ['notTheCaster', 'mustSeeTheOrigin', 'chosenFromTheArea'] as const) {
    if (definition.targets[clause] !== true) continue;
    if (definition.area === undefined) {
      found.push({
        field: `targets.${clause}`,
        code: 'area_filter_without_area',
        reason: `\`${clause}\` narrows what an area catches, and this spell fills no area, so nothing would ever read it`,
      });
      continue;
    }
    if (definition.areaTrigger !== undefined || definition.areaStanding !== undefined) {
      found.push({
        field: `targets.${clause}`,
        code: 'area_filter_and_a_later_catch',
        reason: `\`${clause}\` narrows the catch this casting settles, and an area that goes on catching creatures at a later boundary re-derives its own catch from the pinned record and would not narrow it`,
      });
    }
  }

  const mustBeType = definition.targets.mustBeType;
  if (mustBeType !== undefined && !CREATURE_TYPES.includes(mustBeType as string)) {
    found.push({
      field: 'targets.mustBeType',
      code: 'unknown_creature_type',
      reason: `"${String(mustBeType)}" is not one of the SRD's fourteen creature types; a subtype tag such as Goblinoid is not a type and has no rules of its own`,
    });
  }

  // — geometry —————————————————————————————————————————————————————————————

  // One says the geometry chooses who is caught; the other says it bounds a
  // choice the caller makes. A definition that claimed both would have no
  // answer to "did the caster pick these targets".
  if (definition.area !== undefined && definition.targetsWithin !== undefined) {
    found.push({
      field: 'targetsWithin',
      code: 'area_and_targets_within',
      reason: 'a spell either fills an area or bounds a chosen list, never both',
    });
  }

  for (const [key, area] of [
    ['area', definition.area],
    ['targetsWithin', definition.targetsWithin],
  ] as const) {
    if (area === undefined) continue;
    if (!readsAsObject(area, key, 'a template is an object naming its shape', found)) continue;
    if (!AREA_KINDS.has(area.kind)) {
      found.push({
        field: `${key}.kind`,
        code: 'unknown_area',
        reason: `"${area.kind}" is not one of the SRD's six areas of effect, nor the wall the caster draws`,
      });
      continue;
    }
    if (area.kind === 'wall') checkWall(area, key, definition, found);
  }

  if (definition.areaTrigger !== undefined) {
    if (definition.area === undefined) {
      found.push({
        field: 'areaTrigger',
        code: 'trigger_without_area',
        reason: 'a persistent area trigger needs an area to be persistent in',
      });
    }
    if (
      readsAsObject(
        definition.areaTrigger,
        'areaTrigger',
        'an area trigger is an object naming the moment it fires and what it resolves',
        found,
      ) &&
      readsAsList(
        definition.areaTrigger.effects,
        'areaTrigger.effects',
        'a trigger resolves a list of effects',
        found,
      )
    ) {
      if (definition.areaTrigger.effects.length === 0) {
        found.push({
          field: 'areaTrigger.effects',
          code: 'trigger_does_nothing',
          reason: 'a trigger that resolves nothing is a save the engine would roll for no reason',
        });
      }
      definition.areaTrigger.effects.forEach((effect, i) =>
        checkEffect(effect, definition.level, `areaTrigger.effects[${i}]`, found),
      );
      checkPointMeasuredTrigger(definition.areaTrigger, definition.area, found);
    }
  }

  if (definition.areaStanding !== undefined) {
    if (definition.area === undefined) {
      found.push({
        field: 'areaStanding',
        code: 'standing_without_area',
        reason:
          'a standing effect an area has needs an area to stand in; nothing derives it from a spell with no volume',
      });
    }
    if (
      readsAsObject(
        definition.areaStanding,
        'areaStanding',
        'a standing area effect is an object naming what the area does to whoever is in it',
        found,
      )
    ) {
      // One kind, and it is named rather than assumed: a second SRD sentence
      // of this shape adds a member to `AreaStanding`, and data written
      // against it must not resolve to the Speed rule by default.
      if (definition.areaStanding.kind !== 'speed') {
        found.push({
          field: 'areaStanding.kind',
          code: 'unknown_area_standing',
          reason: `"${String(definition.areaStanding.kind)}" is not something an area does to a creature standing in it; the engine derives a Speed and nothing else`,
        });
      } else {
        // The same pairing the standalone effect and the rider are held to,
        // through the same function, so a Speed a casting's area moves cannot
        // be spelled a fourth way.
        checkSpeedChange(definition.areaStanding, 'areaStanding', found);
      }
    }
  }

  if (definition.areaTerrain !== undefined) {
    if (definition.area === undefined) {
      found.push({
        field: 'areaTerrain',
        code: 'terrain_without_area',
        reason:
          'ground a spell makes expensive is the ground under its area; a spell with no volume covers no ground',
      });
    }
    if (
      readsAsObject(
        definition.areaTerrain,
        'areaTerrain',
        'terrain an area creates is an object naming what a foot of that ground costs',
        found,
      )
    ) {
      const rate = definition.areaTerrain.costPerFoot;
      // **The pure function's own rule, from the same constant.** A second
      // spelling of the floor here would be a second chance to disagree with
      // `declareDifficultPatch`, which the fold calls on the event this
      // definition will write — and a definition it let through would throw
      // in the reducer rather than be refused at authoring.
      if (!Number.isInteger(rate) || rate < DIFFICULT_TERRAIN) {
        found.push({
          field: 'areaTerrain.costPerFoot',
          code: 'bad_terrain_cost',
          reason: `${String(rate)} feet per foot is not Difficult Terrain; the glossary's rate is ${DIFFICULT_TERRAIN} and a spell that prints its own prints a larger whole number`,
        });
      }
    }
  }

  if (definition.areaLight !== undefined) {
    if (definition.area === undefined) {
      found.push({
        field: 'areaLight',
        code: 'light_without_area',
        reason:
          'the light a spell sheds lies over its area; a spell with no volume lights no part of the room',
      });
    }
    if (
      readsAsObject(
        definition.areaLight,
        'areaLight',
        'light an area sheds is an object naming which of the glossary’s three levels it is',
        found,
      )
    ) {
      const { level, dimBeyond, sunlight } = definition.areaLight;
      // **The pure function's own rules, read off the same constants.** A
      // second spelling here would be a second chance to disagree with
      // `declareLightPatch`, which the fold calls on the event this definition
      // will write — and a definition it let through would throw in the
      // reducer rather than be refused at authoring.
      if (!(LIGHT_LEVELS as readonly string[]).includes(level)) {
        found.push({
          field: 'areaLight.level',
          code: 'bad_light_level',
          reason: `"${String(level)}" is not a level of light; the glossary prints ${LIGHT_LEVELS.join(', ')}`,
        });
      }
      if (sunlight === true && level !== 'bright') {
        found.push({
          field: 'areaLight.sunlight',
          code: 'bad_sunlight',
          reason:
            'sunlight is Bright Light with a flag, so an area that is not bright cannot be sunlit',
        });
      }
      if (dimBeyond !== undefined) {
        if (!Number.isInteger(dimBeyond) || dimBeyond <= 0) {
          found.push({
            field: 'areaLight.dimBeyond',
            code: 'bad_dim_beyond',
            reason: `dim light beyond the area reaches a whole number of feet greater than nought, not ${String(dimBeyond)}`,
          });
        } else if (definition.area?.kind !== 'sphere') {
          // A ring of Dim Light around a Cone has no radius to widen, and
          // laying nothing quietly would be the benefit-nothing-reads failure
          // this validator exists for.
          found.push({
            field: 'areaLight.dimBeyond',
            code: 'dim_beyond_without_a_radius',
            reason:
              'light spreading past the area is measured from the area’s edge, and only a Sphere has an edge that is one number',
          });
        }
      }
    }
  }

  if (definition.areaObscurement !== undefined) {
    if (definition.area === undefined) {
      found.push({
        field: 'areaObscurement',
        code: 'obscurement_without_area',
        reason:
          'the fog a spell makes fills its area; a spell with no volume obscures no part of the room',
      });
    }
    if (
      readsAsObject(
        definition.areaObscurement,
        'areaObscurement',
        'obscurement an area creates is an object naming which of the glossary’s two degrees it is',
        found,
      )
    ) {
      const { degree, radiusPerSlotLevelAbove: perLevel } = definition.areaObscurement;
      if (!(OBSCUREMENT_DEGREES as readonly string[]).includes(degree)) {
        found.push({
          field: 'areaObscurement.degree',
          code: 'bad_obscurement',
          reason: `"${String(degree)}" is not a degree of obscurement; the glossary prints ${OBSCUREMENT_DEGREES.join(' and ')}`,
        });
      }
      // Saying it twice is the failure, not saying it at all: a level implies
      // its own degree in `obscurementAt`, so a definition writing both has
      // two records of one fact and one of them will be the stale one.
      if (definition.areaLight !== undefined && definition.areaLight.level !== 'bright') {
        found.push({
          field: 'areaObscurement',
          code: 'obscurement_the_light_already_says',
          reason:
            'dim light is Lightly Obscured and darkness is Heavily Obscured already; an area that states its level states its degree with it',
        });
      }
      if (perLevel !== undefined) {
        if (!Number.isInteger(perLevel) || perLevel <= 0) {
          found.push({
            field: 'areaObscurement.radiusPerSlotLevelAbove',
            code: 'bad_obscurement_growth',
            reason: `a slot grows the fog by a whole number of feet greater than nought, not ${String(perLevel)}`,
          });
        } else if (definition.area?.kind !== 'sphere') {
          found.push({
            field: 'areaObscurement.radiusPerSlotLevelAbove',
            code: 'growth_without_a_radius',
            reason:
              'a slot that widens the fog widens a radius, and only a Sphere has one',
          });
        }
      }
    }
  }

  // The geometry pass's one bit of information, declared in data.
  if (definition.anchoring !== undefined) {
    const template = definition.area ?? definition.targetsWithin;
    if (template === undefined) {
      found.push({
        field: 'anchoring',
        code: 'anchoring_without_area',
        reason: 'anchoring says how a template footprint is read; a spell with no template has none',
      });
    } else if (selfOrigin(template)) {
      // The same refusal `placeArea` makes on the request, for the same reason:
      // a `self` origin is a creature's own space, and a creature does not
      // stand on a grid intersection.
      found.push({
        field: 'anchoring',
        code: 'anchoring_on_self_area',
        reason: 'an area that starts at the caster is anchored on their space and cannot be read otherwise',
      });
    }
  }

  if (definition.designatesUnaffected === true && definition.area === undefined) {
    found.push({
      field: 'designatesUnaffected',
      code: 'unaffected_without_area',
      reason: 'SRD writes "designate creatures to be unaffected" only for an area',
    });
  }

  // — the damage type the SRD decides on a fact the engine does not hold ——

  if (
    definition.damageTypeStated !== undefined &&
    readsAsList(
      definition.damageTypeStated,
      'damageTypeStated',
      'the damage types a spell prints for the caster to choose between are a list',
      found,
    )
  ) {
    if (definition.damageTypeStated.length < 2) {
      found.push({
        field: 'damageTypeStated',
        code: 'stated_damage_type_needs_choice',
        reason: 'this records a spell printing two damage types; one entry is not a choice',
      });
    }
    definition.damageTypeStated.forEach((type, i) =>
      checkDamageType(type, `damageTypeStated[${i}]`, found),
    );
  }

  // — the one thing the spell asks its caster to choose ————————————————————
  //
  // `damageTypeStated`'s rules over a wider vocabulary, and one rule of its
  // own: the choice has to **land somewhere**. A stated damage type
  // substitutes into whatever damage the spell deals and a definition that
  // deals none is already refused elsewhere; a choice can be of four different
  // things, and `statedChoice` is where each of them lands — so the
  // reachability question is asked of that function rather than restated here,
  // which is what stops the two coming to disagree about where a choice goes.

  if (
    definition.choiceStated !== undefined &&
    readsAsObject(
      definition.choiceStated,
      'choiceStated',
      'a stated choice is an object naming what is chosen and the values the spell prints',
      found,
    )
  ) {
    const choice = definition.choiceStated;
    const known = STATED_CHOICE_KINDS.has(choice.of);
    if (!known) {
      found.push({
        field: 'choiceStated.of',
        code: 'unknown_stated_choice',
        reason: `"${String(choice.of)}" is not something a casting can choose; ${[...STATED_CHOICE_KINDS].join(', ')} is`,
      });
    }
    if (
      readsAsList(
        choice.options,
        'choiceStated.options',
        'the values a spell prints for its caster to choose between are a list',
        found,
      )
    ) {
      if (choice.options.length < 2) {
        found.push({
          field: 'choiceStated.options',
          code: 'stated_choice_needs_choice',
          reason: 'this records a spell printing a choice; one entry is not a choice',
        });
      }
      if (known) {
        choice.options.forEach((option, i) =>
          checkChoiceOption(choice.of, option, `choiceStated.options[${i}]`, found),
        );
      }
    }

    // **And it has to reach an effect.** A choice the caster makes and nothing
    // reads is the failure every other reachability rule here exists to catch
    // — silent, because the casting is refused until the caster answers and
    // then the answer goes nowhere. Probed with the first printed value, which
    // is the one the definition itself is written around.
    if (
      known &&
      Array.isArray(choice.options) &&
      choice.options.length > 0 &&
      !statedChoiceReaches(definition.effects, choice.of, choice.options[0]!)
    ) {
      found.push({
        field: 'choiceStated',
        code: 'stated_choice_reaches_nothing',
        reason: `nothing in this spell's effects holds a ${choice.of} for the casting's choice to replace`,
      });
    }

    // **And it may not be printed against a pinned sibling.** An ability and a
    // skill agree or they describe a roll nobody makes, and a substitution
    // replaces one of the two — so a definition that writes both and offers
    // one of them to the caster validates here and then contradicts itself at
    // the table, which is the one way "the definition declares the slot and
    // the casting fills it" could still land a selector nothing matches.
    if (known && statedChoiceCollides(definition.effects, choice.of)) {
      found.push({
        field: 'choiceStated',
        code: 'stated_choice_collides',
        reason: `this spell pins the ${choice.of === 'ability' ? 'skill' : 'ability'} beside the ${choice.of} the casting chooses, and the two would have to agree; drop the pinned one`,
      });
    }
  }

  // — what the individual dice of this spell's damage do ————————————————————

  if (
    definition.dieRule !== undefined &&
    readsAsObject(
      definition.dieRule,
      'dieRule',
      'a die rule is an object naming what the dice do and what bounds it',
      found,
    )
  ) {
    const rule = definition.dieRule as { kind?: unknown; cap?: unknown };

    if (!DIE_RULE_KINDS.has(rule.kind as string)) {
      found.push({
        field: 'dieRule.kind',
        code: 'unknown_die_rule',
        reason: `"${String(rule.kind)}" is not a die behaviour the engine has; ${[...DIE_RULE_KINDS].join(', ')} is`,
      });
    }

    // A cap is a **derivation** the engine performs off the caster's sheet, so
    // an unknown one is a number nothing can compute rather than a number out
    // of range — which is why a literal fails here as loudly as a misspelling.
    if (!DIE_RULE_CAPS.has(rule.cap as string)) {
      found.push({
        field: 'dieRule.cap',
        code: 'unknown_die_rule_cap',
        reason: `"${String(rule.cap)}" is not a cap the engine can derive; ${[...DIE_RULE_CAPS].join(', ')} is`,
      });
    }

    // **And the rule has to reach a die.** The effect kinds that roll a
    // casting's own damage are {@link ROLLS_ITS_OWN_DAMAGE}; a definition
    // with none of them throws nothing this could be about, and a rule nobody
    // reads is the failure the whole validator exists to prevent.
    if (!definition.effects.some((effect) => ROLLS_ITS_OWN_DAMAGE.has(effect.kind))) {
      found.push({
        field: 'dieRule',
        code: 'die_rule_rolls_nothing',
        reason: `a die rule is about the dice this spell rolls for damage, and this spell rolls none: give it an effect of one of these kinds — ${[...ROLLS_ITS_OWN_DAMAGE].join(', ')} — or drop the rule`,
      });
    } else if (rollsDamageTwice(definition)) {
      found.push({
        field: 'dieRule',
        code: 'die_rule_rolls_more_than_once',
        reason:
          "the cap is a budget for the whole casting and is spent per damage roll, so a spell that rolls its damage more than once — several targets, more of them out of a bigger slot, a count it never states, several aimed rolls out of one effect, an area, an activation that rolls again on a later turn, two damaging effects, or a payload printed in a second damage type — would be allowed it once per roll",
      });
    }
  }

  // — duration —————————————————————————————————————————————————————————————

  if (definition.durationSeconds !== undefined && definition.durationUntil !== undefined) {
    found.push({
      field: 'durationUntil',
      code: 'two_durations',
      reason: 'a span of seconds and a moment in the turn order are different things; a spell has one',
    });
  }

  // **A casting's own deadline may not be anchored on a target**, because a
  // casting has as many targets as it caught and one duration. `RiderDuration`
  // is shared with the riders, where a deadline *is* about one creature —
  // SRD Vicious Mockery's "the end of **its** next turn", SRD Shocking Grasp's
  // "the start of **its** next turn" — and the members that say so mean
  // nothing in this position: there is no "it". Refused here rather than left
  // to bind to whoever, which is the same argument `anchoredOnTarget` makes at
  // the pre-flight, and it is what keeps `riderDuration`'s one throw out of a
  // content author's reach.
  //
  // **Both are spelled by name rather than asked of `anchoredOnTarget`**,
  // because this field is never put through `checkRiderDuration` and what
  // arrives here may be any string at all: the reader throws on a member it
  // has not heard of, and a validator that threw at untyped input would refuse
  // nothing and crash the loader instead. `rider-duration-readers.test.ts`
  // derives the list from the reader and holds every target-anchored member to
  // being refused here, so a third one cannot be left out quietly.
  if (
    definition.durationUntil === 'end-of-targets-next-turn' ||
    definition.durationUntil === 'start-of-targets-next-turn'
  ) {
    found.push({
      field: 'durationUntil',
      code: 'casting_duration_without_a_target',
      reason:
        'a casting runs for one duration and may have caught several creatures, so its own deadline cannot be the start or the end of "its" next turn; put the moment on the rider that is about one creature',
    });
  }

  // "Until dispelled" is the absence of a deadline. A definition that carries
  // one as well is claiming both that the spell ends at a moment and that it
  // never does, and `persists` would answer on whichever field it read first.
  if (
    definition.untilDispelled === true &&
    (definition.durationSeconds !== undefined || definition.durationUntil !== undefined)
  ) {
    found.push({
      field: 'untilDispelled',
      code: 'two_durations',
      reason: '"Until dispelled" is the absence of a deadline, so a spell cannot also print one',
    });
  }

  if (definition.durationSeconds !== undefined && definition.durationSeconds <= 0) {
    found.push({
      field: 'durationSeconds',
      code: 'bad_duration',
      reason: 'a duration of nothing is Instantaneous, which is the absence of one',
    });
  }

  // **A band lengthens a printed duration; it does not supply one.** Every SRD
  // spell that writes this clause prints a Duration of its own first — "up to
  // 1 hour", then "level 3–4 (up to 8 hours)" — and `durationSecondsAt` falls
  // back to `durationSeconds` for a slot below every band, so a table with no
  // base would make a level 1 casting Instantaneous while a level 3 one ran
  // for eight hours.
  if (definition.durationAtSlot !== undefined) {
    if (
      readsAsObject(
        definition.durationAtSlot,
        'durationAtSlot',
        'a higher-slot duration table is a record of slot level to seconds',
        found,
      )
    ) {
      if (definition.durationSeconds === undefined) {
        found.push({
          field: 'durationAtSlot',
          code: 'band_without_duration',
          reason:
            'a higher slot lengthens the duration the spell already prints; a table with no `durationSeconds` leaves every lower slot with none',
        });
      }
      // A cantrip is cast from no slot at all, so a table keyed by slot level
      // has no key any casting of it could ever reach — the same argument
      // `checkScaling` makes about `perSlotLevelAbove`.
      if (definition.level === 0) {
        found.push({
          field: 'durationAtSlot',
          code: 'slot_scaling_on_cantrip',
          reason: 'a cantrip is cast from no slot, so no band of this table can be reached',
        });
      }

      const bands = definition.durationAtSlot as Record<string, unknown>;
      let previous = definition.durationSeconds ?? 0;
      for (const key of Object.keys(bands).sort((a, b) => Number(a) - Number(b))) {
        const level = Number(key);
        const seconds = bands[key];
        if (!Number.isInteger(level) || level < 1 || level > 9) {
          found.push({
            field: `durationAtSlot.${key}`,
            code: 'bad_slot_level',
            reason: `"${key}" is not one of the nine spell slot levels`,
          });
          continue;
        }
        // A band at or below the spell's own level is the duration the spell
        // already prints, said twice — and the SRD writes every one of these
        // clauses under "Using a Higher-Level Spell Slot".
        if (level <= definition.level) {
          found.push({
            field: `durationAtSlot.${key}`,
            code: 'bad_slot_level',
            reason: `a band at level ${key} is not a *higher* slot than this level ${definition.level} spell`,
          });
          continue;
        }
        if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds <= 0) {
          found.push({
            field: `durationAtSlot.${key}`,
            code: 'bad_duration',
            reason: `"${String(seconds)}" is not a whole number of seconds`,
          });
          continue;
        }
        // **Every band is longer than the one below it**, which is the
        // transcription guard rather than a tidiness rule: the SRD's tables
        // climb without exception, and a digit dropped from 28800 reads as a
        // plausible number and shortens the spell.
        if (seconds <= previous) {
          found.push({
            field: `durationAtSlot.${key}`,
            code: 'bad_duration',
            reason: `a higher slot lengthens the spell; ${seconds} seconds is not longer than ${previous}`,
          });
        }
        previous = Math.max(previous, seconds);
      }
    }
  }

  const lasts =
    definition.durationSeconds !== undefined || definition.durationUntil !== undefined;

  if (definition.concentration && !lasts) {
    found.push({
      field: 'concentration',
      code: 'concentration_without_duration',
      reason: 'Concentration is sustained attention on something that lasts',
    });
  }

  // SRD hangs the check on the casting's own timer, so a spell with no
  // duration leaves nothing standing there to be examined.
  if (definition.check !== undefined) {
    if (!lasts) {
      found.push({
        field: 'check',
        code: 'check_without_duration',
        reason: 'a check against the casting rides on its timer; an instantaneous spell has none',
      });
    }
    checkSpellCheck(definition.check, 'check', found);
  }

  // — the Reaction clause ——————————————————————————————————————————————————

  if (definition.trigger !== undefined && definition.castingTime !== 'reaction') {
    found.push({
      field: 'trigger',
      code: 'trigger_without_reaction',
      reason: 'a trigger is the clause in a Reaction casting time; nothing else has one',
    });
  }

  if (definition.castingTime === 'reaction' && definition.trigger === undefined) {
    found.push({
      field: 'trigger',
      code: 'reaction_without_trigger',
      reason:
        'SRD writes a Reaction as "Reaction, which you take when ..."; a moment nobody named is one the engine cannot check',
    });
  }

  // — what the spell does ——————————————————————————————————————————————————

  definition.effects.forEach((effect, i) =>
    checkEffect(effect, definition.level, `effects[${i}]`, found),
  );

  checkSummonTargets(definition, found);
  checkKeptBesideADuration(definition, found);
  checkChanceTargets(definition, found);
  checkWeaponAttack(definition, found);
  checkCastingRepeatLifetime(definition, found);

  const activation = definition.activation;
  if (
    activation !== undefined &&
    readsAsObject(
      activation,
      'activation',
      'an activation is an object naming what a later action does',
      found,
    )
  ) {
    // Stated in CLAUDE.md and pinned here: a later action reaches from the
    // caster **or** from the point the casting keeps. Two fields saying five
    // feet are two places to get one sentence wrong.
    if (activation.range !== undefined && definition.origin !== undefined) {
      found.push({
        field: 'activation.range',
        code: 'activation_range_and_origin',
        reason:
          'a later action measures from the caster or from the point the casting holds, never both',
      });
    }
    if (activation.range === undefined && definition.origin === undefined && activation.movesArea === undefined) {
      found.push({
        field: 'activation.range',
        code: 'activation_reaches_nothing',
        reason: 'an activation that targets a creature needs a range, from the caster or from a point',
      });
    }
    if (activation.movesArea !== undefined) {
      if (definition.area === undefined) {
        found.push({
          field: 'activation.movesArea',
          code: 'moves_area_without_area',
          reason: 'an action that moves the spell’s area needs the spell to have one',
        });
      }
      if (activation.movesArea <= 0) {
        found.push({
          field: 'activation.movesArea',
          code: 'bad_movement_allowance',
          reason: 'an allowance of nothing is an action spent moving nothing',
        });
      }
    }
    const resolves = readsAsList(
      activation.effects,
      'activation.effects',
      'an activation resolves a list of effects, empty for the one whose whole content is moving the area',
      found,
    );
    // SRD Moonbeam's later Magic action *is* the move; every other activation
    // does something. One that does neither spends an action on nothing.
    if (resolves && activation.effects.length === 0 && activation.movesArea === undefined) {
      found.push({
        field: 'activation.effects',
        code: 'activation_does_nothing',
        reason: 'an activation with no effects must be the one whose whole content is moving the area',
      });
    }
    if (!lasts && !definition.concentration) {
      found.push({
        field: 'activation',
        code: 'activation_without_duration',
        reason: 'a later turn can only act through a casting that is still running',
      });
    }
    if (resolves) {
      activation.effects.forEach((effect, i) =>
        checkEffect(effect, definition.level, `activation.effects[${i}]`, found),
      );
    }
  }

  const conjures = definition.conjures;
  if (
    conjures !== undefined &&
    readsAsObject(
      conjures,
      'conjures',
      'what a spell puts in a hand is an object naming the item and how many',
      found,
    )
  ) {
    if (typeof conjures.item !== 'string' || conjures.item.trim().length === 0) {
      found.push({
        field: 'conjures.item',
        code: 'bad_conjured_item',
        reason: 'what appears is a catalogue id; the engine holds no thing of its own to conjure',
      });
    }
    if (!Number.isInteger(conjures.count) || conjures.count < 1) {
      found.push({
        field: 'conjures.count',
        code: 'bad_conjured_count',
        reason: 'a conjuring that produces nothing is a sentence the book does not print',
      });
    }
    if (
      conjures.hands !== undefined &&
      (!Number.isInteger(conjures.hands) || conjures.hands < 0)
    ) {
      found.push({
        field: 'conjures.hands',
        code: 'bad_conjured_hands',
        reason: 'hands are a whole number of them, and never fewer than none',
      });
    }
    /**
     * **A conjuring happens when the spell takes effect, and this engine has
     * one moment for that.** A casting of a minute or more is declared and
     * settled later, and the settlement takes no fresh look at the definition
     * — so a handful conjured there would appear at the declaration or not at
     * all. No SRD spell of this shape takes longer than a Bonus Action, so the
     * refusal costs the book nothing and says plainly what would have to be
     * built first.
     */
    if (definition.castingTime === 'long' || definition.castingSeconds !== undefined) {
      found.push({
        field: 'conjures',
        code: 'conjured_by_a_long_casting',
        reason:
          'a spell of a minute or more is declared now and settled later, and what it conjures would have nowhere to appear',
      });
    }
    /**
     * **And it needs a duration, because the thing's lifetime is the
     * casting's.** An Instantaneous casting is over the moment it resolves, so
     * everything it conjured would vanish in the same breath — the reading
     * `checkGrantLifetimes` already applies to every grant a casting hangs.
     */
    if (!lasts && !definition.concentration) {
      found.push({
        field: 'conjures',
        code: 'conjured_without_duration',
        reason:
          'what a casting conjures lasts as long as the casting, so an Instantaneous spell would conjure something that is already gone',
      });
    }
    if (
      conjures.retake !== undefined &&
      conjures.retake !== 'action' &&
      conjures.retake !== 'bonus-action'
    ) {
      found.push({
        field: 'conjures.retake',
        code: 'bad_retake_action',
        reason: 'taking a conjured thing up again costs an Action or a Bonus Action',
      });
    }
  }

  if (
    definition.origin !== undefined &&
    readsAsObject(
      definition.origin,
      'origin',
      'a point the casting holds is an object naming the reach measured from it',
      found,
    )
  ) {
    if (definition.origin.reach < 0) {
      found.push({
        field: 'origin.reach',
        code: 'bad_reach',
        reason: 'a reach is not negative',
      });
    }
    if (definition.area !== undefined) {
      found.push({
        field: 'origin',
        code: 'origin_and_area',
        reason: 'a point the casting measures from is not a template it fills',
      });
    }
  }

  checkEndsEarly(definition, lasts, found);

  // — a grant with nothing to hang on ——————————————————————————————————————
  //
  // Last of the structural rules, so an effect's own problems are reported at
  // its own path first and this cross-check reads as the cross-check it is.
  checkGrantLifetimes(definition, lasts, found);

  /**
   * The tracked rule, and the reason it belongs here rather than in a test.
   *
   * A definition with no effects is **tracked**: the engine spends the action,
   * the slot, the Concentration and the clock, and `unmodelled` says what the
   * table adjudicates. That is honest. A definition with no effects and
   * nothing to declare resolves to a casting and silence, which is worse than
   * the refusal it replaced — and it is the single easiest mistake to make in
   * this format, because it compiles.
   */
  /*
   * Read once, so the two rules below cannot disagree about what is declared.
   *
   * **`undefined` is absent; everything else is read against the declared
   * type**, `null` included. That is one rule for every optional field in this
   * file, and it had two answers for a while: `??` read a null here as absent
   * while the rider slots reported one. `null` is not a member of
   * `readonly string[] | undefined`, and a value the compiler would refuse is
   * exactly what a validator over untyped input exists to name. No definition
   * in the catalogue carries a null anywhere, so nothing that existed depends
   * on the reading that changed.
   */
  const notes =
    definition.unmodelled === undefined
      ? []
      : readsAsList(
            definition.unmodelled,
            'unmodelled',
            'the clauses a definition declares it does not model are a list of notes',
            found,
          )
        ? definition.unmodelled
        : [];

  /**
   * The handover, read by the same rule and for the same reason.
   *
   * A second list rather than a second spelling of the first: an `unmodelled`
   * line is a debt somebody may one day pay, and this is the book asking a
   * question nobody here will ever answer. Both are what a definition declares
   * it is leaving to the table, which is why either satisfies the rule below.
   */
  const handovers =
    definition.dmDecides === undefined
      ? []
      : readsAsList(
            definition.dmDecides,
            'dmDecides',
            'the printed text a definition hands to the DM is a list of sentences',
            found,
          )
        ? definition.dmDecides
        : [];

  if (
    definition.effects.length === 0 &&
    definition.activation === undefined &&
    definition.areaTrigger === undefined &&
    definition.conjures === undefined &&
    notes.length === 0 &&
    handovers.length === 0
  ) {
    found.push({
      field: 'unmodelled',
      code: 'silent_gap',
      reason: 'a spell the engine resolves nothing of must say what the DM adjudicates',
    });
  }

  /**
   * The mark is `handedOver`'s to write, and nobody else's.
   *
   * `unverified` is one list carrying two claims, and the whole of what tells
   * them apart is {@link DM_DECIDES}. A note that contains the mark would read
   * as a handover to every reader of that list — and a handed-over sentence
   * that contains it would carry it twice, so `dmDecisionsIn` would give the
   * table back a line with the mark still in it. Both are refused here, where
   * a definition arrives, rather than left to whoever writes the next one.
   */
  const forges = (text: unknown): boolean =>
    typeof text === 'string' && text.includes(DM_DECIDES);

  notes.forEach((note, i) => {
    if (typeof note !== 'string' || note.trim().length === 0) {
      found.push({
        field: `unmodelled[${i}]`,
        code: 'empty_note',
        reason: 'an empty note declares nothing',
      });
    }
    if (forges(note)) {
      found.push({
        field: `unmodelled[${i}]`,
        code: 'forged_dm_mark',
        reason: `"${DM_DECIDES}" is the mark a handed-over sentence carries; a gap the engine has not built is not one, and writing the mark here would file a debt as a decision nobody may take`,
      });
    }
  });

  handovers.forEach((printed, i) => {
    if (typeof printed !== 'string' || printed.trim().length === 0) {
      found.push({
        field: `dmDecides[${i}]`,
        code: 'empty_note',
        reason: 'an empty sentence hands nothing over',
      });
    }
    if (forges(printed)) {
      found.push({
        field: `dmDecides[${i}]`,
        code: 'forged_dm_mark',
        reason: `the mark is written once, by the casting; a sentence that carries "${DM_DECIDES}" of its own reaches the table with it still in the text`,
      });
    }
  });

  return found;
}

/**
 * A definition, or the first thing wrong with it.
 *
 * Takes `unknown` deliberately: the point of a validator is that a definition
 * does not have to have come through the compiler. The shape is checked first
 * and the semantics second, so a caller handing over a JSON blob gets the same
 * answers as a caller handing over a compiled constant.
 *
 * **This says nothing about whether the spell is in the SRD.** A DM's invented
 * spell passes here and fails the oracle, and that is the correct pair of
 * answers rather than a contradiction.
 */
export function parseSpellDefinition(value: unknown): Result<SpellDefinition> {
  const shape = checkShape(value);
  if (shape.length > 0) {
    const first = shape[0]!;
    return err(first.code, `${first.field}: ${first.reason}`);
  }

  const problems = checkSpellDefinition(value as SpellDefinition);
  if (problems.length > 0) {
    const first = problems[0]!;
    return err(first.code, `${first.field}: ${first.reason}`);
  }

  return ok(value as SpellDefinition);
}

/** Every problem, shape and semantics alike, over untyped input. */
export function checkSpellDefinitionValue(
  value: unknown,
): readonly SpellDefinitionProblem[] {
  const shape = checkShape(value);
  if (shape.length > 0) return shape;
  return checkSpellDefinition(value as SpellDefinition);
}

/**
 * Enough of the shape that the semantic rules can read it without throwing.
 *
 * Not a second copy of the type: the compiler owns the shape for anything
 * written in this repository, and this exists for the input that was not. So
 * it checks the fields the rules above dereference, and stops — an unknown
 * extra field is not an error, because a definition written against a later
 * engine is data this one does not understand rather than data that is wrong.
 */
function checkShape(value: unknown): readonly SpellDefinitionProblem[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ field: '', code: 'not_a_definition', reason: 'a spell definition is an object' }];
  }

  const found: SpellDefinitionProblem[] = [];
  const d = value as Record<string, unknown>;

  const requireType = (field: string, type: 'string' | 'number' | 'boolean'): boolean => {
    if (typeof d[field] !== type) {
      found.push({
        field,
        code: 'missing_field',
        reason: `every definition carries a ${type} ${field}`,
      });
      return false;
    }
    return true;
  };

  requireType('id', 'string');
  requireType('name', 'string');
  requireType('level', 'number');
  requireType('school', 'string');
  requireType('castingTime', 'string');
  requireType('concentration', 'boolean');

  const range = d['range'];
  if (typeof range !== 'object' || range === null || typeof (range as { kind?: unknown }).kind !== 'string') {
    found.push({ field: 'range', code: 'missing_field', reason: 'every definition carries a range' });
  }

  const targets = d['targets'];
  if (
    typeof targets !== 'object' ||
    targets === null ||
    typeof (targets as { count?: unknown }).count !== 'number'
  ) {
    found.push({
      field: 'targets',
      code: 'missing_field',
      reason: 'every definition carries a target rule with a count',
    });
  }

  const effects = d['effects'];
  if (!Array.isArray(effects)) {
    found.push({
      field: 'effects',
      code: 'missing_field',
      reason: 'every definition carries an effect list, empty for a tracked spell',
    });
  }

  for (const [where, list] of effectLists(d)) {
    list.forEach((effect, i) => {
      const at = `${where}[${i}]`;
      const entry = checkEffectKind(effect, at, found);
      if (entry === null) return;
      // The two clause rules a *definition's* list has and a list hosted
      // anywhere else does not: both ask which of the lists the effect is in.
      checkFoughtClause(effect as object, entry.kind, where, at, found);
      checkRecordedVerdict(effect as object, entry.kind, where, at, found);
      checkAreaBoundLifetime(effect as object, entry.kind, where, at, found);
      checkTeleportPlacement(entry.kind, where, at, found);
      checkSummonPlacement(entry.kind, where, at, found);
      checkChancePlacement(entry.kind, where, at, found);
      checkNoNestedEffect(effect, at, found);
    });
  }

  return found;
}

/**
 * The first entry rule for one thing in an effect list: it is an object, and
 * it names a `kind` this engine resolves.
 *
 * **One copy, because a `SpellDefinition` is no longer the only host of an
 * effect list.** {@link effectLists} enumerates a definition's three; an
 * item's `confers` grant is the fourth, validated by `checkContent` in
 * another file over another problem type. A private copy of this guard there
 * is exactly the drift {@link effectLists} was written to end, because the
 * guarantee every branch of {@link checkEffect} relies on — that the entry is
 * an object naming a known kind — has to hold for all four lists or for none.
 *
 * Null when the entry is not an object at all, and otherwise the `kind` as
 * written beside whether the engine knows it: a caller's own rules may have
 * something to say about a malformed entry that this one has already reported.
 */
function checkEffectKind(
  effect: unknown,
  path: string,
  found: SpellDefinitionProblem[],
): { readonly kind: unknown; readonly known: boolean } | null {
  if (typeof effect !== 'object' || effect === null) {
    found.push({
      field: path,
      code: 'not_an_effect',
      reason: 'an effect is an object naming its kind',
    });
    return null;
  }
  const kind = (effect as { kind?: unknown }).kind;
  const known = typeof kind === 'string' && EFFECT_KINDS.has(kind);
  if (!known) {
    found.push({
      field: `${path}.kind`,
      code: 'unknown_effect',
      reason: `"${String(kind)}" is not an effect the engine resolves`,
    });
  }
  return { kind, known };
}

/**
 * One effect, checked whole, for a list that is not a spell definition's.
 *
 * The entry rules and then the per-kind rules, which is the order
 * `checkSpellDefinition` runs its two passes in and the order every branch of
 * {@link checkEffect} assumes. Exported for `content.ts`, so an item that
 * confers an effect list is judged by the rules a spell's list is judged by
 * rather than by a second vocabulary kept in step by hand.
 *
 * The two clause rules {@link checkFoughtClause} and
 * {@link checkTeleportPlacement} are not here, because both ask *which list*
 * the effect sits in and the answer for a host outside a definition is the
 * host's own to give.
 */
export function checkEffectValue(
  effect: unknown,
  level: number,
  path: string,
): readonly SpellDefinitionProblem[] {
  const found: SpellDefinitionProblem[] = [];
  const entry = checkEffectKind(effect, path, found);
  if (entry === null) return found;
  checkNoNestedEffect(effect, path, found);
  if (!entry.known) return found;
  checkEffect(effect as SpellEffect, level, path, found);
  return found;
}

/**
 * Where SRD's "if you or your allies are fighting it" may be written.
 *
 * Two rules over one clause, and both are entry-level and list-aware, which is
 * why they are `checkShape`'s rather than `checkEffect`'s — the division
 * {@link effectLists} records.
 *
 * **On a host that rolls a saving throw.** The clause gives *that save*
 * Advantage; an `attack` or a `heal` has no save for it to reach, and a field
 * quietly ignored is an author who thinks they said something. `save` is the
 * only kind that carries it, because the five spells that print it — Charm
 * Person, Charm Monster and the three Dominates — all write a bare Wisdom save.
 *
 * **In the casting's own effect list, and nowhere nested.** The fact is stated
 * once, at the casting: `declaredFacts` requires it before a slot is spent and
 * `PendingCasting` pins it for a settlement. An area trigger fires a minute
 * later off an `OngoingSpell` that carries no such fact, and an activation the
 * same — so a clause written there would be read by nothing and the Advantage
 * would silently not happen, which is the class of failure this repository
 * calls its worst. Refused here rather than left to be discovered.
 *
 * The value is `true` and nothing else, because absence is how a spell says it
 * does not print the clause and `false` would be a second way to say it.
 */
function checkFoughtClause(
  effect: object,
  kind: unknown,
  where: string,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  const stated = (effect as { advantageIfFought?: unknown }).advantageIfFought;
  if (stated === undefined) return;

  if (where !== 'effects') {
    found.push({
      field: `${path}.advantageIfFought`,
      code: 'fought_outside_the_casting',
      reason:
        'the caster states whether they are fighting the target at the casting, so only the casting’s own saving throw can read it',
    });
    return;
  }
  if (kind !== 'save') {
    found.push({
      field: `${path}.advantageIfFought`,
      code: 'fought_without_save',
      reason: 'SRD gives the Advantage to a saving throw, and this effect rolls none',
    });
    return;
  }
  if (stated !== true) {
    found.push({
      field: `${path}.advantageIfFought`,
      code: 'malformed_field',
      reason: 'a spell either prints the clause or does not; the only value is true',
    });
  }
}

/**
 * Where a save's verdict may be said to be kept.
 *
 * **On a host that rolls a saving throw**, which is {@link checkFoughtClause}'s
 * first reason word for word: a `heal` or an `attack` has no save whose answer
 * there would be anything to keep, and a field quietly ignored is an author who
 * thinks they said something.
 *
 * **And in a list that fires off a record that already exists**, which is the
 * fought clause's rule with the sides swapped. That one is refused *outside*
 * the casting's own list because the fact it reads is stated at the casting;
 * this is refused *inside* it, because the verdict is written onto the ongoing
 * record and at that moment there is not one. The order is load-bearing and is
 * not a preference: `runEffects` resolves the whole list before
 * `spell-resolution.ts` pushes `spell-ongoing`, so a `recordsOutcome` in
 * `effects` would emit `casting-save-recorded` for a casting the fold has
 * never heard of — and `fold/ongoing.ts` throws `CorruptLogError` on it, which
 * is a homebrew definition that validates clean and then takes the campaign
 * down. A refusal at authoring is the only honest place for that.
 *
 * `areaTrigger.effects` and `activation.effects` both fire later, off a record
 * the cast has already written. SRD Zone of Truth is the first of them, and
 * both moments its sentence names are area triggers.
 *
 * The value is `true` and nothing else, for {@link checkFoughtClause}'s
 * reason: absence is how a definition says it keeps nothing, and `false` would
 * be a second way to say it.
 */
function checkRecordedVerdict(
  effect: object,
  kind: unknown,
  where: string,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  const stated = (effect as { recordsOutcome?: unknown }).recordsOutcome;
  if (stated === undefined) return;

  if (kind !== 'save') {
    found.push({
      field: `${path}.recordsOutcome`,
      code: 'verdict_without_save',
      reason:
        'a recorded verdict is the answer to a saving throw, and this effect rolls none; a save-damage effect reports its own damage instead',
    });
    return;
  }
  if (where === 'effects') {
    found.push({
      field: `${path}.recordsOutcome`,
      code: 'verdict_before_the_record',
      reason:
        'the verdict is written onto the running casting, and the casting\'s own effect list resolves before the record exists; write it in areaTrigger.effects or activation.effects, which fire off a record the cast has already written',
    });
    return;
  }
  if (stated !== true) {
    found.push({
      field: `${path}.recordsOutcome`,
      code: 'malformed_field',
      reason: 'a spell either keeps the answer or does not; the only value is true',
    });
  }
}

/**
 * Where a teleport may be written, which is the casting's own list and nowhere
 * else.
 *
 * The same rule {@link checkFoughtClause} applies to the fought fact, for the
 * same reason: **where the creature goes is stated at the casting**, through
 * `CastSpellRequest.teleportTo`, and pinned on a declaration so a settlement
 * can read it back. An area trigger fires a minute later off an `OngoingSpell`
 * that carries no destination and an activation the same, so a teleport
 * written in either list would reach `resolveEffects` with nowhere to go.
 * Refused at authoring rather than left to be met at the table.
 */
function checkTeleportPlacement(
  kind: unknown,
  where: string,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (kind !== 'teleport' || where === 'effects') return;
  found.push({
    field: `${path}.kind`,
    code: 'teleport_outside_the_casting',
    reason:
      'the caster states where the teleport goes at the casting, so only the casting’s own effect list can read it',
  });
}

/**
 * What a definition may say about a wall, and what it may not hang on one.
 *
 * SRD Wind Wall: "You can make the wall **up to 50 feet long, 15 feet high**,
 * and 1 foot thick."
 *
 * Both numbers are measured on the 5-foot lattice everything else is, and both
 * are bounds rather than sizes: the caster draws the path and `placeWall` holds
 * it to the length. The thickness is not a field, because the smallest thing
 * this engine holds is a space.
 *
 * **And a wall answers at the cast and nothing later**, which is the rule this
 * function exists for. The path is the one thing about a template that cannot
 * be reconstructed from the book and a point, the ongoing record does not store
 * it, and `areaShapeOf` therefore answers null for a wall — so a trigger, a
 * standing effect, terrain, light or obscurement written here would be a clause
 * that silently did nothing. Refused at authoring, which is where a
 * definition's defects belong, and the refusal is where the conversation starts
 * on the day Wall of Fire wants its second sentence.
 */
function checkWall(
  area: { readonly kind: string; readonly origin?: unknown },
  key: string,
  definition: SpellDefinition,
  found: SpellDefinitionProblem[],
): void {
  for (const field of ['length', 'height'] as const) {
    const feet = (area as unknown as Record<string, unknown>)[field];
    if (typeof feet !== 'number' || !Number.isInteger(feet) || feet <= 0 || feet % 5 !== 0) {
      found.push({
        field: `${key}.${field}`,
        code: 'bad_wall_dimension',
        reason: `a wall is measured in whole 5-foot spaces, and ${field} is ${String(feet)}`,
      });
    }
  }

  if (area.origin !== 'point') {
    found.push({
      field: `${key}.origin`,
      code: 'wall_starts_at_a_point',
      reason:
        'a wall rises from a point the caster chooses and is drawn from there; no SRD wall originates at its caster',
    });
  }

  if (key !== 'area') return;
  for (const clause of [
    'areaTrigger',
    'areaStanding',
    'areaTerrain',
    'areaLight',
    'areaObscurement',
  ] as const) {
    if (definition[clause] === undefined) continue;
    found.push({
      field: clause,
      code: 'wall_answers_once',
      reason: `a wall's path is drawn at the casting and is not pinned on the record, so nothing can ask about it again; \`${clause}\` would be read against no shape at all`,
    });
  }
}

/**
 * The two clauses an area trigger measures from the casting's **point**.
 *
 * SRD Flaming Sphere prints both of them: "Any creature that ends its turn
 * **within 5 feet of the sphere**", and "If you move the sphere **into a
 * creature's space**, that creature makes the save."
 *
 * Both are about a point, so both are refused on an area a creature carries:
 * a carried origin is a creature with a volume, "within 5 feet of the
 * Emanation" is a sentence the SRD does not print, and a point that is a
 * creature cannot be moved into somebody's space by an activation.
 *
 * And the ram is refused beside {@link AreaTrigger.onAreaEntry}, which is the
 * clause it narrows: one spell writes one of those sentences, and a definition
 * writing both would ask two questions of one move and catch the same creature
 * twice on the answer neither sentence gave.
 */
function checkPointMeasuredTrigger(
  trigger: AreaTrigger,
  area: SpellArea | undefined,
  found: SpellDefinitionProblem[],
): void {
  const onPoint = (trigger as { readonly onPointEntry?: unknown }).onPointEntry;
  if (onPoint !== undefined) {
    if (onPoint !== true) {
      found.push({
        field: 'areaTrigger.onPointEntry',
        code: 'malformed_field',
        reason: 'a spell either catches the creature its point is moved into or does not; the only value is true',
      });
    } else if (trigger.onAreaEntry === true) {
      found.push({
        field: 'areaTrigger.onPointEntry',
        code: 'two_arrival_clauses',
        reason:
          'the area arriving and the point arriving are two SRD sentences and no spell prints both; a definition carrying both catches the same creature twice for one move',
      });
    } else if (area !== undefined && area.origin !== 'point') {
      found.push({
        field: 'areaTrigger.onPointEntry',
        code: 'point_clause_without_a_point',
        reason:
          'a point moved into a creature’s space is a point the casting holds; a carried area’s origin is its caster and no activation moves one',
      });
    }
  }

  const within = trigger.within;
  if (within === undefined) return;

  if (typeof within !== 'number' || !Number.isInteger(within) || within <= 0 || within % 5 !== 0) {
    found.push({
      field: 'areaTrigger.within',
      code: 'bad_trigger_reach',
      reason: `${String(within)} is not a reach measured on the 5-foot lattice everything else is measured on`,
    });
    return;
  }

  if (area !== undefined && area.origin !== 'point') {
    found.push({
      field: 'areaTrigger.within',
      code: 'point_clause_without_a_point',
      reason:
        'a reach measured from the casting’s point needs one; a carried area’s origin is a creature with a volume, and "within 5 feet of the Emanation" is not a sentence the SRD prints',
    });
  }
}

/**
 * Where a condition may be tied to the area that imposed it.
 *
 * SRD Web: "have the Restrained condition **while in the webs**." The mark is
 * `ConditionRider.endsWhenOutsideArea`, and it is answerable only from a
 * clause whose area travels with the casting — which is `areaTrigger.effects`
 * and nothing else. `AreaTrigger` is pinned whole onto the ongoing record at
 * the cast, so the fold reads the mark and the geometry out of one pinned
 * value; the casting's **own** list is not pinned anywhere, so a rider written
 * there would be asking for an ending nothing could ever perform, and an
 * activation's list is the same absence by the same route.
 *
 * {@link checkRecordedVerdict}'s shape and its reason: the rule is about which
 * list the effect is in, so it is asked where the list is known.
 *
 * **Both layouts, because a rider has two.** `save` writes its first rider
 * flat and every host writes the rest in `conditions`, which is the split
 * {@link conditionRiderOf} exists to hide from the rules — and cannot hide
 * from a pass that reads untyped input before there is anything to read it
 * with.
 */
function checkAreaBoundLifetime(
  effect: object,
  kind: unknown,
  where: string,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  const nested = (effect as { readonly conditions?: unknown }).conditions;
  const riders: (readonly [string, unknown])[] = [
    // The flat layout, and only on the kind that has one.
    ...(kind === 'save' ? ([[path, effect]] as (readonly [string, unknown])[]) : []),
    [`${path}.condition`, (effect as { readonly condition?: unknown }).condition],
    ...(Array.isArray(nested)
      ? nested.map((rider, i) => [`${path}.conditions[${i}]`, rider] as const)
      : []),
  ];

  for (const [at, rider] of riders) {
    if (typeof rider !== 'object' || rider === null) continue;
    const stated = (rider as { readonly endsWhenOutsideArea?: unknown }).endsWhenOutsideArea;
    if (stated === undefined) continue;

    if (stated !== true) {
      found.push({
        field: `${at}.endsWhenOutsideArea`,
        code: 'malformed_field',
        reason:
          'a condition either ends when its holder leaves the area or does not; the only value is true',
      });
      continue;
    }

    if (where !== 'areaTrigger.effects') {
      found.push({
        field: `${at}.endsWhenOutsideArea`,
        code: 'area_lifetime_without_an_area',
        reason:
          'the area a condition ends outside is the trigger’s, pinned on the casting at the cast; only areaTrigger.effects has one, so a rider elsewhere names a boundary nothing holds',
      });
      continue;
    }

    if ((rider as { readonly outlivesCasting?: unknown }).outlivesCasting === true) {
      found.push({
        field: `${at}.endsWhenOutsideArea`,
        code: 'area_lifetime_without_a_casting',
        reason:
          'outlivesCasting records the condition under the spell’s bare name with no casting in it, and the area it would end outside belongs to the casting; a condition cannot both be disowned by the casting and be bounded by its area',
      });
    }
  }
}

/**
 * A summons is on its caster, and on nobody else.
 *
 * **The rule the effect loop makes necessary.** `runEffects` is `for (target)
 * for (effect)`, and `summonedId` is derived from the casting rather than from
 * the target — because a creature this casting raised is a fact about the
 * casting. Written against two targets, the summons would therefore be
 * resolved twice under one id, and the second run would refuse
 * `already_present` and take the whole casting with it — a refusal naming a
 * creature the author never wrote, met at the table rather than at authoring.
 *
 * Keying the id by target was the other way out and is the wrong one: it would
 * make "who did you aim it at" decide how many steeds appear, and SRD prints
 * no spell of this shape. The book's summoning spells are all "**you** summon"
 * — the spell is on its caster and the creature is the consequence, which is
 * the target shape `teleport` already takes and the one Dimension Door writes.
 *
 * So one target, and it is the caster: the two halves of `{ count: 1, self:
 * true }`, refused separately so an author is told which one is wrong. A
 * definition that names a wider count is refused rather than resolved, and
 * the day a spell summons two creatures this refusal is where the design
 * conversation starts.
 */
function checkSummonTargets(
  definition: SpellDefinition,
  found: SpellDefinitionProblem[],
): void {
  if (!definition.effects.some((effect) => effect.kind === 'summon')) return;

  if (definition.targets.count !== 1) {
    found.push({
      field: 'targets.count',
      code: 'summon_over_several_targets',
      reason:
        'a summons is on its caster and the creature it raises is named for the casting, so a second target would resolve one creature twice',
    });
  }
  if (definition.targets.self !== true) {
    found.push({
      field: 'targets.self',
      code: 'summon_not_on_its_caster',
      reason:
        'SRD writes "you summon": the spell is on the creature casting it and the creature raised is the consequence',
    });
  }
}

/**
 * SRD Find Familiar's form clause, or a block named outright — see
 * `SummonedForm`. The list and the clause are checked for shape; whether the
 * world holds a block is the world's question, asked at the cast.
 */
function checkSummonedForm(monster: unknown, path: string, found: SpellDefinitionProblem[]): void {
  if (typeof monster === 'string') {
    if (monster.trim().length === 0) {
      found.push({
        field: path,
        code: 'unknown_monster',
        reason: 'a summons names the stat block it raises, by its id in content',
      });
    }
    return;
  }
  if (typeof monster !== 'object' || monster === null) {
    found.push({
      field: path,
      code: 'unknown_monster',
      reason:
        'a summons names the stat block it raises by its id in content, or the printed forms its caster chooses from',
    });
    return;
  }
  const form = monster as { readonly among?: unknown; readonly orAny?: unknown };
  if (
    !Array.isArray(form.among) ||
    form.among.length === 0 ||
    form.among.some((one) => typeof one !== 'string' || one.trim().length === 0)
  ) {
    found.push({
      field: `${path}.among`,
      code: 'empty_form_list',
      reason:
        'a form the caster chooses is chosen from a printed list of stat blocks, by their ids in content; SRD Find Familiar prints eleven',
    });
  }
  if (form.orAny !== undefined) {
    const clause =
      typeof form.orAny === 'object' && form.orAny !== null
        ? (form.orAny as { readonly type?: unknown; readonly cr?: unknown })
        : {};
    if (typeof clause.type !== 'string' || !CREATURE_TYPES.includes(clause.type)) {
      found.push({
        field: `${path}.orAny.type`,
        code: 'unknown_creature_type',
        reason: `"${String(clause.type)}" is not one of the SRD's fourteen creature types`,
      });
    }
    if (typeof clause.cr !== 'number' || !Number.isFinite(clause.cr) || clause.cr < 0) {
      found.push({
        field: `${path}.orAny.cr`,
        code: 'bad_challenge_rating',
        reason:
          'a Challenge Rating is a number of at least 0; SRD Find Familiar prints "a Challenge Rating of 0"',
      });
    }
  }
}

/** The terms a kept creature stands on — see `KeptSummons`. */
function checkKeptSummons(kept: unknown, path: string, found: SpellDefinitionProblem[]): void {
  if (kept === undefined) return;
  if (typeof kept !== 'object' || kept === null) {
    found.push({
      field: path,
      code: 'malformed_field',
      reason:
        'a kept summons is an object: {} for a creature that goes at 0 Hit Points, { untilSummonerDies: true } where the spell prints "or if you die"',
    });
    return;
  }
  const until = (kept as { readonly untilSummonerDies?: unknown }).untilSummonerDies;
  if (until !== undefined && until !== true) {
    found.push({
      field: `${path}.untilSummonerDies`,
      code: 'malformed_field',
      reason: 'a spell either prints "or if you die" or does not; the only value is true',
    });
  }
}

const PRINTED_SPEED_MODES: ReadonlySet<string> = new Set(['walk', 'fly', 'climb', 'swim', 'burrow']);

/** The Speeds a spell prints over its block — see `PrintedSummonSpeeds`. */
function checkPrintedSummonSpeeds(
  speeds: unknown,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (speeds === undefined) return;
  if (typeof speeds !== 'object' || speeds === null) {
    found.push({
      field: path,
      code: 'bad_summon_speed',
      reason: 'the Speeds a spell prints over its block are an object keyed by mode',
    });
    return;
  }
  for (const [mode, printed] of Object.entries(speeds as Record<string, unknown>)) {
    if (!PRINTED_SPEED_MODES.has(mode)) {
      found.push({
        field: `${path}.${mode}`,
        code: 'bad_summon_speed',
        reason: `"${mode}" is not a Speed the book prints; walk, fly, climb, swim and burrow are`,
      });
      continue;
    }
    const speed =
      typeof printed === 'object' && printed !== null
        ? (printed as { readonly feet?: unknown; readonly fromSpellLevel?: unknown })
        : {};
    if (!Number.isInteger(speed.feet) || (speed.feet as number) < 1) {
      found.push({
        field: `${path}.${mode}.feet`,
        code: 'bad_summon_speed',
        reason: 'a printed Speed is a whole number of feet of at least 1',
      });
      continue;
    }
    if (
      speed.fromSpellLevel !== undefined &&
      (!Number.isInteger(speed.fromSpellLevel) ||
        (speed.fromSpellLevel as number) < 1 ||
        (speed.fromSpellLevel as number) > 9)
    ) {
      found.push({
        field: `${path}.${mode}.fromSpellLevel`,
        code: 'bad_summon_speed',
        reason:
          'the slot level a Speed appears from is a whole number from 1 to 9; SRD Find Steed prints "requires level 4+ spell"',
      });
    }
  }
}

/**
 * A printed chance is a fact about the **casting**, so it is asked once.
 *
 * {@link checkSummonTargets}'s rule for the same reason and by the same
 * machinery. `runEffects` is `for (target) for (effect)`, and this resolver
 * ignores the target it is handed entirely: what it throws a die about is
 * whether *this casting* worked. Written against two creatures it would throw
 * two d100s, count the casting twice, and — because the count is read off the
 * world the previous iteration left — throw the second die against a chance
 * the first one had just raised. A spell that got worse at itself the more
 * creatures it named, met at the table rather than at authoring.
 *
 * So one target, and it is the caster: the two halves of `{ count: 1, self:
 * true }`, refused separately so an author is told which one is wrong. SRD
 * writes every one of these sentences about the caster — "If **you** cast the
 * spell more than once" — and the day one is printed about somebody else, this
 * refusal is where the design conversation starts.
 *
 * **And an area is refused outright rather than counted**, which the target
 * rule cannot say: an area fills the target list from whoever is standing in
 * it, so `{ count: 1, self: true }` beside one is a rule nothing reads. The
 * same door {@link checkSummonPlacement} shuts on the other axis.
 */
function checkChanceTargets(
  definition: SpellDefinition,
  found: SpellDefinitionProblem[],
): void {
  if (!definition.effects.some((effect) => effect.kind === 'chance')) return;

  if (definition.targets.count !== 1 || definition.targets.extraPerSlotLevelAbove !== undefined) {
    found.push({
      field: 'targets.count',
      code: 'chance_over_several_targets',
      reason:
        'a printed chance is thrown once for the casting, so a second target would throw a second die and count the casting twice',
    });
  }
  if (definition.targets.self !== true || definition.targets.unlimited === true) {
    found.push({
      field: 'targets.self',
      code: 'chance_not_on_its_caster',
      reason:
        'SRD writes "if you cast the spell": the chance is the caster’s and the casting is on them',
    });
  }
  if (definition.area !== undefined || definition.targetsWithin !== undefined) {
    found.push({
      field: 'area',
      code: 'chance_over_an_area',
      reason:
        'an area fills the target list from whoever is standing in it, so a chance written beside one is thrown once per creature caught',
    });
  }
}

/**
 * The shape a casting that makes its own weapon attack has to have.
 *
 * Three rules, and every one of them is a fact about the **definition** rather
 * than about the effect, which is why they are here and not in `checkEffect`.
 *
 * - **A cantrip.** The dice this kind adds are a Cantrip Upgrade read off the
 *   caster's level, and there is no slot in the request an attack command
 *   sends: a levelled spell written this way would be cast for nothing.
 * - **Range: Self.** The spell puts nothing anywhere; the *weapon* reaches
 *   whatever the weapon reaches, and the attack command has always measured
 *   that. A range in feet beside it would be a second reach nobody checks,
 *   because `resolveSpell` never sees this casting.
 * - **Nothing else on the effect list.** `resolveSpell` refuses a definition
 *   carrying this kind outright, so any other effect beside it is an effect
 *   that could never run — a sentence the catalogue promises and no command
 *   keeps. The attack command resolves the swing and nothing else.
 *
 * Refused separately, so an author is told which of the three is wrong.
 */
function checkWeaponAttack(
  definition: SpellDefinition,
  found: SpellDefinitionProblem[],
): void {
  if (!definition.effects.some((effect) => effect.kind === 'weapon-attack')) return;

  if (definition.level !== 0) {
    found.push({
      field: 'level',
      code: 'swing_not_a_cantrip',
      reason:
        'a casting that makes its own weapon attack scales off the caster’s level and spends no slot, so it is a cantrip',
    });
  }
  if (definition.range.kind !== 'self') {
    found.push({
      field: 'range',
      code: 'swing_not_on_its_caster',
      reason:
        'the spell reaches nobody: the weapon does, and the attack command measures that — so its Range is Self',
    });
  }
  if (definition.effects.length > 1) {
    found.push({
      field: 'effects',
      code: 'swing_beside_another_effect',
      reason:
        'the swing is resolved by the attack command and `resolveSpell` refuses the definition, so anything written beside it is an effect nothing would ever run',
    });
  }
}

/**
 * A casting-hosted repeat save needs a casting that lasts.
 *
 * The hook rides on the casting's own deadline — that is what "hosted by the
 * casting" means — so an Instantaneous smite carrying one would hang it on
 * nothing: no timer, no boundary, and a paragraph of the spell that silently
 * never happens. SRD Searing Smite prints "Duration: 1 minute", which is
 * exactly the field this asks for.
 *
 * **A span, and not a moment in the turn order.** `durationUntil` is a rider's
 * kind of deadline and the casting a hit makes takes its own from
 * `durationSecondsAt`, so a definition writing the other one would be writing
 * a duration the command that casts it cannot read.
 */
function checkCastingRepeatLifetime(
  definition: SpellDefinition,
  found: SpellDefinitionProblem[],
): void {
  const hosted = definition.effects.some(
    (effect) => effect.kind === 'attack-damage' && effect.repeats !== undefined,
  );
  if (!hosted) return;
  if (definition.durationSeconds !== undefined || definition.durationAtSlot !== undefined) return;

  found.push({
    field: 'durationSeconds',
    code: 'casting_repeat_without_a_duration',
    reason:
      'a repeat save hosted by the casting rides on the casting’s own deadline, and a spell that prints no span in seconds has none for it to ride on',
  });
}

/**
 * A kept creature on a casting that also leaves a record running.
 *
 * Two lifetimes: the summoner's, which `kept` declares, and the casting's,
 * which a duration or a Concentration would bind it to as well. A creature
 * with both goes at whichever ends first, and the book prints one — SRD Find
 * Familiar and Find Steed are both Instantaneous, which is the whole reason
 * `kept` exists.
 */
function checkKeptBesideADuration(
  definition: SpellDefinition,
  found: SpellDefinitionProblem[],
): void {
  if (!castingPersists(definition)) return;
  definition.effects.forEach((effect, i) => {
    if (effect.kind === 'summon' && effect.kept !== undefined) {
      found.push({
        field: `effects[${i}].kept`,
        code: 'kept_beside_a_duration',
        reason:
          'a creature the caster keeps is bound to its summoner, and a casting with a duration or a Concentration would bind it to the casting as well; a creature with two lifetimes goes at whichever ends first, and the book prints one',
      });
    }
  });
}

/**
 * Where a chance may be written, which is the casting's own list and nowhere
 * else.
 *
 * {@link checkSummonPlacement}'s rule and its argument, read off the other
 * end of the same sentence. What this die decides is whether *this casting*
 * worked, and a casting has one of those: an area trigger firing a minute
 * later, or an activation taken on a later turn, would count the casting again
 * and throw a second die about a question the settlement already answered.
 * There is no SRD sentence of that shape and a homebrew one would be a spell
 * that failed twice.
 */
function checkChancePlacement(
  kind: unknown,
  where: string,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (kind !== 'chance' || where === 'effects') return;
  found.push({
    field: `${path}.kind`,
    code: 'chance_outside_the_casting',
    reason:
      'a printed chance decides whether this casting worked, and only the casting’s own effect list is resolved once',
  });
}

/**
 * Where a summons may be written, which is the casting's own list and nowhere
 * else.
 *
 * {@link checkTeleportPlacement}'s rule for a different reason, and the reason
 * is the bond. A creature a casting is holding is bound by a
 * `creature-summoned` written immediately after the casting's `spell-ongoing`
 * record, and only the casting writes one: an area trigger fires a minute
 * later off a record that already exists and an activation acts through one,
 * so neither has a record to write the bond after. A summons in either list
 * would raise a creature that nothing holds there — the spell would end and
 * the creature would stand, silently, which is the class of failure this
 * repository calls its worst.
 *
 * Refused at authoring rather than met at the table, and refused **beside**
 * {@link checkTeleportPlacement} rather than anywhere else: both ask which
 * list an effect sits in, which is a question `checkEffect` cannot answer
 * because it is handed one effect. That puts both on the untyped walk, so a
 * definition loaded from JSON meets them and one written in TypeScript is held
 * to its own compiler — the asymmetry teleport already carries, and one this
 * change deliberately does not widen by guarding one kind in two places and
 * its neighbour in one.
 */
function checkSummonPlacement(
  kind: unknown,
  where: string,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (kind !== 'summon' || where === 'effects') return;
  found.push({
    field: `${path}.kind`,
    code: 'summon_outside_the_casting',
    reason:
      'a creature a casting holds is bound to the casting’s own record, which only the casting’s own effect list is resolved in time to write',
  });
}

/**
 * Every effect list a definition carries, as one enumeration.
 *
 * **`checkEffect` is one function reached from three lists**, so the guarantee
 * its branches rely on — that an entry is an object naming a `kind` this
 * engine knows — has to hold for all three or for none. It held for one.
 * `areaTrigger.effects` and `activation.effects` were walked only by the
 * semantic pass, which handed their entries straight to a `switch` on
 * `effect.kind`: a `null` there threw, and a string, a number, a list or an
 * unknown kind was accepted with no problem at all.
 *
 * So the entry rules live here, once, and `checkEffect` needs no guard of its
 * own. The rule for the five tasks queued behind this one: **entry-level
 * guards for every effect list are `checkShape`'s; `checkEffect` assumes a
 * known kind.**
 *
 * **The leaf denylist came along for free, and it was the bigger hole.**
 * `checkNoNestedEffect` is reached only from this walk, so a rider carrying
 * `effects`, `targets`, `targetsWithin` or `area` — or an effect `kind` below
 * an effect — validated clean whenever it sat in a nested list. CLAUDE.md's
 * "three places enforce that a rider is a leaf" named the validator as one of
 * them, and the validator enforced it on one list of three; the test sweep
 * walks all three, which is why the catalogue is clean and why nothing caught
 * it.
 *
 * **A nested list is walked only when its parent is readable and it is a
 * list.** Anything else is the *container* being malformed, which the semantic
 * pass already reports at the container's own path — so saying nothing here
 * leaves one defect with one answer rather than two.
 */
function effectLists(d: Record<string, unknown>): (readonly [string, readonly unknown[]])[] {
  const nested = (parent: string): (readonly [string, readonly unknown[]])[] => {
    const holder = d[parent];
    if (typeof holder !== 'object' || holder === null || Array.isArray(holder)) return [];
    const list = (holder as { readonly effects?: unknown }).effects;
    return Array.isArray(list) ? [[`${parent}.effects`, list]] : [];
  };

  const lists: (readonly [string, readonly unknown[]])[] = [
    ...(Array.isArray(d['effects'])
      ? ([['effects', d['effects']]] as (readonly [string, readonly unknown[]])[])
      : []),
    ...nested('areaTrigger'),
    ...nested('activation'),
  ];

  // **And the one list that hangs below an effect rather than beside one.**
  // SRD Ice Knife's burst is a second resolution sequenced after the attack —
  // see `SequencedBurst`, where the case for a parent rather than a rider is
  // made — so its effects are effects and every rule this walk feeds has to
  // reach them: `checkEffect`'s, `checkGrantLifetimes`' and the leaf
  // denylist's alike.
  //
  // **One level and no recursion**, which is the whole of what keeps the
  // format data: a `then` below a `then` is refused by `checkEffect`, so this
  // never needs to walk what it produces.
  return [
    ...lists,
    ...lists.flatMap(([where, entries]) =>
      entries.flatMap((entry, i): (readonly [string, readonly unknown[]])[] => {
        if (!hostCarriesASequence(entry)) return [];
        const then = (entry as { readonly then?: unknown }).then;
        if (typeof then !== 'object' || then === null || Array.isArray(then)) return [];
        const inner = (then as { readonly effects?: unknown }).effects;
        return Array.isArray(inner) ? [[`${where}[${i}].then.effects`, inner]] : [];
      }),
    ),
  ];
}

/**
 * The invariant the whole rider design rests on: **a rider is a leaf.**
 *
 * A consequence that rolls a d20 is not a consequence, it is a second
 * resolution — and the moment one is allowed the definition format stops being
 * data and becomes a small untyped program, with a saving throw nested inside
 * a saving throw. `onFail: SpellEffect[]` was rejected for exactly that, and
 * this is where the rejection is enforced against input the compiler never
 * saw.
 *
 * **A denylist rather than an allowlist**, which is the same reading
 * `checkShape` already takes everywhere else: a field the engine does not know
 * is data written against a later version rather than data that is wrong. What
 * is refused is the handful of fields that *would* make a nested object a
 * parent — an effect list, a target list, an area, or a `kind` this engine
 * dispatches effects on. A `ModifierRider`'s `bonus` and `mode` are not among
 * them, which one assertion in `spell-schema.test.ts` pins rather than trusts.
 *
 * Depth is bounded, and not for safety: a rider is one object deep by
 * construction and the deepest legal nesting in the whole format is an
 * effect's rider's selector. A definition that goes deeper has stopped being
 * the thing this validates, and reporting that is more useful than recursing
 * into it.
 */
/**
 * Whether this is the one effect kind a second resolution may hang on.
 *
 * `attack` and nothing else: it is the only kind whose type declares `then`,
 * the only kind `checkEffect` validates one on, and the only kind `runEffects`
 * reads one off. A `then` anywhere else is data no resolver would ever
 * perform, so it stays what it was before the slot existed — a nested effect,
 * refused by the leaf denylist.
 *
 * Read off untyped input like every other reader in this file, so a `kind`
 * that is missing, null or something this engine has never heard of answers
 * false and is reported by the rule that knows what is wrong with it.
 */
function hostCarriesASequence(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return (value as { readonly kind?: unknown }).kind === 'attack';
}

function checkNoNestedEffect(
  value: unknown,
  path: string,
  found: SpellDefinitionProblem[],
  depth = 0,
): void {
  if (typeof value !== 'object' || value === null) return;

  if (depth > RIDER_DEPTH_LIMIT) {
    found.push({
      field: path,
      code: 'effect_too_deep',
      reason: `an effect and its riders are at most ${RIDER_DEPTH_LIMIT} objects deep; anything below that is a nested program rather than data`,
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, i) => checkNoNestedEffect(entry, `${path}[${i}]`, found, depth + 1));
    return;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    // **The one slot below an effect that is a parent, and is meant to be.**
    // `then` is a second resolution sequenced after the first — see
    // `SequencedBurst` — so it carries the three things this denylist exists
    // to refuse, and refusing them here would refuse the shape rather than
    // catch a mistake. It is walked by {@link effectLists} instead, where its
    // effects are checked as effects; what this rule still holds is that
    // nothing *else* below an effect may carry one, and `checkEffect` is what
    // stops a `then` inside a `then`.
    //
    // **On the `attack` host and nowhere else**, which is the whole of the
    // allowance: `attack` is the one kind whose type carries the slot and the
    // one kind `runEffects` reads it off, so a `then` written on a
    // `save-damage` would be a second resolution nothing ever performs. It was
    // refused before this shape existed and it is refused still — by falling
    // through to the denylist below, which is what `then.area` and
    // `then.effects` are.
    if (depth === 0 && key === 'then' && hostCarriesASequence(value)) continue;
    if (depth > 0 && FORBIDDEN_BELOW_AN_EFFECT.has(key)) {
      found.push({
        field: `${path}.${key}`,
        code: 'nested_effect',
        reason: `a rider is a leaf: it rolls no d20, names no target and has no area, so "${key}" cannot appear below an effect`,
      });
      continue;
    }
    if (depth > 0 && key === 'kind' && typeof entry === 'string' && EFFECT_KINDS.has(entry)) {
      found.push({
        field: `${path}.kind`,
        code: 'nested_effect',
        reason: `a rider is a leaf, so "${entry}" — an effect the engine resolves — cannot appear below an effect`,
      });
      continue;
    }
    checkNoNestedEffect(entry, `${path}.${key}`, found, depth + 1);
  }
}

/**
 * What makes a nested object a parent rather than a leaf.
 *
 * Each names a thing only a resolution has: its own consequences, its own
 * targets, its own geometry. Nothing legal inside an effect carries one —
 * `area` and `targets` are the *definition's*, and `effects` belongs to a
 * definition, an activation or an area trigger.
 */
const FORBIDDEN_BELOW_AN_EFFECT: ReadonlySet<string> = new Set([
  'effects',
  'targets',
  'targetsWithin',
  'area',
]);

/** An effect, its rider, and the rider's own selector: three, and a little air. */
const RIDER_DEPTH_LIMIT = 6;

/**
 * The kinds a rider may be, as a set.
 *
 * The sibling of {@link EFFECT_KINDS}, and the reason it is written down is
 * that the two must never intersect: a value that is both a rider kind and an
 * effect kind is the recursion this design exists to refuse, arriving through
 * a name collision rather than through a type. `spell-schema.test.ts` asserts
 * the intersection is empty.
 */
export const RIDER_KINDS: ReadonlySet<string> = new Set([
  'bonus',
  'mode',
  'speed-change',
  'action',
  'healing',
  'benefit',
]);

/**
 * The effect kinds, as a set.
 *
 * The one place a runtime value restates the union, and it is here rather than
 * anywhere the rules live: the rules switch on `effect.kind` and the compiler
 * makes that exhaustive, while untyped input needs the vocabulary as data. A
 * member added to the union without being added here is caught by
 * `spell-schema.test.ts`, which drives every kind the catalogue uses through
 * this function.
 */
export const EFFECT_KINDS: ReadonlySet<string> = new Set([
  'attack',
  'save-damage',
  'auto-damage',
  'chance',
  'temp-hp',
  'buff',
  'heal',
  'attack-damage',
  'save',
  'condition',
  'end-condition',
  'dispel',
  'interrupt-casting',
  'armor-class',
  'roll-mode',
  'passive-defense',
  'damage-defense',
  'condition-immunity',
  'speed',
  'light',
  'sense',
  'damage-reduction',
  'fall-ward',
  'jump-allowance',
  'attack-rider',
  'weapon-rider',
  'weapon-attack',
  'teleport',
  'summon',
  'turn-payout',
  'action-rule',
  'healing-rule',
  'hit-point-maximum',
]);
