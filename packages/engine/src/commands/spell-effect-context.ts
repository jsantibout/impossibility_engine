/**
 * What every per-kind resolver reads, and the type that names one arm of the
 * effect union.
 *
 * **A leaf on purpose.** `spell-resolution.ts` builds the context and the
 * resolver modules consume it, so if this stayed there every resolver module
 * would import the module that imports it. That cycle survives compilation
 * only because a type is erased — which is not an acyclic graph, it is one
 * whose failure has been deferred to whichever module happens to load first.
 * Making it a leaf both modules import is the graph the value-graph script
 * checks and reports.
 */

import { type CharacterId } from '@ie/shared';
import { type CreatureState, type GameEvent } from '../events.js';
import { type Placement, type Point } from '../positioning.js';
import { type SpellDefinition, type SpellEffect } from '../spell-definitions.js';
import { type CastingRoute } from '../spellcasting.js';
import { type CastingNumbers } from '../spells.js';
import { type Supply } from './casting.js';
import { type SpellTargetOutcome } from './targeting.js';

/**
 * Everything a per-kind resolver reads, gathered once before the loop.
 *
 * `resolveEffects` was one function with a branch per effect kind, and every
 * branch reached the same dozen bindings out of the enclosing scope. Naming
 * them once is what lets each kind be its own function without any of them
 * growing a parameter list of its own — and what makes the *difference*
 * between two kinds visible, because a resolver destructures exactly what its
 * rule reads and nothing else.
 *
 * **The three mutable members are mutable on purpose.** `events`, `outcomes`
 * and `held` are the resolution’s running record, appended to by whichever
 * kind is being resolved and read afterwards by the `spell-ongoing` record and
 * the return; `unverified` is the same thing for what the casting could not
 * check. They are shared arrays rather than returned values because that is
 * exactly what they were as closed-over locals, and a split that changed it
 * would be a behaviour change wearing a refactor’s clothes.
 *
 * **The world is not in here.** It is threaded through the loop instead — each
 * resolver takes the state its predecessors left and returns the state it
 * leaves — because the order effects are applied in is the loop’s business and
 * a mutable `current` on a shared object would hide it.
 */
export interface EffectContext {
  readonly casterId: CharacterId;
  /** Null when the casting has outlived its caster. */
  readonly caster: CreatureState | null;
  /** The caster’s sheet, loud rather than absent when there is none. */
  readonly casterSheet: () => CreatureState;
  readonly definition: SpellDefinition;
  readonly castLevel: number;
  /** Null for a later use, which rolls with {@link EffectContext.numbers}. */
  readonly route: CastingRoute | null;
  /** The numbers this casting was made with, pinned at the cast. */
  readonly numbers: CastingNumbers;
  readonly attackModifier: number;
  readonly saveDc: number;
  readonly supply: Supply;
  readonly castingId: string;
  /** How the log reads, when an activation wants its own wording. */
  readonly label: string;
  /** Where the spell acts **from**, when that is not the caster’s own space. */
  readonly from?: Point;
  /**
   * Which creatures the caster or their allies are fighting, where the spell
   * asks. Absent for every spell that does not print the clause; **empty where
   * the caster answered "none of them"**, which is not the same thing.
   */
  readonly fought?: readonly CharacterId[];
  /**
   * Where a `teleport` effect puts its target.
   *
   * Stated at the casting and refused there when a teleporting spell names
   * none, so a resolver reaching here without one is the definition and the
   * command layer disagreeing rather than a rules dispute — see
   * {@link resolveTeleportEffect}.
   */
  readonly teleportTo?: Placement;
  /**
   * The casting a Reaction spell answers, by id.
   *
   * Resolved before anything was spent, by the same function the trigger check
   * read, and looked up again here on the state this resolution has folded its
   * own events into — so the interruption settles the casting the trigger
   * accepted rather than whichever one happens to be open now.
   */
  readonly answers?: string;
  /** What the casting could not check, appended to as it resolves. */
  readonly unverified: string[];
  /** The batch being built. Appended to by every resolver. */
  readonly events: GameEvent[];
  /** What the casting did, target by target. */
  readonly outcomes: SpellTargetOutcome[];
  /** Whom this casting has left something of its own on — see `landedOn`. */
  readonly held: Set<CharacterId>;
}

/** One arm of the effect union, by its `kind`. */
export type EffectOfKind<K extends SpellEffect['kind']> = Extract<SpellEffect, { kind: K }>;
