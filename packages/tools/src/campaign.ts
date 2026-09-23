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
 * **And a campaign can be written down**, which is {@link CampaignRecord}: the
 * seed, the log, and a caller-supplied name for the book. A `Content` holds
 * closures and cannot be serialised, so the record carries a `contentRef` the
 * caller chose and this layer derives nothing from — there is no version stamp
 * on a `Content` to derive one *from*, and inventing one here would be a
 * decision about content identity taken in the wrong package. Everything else
 * a session holds is already derived: `GameState` is the fold of the log, and
 * the generator's position rides in the log's own `rolls-issued` events, so a
 * restored campaign throws the next die the live one would have without the
 * record carrying a single number about dice.
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
   * so the discipline is one level up. There are exactly two callers in
   * `definitions.ts`, both passing nothing but a `Result`'s own `events`:
   * `settle`, and `roll_initiative`'s joining branch, which concatenates what
   * two commands returned and appends only once both have succeeded. No tool
   * builds an event of its own, and `boundary.test.ts` counts the call sites
   * so a third has to be argued for.
   *
   * **The third was argued for and is in this file**: {@link restoreCampaign}
   * replays a stored log, which is events an engine command produced on some
   * earlier day rather than events a tool invented today. It is counted too,
   * because a caller in this file was invisible to a guard that skipped it.
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

/**
 * A campaign as something a store can hold: three fields, all JSON.
 *
 * Deliberately not a `GameState`. The state is the fold of the log and a
 * store that kept it would have two answers to one question the day a rule
 * changes; the log is the record and the state is a reading of it.
 */
export interface CampaignRecord {
  /** The seed the campaign was created with. */
  readonly seed: string;
  /**
   * Which book, named by the caller.
   *
   * A `Content` is closures and cannot be written down; a `ContentInput` can,
   * and `loadContent` is the door back. So this is a name the caller chose for
   * the book it built — an SRD version, a homebrew bundle's id, a row key.
   * **Nothing here derives it and nothing here interprets it.** `restoreCampaign`
   * takes the `Content` beside the record rather than looking one up, because
   * this package holds no registry of books and should not learn to.
   */
  readonly contentRef: string;
  /** Everything that has happened, in order. The whole of the history. */
  readonly log: readonly GameEvent[];
}

/**
 * Write a campaign down, at this moment.
 *
 * A snapshot rather than a view: the log is copied, so a record taken
 * mid-session does not grow as the session plays on.
 */
export function serializeCampaign(campaign: Campaign, contentRef: string): CampaignRecord {
  return { seed: campaign.seed, contentRef, log: [...campaign.log()] };
}

export interface RestoreOptions {
  /**
   * The book, rebuilt by the caller from whatever `record.contentRef` names.
   * A campaign restored against a different book is a caller's decision and
   * this function is not the place it is caught — the fold opens no catalogue,
   * so the state comes back the same either way, and what differs is what the
   * *next* command reads.
   */
  readonly content: Content;
  readonly record: CampaignRecord;
}

/**
 * Take a campaign back off the wire.
 *
 * Create with the record's seed and replay its log, which is all a restore
 * is: the state is the fold, and the generator's position is carried by the
 * log's own `rolls-issued` events, so the campaign that comes back throws the
 * next die the one that was stored would have. A log the fold refuses throws
 * `CorruptLogError` out of here rather than handing back half a campaign —
 * that is a programmer error or a corrupted store, and invariant 6 is about
 * what the *rules* refuse, not about a broken record.
 */
export function restoreCampaign(options: RestoreOptions): Campaign {
  const campaign = createCampaign({ content: options.content, seed: options.record.seed });
  campaign.append(options.record.log);
  return campaign;
}
