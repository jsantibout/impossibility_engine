/**
 * A table the probe can put a model at, and nothing more.
 *
 * This is `scenario.test.ts`'s `table()` helper with its two useful halves
 * kept and its scripting half removed: a log, a fold over it, and a generator
 * rebuilt from state before every roll and written back by whichever command
 * did the rolling. Every engine command emits its own `rolls-issued`, so
 * nothing here has to remember to.
 *
 * There is deliberately no `roll` helper and no way to append an event that a
 * command did not produce. The surface above may only push what an engine
 * operation handed it.
 */

import { SRD_CONTENT } from '@ie/content';
import { type Content, createRollIssuer, type RollIssuer } from '@ie/engine';
import { createRng, restoreRng, type Rng } from '@ie/engine';
import { fold, type GameEvent, type GameState } from '@ie/engine';

export interface Supply {
  readonly issuer: RollIssuer;
  readonly rng: Rng;
  readonly content: Content;
}

export interface Session {
  readonly seed: string;
  state(): GameState;
  log(): readonly GameEvent[];
  /** A generator and a roll issuer resumed from exactly where state says. */
  supply(): Supply;
  /** Append events an engine command produced. */
  push(events: readonly GameEvent[]): void;
}

export function createSession(seed: string, prelude: readonly GameEvent[]): Session {
  let log: readonly GameEvent[] = [...prelude];
  // Folding on every read is what `scenario.test.ts` does and is the honest
  // shape: there is one authoritative state and it is the fold. A cache here
  // would be the first place a probe could diverge from the engine.
  return {
    seed,
    state: () => fold(seed, log),
    log: () => log,
    supply(): Supply {
      const now = fold(seed, log);
      return {
        issuer: createRollIssuer('r', now.rollsIssued),
        rng: now.rng === null ? createRng(seed) : restoreRng(now.rng),
        content: SRD_CONTENT,
      };
    },
    push(events: readonly GameEvent[]): void {
      log = [...log, ...events];
    },
  };
}
