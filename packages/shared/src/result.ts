/**
 * The engine never throws for a rules-legal refusal. An illegal action is a
 * value the DM has to narrate around ("you're out of third-level slots"),
 * which is exactly the behaviour we want at the table. Exceptions are reserved
 * for programmer error.
 */
/**
 * Why a command said no, and it is not one question but two.
 *
 * | | |
 * |---|---|
 * | `refusal` | The rules say no under facts that are **established**. Nothing the caller can declare will change the answer: the slot is spent, the weapon is not owned, it is not your turn. |
 * | `needs-context` | The *record* is thin. The engine has never been told about this creature, or where it is standing. Establish the fact and ask again. |
 *
 * The distinction is the whole difference between a usable runtime for an AI
 * Dungeon Master and an obstructive one. **Absence from structured state is not
 * evidence that something does not exist.** A player swinging at the chandelier
 * rope is not doing something impossible; they are doing something the engine
 * has not been told about, and the correct answer is "tell me about the rope",
 * not "there is no rope". Collapsing the two into one error shape is how a
 * rules engine ends up answering `DOOR NOT CREATED — INVALID OBJECT`.
 *
 * It is a field rather than a naming convention on `code` because the caller
 * that has to branch on it is a language model's tool surface, and asking that
 * layer to string-match a growing vocabulary of codes is asking it to get it
 * wrong eventually.
 */
export type ErrKind = 'refusal' | 'needs-context';

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err = {
  readonly ok: false;
  readonly reason: string;
  readonly code: string;
  readonly kind: ErrKind;
};
export type Result<T> = Ok<T> | Err;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/**
 * The rules say no, under facts already established.
 *
 * The default, because most refusals are this: a caller that does not think
 * about which kind it is producing should produce the one that closes the
 * question rather than the one that invites a retry, or a mistake becomes an
 * orchestrator loop.
 */
export const err = (code: string, reason: string): Err => ({
  ok: false,
  code,
  reason,
  kind: 'refusal',
});

/**
 * The record is thin: go and establish the fact, then ask again.
 *
 * Nothing was spent, no die was thrown, and the same command repeated after the
 * fact is declared is the command the caller meant the first time. `reason`
 * says what to declare, because this is addressed to the orchestrator and never
 * to a player — "sorry, that creature has no position" is the engine's problem
 * leaking out as the game's.
 */
export const needsContext = (code: string, reason: string): Err => ({
  ok: false,
  code,
  reason,
  kind: 'needs-context',
});

/** Whether this refusal is homework rather than a verdict. */
export const isNeedsContext = (r: Result<unknown>): boolean =>
  !r.ok && r.kind === 'needs-context';

export const isOk = <T>(r: Result<T>): r is Ok<T> => r.ok;
export const isErr = <T>(r: Result<T>): r is Err => !r.ok;

/** Unwrap for call sites that have already proven the result is Ok. */
export function expect<T>(r: Result<T>, context: string): T {
  if (!r.ok) throw new Error(`${context}: ${r.code} — ${r.reason}`);
  return r.value;
}
