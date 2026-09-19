/**
 * The session boundary: one `Campaign` per content and log.
 *
 * Decided in `docs/design/claude-integration.md` and implemented here, not
 * re-argued. A campaign owns three things and nothing else — the seed, the
 * validated {@link Content}, and the event log:
 *
 * - **`GameState` is a derived cache**, stepped by `applyEvent` rather than
 *   refolded, because stepping and refolding are the same function. That they
 *   agree is not assumed: `boundary.test.ts` holds the cache equal to
 *   `fold(seed, log)` after every call it makes.
 * - **No live `Rng` or `RollIssuer` is held.** Both are rebuilt per call from
 *   `state.rng` and `state.rollsIssued` and thrown away. That is what makes a
 *   refusal free: the generator a refused command never used is discarded with
 *   it, so the next call throws the die the refused one would have.
 * - **The only non-determinism is the seed**, drawn once when the campaign is
 *   created. Supply one and the same calls produce the same log, forever.
 *
 * Persisting the log is deliberately out of scope — a `Content` holds
 * closures, so what a later batch stores is the `ContentInput`, and that
 * decision has not been made.
 */

import type { Content, GameEvent, GameState, Rng, RollIssuer } from '@ie/engine';
import { applyEvent, createRng, createRollIssuer, fold, restoreRng } from '@ie/engine';

/**
 * What a command that rolls is handed.
 *
 * Structurally the engine's own `Supply`; named here so this package states
 * the shape it builds rather than importing a name for a three-field object.
 */
export interface Supply {
  readonly issuer: RollIssuer;
  readonly rng: Rng;
  readonly content: Content;
}

export interface Campaign {
  /** Drawn once, at creation. The whole of the non-determinism. */
  readonly seed: string;
  /** The book this campaign is played out of. */
  readonly content: Content;
  /** The authoritative state, as a cache that equals `fold(seed, log())`. */
  state(): GameState;
  /** Everything that has happened, in order. */
  log(): readonly GameEvent[];
  /** A generator and a roll issuer resumed from exactly where state says. */
  supply(): Supply;
  /**
   * Append events an engine command produced.
   *
   * The campaign cannot check that — it is handed events and folds them —
   * so the discipline is one level up. There are exactly two callers, both
   * in `definitions.ts` and both passing nothing but a `Result`'s own
   * `events`: `settle`, and `roll_initiative`'s joining branch, which
   * concatenates what two commands returned and appends only once both have
   * succeeded. No tool builds an event of its own, and `boundary.test.ts`
   * counts the call sites so a third has to be argued for.
   */
  append(events: readonly GameEvent[]): void;
}

export interface CampaignOptions {
  readonly content: Content;
  /**
   * Supply one to make the campaign reproducible; omit one and a fresh one is
   * drawn. A test supplies one; a table does not.
   */
  readonly seed?: string;
}

/** A seed nobody chose. The one place this package reaches for randomness. */
export const drawSeed = (): string => crypto.randomUUID();

export function createCampaign(options: CampaignOptions): Campaign {
  const seed = options.seed ?? drawSeed();
  const content = options.content;
  const events: GameEvent[] = [];
  let cached: GameState = fold(seed, []);

  return {
    seed,
    content,
    state: () => cached,
    log: () => events,
    supply(): Supply {
      return {
        issuer: createRollIssuer('r', cached.rollsIssued),
        rng: cached.rng === null ? createRng(seed) : restoreRng(cached.rng),
        content,
      };
    },
    append(written: readonly GameEvent[]): void {
      for (const event of written) {
        events.push(event);
        cached = applyEvent(cached, event);
      }
    },
  };
}
