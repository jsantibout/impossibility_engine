/**
 * What a fold over the event log adds up to.
 *
 * `GameState` and the records it holds — a creature, the four engine debts, a
 * readied action — plus `initialState`, which is the empty world every fold
 * starts from. It is the *shape* of the answer and knows nothing about how the
 * answer is computed: no reducer case, no derived pass, no cleanup.
 *
 * It is split from `events.ts` rather than kept beside the union because the
 * two are read by different people. A tool surface and every command read this
 * to know what they are holding; only the fold reads the union's members. The
 * dependency runs one way at run time — this imports `GameEvent` `type`-only,
 * for `AppliedCommand`, and the union's module re-exports these — so the edge
 * is erased and the cycle is a cycle in nothing that runs.
 */
import type { Ability, CharacterId, RollMode } from '@ie/shared';
import type { CharacterSheet, GrantedArmorClass } from './character.js';
import { type ActiveRollModifier } from './roll-modifiers.js';
import type { RngState } from './dice.js';
import { type ConditionState } from './conditions.js';
import { type ResourceState } from './resources.js';
import type { CharacterRecord } from './creation.js';
import type { DamageComponent, DamageDefenses, DamageReduction, GrantedDefense } from './attack.js';
import type { D20TestResult } from './checks.js';
import type { ReactionOffer } from './reactions.js';
import type { ActiveBonus } from './bonuses.js';
import { type SpellcastingState } from './spellcasting.js';
import type { RestState } from './rest.js';
import {
  type Deadline,
  type PendingSave,
  type EffectCheck,
  type ScheduledDamage,
  type TimedEffect,
} from './duration.js';
import {
  type AreaTriggerStamp,
  type CastingTime,
  type Concentration,
  type OngoingSpell,
  type OwedAreaEffect,
  type SlotlessReason,
} from './spells.js';
import { type CombatState } from './combat.js';
import { type GrantedAttackRider, type GrantedSpeed } from './standing.js';
import {
  type PointAnchoring,
  type Placement,
  type PositionState,
  type Point,
} from './positioning.js';
import { type Vitals } from './vitals.js';

import type { GameEvent } from './events.js';

export interface CreatureState {
  readonly id: CharacterId;
  readonly name: string;
  readonly sheet: CharacterSheet;
  readonly vitals: Vitals;
  readonly conditions: ConditionState;
  /** Spell slots and every other limited-use pool this creature has. */
  readonly resources: ResourceState;
  /** The one casting this creature is sustaining, if any. */
  readonly concentration: Concentration | null;
  /** The rest this creature is part-way through, if any. */
  readonly resting: RestState | null;
  /** When their last Long Rest finished, for the sixteen-hour rule. */
  readonly lastLongRestAt: number | null;
  /**
   * When a rest that earned a **Short** Rest's benefits last finished.
   *
   * SRD Sorcerous Restoration happens "when you finish a Short Rest", and a
   * moment is a fact rather than a mechanism — the same thing `lastDamage` is
   * for Hellish Rebuke's "in response to". What is recorded is the benefit
   * *earned*, so an interrupted Long Rest that collapsed into a Short one
   * counts, which is what the SRD says it is.
   */
  readonly lastShortRestAt: number | null;
  /**
   * What this creature can actually cast, and by what route.
   *
   * Derived from creation's choices, so a feat's spells reach usable state
   * rather than sitting in a record nothing reads. Monsters have none, and
   * that is a normal state.
   */
  readonly spellcasting: SpellcastingState;
  /**
   * What kind of creature this is: Humanoid, Fey, Dragon.
   *
   * Null when nobody has said, which is a real state and not a default — a
   * spell that demands a type asks for it rather than assuming one. Characters
   * take it from their species; a stat block prints it.
   */
  readonly creatureType: string | null;
  /**
   * Resistance, Vulnerability and Immunity, per damage type.
   *
   * A stat block prints these and `adaptMonster` reads them; until they reached
   * state nothing could apply them, so a fire-immune creature burned like
   * anything else. Only *unconditional* entries live here — a qualified one
   * ("except from its vampire master") stays out, because no boolean captures
   * it and treating it as absolute is the documented wrong answer.
   *
   * **This is the creature's own, and it never grows.** What an effect hands
   * out lives in {@link grantedDefenses}, because a grant has to be able to
   * end and this table has no source on it to end by.
   */
  readonly defenses: Readonly<Record<string, DamageDefenses>>;
  /**
   * Which side of the fight this creature is on, or null if nobody has said.
   *
   * Who counts as an ally is fiction, not arithmetic — it changes when a
   * bandit is bribed and when a summoned creature turns — so it is **declared**
   * like cover and line of sight rather than derived from anything. SRD leans
   * on it constantly: "You and your allies in the aura", "an ally within 5
   * feet of you", "a creature of your choice".
   *
   * Null is a real state. Nobody is a creature's ally by default, so an aura
   * that asks for allies reaches nobody the table has not placed.
   */
  readonly side: string | null;
  /**
   * Features this creature has switched on and is still in.
   *
   * SRD Rage is the first: entered as a Bonus Action, paid for out of a pool,
   * lasting until a deadline unless extended, and ending the moment its
   * conditions stop holding. What it *does* while it runs is ordinary standing
   * effects requiring `feature-active` — the benefits are not special, only
   * their being switchable is.
   *
   * Sorted, so state serialises identically however they were entered.
   */
  readonly activeFeatures: readonly string[];
  /**
   * The action this creature is holding for a trigger, or null.
   *
   * Paired with the `action:ready` feature rather than standing alone: that is
   * what carries the deadline, so "before the start of your next turn" is the
   * same turn-anchored expiry every other timed benefit uses and needs no
   * second mechanism. When the feature lapses, this goes with it.
   */
  readonly readied: ReadiedAction | null;
  /**
   * The last damage this creature took from another creature, and when.
   *
   * The window a Reaction to being damaged opens into. SRD says "in response
   * to", which means immediately, and the finest grain the engine has for that
   * is the turn — the same grain the one-slot-per-turn rule and `pendingSaves`
   * already use. Out of combat there are no turns, so the clock closes it
   * instead. Both are facts already in state; neither invents a number.
   */
  readonly lastDamage: LastDamage | null;
  /**
   * Named bonuses a running effect has hung on this creature.
   *
   * Bless adds 1d4 to attack rolls and saves; Bane subtracts one. They are
   * kept on the creature rather than passed in by a caller for the same reason
   * Alert's Initiative bonus is: a bonus somebody has to remember is a bonus a
   * character silently stops having.
   *
   * Each carries the casting in its source, so ending the casting takes
   * exactly its own bonuses off — the same link conditions use, which is what
   * `castingSource` was built for.
   */
  readonly bonuses: readonly ActiveBonus[];
  /**
   * Alternative base Armour Class calculations a running effect has supplied.
   *
   * SRD Mage Armor's "the target's base AC becomes 13 plus its Dexterity
   * modifier" — a **replacement**, not an addition, which is why it is not in
   * {@link bonuses}: a bonus adds to whatever the creature already calculates,
   * and adding three to a Barbarian's Unarmoured Defense is the one thing SRD
   * Multiclassing forbids.
   *
   * Kept beside the bonuses and linked the same way — the casting is in the
   * `source` — so `releaseCasting` ends these with the spell through machinery
   * that already existed. Read only by `armorClassOf`, and only in the
   * unarmoured branch, so a grant is inert while armour is worn rather than
   * needing a field to say so.
   */
  readonly armorClasses: readonly GrantedArmorClass[];
  /**
   * Advantage and Disadvantage a running effect has hung on this creature.
   *
   * The third member of the family `bonuses` and `armorClasses` already form,
   * and the one that needed a new axis rather than a new field: a bonus and an
   * Armour Class are always the holder's own, while a mode may belong to
   * **rolls made against them**. Blur is stored on the wizard and changes the
   * goblin's attack roll, which is why {@link ActiveRollModifier} carries a
   * relation and `ActiveBonus` does not.
   *
   * Linked by the casting in its `source` exactly as the other two are, so
   * `releaseCasting` and `releaseOnTarget` end it with the spell — a broken
   * Concentration, a deadline, a dispel and a caster leaving all converge on
   * the door that already existed.
   */
  readonly rollModifiers: readonly ActiveRollModifier[];
  /**
   * Resistance, Immunity or Vulnerability a running effect has hung on this
   * creature.
   *
   * The fourth member of the family the three above form, and the one the
   * `unmodelled` note on Protection from Poison named for as long as it
   * existed: "defences are set when a creature enters the game and no effect
   * grants one". SRD Stoneskin, Protection from Energy and Protection from
   * Poison all hand a creature a Resistance and all three had nowhere to put
   * it.
   *
   * Linked by the casting in its `source` exactly as the other three are, so
   * `releaseCasting` and `releaseOnTarget` end it with the spell — and a
   * `grants` timer can end it *before* the spell, which is the deadline
   * `EffectTarget` gained for it.
   *
   * **Not merged into {@link defenses}.** That table is the creature's own and
   * carries no source, so a grant folded into it could never be taken out
   * again — and the *qualified* entries a stat block prints are deliberately
   * not in it either, which is a distinction a merge would quietly flatten.
   */
  readonly grantedDefenses: readonly GrantedDefense[];
  /**
   * Speeds a running effect has changed on this creature.
   *
   * The fifth member of the family the four above form, and the one whose
   * reader already existed: IE-031 made `speedOf` the single place the engine
   * asks what a creature's Speed is, with a `flat` accumulator, a halving
   * count and a zero — and gave it no *effect* to read. SRD Longstrider, Ray
   * of Frost, Slow and Hypnotic Pattern all move a Speed, and every one of
   * them was a sentence in `unmodelled` saying the engine holds one
   * `baseSpeed` and nothing modifies it.
   *
   * Linked by the source exactly as the other four are, so `releaseCasting`,
   * `releaseOnTarget` and a `grants` deadline end it through the door that
   * already existed — and the deadline is the one that matters here, because
   * Ray of Frost is Instantaneous and has no casting to end.
   *
   * **Not folded into the sheet's `baseSpeed`.** That number is what the
   * creature *is*; this is what is being done to it, and a grant written into
   * the base could never be taken out again — the same reading that keeps
   * {@link grantedDefenses} out of {@link defenses}.
   */
  readonly speedModifiers: readonly GrantedSpeed[];
  /**
   * Extra damage a running effect adds to this creature's **later** attacks.
   *
   * The sixth member of the family the five above form, and the one whose
   * reader already existed on the other side of the fence: `attack-damage` has
   * been a *feature* grant since Sneak Attack landed — "a rider whose damage
   * type is chosen at the hit", Rage Damage, Radiant Strikes — and no spell
   * could hand one out. SRD Divine Favor, Hunter's Mark and Hex all write the
   * sentence, and every one of them was a spell the catalogue had no
   * definition for.
   *
   * **It sits on the attacker, which is what makes it a grant on a creature at
   * all.** Hunter's Mark is cast at a quarry ninety feet away and the die is
   * the ranger's; `GrantedAttackRider.target` is the creature the rider is
   * *about*, and the rider itself is held by whoever swings.
   *
   * Linked by the casting in its `source` exactly as the other five are, so
   * `releaseCasting`, `releaseOnTarget`, a dispel, a broken Concentration and
   * the deadline all end it through the door that already existed.
   */
  readonly attackRiders: readonly GrantedAttackRider[];
  /**
   * Bonuses this creature's own features add to Initiative.
   *
   * SRD Alert's Proficiency Bonus lives here so the roll can pick it up
   * without a caller remembering that this character has the feat.
   */
  readonly initiativeBonuses: readonly { readonly source: string; readonly flat: number }[];
  /**
   * What this creature owns, by catalogue id.
   *
   * Sorted by id, so state serialises identically however the items arrived.
   * Owning is not wearing: `equipped` is the subset in hand.
   */
  readonly inventory: readonly InventoryLine[];
  /** The ids actually worn or wielded, which is what Armour Class reads. */
  readonly equipped: readonly string[];
  /** Money, in copper — the unit every SRD coin divides into. */
  readonly coins: number;
  /**
   * The choices this character was built from, when it is a character.
   *
   * Kept so the sheet can be rebuilt exactly and a level gained without
   * re-creating the creature — which would silently heal it and refill every
   * pool. Monsters have no record and that is a normal state.
   */
  readonly character: CharacterRecord | null;
}

/**
 * What a command did, kept so a retry can be recognised as one.
 *
 * A caller retrying after its first batch was already applied is looking at
 * *updated* state — the slot gone, the casting done. Identical events from
 * identical state says nothing about that case, so commands carry an identity
 * and the fold remembers which ones have landed.
 */
export interface AppliedCommand {
  readonly type: GameEvent['type'];
  /** The casting it produced, so a retry can still link that casting's effects. */
  readonly castingId: string | null;
  /** The inputs it ran with, so reusing its id for different work is caught. */
  readonly fingerprint: string;
}

/**
 * A command's identity on the event it produced.
 *
 * The fingerprint travels with the id because policing reuse needs both: an id
 * alone can only answer "has this landed", never "is this the same command".
 */
export interface CommandStamp {
  readonly id: string;
  readonly fingerprint: string;
}

/**
 * A hit whose damage is still to be rolled.
 *
 * Everything the settling command needs, so nothing has to be remembered
 * between the two calls: which weapon, how it was held, whether it was a
 * critical, and the target Armour Class the roll already beat.
 */
/**
 * Damage one creature dealt another, and the moment it happened.
 *
 * `turn` is the combat's `turnsTaken` when it landed, or null outside combat;
 * `elapsed` is the clock. A Reaction that answers damage is legal while both
 * still match, which is exactly "before anything has moved on".
 */
export interface LastDamage {
  readonly by: CharacterId;
  readonly turn: number | null;
  readonly elapsed: number;
}

export interface PendingAttack {
  readonly attacker: CharacterId;
  readonly target: CharacterId;
  /** Catalogue id, or null for an Unarmed Strike. */
  readonly weapon: string | null;
  readonly twoHanded: boolean;
  readonly thrown: boolean;
  readonly finesseAbility?: 'str' | 'dex';
  readonly critical: boolean;
  /** The ability the attack roll used, for a feature that asks. */
  readonly ability: Ability;
  readonly targetAc: number;
  /**
   * What the attack roll came to, and what the die itself showed.
   *
   * Both are on the hold for the reason everything else here is: nothing may
   * have to be remembered between the two calls. SRD Shield is "+5 bonus to
   * AC, **including against the triggering attack**", so the window has to be
   * able to ask whether the roll still clears a number that has since gone up
   * — and a natural 20 hits whatever the Armour Class becomes.
   */
  readonly total: number;
  readonly natural: number;
  /**
   * How the attack roll came out, after Advantage and Disadvantage cancelled.
   *
   * On the hold because SRD Sneak Attack asks "if you have Advantage on the
   * roll", and a held attack settles its damage in a second call that would
   * otherwise have to guess. Optional only so that a log written before this
   * existed still folds; `resolveAttack` always records it.
   */
  readonly mode?: RollMode;
}

/**
 * A move that has been declared and is waiting on Opportunity Attacks.
 *
 * SRD: "The attack occurs right before the creature leaves your reach." So the
 * mover is still standing where they were until every provoked creature has
 * taken its Reaction or passed — which is why the destination is written down
 * here rather than applied.
 *
 * **How far it is has deliberately no field.** The Speed is spent at
 * declaration — `movement-spent` is in the same batch — and completing the move
 * re-resolves the *placement* rather than re-measuring the distance. So nothing
 * ever read the number, and a distance carried beside a placement that may
 * resolve somewhere else is a second answer to what the move cost.
 *
 * Both frozen logs still carry it, so the reducer builds this from the fields
 * it knows rather than storing the event's object whole.
 */
export interface PendingMove {
  readonly mover: CharacterId;
  /**
   * Where they are going, as the placement they asked for.
   *
   * The placement rather than a resolved point, because that is how every
   * other position in this engine is expressed — relative to something already
   * established, never raw coordinates. Re-resolving it when the move
   * completes is also the more correct answer: if the anchor moved in the
   * meantime, "beside the fighter" still means beside the fighter.
   */
  readonly placement: Placement;
  /**
   * Where that placement resolved to when the move was declared.
   *
   * The placement is re-resolved on completion so a mover still arrives beside
   * the fighter who shuffled sideways — but the anchor can also be *gone* by
   * then, killed and removed by the very Opportunity Attack the move provoked.
   * Re-resolution fails there, and the `creature-moved` event it produces can
   * never be folded again. This is what the move falls back to: the spot it was
   * already measured against and already paid Speed to reach.
   */
  readonly destination: Point;
  /** Who was offered an Opportunity Attack and has not yet answered. */
  readonly provoked: readonly { readonly reactor: CharacterId; readonly reach: number }[];
}

/**
 * A casting that has been declared and has not yet resolved.
 *
 * SRD 2024 Counterspell is the rule that makes this moment real: "You attempt
 * to interrupt a creature **in the process of casting a spell**." A casting
 * that spends its slot and lands its effects in one breath has no such moment,
 * and Counterspell could not be written against it.
 *
 * **The SRD decides which costs are already paid, and it is not "all of
 * them".** "The action, Bonus Action, or Reaction used to cast it is wasted"
 * — so the economy is spent at declaration and interruption does not hand it
 * back. "If that spell was cast with a spell slot, the slot isn't expended" —
 * so the slot is *not* spent here, and an interruption has nothing to refund
 * because nothing was taken. That asymmetry is why this is a two-event casting
 * rather than a spend-and-compensate one: every event still records something
 * that actually happened.
 *
 * In state rather than in a return value, for the reason `pendingAttack` is:
 * the fold rebuilds it, so it survives a reload, and the turn refuses to
 * advance while it stands.
 *
 * At most one. A Counterspell answering a Counterspell would need a stack, and
 * a second declaration is refused rather than quietly nested.
 */
export interface PendingCasting {
  /** The casting's identity, allocated at declaration and nameable by others. */
  readonly castingId: string;
  readonly caster: CharacterId;
  /** The SRD slug, so settlement finds the same definition. */
  readonly spellId: string;
  /** The display name, as the settling `spell-cast` will record it. */
  readonly spell: string;
  /** The level it is cast at, which is the slot's level when upcast. */
  readonly level: number;
  /**
   * The slot settlement will expend, or null.
   *
   * Named but **not yet spent**. An interruption drops this record and the
   * slot was never taken; there is no compensating event because there is
   * nothing to compensate.
   */
  readonly slot: { readonly key: string; readonly level: number } | null;
  readonly slotless: SlotlessReason | null;
  readonly castingTime: CastingTime;
  readonly concentration: boolean;
  /** Which grant supplies it, so settlement derives the same save DC. */
  readonly route?: string;
  /** The targets resolved at declaration, so settlement cannot re-aim it. */
  readonly targets: readonly CharacterId[];
  /**
   * The space chosen at declaration, for a spell that holds a point.
   *
   * Beside the targets and for the same reason: settlement takes no fresh
   * request, so a Spiritual Weapon declared beside the goblins cannot settle
   * beside the party. Checked against the spell's range once, while refusing
   * still costs nothing.
   */
  readonly origin?: Point;
  /**
   * Where a persistent area sits, for a spell that leaves one behind.
   *
   * Kept apart from `origin` rather than folded into it, because the two are
   * read by different rules: `origin` is where a casting *acts from* and
   * reaches the attack, while this is a shape's anchor and reaches nothing but
   * the geometry. A Web declared over the goblins settles over the goblins,
   * and the direction it was laid along is the one fact about it that cannot
   * be worked out again.
   */
  readonly area?: {
    readonly at: Point;
    readonly towards?: Point;
    /**
     * Whether `at` and `towards` name spaces or grid intersections.
     *
     * Absent means `space`, so a declaration written before intersections existed
     * folds to exactly the state it always did.
     */
    readonly anchoring?: PointAnchoring;
  };
  /**
   * The damage type the caster stated, where the spell prints a choice.
   *
   * Beside `targets`, `origin` and `area`, and for exactly the same reason:
   * settlement takes no fresh request, so what the caster said at the casting
   * is the only place this can come from. SRD Spirit Guardians prints "3d8
   * Radiant damage (if you are good or neutral) **or** 3d8 Necrotic damage (if
   * you are evil)" and SRD Protection from Energy "Resistance to one damage
   * type of your choice" — both decided by the caster, once, at the casting.
   * Dropped here, a casting declared Necrotic settles Radiant and bounces off
   * an Undead that is Immune to one and not the other.
   *
   * Absent for every other spell in the book, which is what makes a
   * declaration written before this folds to exactly the state it always did.
   */
  readonly damageType?: string;
  /**
   * Which creatures the caster or their allies are fighting.
   *
   * SRD Charm Person: "It does so with Advantage if you or your allies are
   * fighting **it**." The third fact a caster states at the casting, pinned
   * here beside the other two and for the same reason — settlement takes no
   * fresh request, so this is the only place it can come from. Dropped, a Charm
   * Person declared against a creature the party is fighting settles with an
   * ordinary save and nothing in the log says why.
   *
   * A list, because the clause is about the target and an upcast Charm Person
   * names several. Sorted on the way in, and **empty rather than absent** where
   * the caster answered "none of them" — absence means the spell never asked,
   * which is every spell but the five that print the clause, and is what makes
   * a declaration written before this fold to exactly the state it always did.
   */
  readonly fought?: readonly CharacterId[];
  /**
   * Creatures the caster designated unaffected, for a spell that offers it.
   *
   * SRD Spirit Guardians: "When you cast this spell, you can designate
   * creatures to be unaffected by it." Sorted and absent-when-empty by the
   * time it arrives, so two declarations that mean the same thing fold to the
   * same bytes — normalised once, where the request is read.
   */
  readonly unaffected?: readonly CharacterId[];
  /**
   * Where a teleporting spell puts its target.
   *
   * The fourth stated fact, beside the other three and for the same reason:
   * settlement takes no fresh request, so a Dimension Door declared at the far
   * end of the hall must not settle beside the caster — and unlike the level
   * or the route, a destination is a decision nothing could re-derive.
   *
   * Absent for every spell that teleports nobody, which is all but two of
   * them, so a declaration written before this folds to exactly the state it
   * always did.
   */
  readonly teleportTo?: Placement;
  /** What the definition knowingly leaves out, gathered at declaration. */
  readonly unverified: readonly string[];
  /**
   * When the casting ends, already pinned.
   *
   * Resolved at declaration rather than at settlement so that settlement
   * cannot fail: a turn-anchored duration that `resolveDuration` would refuse
   * is refused before the window opens, and a window that could not be closed
   * would wedge the fight.
   */
  readonly deadline?: Deadline;
  /**
   * When a casting of a minute or more finishes, for a casting that takes one.
   *
   * SRD "Longer Casting Times": "Certain spells—including a spell cast as a
   * Ritual—require more time to cast: minutes or even hours." The two-event
   * casting already held the window open; this is the fact that says when the
   * window may be closed, and `resolveDeclaredCast` refuses `still_casting`
   * until the clock reaches it.
   *
   * **Read with `isDue`, never `hasExpired`.** The two differ only for a
   * turn-anchored deadline whose anchor has gone, and there they are
   * opposites: `hasExpired` answers **yes**, so that nothing runs for ever,
   * while `isDue` answers **no**, so that a moment which will never arrive
   * collects nothing. A casting completes when its moment genuinely comes, so
   * a reading under which a casting completed because the fight ended would be
   * the engine inventing a completion. Every value here is an `elapsed`
   * deadline today — a casting time is a span of seconds and never a moment in
   * the turn order — so the two agree, which is precisely why the choice has
   * to be stated rather than left to luck.
   *
   * Absent for every casting that is not a long one, which is what makes a
   * declaration written before this fold to exactly the state it always did —
   * and it is the fact `settlementEvents` branches on, because what that
   * branch is about is whether a Concentration was already started for the
   * casting. `castingTime === 'long'` agrees with it today and cannot
   * disagree, a Ritual being recorded as a long casting; this is the field
   * that says the thing directly rather than the one that travels with it.
   */
  readonly completesAt?: Deadline;
  /**
   * How long the spell runs **once it takes effect**, for a clock-deferred
   * casting.
   *
   * A span of seconds rather than a resolved {@link Deadline}, because a
   * deadline pinned at declaration would start the spell's duration at the
   * moment the *casting* began: a ten-minute Detect Magic ritual would expire
   * the instant it finished being cast. SRD gives a spell's Duration from when
   * it takes effect, so the span is carried and resolved at settlement.
   *
   * Seconds and not a `Duration`, because a turn-anchored duration is refused
   * at declaration — `resolveDuration` has no meaning for one outside combat,
   * and a long casting is refused inside one — so a span is the only kind that
   * can reach here, and storing the narrower thing means settlement cannot
   * fail. That is the same validate-before-rolling rule {@link deadline}
   * obeys, arriving at the other end.
   */
  readonly lastsSeconds?: number;
  /**
   * A check the casting's own timer will offer, worked out at declaration.
   *
   * Beside the deadline for the same reason: both belong to the timer that
   * settlement schedules, and both are derived from the caster's sheet as it
   * stood when the spell was declared. A Silent Image that survives a
   * Counterspell attempt is seen through at the DC it was cast at.
   */
  readonly check?: EffectCheck;
}

/**
 * A damage roll that has been made and not yet applied.
 *
 * The fourth debt of this shape, and the first whose *whole* reason for
 * existing is somebody else's decision. SRD Uncanny Dodge halves "the attack's
 * damage against you", Deflect Attacks reduces "the attack's total damage" and
 * Cutting Words subtracts from a creature's "damage roll" — three features that
 * all need a total that exists and has not landed. An attack that rolls its
 * damage and applies it in one breath has no such moment.
 *
 * **It is opened only when somebody can answer it.** With no eligible reactor
 * the attack stays exactly as atomic as it always was, emits the same events
 * and needs no second command. That is not an optimisation: it is the rule
 * `pendingMove` already follows, where a move that provokes nobody simply
 * happens. Making every swing a two-step negotiation to serve a moment that is
 * almost always empty would be a worse API for no rules gain.
 *
 * Everything the settlement needs is written down here, so nothing has to be
 * remembered between the calls and a reload rebuilds it: the typed components
 * as rolled, who dealt it, whether it was a critical, and whether an attack
 * roll caused it — which two of the three features require and the third does
 * not.
 */
export interface PendingDamage {
  readonly target: CharacterId;
  /**
   * Who dealt it, or null where nobody did.
   *
   * A trap has no dealer, and that is a real answer: Uncanny Dodge needs "an
   * attacker that you can see", so nothing is offered against a falling rock.
   */
  readonly by: CharacterId | null;
  /** Prose for the audit trail — "Longsword", "Fire Bolt". */
  readonly source: string;
  /** As rolled, by type. Defences have not been applied. */
  readonly components: readonly DamageComponent[];
  readonly critical: boolean;
  /** SRD Uncanny Dodge and Deflect Attacks: "When an attack roll hits you". */
  readonly fromAttack: boolean;
  /**
   * What reactions have taken off, **in the order they were taken**.
   *
   * Order is recorded rather than normalised because it is observable: halving
   * a total and then subtracting 3 is not the same as subtracting 3 and then
   * halving, and the SRD gives no rule for sequencing two voluntary Reactions.
   * The engine does not choose — whoever answers first is applied first, and
   * the log says which that was.
   */
  readonly reductions: readonly DamageReduction[];
  /** Who was offered a Reaction and has not yet answered. */
  readonly offers: readonly ReactionOffer[];
}

/**
 * A D20 Test whose total is known and whose effects have not happened.
 *
 * SRD Dark One's Own Luck writes the window out in one clause — "after seeing
 * the roll **but before any of the roll's effects occur**" — which is what
 * makes this a real instant rather than a convenient one. Indomitable rerolls
 * into it, Peerless Skill and Cutting Words push it either way, and the Sphinx
 * has a stat-block Reaction that does the same thing.
 *
 * The *result* lives here rather than in a caller's hands for the reason
 * invariant 3 demands: the die has been thrown, so the number is history. A
 * window that lived in a return value would be lost on a reload and the caller
 * would have to roll again — which is precisely the "replaying intents"
 * failure the event log exists to prevent.
 *
 * **It settles nothing by itself.** A standalone test's consequence is the
 * table's: the engine owns the number, not what is done about it. So closing
 * this window emits no mechanical change, and that is the honest answer rather
 * than a stub — the same reading `SpellCheck.onSuccess: 'none'` already takes.
 */
export interface PendingTest {
  readonly who: CharacterId;
  /** What was being rolled, in the caller's words: "Dexterity save vs the pit". */
  readonly label: string;
  /** The test as it currently stands, after whatever has already pushed it. */
  readonly result: D20TestResult;
  readonly offers: readonly ReactionOffer[];
}

/**
 * What a readied action will do when its trigger comes.
 *
 * SRD Ready: "you choose the action you will take in response to that trigger,
 * or you choose to move up to your Speed in response to it."
 *
 * `action` is deliberately opaque. The SRD's action list is open — Attack,
 * Utilize, Influence, Shove, and whatever else a table invents — and the
 * engine has commands for a handful of them. So the response says only that an
 * action was chosen, with the caller's own words alongside it, and the caller
 * performs it once the Reaction is spent. `spell` is the one the SRD writes
 * its own rules for, and those rules are the engine's: the slot goes now, the
 * magic is held with Concentration, and the effects land on release.
 */
export type ReadiedResponse =
  | {
      readonly kind: 'action';
      /** What action was chosen, as the table said it. Never parsed. */
      readonly note?: string;
    }
  | {
      readonly kind: 'spell';
      readonly spellId: string;
      /** The casting that is being held — already paid for. */
      readonly castingId: string;
      /** The level it was cast at, so the release resolves at that level. */
      readonly castLevel: number;
      /**
       * The damage type this casting was declared with, where the spell prints
       * more than one.
       *
       * The first of the four facts a caster **states** rather than the engine
       * deriving, carried here for the reason {@link PendingCasting} carries
       * it: the release takes no fresh request about what the spell *is*, so
       * this is the only place it can come from. A readied Spirit Guardians
       * declared Necrotic must not settle Radiant.
       */
      readonly damageType?: string;
      /**
       * Which creatures the caster or their allies are fighting.
       *
       * SRD Charm Person: "It does so with Advantage if you or your allies are
       * fighting **it**", which the three Dominates print with the clauses
       * swapped round. Without it those three could not be readied at all: the
       * spell *requires* the fact, so the casting was refused before the Ready
       * could be taken.
       *
       * A list, because the clause is about the target, and **empty rather
       * than absent** where the caster answered "none of them" — absence means
       * the spell never asked, which is every spell but the five that print
       * the clause, and is what makes a Ready written before this fold to
       * exactly the state it always did.
       */
      readonly fought?: readonly CharacterId[];
      /** Creatures the caster designated unaffected, for a spell that offers it. */
      readonly unaffected?: readonly CharacterId[];
      /**
       * Where a teleporting spell puts its target.
       *
       * The fourth stated fact, and the one the release could not possibly
       * work out again — a Dimension Door readied against the far end of the
       * hall must not let go beside its caster.
       */
      readonly teleportTo?: Placement;
    }
  /**
   * SRD: "or you choose to move up to your Speed in response to it."
   *
   * Nothing is recorded here, deliberately. "Your Speed" is read when the
   * creature actually moves, not when they decided they might — a mover who
   * has been Grappled in the meantime has a Speed of 0, and an allowance
   * frozen at the moment of readying would hand them thirty feet anyway.
   */
  | { readonly kind: 'move' };

/**
 * An action held back for a trigger that has not happened yet.
 *
 * **The trigger is text this engine stores and never reads.** SRD calls it "a
 * perceivable circumstance", and the circumstances a table readies against —
 * a door opening, a chant reaching its third line, someone stepping off the
 * pressure plate — are almost all fiction that structured state has never
 * heard of. Absence from state is not evidence that a thing does not exist, so
 * judging the trigger would mean either refusing most readied actions or
 * inventing a world to judge them in. Maestro says when it fired; the engine
 * owns the action spent now, the Reaction spent later, and the deadline.
 */
export interface ReadiedAction {
  readonly trigger: string;
  readonly response: ReadiedResponse;
}

export interface GameState {
  readonly seed: string;
  /** Generator state, so a resumed session continues the same sequence. */
  readonly rng: RngState | null;
  /** How many roll ids have been issued, so resuming does not reuse one. */
  readonly rollsIssued: number;
  readonly creatures: Readonly<Record<string, CreatureState>>;
  readonly combat: CombatState | null;
  readonly scene: PositionState | null;
  /** Events applied so far, for auditing a single creature's history. */
  readonly eventCount: number;
  /**
   * Castings begun, so the next one's id is known before it happens.
   *
   * A counter rather than a random id: replaying the log has to reproduce the
   * same casting ids, or every effect linked to one dangles after a restart.
   */
  readonly castingsBegun: number;
  /**
   * Castings whose ongoing record has been through {@link releaseCasting},
   * oldest first.
   *
   * The counter above proves a casting *happened*; this proves one is **over**,
   * and the two answer different questions. Without it a `spell-ongoing` for a
   * casting the log had already ended was accepted and put a finished spell
   * back into `ongoing` — a zombie by the one route "there is a single place a
   * record is removed" exists to rule out.
   *
   * **Recorded only where a record was actually removed.** `releaseCasting`
   * runs for castings that never had a record at all — an `endConcentration`
   * on a spell whose resolution has not written one yet — and marking those
   * would refuse the `spell-ongoing` that the same batch is about to emit.
   * "Had a record and lost it" is the fact, and it is the one the debt names.
   *
   * Sorted by casting number rather than lexically, for the reason
   * `castingNumber` exists: `cast:2` ended before `cast:10`.
   */
  readonly castingsEnded: readonly string[];
  /** Command ids already applied, by caller-supplied key. */
  readonly appliedCommands: Readonly<Record<string, AppliedCommand>>;
  /**
   * Seconds since the campaign began.
   *
   * One clock, counting up. There is no calendar and no time of day — those
   * are fiction and the DM owns them. What the rules need is "how long since",
   * which is subtraction.
   */
  readonly elapsed: number;
  /**
   * Effects waiting to run out, keyed by what they will end.
   *
   * Keyed rather than listed so re-applying the same effect from the same
   * source replaces its deadline instead of leaving a stale one behind to end
   * it early.
   */
  readonly timers: Readonly<Record<string, TimedEffect>>;
  /**
   * Saves a turn boundary raised that nobody has rolled yet.
   *
   * The reducer cannot roll — randomness enters the log once, at the point of
   * the roll — so a turn that owes a save records the debt and an engine-owned
   * operation settles it. Keyed by effect and turn, so one boundary raises one
   * save however many times the log is folded.
   */
  readonly pendingSaves: Readonly<Record<string, PendingSave>>;
  /**
   * Damage a spell promised and a later moment collects.
   *
   * In state rather than in a caller's hands, so it survives a reload — the
   * difference between this and the pending Concentration save that had to be
   * torn out. Keyed by casting and target.
   */
  readonly scheduledDamage: Readonly<Record<string, ScheduledDamage>>;
  /**
   * An attack that has hit and not yet rolled its damage.
   *
   * SRD 2024 Divine Smite is cast as "a Bonus Action, which you take
   * immediately after hitting a target" — a moment between the attack roll and
   * the damage roll, which an attack that rolls both in one breath does not
   * have. Holding the hit open makes that moment real.
   *
   * In state rather than in a return value, which is the whole difference
   * between this and the pending Concentration save that had to be torn out:
   * the fold rebuilds it, so it survives a reload, and the engine refuses to
   * advance the turn while it stands. Forgetting stops the game rather than
   * quietly dropping a blow.
   *
   * At most one: an attack cannot be held while another is.
   */
  readonly pendingAttack: PendingAttack | null;
  /**
   * A declared move waiting on the Opportunity Attacks it provoked.
   *
   * The same shape as `pendingAttack` and for the same reason: the rule needs
   * a moment between two things that would otherwise happen at once, and a
   * moment that lives in a return value does not survive a reload.
   */
  readonly pendingMove: PendingMove | null;
  /**
   * Spells declared and not yet resolved, held open so they can be
   * interrupted — **by casting id**.
   *
   * The third debt of this shape, and the one whose costs are split: the
   * action is already spent and the slot is not. See {@link PendingCasting}.
   *
   * **Keyed rather than single, and casting identity is what keys it.** It was
   * one slot, engine-wide, and the guard that protected it refused every other
   * creature's casting for the whole of a ten-minute rite — a limit of the
   * record wearing a rule's clothes. Several castings may be open at once, and
   * **several of them may belong to one caster**: SRD's per-turn Magic-action
   * obligation is on the caster's *own* turns, Concentration breaks only on a
   * spell that requires it, and a Reaction is taken on somebody else's turn —
   * so a wizard mid-rite may legally cast Shield when attacked. What stops a
   * second casting is the real primitive in every case: the action economy,
   * `spellSlotSpentOnTurn`, and `releaseCasting`'s single Concentration door.
   *
   * **In casting-number order**, which is the order `castingsEnded` already
   * keeps and for the same reason: this record serialises, so an order that
   * depended on which caster happened to declare first would make the fold
   * something other than a pure function of the log's content.
   */
  readonly pendingCastings: Readonly<Record<string, PendingCasting>>;
  /**
   * Damage rolled and not yet applied, held open for the Reactions that answer
   * it — see {@link PendingDamage}.
   *
   * Null is the ordinary state and the important one: a swing nobody can
   * answer never opens this, so the attack command stays one call.
   */
  readonly pendingDamage: PendingDamage | null;
  /**
   * A D20 Test that has landed and whose effects have not occurred — see
   * {@link PendingTest}.
   */
  readonly pendingTest: PendingTest | null;
  /**
   * Castings that are still mechanically running, by casting id.
   *
   * The live half of a casting — see {@link OngoingSpell}. The log holds the
   * history; this holds only what a *later* mechanic has to be able to ask,
   * and the answer it most needs is the spell's **level**, which nothing else
   * held once the caster stopped concentrating.
   *
   * Keyed by the id every effect already carries, so nothing new has to be
   * matched up: ending a casting removes the record in the same pass that
   * removes its conditions.
   */
  readonly ongoing: Readonly<Record<string, OngoingSpell>>;
  /**
   * Effects a persistent spell area owes creatures it has caught.
   *
   * A list rather than a keyed record, and that is the difference from
   * `pendingSaves`: a save is keyed by effect and turn so that one boundary
   * raises one of it, while a Grease caps nothing and a creature that walks in
   * three times owes three. The fold appends in the order the moments arrived,
   * which makes replay identical without a key scheme to invent.
   *
   * See {@link OwedAreaEffect}. Settlement orders by `moment`, never by
   * position: the creature that finished its turn is owed before the one
   * beginning theirs.
   */
  readonly owedAreaEffects: readonly OwedAreaEffect[];
  /**
   * When each casting's area last caught each creature — see
   * {@link AreaTriggerStamp}.
   *
   * Written when a debt is **raised**, not when it settles, because the cap is
   * on how often the area may catch you rather than on how fast anyone rolls.
   */
  readonly areaTriggers: Readonly<Record<string, AreaTriggerStamp>>;
  /**
   * A turn that has begun and whose **start has not yet arrived**.
   *
   * One `turn-advanced` carries two moments — the finishing creature's end and
   * the next creature's start — and they are a round apart. Settling them in
   * order is not enough: what a creature is caught by *at its start* has to be
   * **determined** from the world the previous creature's end left behind. An
   * Insect Plague that drops a caster at the end of one turn ends the Web
   * somebody else was about to start their turn in, and a start debt computed
   * before that damage landed is a save against a spell the rules had ended.
   *
   * So `turn-advanced` raises the end obligations and records this; the start
   * obligations are raised by a derived pass once nothing the end moment owed
   * is outstanding. Derived, so a replay rebuilds both moments in the same
   * order from the log alone, and the creature whose turn it is may not act
   * while it stands.
   *
   * Null is the ordinary state and the common case reaches it inside the same
   * fold: a boundary that owes nothing passes straight through.
   */
  readonly pendingTurnStart: { readonly who: CharacterId; readonly turn: number } | null;
}

export function initialState(seed: string): GameState {
  return {
    seed,
    rng: null,
    rollsIssued: 0,
    creatures: {},
    combat: null,
    scene: null,
    eventCount: 0,
    castingsBegun: 0,
    castingsEnded: [],
    appliedCommands: {},
    elapsed: 0,
    timers: {},
    pendingSaves: {},
    scheduledDamage: {},
    pendingAttack: null,
    pendingMove: null,
    pendingCastings: {},
    pendingDamage: null,
    pendingTest: null,
    ongoing: {},
    owedAreaEffects: [],
    areaTriggers: {},
    pendingTurnStart: null,
  };
}

/** One kind of thing, and how many of it. */
export interface InventoryLine {
  readonly id: string;
  readonly quantity: number;
}

