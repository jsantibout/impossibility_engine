import { err, ok, type Result } from '@ie/shared';
import type { Rng } from './dice.js';
import { rollD20Recorded, type RecordedD20, type RollIssuer } from './rolls.js';

/**
 * Hit points, temporary hit points, death saving throws, and the arithmetic of
 * dying.
 *
 * Rules verified against SRD 5.2.1 (see ATTRIBUTION.md).
 */

export interface Vitals {
  readonly hp: number;
  readonly hpMax: number;
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
  return {
    hp: hpMax,
    hpMax,
    temporaryHp: 0,
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    stable: false,
    dead: false,
    diesAtZero: false,
    ...over,
  };
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
}

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
  if (isDown(v)) {
    // SRD: "If the damage equals or exceeds your Hit Point maximum, you die."
    if (toHp >= v.hpMax && toHp > 0) {
      return {
        ...unchanged,
        vitals: { ...v, temporaryHp, stable: false, dead: true },
        temporaryAbsorbed,
        died: true,
        cause: 'damage at 0 hit points equalling the hit point maximum',
      };
    }

    const added = toHp > 0 ? (options.critical === true ? 2 : 1) : 0;
    const failures = v.deathSaveFailures + added;
    const dead = failures >= 3;

    return {
      ...unchanged,
      vitals: {
        ...v,
        temporaryHp,
        // SRD: "If the creature takes damage, it stops being Stable."
        stable: added > 0 ? false : v.stable,
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

  // SRD Monster Death: a monster dies the instant it drops to 0.
  if (v.diesAtZero) {
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
 * SRD: death save counts "are reset to zero when you regain any Hit Points".
 * Healing cannot revive the dead — that needs magic beyond hit points.
 */
export function heal(v: Vitals, amount: number): Vitals {
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
 * SRD: "Whenever you start your turn with 0 Hit Points, you must make a Death
 * Saving Throw... Unlike other saving throws, this one isn't tied to an ability
 * score."
 *
 * So no ability modifier and no proficiency — the die stands alone.
 */
export function rollDeathSave(
  issuer: RollIssuer,
  rng: Rng,
  v: Vitals,
): Result<DeathSaveOutcome> {
  if (v.dead) return err('already_dead', 'a dead creature makes no death saving throws');
  if (!isDown(v)) {
    return err('not_dying', 'death saving throws are only made at 0 hit points');
  }
  if (v.stable) return err('stable', 'a Stable creature makes no death saving throws');

  const roll = rollD20Recorded(issuer, rng, 'normal', 0);

  // SRD: "If you roll a 20 on the d20, you regain 1 Hit Point."
  if (roll.natural === 20) {
    return ok({
      vitals: { ...v, hp: 1, deathSaveSuccesses: 0, deathSaveFailures: 0, stable: false },
      roll,
      success: true,
      revived: true,
    });
  }

  // SRD: "When you roll a 1 on the d20 ... you suffer two failures."
  if (roll.natural === 1) {
    const failures = v.deathSaveFailures + 2;
    const dead = failures >= 3;
    return ok({
      vitals: { ...v, deathSaveFailures: dead ? 0 : failures, dead },
      roll,
      success: false,
      revived: false,
    });
  }

  const success = roll.total >= 10;

  if (success) {
    const successes = v.deathSaveSuccesses + 1;
    // SRD: "On your third success, you become Stable."
    return ok({
      vitals: successes >= 3 ? stabilize(v) : { ...v, deathSaveSuccesses: successes },
      roll,
      success: true,
      revived: false,
    });
  }

  const failures = v.deathSaveFailures + 1;
  const dead = failures >= 3;
  return ok({
    vitals: { ...v, deathSaveFailures: dead ? 0 : failures, dead },
    roll,
    success: false,
    revived: false,
  });
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
