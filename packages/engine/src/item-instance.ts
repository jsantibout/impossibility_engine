/**
 * The id an engine-issued copy of an item carries, and the order those ids
 * sort in.
 *
 * **A leaf on purpose.** It imports nothing, because two modules that cannot
 * import one another both need it: `state.ts` declares the field it goes in
 * and the fold verifies it, while `positioning.ts` keys the floor by one — and
 * `state.ts` is not something `positioning.ts` may import at run time, since
 * every module `state.ts` names would then be loaded through the module that
 * names it. That was not a theory: it was a `SIGHT_SENSES is not iterable`
 * out of a half-initialised `standing.ts`.
 *
 * `state.ts` re-exports all three, so every caller that had them from there
 * still has them from there.
 */

/** What every item instance id begins with. One spelling, read and written here. */
export const ITEM_INSTANCE_PREFIX = 'item:';

/** The id of the nth copy the engine has issued a record to. */
export const itemInstanceFor = (n: number): string => `${ITEM_INSTANCE_PREFIX}${n}`;

/**
 * The number inside an instance id, for putting copies in the order they were
 * gained.
 *
 * Numerically, for the reason `castingNumber` is: `item:2` was gained before
 * `item:10`, and a string sort would put ten first — which would reorder an
 * inventory, and an inventory that sorts differently on the same log is a
 * state that does not serialise identically.
 */
export const itemInstanceNumber = (instance: string): number =>
  Number(instance.slice(ITEM_INSTANCE_PREFIX.length)) || 0;
