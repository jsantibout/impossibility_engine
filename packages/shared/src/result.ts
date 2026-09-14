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

/**
 * A fact the engine needs before it can resolve, and how to supply it.
 *
 * The structured half of a `needs-context` refusal. `reason` is always there
 * and is always enough for a person to read; this is for the cases where the
 * engine can say precisely *what* is missing and *which event* would settle
 * it, so an orchestrator can fix it without parsing prose.
 *
 * Addressed to the orchestrator, never to a player. "Sorry, that creature has
 * no position" is the engine's problem leaking out as the game's — the layer
 * that sees this places the creature and asks again, and the table never
 * learns a round trip happened.
 */
export interface ContextRequest {
  /**
   * What sort of fact is missing. This is the field a tool surface branches
   * on; the strings below are for whoever is reading.
   *
   * `creature` is the one that was missing for longest: the most common
   * `needs-context` in the engine is a creature it has never been told about,
   * and it carried no request at all.
   *
   * `route` is the odd one and worth naming as such: every other kind is
   * satisfied by **declaring a fact** through some command of its own, and
   * this one is satisfied by **re-sending the same command with a field
   * filled in**. `satisfyWith` says which, as it does for all of them. The
   * fact is still a fact — which spaces a thing passed through is not
   * something the engine may decide — and the asker is still the orchestrator
   * rather than a player.
   *
   * `turn-order` is the fact a *moment in the turn order* needs before it
   * means anything. SRD Ray of Frost reduces a Speed "until the start of your
   * next turn", and outside combat there is no such turn — so the conversion
   * refuses, and it must go on refusing, because calling that moment six
   * seconds is the one mistake the whole two-type duration split exists to
   * prevent. What had been wrong was who the refusal was addressed to: a
   * cantrip that cannot be cast in a corridor is a hole the layer above cannot
   * repair unless it is told what would repair it. The engine does not start
   * the fight, roll Initiative or invent an order — it says which command
   * would, and the caller casts again exactly as it meant to.
   */
  readonly kind:
    | 'creature'
    | 'position'
    | 'visibility'
    | 'creature-type'
    | 'scene'
    | 'route'
    | 'turn-order';
  /** Who the missing fact is about. */
  readonly subject: string;
  /** What is missing, in plain terms. */
  readonly need: string;
  /** Which rule wanted it. */
  readonly because: string;
  /** The event or command that would establish it. */
  readonly satisfyWith: string;
}

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err = {
  readonly ok: false;
  readonly reason: string;
  readonly code: string;
  readonly kind: ErrKind;
  /**
   * Exactly what to establish, when the engine can be that precise.
   *
   * Only ever present on a `needs-context` refusal, and optional even there:
   * most thin-record cases are one missing creature and the reason says so.
   */
  readonly requests?: readonly ContextRequest[];
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
export const needsContext = (
  code: string,
  reason: string,
  requests?: readonly ContextRequest[],
): Err => ({
  ok: false,
  code,
  reason,
  kind: 'needs-context',
  ...(requests === undefined || requests.length === 0 ? {} : { requests }),
});

/** Whether this refusal is homework rather than a verdict. */
export const isNeedsContext = (r: Result<unknown>): boolean =>
  !r.ok && r.kind === 'needs-context';

/** What a `needs-context` refusal wants established, or nothing. */
export const contextRequestsOf = (r: Result<unknown>): readonly ContextRequest[] =>
  !r.ok && r.kind === 'needs-context' ? (r.requests ?? []) : [];

export const isOk = <T>(r: Result<T>): r is Ok<T> => r.ok;
export const isErr = <T>(r: Result<T>): r is Err => !r.ok;

/** Unwrap for call sites that have already proven the result is Ok. */
export function expect<T>(r: Result<T>, context: string): T {
  if (!r.ok) throw new Error(`${context}: ${r.code} — ${r.reason}`);
  return r.value;
}
