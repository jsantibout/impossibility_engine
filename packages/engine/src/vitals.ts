import { err, ok, type Result, type RollMode } from '@ie/shared';
import type { DieEffect, Rng } from './dice.js';
import type { Bonus, ModeSource } from './bonuses.js';
import { rollD20Test } from './checks.js';
import { type D20Reroll, type RecordedD20, type RollIssuer } from './rolls.js';

/**
 * Hit points, temporary hit points, death saving throws, and the arithmetic of
 * dying.
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

export interface Vitals {
  readonly hp: number;
  readonly hpMax: number;
  /**
   * How much of {@link hpMax} a running effect put there.
   *
   * SRD Aid: "Each target's Hit Point maximum and current Hit Points increase
   * by 5 for the duration." The maximum is the one number in `GameState` that
   * is genuinely **folded rather than derived** — creation states it and
   * advancement moves it — so a spell that holds it up for eight hours leaves
   * two facts where there was one, and both are read.
   *
   * `hpMax` stays the *effective* maximum, because that is what every rule
   * already asks it for: the cap on healing, the Massive Damage threshold, the
   * ceiling a recovery counts against. What this adds is the part of it that
   * is on loan, so `hpMax - hpMaxAdjustment` is the number the class table
   * says — which is exactly what `advanceCharacter` has to subtract from the
   * new level's total. Without it, a level-up taken while Aid was running
   * granted five hit points fewer than the level was worth, and the five went
   * away with the spell.
   *
   * Nothing writes it directly. `settleHitPointMaximum` is the one mover, run
   * from the fold's derived pass over the grants a creature is carrying, so
   * the release path every other grant already has — a dispel, a broken
   * Concentration, a deadline, the caster leaving — gives the maximum back
   * without anybody emitting an event to say so.
   */
  readonly hpMaxAdjustment: number;
  readonly temporaryHp: number;
  /** 0 to 2; the third converts to Stable and resets. */
  readonly deathSaveSuccesses: number;
  /** 0 to 2; the third kills. */
  readonly deathSaveFailures: number;
  readonly stable: boolean;
  readonly dead: boolean;
  /**
   * SRD: "A monster dies the instant it drops to 0 Hit Points, although a Game
   * Master can ignore this rule for an individual monster and treat it like a
   * character." So this is per-creature rather than a type check.
   */
  readonly diesAtZero: boolean;
}

export function vitals(hpMax: number, over: Partial<Vitals> = {}): Vitals {
  if (!Number.isFinite(hpMax) || hpMax < 1) {
    throw new Error(`a hit point maximum must be a finite number of at least 1, got ${hpMax}`);
  }
  return {
    hp: hpMax,
    hpMax,
    hpMaxAdjustment: 0,
    temporaryHp: 0,
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    stable: false,
    dead: false,
    diesAtZero: false,
    ...over,
  };
}

/**
 * What a running effect has said about this creature regaining hit points.
 *
 * Two sentences, pushing opposite ways, and the SRD writes both about the
 * same arithmetic:
 *
 * > Beacon of Hope: each target "regains the **maximum** number of Hit Points
 * > possible from any healing."
 * > Chill Touch: on a hit "it **can't regain Hit Points** until the end of
 * > your next turn."
 *
 * **Two members rather than a number**, because neither sentence is an amount.
 * `maximised` is about the *dice* — it reaches the roll, through the same
 * `DieEffect.substitute` that Great Weapon Fighting uses, so the log still
 * shows what was thrown beside what it counted as — and `prevented` is about
 * the *event*, so the door emits nothing at all. A scale from "none" to "all"
 * would make the two one axis, and they are not: a maximised heal that is also
 * forbidden restores nothing, which is `prevented` winning rather than a
 * larger number losing.
 */
export type HealingRule = 'maximised' | 'prevented';

/** A healing rule a running effect hung on a creature, ended by its source. */
export interface GrantedHealingRule {
  readonly source: string;
  readonly rule: HealingRule;
}

/** A hit point maximum a running effect is holding up, ended by its source. */
export interface GrantedHitPointMaximum {
  readonly source: string;
  /**
   * Positive for a raise — SRD Aid's five, and the five more each slot level
   * buys — and negative for a lowering: a Specter's Life Drain, a Wight's, a
   * printed save's "Hit Point maximum decreases by an amount equal to the
   * damage taken". A Long Rest completing releases every lowering with no
   * lifetime of its own (`hit-point-maximum-restored`).
   */
  readonly amount: number;
}

/**
 * Which rule stands, out of everything hung on one creature.
 *
 * **A refusal beats a maximisation**, because the two sentences are not on one
 * scale: "can't regain Hit Points" is about whether any are regained at all
 * and "the maximum possible" is about how many the dice are worth. A creature
 * under both regains nothing, and nothing is what the larger number would have
 * been multiplied by.
 */
export function healingRuleOf(rules: readonly GrantedHealingRule[]): HealingRule | null {
  if (rules.some((held) => held.rule === 'prevented')) return 'prevented';
  return rules.some((held) => held.rule === 'maximised') ? 'maximised' : null;
}

/**
 * Every die counts as its own maximum face.
 *
 * SRD Beacon of Hope: "regains the maximum number of Hit Points possible from
 * any healing." The dice are still thrown and still recorded — `DieRoll` keeps
 * `rolled` beside `value`, and the effect's name is the `cause` — so the log
 * says what the d8s showed and why they counted for eight. The alternative,
 * skipping the roll and taking the notation's bound, would be a number with no
 * provenance in a log whose whole job is provenance.
 */
export const maximisedHealing = (name: string): DieEffect => ({
  name,
  substitute: (_rolled, sides) => sides,
});

/**
 * Bring a creature's maximum in line with what is currently holding it up.
 *
 * The one mover of {@link Vitals.hpMaxAdjustment}, run from the fold's derived
 * pass rather than from an event, because the *endings* are derived too:
 * `releaseCasting`, `releaseGrants` and the expiry pass all take a grant off by
 * filtering an array, and none of them emits anything the maximum could hang
 * on.
 *
 * **Up carries the hit points with it; down only clamps them.** SRD Aid says
 * both halves — "Hit Point maximum **and** current Hit Points increase by 5" —
 * because the five were never lost. When it ends, a target wounded below the
 * ordinary maximum keeps what it has and only a total above the new ceiling
 * comes down, which is the same asymmetry every reading of Aid arrives at.
 *
 * **A creature at 0 hit points, or dead, keeps its hit points.** Raising them
 * would lift the Unconscious that having none caused, and the SRD lifts that
 * "until you regain any Hit Points" — which a maximum does not do. A creature
 * carried to 5 by an Aid while still Unconscious from nothing is a state the
 * rules do not describe, so the maximum rises alone and the dying go on dying.
 * This is a reading rather than a printed sentence, and it is the one thing in
 * this function a table might settle the other way; `healing-and-hit-point-maxima.test.ts`
 * drives both creatures so that changing it is a decision rather than a drift.
 *
 * **There is no floor, and that is an open question rather than a rule.**
 * `adjustment` was once a sum of raises; a printed line may lower a maximum
 * now, and two Life Drains on a small creature take `base + adjustment` below
 * zero with the creature still alive. SRD 5.2.1 prints no sentence that a
 * creature dies when its maximum reaches 0 (2014's did), so a `Math.max(1, …)`
 * here would be a ruling written as arithmetic; `docs/ROADMAP.md` §10 holds
 * the question for the owner, and a Long Rest bounds the accumulation until
 * it is answered.
 */
export function settleHitPointMaximum(v: Vitals, adjustment: number): Vitals {
  const base = v.hpMax - v.hpMaxAdjustment;
  const hpMax = base + adjustment;
  if (hpMax === v.hpMax) return v;

  const gained = hpMax - v.hpMax;
  const hp =
    gained > 0 ? (v.dead || v.hp === 0 ? v.hp : v.hp + gained) : Math.min(v.hp, hpMax);

  return { ...v, hpMax, hpMaxAdjustment: adjustment, hp };
}

/** At 0 hit points and still in the fight — Unconscious, not dead. */
export function isDown(v: Vitals): boolean {
  return !v.dead && v.hp === 0;
}

export interface DamageOutcome {
  readonly vitals: Vitals;
  /** How much the temporary pool soaked. */
  readonly temporaryAbsorbed: number;
  readonly hpLost: number;
  readonly droppedToZero: boolean;
  readonly died: boolean;
  /** Death save failures this damage caused, for a creature already at zero. */
  readonly deathSaveFailuresAdded: number;
  /** Why the creature died, when it did. */
  readonly cause: string | null;
}

export interface DamageOptions {
  /** SRD: damage at 0 hit points from a Critical Hit costs two failures. */
  readonly critical?: boolean;
  /**
   * Hit points this blow may not drive the creature below.
   *
   * SRD Relentless Endurance: "When you are reduced to 0 Hit Points but not
   * killed outright, you can drop to 1 Hit Point instead."
   *
   * **A number here and a decision somewhere else.** Whether the trait is held
   * at all, and whether its once-a-day use is still there to spend, are
   * questions about a creature's features and its resources — neither of which
   * this module has or wants. `damageCreature` asks them, pins the answer onto
   * the `damage-taken` event, and the fold hands the same number back here on
   * replay, so the blow lands identically both times.
   *
   * **It stands against the death the drop itself causes, and not against
   * Massive Damage.** SRD Undead Fortitude is a sentence *about* "a monster
   * dies the instant it drops to 0 Hit Points" — "on a successful save, the
   * zombie drops to 1 Hit Point instead" overrides that rule or it says
   * nothing at all — so a floor beats `diesAtZero`. Massive Damage it does not
   * beat: no printed sentence of this shape speaks about it, and a zombie
   * never reaches that arm anyway.
   *
   * **Relentless Endurance's narrower reading is kept where it is decided.**
   * "When you are reduced to 0 Hit Points **but not killed outright**" is the
   * command's clause rather than this module's: `damageCreature` asks
   * `hitPointFloorFor` only where the blow did not kill, so that floor is
   * never offered to a creature this arm could save. One rule, one place, and
   * the reach of each sentence written where its own facts are.
   */
  readonly floor?: number;
}

/**
 * SRD Damage Threshold: what an instance of damage actually takes off.
 *
 * "A creature or an object that has a damage threshold has Immunity to all
 * damage unless it takes an amount of damage from a single attack or effect
 * equal to or greater than its damage threshold, in which case it takes that
 * entire instance of damage."
 *
 * One line and its own function, because two readers need the same answer:
 * `damageCreature`, which writes it down, and `resolveDamage`, which has to
 * know what a blow will take off *before* it writes anything, to raise the
 * saving throw SRD Undead Fortitude prices off exactly that number.
 */
export const damagePastThreshold = (threshold: number, amount: number): number =>
  amount < threshold ? 0 : amount;

export function applyDamageToVitals(
  v: Vitals,
  amount: number,
  options: DamageOptions = {},
): DamageOutcome {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`damage must be a non-negative number, got ${amount}`);
  }

  const unchanged: DamageOutcome = {
    vitals: v,
    temporaryAbsorbed: 0,
    hpLost: 0,
    droppedToZero: false,
    died: false,
    deathSaveFailuresAdded: 0,
    cause: null,
  };

  if (v.dead || amount === 0) return unchanged;

  // SRD: "If you have Temporary Hit Points and take damage, those points are
  // lost first, and any leftover damage carries over to your Hit Points."
  const temporaryAbsorbed = Math.min(v.temporaryHp, amount);
  const toHp = amount - temporaryAbsorbed;
  const temporaryHp = v.temporaryHp - temporaryAbsorbed;

  // Damage taken while already at 0 hit points does not reduce hit points; it
  // costs death saving throws instead.
  //
  // **Taken, not landed.** SRD: "If you take *any* damage while you have 0 Hit
  // Points, you suffer a Death Saving Throw failure", and Temporary Hit Points
  // are a buffer against losing Hit Points rather than against taking damage —
  // a downed creature can hold them, since "receiving Temporary Hit Points
  // doesn't restore you to consciousness". So a blow the pool soaks entirely
  // still costs a failure and still breaks Stable.
  //
  // This is the same reading Concentration already gets here: a caster behind
  // Armor of Agathys who soaks thirty still rolls against DC 15. Answering the
  // two rules differently is what this used to do.
  if (isDown(v)) {
    // SRD: "If the damage equals or exceeds your Hit Point maximum, you die."
    // The damage, not the remainder — what the pool absorbed was still dealt.
    if (amount >= v.hpMax) {
      return {
        ...unchanged,
        vitals: { ...v, temporaryHp, stable: false, dead: true },
        temporaryAbsorbed,
        died: true,
        cause: 'damage at 0 hit points equalling the hit point maximum',
      };
    }

    const added = options.critical === true ? 2 : 1;
    const failures = v.deathSaveFailures + added;
    const dead = failures >= 3;

    return {
      ...unchanged,
      vitals: {
        ...v,
        temporaryHp,
        // SRD: "If the creature takes damage, it stops being Stable."
        stable: false,
        deathSaveFailures: dead ? 0 : failures,
        dead,
      },
      temporaryAbsorbed,
      deathSaveFailuresAdded: added,
      died: dead,
      cause: dead ? 'a third failed death saving throw' : null,
    };
  }

  const hp = Math.max(0, v.hp - toHp);
  const hpLost = v.hp - hp;
  const droppedToZero = hp === 0;

  if (!droppedToZero) {
    return {
      ...unchanged,
      vitals: { ...v, hp, temporaryHp },
      temporaryAbsorbed,
      hpLost,
    };
  }

  /** What the floor leaves the creature on, or null where there is none. */
  const held =
    options.floor !== undefined && options.floor > 0 ? Math.min(v.hp, options.floor) : null;

  // SRD Monster Death: a monster dies the instant it drops to 0 — unless
  // something on its block says otherwise, which is the whole content of SRD
  // Undead Fortitude. See {@link DamageOptions.floor}.
  if (v.diesAtZero) {
    if (held !== null) {
      return {
        ...unchanged,
        vitals: { ...v, hp: held, temporaryHp },
        temporaryAbsorbed,
        hpLost: v.hp - held,
      };
    }
    return {
      ...unchanged,
      vitals: { ...v, hp: 0, temporaryHp, dead: true },
      temporaryAbsorbed,
      hpLost,
      droppedToZero: true,
      died: true,
      cause: 'reduced to 0 hit points',
    };
  }

  // SRD Massive Damage: "When damage reduces a character to 0 Hit Points and
  // damage remains, the character dies if the remainder equals or exceeds their
  // Hit Point maximum." The remainder is measured after temporary hit points
  // have been spent — they are a buffer against the damage, not a separate hit.
  const remainder = toHp - hpLost;
  if (remainder >= v.hpMax) {
    return {
      ...unchanged,
      vitals: { ...v, hp: 0, temporaryHp, dead: true },
      temporaryAbsorbed,
      hpLost,
      droppedToZero: true,
      died: true,
      cause: 'massive damage',
    };
  }

  // **Massive Damage has returned above, and a monster's death at 0 was
  // answered where it is printed.** So what is left here is the creature the
  // rules leave Unconscious, which is the one SRD Relentless Endurance is
  // about. Nothing below follows: it did not drop to zero, so it starts no
  // death saves and gains no Unconscious, and `hpLost` is what it really lost
  // rather than what the blow would have taken.
  if (held !== null) {
    return {
      ...unchanged,
      vitals: { ...v, hp: held, temporaryHp },
      temporaryAbsorbed,
      hpLost: v.hp - held,
    };
  }

  return {
    ...unchanged,
    vitals: {
      ...v,
      hp: 0,
      temporaryHp,
      // Falling unconscious starts death saves afresh.
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      stable: false,
    },
    temporaryAbsorbed,
    hpLost,
    droppedToZero: true,
  };
}

/**
 * A creature taken to 0 hit points by a sentence rather than by a blow.
 *
 * SRD Sea Hag, Death Glare: "If the target has 20 Hit Points or fewer, **it
 * drops to 0 Hit Points**."
 *
 * **The tail of {@link applyDamageToVitals} with the damage taken out of it**,
 * which is precisely what the sentence describes: the hit points go, the death
 * saves start afresh, Stable is lost, and a creature whose block says it dies
 * the instant it drops does. What is *not* here is everything damage brings —
 * the temporary pool is not spent, because the book says the creature drops
 * rather than that it is hurt; no remainder is measured, because there is no
 * blow to measure one from; and no floor is offered, because SRD Relentless
 * Endurance and SRD Undead Fortitude are each written about a creature being
 * *reduced to 0 Hit Points* by damage. See `hit-points-dropped-to-zero`.
 *
 * **Quiet where there is nothing to do.** A creature already at 0 does not
 * drop again — resetting its death saves would hand it back the failures it
 * has already taken — and the dead are not made deader. Both come back
 * unchanged, and the command reads that back as "nothing happened" rather than
 * writing an event for it.
 *
 * The Unconscious condition is **not** here, for the reason it is not in
 * `applyDamageToVitals` either: conditions are a creature's own state and the
 * command that emits this emits that beside it, through the same
 * `ZERO_HIT_POINTS` source every other drop to 0 uses.
 */
export function dropToZero(v: Vitals): Vitals {
  if (v.dead || v.hp === 0) return v;
  if (v.diesAtZero) return { ...v, hp: 0, dead: true };
  return { ...v, hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0, stable: false };
}

/**
 * SRD: death save counts "are reset to zero when you regain any Hit Points".
 * Healing cannot revive the dead — that needs magic beyond hit points.
 */
export function heal(v: Vitals, amount: number): Vitals {
  // A non-finite amount is programmer error, and silently propagating it turns
  // hit points into NaN — which then compares false against every threshold,
  // so a creature is neither alive nor dead.
  if (!Number.isFinite(amount)) {
    throw new Error(`healing must be a finite number, got ${amount}`);
  }
  if (v.dead || amount <= 0) return v;

  return {
    ...v,
    hp: Math.min(v.hpMax, v.hp + amount),
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    stable: false,
  };
}

/**
 * SRD: Temporary Hit Points don't stack. The rules leave the choice of which
 * set to keep with the player; keeping the larger is the sensible default, and
 * a caller wanting otherwise can set the field directly.
 */
export function grantTemporaryHp(v: Vitals, amount: number): Vitals {
  if (!Number.isFinite(amount)) {
    throw new Error(`temporary hit points must be a finite number, got ${amount}`);
  }
  return { ...v, temporaryHp: Math.max(v.temporaryHp, Math.max(0, amount)) };
}

/** SRD: "A Stable creature doesn't make Death Saving Throws." */
export function stabilize(v: Vitals): Vitals {
  return { ...v, stable: true, deathSaveSuccesses: 0, deathSaveFailures: 0 };
}

export interface DeathSaveOutcome {
  readonly vitals: Vitals;
  readonly roll: RecordedD20;
  readonly success: boolean;
  /** True when a natural 20 brought the creature back to 1 hit point. */
  readonly revived: boolean;
}

/**
 * The outcome rules for a death saving throw, given what was rolled.
 *
 * Separated from the rolling so that live resolution and replay share one
 * implementation. Keeping a second copy in the reducer meant two places could
 * disagree about what a natural 1 costs.
 *
 * `natural` and `total` are both needed: the natural die decides the two
 * special results, while the total decides an ordinary success. A Beacon of
 * Hope advantage changes which die is natural; a bonus changes only the total.
 */
export function resolveDeathSave(
  v: Vitals,
  natural: number,
  total: number = natural,
): { vitals: Vitals; success: boolean; revived: boolean } {
  // SRD: "If you roll a 20 on the d20, you regain 1 Hit Point."
  if (natural === 20) {
    return {
      vitals: { ...v, hp: 1, deathSaveSuccesses: 0, deathSaveFailures: 0, stable: false },
      success: true,
      revived: true,
    };
  }

  // SRD: "When you roll a 1 on the d20 ... you suffer two failures."
  if (natural === 1) {
    const failures = v.deathSaveFailures + 2;
    const dead = failures >= 3;
    return {
      vitals: { ...v, deathSaveFailures: dead ? 0 : failures, dead },
      success: false,
      revived: false,
    };
  }

  // SRD: "Roll 1d20. If the roll is 10 or higher, you succeed." Anything that
  // modifies the roll moves the total, so the comparison is against that.
  if (total >= 10) {
    const successes = v.deathSaveSuccesses + 1;
    // SRD: "On your third success, you become Stable."
    return {
      vitals: successes >= 3 ? stabilize(v) : { ...v, deathSaveSuccesses: successes },
      success: true,
      revived: false,
    };
  }

  const failures = v.deathSaveFailures + 1;
  const dead = failures >= 3;
  return {
    vitals: { ...v, deathSaveFailures: dead ? 0 : failures, dead },
    success: false,
    revived: false,
  };
}

export interface DeathSaveOptions {
  /**
   * Advantage or disadvantage. Beacon of Hope grants advantage on death saves
   * explicitly, so this is not a hypothetical.
   */
  readonly modes?: readonly (RollMode | ModeSource)[];
  /** Named bonuses or penalties that apply to the save. */
  readonly bonuses?: readonly Bonus[];
  /**
   * A face this roller throws again — SRD Luck.
   *
   * An option here where every other D20 Test reads it off the sheet, because
   * a death save is the one roll in the engine made from `Vitals` rather than
   * from a character: it is "not tied to an ability score", so this function
   * is handed no sheet to read it from and the caller passes what the sheet
   * said. See {@link CharacterSheet.rerollsD20On}.
   */
  readonly reroll?: D20Reroll | null;
}

/**
 * SRD: "Whenever you start your turn with 0 Hit Points, you must make a Death
 * Saving Throw... Unlike other saving throws, this one isn't tied to an ability
 * score."
 *
 * No ability modifier and no proficiency — but "not tied to an ability score"
 * is not the same as "unmodifiable". Effects can grant advantage or add to the
 * roll, so this takes the same modes and bonuses as any other D20 Test and
 * simply starts from zero.
 */
export function rollDeathSave(
  issuer: RollIssuer,
  rng: Rng,
  v: Vitals,
  options: DeathSaveOptions = {},
): Result<DeathSaveOutcome> {
  if (v.dead) return err('already_dead', 'a dead creature makes no death saving throws');
  if (!isDown(v)) {
    return err('not_dying', 'death saving throws are only made at 0 hit points');
  }
  if (v.stable) return err('stable', 'a Stable creature makes no death saving throws');

  const modeSources: ModeSource[] = (options.modes ?? []).map((m) =>
    typeof m === 'string' ? { source: 'situational', mode: m } : m,
  );

  const rolled = rollD20Test(
    issuer,
    rng,
    0,
    modeSources,
    options.bonuses ?? [],
    undefined,
    options.reroll ?? null,
  );
  if (!rolled.ok) return rolled;

  const outcome = resolveDeathSave(v, rolled.value.roll.natural, rolled.value.total);

  return ok({ ...outcome, roll: rolled.value.roll });
}

/**
 * SRD Concentration: "If you take damage, you must succeed on a Constitution
 * saving throw to maintain Concentration. The DC equals 10 or half the damage
 * taken (round down), whichever number is higher, up to a maximum DC of 30."
 *
 * The save itself is an ordinary Constitution saving throw — roll it through
 * `rollSavingThrow`, so proficiency, conditions and bonuses all apply normally.
 */
export function concentrationSaveDc(damage: number): number {
  return Math.min(30, Math.max(10, Math.floor(Math.max(0, damage) / 2)));
}
