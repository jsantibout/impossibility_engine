import { err, ok, type Result } from '@ie/shared';

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
}

export interface ResourceState {
  readonly pools: Readonly<Record<string, ResourcePool>>;
}

/**
 * Rebuild the record with its keys sorted.
 *
 * Resource state reaches the event log, and a record whose key order depended
 * on the order pools happened to be declared in would serialise differently
 * for two identical characters — which breaks replay comparison exactly the
 * way an unsorted condition set did.
 */
const derive = (pools: Readonly<Record<string, ResourcePool>>): ResourceState => {
  const sorted: Record<string, ResourcePool> = {};
  for (const key of Object.keys(pools).sort()) {
    const pool = pools[key];
    if (pool !== undefined) sorted[key] = pool;
  }
  return { pools: sorted };
};

export function resourceState(): ResourceState {
  return { pools: {} };
}

export function declarePool(
  state: ResourceState,
  declaration: PoolDeclaration,
): Result<ResourceState> {
  const { key, label, max, recovers, regainsOnShortRest } = declaration;

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
      },
    }),
  );
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

  return ok(derive({ ...state.pools, [key]: { ...pool, spent: pool.spent + amount } }));
}

/** Give uses back, never more than the pool holds. */
export function restore(state: ResourceState, key: string, amount: number): Result<ResourceState> {
  const pool = state.pools[key];
  if (pool === undefined) return err('unknown_pool', `${key} is not a pool this creature has`);
  if (!Number.isInteger(amount) || amount <= 0) {
    return err('bad_amount', `restoring takes a positive integer, got ${amount}`);
  }

  const spent = Math.max(0, pool.spent - amount);
  return ok(derive({ ...state.pools, [key]: { ...pool, spent } }));
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
    if (pool.recovers === recovers) {
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
  return derive(pools);
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
  return ok(derive({ ...state.pools, [key]: { ...pool, max, spent: Math.min(pool.spent, max) } }));
}
