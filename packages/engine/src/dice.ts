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

/**
 * A rule read over a **whole roll** rather than over one die at a time.
 *
 * {@link DieEffect}'s sibling and the other scope a rule can have. Every
 * member of that interface is handed `(rolled, sides)` — one die, in isolation
 * — which is the right shape for a substitution, an explosion and a chosen
 * reroll, and cannot express a sentence about the roll as a whole. SRD Savage
 * Attacker is that sentence: "you can roll the weapon's damage dice **twice**
 * and use either roll against the target", where what is compared is two
 * totals and not two faces.
 *
 * A closed vocabulary with one member, which is the rule every closed
 * vocabulary in this engine follows: an arm arrives with the sentence that
 * writes it. The next one this reader will be asked for is SRD Chromatic Orb's
 * "if you roll the same number on two or more of the d8s" — a *predicate* over
 * a roll rather than a second throw of it — and it is deliberately not here,
 * because its consequence is a second attack out of one casting and the
 * trigger alone would fire at nothing.
 */
export type RollRule = {
  /**
   * SRD Savage Attacker: roll the dice twice, keep one of the two totals.
   *
   * **The higher, and the choice is barely one.** The book says "use either
   * roll", so the decision is the player's — but the two rolls are of the same
   * dice against the same target with nothing else riding on which is taken,
   * so the higher is the only answer a player has a reason to give. Asking the
   * caller which would be a question with one sensible answer and a second way
   * for a replay to diverge. Both throws reach the log either way: the dice
   * that lost are `dropped` rather than discarded, exactly as a keep clause's
   * are, so the record shows what was given up.
   */
  readonly kind: 'roll-twice-keep-either';
  /** The feature that stated the rule, for the log. */
  readonly name: string;
};

/**
 * Roll notation under a rule about the whole roll, or under none.
 *
 * `rule === null` is {@link roll} exactly, which is what lets a caller pass
 * what it gathered without branching on whether it gathered anything.
 */
export function rollUnder(
  rng: Rng,
  input: string,
  rule: RollRule | null,
  effects: readonly DieEffect[] = [],
): Result<RollOutcome> {
  if (rule === null) return roll(rng, input, effects);

  const first = roll(rng, input, effects);
  if (!first.ok) return first;
  // The second throw is made before either is judged, so a rule that reaches
  // this point always moves the generator by the same amount — a replay of the
  // same log reproduces both throws whichever one it ends up counting.
  const second = roll(rng, input, effects);
  if (!second.ok) return second;

  // A tie keeps the first, which is arbitrary and therefore stated: two equal
  // totals are the same number, and the only thing that could differ is which
  // dice the log calls counted.
  const keepFirst = first.value.total >= second.value.total;
  const offset = first.value.dice.length;

  const drop = (die: DieRoll): DieRoll =>
    die.disposition === 'counted' ? { ...die, disposition: 'dropped' } : die;

  const dice: DieRoll[] = [
    ...first.value.dice.map((die) => (keepFirst ? die : drop(die))),
    ...second.value.dice.map((die) => {
      // Reindexed onto the end of the first throw's dice, so `index` stays
      // what it promises — a position in *this* roll, usable to name the die —
      // and `replaces` still points at the die it was derived from.
      const moved: DieRoll = {
        ...die,
        index: offset + die.index,
        // The second throw exists because of the rule, so the rule is what
        // caused these dice. The first throw's are what the swing would have
        // thrown anyway and keep whatever cause they already had.
        cause: die.cause ?? rule.name,
        replaces: die.replaces === null ? null : offset + die.replaces,
      };
      return keepFirst ? drop(moved) : moved;
    }),
  ];

  return ok({
    notation: first.value.notation,
    dice,
    modifier: first.value.modifier,
    total: sumCounted(dice, first.value.modifier),
  });
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
 * What a set of d20 faces comes to under a mode.
 *
 * **Its own function because two callers read the same faces.** {@link rollD20}
 * throws them, and `rollD20Recorded` throws one of them *again* for SRD Luck
 * and has to settle the pair a second time — so the mode, the total and the
 * two critical faces are derived here and nowhere else. Two copies of this
 * would be two answers to "which die counted", and the day one of them learns
 * a Champion's lowered critical face is the day the other is quietly wrong for
 * rerolled rolls alone.
 */
export function settleD20(
  rolls: readonly number[],
  mode: RollMode,
  modifier: number,
): D20Outcome {
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

/**
 * The d20 test that underpins every check, save and attack roll.
 *
 * Critical hits and misses key off the natural die, never the modified total —
 * a +9 rogue rolling a natural 1 still fumbles.
 */
export function rollD20(rng: Rng, mode: RollMode, modifier: number): D20Outcome {
  return settleD20(
    mode === 'normal' ? [rng.int(20)] : [rng.int(20), rng.int(20)],
    mode,
    modifier,
  );
}

/**
 * Which of the faces thrown is the one the mode counted.
 *
 * Ties go to the first, which is {@link settleD20}'s own reading of a mode —
 * `Math.max` of two 14s is the first 14. A rule that replaces "the d20 of a
 * D20 Test" needs to know which die that was, and this is the one place it is
 * decided.
 */
export function countedDieIndex(outcome: D20Outcome): number {
  return outcome.rolls.indexOf(outcome.natural);
}
