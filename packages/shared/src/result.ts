/**
 * The engine never throws for a rules-legal refusal. An illegal action is a
 * value the DM has to narrate around ("you're out of third-level slots"),
 * which is exactly the behaviour we want at the table. Exceptions are reserved
 * for programmer error.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err = { readonly ok: false; readonly reason: string; readonly code: string };
export type Result<T> = Ok<T> | Err;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = (code: string, reason: string): Err => ({ ok: false, code, reason });

export const isOk = <T>(r: Result<T>): r is Ok<T> => r.ok;
export const isErr = <T>(r: Result<T>): r is Err => !r.ok;

/** Unwrap for call sites that have already proven the result is Ok. */
export function expect<T>(r: Result<T>, context: string): T {
  if (!r.ok) throw new Error(`${context}: ${r.code} — ${r.reason}`);
  return r.value;
}
