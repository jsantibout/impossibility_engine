import { err, ok, type Result, type RollMode } from '@ie/shared';

/**
 * Dice.
 *
 * Everything random in InfiniteRealms passes through here, and nothing here
 * touches ambient state — no `Math.random`, no clock. A seeded generator plus a
 * serialisable snapshot is what makes a campaign replayable: given the same
 * seed and the same sequence of intents, the table plays out identically.
 */

/** Serialisable internal state of an {@link Rng}. Safe to store as JSON. */
export type RngState = readonly [number, number, number, number];

export interface Rng {
  /** Uniform integer in `[1, sides]`. */
  int(sides: number): number;
  /** Current state, for persisting and resuming a session mid-combat. */
  snapshot(): RngState;
}

/** Guard rail so a malformed `999999d6` cannot stall the process. */
const MAX_DICE = 1_000;
const MIN_SIDES = 2;
const MAX_SIDES = 1_000;

/** xmur3 — spreads an arbitrary seed string into well-mixed 32-bit words. */
function seedWords(seed: string): [number, number, number, number] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = (): number => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
  return [next(), next(), next(), next()];
}

/**
 * sfc32 — small, fast, and statistically sound for game dice. Chosen over
 * `Math.random` because its entire state is four integers we can write to the
 * event log and restore later.
 */
function makeRng(state: [number, number, number, number]): Rng {
  const s = state;

  const nextFloat = (): number => {
    let a = s[0] | 0;
    let b = s[1] | 0;
    let c = s[2] | 0;
    let d = s[3] | 0;

    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;

    s[0] = a;
    s[1] = b;
    s[2] = c;
    s[3] = d;

    return (t >>> 0) / 4294967296;
  };

  return {
    int(sides: number): number {
      if (!Number.isInteger(sides) || sides < 1) {
        throw new Error(`Rng.int requires a positive integer number of sides, got ${sides}`);
      }
      return Math.floor(nextFloat() * sides) + 1;
    },
    snapshot(): RngState {
      return [s[0], s[1], s[2], s[3]];
    },
  };
}

/** Create a generator from a campaign or encounter seed. */
export function createRng(seed: string | number): Rng {
  const rng = makeRng(seedWords(String(seed)));
  // Discard the first few outputs: sfc32 is weakly mixed immediately after
  // seeding, which shows up as correlated first rolls across similar seeds.
  for (let i = 0; i < 12; i++) rng.int(2);
  return rng;
}

/** Resume a generator from a previously taken {@link RngState}. */
export function restoreRng(state: RngState): Rng {
  if (state.length !== 4 || state.some((n) => !Number.isFinite(n))) {
    throw new Error('restoreRng requires four finite integers');
  }
  return makeRng([state[0], state[1], state[2], state[3]]);
}

export interface Keep {
  readonly mode: 'highest' | 'lowest';
  readonly n: number;
}

export interface Notation {
  readonly count: number;
  readonly sides: number;
  readonly modifier: number;
  readonly keep: Keep | null;
}

const NOTATION = /^(\d*)d(\d+)(?:k([hl])(\d+))?(?:([+-])(\d+))?$/;

/**
 * Parse dice notation: `d20`, `2d6+3`, `1d8-1`, `4d6kh3`, `2d20kl1`.
 * Whitespace and case are ignored.
 */
export function parseNotation(input: string): Result<Notation> {
  const cleaned = input.replace(/\s+/g, '').toLowerCase();
  const m = NOTATION.exec(cleaned);
  if (!m) {
    return err('bad_notation', `"${input}" is not valid dice notation`);
  }

  const [, rawCount, rawSides, keepMode, rawKeepN, sign, rawMod] = m;

  const count = rawCount === '' ? 1 : Number(rawCount);
  if (count < 1) {
    return err('bad_notation', `"${input}" must roll at least one die`);
  }
  if (count > MAX_DICE) {
    return err('too_many_dice', `"${input}" exceeds the ${MAX_DICE} die limit`);
  }

  const sides = Number(rawSides);
  if (sides < MIN_SIDES || sides > MAX_SIDES) {
    return err('bad_notation', `a die must have between ${MIN_SIDES} and ${MAX_SIDES} sides`);
  }

  let keep: Keep | null = null;
  if (keepMode !== undefined && rawKeepN !== undefined) {
    const n = Number(rawKeepN);
    if (n < 1) {
      return err('bad_notation', `"${input}" must keep at least one die`);
    }
    if (n > count) {
      return err('bad_notation', `"${input}" keeps ${n} dice but only rolls ${count}`);
    }
    keep = { mode: keepMode === 'h' ? 'highest' : 'lowest', n };
  }

  const magnitude = rawMod === undefined ? 0 : Number(rawMod);
  const modifier = sign === '-' ? -magnitude : magnitude;

  return ok({ count, sides, modifier, keep });
}

/**
 * The lowest and highest totals a notation can produce.
 *
 * Used to sanity-check a roll reported from outside the engine: someone at a
 * real table cannot roll 30 on a `1d4`, so a claimed physical roll outside
 * these bounds is a transcription error worth rejecting.
 */
export function notationBounds(notation: Notation): { min: number; max: number } {
  const dice = notation.keep?.n ?? notation.count;
  return {
    min: dice * 1 + notation.modifier,
    max: dice * notation.sides + notation.modifier,
  };
}

export type DieDisposition =
  /** Contributes its value to the total. */
  | 'counted'
  /** Removed by a keep-highest or keep-lowest clause. */
  | 'dropped'
  /** Replaced by a later die, and no longer counted. */
  | 'rerolled';

export type DieOrigin =
  | 'initial'
  /** Added by an effect that triggers on a value, e.g. Sorcerous Burst. */
  | 'bonus'
  /** Rolled to replace an earlier die. */
  | 'reroll';

/**
 * A single die, individually addressable.
 *
 * Several rules operate on one die rather than on the total — Great Weapon
 * Fighting reads each damage die, Sorcerous Burst reacts to an individual 8,
 * Empowered Spell rerolls a chosen few. So a die records what it physically
 * showed, what it counts as, where it came from, and what became of it.
 */
export interface DieRoll {
  /** Position in the roll, stable and usable to name this die for a reroll. */
  readonly index: number;
  readonly sides: number;
  /** What the die physically showed. */
  readonly rolled: number;
  /** What it counts as — differs from `rolled` when an effect substitutes. */
  readonly value: number;
  readonly disposition: DieDisposition;
  readonly origin: DieOrigin;
  /** The effect that produced or altered this die. */
  readonly cause: string | null;
  /** Index of the die this one replaced, for a reroll. */
  readonly replaces: number | null;
}

/**
 * A rule that acts on individual dice as they land.
 *
 * The SRD has three distinct shapes here and they compose differently, so they
 * are modelled separately rather than as one "modify the die" hook:
 *
 * - **Substitution** changes what a die counts as without changing what it
 *   showed. Great Weapon Fighting treats a 1 or 2 as a 3 — note the 2024
 *   wording, which substitutes where the 2014 rules rerolled.
 * - **Bonus dice** add a die when one shows a trigger value. Sorcerous Burst
 *   adds a d8 for every 8, capped at the spellcasting ability modifier.
 * - **Rerolls** replace a die entirely, and are applied afterwards by
 *   {@link rerollDice}, because the rules that use them let a player choose
 *   which dice to reroll.
 */
export interface DieEffect {
  readonly name: string;
  /** Map what the die showed to what it counts as. */
  readonly substitute?: (rolled: number, sides: number) => number;
  /** Whether this die triggers an extra die of the same size. */
  readonly bonusOn?: (rolled: number, sides: number) => boolean;
  /** Cap on bonus dice this effect may add to a single roll. */
  readonly maxBonusDice?: number;
}

/**
 * Treat any die showing `threshold` or less as `replacement`.
 *
 * Great Weapon Fighting (2024): `treatLowRollsAs(2, 3, 'Great Weapon Fighting')`.
 */
export function treatLowRollsAs(
  threshold: number,
  replacement: number,
  name: string,
): DieEffect {
  return {
    name,
    substitute: (rolled) => (rolled <= threshold ? replacement : rolled),
  };
}

/**
 * Add another die of the same size whenever one shows its maximum.
 *
 * Sorcerous Burst: `explodeOnMax(spellcastingModifier, 'Sorcerous Burst')`. The
 * added dice can themselves trigger more, since the spell reacts to any 8
 * rolled for it, but never past the cap.
 */
export function explodeOnMax(maxBonusDice: number, name: string): DieEffect {
  return {
    name,
    bonusOn: (rolled, sides) => rolled === sides,
    maxBonusDice,
  };
}

export interface RollOutcome {
  readonly notation: Notation;
  /** Every die in the order it was rolled — dropped and rerolled ones included. */
  readonly dice: readonly DieRoll[];
  readonly modifier: number;
  /** Sum of the counted dice plus the modifier. */
  readonly total: number;
}

const sumCounted = (dice: readonly DieRoll[], modifier: number): number =>
  dice.reduce((sum, d) => (d.disposition === 'counted' ? sum + d.value : sum), modifier);

/** Run every effect's substitution over a rolled value, in order. */
function substituted(effects: readonly DieEffect[], rolled: number, sides: number): number {
  let value = rolled;
  for (const effect of effects) {
    if (effect.substitute) value = effect.substitute(value, sides);
  }
  return value;
}

/**
 * Roll dice notation, optionally with per-die effects.
 *
 * On keep clauses: a keep-highest or keep-lowest applies only to the dice the
 * notation asked for, never to bonus dice an effect added. The two are not
 * expected to meet in practice — keep is for ability scores, effects are for
 * damage — but the precedence is defined rather than accidental.
 */
export function roll(
  rng: Rng,
  input: string,
  effects: readonly DieEffect[] = [],
): Result<RollOutcome> {
  const parsed = parseNotation(input);
  if (!parsed.ok) return parsed;

  const { count, sides, modifier, keep } = parsed.value;

  const dice: DieRoll[] = [];
  const bonusesByEffect = new Map<string, number>();

  const rollOne = (origin: DieOrigin, cause: string | null): void => {
    const rolled = rng.int(sides);
    dice.push({
      index: dice.length,
      sides,
      rolled,
      value: substituted(effects, rolled, sides),
      disposition: 'counted',
      origin,
      cause,
      replaces: null,
    });
  };

  for (let i = 0; i < count; i++) rollOne('initial', null);

  // Walked as a growing list so a bonus die can itself trigger another, which
  // is what "if you roll an 8 on a d8 for this spell" means for the dice the
  // spell added. The per-effect cap is what terminates it.
  for (let i = 0; i < dice.length; i++) {
    const die = dice[i]!;
    for (const effect of effects) {
      if (effect.bonusOn?.(die.rolled, sides) !== true) continue;
      const used = bonusesByEffect.get(effect.name) ?? 0;
      if (used >= (effect.maxBonusDice ?? 0)) continue;
      bonusesByEffect.set(effect.name, used + 1);
      rollOne('bonus', effect.name);
    }
  }

  if (keep !== null) {
    const initial = dice.filter((d) => d.origin === 'initial');
    // Sort by value, using the index to break ties so which duplicate gets
    // dropped stays deterministic.
    const order = [...initial].sort(
      (a, b) =>
        (keep.mode === 'highest' ? b.value - a.value : a.value - b.value) || a.index - b.index,
    );
    for (const die of order.slice(keep.n)) {
      dice[die.index] = { ...die, disposition: 'dropped' };
    }
  }

  return ok({ notation: parsed.value, dice, modifier, total: sumCounted(dice, modifier) });
}

/**
 * Reroll named dice, replacing them with new ones.
 *
 * The rules that reroll damage dice let the player pick which — Empowered Spell
 * rerolls "a number of the damage dice up to your Charisma modifier" — so the
 * caller names them rather than the engine matching a predicate. Rerolled dice
 * stay in the list marked `rerolled`, so the log still shows what was given up.
 */
export function rerollDice(
  rng: Rng,
  outcome: RollOutcome,
  indices: readonly number[],
  cause: string,
  effects: readonly DieEffect[] = [],
): Result<RollOutcome> {
  const dice = [...outcome.dice];

  for (const index of indices) {
    const die = dice[index];
    if (die === undefined) {
      return err('unknown_die', `this roll has no die at index ${index}`);
    }
    if (die.disposition === 'rerolled') {
      return err('already_rerolled', `die ${index} has already been rerolled`);
    }

    dice[index] = { ...die, disposition: 'rerolled' };

    const rolled = rng.int(die.sides);
    dice.push({
      index: dice.length,
      sides: die.sides,
      rolled,
      value: substituted(effects, rolled, die.sides),
      // A reroll inherits what it replaced, so rerolling a die a keep clause
      // had already dropped does not smuggle it back into the total.
      disposition: die.disposition === 'dropped' ? 'dropped' : 'counted',
      origin: 'reroll',
      cause,
      replaces: index,
    });
  }

  return ok({ ...outcome, dice, total: sumCounted(dice, outcome.modifier) });
}

export interface D20Outcome {
  /** One die at normal, two under advantage or disadvantage, in roll order. */
  readonly rolls: readonly number[];
  /** The die actually used after applying advantage or disadvantage. */
  readonly natural: number;
  readonly mode: RollMode;
  readonly modifier: number;
  readonly total: number;
  readonly isCriticalHit: boolean;
  readonly isCriticalMiss: boolean;
}

/**
 * The d20 test that underpins every check, save and attack roll.
 *
 * Critical hits and misses key off the natural die, never the modified total —
 * a +9 rogue rolling a natural 1 still fumbles.
 */
export function rollD20(rng: Rng, mode: RollMode, modifier: number): D20Outcome {
  const rolls = mode === 'normal' ? [rng.int(20)] : [rng.int(20), rng.int(20)];

  const natural =
    mode === 'advantage'
      ? Math.max(...rolls)
      : mode === 'disadvantage'
        ? Math.min(...rolls)
        : rolls[0]!;

  return {
    rolls,
    natural,
    mode,
    modifier,
    total: natural + modifier,
    isCriticalHit: natural === 20,
    isCriticalMiss: natural === 1,
  };
}
