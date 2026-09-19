import { err, ok, type Err, type Result } from '@ie/shared';
import { parseNotation } from './dice.js';

/**
 * Limited-use pools: spell slots, Channel Divinity, Ki, Second Wind, the
 * charges on a wand.
 *
 * Spell slots are the reason this exists, but they are not special-cased. A
 * pool is a name, a maximum, a count spent, and what refills it — which is all
 * a slot is, and all a Bardic Inspiration die is.
 *
 * **Pools are declared, never derived.** The engine does not know that a level
 * 3 Wizard has four level 1 slots and two level 2 slots: that is a class
 * table, and class progression is not modelled. Whoever builds the character
 * declares the pools; this module only spends and restores them. Keeping the
 * two apart is what lets a monster with three uses of a breath weapon, a magic
 * item with seven charges, and a Wizard's slots all be the same mechanism.
 *
 * **A key is a name and nothing here reads inside one.** That is what lets an
 * item's charges be kept per *copy* — `wand-of-secrets:charges@item:3` — so
 * two wands in one pack are two pools, without this module ever learning that
 * copies of a thing exist.
 */

/** What refills a pool. Rests are not implemented yet; the tag still records intent. */
export type Recovery = 'short-rest' | 'long-rest' | 'dawn' | 'special';

/**
 * Which of the two slot pools a slot comes from.
 *
 * SRD keeps Pact Magic out of the combined Multiclass Spellcaster table, so a
 * Warlock's slots are a second pool with its own recovery. It is not a
 * restriction on what they may pay for: "you can use the spell slots you gain
 * from Pact Magic to cast spells you have prepared from classes with the
 * Spellcasting feature, and you can use the spell slots you gain from the
 * Spellcasting feature to cast Warlock spells you have prepared."
 */
export type SlotKind = 'spell' | 'pact';

export interface ResourcePool {
  readonly key: string;
  /** How to say it out loud: "level 2 spell slot", "Channel Divinity". */
  readonly label: string;
  readonly max: number;
  readonly spent: number;
  readonly recovers: Recovery;
  /**
   * Uses this pool gives back on a **Short** Rest without emptying.
   *
   * SRD writes it five times in the same words — Rage, both Channel
   * Divinities, Wild Shape, Second Wind: "You regain one expended use when you
   * finish a Short Rest, and you regain all expended uses when you finish a
   * Long Rest." The `recovers` tag beside it is all-or-nothing and cannot say
   * that, and tagging these `short-rest` instead would hand a level 1 Fighter
   * their whole Second Wind back after every breather.
   *
   * A number rather than a flag because the SRD writes a number, and because a
   * flag would be a rule that could only ever mean one.
   */
  readonly regainsOnShortRest?: number;
  /**
   * What a **dawn** gives back, instead of a refill: dice, or a stated number.
   *
   * SRD writes it forty-four times across the magic items and never once as
   * "all" and a number together: the Wand of Secrets "regains 1d3 expended
   * charges daily at dawn", the Staff of Power "2d8 + 4". The `recovers` tag
   * beside it is all-or-nothing and cannot say that, and `regainsOnShortRest`
   * cannot either, because that one is a Short Rest's clause.
   *
   * **Mostly dice, and sometimes a number.** Rod of Resurrection prints "The
   * rod regains 1 expended charge daily at dawn", which is neither a die nor a
   * refill — and leaving the field off is not neutral, because a `dawn` pool
   * with no dice is refilled by the tag and the rod would give back five every
   * morning where the book gives one. So a bare positive integer is read as
   * the number it is: {@link statedDawnAmount} says which of the two a string
   * is, `declareDawn` throws no die for a stated one and the generator does
   * not move.
   *
   * Either way the number is the engine's (`declareDawn`), never a caller's to
   * supply. A pool carrying this is left alone by `restoreOn`: this line is
   * the whole of its recovery, so refilling it as well would hand back
   * everything and then roll for it.
   */
  readonly regainsAtDawn?: string;
}

export interface PoolDeclaration {
  readonly key: string;
  readonly label: string;
  readonly max: number;
  readonly recovers: Recovery;
  /**
   * Uses this pool gives back on a **Short** Rest without emptying.
   *
   * SRD writes it five times in the same words — Rage, both Channel
   * Divinities, Wild Shape, Second Wind: "You regain one expended use when you
   * finish a Short Rest, and you regain all expended uses when you finish a
   * Long Rest." The `recovers` tag beside it is all-or-nothing and cannot say
   * that, and tagging these `short-rest` instead would hand a level 1 Fighter
   * their whole Second Wind back after every breather.
   *
   * A number rather than a flag because the SRD writes a number, and because a
   * flag would be a rule that could only ever mean one.
   */
  readonly regainsOnShortRest?: number;
  /**
   * What a dawn gives back instead of a refill, as dice or as a stated number
   * — see {@link ResourcePool.regainsAtDawn}.
   */
  readonly regainsAtDawn?: string;
}

/**
 * A count with **no size**: a pool's sibling, and the other thing the SRD
 * counts.
 *
 * A pool is a count with a ceiling and running out of it is a *refusal* — "you
 * are out of level 3 spell slots". A tally is a count with no ceiling at all,
 * and what reads it multiplies rather than permits: SRD Wind Fan's "each
 * subsequent time the fan is used before the next dawn, it has a cumulative 20
 * percent chance of not working", Augury's "a cumulative 25 percent chance for
 * each casting after the first", Potion of Longevity's 10 percent.
 *
 * **The distinction is semantic rather than bureaucratic.** A pool of six would
 * make the seventh use of the fan a refusal, and the book has the sixth roll at
 * 100 percent and tear the fan into tatters. A pool refuses; a tally only
 * counts, and what the number means belongs to whoever reads it.
 *
 * Everything else is the pool's machinery reused. The tag is the same
 * {@link Recovery}, so the `resources-restored` event a rest and a declared
 * dawn already emit zeroes one; and a use is counted through the same
 * `resource-spent` event a pool is spent through, which is what keeps "the fan
 * was waved a third time" out of the `GameEvent` union as a member of its own.
 *
 * **There is no declaration.** A pool is declared because its size is a fact
 * somebody has to state; a tally has no size and nothing to state, so it
 * springs into existence the first time something is counted and carries its
 * tag from that first use. That is also what lets a *spell* have one — nothing
 * could have declared a tally for every spell a caster might cast twice.
 */
export interface Tally {
  readonly key: string;
  /** How many times, since the last recovery that answered for it. */
  readonly count: number;
  readonly recovers: Recovery;
}

export interface ResourceState {
  readonly pools: Readonly<Record<string, ResourcePool>>;
  /**
   * Counts with no ceiling, keyed the way pools are — see {@link Tally}.
   *
   * Kept beside the pools rather than among them: `remaining`, `resize` and
   * `slotLevelsAvailable` all answer for a maximum, and a sizeless member of
   * that record would be a pool answering `NaN` to every one of them.
   */
  readonly tallies: Readonly<Record<string, Tally>>;
}

/**
 * Rebuild the record with its keys sorted.
 *
 * Resource state reaches the event log, and a record whose key order depended
 * on the order pools happened to be declared in would serialise differently
 * for two identical characters — which breaks replay comparison exactly the
 * way an unsorted condition set did.
 */
const derive = (
  pools: Readonly<Record<string, ResourcePool>>,
  tallies: Readonly<Record<string, Tally>> = {},
): ResourceState => {
  const sorted: Record<string, ResourcePool> = {};
  for (const key of Object.keys(pools).sort()) {
    const pool = pools[key];
    if (pool !== undefined) sorted[key] = pool;
  }
  // The tallies for the same reason and by the same rule: they reach state,
  // and a record whose key order depended on the order things happened to be
  // used in would serialise two ways for one history.
  const counted: Record<string, Tally> = {};
  for (const key of Object.keys(tallies).sort()) {
    const tally = tallies[key];
    if (tally !== undefined) counted[key] = tally;
  }
  return { pools: sorted, tallies: counted };
};

export function resourceState(): ResourceState {
  return { pools: {}, tallies: {} };
}

export function declarePool(
  state: ResourceState,
  declaration: PoolDeclaration,
): Result<ResourceState> {
  const { key, label, max, recovers, regainsOnShortRest, regainsAtDawn } = declaration;

  if (key.trim() === '') return err('bad_key', 'a pool needs a key');
  if (!Number.isInteger(max) || max < 0) {
    return err('bad_max', `a pool's maximum must be a non-negative integer, got ${max}`);
  }
  if (state.pools[key] !== undefined) {
    return err('duplicate_pool', `${key} is already declared`);
  }

  if (
    regainsOnShortRest !== undefined &&
    (!Number.isInteger(regainsOnShortRest) || regainsOnShortRest <= 0)
  ) {
    return err(
      'bad_partial_recovery',
      `a Short Rest gives back a positive whole number of uses, got ${regainsOnShortRest}`,
    );
  }

  const dawn = dawnRollProblem(regainsAtDawn, recovers);
  if (dawn !== null) return dawn;

  return ok(
    derive({
      ...state.pools,
      [key]: {
        key,
        label,
        max,
        spent: 0,
        recovers,
        ...(regainsOnShortRest === undefined ? {} : { regainsOnShortRest }),
        ...(regainsAtDawn === undefined ? {} : { regainsAtDawn }),
      },
    }, state.tallies),
  );
}

/**
 * The number a dawn recovery states outright, or null where it prints dice.
 *
 * One reading of the string, in one place, because three callers ask: the
 * validator, the pool's own declaration, and `declareDawn`, which must know
 * whether to throw a die or hand back what the line says. A positive whole
 * number and nothing else — "0" is not a recovery and "-1" is not a number a
 * pool gives back, and both fall through to the dice reading, which refuses
 * them by name.
 */
export const statedDawnAmount = (regainsAtDawn: string): number | null => {
  const stated = regainsAtDawn.trim();
  if (!/^\d+$/.test(stated)) return null;
  const amount = Number(stated);
  return amount > 0 ? amount : null;
};

/**
 * What is wrong with a dawn recovery, or null.
 *
 * Exported because `checkContent` asks the same question of an item's charge
 * grant before any pool exists, and two copies of "is this dice or a number,
 * and does this pool even see a dawn" would be two places to answer it
 * differently.
 */
export function dawnRollProblem(
  regainsAtDawn: string | undefined,
  recovers: Recovery,
): Err | null {
  if (regainsAtDawn === undefined) return null;
  // A recovery for a dawn this pool never sees is one that never happens,
  // which is the quiet kind of wrong: the pool looks recharging and is not.
  if (recovers !== 'dawn') {
    return err(
      'dawn_roll_without_dawn',
      `a pool that regains ${regainsAtDawn} at dawn recovers at dawn, not on a ${recovers}`,
    );
  }
  // SRD Rod of Resurrection: "regains 1 expended charge daily at dawn". A
  // stated number is a complete answer, and the one thing dice cannot say.
  if (statedDawnAmount(regainsAtDawn) !== null) return null;
  const notation = parseNotation(regainsAtDawn);
  if (!notation.ok) {
    return err(
      'bad_dawn_roll',
      `"${regainsAtDawn}" is neither dice nor a number of uses: ${notation.reason}`,
    );
  }
  return null;
}

/**
 * Take a pool off one creature, **as it stands**.
 *
 * The half of a transfer nothing else could do: `declarePool` starts a pool at
 * nothing spent, which is right for a pool that is coming into existence and
 * wrong for one that is changing hands — a wand given away with one charge
 * left arrives with one charge left, and that is the whole of what keying a
 * pool to the copy bought. So the record travels whole, `spent` included, and
 * the two halves are separate functions because they land on two creatures.
 *
 * A pool nobody has is a refusal rather than an empty answer: the fold turns
 * it into a corrupt log, because a transfer naming a pool that is not there is
 * a log contradicting itself.
 */
export function detachPool(
  state: ResourceState,
  key: string,
): Result<{ readonly pool: ResourcePool; readonly state: ResourceState }> {
  const pool = state.pools[key];
  if (pool === undefined) return err('unknown_pool', `${key} is not a pool this creature has`);
  const pools = { ...state.pools };
  delete pools[key];
  return ok({ pool, state: derive(pools, state.tallies) });
}

/** The other half: put a pool on a creature exactly as it was taken off. */
export function attachPool(state: ResourceState, pool: ResourcePool): Result<ResourceState> {
  if (state.pools[pool.key] !== undefined) {
    return err('duplicate_pool', `${pool.key} is already declared`);
  }
  return ok(derive({ ...state.pools, [pool.key]: pool }, state.tallies));
}

export function hasPool(state: ResourceState, key: string): boolean {
  return state.pools[key] !== undefined;
}

/** How many uses are left. A pool nobody declared has none, rather than throwing. */
export function remaining(state: ResourceState, key: string): number {
  const pool = state.pools[key];
  return pool === undefined ? 0 : pool.max - pool.spent;
}

/**
 * Spend from a pool.
 *
 * Running out is a rules-legal refusal the DM narrates around — "you're out of
 * third-level slots" — not an exception, and it leaves the pool untouched.
 */
export function spend(state: ResourceState, key: string, amount = 1): Result<ResourceState> {
  const pool = state.pools[key];
  if (pool === undefined) return err('unknown_pool', `${key} is not a pool this creature has`);
  if (!Number.isInteger(amount) || amount <= 0) {
    return err('bad_amount', `spending takes a positive integer, got ${amount}`);
  }
  if (pool.max - pool.spent < amount) {
    return err('exhausted', `${pool.label} has ${pool.max - pool.spent} left, needed ${amount}`);
  }

  return ok(derive({ ...state.pools, [key]: { ...pool, spent: pool.spent + amount } }, state.tallies));
}

/** Give uses back, never more than the pool holds. */
export function restore(state: ResourceState, key: string, amount: number): Result<ResourceState> {
  const pool = state.pools[key];
  if (pool === undefined) return err('unknown_pool', `${key} is not a pool this creature has`);
  if (!Number.isInteger(amount) || amount <= 0) {
    return err('bad_amount', `restoring takes a positive integer, got ${amount}`);
  }

  const spent = Math.max(0, pool.spent - amount);
  return ok(derive({ ...state.pools, [key]: { ...pool, spent } }, state.tallies));
}

/**
 * How many times this has been counted, since whatever last answered for it.
 *
 * A tally nobody has counted has been used no times, rather than throwing —
 * the answer {@link remaining} gives for a pool nobody declared, and the reason
 * a first use needs nothing to exist before it.
 */
export function tallied(state: ResourceState, key: string): number {
  return state.tallies[key]?.count ?? 0;
}

/**
 * Count one more use — see {@link Tally}.
 *
 * **It cannot run out**, which is the whole of why it is not a pool: there is
 * no maximum to refuse against, and whoever reads the count decides what a high
 * one costs. The fan tears at 100 percent because the fan's own line says so,
 * not because this said no.
 *
 * **The tag arrives with the use**, because nothing declares a tally. Restating
 * it every time is what makes the log self-describing — a replay reads what
 * zeroes this count off the very event that created it — and a *different* tag
 * for a key that already has one is refused rather than taken: a count
 * answering to two recoveries would be emptied by whichever came first, which
 * is a rule nobody wrote.
 *
 * A key that names a pool is refused for the neighbouring reason. A key is a
 * name and nothing reads inside one, so the only thing that can keep a spend
 * and a use apart is that one name never means both.
 */
export function tally(
  state: ResourceState,
  key: string,
  recovers: Recovery,
  amount = 1,
): Result<ResourceState> {
  if (key.trim() === '') return err('bad_key', 'a tally needs a key');
  if (!Number.isInteger(amount) || amount <= 0) {
    return err('bad_amount', `counting takes a positive integer, got ${amount}`);
  }
  if (state.pools[key] !== undefined) {
    return err(
      'pool_not_a_tally',
      `${key} is a pool of this creature's, which is spent rather than counted`,
    );
  }

  const held = state.tallies[key];
  if (held !== undefined && held.recovers !== recovers) {
    return err(
      'tally_recovers_otherwise',
      `${key} is counted until a ${held.recovers} and this use says a ${recovers}; one count answers to one recovery`,
    );
  }

  return ok(
    derive(state.pools, {
      ...state.tallies,
      [key]: { key, count: (held?.count ?? 0) + amount, recovers },
    }),
  );
}

/**
 * Refill every pool that recovers on the given event, and nothing else.
 *
 * SRD: "Finishing a Long Rest restores any expended spell slots." A Short Rest
 * does not, which is exactly the distinction the tag carries.
 */
export function restoreOn(state: ResourceState, recovers: Recovery): ResourceState {
  const pools: Record<string, ResourcePool> = {};
  for (const [key, pool] of Object.entries(state.pools)) {
    // A pool that regains a *rolled* number at dawn is not refilled by one.
    // SRD: "The wand has 3 charges and regains 1d3 expended charges daily at
    // dawn" — the roll is the whole of its recovery, and only the engine may
    // produce the number, so `declareDawn` gives it back as a
    // `resource-regained` and this leaves it alone.
    if (pool.recovers === recovers && pool.regainsAtDawn === undefined) {
      pools[key] = { ...pool, spent: 0 };
      continue;
    }
    // SRD Rage, Channel Divinity, Wild Shape, Second Wind: "You regain **one**
    // expended use when you finish a Short Rest, and you regain **all**
    // expended uses when you finish a Long Rest." The second half is the tag
    // above; this is the first, and it never empties the pool.
    if (recovers === 'short-rest' && pool.regainsOnShortRest !== undefined) {
      pools[key] = { ...pool, spent: Math.max(0, pool.spent - pool.regainsOnShortRest) };
      continue;
    }
    pools[key] = pool;
  }

  // **And every tally the same tag answers for, zeroed rather than reduced.**
  // SRD Wind Fan counts "before the next dawn" and Augury "before finishing a
  // Long Rest": both are a count that starts again, and neither has a partial
  // half for `regainsOnShortRest` to be about. A tally at zero is a tally that
  // has not happened, so it is dropped rather than kept at nothing —
  // {@link tallied} cannot tell the two apart, and a record that grew a line
  // for every key ever counted would carry a history nothing reads.
  const tallies: Record<string, Tally> = {};
  for (const [key, counted] of Object.entries(state.tallies)) {
    if (counted.recovers !== recovers) tallies[key] = counted;
  }
  return derive(pools, tallies);
}

const SLOT_PREFIX = 'spell-slot:';

/**
 * Pact Magic slots are a *second* pool, not more of the first.
 *
 * SRD Multiclassing keeps them out of the combined Spellcaster table and then
 * lets each be spent on the other's spells. Merging them would invent a slot
 * for a Warlock 3 / Wizard 3 — both have level 2 slots, and the character has
 * four rather than two — and it would get the recovery wrong in both
 * directions, because Pact Magic comes back on a Short Rest and Spellcasting
 * does not.
 */
const PACT_PREFIX = 'pact-slot:';

/**
 * The pool key for a spell slot level.
 *
 * Cantrips are level 0 and are cast without a slot, so there is no level 0
 * pool — asking for one is a programmer error rather than a rules dispute.
 */
export function spellSlotKey(level: number): string {
  if (!Number.isInteger(level) || level < 1 || level > 9) {
    throw new Error(`spell slots run from level 1 to 9, got ${level}`);
  }
  return `${SLOT_PREFIX}${level}`;
}

/** The pool key for a Pact Magic slot of this level. */
export function pactSlotKey(level: number): string {
  if (!Number.isInteger(level) || level < 1 || level > 9) {
    throw new Error(`spell slots run from level 1 to 9, got ${level}`);
  }
  return `${PACT_PREFIX}${level}`;
}

/** The key for a slot of this level, from either pool. */
export function slotKeyOf(kind: SlotKind, level: number): string {
  return kind === 'pact' ? pactSlotKey(level) : spellSlotKey(level);
}

/** The level a slot key names, or null if the key is some other pool. */
export function spellSlotLevel(key: string): number | null {
  return levelAfter(key, SLOT_PREFIX);
}

/** The level a Pact Magic slot key names, or null if it is some other pool. */
function pactSlotLevel(key: string): number | null {
  return levelAfter(key, PACT_PREFIX);
}

const levelAfter = (key: string, prefix: string): number | null => {
  if (!key.startsWith(prefix)) return null;
  const level = Number(key.slice(prefix.length));
  return Number.isInteger(level) && level >= 1 && level <= 9 ? level : null;
};

/** Slot levels with at least one use left, lowest first, from either pool. */
export function slotLevelsAvailable(state: ResourceState): number[] {
  return Object.values(state.pools)
    .map((pool) => ({
      level: spellSlotLevel(pool.key) ?? pactSlotLevel(pool.key),
      left: pool.max - pool.spent,
    }))
    .filter((entry): entry is { level: number; left: number } => entry.level !== null && entry.left > 0)
    .map((entry) => entry.level)
    .filter((level, index, all) => all.indexOf(level) === index)
    .sort((a, b) => a - b);
}

/**
 * Change a pool's maximum, leaving what has been spent alone.
 *
 * Levelling up grows Hit Dice and spell slots. Re-declaring the pool would
 * reset it, handing back everything the character had already used — which is
 * the kind of quiet refund nobody notices until a boss fight.
 */
export function resize(state: ResourceState, key: string, max: number): Result<ResourceState> {
  const pool = state.pools[key];
  if (pool === undefined) return err('unknown_pool', `${key} is not a pool this creature has`);
  if (!Number.isInteger(max) || max < 0) {
    return err('bad_max', `a pool's maximum must be a non-negative integer, got ${max}`);
  }
  return ok(
    derive({ ...state.pools, [key]: { ...pool, max, spent: Math.min(pool.spent, max) } }, state.tallies),
  );
}
