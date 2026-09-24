import { err, ok, type Result, type RollMode } from '@ie/shared';
import type { CastingOption, CastingOptionCount } from '../standing.js';
import type { CharacterSheet } from '../character.js';
import {
  damageTypesDealt,
  durationSecondsAt,
  ranged,
  type SpellDefinition,
} from '../spell-definitions.js';
import type { CastingTime } from '../spells.js';

/**
 * A feature that changes what a casting buys, applied.
 *
 * SRD Metamagic is the only such feature in the book and the engine names none
 * of it: what arrives here is a list of options compiled onto the caster's
 * sheet at creation, each carrying a price in a pool and one
 * `CastingCostAlteration`. This module is the reader — it decides whether an
 * elected option reaches this casting, works out the four numbers it may
 * rewrite and the six marks it may carry, and hands back the price. It spends
 * nothing and rolls nothing.
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

/**
 * The order the arms are applied in — see {@link alteredCasting}.
 *
 * Only the four that rewrite a number are ordered, because only they can
 * depend on each other. The six that carry a mark are read in whatever order
 * they were named: each writes a different field of {@link CastingResolution}
 * and none reads another's.
 */
const ORDER: readonly string[] = ['effective-level', 'range', 'duration', 'casting-time'];

/** What a refusal calls each alteration, so the reason reads as English. */
const SPELLING: Readonly<Record<string, string>> = {
  range: 'range',
  duration: 'duration',
  'casting-time': 'casting time',
  'effective-level': 'level',
  'spare-from-saves': 'spared creatures',
  'save-mode': 'mode on a save',
  'reroll-damage-dice': 'rerolled damage dice',
  'reroll-a-missed-attack': 'rerolled attack',
  unperceived: 'perceivability',
  'restate-damage-type': 'damage type',
};

/**
 * The effect kinds that throw a casting's **own** damage dice.
 *
 * The trio `resolveAttackEffect`, `resolveSaveDamageEffect` and
 * `resolveAutoDamageEffect` roll, which is the same list `spell-schema.ts`
 * holds under `ROLLS_ITS_OWN_DAMAGE` for a die rule: what SRD Empowered
 * Spell's "when you roll damage for a spell" has to find on a definition for
 * the option to be about anything.
 */
const ROLLS_DAMAGE: ReadonlySet<string> = new Set(['attack', 'save-damage', 'auto-damage']);

/** The effect kinds that make a creature roll a saving throw. */
const FORCES_A_SAVE: ReadonlySet<string> = new Set(['save', 'save-damage']);

/** What an elected option costs, in the pool its feature named. */
export interface CastingOptionCost {
  readonly key: string;
  readonly amount: number;
}

/**
 * What the elected options carry past the cost-and-route half of the casting.
 *
 * The six arms of `CastingCostAlteration` that do not rewrite one of the four
 * numbers, settled here — refused where the spell offers them nothing, counted
 * off the caster where the SRD counts them off a modifier — and read by the
 * seam each belongs to: the catch, the save roll, the damage roll, the attack
 * roll, the Reaction window and the stated damage type.
 *
 * **Each field is at most one option's**, because `perCasting` is 1 for SRD
 * Metamagic and `alteredCasting` refuses two options that rewrite the same
 * thing in any case. What is stored is what the seam needs and the name that
 * bought it, so the log can say which option a mode or a reroll came from.
 */
export interface CastingResolution {
  /** SRD Careful Spell: how many creatures the casting may spare. */
  readonly spares?: { readonly upTo: number; readonly name: string };
  /** SRD Heightened Spell: the mode, and how many targets may be named. */
  readonly saveMode?: {
    readonly mode: RollMode;
    readonly upTo: number;
    readonly name: string;
  };
  /** SRD Empowered Spell: how many of the first damage roll's dice go back. */
  readonly rerollDamage?: { readonly count: number; readonly name: string };
  /** SRD Seeking Spell: one missed spell attack thrown again, and its price. */
  readonly rerollMissedAttack?: { readonly name: string; readonly cost: CastingOptionCost };
  /** SRD Subtle Spell: nothing perceivable, so no Counterspell window. */
  readonly subtle?: { readonly name: string };
  /** SRD Transmuted Spell: the types the caster may restate this casting to. */
  readonly restatesDamageType?: { readonly among: readonly string[]; readonly name: string };
}

/**
 * The casting as its caster's elected options leave it.
 *
 * Four numbers, six marks and a price, worked out once, before the targets are
 * settled and before the slot goes. Each number is what the casting command
 * would otherwise have derived for itself; each mark is carried to the seam
 * that reads it.
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
  /** What the elected options cost, summed per pool, spent in this batch. */
  readonly costs: readonly CastingOptionCost[];
  /**
   * What an elected option costs **only if its condition happens**, summed per
   * pool — SRD Seeking Spell's point, which is spent on the reroll and on
   * nothing else.
   *
   * Checked against the pool exactly where {@link costs} is, so a casting
   * whose caster could not afford the reroll is refused before the attack is
   * thrown; not spent there, so a casting whose attack hits pays nothing.
   */
  readonly contingent: readonly CastingOptionCost[];
  /** What the options carry past this half of the casting. */
  readonly resolving: CastingResolution;
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
 * How many a {@link CastingOptionCount} comes to for this casting.
 *
 * SRD's "up to your Charisma modifier (minimum of one creature)" in one line:
 * the derivation, then the floor the book puts under it. The modifier is the
 * one the casting pinned, so it is the caster's at the moment they cast.
 */
const counted = (count: CastingOptionCount, spellcastingModifier: number): number =>
  count.of === 'printed' ? count.count : Math.max(count.minimum ?? 0, spellcastingModifier);

/**
 * The four numbers a casting works out for itself, and the six marks it
 * carries, as its elected options leave them.
 *
 * **The four are applied in a fixed order — level, then range, then duration,
 * then casting time — and the order is load-bearing for exactly one pair.** A
 * duration read off a band (`durationAtSlot`) depends on the level the casting
 * counts as, so a casting both raised a level and extended reads its band at
 * the higher level and doubles what it finds there. The other two commute with
 * everything, and the six marks commute with all of it: each writes a field of
 * {@link CastingResolution} that nothing else here reads.
 *
 * Nothing here is the definition's business: every narrowing is read off the
 * definition the caller named, and the option says what to do with what it
 * finds.
 */
export function alteredCasting(
  definition: SpellDefinition,
  base: {
    readonly castLevel: number;
    readonly castingTime: CastingTime;
    /**
     * The caster's spellcasting modifier for this casting, which two of the
     * ten options count a head count off — see {@link CastingOptionCount}.
     *
     * Optional so that the low-level callers which drive only the four
     * number-rewriting arms need not derive a number none of them reads; zero
     * then, which the SRD's own minimum immediately raises.
     */
    readonly spellcastingModifier?: number;
  },
  options: readonly CastingOption[],
): Result<AlteredCasting> {
  let castLevel = base.castLevel;
  let castingTime = base.castingTime;
  let reachFeet = ranged(definition.range);
  let extended: number | undefined;
  const modifier = base.spellcastingModifier ?? 0;
  const costs = new Map<string, number>();
  const contingent = new Map<string, number>();
  let resolving: CastingResolution = {};

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
    } else if (alters.kind === 'casting-time') {
      if (castingTime !== alters.from) {
        return refuse(
          `needs a casting time of ${alters.from}, and this casting of ${definition.name} takes ${castingTime}`,
        );
      }
      castingTime = alters.to;
    } else if (alters.kind === 'spare-from-saves') {
      // SRD Careful Spell: "a spell that forces **other creatures** to make a
      // saving throw". A spell that forces none has nobody to spare.
      if (!definition.effects.some((effect) => FORCES_A_SAVE.has(effect.kind))) {
        return refuse(
          `needs a spell that forces a saving throw, and ${definition.name} forces none`,
        );
      }
      resolving = {
        ...resolving,
        spares: { upTo: counted(alters.upTo, modifier), name: option.name },
      };
    } else if (alters.kind === 'save-mode') {
      if (!definition.effects.some((effect) => FORCES_A_SAVE.has(effect.kind))) {
        return refuse(
          `needs a spell that forces a saving throw, and ${definition.name} forces none`,
        );
      }
      resolving = {
        ...resolving,
        saveMode: {
          mode: alters.mode,
          upTo: counted(alters.upTo, modifier),
          name: option.name,
        },
      };
    } else if (alters.kind === 'reroll-damage-dice') {
      // SRD Empowered Spell: "When you roll damage for a spell." A spell that
      // rolls none never reaches the moment the option is about.
      if (!definition.effects.some((effect) => ROLLS_DAMAGE.has(effect.kind))) {
        return refuse(`needs a spell that rolls damage, and ${definition.name} rolls none`);
      }
      resolving = {
        ...resolving,
        rerollDamage: { count: counted(alters.upTo, modifier), name: option.name },
      };
    } else if (alters.kind === 'reroll-a-missed-attack') {
      // SRD Seeking Spell: "If you make an attack roll for a spell and miss."
      if (!definition.effects.some((effect) => effect.kind === 'attack')) {
        return refuse(
          `needs a spell that makes an attack roll, and ${definition.name} makes none`,
        );
      }
      // The price is **contingent**: checked against the pool with the rest,
      // spent only where the miss happens. See {@link AlteredCasting.contingent}.
      contingent.set(option.pool, (contingent.get(option.pool) ?? 0) + option.cost);
      resolving = {
        ...resolving,
        rerollMissedAttack: {
          name: option.name,
          cost: { key: option.pool, amount: option.cost },
        },
      };
      continue;
    } else if (alters.kind === 'unperceived') {
      // SRD Subtle Spell: "When you cast a spell" — every spell, with no
      // narrowing at all, which is the one arm of the ten that refuses nothing.
      resolving = { ...resolving, subtle: { name: option.name } };
    } else {
      // SRD Transmuted Spell: "a spell that deals a type of damage from the
      // following list". What the spell deals has to be on the option's list;
      // what the caster names is checked where the caster names it.
      const dealt = damageTypesDealt(definition.effects);
      if (!dealt.some((type) => alters.among.includes(type))) {
        return refuse(
          `moves between ${alters.among.join(', ')}, and ${definition.name} deals ${dealt.length === 0 ? 'no damage at all' : dealt.join(' and ')}`,
        );
      }
      resolving = {
        ...resolving,
        restatesDamageType: { among: alters.among, name: option.name },
      };
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
    contingent: [...contingent].map(([key, amount]) => ({ key, amount })),
    resolving,
  });
}
