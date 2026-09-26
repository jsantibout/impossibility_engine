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

import { type Ability, type CharacterId } from '@ie/shared';
import { type CatalogueItem } from '../catalogue.js';
import { type CreatureState, type GameEvent } from '../events.js';
import { type Placement, type Point } from '../positioning.js';
import { type SpellDefinition, type SpellEffect } from '../spell-definitions.js';
import { type CastingRoute } from '../spellcasting.js';
import { type CastingNumbers } from '../spells.js';
import { type Supply } from './casting.js';
import { type CastingAlterations } from './rolls.js';
import { type SpellTargetOutcome } from './targeting.js';

/**
 * What is resolving this effect list: a casting, an item that confers without
 * casting one, or a feature spending a use of its own pool.
 *
 * SRD "Magic Items" prints the first fork in one sentence — "Many items, such
 * as Potions, **bypass the casting of a spell** and confer the spell's effects
 * with its usual duration" — and this is that sentence as a type. Each arm
 * carries what only that origin has: a casting has an identity and a
 * definition, an item has a catalogue entry, and a feature has neither and is
 * named by the id the class printed it under.
 *
 * **The casting is absent rather than faked**, in both of the arms that have
 * none. An arm that carried a made-up `cast:N` would put a casting in the log
 * that nothing cast, would make `ongoing` answerable for a potion, and would
 * offer Dispel Magic a casting to end. `castingIdOf` matches `cast:N` and
 * nothing else, so `releaseCasting`, `releaseOnTarget`, `ongoingSpellsOn`,
 * `spellOn` and the Dispel resolver all pass over both by construction — which
 * is a guarantee about the string rather than a list of places that were
 * remembered.
 *
 * **The feature arm differs from the item arm in exactly one thing, and it is
 * the numbers.** An item's DC is printed on the item and is the same in an
 * archmage's hand; a feature's is "your spell save DC", derived from the sheet
 * of whoever holds the feature. So the third arm exists rather than an item
 * arm with a feature id in it: the fork is what the numbers are read off.
 */
export type EffectOrigin =
  | {
      readonly kind: 'casting';
      readonly castingId: string;
      readonly definition: SpellDefinition;
    }
  | { readonly kind: 'item'; readonly item: CatalogueItem }
  | {
      readonly kind: 'feature';
      /** The feature's own id, which `featureSource` turns into the source. */
      readonly feature: string;
      /** What the log calls what happened — SRD's "Turn Undead". */
      readonly name: string;
    };

/** The casting arm of {@link EffectOrigin}, named once. */
export type CastingOrigin = Extract<EffectOrigin, { kind: 'casting' }>;

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
  /** What is resolving this list — see {@link EffectOrigin}. */
  readonly origin: EffectOrigin;
  /**
   * The casting this is, **loud rather than absent when it is not one**.
   *
   * {@link casterSheet}'s pattern, for the same reason and with the same
   * consequence. Two rules need the casting itself rather than a name or a
   * source: a condition instance is welded to a casting in the fold, and the
   * riders a settled outcome carries hang off one. So the kinds that impose a
   * condition or settle a D20 Test call this — and every one of them is
   * refused on an item by `checkContent` before any content is loaded. Arriving
   * here from an item is therefore the validator and the resolver disagreeing,
   * which is a bug in this repository rather than a rules dispute.
   */
  readonly casting: () => CastingOrigin;
  /**
   * The name the log reads this effect's work under: the spell's, or the
   * item's.
   *
   * What a resolver reaching for `definition.name` always actually wanted —
   * what to call the thing that happened — which is why it is a field rather
   * than a dereference through {@link origin} that only one arm answers.
   */
  readonly name: string;
  /**
   * The level the dice scale from: the spell's own, or `CONFERRED_LEVEL` for
   * an item, whose printed line is the same whoever uses it.
   */
  readonly level: number;
  /**
   * What everything this hangs on a creature is filed under.
   *
   * `Hold Person#cast:3` from a casting and `item:potion-of-heroism` from an
   * item — one string, derived once by the loop and the only thing that can
   * later take the grant away. Every standalone resolver that hangs something
   * reads this; what still writes `castingSource` by hand is
   * `spell-effect-riders.ts`, whose two helpers take their context as
   * parameters rather than through an {@link EffectContext} and are reached
   * only from a casting.
   */
  readonly source: string;
  /**
   * Every creature this resolution is running over, **in the order the caller
   * named them**.
   *
   * A resolver is handed one target at a time, which is right for every kind
   * but one: SRD Scorching Ray's three rays and Eldritch Blast's beams are
   * several rolls out of one casting, and "you can hurl them at one target
   * within range or at several" is a fact about the list rather than about any
   * creature in it. So the list is here, and `resolveAttackEffect` reads its
   * own share off it.
   *
   * **The order is load-bearing and is the caller's**, not the engine's: it is
   * how a caster says two rays at the ogre and one at the goblin. An area
   * spell's list arrives sorted, because there nobody named anybody and a
   * casting that folded differently for two spellings of the same set would
   * not be replayable.
   */
  readonly targets: readonly CharacterId[];
  /**
   * How many of this casting's attack rolls each of {@link targets} takes,
   * **aligned to that list by position**.
   *
   * The caster's own split, where they stated one — SRD's "at one target
   * within range or at several" with the lopsided middle said out loud. Absent
   * where they said nothing, and then `rollsDealtTo` deals them round the list
   * exactly as it always has.
   *
   * A vector rather than a second list of ids, because the ids are already
   * here in {@link targets} and a casting that named a creature twice is the
   * thing this shape exists to avoid. Validated once, at the casting, by
   * `rollsAimedAt`, and pinned onto a declaration so a held casting settles
   * the split it was declared with.
   */
  readonly rollsPerTarget?: readonly number[];
  readonly castLevel: number;
  /**
   * The level of the **slot that paid** for this casting, where one did.
   *
   * Beside {@link castLevel} and not the same question: a wand's Fireball, a
   * Ritual and a free casting a feature bought all have a cast level and spent
   * no slot, and SRD Disciple of Life asks about the slot. Read off the
   * `spell-cast` event the casting emitted rather than derived a second time,
   * so the two cannot disagree about what was expended.
   */
  readonly slotLevel?: number;
  /** Null for a later use, which rolls with {@link EffectContext.numbers}. */
  readonly route: CastingRoute | null;
  /**
   * The spellcasting ability this casting rolls its own D20 Tests with.
   *
   * **An ability rather than a number**, which is why it is not in
   * {@link EffectContext.numbers}: SRD Dispel Magic rolls "an ability check
   * using your spellcasting ability", and the ability decides the roll's modes
   * and which conditions fail it outright as well as its modifier.
   *
   * The *chosen* source's — a class's, a feat's, or for a casting from an item
   * whichever of the wielder's the item's line or the spell's asked for. Null
   * only where the casting has none at all, which every spell that reads this
   * refuses at the route before anything is spent — see `castersAbilityRead`
   * in `spell-definitions.ts`.
   */
  readonly ability: Ability | null;
  /** The numbers this casting was made with, pinned at the cast. */
  readonly numbers: CastingNumbers;
  /**
   * What the caster's own features are doing to this casting's damage.
   *
   * The fourth mutable member, and mutable for the same reason the other three
   * are: SRD writes "add your Charisma modifier to **one** damage roll of that
   * spell", so the first roll that takes the addend has to be able to tell the
   * rest that it is gone. `NO_ALTERATIONS()` for every run that is not a
   * casting being made — a conferral, an activation, an area settling a minute
   * later — because each of those is a moment the five features do not reach.
   */
  readonly alters: CastingAlterations;
  readonly attackModifier: number;
  readonly saveDc: number;
  readonly supply: Supply;
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
   * Whether the caster was outdoors in a storm when this casting was made.
   *
   * SRD Call Lightning is the one spell that asks, and `DiceScaling.plusInAStorm`
   * is the one reader: the extra die it prints is added wherever this casting
   * rolls its damage. Absent for every other casting, which is the book's own
   * default — the spell makes a cloud of its own and the storm is the exception.
   */
  readonly inAStorm?: true;
  /**
   * Castings a **successful saving throw** of this run ended — SRD Detect
   * Thoughts' and SRD Phantasmal Force's "On a successful save, the spell ends."
   *
   * **The fact and not the event**, which is the discipline {@link summoned}
   * already keeps for the same reason: the record a casting leaves is written
   * *after* its effects run, and a `spell-ended` naming a casting the fold has
   * not seen yet is refused by the reducer. So the resolver records that the die
   * ended it and `resolveEffects` writes the ending one line below the record it
   * releases — which is the order Ensnaring Strike's `resisted` ending already
   * goes out in.
   *
   * Mutable and appended to, like the three collectors beside it. Empty for every
   * casting whose saves decide something other than its own lifetime.
   */
  readonly resisted: string[];
  /**
   * Where the orb leaps, in the caster's order — SRD Chromatic Orb's "a
   * different target of your choice". Read by the attack resolver when the
   * spell's own dice pair; absent for every other casting, and for a leaping
   * spell whose caster named nobody.
   */
  readonly leapTo?: readonly CharacterId[];
  /**
   * The creatures the orb has leapt to so far in this casting, in order.
   *
   * Mutable for the reason {@link summoned} is: the attack resolver appends
   * each leap and reads the list back to count the leaps against the cap and
   * to keep "a creature can be targeted only once by each casting". Empty for
   * every casting that never leaps.
   */
  readonly leapt: CharacterId[];
  /**
   * Which of this casting's targets consent to it, where the spell asks.
   *
   * Absent where nobody was named, which is the same casting as a list that
   * named nobody — see `willingFor`. Read by the saving throw SRD Levitate
   * offers an **unwilling** creature and by nothing else: the consent gate the
   * other clause writes is checked before a slot is spent and never reaches a
   * resolver.
   */
  readonly willing?: readonly CharacterId[];
  /**
   * How far a `change-altitude` effect moves the creature, signed: positive is
   * up and negative is down.
   *
   * Stated at the **activation** rather than at the casting, which is what
   * makes it the one request fact a later action carries: SRD Levitate's "You
   * can change the target's altitude by up to 20 feet in either direction on
   * your turn" is a decision taken on the turn it is taken, and the definition
   * prints only the cap. Refused at the command when the effect asks for one
   * and none was given, so a resolver reaching here without it is the command
   * layer and the definition disagreeing.
   */
  readonly altitude?: number;
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
   * The weapon a `weapon-rider` effect was aimed at, by catalogue id.
   *
   * Stated at the casting and refused there when a spell that imbues none
   * names one, so a resolver reaching here without it is the definition and
   * the command layer disagreeing rather than a rules dispute — the reading
   * {@link EffectContext.teleportTo} takes, for the same reason: the weapon,
   * like the destination, is a decision the engine will not make.
   */
  readonly weapon?: string;
  /**
   * The object an `end-attunement` effect was aimed at, by catalogue id.
   *
   * {@link EffectContext.weapon}'s neighbour and its reading: stated at the
   * casting, refused there when a spell that touches no object names one, so a
   * resolver reaching here without it is the definition and the command layer
   * disagreeing rather than a rules dispute.
   */
  readonly object?: string;
  /**
   * The stat block a summoning spell that leaves the form to its caster was
   * told to raise, by its id in content — SRD Find Familiar's "an animal form
   * you choose". Stated at the casting and refused there when a spell that
   * names its own block is given one, or one that asks is given none; the
   * catalogue half — the block exists, and is one the spell admits — is
   * checked in `resolveSpell`'s pre-flight, before anything is spent.
   */
  readonly form?: string;
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
  /**
   * The creatures this run put into the world, in the order it raised them.
   *
   * The fifth mutable member, and it is mutable for a reason none of the other
   * four share: what goes in it is not written down until *after* the run is
   * over. A `creature-summoned` naming a casting that is not in `state.ongoing`
   * is a log the fold refuses, and a casting writes its `spell-ongoing` record
   * after its effects resolve — so `resolveSummonEffect` raises the creature
   * and leaves its name here, and `resolveEffects` binds whatever is in it
   * once the record exists. A casting that leaves nothing running binds
   * nothing, which is SRD Find Steed's Instantaneous steed.
   *
   * Empty for every casting that summons nothing, which is nearly all of them.
   */
  readonly summoned: CharacterId[];
}

/** One arm of the effect union, by its `kind`. */
export type EffectOfKind<K extends SpellEffect['kind']> = Extract<SpellEffect, { kind: K }>;
