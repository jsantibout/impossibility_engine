import { err, ok, type Result } from '@ie/shared';
import type { CastingOption } from '../standing.js';
import type { CharacterSheet } from '../character.js';
import { durationSecondsAt, ranged, type SpellDefinition } from '../spell-definitions.js';
import type { CastingTime } from '../spells.js';

/**
 * A feature that changes what a casting costs, applied.
 *
 * SRD Metamagic is the only such feature in the book and the engine names none
 * of it: what arrives here is a list of options compiled onto the caster's
 * sheet at creation, each carrying a price in a pool and one
 * `CastingCostAlteration`. This module is the reader — it decides whether an
 * elected option reaches this casting, works out the four numbers it may
 * rewrite, and hands back the price. It spends nothing and rolls nothing.
 *
 * **Every refusal here happens before anything is spent**, which is the rule
 * the whole casting path keeps and the reason the price can be charged inside
 * the casting's own batch afterwards.
 *
 * **An option that does not reach is refused, and that is where this parts
 * company with an elected `casting-damage` feature.** `electedFeatures` in
 * `rolls.ts` accepts a feature that simply does not narrow onto the spell
 * being cast, on the grounds that casting outside a feature's narrowing is
 * legal and refusing it would invent a rule. An option is different in the one
 * way that matters: it has a **price**. SRD writes each of these as a
 * condition on the spending — "When you cast a spell that has a range of at
 * least 5 feet, you can spend 1 Sorcery Point" — so a caster who elects
 * Distant Spell on a Range: Self spell has not declined anything and must not
 * be charged for nothing. The refusal is the book's sentence, not the engine's
 * caution.
 */

/** The order the arms are applied in — see {@link alteredCasting}. */
const ORDER: readonly string[] = ['effective-level', 'range', 'duration', 'casting-time'];

/** What a refusal calls each of the four, so the reason reads as English. */
const SPELLING: Readonly<Record<string, string>> = {
  range: 'range',
  duration: 'duration',
  'casting-time': 'casting time',
  'effective-level': 'level',
};

/** What an elected option costs, in the pool its feature named. */
export interface CastingOptionCost {
  readonly key: string;
  readonly amount: number;
}

/**
 * The casting as its caster's elected options leave it.
 *
 * Four numbers and a price, worked out once, before the targets are settled
 * and before the slot goes. Each field is what the casting command would
 * otherwise have derived for itself.
 */
export interface AlteredCasting {
  /** How far the spell reaches, in feet; null where it is not a distance. */
  readonly reachFeet: number | null;
  /** The level the casting counts as, which is not the level of the slot. */
  readonly castLevel: number;
  /** Which part of the turn the casting takes. */
  readonly castingTime: CastingTime;
  /** The casting's own span in seconds, or undefined where it has none. */
  readonly durationSeconds: number | undefined;
  /** What the elected options cost, summed per pool. */
  readonly costs: readonly CastingOptionCost[];
}

/**
 * The options this casting elected, or a refusal naming one the caster has not
 * got.
 *
 * Two refusals and they are different mistakes. A caller who names an option
 * that is not on this sheet has named something that does not exist for this
 * character — the Sorcerer took two of ten and this is one of the other eight,
 * or the character is not a Sorcerer at all. A caller who names two options
 * off one feature has broken the feature's own limit: SRD Metamagic's "You can
 * use only one Metamagic option on a spell when you cast it."
 *
 * **An option named twice is two options**, because the price would be paid
 * twice; a caller who meant it once said it once. What stops it from being
 * charged twice for one effect is not here but in {@link alteredCasting},
 * which refuses two options that rewrite the same number — the rule that
 * catches a second *different* option of the same kind too.
 */
export function electedCastingOptions(
  sheet: CharacterSheet,
  who: string,
  named: readonly string[] | undefined,
): Result<readonly CastingOption[]> {
  if (named === undefined || named.length === 0) return ok([]);

  const held = sheet.castingOptions ?? [];
  const elected: CastingOption[] = [];
  for (const id of named) {
    const found = held.filter((option) => option.option === id);
    if (found.length === 0) {
      return err(
        'no_such_casting_option',
        `${who} has no casting option ${id} to use on this spell`,
      );
    }
    // Two features offering one id is a catalogue that cannot be addressed:
    // the price and the alteration would both be somebody's guess. `checkContent`
    // has no view across features, so the refusal is here.
    if (found.length > 1) {
      return err(
        'ambiguous_casting_option',
        `${who} has ${found.length} features offering an option called ${id}, and a casting can only name one`,
      );
    }
    elected.push(found[0]!);
  }

  for (const option of elected) {
    const fromFeature = elected.filter((other) => other.feature === option.feature).length;
    if (fromFeature > option.perCasting) {
      return err(
        'too_many_casting_options',
        `${option.featureName} allows ${option.perCasting} option${option.perCasting === 1 ? '' : 's'} on a casting and ${fromFeature} were named`,
      );
    }
  }

  return ok(elected);
}

/**
 * The four numbers a casting works out for itself, as its elected options
 * leave them.
 *
 * **Applied in a fixed order — level, then range, then duration, then casting
 * time — and the order is load-bearing for exactly one pair.** A duration read
 * off a band (`durationAtSlot`) depends on the level the casting counts as, so
 * a casting both raised a level and extended reads its band at the higher
 * level and doubles what it finds there. The other two commute with
 * everything.
 *
 * Nothing here is the definition's business: every narrowing is read off the
 * definition the caller named, and the option says what to do with what it
 * finds.
 */
export function alteredCasting(
  definition: SpellDefinition,
  base: { readonly castLevel: number; readonly castingTime: CastingTime },
  options: readonly CastingOption[],
): Result<AlteredCasting> {
  let castLevel = base.castLevel;
  let castingTime = base.castingTime;
  let reachFeet = ranged(definition.range);
  let extended: number | undefined;
  const costs = new Map<string, number>();

  // **Each of the four numbers is rewritten once or not at all.** Two options
  // that both answer "how far does this casting reach" are two answers to one
  // question, and there is no arithmetic the book prints for composing them —
  // a range doubled twice is not quadrupled anywhere in the SRD, and a casting
  // time is not changed from a value it no longer has. Applying one and
  // charging for both is the price-paid-for-nothing this module exists to
  // refuse, so the casting is refused instead. A feature whose `perCasting` is
  // one cannot reach this; one that allows two can, by buying two ranges.
  //
  // **By position and not by identity**, because an option named twice is the
  // same record twice: a reference comparison would call it one option and
  // charge for two.
  for (const [at, option] of options.entries()) {
    const twin = options.findIndex(
      (other, index) => index !== at && other.alters.kind === option.alters.kind,
    );
    if (twin >= 0) {
      return err(
        'two_options_alter_one_thing',
        `${option.name} and ${options[twin]!.name} both rewrite what this casting's ${SPELLING[option.alters.kind] ?? option.alters.kind} is, and a casting has one of each`,
      );
    }
  }

  const ordered = [...options].sort(
    (a, b) => ORDER.indexOf(a.alters.kind) - ORDER.indexOf(b.alters.kind),
  );

  for (const option of ordered) {
    const alters = option.alters;
    const refuse = (reason: string): Result<AlteredCasting> =>
      err('option_does_not_reach', `${option.name} ${reason}`);

    if (alters.kind === 'effective-level') {
      // SRD Twinned Spell names the clause it wants and every definition that
      // prints it has transcribed it: "one additional Humanoid for each spell
      // slot level above 2".
      if (
        alters.onlyIfTargetsScale === true &&
        (definition.targets.extraPerSlotLevelAbove ?? 0) <= 0
      ) {
        return refuse(
          `needs a spell that takes another creature when it is cast with a higher slot, and ${definition.name} does not`,
        );
      }
      // A spell slot stops at level 9 and so does a casting's level; a spell
      // already cast at 9 has nothing above it to be raised to.
      if (castLevel + alters.by > 9) {
        return refuse(`cannot raise ${definition.name} above level 9, and it is already at ${castLevel}`);
      }
      castLevel += alters.by;
    } else if (alters.kind === 'range') {
      if (definition.range.kind === 'self') {
        return refuse(`needs a spell with a range in feet, and ${definition.name} has a range of Self`);
      }
      // SRD Distant Spell doubles a range; there is nothing to double when the
      // book printed a question instead of a distance. Refused rather than
      // applied for nothing, which is the price-paid-for-nothing rule the
      // branch above already follows — and the engine may not invent a number
      // for a Range whose whole point is that only the DM can answer it.
      if (definition.range.kind === 'dm') {
        return refuse(
          `needs a spell with a range in feet, and ${definition.name}'s printed Range is the DM's to decide`,
        );
      }
      if (definition.range.kind === 'touch') {
        if (alters.touchBecomesFeet === undefined) {
          return refuse(`says nothing about a range of Touch, and ${definition.name} has one`);
        }
        reachFeet = alters.touchBecomesFeet;
      } else {
        reachFeet = definition.range.feet * alters.multiplier;
      }
    } else if (alters.kind === 'duration') {
      const printed = durationSecondsAt(definition, castLevel);
      if (definition.durationSeconds === undefined || printed === undefined) {
        return refuse(
          `needs a spell that runs for a span of time, and ${definition.name} has no duration in seconds`,
        );
      }
      if (alters.minimumSeconds !== undefined && printed < alters.minimumSeconds) {
        return refuse(
          `needs a duration of at least ${alters.minimumSeconds} seconds, and ${definition.name} lasts ${printed}`,
        );
      }
      const doubled = printed * alters.multiplier;
      extended =
        alters.maximumSeconds === undefined ? doubled : Math.min(doubled, alters.maximumSeconds);
    } else {
      if (castingTime !== alters.from) {
        return refuse(
          `needs a casting time of ${alters.from}, and this casting of ${definition.name} takes ${castingTime}`,
        );
      }
      castingTime = alters.to;
    }

    costs.set(option.pool, (costs.get(option.pool) ?? 0) + option.cost);
  }

  return ok({
    reachFeet,
    castLevel,
    castingTime,
    // The level may have moved, so a spell whose duration is read off a band
    // reads it again at the level the casting counts as.
    durationSeconds:
      extended ??
      (definition.durationSeconds === undefined
        ? undefined
        : durationSecondsAt(definition, castLevel)),
    costs: [...costs].map(([key, amount]) => ({ key, amount })),
  });
}
