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

export interface DieRoll {
  readonly sides: number;
  readonly value: number;
  /** False for dice dropped by a keep-highest/keep-lowest clause. */
  readonly kept: boolean;
}

export interface RollOutcome {
  readonly notation: Notation;
  /** Every die in the order it was rolled, dropped dice included. */
  readonly dice: readonly DieRoll[];
  readonly modifier: number;
  /** Sum of kept dice plus the modifier. */
  readonly total: number;
}

/** Roll dice notation. Invalid notation is a value, not an exception. */
export function roll(rng: Rng, input: string): Result<RollOutcome> {
  const parsed = parseNotation(input);
  if (!parsed.ok) return parsed;

  const { count, sides, modifier, keep } = parsed.value;

  const values: number[] = [];
  for (let i = 0; i < count; i++) values.push(rng.int(sides));

  const keptIndices = new Set<number>();
  if (keep === null) {
    for (let i = 0; i < count; i++) keptIndices.add(i);
  } else {
    // Sort a copy of the indices, using the index itself to break ties so the
    // choice of which duplicate to drop stays deterministic.
    const order = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => (keep.mode === 'highest' ? b.value - a.value : a.value - b.value) || a.index - b.index);
    for (const { index } of order.slice(0, keep.n)) keptIndices.add(index);
  }

  const dice: DieRoll[] = values.map((value, index) => ({
    sides,
    value,
    kept: keptIndices.has(index),
  }));

  const total = dice.reduce((sum, d) => (d.kept ? sum + d.value : sum), 0) + modifier;

  return ok({ notation: parsed.value, dice, modifier, total });
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
