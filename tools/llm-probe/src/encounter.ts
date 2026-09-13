/**
 * What a fight is, as far as the harness is concerned.
 *
 * The harness used to import the tavern directly and know three things about
 * it that were true of that fight and of no other: that there were three
 * combatants, that one of them was Kessa, and that everyone walked at 30 feet.
 * None of those is a property of the *boundary*, which is what the experiment
 * measures, so all three were measuring apparatus masquerading as a fixture.
 *
 * An `Encounter` is the smallest thing that removes them. It is data, not
 * behaviour: no callbacks, no tactics, no policy about what a creature should
 * do on its turn. The harness reads it and the model plays it.
 *
 * **The roster is the initiative roll order, not the turn order.** Initiative
 * is rolled for each of these in sequence and the engine sorts them; listing
 * them in a different order would change which rolls come off the generator in
 * which order, and therefore the fight. It is part of the fixture's identity.
 */

import type { CharacterId } from '@ie/shared';
import type { GameEvent } from '@ie/engine';

export interface Encounter {
  /** Names the run in reports and artifacts. */
  readonly id: string;
  readonly seed: string;
  /** The log as it stands before the model is asked to do anything. */
  readonly prelude: readonly GameEvent[];
  /** Everyone who rolls Initiative, in the order they are rolled for. */
  readonly roster: readonly CharacterId[];
  /**
   * Sides, for the only question the harness asks about them: has one of them
   * run out of creatures who are standing?
   *
   * A list of lists rather than the `side` field on the creatures, because the
   * `thin` fixture deliberately withholds facts and a harness that read the
   * game state to decide when to stop would stop differently depending on how
   * much had been declared. When the fight ends is apparatus, not play.
   */
  readonly sides: readonly (readonly CharacterId[])[];
  /**
   * What each scripted player says, beat by beat.
   *
   * An actor with no entry here is the DM's to run — that is the whole of the
   * distinction, and it generalises from one player to three without the
   * harness learning anything about classes or sides. Scripted because the
   * experiment needs one independent variable: a model improvising the players
   * as well as the DM makes two runs incomparable.
   */
  readonly intents: ReadonlyMap<CharacterId, readonly string[]>;
}
