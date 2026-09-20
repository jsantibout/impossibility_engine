/**
 * What a tool call answers with: four outcomes, and never an exception.
 *
 * `docs/design/claude-integration.md` decided the shape and this is the
 * transcription of it — "Four outcomes on the wire, not three":
 *
 * | Status | Means | Carries |
 * |---|---|---|
 * | `ok` | it happened | the events the call wrote, its resolution, and any `unverified` clauses |
 * | `refused` | the rules say no under facts already established | `code`, `reason` |
 * | `needs-context` | the record is thin; establish the fact and re-send | `code`, `reason`, `establish[]` |
 * | `invalid` | the arguments never reached the engine | `code`, `reason`, `issues[]` |
 *
 * The fourth is the one a three-valued surface loses, and losing it is the
 * expensive mistake: a model that mistyped a field would be told the *rules*
 * said no, and would go looking for a rule to work around. `invalid` is Zod
 * rejecting the call before any engine command runs, and it is **never** a
 * rules refusal — nothing was spent, no die was thrown, and the engine was
 * not asked.
 *
 * `refused` and `needs-context` stay apart for the reason `result.ts` states
 * at length: one closes the question and one is homework. Collapsing them is
 * how a rules engine ends up answering `DOOR NOT CREATED`.
 */

import type { ContextRequest, Err } from '@ie/shared';
import { contextRequestsOf, isNeedsContext } from '@ie/shared';
import type { GameEvent } from '@ie/engine';

export type ContextRequestKind = ContextRequest['kind'];

/**
 * Every kind, written out — and a compile error the day the engine grows one.
 *
 * A `Record` rather than a list, because a list would go stale in silence:
 * the engine adding a kind has to break something here, or "every kind has
 * a door" becomes a claim about the kinds this file happens to remember. A
 * missing key is an error; a key the engine dropped is an excess property.
 */
const KIND_COVERAGE: Readonly<Record<ContextRequestKind, true>> = {
  creature: true,
  position: true,
  visibility: true,
  'creature-type': true,
  side: true,
  scene: true,
  route: true,
  'turn-order': true,
};

/** The same, as a list to iterate. Derived, so the two cannot drift. */
export const CONTEXT_REQUEST_KINDS = Object.keys(KIND_COVERAGE) as readonly ContextRequestKind[];

/**
 * A fact to establish, with the doors on *this* surface that establish it.
 *
 * `satisfyWith` is the engine's own prose and is passed through untouched —
 * whether it should become a tool name instead is an open question the design
 * note records and this batch does not answer. `tools` is the answer to the
 * requirement the note *does* make: "Every `ContextRequest.kind` must map to
 * a tool that declares it — a kind with no door is the failure to test for."
 * It is derived from the definitions rather than written down twice.
 */
export interface Establish {
  readonly kind: ContextRequestKind;
  readonly subject: string;
  readonly need: string;
  readonly because: string;
  readonly satisfyWith: string;
  /** The tools on this surface that declare they establish this kind. */
  readonly tools: readonly string[];
}

/** One thing Zod found wrong with the arguments, addressed to whoever sent them. */
export interface ArgumentIssue {
  /** Dotted path to the field at fault, or `''` for the call as a whole. */
  readonly path: string;
  readonly message: string;
}

export interface OkOutcome {
  readonly status: 'ok';
  /** Exactly what this call appended to the log. Empty for a query or a retry. */
  readonly events: readonly GameEvent[];
  /** What the engine decided, flattened for a caller that speaks JSON. */
  readonly resolution: Readonly<Record<string, unknown>>;
  /** Checks the rules call for that the engine could not make. */
  readonly unverified: readonly string[];
}

export interface RefusedOutcome {
  readonly status: 'refused';
  readonly code: string;
  readonly reason: string;
}

export interface NeedsContextOutcome {
  readonly status: 'needs-context';
  readonly code: string;
  readonly reason: string;
  readonly establish: readonly Establish[];
}

export interface InvalidOutcome {
  readonly status: 'invalid';
  readonly code: 'malformed_arguments' | 'unknown_tool';
  readonly reason: string;
  readonly issues: readonly ArgumentIssue[];
}

export type ToolOutcome = OkOutcome | RefusedOutcome | NeedsContextOutcome | InvalidOutcome;

export const okOutcome = (
  events: readonly GameEvent[],
  resolution: Readonly<Record<string, unknown>>,
  unverified: readonly string[] = [],
): OkOutcome => ({ status: 'ok', events, resolution, unverified });

export const refused = (code: string, reason: string): RefusedOutcome => ({
  status: 'refused',
  code,
  reason,
});

export const invalid = (
  code: InvalidOutcome['code'],
  reason: string,
  issues: readonly ArgumentIssue[] = [],
): InvalidOutcome => ({ status: 'invalid', code, reason, issues });

/**
 * Turn an engine `Err` into the outcome a caller branches on.
 *
 * `isNeedsContext` is the predicate, exactly as the doctrine's table says it
 * should be — never a string match on `code`, which is a growing vocabulary
 * and therefore a thing a caller eventually gets wrong.
 */
export function fromErr(
  error: Err,
  doorsFor: (kind: ContextRequestKind) => readonly string[],
): RefusedOutcome | NeedsContextOutcome {
  if (!isNeedsContext(error)) return refused(error.code, error.reason);
  return {
    status: 'needs-context',
    code: error.code,
    reason: error.reason,
    establish: contextRequestsOf(error).map((request) => ({
      kind: request.kind,
      subject: request.subject,
      need: request.need,
      because: request.because,
      satisfyWith: request.satisfyWith,
      tools: doorsFor(request.kind),
    })),
  };
}
