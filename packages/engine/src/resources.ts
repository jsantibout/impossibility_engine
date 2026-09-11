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

export interface ResourcePool {
  readonly key: string;
  /** How to say it out loud: "level 2 spell slot", "Channel Divinity". */
  readonly label: string;
  readonly max: number;
  readonly spent: number;
  readonly recovers: Recovery;
}

export interface PoolDeclaration {
  readonly key: string;
  readonly label: string;
  readonly max: number;
  readonly recovers: Recovery;
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
  const { key, label, max, recovers } = declaration;

  if (key.trim() === '') return err('bad_key', 'a pool needs a key');
  if (!Number.isInteger(max) || max < 0) {
    return err('bad_max', `a pool's maximum must be a non-negative integer, got ${max}`);
  }
  if (state.pools[key] !== undefined) {
    return err('duplicate_pool', `${key} is already declared`);
  }

  return ok(derive({ ...state.pools, [key]: { key, label, max, spent: 0, recovers } }));
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
    pools[key] = pool.recovers === recovers ? { ...pool, spent: 0 } : pool;
  }
  return derive(pools);
}

const SLOT_PREFIX = 'spell-slot:';

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

/** The level a slot key names, or null if the key is some other pool. */
export function spellSlotLevel(key: string): number | null {
  if (!key.startsWith(SLOT_PREFIX)) return null;
  const level = Number(key.slice(SLOT_PREFIX.length));
  return Number.isInteger(level) && level >= 1 && level <= 9 ? level : null;
}

/** Slot levels with at least one use left, lowest first. */
export function slotLevelsAvailable(state: ResourceState): number[] {
  return Object.values(state.pools)
    .map((pool) => ({ level: spellSlotLevel(pool.key), left: pool.max - pool.spent }))
    .filter((entry): entry is { level: number; left: number } => entry.level !== null && entry.left > 0)
    .map((entry) => entry.level)
    .sort((a, b) => a - b);
}
