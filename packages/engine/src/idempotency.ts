import { err, ok, type Result } from '@ie/shared';
import type { AppliedCommand, CommandStamp, GameState } from './events.js';

/**
 * Command identity: how a retry is told apart from a second command.
 *
 * This sits **below** the command layer rather than inside it, because it is
 * not a rule about any particular operation. `rest.ts` needed it and reached
 * *upwards* into `commands.ts` to get it — the one import that spoiled an
 * otherwise acyclic value graph, and the kind of edge that turns into a cycle
 * the first time the command layer wants something a rest knows.
 */

/**
 * An idempotency key.
 *
 * Retry-safety has two halves and only one of them is free. A pure command
 * gives identical events from identical state — but a caller retrying after
 * its batch was already applied is looking at *updated* state, where casting
 * again is a genuine second casting that spends a second slot and rolls a
 * second save. An id is what tells those two situations apart.
 *
 * The same id means the same command, and the engine holds callers to that:
 * the inputs are fingerprinted alongside the id, and reusing an id for
 * different work is refused rather than silently swallowed. A silent no-op
 * there would be the worst of both worlds — the second command never runs and
 * nobody is told.
 */
export interface CommandIdentity {
  readonly commandId?: string;
}

/**
 * Serialise for comparison, with object keys sorted at every level.
 *
 * Two callers building the same command need the same fingerprint whatever
 * order they happened to write the fields in.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : inner,
  );
}

export type Identified =
  | { readonly duplicate: true }
  | { readonly duplicate: false; readonly stamp: CommandStamp | null };

/**
 * Decide whether a command has already landed, and refuse a recycled id.
 *
 * The kind carries both the operation and the creature it acts on, so two
 * commands cannot collide on one id by having the same field names or by
 * being the same command aimed at somebody else. Either collision would
 * silently swallow the second command, which is the outcome this exists to
 * prevent.
 */
export function identify<T extends CommandIdentity>(
  state: GameState,
  kind: string,
  command: T,
): Result<Identified> {
  const id = command.commandId;
  if (id === undefined) return ok({ duplicate: false, stamp: null });

  const fingerprint = `${kind}|${stableStringify(command)}`;
  const prior = state.appliedCommands[id];

  if (prior === undefined) return ok({ duplicate: false, stamp: { id, fingerprint } });
  if (prior.fingerprint !== fingerprint) {
    return err(
      'command_id_reused',
      `command id ${id} has already been applied with different inputs; a command id names one command, not a slot to reuse`,
    );
  }
  return ok({ duplicate: true });
}

/** Whether a command id has already been applied to this state. */
export function wasCommandApplied(state: GameState, commandId: string): boolean {
  return state.appliedCommands[commandId] !== undefined;
}

/**
 * What a command produced, or null if it has not been applied.
 *
 * A retried casting returns no events, but the caller may still need the
 * casting id to link that spell's effects — so the outcome is recoverable
 * rather than lost with the empty batch.
 */
export function commandOutcome(state: GameState, commandId: string): AppliedCommand | null {
  return state.appliedCommands[commandId] ?? null;
}

/**
 * Run a command's body once, however many times the command is sent.
 *
 * **The duplicate check comes first**, and this is that sentence made
 * structural. It had been discipline: every command opened with `identify`,
 * a refusal written above it read perfectly well, and this file records eight
 * separate occasions on which one was — `triggerRefusal`, six unstamped
 * commands, the `casting_pending` guard, the `damage_pending` and
 * `test_pending` pair, `resolveSpell`'s half-dozen refusals, and the
 * `not_ongoing` refusal a route that ended its own casting met. Every one is
 * the same shape: *a retry looks at the world its first run made*, and is told
 * about that world instead of being told its command already landed.
 *
 * A guard cannot be written above the duplicate check here, because there is
 * nowhere above it to write one: the body does not run at all until `identify`
 * has answered, and the answer a replay gets is the one written beside the
 * identity rather than a hundred lines further down.
 *
 * `replayed` is a thunk rather than a value so that a command whose replay
 * answer has to be recovered — the casting id `commandOutcome` remembers —
 * builds it only when it is wanted.
 *
 * **Both callbacks are `NoInfer`**, so `R` comes from the command's own
 * declared return type and neither branch can quietly widen it. Inferring
 * from the arguments instead would let the replay answer and the resolved
 * answer settle on two different shapes and check each against itself, which
 * is the opposite of what a command's signature is for: the two answers a
 * caller may receive are the same type or the command is lying about one.
 */
export function once<T extends CommandIdentity, R>(
  state: GameState,
  kind: string,
  inputs: T,
  replayed: () => NoInfer<R>,
  run: (stamp: CommandStamp | null) => Result<NoInfer<R>>,
): Result<R> {
  const identity = identify(state, kind, inputs);
  if (!identity.ok) return identity;
  if (identity.value.duplicate) return ok(replayed());
  return run(identity.value.stamp);
}
