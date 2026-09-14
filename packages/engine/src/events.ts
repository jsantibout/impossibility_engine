import type { Ability, CharacterId, ConditionName, RollMode } from '@ie/shared';
import type { CharacterSheet, GrantedArmorClass } from './character.js';
import { rollModifierKey, type ActiveRollModifier } from './roll-modifiers.js';
import { ROUND } from './clock.js';
import type { RngState } from './dice.js';
import {
  applyCondition,
  conditionState,
  isIncapacitated,
  removeCondition,
  removeConditionInstance,
  setExhaustion,
  type ConditionState,
} from './conditions.js';
import {
  declarePool,
  resize,
  resourceState,
  restore,
  restoreOn,
  spend as spendResource,
  type PoolDeclaration,
  type Recovery,
  type ResourceState,
} from './resources.js';
import type { CharacterRecord } from './creation.js';
import type {
  DamageComponent,
  DamageDefenses,
  DamageReduction,
  GrantedDefense,
} from './attack.js';
import type { D20TestResult } from './checks.js';
import type { ReactionOffer, ReactionWindow } from './reactions.js';
import type { ActiveBonus } from './bonuses.js';
import { itemFor } from './catalogue.js';
import { READY, universalAction } from './actions.js';
import { noSpellcasting, type SpellcastingState } from './spellcasting.js';
import type { RestBenefit, RestKind, RestState } from './rest.js';
import {
  hasExpired,
  isDue,
  pendingSaveKey,
  scheduledDamageKey,
  timerKey,
  type Deadline,
  type EffectTarget,
  type PendingSave,
  type RepeatSave,
  type EffectCheck,
  type ScheduledDamage,
  type TimeView,
  type TimedEffect,
} from './duration.js';
import {
  areaStampKey,
  castingIdOf,
  castingNumber,
  type AreaMoment,
  type AreaTriggerStamp,
  type CastingTime,
  type Concentration,
  type ConcentrationEndReason,
  type OngoingEndReason,
  type OngoingSpell,
  type OwedAreaEffect,
  type SlotlessReason,
} from './spells.js';
import {
  advanceTurn,
  dash,
  disengage,
  markFeatureUsed,
  markSpellSlotSpent,
  startCombat,
  spendAction,
  spendBonusAction,
  spendAttack,
  spendMovement,
  spendReaction,
  useFreeInteraction,
  removeCombatant,
  swapInitiative,
  type CombatState,
  type CombatantInput,
} from './combat.js';
/**
 * The one Speed reader, asked by the fold for exactly the reason the command
 * asks it: a reducer backstop measuring against a different number is a fork
 * rather than a guard.
 *
 * **Not a cycle, and not a catalogue lookup.** `standing.ts` imports
 * `GameState` from here `type`-only, so the runtime edge runs one way; and
 * every input `speedOf` reads is log-held — the pinned combatant speed,
 * `sheet.standing` carried by `character-created`, `equipped`, conditions — so
 * the fence `upgradeOngoing` stands behind is intact and a future correction
 * to the Monk table changes future sheets rather than historical folds.
 */
import { speedOf } from './standing.js';
import {
  addLandmark,
  areaPointAt,
  creaturesInArea,
  declareCover,
  declareSight,
  dismount,
  mount,
  moveCreature,
  placeCreature,
  removeCreature,
  scene,
  type AreaOrigin,
  type AreaShape,
  type CoverDegree,
  type PointAnchoring,
  type Placement,
  type PositionState,
  type SceneExtent,
  type Point,
} from './positioning.js';
// **Type-only, deliberately.** The fold does not open the spell catalogue: a
// casting's area and its clauses are pinned on the ongoing record at the cast,
// so a replay answers out of the log rather than out of this week's
// definitions. The one lookup left is `upgradeOngoing`, which is for a record
// written before that field existed — see `ongoing-compatibility.ts`.
import type { AreaTrigger, SpellArea } from './spell-definitions.js';
import { upgradeOngoing } from './ongoing-compatibility.js';
import {
  applyDamageToVitals,
  grantTemporaryHp,
  heal,
  resolveDeathSave,
  stabilize,
  vitals,
  type Vitals,
} from './vitals.js';

/**
 * The event log.
 *
 * `GameState` is a fold over a list of `GameEvent`s; nothing mutates state by
 * any other route. That is what makes a campaign replayable, auditable — "show
 * me exactly why the goblin died" — and testable end to end.
 *
 * **Events carry resolved outcomes, not intents.** A die is rolled once, when
 * it is rolled, and the result is recorded forever. Replaying the log applies
 * those recorded numbers; it does not roll again. The alternative, replaying
 * intents through the rules, would mean every future rules fix silently
 * rewrote history and a campaign played last week resolved differently today.
 *
 * So randomness enters the log exactly once, at the point of the roll. From
 * there on the fold is a pure function of what is written down, and the seed
 * and generator state are recorded only so a *live* session can carry on
 * rolling where it left off.
 */

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
   * A spell declared and not yet resolved, held open so it can be interrupted.
   *
   * The third debt of this shape, and the one whose costs are split: the
   * action is already spent and the slot is not. See {@link PendingCasting}.
   */
  readonly pendingCasting: PendingCasting | null;
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
    pendingCasting: null,
    pendingDamage: null,
    pendingTest: null,
    ongoing: {},
    owedAreaEffects: [],
    areaTriggers: {},
    pendingTurnStart: null,
  };
}

export type GameEvent =
  // — the cast ————————————————————————————————————————————————
  | {
      readonly type: 'creature-added';
      readonly id: CharacterId;
      readonly name: string;
      readonly sheet: CharacterSheet;
      readonly maxHp: number;
      readonly diesAtZero?: boolean;
      /** Humanoid, Fey, Dragon. Absent means nobody has said. */
      readonly creatureType?: string;
      /** What this creature resists, is immune to, or is vulnerable to. */
      readonly defenses?: Readonly<Record<string, DamageDefenses>>;
      /** Which side of the fight this creature is on. See {@link CreatureState.side}. */
      readonly side?: string;
    }
  /**
   * A named bonus starts or stops applying to a creature's rolls.
   *
   * Separate from a condition because it is not one: Bless imposes nothing,
   * it changes arithmetic. Conditions already have a home and a vocabulary,
   * and stretching them to cover "+1d4 on saves" would lose both.
   */
  | {
      readonly type: 'bonus-applied';
      readonly id: CharacterId;
      readonly bonus: ActiveBonus;
    }
  | {
      readonly type: 'bonus-removed';
      readonly id: CharacterId;
      readonly source: string;
      readonly command?: CommandStamp;
    }

  /**
   * An ongoing effect supplies an alternative **base** Armour Class.
   *
   * Its own event rather than a `bonus-applied` with a flag, because it is its
   * own rule: a bonus adds to whatever the creature already calculates and
   * this replaces the calculation, competing with every other way of arriving
   * at one. SRD Multiclassing: "If you have multiple ways to calculate your
   * Armor Class, you can benefit from only one at a time."
   *
   * Ended by the casting in its `source`, exactly as a bonus is, so there is
   * no removal event: `releaseCasting` is the one door.
   */
  | {
      readonly type: 'armor-class-granted';
      readonly id: CharacterId;
      readonly armorClass: GrantedArmorClass;
    }

  /**
   * An ongoing effect grants Advantage or Disadvantage on a kind of roll.
   *
   * Its own event rather than a `bonus-applied` carrying a mode, because a
   * mode is not a bonus: a bonus adds and stacks, a mode is presence and
   * cancels, and — the part no bonus can express — a mode may attach to rolls
   * made **against** the creature holding it rather than by them.
   *
   * Ended by the casting in its `source`, exactly as a bonus and an Armour
   * Class are, so there is no removal event: `releaseCasting` is the one door.
   */
  | {
      readonly type: 'roll-modifier-granted';
      readonly id: CharacterId;
      readonly modifier: ActiveRollModifier;
    }

  /**
   * An ongoing effect grants Resistance, Immunity or Vulnerability.
   *
   * Its own event rather than a second `creature-added`-style table write,
   * because what a creature *is* and what a spell has *done to it* are two
   * facts with two lifetimes: the stat block's entries stand for ever and this
   * one ends with the casting in its `source`. SRD Stoneskin: "Until the spell
   * ends, one willing creature you touch has Resistance to Bludgeoning,
   * Piercing, and Slashing damage."
   *
   * Ended by the casting in its `source`, exactly as a bonus, an Armour Class
   * and a roll modifier are, so there is no removal event: `releaseCasting`
   * and the `grants` timer are the doors.
   */
  | {
      readonly type: 'damage-defense-granted';
      readonly id: CharacterId;
      readonly defense: GrantedDefense;
    }

  /**
   * What a creature can cast, declared rather than derived.
   *
   * A character's spellcasting comes from their choices, which is why
   * `character-created` carries it. Everything else that casts — an NPC
   * Cleric, a monster with innate spells — has no class table to derive from,
   * so it is stated. Same rule as a stat block's Armour Class: printed wins.
   */
  | {
      readonly type: 'spellcasting-declared';
      readonly id: CharacterId;
      readonly spellcasting: SpellcastingState;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'creature-removed';
      readonly id: CharacterId;
      readonly command?: CommandStamp;
    }

  // — vitals ——————————————————————————————————————————————————
  /** The amount is already rolled and already reduced by the target's defences. */
  | {
      readonly type: 'damage-taken';
      readonly id: CharacterId;
      readonly amount: number;
      readonly critical?: boolean;
      /** Where it came from, for the audit trail. */
      readonly source?: string;
      /**
       * Which creature dealt it, where one did.
       *
       * `source` is prose — `'a trap'`, `'Longsword'` — and prose cannot be
       * aimed at. SRD Hellish Rebuke answers "taking damage from a creature
       * that you can see" by burning "the creature that damaged you", so
       * something has to be an id. Absent is a real answer and the common one:
       * a falling rock has no dealer, and there is nothing to rebuke.
       */
      readonly by?: CharacterId;
      /** The command that caused it, so a retry is recognised as one. */
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'healed';
      readonly id: CharacterId;
      readonly amount: number;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'temporary-hp-granted';
      readonly id: CharacterId;
      readonly amount: number;
      readonly command?: CommandStamp;
    }
  /**
   * SRD: "Temporary Hit Points last until they're depleted or you finish a
   * Long Rest." They are not hit points, so healing does not clear them and
   * the rest has to say so itself.
   */
  | { readonly type: 'temporary-hp-cleared'; readonly id: CharacterId }
  /** The die is already rolled; this records what it was. */
  | {
      readonly type: 'death-save-recorded';
      readonly id: CharacterId;
      /** The die that counted — it alone decides a natural 1 or 20. */
      readonly natural: number;
      /** The modified total, when something added to the roll. */
      readonly total?: number;
    }
  | { readonly type: 'stabilised'; readonly id: CharacterId; readonly command?: CommandStamp }

  // — conditions ——————————————————————————————————————————————
  | {
      readonly type: 'condition-applied';
      readonly id: CharacterId;
      readonly condition: ConditionName;
      /**
       * What caused it. Two effects can impose the same condition, and lifting
       * one must not lift the other, so the cause is part of the record.
       */
      readonly source: string;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'condition-removed';
      readonly id: CharacterId;
      readonly condition: ConditionName;
      /** Lift only this cause. Omitted, every instance of the condition goes. */
      readonly source?: string;
    }
  | {
      readonly type: 'exhaustion-set';
      readonly id: CharacterId;
      readonly level: number;
      readonly command?: CommandStamp;
    }
  // — what a creature owns ———————————————————
  /**
   * Items arriving or leaving, by catalogue id.
   *
   * One event for a whole batch, because a starting package or a pack is one
   * transaction: a character never half-receives a Scholar's Pack.
   */
  | {
      readonly type: 'items-gained';
      readonly id: CharacterId;
      readonly items: readonly InventoryLine[];
      readonly source: string;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'items-lost';
      readonly id: CharacterId;
      readonly items: readonly InventoryLine[];
      readonly source: string;
      readonly command?: CommandStamp;
    }
  /** Money in or out, in copper. Negative spends. */
  | {
      readonly type: 'coins-changed';
      readonly id: CharacterId;
      readonly copper: number;
      readonly source: string;
    }
  /**
   * Something worn or wielded, or put away.
   *
   * Armour Class reads what is equipped, so this is also what moves the
   * sheet's armour and shield — a chain shirt in a backpack protects nobody.
   */
  | {
      readonly type: 'item-equipped';
      readonly id: CharacterId;
      readonly item: string;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'item-unequipped';
      readonly id: CharacterId;
      readonly item: string;
      readonly command?: CommandStamp;
    }

  /** Establishing a fact the engine was missing, so a rule can read it. */
  | {
      readonly type: 'creature-type-declared';
      readonly id: CharacterId;
      readonly creatureType: string;
      readonly command?: CommandStamp;
    }
  /**
   * Death that does not come from running out of hit points — Exhaustion
   * reaching 6, a spell that simply kills. Damage is the wrong instrument for
   * these: a healthy creature taking exactly its maximum in damage drops to 0,
   * it does not die.
   */
  | {
      readonly type: 'creature-died';
      readonly id: CharacterId;
      readonly cause: string;
      readonly command?: CommandStamp;
    }

  // — resources —————————————————————————
  /**
   * A pool exists because something declared it, never because it was derived
   * from a level. Class tables are not modelled; see `resources.ts`.
   */
  | {
      readonly type: 'resource-pool-declared';
      readonly id: CharacterId;
      readonly pool: PoolDeclaration;
    }
  /**
   * Uses taken out of a pool on their own, rather than as part of a casting.
   * Spending a Hit Die on a Short Rest is the first of these.
   */
  | {
      readonly type: 'resource-spent';
      readonly id: CharacterId;
      readonly key: string;
      readonly amount: number;
      /**
       * The command this spend settles, where the spend is the only event a
       * command always emits.
       *
       * Lay On Hands is the case: a touch that only lifts a condition heals
       * nothing and rolls nothing, so the stamp has nowhere else to ride — and
       * a guard whose event never happens is a guard that never fires, which
       * is the lesson an effect check against an illusion already taught.
       */
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'resources-restored';
      readonly id: CharacterId;
      readonly recovers: Recovery;
      /**
       * SRD's partial rule makes this anything but idempotent: "you regain
       * **one** expended use when you finish a Short Rest" subtracts from
       * `spent`, so a retried restoration gives back two.
       */
      readonly command?: CommandStamp;
    }
  /**
   * Uses given back to **one** pool, by something that is not a rest.
   *
   * `resources-restored` beside it refills every pool carrying a recovery tag
   * and is what a rest emits; this names a single pool and an amount, which is
   * what a feature like Sorcerous Restoration gives. The two are a letter
   * apart in spelling and nothing alike in effect, so they are spelled
   * differently on purpose.
   */
  | {
      readonly type: 'resource-regained';
      readonly id: CharacterId;
      readonly key: string;
      readonly amount: number;
      readonly command?: CommandStamp;
    }
  /**
   * A pool's maximum changing, which is what levelling up does to Hit Dice and
   * spell slots. What has already been spent stays spent.
   */
  | {
      readonly type: 'resource-pool-resized';
      readonly id: CharacterId;
      readonly key: string;
      readonly max: number;
    }

  // — characters —————————————————————
  /** The choices a character was built from, so it can be rebuilt and advanced. */
  | {
      readonly type: 'character-created';
      readonly id: CharacterId;
      readonly record: CharacterRecord;
      /** What the choices came to: cantrips, prepared spells, feat grants. */
      readonly spellcasting: SpellcastingState;
      /** What a feat adds to Initiative, so the roll never has to be told. */
      readonly initiativeBonuses: readonly { readonly source: string; readonly flat: number }[];
    }
  | {
      readonly type: 'character-advanced';
      readonly id: CharacterId;
      readonly record: CharacterRecord;
      /** The sheet the new level derives, replacing the old one wholesale. */
      readonly sheet: CharacterSheet;
      readonly spellcasting: SpellcastingState;
      readonly initiativeBonuses: readonly { readonly source: string; readonly flat: number }[];
    }
  /** Gaining a level raises the maximum without healing what was lost. */
  | {
      readonly type: 'hit-point-maximum-raised';
      readonly id: CharacterId;
      readonly amount: number;
    }

  // — casting ——————————————————————————
  /**
   * One casting of one spell, with its own identity.
   *
   * The slot is expended here, which is why the event carries the pool it came
   * from: replay must reproduce the expenditure without re-deciding it.
   */
  | {
      readonly type: 'spell-cast';
      /** Sequential — `cast:1`, `cast:2` — and checked on replay. */
      readonly castingId: string;
      readonly id: CharacterId;
      readonly spell: string;
      /** The level it was cast at, which is the slot's level when upcast. */
      readonly level: number;
      readonly slot: { readonly key: string; readonly level: number } | null;
      readonly slotless: SlotlessReason | null;
      readonly castingTime: CastingTime;
      readonly concentration: boolean;
      /**
       * Which grant supplied the spell — a class id, or a granting feature's.
       *
       * `castSpell` has written this since routes landed and the event did not
       * declare it, so it reached the log and no reader could see it: excess
       * properties on a union are accepted if **any** member declares one, and
       * `PendingCasting` does. Declared now because the ongoing record pins it,
       * and a later activation has to roll the numbers the casting rolled.
       */
      readonly route?: string;
      /** The command that caused it, so a retry is recognised as one. */
      readonly command?: CommandStamp;
    }
  /**
   * A casting that is still running, recorded the moment it starts to.
   *
   * Its own event rather than a field on `spell-cast`, because it says
   * something different: `spell-cast` is "this casting happened and cost
   * this", which is true of Fireball, and this is "and it is still going",
   * which is not. One event, one thing — and a log reader can see exactly
   * where a spell became something a later turn could act on.
   */
  | { readonly type: 'spell-ongoing'; readonly casting: OngoingSpell }
  /**
   * An ongoing spell stopped because somebody decided it should.
   *
   * `on` is the whole of the distinction SRD Dispel Magic draws between its
   * two kinds of target: null ends the casting and everything it created,
   * a creature releases it on that creature and leaves the casting running
   * for anyone else it caught. The engine has had both operations since Hold
   * Person's repeat save; this is the event that names which one.
   *
   * Expiry and a broken Concentration are **not** here. Nobody decides those,
   * so they are derived by the reducer and write nothing, which is the audit
   * trade `CLAUDE.md` already records for every other derived ending.
   */
  | {
      readonly type: 'spell-ended';
      readonly castingId: string;
      /** The creature it is released on, or null for the whole casting. */
      readonly on: CharacterId | null;
      readonly reason: OngoingEndReason;
      readonly command?: CommandStamp;
    }
  /**
   * An ongoing spell was used again on a later turn.
   *
   * Changes no state — the action it costs and the damage it deals are their
   * own events — so this is `roll-recorded`'s shape and exists for the same
   * two reasons: without it the log shows an attack with no visible cause, and
   * a command whose only other events may be a miss has nowhere to put its
   * stamp.
   */
  | {
      readonly type: 'spell-activated';
      readonly castingId: string;
      readonly by: CharacterId;
      readonly command?: CommandStamp;
    }
  /**
   * The point an ongoing spell holds is now somewhere else.
   *
   * SRD Spiritual Weapon: "you can move the force up to 20 feet". Resolved
   * history, not intent — by the time this is written the caster has spent the
   * Bonus Action that moved it and the engine has checked the twenty feet.
   *
   * It carries the destination rather than an offset so that folding the log
   * reconstructs the point without doing arithmetic, and no `by`: only the
   * caster may move it and the ongoing record already names them.
   *
   * Its own event rather than a field on `spell-activated`, because the move
   * is optional and the activation is not — one event, one thing. The command
   * stamp therefore rides on `spell-activated`, which always happens.
   */
  | {
      readonly type: 'spell-origin-moved';
      readonly castingId: string;
      readonly to: Point;
    }
  /**
   * An effect a persistent area owed a creature has been dealt.
   *
   * Resolved history: the save was rolled and the damage or the condition
   * landed as their own events beside this one, and this says which debt they
   * discharge. Its shape is `effect-save-resolved`'s — the same "and that
   * obligation is now met" the repeat save already writes — and it names the
   * casting, the creature and the moment rather than a key, because the debt
   * is identified by what happened rather than by where it was filed.
   */
  | {
      readonly type: 'area-effect-settled';
      readonly castingId: string;
      readonly target: CharacterId;
      readonly moment: AreaMoment;
      readonly command?: CommandStamp;
    }
  /**
   * A casting begun and held open, so that a Reaction can answer it.
   *
   * SRD Counterspell interrupts "a creature in the process of casting a
   * spell", and this is that process made mechanical. It is not an *intent*
   * event: by the time it is written the caster has irrevocably spent the
   * action the spell cost and has lost any Concentration they were holding, so
   * it records things that have already happened. What it deliberately does
   * not do is expend the slot — SRD gives that back, which means it was never
   * taken, so the settling `spell-cast` is what spends it.
   *
   * The casting id is allocated here, not at settlement, because the whole
   * point is that other mechanics can name this casting while it is open.
   */
  | {
      readonly type: 'spell-declared';
      readonly casting: PendingCasting;
      readonly command?: CommandStamp;
    }
  /**
   * A declared casting that never took effect.
   *
   * SRD Counterspell: "the spell dissipates with no effect." Nothing is
   * refunded because nothing beyond the action was spent, and the action is
   * "wasted" by the same sentence. The only state this changes is that the
   * window closes.
   */
  | {
      readonly type: 'spell-interrupted';
      readonly castingId: string;
      readonly id: CharacterId;
      /** Who interrupted it, or null when it lapsed with its caster. */
      readonly by: CharacterId | null;
      readonly reason: 'countered' | 'caster-left';
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'concentration-started';
      readonly id: CharacterId;
      readonly castingId: string;
      readonly spell: string;
      readonly level: number;
    }
  /**
   * Concentration ending by choice or by a failed save.
   *
   * Ending it also ends everything that casting created — SRD: "If the
   * effect's creator loses Concentration, the effect ends" — which the reducer
   * does by the casting id carried in each effect's source, rather than the
   * command enumerating a list a retry could find stale.
   */
  | {
      readonly type: 'concentration-ended';
      readonly id: CharacterId;
      readonly castingId: string;
      readonly reason: ConcentrationEndReason;
      readonly command?: CommandStamp;
    }

  // — the clock ————————————————————————
  /**
   * Time passing outside combat, because somebody said it did.
   *
   * Inside combat the clock is derived — a round is six seconds, and nobody
   * decides that. Out of combat, how long the party spent searching the vault
   * is narration, so it arrives as an event.
   */
  | {
      readonly type: 'time-advanced';
      readonly seconds: number;
      readonly reason: string;
      readonly command?: CommandStamp;
    }

  // — rests ————————————————————————————
  /**
   * An effect given a moment to stop at.
   *
   * The deadline is already resolved: a relative duration that could not be
   * answered — "the start of your next turn", asked outside combat — is
   * refused by the command, so nothing unanswerable reaches the log.
   */
  | {
      readonly type: 'effect-scheduled';
      readonly target: EffectTarget;
      readonly deadline: Deadline;
      /** A save this effect takes at a turn boundary, if it takes one. */
      readonly repeatSave?: RepeatSave;
      /** A check a creature may attempt against it, if the spell offers one. */
      readonly check?: EffectCheck;
      readonly command?: CommandStamp;
    }
  /**
   * An ability check somebody attempted against an ongoing effect, and settled.
   *
   * The roll itself is recorded separately as `roll-recorded`; this is what the
   * outcome *did*. On a success the reducer releases the effect on that
   * creature, so the consequence cannot drift from the roll that caused it —
   * the same split `effect-save-resolved` already makes.
   *
   * Emitted only when the check's success would actually change something. An
   * illusion seen through changes nothing the engine holds, so that check
   * leaves `roll-recorded` alone in the log and this event is absent.
   */
  | {
      readonly type: 'effect-check-resolved';
      readonly effectKey: string;
      /** Who attempted it. */
      readonly by: CharacterId;
      readonly success: boolean;
      readonly command?: CommandStamp;
    }
  /**
   * A turn-boundary save, rolled and settled.
   *
   * The roll itself is recorded separately as `roll-recorded`; this is what
   * the outcome *did*. On a success the reducer ends the effect — on that
   * target, or on the whole casting, as the hook says — so the consequence
   * cannot drift from the roll that caused it.
   */
  | {
      readonly type: 'effect-save-resolved';
      readonly effectKey: string;
      readonly turn: number;
      readonly success: boolean;
    }
  /**
   * Damage a spell promised for a later moment.
   *
   * SRD Acid Arrow's "2d4 Acid damage at the end of its next turn". The dice
   * are a notation rather than a total: the roll belongs to the moment, not to
   * the casting, and a number written down here would be a number the log knew
   * before the thing that produced it.
   */
  | {
      readonly type: 'damage-scheduled';
      readonly schedule: ScheduledDamage;
      readonly command?: CommandStamp;
    }
  /**
   * A scheduled hit, collected.
   *
   * This clears the debt and nothing else — the damage itself arrives as the
   * ordinary `damage-taken` events beside it, so there is exactly one path by
   * which a creature loses hit points and every rule that hangs off it
   * (Concentration, Temporary Hit Points, dropping to 0) keeps working.
   */
  | {
      readonly type: 'scheduled-damage-collected';
      readonly key: string;
    }

  | {
      readonly type: 'rest-begun';
      readonly id: CharacterId;
      readonly kind: RestKind;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'rest-ended';
      readonly id: CharacterId;
      readonly kind: RestKind;
      /** What it earned, which is not always what was attempted. */
      readonly benefit: RestBenefit;
      readonly interrupted?: string;
    }



  // — combat ——————————————————————————————————————————————————
  | {
      readonly type: 'combat-started';
      readonly combatants: readonly CombatantInput[];
      readonly command?: CommandStamp;
    }
  | { readonly type: 'combat-ended' }
  /**
   * The turn moved on.
   *
   * Carries a stamp because a retried advance is the one duplicate nobody
   * notices: it does not double an effect, it **skips a combatant's whole
   * turn**, and the log that results looks perfectly well-formed.
   */
  | { readonly type: 'turn-advanced'; readonly command?: CommandStamp }
  | { readonly type: 'action-spent'; readonly id: CharacterId }
  | { readonly type: 'bonus-action-spent'; readonly id: CharacterId }
  | { readonly type: 'reaction-spent'; readonly id: CharacterId }
  | { readonly type: 'movement-spent'; readonly id: CharacterId; readonly feet: number }
  /**
   * One attack of an Attack action.
   *
   * Not `action-spent`, because the action is taken once and holds however
   * many attacks a feature puts in it. The reducer works out which of the two
   * this is, from the budget and the sheet.
   */
  | { readonly type: 'attack-made'; readonly id: CharacterId }
  | { readonly type: 'dash-taken'; readonly id: CharacterId; readonly command?: CommandStamp }
  | {
      readonly type: 'disengage-taken';
      readonly id: CharacterId;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'free-interaction-used';
      readonly id: CharacterId;
      readonly command?: CommandStamp;
    }
  | { readonly type: 'combatant-removed'; readonly id: CharacterId }
  | {
      readonly type: 'initiative-swapped';
      readonly a: CharacterId;
      readonly b: CharacterId;
      readonly command?: CommandStamp;
    }

  // — the map ——————————————————————————————————————————————————
  /**
   * The three that lay out a scene, each carrying the stamp of the command
   * that declared it.
   *
   * **The stamp is declared, not merely emitted.** Excess-property checking on
   * a union accepts a field *any* member declares, so a command could write
   * `command` onto an event whose own type says nothing about it and no reader
   * would see the difference — which is the trap this file has recorded twice,
   * once for a `command` stamp and once for a casting's `route`. `recordCommand`
   * is generic and would remember it either way; that is exactly why the
   * declaration has to be here rather than inferred from the fold happening to
   * work.
   */
  | { readonly type: 'scene-set'; readonly extent: SceneExtent; readonly command?: CommandStamp }
  | {
      readonly type: 'landmark-added';
      readonly name: string;
      readonly at: { x: number; y: number; z: number };
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'creature-placed';
      readonly id: CharacterId;
      readonly placement: Placement;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'creature-moved';
      readonly id: CharacterId;
      readonly placement: Placement;
      readonly forced?: boolean;
      /**
       * A move that provoked nothing is the whole command, so the stamp rides
       * here. The provoked path stamps `movement-declared` instead, because
       * there the move is only declared and something else completes it —
       * and a `creature-moved` emitted by that completion is derived, so it
       * carries no stamp of its own.
       */
      readonly command?: CommandStamp;
    }
  | { readonly type: 'creature-unplaced'; readonly id: CharacterId }
  /**
   * Which side of the fight a creature is on.
   *
   * Declared rather than derived, like cover and line of sight, and its own
   * event because it changes in play: a bandit is bribed, a charmed ally turns,
   * a summoned creature is dismissed. SRD leans on "your allies" constantly and
   * never defines it mechanically, because at a table nobody has to ask.
   */
  | {
      readonly type: 'creature-side-declared';
      readonly id: CharacterId;
      readonly side: string;
      readonly command?: CommandStamp;
    }
  /**
   * An attack hit, and its damage is being held for a moment.
   *
   * SRD Divine Smite is taken "immediately after hitting a target", so there
   * has to *be* an after-hitting. This records the hit; `attack-damage-dealt`
   * closes it, and the reducer refuses a second one while it stands.
   */
  | {
      readonly type: 'attack-landed';
      readonly attack: PendingAttack;
      readonly command?: CommandStamp;
    }
  /**
   * A move was declared and provoked somebody, so it is waiting.
   *
   * The creature has not moved yet — that is the point. `movement-completed`
   * closes it, and the reducer refuses a second one while it stands.
   */
  | {
      readonly type: 'movement-declared';
      readonly move: PendingMove;
      readonly command?: CommandStamp;
    }
  /** One provoked creature has answered, by attacking or by passing. */
  | {
      readonly type: 'opportunity-answered';
      readonly reactor: CharacterId;
      readonly took: boolean;
      readonly command?: CommandStamp;
    }
  /** Every Reaction is settled; the move happens. */
  | { readonly type: 'movement-completed'; readonly id: CharacterId }
  /** The held attack's damage has been rolled; the debt is closed. */
  | {
      readonly type: 'attack-damage-dealt';
      readonly attacker: CharacterId;
      readonly command?: CommandStamp;
    }
  /**
   * Damage was rolled and somebody may answer it before it lands.
   *
   * No hit points move here — that is the point. `damage-settled` closes it and
   * the ordinary `damage-taken` follows, and the reducer refuses a second one
   * while it stands.
   */
  | { readonly type: 'damage-rolled'; readonly damage: PendingDamage }
  /**
   * One offered creature has answered a held damage roll, by reducing it or by
   * passing.
   *
   * `took` is what tells the two apart in a log, exactly as it does on
   * `opportunity-answered`. The Reaction and the pool use are their own events
   * beside this one, so this says only that the offer is spent.
   */
  | {
      readonly type: 'damage-reaction-answered';
      readonly reactor: CharacterId;
      readonly took: boolean;
      readonly feature?: string;
      /** What came off the total, when something did. */
      readonly reduction?: DamageReduction;
      readonly command?: CommandStamp;
    }
  /** Every offer is settled; what remains is dealt. */
  | {
      readonly type: 'damage-settled';
      readonly target: CharacterId;
      readonly command?: CommandStamp;
    }
  /**
   * A D20 Test landed and somebody may push it before its effects occur.
   *
   * Carries the resolved roll, because the die has been thrown and the number
   * is history — see {@link PendingTest}.
   */
  | { readonly type: 'test-rolled'; readonly test: PendingTest }
  /**
   * One offered creature has answered a held D20 Test.
   *
   * The new result rides on the event rather than being recomputed, for the
   * same reason every other outcome does: replaying must not reroll. A pass
   * carries none.
   */
  | {
      readonly type: 'test-reaction-answered';
      readonly reactor: CharacterId;
      readonly took: boolean;
      readonly feature?: string;
      readonly result?: D20TestResult;
      readonly command?: CommandStamp;
    }
  /**
   * The test is final.
   *
   * Nothing mechanical happens here, and that is the honest record: a
   * standalone check or save is a number the engine owns and a consequence the
   * table owns. The window existed so the number could be pushed, not so the
   * engine could decide what it meant.
   */
  | { readonly type: 'test-settled'; readonly who: CharacterId; readonly command?: CommandStamp }
  /**
   * A Reaction was taken at a window that holds nothing back.
   *
   * `damaged-by-creature` is settled before anybody answers it: the hit points
   * have already moved and no outcome is waiting. So there is no hold to close
   * and nothing to record the Reaction except this, which changes no state —
   * the same shape `roll-recorded` has, and for the same reason. Without it a
   * log shows an attack taken out of turn and no reason for it.
   */
  | {
      readonly type: 'reaction-taken';
      readonly reactor: CharacterId;
      readonly window: ReactionWindow;
      readonly feature: string;
      /** The creature it answers. */
      readonly against: CharacterId;
      readonly command?: CommandStamp;
    }
  /**
   * A feature switched on, with whatever it costs already spent beside it.
   *
   * The cost is separate events — `resource-spent`, the action economy — so
   * this one says only that the feature is now running. That keeps the
   * activation readable in a log and keeps this event from having to know how
   * any particular feature is paid for.
   */
  | {
      readonly type: 'feature-activated';
      readonly id: CharacterId;
      readonly feature: string;
      readonly command?: CommandStamp;
    }
  /**
   * A once-per-turn feature spending its allowance for this turn.
   *
   * SRD Sneak Attack is "Once per turn", Colossus Slayer "only once per turn",
   * Divine Strike "Once on each of your turns" — and the turn is recorded
   * rather than a flag being set, because the distinction is *a* turn, not
   * *your* turn. A Rogue who used it on their own turn may use it again on an
   * Opportunity Attack during somebody else's.
   *
   * Its own event rather than a field on the attack, because one event does
   * one thing: the attack landed, and separately the feature that rode on it
   * used up its allowance.
   */
  | {
      readonly type: 'feature-used';
      readonly id: CharacterId;
      readonly feature: string;
      /** The turn it was used on, from the combat's own never-reused counter. */
      readonly turn: number;
    }
  /**
   * An action held back for a trigger.
   *
   * The Ready action's own cost is a separate `action-spent`, and a readied
   * spell's cost is the ordinary `spell-cast` beside it, so this event says
   * only what is being held and what for.
   */
  | {
      readonly type: 'readied-declared';
      readonly id: CharacterId;
      readonly readied: ReadiedAction;
      readonly command?: CommandStamp;
    }
  /**
   * The held action was let go — taken, or the trigger ignored.
   *
   * SRD: "you can either take your Reaction right after the trigger finishes
   * or ignore the trigger." Ignoring costs nothing, so `took` is what tells
   * the two apart in a log; the Reaction itself is its own event either way.
   */
  | {
      readonly type: 'readied-released';
      readonly id: CharacterId;
      readonly took: boolean;
      readonly command?: CommandStamp;
    }
  /**
   * A feature switched off, and why.
   *
   * `expired` and `incapacitated` are derived — a deadline passing and the
   * Incapacitated condition arriving are not decisions anybody makes — so they
   * arrive through the reducer rather than through a command, exactly as a
   * broken Concentration does.
   */
  | {
      readonly type: 'feature-ended';
      readonly id: CharacterId;
      readonly feature: string;
      readonly reason: 'dismissed' | 'expired' | 'incapacitated' | 'heavy-armor';
      readonly command?: CommandStamp;
    }
  /**
   * Whether one creature can see another.
   *
   * Declared, like cover: computing it means modelling walls, and that is
   * where a rules engine becomes a VTT.
   */
  | {
      readonly type: 'sight-declared';
      readonly from: CharacterId;
      readonly to: CharacterId;
      readonly seen: boolean;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'cover-declared';
      readonly from: CharacterId;
      readonly to: CharacterId;
      readonly degree: CoverDegree;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'mounted';
      readonly rider: CharacterId;
      readonly mount: CharacterId;
      readonly willing: boolean;
      /**
       * Mounting costs half the rider's Speed, so the command emits a
       * `movement-spent` beside this — but only in combat, where there is a
       * budget to spend from. The stamp therefore rides here, on the event
       * that always happens.
       */
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'dismounted';
      readonly rider: CharacterId;
      readonly placement: Placement;
      readonly command?: CommandStamp;
    }

  /**
   * A roll and everything that shaped it, recorded for the audit trail.
   *
   * This changes no state — the consequences arrive as their own events — but
   * without it the log cannot answer "why did the goblin die". A roll that
   * Bardic Inspiration lifted and Cutting Words then cut shows all three
   * contributions with their sources, rather than one unexplained total.
   */
  | {
      readonly type: 'roll-recorded';
      readonly who: CharacterId;
      /** What was being rolled: "Dexterity save", "Longsword attack". */
      readonly label: string;
      readonly natural: number;
      readonly total: number;
      /** Every named contribution, including ones that subtracted. */
      readonly contributions: readonly { readonly source: string; readonly amount: number }[];
      /** How it came out, in the caller's own words. */
      readonly outcome?: string;
      /**
       * The command that produced it, for a command that rolls and may miss.
       *
       * `resolveAttack` needs somewhere to stamp its identity that happens
       * whether or not the attack lands — a miss emits no damage, so stamping
       * the damage would leave a missed swing retryable and rolled twice. This
       * event still changes no game state; it only reaches the ledger that
       * makes a retry a no-op.
       */
      readonly command?: CommandStamp;
    }

  // — dice ——————————————————————————————————————————————————————
  /**
   * Records that rolls happened, so a resumed session picks the generator up
   * where it left off rather than replaying the same numbers.
   */
  | {
      readonly type: 'rolls-issued';
      readonly count: number;
      readonly rng: RngState;
      /**
       * The command that issued them, for a settlement whose only guaranteed
       * event this is.
       *
       * `resolvePendingSaves` rolls the turn's owed saves and writes nothing
       * else that always happens — a failed save settles no effect — so this
       * is where its identity has to ride.
       */
      readonly command?: CommandStamp;
    };

/**
 * A log that cannot be applied is corrupt, not a rules dispute.
 *
 * Rules-legal refusals never become events: the command layer asks the engine
 * first and emits nothing if the answer is no. So by the time an event exists
 * it has already been validated, and a failure here means the log and the code
 * disagree — which should be loud.
 */
class CorruptLogError extends Error {
  constructor(event: GameEvent, reason: string) {
    super(`cannot apply ${event.type}: ${reason}`);
    this.name = 'CorruptLogError';
  }
}

/**
 * Install a new combat state and charge the clock for any rounds it crossed.
 *
 * SRD: "A round represents about 6 seconds in the game world." A round ends
 * when the Initiative order wraps — and `advanceTurn` is not the only thing
 * that wraps it. Removing the combatant who was acting, when they were last in
 * the order, also starts a new round. That path used to change the round and
 * not the clock, so a fight where enemies died on their own turns ran fast:
 * rounds ticked by and game time did not.
 *
 * One place, applied to every transition, so the two can never disagree again.
 * Transitions that do not cross a round cost nothing, which is most of them.
 */
const withCombat = (next: GameState, state: GameState, combat: CombatState): GameState => ({
  ...next,
  combat,
  elapsed: state.elapsed + Math.max(0, combat.round - (state.combat?.round ?? combat.round)) * ROUND,
});

const creatureOf = (state: GameState, event: GameEvent, id: CharacterId): CreatureState => {
  const creature = state.creatures[id];
  if (creature === undefined) throw new CorruptLogError(event, `${id} is not in this game`);
  return creature;
};

const withCreature = (
  state: GameState,
  id: CharacterId,
  patch: Partial<CreatureState>,
  creature: CreatureState,
): GameState => ({
  ...state,
  creatures: { ...state.creatures, [id]: { ...creature, ...patch } },
});

const sceneOf = (state: GameState, event: GameEvent): PositionState => {
  if (state.scene === null) throw new CorruptLogError(event, 'no scene has been set');
  return state.scene;
};

const combatOf = (state: GameState, event: GameEvent): CombatState => {
  if (state.combat === null) throw new CorruptLogError(event, 'no combat is running');
  return state.combat;
};

/** Unwrap an engine Result, treating a refusal as a corrupt log. */
function must<T>(event: GameEvent, result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new CorruptLogError(event, result.reason);
  return result.value;
}

/** The id of the nth casting. Sequential and never random, so replay matches. */
export const castingIdFor = (n: number): string => `cast:${n}`;

/**
 * A grant a running effect hung on a creature, read only for what hung it.
 *
 * The four families below all carry more than this — a `Bonus`, a base Armour
 * Class, a `RollModifier`, a list of damage types — and every operation that
 * *ends* one reads nothing but the `source`. So this is the shape the
 * enumerator works in, and it is deliberately the smallest one that answers
 * the question.
 */
interface SourcedGrant {
  readonly source: string;
}

/**
 * The keys of `CreatureState` holding grants a running effect hung there.
 *
 * **Derived from the shape rather than listed.** `bonuses`, `armorClasses`,
 * `rollModifiers` and `grantedDefenses` were enumerated by hand in five
 * separate places — `releaseCasting`, `releaseOnTarget`, `releaseGrants`,
 * `expireEffects` and `holdsNothingOf` — and the fourth of them had to be
 * threaded through every one when it arrived. A fifth added to three of the
 * five is how a grant comes to be released by a dispel and not by a deadline,
 * silently, because each site is correct on its own terms. Deriving the set
 * means a fifth family joins it on the day it is declared, and {@link grantsOf}
 * then stops compiling until the enumerator names it.
 *
 * `initiativeBonuses` matches the shape and is excluded, because it is not a
 * grant: creation derives it from the character's own feats, nothing hangs it
 * on them, and no casting, deadline or dispel takes it away. It was in none of
 * the five walks, and putting it in one would end a feat the rules never ended.
 */
type GrantFamily = Exclude<
  {
    [K in keyof CreatureState]-?: CreatureState[K] extends readonly SourcedGrant[] ? K : never;
  }[keyof CreatureState],
  'initiativeBonuses'
>;

/** What a creature is carrying, by family. */
type HeldGrants = { readonly [K in GrantFamily]: readonly SourcedGrant[] };

/**
 * The four families as one value, and the only place the list is written.
 *
 * The annotation is a mapped type over {@link GrantFamily}, so a fifth family
 * declared on `CreatureState` makes **this literal** a compile error naming the
 * property it lacks. That is the guard: the enumerator cannot quietly stop
 * seeing a family, and there is nowhere else for a hand-kept list to rot.
 *
 * Nothing is copied — each value is the creature's own array.
 */
const grantsOf = (creature: CreatureState): HeldGrants => ({
  bonuses: creature.bonuses,
  armorClasses: creature.armorClasses,
  rollModifiers: creature.rollModifiers,
  grantedDefenses: creature.grantedDefenses,
});

/** How many grants are in a record of families, which a `filter` can only lower. */
const countGrants = (held: Record<string, readonly SourcedGrant[]>): number =>
  Object.values(held).reduce((n, family) => n + family.length, 0);

/**
 * Every source that has hung a grant on this creature.
 *
 * One enumerator over the four families — the bonuses Bless adds, the Armour
 * Class Mage Armor supplies, the Advantage Blur grants, the Resistance
 * Stoneskin grants — so a reader asking "is this casting still holding
 * anything here" asks it once rather than four times.
 *
 * **Sorted and deduplicated**, so the answer is fixed however the families are
 * visited and whatever order the grants arrived in; serialised state reaches
 * the log. One casting commonly grants in several families at once, and every
 * caller is asking whether a source granted anything rather than counting.
 * Beacon of Hope's two roll modifiers come back as one source for the same
 * reason: `rollModifierKey`'s two-part identity decides whether a **re-grant**
 * replaces or stacks, and it is not what an ending matches on — a casting that
 * ends, or a `grants` deadline that arrives, takes both of them.
 *
 * **`scheduledDamage` is not a grant and is deliberately not here.** A hit
 * that is still owed is the casting's debt rather than something the casting
 * is *doing* to the creature — the same reading that keeps a creature Insect
 * Plague merely damaged out of `OngoingSpell.on`. It is not even per-creature:
 * `releaseCasting` drops it through `withoutScheduledDamage`, at state level.
 * Nor are the creature's conditions, which are a link of their own with their
 * own instances and implications; {@link holdsNothingOf} asks them separately.
 */
export function grantSourcesOf(creature: CreatureState): readonly string[] {
  const sources = new Set<string>();
  for (const family of Object.values(grantsOf(creature))) {
    for (const grant of family) sources.add(grant.source);
  }
  return [...sources].sort();
}

/**
 * Every grant whose source the predicate names, taken off all four families.
 *
 * The one removal. The three callers differ only in which sources they name —
 * `releaseCasting` and `releaseOnTarget` match the casting id inside the
 * source, `releaseGrants` matches the bare source a feature's deadline carries
 * — so the predicate is the whole of what varies and the walk is shared.
 *
 * **The creature itself comes back when nothing matched**, by reference, which
 * is load-bearing rather than an optimisation: `releaseCasting` compares
 * identity to decide whether a derived pass touched anybody, and a fresh object
 * every time would mark the whole cast changed on every event.
 */
export function withoutGrants(
  creature: CreatureState,
  doomed: (source: string) => boolean,
): CreatureState {
  const held = grantsOf(creature);
  const kept: Record<string, readonly SourcedGrant[]> = {};
  for (const [family, grants] of Object.entries(held)) {
    kept[family] = grants.filter((grant) => !doomed(grant.source));
  }

  // `filter` only ever removes, so an unchanged total is an unchanged creature.
  if (countGrants(kept) === countGrants(held)) return creature;

  // The cast is sound by construction rather than by assertion: the keys came
  // out of {@link grantsOf}, whose type *is* `GrantFamily`, and `filter`
  // returns the element type it was given. What it buys is that
  // {@link grantsOf} is the **only** list of families — writing the four out
  // again here would be a second place a fifth family has to be added, which is
  // the failure this whole enumerator exists to end, arriving one level up.
  return { ...creature, ...(kept as Pick<CreatureState, GrantFamily>) };
}

/**
 * End a casting: drop the caster's Concentration and every effect that casting
 * created, wherever it landed.
 *
 * The link is the casting id carried in each effect's source, so this removes
 * exactly one Cleric's Hold Person and leaves the other Cleric's standing —
 * and leaves alone anything the casting did not create.
 */
function releaseCasting(
  state: GameState,
  casterId: CharacterId | null,
  castingId: string,
): GameState {
  const creatures: Record<string, CreatureState> = {};
  let changed = false;

  for (const key of Object.keys(state.creatures)) {
    const creature = state.creatures[key];
    if (creature === undefined) continue;

    let updated = creature;

    const doomed = creature.conditions.instances.filter(
      (instance) => castingIdOf(instance.source) === castingId,
    );
    if (doomed.length > 0) {
      let conditions = creature.conditions;
      for (const instance of doomed) conditions = removeConditionInstance(conditions, instance.id);
      updated = { ...updated, conditions };
    }

    // And every grant the casting hung here, through the one enumerator: the
    // bonus Bless adds, the Armour Class Mage Armor supplies, the Advantage
    // Blur grants, the Resistance Stoneskin grants. Same link, same door —
    // Bless stopping when the Cleric's Concentration breaks is not a separate
    // rule from any of the other three, and a convergence point that forgot
    // one kind of debt is the hole `releaseOnTarget`’s bonuses were. Naming
    // them one at a time here is how a fifth would come to be forgotten.
    updated = withoutGrants(updated, (source) => castingIdOf(source) === castingId);

    if (key === casterId && updated.concentration?.castingId === castingId) {
      updated = { ...updated, concentration: null };
    }

    if (updated !== creature) changed = true;
    creatures[key] = updated;
  }

  // A casting that ends early takes its own deadlines with it, or a stale timer
  // would sit waiting to end a spell that is already over. Every per-target
  // hook it placed goes too.
  const timers: Record<string, TimedEffect> = {};
  for (const [key, timer] of Object.entries(state.timers)) {
    const owned =
      (timer.target.kind === 'casting' && timer.target.castingId === castingId) ||
      (timer.target.kind === 'condition' &&
        castingIdOf(`${timer.target.instance}`) === castingId) ||
      // A deadline the casting put on its own grant. The grant has just gone;
      // a timer left waiting to end it is the stale timer this loop exists for.
      (timer.target.kind === 'grants' && castingIdOf(timer.target.source) === castingId);
    if (owned) {
      changed = true;
      continue;
    }
    timers[key] = timer;
  }

  // A hit the casting promised for a later moment goes with it. No ongoing
  // casting schedules one yet — both delayed-damage spells are Instantaneous —
  // but the schedule already names its casting, and a convergence point that
  // forgot one kind of debt is the hole `releaseOnTarget`'s bonuses were.
  const scheduledDamage = withoutScheduledDamage(state, castingId, null).scheduledDamage;
  if (scheduledDamage !== state.scheduledDamage) changed = true;

  // And the live record goes with them. **This is the one place it is removed**
  // — whether the casting ended because Concentration broke, because its
  // deadline arrived, or because somebody dispelled it — so there is exactly
  // one answer to "is this spell still running", and no route by which a
  // finished spell stays queryable.
  let ongoing: Readonly<Record<string, OngoingSpell>> = state.ongoing;
  let castingsEnded = state.castingsEnded;
  if (ongoing[castingId] !== undefined) {
    const rest: Record<string, OngoingSpell> = { ...ongoing };
    delete rest[castingId];
    ongoing = rest;
    // And the door records who went through it, so a later `spell-ongoing`
    // naming the same casting is a corrupt log rather than a resurrection.
    // Only here: a `releaseCasting` for a casting that never had a record is
    // not an ending, and marking one would refuse the record its own batch is
    // still about to write.
    castingsEnded = [...castingsEnded, castingId].sort(
      (a, b) => castingNumber(a) - castingNumber(b),
    );
    changed = true;
  }

  // An effect the area owed and the record of who it had already caught this
  // turn. Both belong to the casting and neither outlives it: a debt against a
  // Web that has been dispelled is one nothing could settle, and the turn
  // would refuse to advance past it for ever.
  const owedAreaEffects = state.owedAreaEffects.filter((owed) => owed.castingId !== castingId);
  if (owedAreaEffects.length !== state.owedAreaEffects.length) changed = true;

  const areaTriggers: Record<string, AreaTriggerStamp> = {};
  for (const [key, stamp] of Object.entries(state.areaTriggers)) {
    if (key.startsWith(`${castingId}|`)) {
      changed = true;
      continue;
    }
    areaTriggers[key] = stamp;
  }

  return changed
    ? {
        ...state,
        creatures,
        timers,
        ongoing,
        castingsEnded,
        scheduledDamage,
        owedAreaEffects,
        areaTriggers,
      }
    : state;
}

/**
 * Drop the hits a casting promised for later — all of them, or one creature's.
 *
 * The schedule's source carries the casting id exactly as a condition's does,
 * so ending a casting can find what it owes without a second index. Returns
 * the state it was given when nothing matched, so callers can tell.
 */
function withoutScheduledDamage(
  state: GameState,
  castingId: string,
  targetId: CharacterId | null,
): GameState {
  let scheduled: Record<string, ScheduledDamage> | null = null;

  for (const [key, hit] of Object.entries(state.scheduledDamage)) {
    if (castingIdOf(hit.source) !== castingId) continue;
    if (targetId !== null && hit.target !== targetId) continue;
    scheduled ??= { ...state.scheduledDamage };
    delete scheduled[key];
  }

  return scheduled === null ? state : { ...state, scheduledDamage: scheduled };
}

/**
 * Take a creature off an ongoing spell without ending the spell.
 *
 * Two things do this and they are the same thing: a target shaking the spell
 * off, and a target leaving the game. Either way the casting carries on for
 * whoever is left, and `on` has to stop claiming somebody it no longer covers
 * — Dispel Magic reads that list, and a stale name in it would let a creature
 * dispel a spell that is not on them.
 */
function withoutTarget(
  state: GameState,
  targetId: CharacterId,
  castingId: string | null,
): GameState {
  let ongoing: Record<string, OngoingSpell> | null = null;

  for (const [key, record] of Object.entries(state.ongoing)) {
    if (castingId !== null && key !== castingId) continue;
    if (!record.on.includes(targetId)) continue;
    ongoing ??= { ...state.ongoing };
    ongoing[key] = { ...record, on: record.on.filter((who) => who !== targetId) };
  }

  return ongoing === null ? state : { ...state, ongoing };
}

/**
 * Which offer an answer settles.
 *
 * **An offer is a (reactor, feature) pair, not a reactor.** One creature can
 * hold two features in one window — a Rogue 5 / Monk 3 is offered Uncanny
 * Dodge *and* Deflect Attacks against the same blow, and a Fighter / Fiend
 * Warlock may Indomitable a failed save and then add Dark One's Own Luck to
 * the new roll, which the SRD permits. Matching answers by reactor alone
 * consumed both offers on the first answer, and a settlement that recorded
 * one pass per offer then found the second already gone and threw — a legal
 * character build that crashed the settle command and corrupted the log.
 *
 * An answer that names no feature is a bare pass and lets every offer that
 * reactor held lapse, which is what declining a window means.
 */
const offerAnswered =
  (event: { readonly reactor: CharacterId; readonly feature?: string }) =>
  (offer: ReactionOffer): boolean =>
    offer.reactor === event.reactor &&
    (event.feature === undefined || offer.feature === event.feature);

/** Who is concentrating on a casting, if anybody still is. */
const casterOf = (state: GameState, castingId: string): CharacterId | null =>
  Object.values(state.creatures).find((c) => c.concentration?.castingId === castingId)?.id ?? null;

/**
 * End one casting's effect on one creature, leaving the casting running.
 *
 * SRD Hold Person: a successful repeat save ends the spell "on itself". The
 * casting carries on for anyone else it caught, and the caster keeps
 * concentrating, because the spell is still doing something.
 */
function releaseOnTarget(
  state: GameState,
  targetId: CharacterId,
  castingId: string,
): GameState {
  const creature = state.creatures[targetId];
  if (creature === undefined) return state;

  // The live record loses this creature whatever else changes — a tracked
  // spell like Darkvision is *on* somebody and hangs nothing on them, so the
  // condition-and-bonus test below would say there was nothing to release.
  const base = withoutScheduledDamage(
    withoutTarget(state, targetId, castingId),
    castingId,
    targetId,
  );

  const doomed = creature.conditions.instances.filter(
    (instance) => castingIdOf(instance.source) === castingId,
  );
  // And every grant this casting hung on this creature, through the one
  // enumerator: a Mage Armor dispelled on one creature stops being that
  // creature’s calculation, a Dispel Magic aimed at one blurred creature stops
  // attacks against *that* creature being made at Disadvantage, and a
  // Stoneskin dispelled on one fighter stops halving *their* damage — each
  // leaving the rest of the casting alone. The enumerator returns the creature
  // itself when the casting held nothing here, which is what says so.
  const released = withoutGrants(creature, (source) => castingIdOf(source) === castingId);
  if (doomed.length === 0 && released === creature) {
    return base;
  }

  let conditions = creature.conditions;
  for (const instance of doomed) conditions = removeConditionInstance(conditions, instance.id);

  // Every timer this casting hung on this creature goes with it, so no later
  // turn raises a hook for an effect that has ended. Filtering rather than
  // rebuilding one key: `doomed` includes the conditions the effect *implied*,
  // and those sort ahead of it — `incapacitated:...` before `paralyzed:...` —
  // so guessing from the first entry pointed at the wrong timer and left the
  // real one running.
  const timers: Record<string, TimedEffect> = {};
  for (const [key, timer] of Object.entries(base.timers)) {
    const mine =
      (timer.target.kind === 'condition' &&
        timer.target.on === targetId &&
        castingIdOf(timer.target.instance) === castingId) ||
      // The deadline this casting put on its own grant on *this* creature. The
      // grant is going below; the timer that was going to end it goes too.
      (timer.target.kind === 'grants' &&
        timer.target.on === targetId &&
        castingIdOf(timer.target.source) === castingId);
    if (!mine) timers[key] = timer;
  }

  return {
    ...base,
    timers,
    // **The grants go too.** The bonuses were computed and then dropped on the
    // floor here from the day this function was written, and nothing noticed
    // because every spell that released on one target hung a *condition* —
    // Hold Person, Black Tentacles. Dispel Magic is the first thing to release
    // a spell that hung a bonus, and a Bless the rules had ended went on
    // adding its d4. Applying `released` rather than four named fields is what
    // keeps that from happening again to a family nobody has added yet.
    creatures: {
      ...base.creatures,
      [targetId]: { ...released, conditions },
    },
  };
}

/**
 * Every grant one source made on one creature, taken away.
 *
 * The same operation `releaseOnTarget` performs, asked by **source** rather
 * than by casting — which is what lets a feature and a casting share it. SRD
 * Superior Hunter's Defense grants a Resistance and no casting exists to hang
 * it on; a Stoneskin's grant with a deadline of its own is the same sentence
 * with a casting id inside the source.
 *
 * **Every grant kind, not the one the deadline was written for.** What ends is
 * what that source granted, which is one question however many of the families
 * answer it — and it is why the `grants` timer needs no per-kind identity. So
 * it is {@link withoutGrants} with the bare source as its predicate, and the
 * roll modifiers are matched on that bare source rather than through
 * `rollModifierKey` for exactly the same reason: Beacon of Hope's two modifiers
 * are one source's grant, and one deadline ends both.
 *
 * Nothing here touches the casting itself. A casting whose grant has expired is
 * still running, still concentrated on, and still in `ongoing`.
 */
function releaseGrants(creature: CreatureState, source: string): CreatureState {
  return withoutGrants(creature, (held) => held === source);
}

/**
 * SRD Concentration: "Your Concentration ends if you have the Incapacitated
 * condition or you die."
 *
 * This is derived rather than commanded, because it is not a decision anybody
 * makes. A caster knocked to 0 hit points is Unconscious, therefore
 * Incapacitated, therefore not concentrating — and no log, however it was
 * assembled, should be able to produce a state where a dead wizard's Hold
 * Person is still running.
 *
 * Applied after every event, so it catches the break however it arrived:
 * damage, a spell, Exhaustion reaching 6.
 */
/**
 * Whether any creature at all matches, without allocating anything.
 *
 * Three derived passes run after **every** event and each begins by sorting
 * the whole cast — `Object.keys(creatures).sort()`, an array of N strings and
 * an N log N comparison, to find the handful of creatures that could possibly
 * be affected. Most events affect none of them: nobody is concentrating,
 * nothing is switched on, nothing is readied.
 *
 * Measured on a cast of 128 over 2,256 events, those three passes were 90% of
 * the fold. This is the question they should ask first — a bare `for...in`
 * that allocates nothing and stops at the first match. When it says no, the
 * pass returns the state it was given; when it says yes, the original sorted
 * path runs unchanged, so the *order* effects are applied in is exactly what
 * it always was.
 */
function anyCreature(
  state: GameState,
  matches: (creature: CreatureState) => boolean,
): boolean {
  for (const key in state.creatures) {
    const creature = state.creatures[key];
    if (creature !== undefined && matches(creature)) return true;
  }
  return false;
}

function breakLostConcentration(state: GameState): GameState {
  // Nobody concentrating, nothing to lose. The common case by a wide margin.
  if (!anyCreature(state, (c) => c.concentration !== null)) return state;

  let current = state;

  // Releasing one casting cannot Incapacitate anybody, so this settles in a
  // single pass today. The loop is what keeps that true if an effect type that
  // *can* ever lands.
  for (;;) {
    const lost = Object.keys(current.creatures)
      .sort()
      .map((key) => current.creatures[key])
      .find(
        (creature) =>
          creature !== undefined &&
          creature.concentration !== null &&
          (creature.vitals.dead || isIncapacitated(creature.conditions)),
      );

    if (lost?.concentration == null) return current;
    current = releaseCasting(current, lost.id, lost.concentration.castingId);
  }
}

/**
 * Remember that a command landed.
 *
 * Generic on purpose: any event that carries a `commandId` participates, so
 * the next operation that needs an identity gets the guarantee by adding one
 * field rather than by inventing a second mechanism. The first landing wins —
 * an id is a claim about which command this is, not about how many times it
 * may appear.
 */
function recordCommand(state: GameState, event: GameEvent): GameState {
  if (!('command' in event) || event.command === undefined) return state;
  if (state.appliedCommands[event.command.id] !== undefined) return state;

  return {
    ...state,
    appliedCommands: {
      ...state.appliedCommands,
      [event.command.id]: {
        type: event.type,
        // A declaration allocates the casting id, so a retried declaration has
        // to be able to recover it — the caller needs to name the casting it
        // already opened, not the one that would come next.
        castingId:
          event.type === 'spell-cast'
            ? event.castingId
            : event.type === 'spell-declared'
              ? event.casting.castingId
              : null,
        fingerprint: event.command.fingerprint,
      },
    },
  };
}

/**
 * SRD rest interruptions: "Rolling Initiative", "Casting a spell other than a
 * cantrip", "Taking any damage".
 *
 * Marked as they happen rather than reported by the caller. A caller who had
 * to report them would eventually miss one, and the party would collect a rest
 * the rules had already broken — which is the same reasoning that makes
 * Concentration derived. The first cause is the one that broke it; later ones
 * change nothing.
 */
function interruptedRests(state: GameState, event: GameEvent): GameState {
  const broken: [CharacterId, string][] = [];

  switch (event.type) {
    case 'damage-taken':
      if (event.amount > 0) broken.push([event.id, 'damage']);
      break;
    case 'spell-cast':
      // "other than a cantrip" — a cantrip is level 0 and breaks nothing.
      if (event.level > 0) broken.push([event.id, 'a spell']);
      break;
    case 'spell-declared':
      // The rest breaks when the casting *starts*, which is the same moment
      // the action is spent. A casting later interrupted does not un-break it:
      // the caster still stopped resting to cast.
      if (event.casting.level > 0) broken.push([event.casting.caster, 'a spell']);
      break;
    case 'combat-started':
      for (const combatant of event.combatants) broken.push([combatant.id, 'Initiative']);
      break;
    default:
      return state;
  }

  let current = state;
  for (const [id, cause] of broken) {
    const creature = current.creatures[id];
    if (creature?.resting == null || creature.resting.interruptedBy !== null) continue;
    current = {
      ...current,
      creatures: {
        ...current.creatures,
        [id]: {
          ...creature,
          // The moment matters, not just the fact: SRD pays a broken Long Rest
          // on the time rested *before* the interruption.
          resting: {
            ...creature.resting,
            interruptedBy: cause,
            interruptedAt: current.elapsed,
          },
        },
      },
    };
  }
  return current;
}

/**
 * Rebuild the timer record with its keys sorted.
 *
 * Timers reach the event log, and a record whose key order depended on which
 * effect happened to be scheduled first would serialise differently for two
 * identical tables — the same reasoning that sorts condition instances and
 * resource pools.
 */
function sortedTimers(timers: Readonly<Record<string, TimedEffect>>): Record<string, TimedEffect> {
  const sorted: Record<string, TimedEffect> = {};
  for (const key of Object.keys(timers).sort()) {
    const timer = timers[key];
    if (timer !== undefined) sorted[key] = timer;
  }
  return sorted;
}

/**
 * Every timer except the ones that end something on a creature who has left.
 *
 * **A creature takes its obligations with it**, which is the rule
 * `settleHoldsInvolving` already applies to a held attack and a declared move.
 * `pendingSaves` was the one engine debt of nine with nothing doing it: a
 * Paralyzed goblin removed mid-fight left its Hold Person timer standing, so
 * the boundary went on raising a save for a creature nobody could roll for and
 * `resolveTurn` refused `saves_pending` for ever. A fight that cannot advance
 * is a campaign that cannot continue.
 *
 * **Only the timers that name *that* creature.** A Hold Person upcast holds
 * two, and one of them leaving is not the other being freed — the whole
 * distinction the casting id was built for, applied here to the target.
 *
 * **A condition's timer and a feature's are both "on" a creature**, and both
 * go. The audit named the condition, because that is the one that raises a
 * save and wedges the fight; a Rage whose Barbarian has left is the same shape
 * with nothing downstream of it — `expireEffects` already checks that the
 * creature still exists before ending the feature, so this changes no
 * behaviour and removes the dangling key rather than leaving one kind of
 * orphan behind because only the other kind had a symptom.
 *
 * A **casting's** timer is deliberately untouched: SRD does not end a Grease
 * because somebody walked out of it, and a casting whose caster leaves is
 * already handled above by `releaseCasting`.
 *
 * Nothing is written for any of it. Expiry is derived — nobody *decides* that
 * a condition on a creature who is no longer in the game has stopped — which
 * is the same audit trade a deadline arriving and a broken Concentration both
 * already make.
 */
function timersApartFrom(
  timers: Readonly<Record<string, TimedEffect>>,
  who: CharacterId,
): Record<string, TimedEffect> {
  const kept: Record<string, TimedEffect> = {};
  for (const key of Object.keys(timers).sort()) {
    const timer = timers[key];
    if (timer === undefined) continue;
    if (timer.target.kind !== 'casting' && timer.target.on === who) continue;
    kept[key] = timer;
  }
  return kept;
}

/**
 * Raise the saves a turn boundary owes.
 *
 * The reducer cannot roll — randomness enters the log once, at the point of
 * the roll — so this records the debt and an engine-owned operation settles
 * it. Derived from `turn-advanced` rather than commanded, for the same reason
 * a broken Concentration is: nobody decides that a turn ended, so nobody
 * should have to remember what ending it costs.
 *
 * Keyed by effect *and* turn, so folding the log twice raises one save, and a
 * later turn raises it again — which is what "repeats the save" means.
 */
function raiseTurnSaves(
  state: GameState,
  before: CombatState,
  after: CombatState,
): GameState {
  const ended = before.order[before.turnIndex]?.id;
  const begun = after.order[after.turnIndex]?.id;

  const raised: Record<string, PendingSave> = {};
  for (const key of Object.keys(state.timers).sort()) {
    const timer = state.timers[key];
    const hook = timer?.repeatSave;
    if (timer === undefined || hook === undefined) continue;
    if (timer.target.kind !== 'condition') continue;

    const fires =
      hook.at === 'end-of-turn' ? hook.of === ended : hook.of === begun;
    if (!fires) continue;

    const castingId = castingIdOf(timer.target.instance);
    if (castingId === null) continue;

    raised[pendingSaveKey(key, after.turnsTaken)] = {
      effectKey: key,
      target: timer.target.on,
      castingId,
      ability: hook.ability,
      dc: hook.dc,
      onSuccess: hook.onSuccess,
      label: hook.label,
      turn: after.turnsTaken,
    };
  }

  if (Object.keys(raised).length === 0) return state;
  return { ...state, pendingSaves: sortedRecord({ ...state.pendingSaves, ...raised }) };
}

/**
 * A casting that has just hung something on a creature is now **on** them.
 *
 * `OngoingSpell.on` answers SRD Dispel Magic's "any ongoing spell ... on the
 * target", and it was written once, at the resolution, because that was the
 * only moment a casting could reach anybody. A persistent area breaks that:
 * Web restrains a creature that walks in a minute later, and a Dispel Magic
 * aimed at *them* has to find it.
 *
 * So `on` grows, and the rule is exactly the link every other cleanup already
 * uses: **a casting is on a creature while it has a live effect there that the
 * casting owns.** Derived, so no event has to remember to say it, and a no-op
 * for every spell that reached its targets at the cast.
 *
 * **What it deliberately is not** is "everyone the area has ever touched". A
 * creature Insect Plague damaged is not carrying anything of the swarm's, so
 * the swarm is not on them and a Dispel Magic pointed their way finds nothing
 * — which is right, and is why this reads the *condition* rather than the
 * trigger that produced it.
 *
 * **And `expireEffects` reads the same link the other way**, which it did not
 * used to: when a condition lapses on its own deadline and it was the last
 * thing the casting owned on that creature, they leave `on`. Growing without
 * shrinking left a stale name in the list Dispel Magic reads, so a creature
 * could dispel a spell the rules had already taken off them.
 */
function alsoOn(state: GameState, who: CharacterId, source: string): GameState {
  const castingId = castingIdOf(source);
  if (castingId === null) return state;

  const record = state.ongoing[castingId];
  if (record === undefined || record.on.includes(who)) return state;

  return {
    ...state,
    ongoing: {
      ...state.ongoing,
      [castingId]: { ...record, on: [...record.on, who].sort() },
    },
  };
}

/**
 * Which placed creatures a persistent casting's area currently holds.
 *
 * The geometry is `positioning.ts`'s and is not reimplemented: the shape and
 * its dimensions come off the definition, the point and the direction off the
 * ongoing record. There is one area function in this engine and this is a
 * caller of it, not a second one.
 *
 * **Two origins, both read off facts the engine already had.** SRD's glossary
 * decides it and says so in one sentence: "An Emanation **moves with the
 * creature or object that is its origin** unless it is an instantaneous or a
 * stationary effect." So a casting's area sits at a point *or* on a creature,
 * and which it is was settled at the casting by the definition:
 *
 * | | `area.origin` | Read from | Spells |
 * |---|---|---|---|
 * | A point the casting keeps | `point` | `record.origin` | Web, Grease, Insect Plague, Black Tentacles, Moonbeam |
 * | The caster, wherever they now are | `self` | `record.caster` | Spirit Guardians |
 *
 * **Nothing is stored for the second and nothing is synchronised.** A copied
 * point would be a second answer to "where is the aura", kept in step by
 * remembering to update it — and the first time anything moved the caster by a
 * route that forgot, the aura would be frozen where it was. Deriving it is not
 * an optimisation: it is the difference between one fact and two facts that
 * can disagree.
 *
 * An Emanation measures from the origin creature's **whole occupied volume**
 * and excludes that creature, both of which `creaturesInArea` has always done.
 * A Gargantuan carrier's 15-foot Emanation covers vastly more ground than a
 * Medium one's, and neither includes the carrier.
 *
 * Null when the casting has no persistent area to ask about — no definition,
 * no area, no trigger, or a point-origin area with no point recorded — which
 * is every casting but a handful.
 */
function creaturesInCastingArea(
  scene: PositionState,
  record: OngoingSpell,
): ReadonlySet<CharacterId> | null {
  const definition = areaDefinitionOf(record);
  if (definition === null) return null;

  const origin = originOfCastingArea(definition.area, record);
  if (origin === null) return null;

  const shape = areaShapeOf(definition.area, record.towards, record.anchoring ?? 'space');
  if (shape === null) return null;

  const caught = creaturesInArea(scene, origin, shape);
  if (!caught.ok) return null;

  // SRD Spirit Guardians: "When you cast this spell, you can designate
  // creatures to be unaffected by it." Filtered here rather than at each
  // clause, so the one decision reaches every sentence that reads the area —
  // the damage today, the halved Speed whenever that is built.
  const spared = record.unaffected;
  return new Set(spared === undefined ? caught.value : caught.value.filter((id) => !spared.includes(id)));
}

/** Where this casting's area sits: a point it keeps, or the creature carrying it. */
function originOfCastingArea(area: SpellArea, record: OngoingSpell): AreaOrigin | null {
  if (area.origin === 'self') return { creature: record.caster as CharacterId };
  return record.origin === undefined
    ? null
    : areaPointAt(record.origin, record.anchoring ?? 'space');
}

/**
 * Turn a definition's area into the geometric template, with its direction.
 *
 * The direction is the half that had to be stored: everything else is a
 * printed dimension and reconstructs itself. A directional shape with no
 * recorded direction answers null rather than pointing somewhere plausible.
 */
function areaShapeOf(
  area: SpellArea,
  towards: Point | undefined,
  anchoring: PointAnchoring,
): AreaShape | null {
  // The direction is read under the casting's own anchoring, the same one its
  // origin was written with, so the axis between them stays in one frame.
  const aim = towards === undefined ? null : areaPointAt(towards, anchoring);
  switch (area.kind) {
    case 'sphere':
      return { kind: 'sphere', radius: area.radius };
    case 'cylinder':
      return { kind: 'cylinder', radius: area.radius, height: area.height };
    case 'emanation':
      return { kind: 'emanation', distance: area.distance };
    case 'cone':
      return aim === null ? null : { kind: 'cone', length: area.length, towards: aim };
    case 'cube':
      return aim === null ? null : { kind: 'cube', size: area.size, towards: aim };
    case 'line':
      return aim === null
        ? null
        : { kind: 'line', length: area.length, width: area.width, towards: aim };
  }
}

/**
 * A casting that has both an area and something it does to it later.
 *
 * **Read off the record, never out of the catalogue.** The shape, its
 * dimensions and the clauses that fire in it were pinned when the spell was
 * cast, by the rule the pinned numbers already set: a spell already cast does
 * not change when the book does. Asking `definitionFor` here — which this did
 * at five call sites — meant a replay of last week's log consulted this week's
 * definitions, so a corrected Cube size raised different debts in a historical
 * fold than the live session raised.
 */
function areaDefinitionOf(
  record: OngoingSpell,
): { readonly area: SpellArea; readonly trigger: AreaTrigger } | null {
  if (record.area === undefined || record.areaTrigger === undefined) return null;
  return { area: record.area, trigger: record.areaTrigger };
}

/**
 * Whether this casting may catch this creature again on this turn.
 *
 * SRD writes two different caps and they are not interchangeable — see
 * {@link AreaTrigger}. `oncePerTurn` bars every clause once anything has
 * fired; `onEntry: 'first-per-turn'` bars only a second *entry*, which is why
 * a creature that started its turn in a Web and walked back into it saves
 * twice.
 *
 * Outside combat there is no turn, so nothing is capped — the reading the
 * one-slot-per-turn rule and every once-per-turn feature already take.
 */
function areaTriggerAllowed(
  state: GameState,
  castingId: string,
  target: CharacterId,
  trigger: AreaTrigger,
  moment: AreaMoment,
  turn: number | null,
): boolean {
  if (turn === null) return true;

  const stamp = state.areaTriggers[areaStampKey(castingId, target)];
  if (stamp === undefined || stamp.turn !== turn) return true;

  if (trigger.oncePerTurn === true) return false;

  // **Only a creature's own entry spends the entry cap.** SRD Web caps "the
  // first time a creature **enters** the webs on a turn", and an area that
  // slid onto a creature standing still was not entered by it. No registered
  // spell prints both clauses, so nothing observes this today — which is
  // precisely why the narrow reading is the one to write down now, while the
  // sentence that decides it is still in front of us.
  return !(moment === 'entry' && trigger.onEntry === 'first-per-turn' && stamp.byCreatureEntry);
}

/** Raise one debt, and stamp the turn it was raised on. */
function oweAreaEffect(
  state: GameState,
  castingId: string,
  target: CharacterId,
  moment: AreaMoment,
  turn: number | null,
): GameState {
  const key = areaStampKey(castingId, target);
  const previous = state.areaTriggers[key];

  return {
    ...state,
    owedAreaEffects: [...state.owedAreaEffects, { castingId, target, moment }],
    areaTriggers:
      turn === null
        ? state.areaTriggers
        : sortedRecord({
            ...state.areaTriggers,
            [key]: {
              turn,
              byCreatureEntry:
                moment === 'entry' ||
                (previous?.turn === turn && previous.byCreatureEntry === true),
            },
          }),
  };
}

/**
 * The debts a turn boundary raises: one creature's end, then another's start.
 *
 * Both are raised by the same fold of the same `turn-advanced`, because the
 * reducer cannot roll and raising is derived — but they are stamped with
 * *different moments*, and settlement is what keeps them a round apart. See
 * `settleAreaEffects`.
 */
function raiseAreaBoundary(
  state: GameState,
  moment: 'end-of-turn' | 'start-of-turn',
  whose: CharacterId | undefined,
  turn: number,
): GameState {
  const scene = state.scene;
  if (scene === null || whose === undefined) return state;

  let current = state;
  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    if (record === undefined) continue;
    const definition = areaDefinitionOf(record);
    if (definition === null) continue;
    if (definition.trigger.at !== moment) continue;

    const inside = creaturesInCastingArea(scene, record);
    if (inside === null || !inside.has(whose)) continue;

    if (!areaTriggerAllowed(current, castingId, whose, definition.trigger, moment, turn)) continue;
    current = oweAreaEffect(current, castingId, whose, moment, turn);
  }
  return current;
}

/**
 * The finishing creature's end, and a note that a start is still to come.
 *
 * **The end of a turn belongs to the turn that is ending.** `turnsTaken` has
 * already moved on by the time the reducer sees `turn-advanced`, so stamping
 * the end with the new number would put a creature's entry and the end of the
 * very turn it entered on into two different turns — and Insect Plague's "only
 * once per turn" would catch it twice.
 *
 * The start is **not** raised here. What catches a creature as its turn begins
 * is a question about the world the previous creature's end left behind, and
 * that world does not exist yet. See {@link GameState.pendingTurnStart}.
 */
function raiseTurnEnd(state: GameState, before: CombatState, after: CombatState): GameState {
  const ended = raiseAreaBoundary(
    state,
    'end-of-turn',
    before.order[before.turnIndex]?.id,
    before.turnsTaken,
  );
  const begun = after.order[after.turnIndex]?.id;
  return begun === undefined
    ? ended
    : { ...ended, pendingTurnStart: { who: begun, turn: after.turnsTaken } };
}

/**
 * The start of the turn, once the end that preceded it has finished happening.
 *
 * Derived after every event rather than emitted, for the reason every derived
 * pass in this file exists: nobody *decides* that a moment has arrived. What
 * decides it is that the previous moment owes nothing more — no end-of-turn
 * area effect outstanding, and no scheduled hit still due at that boundary,
 * because either can end the very casting this moment would catch somebody by.
 *
 * A replay reconstructs it because the fold does: the same log leaves the same
 * debts outstanding at the same points, so the start arrives at the same event
 * it arrived at live.
 *
 * The common case passes straight through inside the fold of `turn-advanced`
 * itself — a boundary that owes nothing reaches the start at once, and no
 * caller learns there were two moments.
 */
function reachStartOfTurn(state: GameState): GameState {
  const pending = state.pendingTurnStart;
  if (pending === null) return state;

  // A fight that has ended has no start left to arrive, and a marker nothing
  // could clear would refuse every turn for ever.
  if (state.combat === null) return { ...state, pendingTurnStart: null };

  const owing = state.owedAreaEffects.some((owed) => owed.moment === 'end-of-turn');
  if (owing) return state;

  // **A hit the boundary still owes is the other end-of-turn consequence the
  // engine holds as state**, and SRD Acid Arrow's "at the end of its next
  // turn" can drop the very caster whose area the next creature is about to
  // begin their turn in.
  //
  // Stated honestly: with today's mechanics this half has **no observable
  // case**. Every end-of-turn consequence the engine can currently produce
  // either ends the casting — and `releaseCasting` forgives its debts, so the
  // answer comes out the same whether the debt was never raised or raised and
  // dropped — or cannot change who is standing where, because nothing at a
  // boundary moves anybody. A mutation that removes this line survives, and
  // that is recorded rather than hidden.
  //
  // It stays because the *moment* is genuinely later, not because a test
  // currently fails without it: the first consequence that moves a creature or
  // moves an area is the one that would otherwise reintroduce the bug this
  // whole marker exists to fix.
  const view = { elapsed: state.elapsed, combat: state.combat };
  const dueDamage = Object.values(state.scheduledDamage).some((hit) => isDue(view, hit.deadline));
  if (dueDamage) return state;

  return {
    ...raiseAreaBoundary(state, 'start-of-turn', pending.who, pending.turn),
    pendingTurnStart: null,
  };
}

/**
 * The debts a position change raises: outside → inside, and nothing else.
 *
 * **Every creature whose position actually changed**, not the one the event
 * names. `moveCreature` carries riders with their mount, so a rider crosses
 * into a Web with no event mentioning them at all — and reading `event.id`
 * alone is a bug a single-rider fixture is the only thing that catches.
 *
 * Only `false → true` fires. Already inside and staying, outside and staying,
 * and inside to outside are all silent, because none of them is entering.
 *
 * **Placement is not entry, and that is structural rather than a guard.** A
 * creature being put into the scene is not in `before.positions` at all, so it
 * has no outside to have come from and the diff cannot fire for it — which is
 * why there is no check here saying so, and why a mutation that calls this
 * from `creature-placed` changes nothing. An unplaced creature is likewise in
 * no area, so "unknown is outside" needs no statement either.
 *
 * **What this cannot see is the path.** The engine records where a move
 * started and where it ended and nothing in between, so a creature that walks
 * clean across a Web from one side to the other transitions outside → outside
 * and nothing fires. That is a real gap and it is reported rather than
 * guessed at: inferring the crossing from a straight line between the
 * endpoints would be the engine inventing a route nobody took. SRD lets a
 * creature break its movement into segments, and each segment is an
 * authoritative move that this does see, which is the operational answer until
 * movement records a path.
 */
function raiseAreaEntries(state: GameState, before: PositionState | null): GameState {
  const scene = state.scene;
  if (scene === null || before === null) return state;

  const moved = creaturesThatMoved(before, scene);
  if (moved.length === 0) return state;

  let current = state;
  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    if (record === undefined) continue;
    const definition = areaDefinitionOf(record);
    if (definition === null || definition.trigger.onEntry === undefined) continue;

    const was = creaturesInCastingArea(before, record);
    const now = creaturesInCastingArea(scene, record);
    if (was === null || now === null) continue;

    const turn = state.combat?.turnsTaken ?? null;
    for (const who of moved) {
      if (was.has(who) || !now.has(who)) continue;
      if (!areaTriggerAllowed(current, castingId, who, definition.trigger, 'entry', turn)) continue;
      current = oweAreaEffect(current, castingId, who, 'entry', turn);
    }
  }
  return current;
}

/**
 * What a movement did to every persistent area in play.
 *
 * One authoritative fact — a creature's position changed — and two rules read
 * it, because the SRD writes two clauses. Which one applies depends on *whose*
 * position moved: see {@link raiseAreaEntries} and {@link raiseCarriedArrivals}.
 *
 * The carrier side runs first so the debts are raised in the order settlement
 * discharges them; the two touch disjoint creatures, so the order changes no
 * outcome and exists only to keep a fold's list in the order a reader expects.
 */
function raiseAfterMovement(state: GameState, before: PositionState | null): GameState {
  return raiseAreaEntries(raiseCarriedArrivals(state, before), before);
}

/** Every creature whose authoritative position differs between two scenes. */
function creaturesThatMoved(before: PositionState, after: PositionState): readonly CharacterId[] {
  return Object.keys(after.positions).filter((who) => {
    const now = after.positions[who];
    const then = before.positions[who];
    if (now === undefined || then === undefined) return false;
    return now.x !== then.x || now.y !== then.y || now.z !== then.z;
  }) as CharacterId[];
}

/**
 * The creatures a **carried** area arrived on because its carrier moved.
 *
 * SRD's glossary is the whole rule: "An Emanation moves with the creature or
 * object that is its origin." So a cleric walking across a room takes Spirit
 * Guardians with them, and a creature the aura sweeps onto has done nothing at
 * all — which is exactly the clause the spell prints separately from the other
 * two: "whenever the **Emanation enters a creature's space** and whenever a
 * creature enters the Emanation or ends its turn there."
 *
 * **Same authoritative fact as `raiseAreaEntries`, opposite reading of it.**
 * Both hang off a creature's position changing; they differ in *whose*
 * position it was and therefore in what happened:
 *
 * | | Whose position changed | Who is caught | Moment |
 * |---|---|---|---|
 * | `raiseAreaEntries` | the creature that is caught | creatures that moved | `entry` |
 * | this | the **carrier** of the area | creatures that **did not** move | `area-moved` |
 *
 * The partition is exact and is the reason nothing double-fires: a creature
 * that moved has entered, and a creature that stood still has been entered
 * upon. Collapsing the two into "membership changed somehow" would erase the
 * distinction the SRD drew — and the two clauses can be capped differently.
 *
 * **The carrier is whoever actually moved, never whoever the event names.**
 * `moveCreature` carries riders with their mount, so a cleric riding a horse
 * takes their aura with them on an event that mentions only the horse. Reading
 * `event.id` is a bug a mounted fixture is the only thing that catches — the
 * same lesson the creature-side detector already learned.
 */
function raiseCarriedArrivals(state: GameState, before: PositionState | null): GameState {
  const scene = state.scene;
  if (scene === null || before === null) return state;

  const moved = new Set(creaturesThatMoved(before, scene));
  if (moved.size === 0) return state;

  let current = state;
  for (const castingId of Object.keys(state.ongoing).sort()) {
    const record = state.ongoing[castingId];
    if (record === undefined) continue;

    const definition = areaDefinitionOf(record);
    if (definition === null || definition.trigger.onAreaEntry !== true) continue;
    // A point-origin area does not move because anybody walked; Moonbeam's
    // Cylinder stays exactly where it was put until `spell-origin-moved` says
    // otherwise. This reads the carrier and nothing else.
    if (definition.area.origin !== 'self') continue;
    if (!moved.has(record.caster as CharacterId)) continue;

    const was = creaturesInCastingArea(before, record);
    const now = creaturesInCastingArea(scene, record);
    if (was === null || now === null) continue;

    const turn = state.combat?.turnsTaken ?? null;
    for (const who of [...now].sort()) {
      // A creature that moved is the entry detector's business, not this
      // one's.
      //
      // **Two of the three conditions on this line are unreachable today, and
      // are kept as statements of the rule rather than as optimisations.** One
      // authoritative operation moves one creature plus its riders, and riders
      // travel rigidly with their mount — so no event can move a carrier and
      // an independent creature at once, and no point-origin area's membership
      // can change because somebody walked. A mutation removing either passes
      // the whole suite; a mutation removing `was.has(who)` does not, because
      // firing for a creature the aura was already on is observable at once.
      //
      // What they buy is that the next operation to move two creatures
      // independently gets the right answer rather than a double consequence,
      // and that this function stays about carried areas. Stated here so
      // neither reads as dead weight to whoever finds them next.
      if (moved.has(who) || was.has(who)) continue;
      if (!areaTriggerAllowed(current, castingId, who, definition.trigger, 'area-moved', turn)) {
        continue;
      }
      current = oweAreaEffect(current, castingId, who, 'area-moved', turn);
    }
  }
  return current;
}

/**
 * The creatures a casting's area has just arrived on.
 *
 * SRD Moonbeam: "A creature also makes this save **when the spell's area moves
 * into its space**." Cloudkill, Incendiary Cloud and Spirit Guardians print
 * the same clause about their own areas. It is not the entry clause wearing a
 * different coat: nobody moved, and a creature that did not move has not
 * entered anything.
 *
 * **The authoritative operation says what changed, and that is the whole of
 * the design.** `creature-moved` means a creature's membership may have
 * changed and `raiseAreaEntries` answers it; `spell-origin-moved` means *this
 * casting's* area moved and this answers that. Nothing anywhere asks the
 * weaker question "did membership change somehow", because the SRD wrote two
 * clauses and an engine that could not tell them apart would have to guess
 * which one it was obeying.
 *
 * So this compares one casting's area at two points and every creature in the
 * scene, where the entry detector compares every casting against the creatures
 * that moved. Outside-before and inside-after is the only transition that
 * fires: inside → inside is a creature the beam was already on, inside →
 * outside is one it left, and outside → outside is dealt with above the
 * reducer — see `relocateOrigin`, which says out loud when a leg was long
 * enough to have passed over somebody unseen.
 *
 * **Creation is not movement.** A casting's first `spell-ongoing` records
 * where the area is and raises nothing here; the creatures standing in it are
 * caught by the spell's own casting effect, which is the sentence "when the
 * Cylinder appears" and is resolved at the cast. Only a *move* of an area that
 * already exists reaches this function, which is structural rather than
 * guarded: `spell-origin-moved` throws for a casting that holds no point.
 */
function raiseAreaArrivals(
  state: GameState,
  castingId: string,
  from: Point,
  to: Point,
): GameState {
  const scene = state.scene;
  if (scene === null) return state;

  const record = state.ongoing[castingId];
  if (record === undefined) return state;

  const definition = areaDefinitionOf(record);
  // **A fixed area gains nothing from a neighbour's moving one.** Web's Cube
  // stays where it was conjured, and a hand-built log that moved its point
  // anyway must not make it start catching people on a clause it never printed.
  if (definition === null || definition.trigger.onAreaEntry !== true) return state;

  const was = creaturesInCastingArea(scene, { ...record, origin: from });
  const now = creaturesInCastingArea(scene, { ...record, origin: to });
  if (was === null || now === null) return state;

  const turn = state.combat?.turnsTaken ?? null;

  let current = state;
  for (const who of [...now].sort()) {
    if (was.has(who)) continue;
    if (!areaTriggerAllowed(current, castingId, who, definition.trigger, 'area-moved', turn)) {
      continue;
    }
    current = oweAreaEffect(current, castingId, who, 'area-moved', turn);
  }
  return current;
}

/**
 * Forgive a debt whose subject has left the game or died.
 *
 * Derived, like every other lapse: nobody decides that a creature is no longer
 * there, and a debt addressed to a corpse is one nothing can settle and the
 * turn would refuse to advance past for ever. A dead creature takes no turns
 * and enters nothing, so every moment this debt could record is one that can
 * no longer happen to them.
 */
function dropOrphanedAreaEffects(state: GameState): GameState {
  const live = state.owedAreaEffects.filter((owed) => {
    const creature = state.creatures[owed.target];
    return creature !== undefined && !creature.vitals.dead;
  });
  return live.length === state.owedAreaEffects.length ? state : { ...state, owedAreaEffects: live };
}

/** Keys sorted, so state serialises identically however it was reached. */
function sortedRecord<T>(entries: Readonly<Record<string, T>>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(entries).sort()) {
    const value = entries[key];
    if (value !== undefined) sorted[key] = value;
  }
  return sorted;
}

/**
 * Drop a pending save whose effect is already gone.
 *
 * A Concentration broken before anyone rolled, an effect that ran out of time:
 * either way there is nothing left to save against, and a debt against a
 * vanished effect would block the turn order forever.
 */
/**
 * Drop a scheduled hit whose moment can no longer arrive.
 *
 * Turn-anchored timing is combat-scoped — CLAUDE.md argues that at length for
 * effects and the same reasoning applies here, with the sign reversed. When
 * the fight ends or the target leaves the Initiative order, the moment the
 * damage was waiting for will never come. An effect in that position **ends**;
 * a debt in that position is **forgiven**, because collecting it would mean
 * firing the acid at the instant the last enemy dropped.
 *
 * Derived rather than commanded, for the usual reason: nobody decides that a
 * combat ended, so nobody should have to remember what ending it forgives.
 */
function dropStrandedDamage(state: GameState): GameState {
  const live: Record<string, ScheduledDamage> = {};
  let changed = false;

  for (const key of Object.keys(state.scheduledDamage).sort()) {
    const scheduled = state.scheduledDamage[key];
    if (scheduled === undefined) continue;

    const deadline = scheduled.deadline;
    const stranded =
      (deadline.kind === 'turn-start' || deadline.kind === 'turn-end') &&
      (state.combat?.turnCounts[deadline.of] ?? null) === null;

    if (stranded) {
      changed = true;
      continue;
    }
    live[key] = scheduled;
  }

  return changed ? { ...state, scheduledDamage: live } : state;
}

function dropOrphanedSaves(state: GameState): GameState {
  const live: Record<string, PendingSave> = {};
  let changed = false;
  for (const [key, pending] of Object.entries(state.pendingSaves)) {
    if (state.timers[pending.effectKey] === undefined) {
      changed = true;
      continue;
    }
    live[key] = pending;
  }
  return changed ? { ...state, pendingSaves: live } : state;
}

/** One kind of thing, and how many of it. */
export interface InventoryLine {
  readonly id: string;
  readonly quantity: number;
}

/**
 * Quantities merge and the list stays sorted, so two identical packs agree.
 *
 * Exported because a plan has to describe the same inventory the log will
 * produce: two packages that both hold a quarterstaff own one line of two, not
 * two lines of one, before a single event is appended.
 */
export function mergeItems(
  inventory: readonly InventoryLine[],
  items: readonly InventoryLine[],
): readonly InventoryLine[] {
  const counts = new Map(inventory.map((line) => [line.id, line.quantity]));
  for (const line of items) counts.set(line.id, (counts.get(line.id) ?? 0) + line.quantity);
  return [...counts.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => ({ id, quantity }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const removeItems = (
  inventory: readonly InventoryLine[],
  items: readonly InventoryLine[],
): readonly InventoryLine[] =>
  mergeItems(inventory, items.map((line) => ({ ...line, quantity: -line.quantity })));

/**
 * Derive the sheet's armour from what is equipped.
 *
 * `equipped` is the authoritative fact; `sheet.armor` and `sheet.shield` are a
 * view of it that Armour Class happens to read. So this recomputes both from
 * the whole list rather than patching one slot per event — patching is only
 * correct if every event arrives in the right order and nothing else ever
 * touches the sheet, and `character-advanced` replaces the sheet wholesale.
 *
 * Anything that is not armour or a shield contributes nothing: a dagger in
 * hand is tracked, but it is not Armour Class.
 */
function withEquipment(sheet: CharacterSheet, equipped: readonly string[]): CharacterSheet {
  const pieces = equipped.map((itemId) => itemFor(itemId)?.armor ?? null);
  return {
    ...sheet,
    armor: pieces.find((piece) => piece !== null && piece.category !== 'shield') ?? null,
    shield: pieces.find((piece) => piece !== null && piece.category === 'shield') ?? null,
  };
}

const viewOf = (state: GameState): TimeView => ({
  elapsed: state.elapsed,
  combat: state.combat,
});

/**
 * End every effect whose moment has come.
 *
 * Derived rather than commanded, for the same reason Concentration breaking is:
 * a duration running out is not a decision anybody makes, and no log — however
 * assembled — should be able to show an effect still running past its own end.
 *
 * Keys are visited in sorted order so a fold is byte-identical however the
 * effects were scheduled. One pass settles it today: ending an effect cannot
 * bring a deadline forward. The loop is what keeps that true if one ever can.
 */
function expireEffects(state: GameState): GameState {
  let current = state;

  for (;;) {
    const view = viewOf(current);
    const key = Object.keys(current.timers)
      .sort()
      .find((k) => {
        const timer = current.timers[k];
        return timer !== undefined && hasExpired(view, timer.deadline);
      });
    if (key === undefined) return current;

    const timer = current.timers[key];
    const timers = { ...current.timers };
    delete timers[key];
    current = { ...current, timers };
    if (timer === undefined) continue;

    const target = timer.target;
    if (target.kind === 'feature') {
      // SRD Rage: "The Rage lasts until the end of your next turn." A deadline
      // running out is not a decision anybody makes, so it ends here.
      const creature = current.creatures[target.on];
      if (creature !== undefined) {
        current = {
          ...current,
          creatures: {
            ...current.creatures,
            [target.on]: {
              ...creature,
              activeFeatures: creature.activeFeatures.filter((f) => f !== target.feature),
            },
          },
        };
      }
    } else if (target.kind === 'grants') {
      // SRD Superior Hunter's Defense: "Resistance to that damage ... until
      // the end of the current turn." What ends is what that source granted,
      // and nothing else — the casting or the feature that made it carries on,
      // which is the whole difference between this and a `casting` deadline.
      const creature = current.creatures[target.on];
      if (creature !== undefined) {
        current = {
          ...current,
          creatures: {
            ...current.creatures,
            [target.on]: releaseGrants(creature, target.source),
          },
        };
      }
    } else if (target.kind === 'casting') {
      // Ending the casting takes its Concentration and every effect it created.
      const castingId = target.castingId;
      const caster = Object.values(current.creatures).find(
        (c) => c.concentration?.castingId === castingId,
      );
      current = releaseCasting(current, caster?.id ?? null, castingId);
    } else {
      const creature = current.creatures[target.on];
      if (creature !== undefined) {
        current = {
          ...current,
          creatures: {
            ...current.creatures,
            [target.on]: {
              ...creature,
              conditions: removeConditionInstance(creature.conditions, target.instance),
            },
          },
        };
        // And the casting stops being *on* them, if that was the last thing it
        // owned there. `alsoOn` grows the list on exactly this link — **a
        // casting is on a creature while it has a live effect there that the
        // casting owns** — and growing without shrinking left a stale name in
        // the list Dispel Magic reads, so a creature could dispel a spell that
        // was no longer on them.
        //
        // Only when nothing of the casting is left: a Hold Person still
        // holding somebody is still on them, whatever else lapsed.
        const castingId = castingIdOf(target.instance);
        if (castingId !== null) {
          current = holdsNothingOf(current, target.on, castingId)
            ? withoutTarget(current, target.on, castingId)
            : current;
        }
      }
    }
  }
}

/**
 * Whether a casting has no live effect left on a creature.
 *
 * The same links `releaseCasting` walks, asked of one creature: the conditions
 * it hung, and every grant {@link grantSourcesOf} enumerates — the bonuses, the
 * Armour Class it supplied, the roll modifiers and the defences it granted.
 * Reading them through the enumerator is what keeps this in step with the
 * release: a family this could see and `releaseCasting` could not would keep a
 * finished casting in `OngoingSpell.on`, which is a wrong answer to Dispel
 * Magic that no frozen log would catch.
 *
 * The conditions stay a question of their own, because they are a different
 * link — instances, sources and implications rather than a bare grant. And
 * scheduled damage is deliberately in neither: a hit that is still owed is the
 * casting's debt rather than something the casting is *doing* to the creature,
 * which is the same reading that keeps a creature Insect Plague merely damaged
 * off the list.
 */
function holdsNothingOf(state: GameState, who: CharacterId, castingId: string): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return true;

  const owns = (source: string): boolean => castingIdOf(source) === castingId;
  return (
    !creature.conditions.instances.some((instance) => owns(instance.source)) &&
    !grantSourcesOf(creature).some(owns)
  );
}

/**
 * Whether the creature that dealt this damage is the caster or one of their
 * allies — and the third answer, which is the point of the function.
 *
 * SRD writes "you or your allies" in five spells and the engine holds
 * allegiance as a **declared** fact: `side` is null until somebody says so.
 * So there are three answers and not two, exactly as there are for cover and
 * for sight, and the one that matters is `unknown`. A table not tracking sides
 * must not have an ending invented for it, and must not silently lose one
 * either — which is why {@link withheldEndings} exists to be asked.
 *
 * **The caster is never in doubt**, because the sentence names them: "**you**
 * or one of your allies". That branch reads no side at all, so a Charm Person
 * cast by a creature nobody has placed on a side still ends when its own
 * caster strikes the target.
 *
 * One function, two callers — the reducer's derived pass and the query — for
 * the reason this file records everywhere else: two implementations of one
 * sentence agree until the day they do not.
 */
export type AllyVerdict = 'caster' | 'ally' | 'not-ally' | 'unknown';

export function allyOfCaster(
  state: GameState,
  casterId: string,
  dealer: string,
): AllyVerdict {
  if (dealer === casterId) return 'caster';
  const caster = state.creatures[casterId];
  const hand = state.creatures[dealer];
  if (caster?.side == null || hand?.side == null) return 'unknown';
  return caster.side === hand.side ? 'ally' : 'not-ally';
}

/**
 * What this event says happened, in the vocabulary a trigger is written in.
 *
 * **Read off the event, and off a consequence event rather than a roll.**
 * `roll-recorded` changes no state by rule — that is what the event is for —
 * so hanging an ending on one would end a spell on the strength of a number
 * whose outcome had not happened. `attack-made` is therefore what
 * `target-attacks` reads: it is the Attack action rather than every attack
 * roll, and Invisibility's own `unmodelled` records what that leaves out.
 *
 * One event can say two things: damage names both its dealer — the fact
 * Hellish Rebuke needed, because `source` is prose and prose cannot be aimed
 * at — and its victim, and the two causes read opposite ends of it.
 */
type EndingFact =
  | {
      readonly cause: 'target-attacks' | 'target-deals-damage' | 'target-casts' | 'target-dons-armor';
      readonly who: CharacterId;
    }
  | {
      readonly cause: 'caster-or-ally-damages-target';
      readonly victim: CharacterId;
      readonly dealer: CharacterId;
    };

/**
 * SRD Mage Armor's "dons armor" is the body slot, not a Shield.
 *
 * The same question `withEquipment` asks when it derives the sheet's two
 * armour fields, and the same one `mustBeUnarmored` asks when the spell is
 * cast — "isn't wearing armor" is one sentence, and a Shield is not what it
 * refuses. Asked of the item the event names rather than of the creature,
 * because the event is what says the moment arrived.
 */
function isBodyArmor(itemId: string): boolean {
  const piece = itemFor(itemId)?.armor ?? null;
  return piece !== null && piece.category !== 'shield';
}

function endingFactsOf(event: GameEvent): readonly EndingFact[] {
  switch (event.type) {
    case 'attack-made':
      return [{ cause: 'target-attacks', who: event.id }];
    // The settled casting, never the declared one: SRD Counterspell makes a
    // declaration that may dissipate "with no effect", and a spell that never
    // settled is not one the target cast.
    case 'spell-cast':
      return [{ cause: 'target-casts', who: event.id }];
    case 'item-equipped':
      return isBodyArmor(event.item) ? [{ cause: 'target-dons-armor', who: event.id }] : [];
    case 'damage-taken':
      // A trap names nobody, and that is a real answer rather than a gap:
      // there is no creature that dealt it, so neither cause can fire.
      return event.by === undefined
        ? []
        : [
            { cause: 'target-deals-damage', who: event.by },
            { cause: 'caster-or-ally-damages-target', victim: event.id, dealer: event.by },
          ];
    default:
      return [];
  }
}

/** One casting to end, and whether it ends outright or on one creature. */
interface Ending {
  readonly castingId: string;
  /** Null ends the casting; a creature releases it on them and no one else. */
  readonly on: CharacterId | null;
  /** The creature the trigger named, whichever scope it ends at. */
  readonly subject: CharacterId;
}

/**
 * The first casting these facts end, in the order the castings happened.
 *
 * Numerically rather than lexically, as every walk over `ongoing` is, so two
 * folds of one log end them in one order.
 *
 * **The creature has to be one the casting is on.** Every sentence here says
 * "the target", and `OngoingSpell.on` is the engine's answer to which
 * creatures those are — so a Mage Armor on the wizard is untouched by the
 * fighter putting a breastplate on, and a Charm Person is untouched by damage
 * dealt to somebody it never caught.
 *
 * `settled` is the loop's own memory rather than a rule — see
 * {@link endTriggeredCastings} for why termination is not left to what a
 * release happens to remove.
 */
function nextEnding(
  state: GameState,
  facts: readonly EndingFact[],
  settled: ReadonlySet<string>,
): Ending | null {
  for (const castingId of Object.keys(state.ongoing).sort(
    (a, b) => castingNumber(a) - castingNumber(b),
  )) {
    const record = state.ongoing[castingId];
    if (record?.endsEarly === undefined) continue;

    for (const trigger of record.endsEarly) {
      for (const fact of facts) {
        if (fact.cause !== trigger.on) continue;

        const subject =
          fact.cause === 'caster-or-ally-damages-target'
            ? // Withheld rather than invented: only a verdict that says yes
              // ends anything, and `unknown` is reported by `withheldEndings`.
              ['caster', 'ally'].includes(allyOfCaster(state, record.caster, fact.dealer))
              ? fact.victim
              : null
            : fact.who;

        if (subject === null || !record.on.includes(subject)) continue;
        if (settled.has(endingKey(castingId, subject))) continue;
        return { castingId, on: trigger.ends === 'target' ? subject : null, subject };
      }
    }
  }
  return null;
}

const endingKey = (castingId: string, subject: CharacterId): string =>
  `${castingId}|${subject}`;

/**
 * End every casting whose trigger this event pulled.
 *
 * Derived rather than commanded, for the reason a broken Concentration and an
 * expired deadline are: **nobody decides that the target swung**. The engine
 * finds it, so no log — however assembled — can show an Invisibility running
 * on a creature that has just cast a spell, and no caller has to remember a
 * sentence printed on somebody else's spell.
 *
 * **Cheap first.** Four event types can say anything at all here, and every
 * other event returns before `ongoing` is touched. That is the discipline
 * `anyCreature` established for the three passes that sort the whole cast.
 *
 * **And it terminates *structurally*, which is the whole reason `settled`
 * exists.** A release changes the state the next pass reads, so the loop has
 * to consume something it cannot recreate — the move `expireEffects` makes by
 * deleting the timer key *before* it acts on it. Here the consumed thing is
 * the `(casting, creature)` pair, recorded before the release and skipped
 * afterwards, so the candidate set is finite by construction and shrinks by
 * one every iteration whatever a release does.
 *
 * **That was measured rather than assumed.** Progress really is implied today
 * by what the two doors do — `releaseCasting` deletes the record and
 * `releaseOnTarget` takes the subject out of `on`, which the match above
 * requires it to have been in — and a mutation dropping that `on` check
 * **hung the fold** rather than failing a test. Termination resting on what a
 * function three hundred lines away happens to remove is the kind of coupling
 * that is correct until somebody edits the other end, and a wedged fold is the
 * worst possible way to find out.
 *
 * Today it settles in a single step for every registered spell. The loop is
 * what keeps it correct when one blow ends two castings, which the tests do
 * drive: a strike on a charmed Beast by an invisible ally is two causes off
 * one `damage-taken`.
 */
function endTriggeredCastings(state: GameState, event: GameEvent): GameState {
  const facts = endingFactsOf(event);
  if (facts.length === 0) return state;

  const settled = new Set<string>();
  let current = state;
  for (;;) {
    const ending = nextEnding(current, facts, settled);
    if (ending === null) return current;
    settled.add(endingKey(ending.castingId, ending.subject));

    current =
      ending.on === null
        ? releaseCasting(current, casterOf(current, ending.castingId), ending.castingId)
        : releaseOnTarget(current, ending.on, ending.castingId);
  }
}

export function applyEvent(state: GameState, event: GameEvent): GameState {
  const applied = applyOne(state, event);
  return reachStartOfTurn(
    dropOrphanedAreaEffects(
      dropStrandedDamage(
        dropOrphanedSaves(
          dropLapsedReady(
            expireEffects(
              endLostFeatures(
                // Between the two passes that already end a casting nobody
                // decided to end — a lost Concentration above, an arrived
                // deadline below — because it is the same kind of fact, and
                // because the four `drop*` passes below are the safety net for
                // anything a release orphaned.
                endTriggeredCastings(
                  breakLostConcentration(recordCommand(interruptedRests(applied, event), event)),
                  event,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * Features whose own conditions have stopped holding.
 *
 * SRD Rage: "it ends early if you don Heavy armor or have the Incapacitated
 * condition." Nobody decides either of those, so this is derived after every
 * event, the same way a broken Concentration is — which means no log, however
 * assembled, can show a Rage running on a stunned Barbarian in plate.
 *
 * The timer goes with it. A stale deadline would sit waiting to end something
 * that is already over, and would end the *next* Rage early if one started
 * before it fired.
 */
function endLostFeatures(state: GameState): GameState {
  // Nothing switched on anywhere, so nothing can have stopped holding.
  if (!anyCreature(state, (c) => c.activeFeatures.length > 0)) return state;

  const creatures: Record<string, CreatureState> = { ...state.creatures };
  const dropped: { id: CharacterId; feature: string }[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const creature = state.creatures[key];
    if (creature === undefined || creature.activeFeatures.length === 0) continue;

    const kept = creature.activeFeatures.filter((feature) => sustains(creature, feature));
    if (kept.length === creature.activeFeatures.length) continue;

    for (const feature of creature.activeFeatures) {
      if (!kept.includes(feature)) dropped.push({ id: creature.id, feature });
    }
    creatures[key] = { ...creature, activeFeatures: kept };
  }

  if (dropped.length === 0) return state;

  const timers: Record<string, TimedEffect> = {};
  for (const [key, timer] of Object.entries(state.timers)) {
    const target = timer.target;
    const doomed =
      target.kind === 'feature' &&
      dropped.some((d) => d.id === target.on && d.feature === target.feature);
    if (!doomed) timers[key] = timer;
  }

  return { ...state, creatures, timers };
}

/**
 * Readied actions whose hold has stopped holding.
 *
 * Two ways it ends without being released, and neither is anybody's decision:
 *
 * - **The deadline passed.** SRD: the Ready action "lets you act by taking a
 *   Reaction before the start of your next turn". That is the `action:ready`
 *   feature's timer, so when the feature is gone the hold is gone with it.
 * - **A held spell's Concentration broke.** SRD: "holding on to the spell's
 *   magic requires Concentration... If your Concentration is broken, the spell
 *   dissipates without taking effect." The slot stays spent — it went when the
 *   spell was readied — and the Reaction was never taken, so nothing is
 *   refunded either way.
 *
 * The first case leaves a held spell's Concentration running with nothing left
 * to release, so ending the casting is part of the same cleanup: SRD caps the
 * hold at "the start of your next turn", and a Concentration that outlived it
 * would block the next spell on behalf of a casting that no longer exists.
 */
function dropLapsedReady(state: GameState): GameState {
  // Two jobs, and the guard has to cover both. The obvious half is lapsing a
  // hold, which needs a creature holding one. The half that caught this guard
  // out is sweeping a **stale Ready timer**, which by definition happens when
  // a creature's `readied` is already null — so guarding on holders alone left
  // a released Ready's deadline sitting in state, and `ready.test.ts` said so
  // within a minute of the optimisation landing.
  const holding = anyCreature(state, (c) => c.readied !== null);
  const scheduled = Object.values(state.timers).some(
    (timer) => timer.target.kind === 'feature' && timer.target.feature === READY,
  );
  if (!holding && !scheduled) return state;

  let current = state;

  for (const key of Object.keys(state.creatures).sort()) {
    const creature = current.creatures[key];
    if (creature === undefined || creature.readied === null) continue;

    const response = creature.readied.response;
    const held =
      response.kind !== 'spell' || creature.concentration?.castingId === response.castingId;
    const running = creature.activeFeatures.includes(READY);
    if (held && running) continue;

    // The deadline is what ended it, so the spell it was holding goes too.
    if (held && response.kind === 'spell') {
      current = releaseCasting(current, creature.id, response.castingId);
    }

    const now = current.creatures[key];
    if (now === undefined) continue;
    current = {
      ...current,
      creatures: {
        ...current.creatures,
        [key]: {
          ...now,
          readied: null,
          activeFeatures: now.activeFeatures.filter((f) => f !== READY),
        },
      },
    };
  }

  // A Ready timer exists only while something is readied — released or
  // lapsed, the deadline has nothing left to end, and a stale one would sit
  // waiting to cut the *next* Ready short.
  const timers: Record<string, TimedEffect> = {};
  let dropped = false;
  for (const [key, timer] of Object.entries(current.timers)) {
    const target = timer.target;
    if (
      target.kind === 'feature' &&
      target.feature === READY &&
      current.creatures[target.on]?.readied == null
    ) {
      dropped = true;
      continue;
    }
    timers[key] = timer;
  }

  return dropped ? { ...current, timers } : current;
}

/** Whether this creature still meets what an active feature demands of them. */
function sustains(creature: CreatureState, feature: string): boolean {
  const definition =
    (creature.sheet.activated ?? []).find((a) => a.feature === feature) ??
    universalAction(feature);
  if (definition === null || definition === undefined) return true;

  for (const requirement of definition.endsOn ?? []) {
    if (requirement === 'incapacitated' && isIncapacitated(creature.conditions)) return false;
    if (requirement === 'heavy-armor' && wearsHeavyArmor(creature)) return false;
  }
  return true;
}

/** SRD Rage: "if you aren't wearing Heavy armor", and "if you don Heavy armor". */
export function wearsHeavyArmor(creature: CreatureState): boolean {
  return creature.equipped.some((itemId) => itemFor(itemId)?.armor?.category === 'heavy');
}

function applyOne(state: GameState, event: GameEvent): GameState {
  const next = { ...state, eventCount: state.eventCount + 1 };

  switch (event.type) {
    case 'creature-added': {
      if (state.creatures[event.id] !== undefined) {
        throw new CorruptLogError(event, `${event.id} is already in this game`);
      }
      return {
        ...next,
        creatures: {
          ...state.creatures,
          [event.id]: {
            id: event.id,
            name: event.name,
            sheet: event.sheet,
            vitals: vitals(event.maxHp, { diesAtZero: event.diesAtZero ?? false }),
            conditions: conditionState(),
            resources: resourceState(),
            concentration: null,
            resting: null,
            lastLongRestAt: null,
            lastShortRestAt: null,
            spellcasting: noSpellcasting(),
            creatureType: event.creatureType ?? null,
            defenses: event.defenses ?? {},
            side: event.side ?? null,
            activeFeatures: [],
            readied: null,
            lastDamage: null,
            bonuses: [],
            armorClasses: [],
            rollModifiers: [],
            grantedDefenses: [],
            initiativeBonuses: [],
            inventory: [],
            equipped: [],
            coins: 0,
            character: null,
          },
        },
      };
    }

    case 'creature-removed': {
      const creature = creatureOf(state, event, event.id);
      // A caster who leaves the game takes their ongoing spell with them.
      // Their record is about to be deleted, so the casting id has to be read
      // off it first or the effects it created would dangle for good.
      const cleaned =
        creature.concentration === null
          ? next
          : releaseCasting(next, event.id, creature.concentration.castingId);
      const creatures = { ...cleaned.creatures };
      delete creatures[event.id];
      // Every *other* spell that was on them stops being on them. Not ended —
      // SRD does not end a Cleric's Bless because one of the blessed walked
      // out — but a name in `on` that no longer belongs to anybody is a
      // dispellable target that does not exist.
      return withoutTarget(
        { ...cleaned, creatures, timers: timersApartFrom(cleaned.timers, event.id) },
        event.id,
        null,
      );
    }

    case 'damage-taken': {
      const creature = creatureOf(state, event, event.id);
      const outcome = applyDamageToVitals(
        creature.vitals,
        event.amount,
        event.critical === undefined ? {} : { critical: event.critical },
      );
      // A dealer overwrites the last one; damage from nothing in the game
      // leaves whatever was there, because a falling rock does not make the
      // thug who stabbed you a moment ago un-stabbed you. The window closes on
      // its own when the turn or the clock moves.
      return withCreature(
        next,
        event.id,
        {
          vitals: outcome.vitals,
          ...(event.by === undefined
            ? {}
            : {
                lastDamage: {
                  by: event.by,
                  turn: state.combat?.turnsTaken ?? null,
                  elapsed: state.elapsed,
                },
              }),
        },
        creature,
      );
    }

    case 'healed': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { vitals: heal(creature.vitals, event.amount) }, creature);
    }

    case 'temporary-hp-granted': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: grantTemporaryHp(creature.vitals, event.amount) },
        creature,
      );
    }

    case 'temporary-hp-cleared': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: { ...creature.vitals, temporaryHp: 0 } },
        creature,
      );
    }

    case 'death-save-recorded': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: resolveDeathSave(creature.vitals, event.natural, event.total ?? event.natural).vitals },
        creature,
      );
    }

    case 'stabilised': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { vitals: stabilize(creature.vitals) }, creature);
    }

    case 'condition-applied': {
      const creature = creatureOf(state, event, event.id);
      const conditions = applyCondition(creature.conditions, event.condition, event.source);
      return alsoOn(
        withCreature(next, event.id, { conditions }, creature),
        event.id,
        event.source,
      );
    }

    case 'condition-removed': {
      const creature = creatureOf(state, event, event.id);
      // Lifting a cause drops what that cause carried — losing Unconscious
      // lifts the Incapacitated it brought — while leaving any other reason
      // for the same condition standing, and leaving Prone behind.
      const conditions = removeCondition(creature.conditions, event.condition, event.source);
      return withCreature(next, event.id, { conditions }, creature);
    }

    case 'exhaustion-set': {
      const creature = creatureOf(state, event, event.id);
      const conditions = setExhaustion(creature.conditions, event.level);
      // SRD: "You die if your Exhaustion level is 6." That is a rule, not
      // something a caller opts into, so it happens here.
      const vitals =
        conditions.exhaustion >= 6 ? { ...creature.vitals, hp: 0, dead: true } : creature.vitals;
      return withCreature(next, event.id, { conditions, vitals }, creature);
    }

    case 'creature-died': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { vitals: { ...creature.vitals, hp: 0, dead: true } },
        creature,
      );
    }

    case 'resource-pool-declared': {
      const creature = creatureOf(state, event, event.id);
      const resources = must(event, declarePool(creature.resources, event.pool));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'resource-spent': {
      const creature = creatureOf(state, event, event.id);
      const resources = must(event, spendResource(creature.resources, event.key, event.amount));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'resource-regained': {
      const creature = creatureOf(state, event, event.id);
      const resources = must(event, restore(creature.resources, event.key, event.amount));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'resource-pool-resized': {
      const creature = creatureOf(state, event, event.id);
      const resources = must(event, resize(creature.resources, event.key, event.max));
      return withCreature(next, event.id, { resources }, creature);
    }

    case 'character-created': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        {
          character: event.record,
          spellcasting: event.spellcasting,
          initiativeBonuses: event.initiativeBonuses,
        },
        creature,
      );
    }

    case 'character-advanced': {
      const creature = creatureOf(state, event, event.id);
      if (creature.character === null) {
        throw new CorruptLogError(event, `${event.id} was not created from character choices`);
      }
      return withCreature(
        next,
        event.id,
        {
          character: event.record,
          // The new level derives a fresh sheet — new hit points, new
          // proficiency, new everything the level changes — and it knows
          // nothing about what this character is wearing. So the sheet is the
          // new one, and its armour comes from the equipment state, which the
          // level did not touch. Gaining a level does not take your armour off,
          // and it does not put back what you took off either.
          sheet: withEquipment(event.sheet, creature.equipped),
          spellcasting: event.spellcasting,
          initiativeBonuses: event.initiativeBonuses,
        },
        creature,
      );
    }

    case 'hit-point-maximum-raised': {
      const creature = creatureOf(state, event, event.id);
      if (!Number.isInteger(event.amount) || event.amount <= 0) {
        throw new CorruptLogError(event, `a hit point maximum rises by a positive whole number, got ${event.amount}`);
      }
      // SRD: the maximum rises; current hit points rise with it, because the
      // new points were never lost. Damage already taken stays taken.
      return withCreature(
        next,
        event.id,
        {
          vitals: {
            ...creature.vitals,
            hpMax: creature.vitals.hpMax + event.amount,
            hp: creature.vitals.hp + event.amount,
          },
        },
        creature,
      );
    }

    case 'resources-restored': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { resources: restoreOn(creature.resources, event.recovers) },
        creature,
      );
    }

    case 'spell-declared': {
      if (state.pendingCasting !== null) {
        throw new CorruptLogError(event, 'a casting is already waiting to resolve');
      }
      creatureOf(state, event, event.casting.caster);

      // The id is allocated here, so this is the event that advances the
      // sequence. The `spell-cast` that settles it must not advance it again.
      const expected = castingIdFor(state.castingsBegun + 1);
      if (event.casting.castingId !== expected) {
        throw new CorruptLogError(
          event,
          `expected casting ${expected}, got ${event.casting.castingId}`,
        );
      }

      return {
        ...next,
        castingsBegun: state.castingsBegun + 1,
        pendingCasting: event.casting,
      };
    }

    case 'spell-ongoing': {
      const casting = event.casting;
      if (state.ongoing[casting.castingId] !== undefined) {
        throw new CorruptLogError(event, `${casting.castingId} is already running`);
      }
      // The casting has to have happened. A record for a casting nobody cast
      // is the shape of every "the model made it up" failure this engine
      // exists to refuse, and the counter is the one fact that proves it.
      if (Number(casting.castingId.slice('cast:'.length)) > state.castingsBegun) {
        throw new CorruptLogError(event, `${casting.castingId} has not been cast`);
      }
      // And it has to still be running. `releaseCasting` is the single place a
      // record is removed, so a record arriving for a casting that has already
      // been through it is a spell coming back from the dead — visible again
      // to Dispel Magic, to the turn boundary and to every area detector, by
      // exactly the route that "one door out" was meant to close.
      if (state.castingsEnded.includes(casting.castingId)) {
        throw new CorruptLogError(event, `${casting.castingId} has already ended`);
      }
      return {
        ...next,
        ongoing: sortedRecord({
          ...state.ongoing,
          // A pre-versioned record is filled in here and nowhere else, so
          // every later read is of a record rather than of the catalogue.
          [casting.castingId]: upgradeOngoing(casting),
        }),
      };
    }
    case 'spell-ended': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      // Two operations the engine has had since Hold Person's repeat save, and
      // the event says which: one creature shakes it off, or the whole spell
      // stops.
      return event.on === null
        ? releaseCasting(next, casterOf(state, event.castingId), event.castingId)
        : releaseOnTarget(next, event.on, event.castingId);
    }
    // Changes nothing, like `roll-recorded`: the action it cost and the damage
    // it dealt are their own events. It is here so the log can say why a spell
    // struck on a turn nobody cast it.
    case 'spell-activated':
      return next;
    case 'area-effect-settled': {
      const at = state.owedAreaEffects.findIndex(
        (owed) =>
          owed.castingId === event.castingId &&
          owed.target === event.target &&
          owed.moment === event.moment,
      );
      if (at < 0) {
        throw new CorruptLogError(
          event,
          `${event.castingId} owes ${event.target} nothing at ${event.moment}`,
        );
      }
      return {
        ...next,
        owedAreaEffects: [
          ...state.owedAreaEffects.slice(0, at),
          ...state.owedAreaEffects.slice(at + 1),
        ],
      };
    }
    case 'spell-origin-moved': {
      const record = state.ongoing[event.castingId];
      if (record === undefined) {
        throw new CorruptLogError(event, `${event.castingId} is not running`);
      }
      // A casting that never held a point cannot have moved one. The command
      // refuses this; a hand-built log that does it anyway is a log and a set
      // of rules that disagree, which is loud rather than absorbed.
      const from = record.origin;
      if (from === undefined) {
        throw new CorruptLogError(event, `${event.castingId} holds no point to move`);
      }
      // The point moves, and then the area it defines is asked who it arrived
      // on. Derived rather than carried on the event for the reason every
      // other consequence in this file is derived: nobody *decides* that a
      // beam swept over somebody, and a replay reconstructs it because the
      // fold does.
      const moved: GameState = {
        ...next,
        ongoing: { ...state.ongoing, [event.castingId]: { ...record, origin: event.to } },
      };
      return raiseAreaArrivals(moved, event.castingId, from, event.to);
    }
    case 'spell-interrupted': {
      const waiting = state.pendingCasting;
      if (waiting === null) throw new CorruptLogError(event, 'no casting is waiting to resolve');
      if (waiting.castingId !== event.castingId) {
        throw new CorruptLogError(
          event,
          `casting ${waiting.castingId} is waiting, not ${event.castingId}`,
        );
      }
      // Nothing is given back. The action was wasted by the same SRD sentence
      // that spares the slot, and the slot was never spent.
      return { ...next, pendingCasting: null };
    }

    case 'spell-cast': {
      const creature = creatureOf(state, event, event.id);

      // Two shapes reach this event and they are not the same. A casting held
      // open since `spell-declared` **settles** here: its id was allocated
      // then, so the sequence does not move again and the window closes. Every
      // other casting is declared and resolved in one breath, and allocates
      // its own id exactly as it always has — which is why every log written
      // before interruptible castings existed still folds unchanged.
      //
      // Matching on the id rather than on "is anything pending" is what lets a
      // Counterspell be cast *while* a casting is open: its own `spell-cast`
      // is a different casting and takes the ordinary branch.
      const waiting = state.pendingCasting;
      const settling = waiting !== null && waiting.castingId === event.castingId;

      if (!settling) {
        // Casting ids run in sequence. Applying a batch twice — a retried
        // command appended a second time — lands here with an id that is no
        // longer next, which is a corrupt log rather than a second casting.
        const expected = castingIdFor(state.castingsBegun + 1);
        if (event.castingId !== expected) {
          throw new CorruptLogError(event, `expected casting ${expected}, got ${event.castingId}`);
        }
      }

      const resources =
        event.slot === null
          ? creature.resources
          : must(event, spendResource(creature.resources, event.slot.key));

      const cast = withCreature(next, event.id, { resources }, creature);
      return {
        ...cast,
        castingsBegun: settling ? state.castingsBegun : state.castingsBegun + 1,
        ...(settling ? { pendingCasting: null } : {}),
        // SRD: "On a turn, you can expend only one spell slot to cast a spell."
        // It reads *expenditure*, so a casting whose slot is still unspent has
        // not used the turn's one slot — and a countered one never will.
        combat:
          event.slot === null || cast.combat === null
            ? cast.combat
            : markSpellSlotSpent(cast.combat, event.id),
      };
    }

    case 'concentration-started': {
      const creature = creatureOf(state, event, event.id);
      if (creature.concentration !== null) {
        throw new CorruptLogError(
          event,
          `${event.id} is already concentrating on ${creature.concentration.castingId}`,
        );
      }
      return withCreature(
        next,
        event.id,
        {
          concentration: { castingId: event.castingId, spell: event.spell, level: event.level },
        },
        creature,
      );
    }

    case 'concentration-ended': {
      const creature = creatureOf(state, event, event.id);
      if (creature.concentration?.castingId !== event.castingId) {
        throw new CorruptLogError(event, `${event.id} is not concentrating on ${event.castingId}`);
      }
      return releaseCasting(next, event.id, event.castingId);
    }

    case 'effect-scheduled':
      return {
        ...next,
        timers: sortedTimers({
          ...state.timers,
          [timerKey(event.target)]: {
            target: event.target,
            deadline: event.deadline,
            ...(event.repeatSave === undefined ? {} : { repeatSave: event.repeatSave }),
            ...(event.check === undefined ? {} : { check: event.check }),
          },
        }),
      };

    case 'effect-check-resolved': {
      const timer = state.timers[event.effectKey];
      if (timer === undefined) {
        throw new CorruptLogError(event, `no effect is filed under ${event.effectKey}`);
      }
      if (timer.check === undefined) {
        throw new CorruptLogError(event, `${event.effectKey} offers no check to attempt`);
      }
      if (!event.success || timer.check.onSuccess === 'none') return next;

      // The only consequence this union can express, and it is the one the
      // repeat save already performs: the casting's effect on that creature
      // ends, and the casting itself carries on for anyone else it caught.
      if (timer.target.kind !== 'condition') {
        throw new CorruptLogError(
          event,
          `${event.effectKey} ends on its target, but it is not on a creature`,
        );
      }
      const castingId = castingIdOf(timer.target.instance);
      if (castingId === null) {
        throw new CorruptLogError(event, `${event.effectKey} belongs to no casting`);
      }
      return releaseOnTarget(next, timer.target.on, castingId);
    }

    case 'damage-scheduled': {
      const key = scheduledDamageKey(event.schedule.source, event.schedule.target);
      return {
        ...next,
        scheduledDamage: sortedRecord({ ...state.scheduledDamage, [key]: event.schedule }),
      };
    }

    case 'scheduled-damage-collected': {
      if (state.scheduledDamage[event.key] === undefined) {
        throw new CorruptLogError(event, `no damage is scheduled under ${event.key}`);
      }
      const scheduledDamage = { ...state.scheduledDamage };
      delete scheduledDamage[event.key];
      return { ...next, scheduledDamage };
    }

    case 'effect-save-resolved': {
      const key = pendingSaveKey(event.effectKey, event.turn);
      const pending = state.pendingSaves[key];
      if (pending === undefined) {
        throw new CorruptLogError(event, `no save is pending for ${event.effectKey} on turn ${event.turn}`);
      }

      const pendingSaves = { ...state.pendingSaves };
      delete pendingSaves[key];
      const cleared: GameState = { ...next, pendingSaves };
      if (!event.success) return cleared;

      // SRD Hold Person: a success ends the spell "on itself" — on that target,
      // not on everyone the casting caught. An effect whose hook says otherwise
      // ends the casting outright.
      return pending.onSuccess === 'end-casting'
        ? releaseCasting(cleared, casterOf(cleared, pending.castingId), pending.castingId)
        : releaseOnTarget(cleared, pending.target, pending.castingId);
    }

    case 'time-advanced': {
      if (!Number.isInteger(event.seconds) || event.seconds < 0) {
        throw new CorruptLogError(event, `time runs forwards in whole seconds, got ${event.seconds}`);
      }
      return { ...next, elapsed: state.elapsed + event.seconds };
    }

    case 'rest-begun': {
      const creature = creatureOf(state, event, event.id);
      if (creature.resting !== null) {
        throw new CorruptLogError(event, `${event.id} is already resting`);
      }
      return withCreature(
        next,
        event.id,
        {
          resting: {
            kind: event.kind,
            startedAt: state.elapsed,
            interruptedBy: null,
            interruptedAt: null,
          },
        },
        creature,
      );
    }

    case 'rest-ended': {
      const creature = creatureOf(state, event, event.id);
      if (creature.resting === null) {
        throw new CorruptLogError(event, `${event.id} is not resting`);
      }
      // A Long Rest only starts the sixteen-hour clock if it was actually
      // finished as one. A Long Rest that collapsed into a Short Rest does
      // not, or an interrupted night would lock out the next one.
      return withCreature(
        next,
        event.id,
        {
          resting: null,
          ...(event.benefit === 'long' ? { lastLongRestAt: state.elapsed } : {}),
          // SRD: an interrupted Long Rest of at least an hour "gains the
          // benefits of a Short Rest", so what is recorded is what the rest
          // earned rather than what it set out to be.
          ...(event.benefit === 'short' ? { lastShortRestAt: state.elapsed } : {}),
        },
        creature,
      );
    }

    case 'combat-started':
      return { ...next, combat: must(event, startCombat(event.combatants)) };

    case 'combat-ended':
      return { ...next, combat: null };

    case 'turn-advanced': {
      const before = combatOf(state, event);
      const after = advanceTurn(before);
      return raiseTurnEnd(
        raiseTurnSaves(withCombat(next, state, after), before, after),
        before,
        after,
      );
    }

    case 'action-spent':
      return withCombat(next, state, must(event, spendAction(combatOf(state, event), event.id)));

    case 'bonus-action-spent':
      return withCombat(
        next,
        state,
        must(event, spendBonusAction(combatOf(state, event), event.id)),
      );

    case 'attack-made': {
      const creature = creatureOf(state, event, event.id);
      return withCombat(
        next,
        state,
        must(
          event,
          spendAttack(
            combatOf(state, event),
            event.id,
            creature.sheet.attacksPerAction ?? 1,
            creature.conditions,
          ),
        ).state,
      );
    }
    // SRD Dash: "The increase equals your Speed **after applying any
    // modifiers**." `speedOf` is the one reader of that, so the fold asks it
    // exactly as `takeDash` does — the command's own check with the command's
    // own inputs, which is the only thing that makes a reducer backstop honest.
    case 'dash-taken':
      return withCombat(
        next,
        state,
        must(event, dash(combatOf(state, event), event.id, speedOf(state, event.id))),
      );
    case 'disengage-taken': {
      return withCombat(
        next,
        state,
        must(event, disengage(combatOf(state, event), event.id)),
      );
    }
    case 'reaction-spent':
      return withCombat(next, state, must(event, spendReaction(combatOf(state, event), event.id)));

    // The allowance is `speedOf`'s, here as in `resolveMove`. This call used to
    // pass no Speed at all and fell back to the pinned one, so the fold
    // measured the very event the command had emitted against a different
    // number — and refused a Monk's legal 35-foot move as a corrupt log. A
    // backstop with the wrong inputs is a fork, not a guard.
    case 'movement-spent':
      return withCombat(
        next,
        state,
        must(
          event,
          spendMovement(combatOf(state, event), event.id, event.feet, speedOf(state, event.id)),
        ),
      );

    case 'free-interaction-used':
      return withCombat(
        next,
        state,
        must(event, useFreeInteraction(combatOf(state, event), event.id)),
      );

    case 'combatant-removed':
      return withCombat(
        next,
        state,
        must(event, removeCombatant(combatOf(state, event), event.id)),
      );

    case 'initiative-swapped':
      return withCombat(
        next,
        state,
        must(event, swapInitiative(combatOf(state, event), event.a, event.b)),
      );

    case 'scene-set':
      return { ...next, scene: scene(event.extent) };

    case 'landmark-added':
      return { ...next, scene: must(event, addLandmark(sceneOf(state, event), event.name, event.at)) };

    case 'creature-placed':
      return {
        ...next,
        scene: must(event, placeCreature(sceneOf(state, event), event.id, event.placement)),
      };

    case 'feature-used': {
      if (state.combat === null) {
        throw new CorruptLogError(event, 'a once-per-turn feature was used outside combat');
      }
      creatureOf(state, event, event.id);
      return { ...next, combat: markFeatureUsed(state.combat, event.id, event.feature, event.turn) };
    }

    case 'feature-activated': {
      const creature = creatureOf(state, event, event.id);
      if (creature.activeFeatures.includes(event.feature)) {
        throw new CorruptLogError(event, `${event.id} is already in ${event.feature}`);
      }
      return withCreature(
        next,
        event.id,
        { activeFeatures: [...creature.activeFeatures, event.feature].sort() },
        creature,
      );
    }
    case 'feature-ended': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { activeFeatures: creature.activeFeatures.filter((f) => f !== event.feature) },
        creature,
      );
    }
    case 'readied-declared': {
      const creature = creatureOf(state, event, event.id);
      if (creature.readied !== null) {
        throw new CorruptLogError(event, `${event.id} is already holding a readied action`);
      }
      return withCreature(next, event.id, { readied: event.readied }, creature);
    }
    case 'readied-released': {
      const creature = creatureOf(state, event, event.id);
      if (creature.readied === null) {
        throw new CorruptLogError(event, `${event.id} has no readied action to release`);
      }
      return withCreature(
        next,
        event.id,
        {
          readied: null,
          activeFeatures: creature.activeFeatures.filter((f) => f !== READY),
        },
        creature,
      );
    }
    case 'movement-declared': {
      if (state.pendingMove !== null) {
        throw new CorruptLogError(event, 'a move is already waiting');
      }
      // **Built from the fields this engine knows, never stored verbatim.**
      // Both frozen logs were written when `PendingMove` carried the distance,
      // and nothing ever read it; spreading the event would put a field the
      // type no longer declares into live state for the life of the move —
      // the same data-nothing-can-explain that `upgradeOngoing` keeps out of
      // an ongoing record.
      return {
        ...next,
        pendingMove: {
          mover: event.move.mover,
          placement: event.move.placement,
          destination: event.move.destination,
          provoked: event.move.provoked,
        },
      };
    }
    case 'opportunity-answered': {
      const waiting = state.pendingMove;
      if (waiting === null) throw new CorruptLogError(event, 'no move is waiting');
      return {
        ...next,
        pendingMove: {
          ...waiting,
          provoked: waiting.provoked.filter((p) => p.reactor !== event.reactor),
        },
      };
    }
    case 'movement-completed': {
      const waiting = state.pendingMove;
      if (waiting === null) throw new CorruptLogError(event, 'no move is waiting');
      if (waiting.provoked.length > 0) {
        throw new CorruptLogError(event, 'the move still owes an Opportunity Attack');
      }
      return { ...next, pendingMove: null };
    }
    case 'attack-landed': {
      if (state.pendingAttack !== null) {
        throw new CorruptLogError(event, 'an attack is already being held');
      }
      return { ...next, pendingAttack: event.attack };
    }
    case 'attack-damage-dealt': {
      if (state.pendingAttack === null) {
        throw new CorruptLogError(event, 'no attack is being held');
      }
      return { ...next, pendingAttack: null };
    }
    case 'damage-rolled': {
      if (state.pendingDamage !== null) {
        throw new CorruptLogError(event, 'a damage roll is already being held');
      }
      return { ...next, pendingDamage: event.damage };
    }
    case 'damage-reaction-answered': {
      const waiting = state.pendingDamage;
      if (waiting === null) throw new CorruptLogError(event, 'no damage roll is being held');
      // An answer from somebody who was never offered one is a log and a set of
      // rules that disagree, not a rules dispute — the same loudness a second
      // action in one turn gets.
      const answered = offerAnswered(event);
      if (!waiting.offers.some(answered)) {
        throw new CorruptLogError(
          event,
          `${event.reactor} was not offered ${event.feature ?? 'a Reaction'} against this damage`,
        );
      }
      return {
        ...next,
        pendingDamage: {
          ...waiting,
          reductions:
            event.reduction === undefined
              ? waiting.reductions
              : [...waiting.reductions, event.reduction],
          offers: waiting.offers.filter((o) => !answered(o)),
        },
      };
    }
    case 'damage-settled': {
      const waiting = state.pendingDamage;
      if (waiting === null) throw new CorruptLogError(event, 'no damage roll is being held');
      if (waiting.target !== event.target) {
        throw new CorruptLogError(
          event,
          `the damage being held is against ${waiting.target}, not ${event.target}`,
        );
      }
      if (waiting.offers.length > 0) {
        throw new CorruptLogError(event, 'somebody still owes an answer to this damage');
      }
      return { ...next, pendingDamage: null };
    }
    case 'test-rolled': {
      if (state.pendingTest !== null) {
        throw new CorruptLogError(event, 'a D20 Test is already being held');
      }
      return { ...next, pendingTest: event.test };
    }
    case 'test-reaction-answered': {
      const waiting = state.pendingTest;
      if (waiting === null) throw new CorruptLogError(event, 'no D20 Test is being held');
      const answered = offerAnswered(event);
      if (!waiting.offers.some(answered)) {
        throw new CorruptLogError(
          event,
          `${event.reactor} was not offered ${event.feature ?? 'a Reaction'} against this test`,
        );
      }
      return {
        ...next,
        pendingTest: {
          ...waiting,
          // The pushed roll replaces the old one. The superseded number is on
          // the result itself, so the log still shows what was given up.
          ...(event.result === undefined ? {} : { result: event.result }),
          offers: waiting.offers.filter((o) => !answered(o)),
        },
      };
    }
    case 'test-settled': {
      const waiting = state.pendingTest;
      if (waiting === null) throw new CorruptLogError(event, 'no D20 Test is being held');
      if (waiting.who !== event.who) {
        throw new CorruptLogError(
          event,
          `the D20 Test being held is ${waiting.who}'s, not ${event.who}'s`,
        );
      }
      if (waiting.offers.length > 0) {
        throw new CorruptLogError(event, 'somebody still owes an answer to this test');
      }
      return { ...next, pendingTest: null };
    }
    // Changes nothing, like `roll-recorded`. It exists so the log can say why
    // a creature swung outside its turn, and so the command that did it has a
    // stamp to ride on.
    case 'reaction-taken':
      return next;
    case 'creature-side-declared': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { side: event.side }, creature);
    }
    case 'creature-moved': {
      const outcome = must(
        event,
        moveCreature(
          sceneOf(state, event),
          event.id,
          event.placement,
          event.forced === undefined ? {} : { forced: event.forced },
        ),
      );
      // **The authoritative transition, and the only one that is entry.** A
      // declared move is an intent an Opportunity Attack can end; this is the
      // creature actually arriving. Forced movement lands here too, because a
      // creature shoved into a Web has entered it.
      return raiseAfterMovement({ ...next, scene: outcome.state }, state.scene);
    }

    case 'creature-unplaced':
      return { ...next, scene: must(event, removeCreature(sceneOf(state, event), event.id)) };

    case 'items-gained': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { inventory: mergeItems(creature.inventory, event.items) },
        creature,
      );
    }

    case 'items-lost': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { inventory: removeItems(creature.inventory, event.items) },
        creature,
      );
    }

    case 'coins-changed': {
      const creature = creatureOf(state, event, event.id);
      const coins = creature.coins + event.copper;
      if (coins < 0) {
        throw new CorruptLogError(event, `${event.id} cannot hold ${coins} copper`);
      }
      return withCreature(next, event.id, { coins }, creature);
    }

    case 'item-equipped': {
      const creature = creatureOf(state, event, event.id);
      if (creature.equipped.includes(event.item)) {
        throw new CorruptLogError(event, `${event.item} is already equipped`);
      }
      const equipped = [...creature.equipped, event.item].sort();
      return withCreature(
        next,
        event.id,
        { equipped, sheet: withEquipment(creature.sheet, equipped) },
        creature,
      );
    }

    case 'item-unequipped': {
      const creature = creatureOf(state, event, event.id);
      if (!creature.equipped.includes(event.item)) {
        throw new CorruptLogError(event, `${event.item} is not equipped`);
      }
      const equipped = creature.equipped.filter((held) => held !== event.item);
      return withCreature(
        next,
        event.id,
        { equipped, sheet: withEquipment(creature.sheet, equipped) },
        creature,
      );
    }

    case 'bonus-applied': {
      const creature = creatureOf(state, event, event.id);
      // Re-applying the same source replaces it rather than stacking: a second
      // Bless from the same casting is the same Bless.
      const bonuses = [
        ...creature.bonuses.filter((held) => held.source !== event.bonus.source),
        event.bonus,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { bonuses }, creature);
    }

    case 'armor-class-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces it rather than stacking, the
      // same rule `bonus-applied` follows: a second Mage Armor from the same
      // casting is the same Mage Armor.
      const armorClasses = [
        ...creature.armorClasses.filter((held) => held.source !== event.armorClass.source),
        event.armorClass,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { armorClasses }, creature);
    }

    case 'roll-modifier-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting the same rolls from the same source replaces rather than
      // stacks — the rule `bonus-applied` and `armor-class-granted` follow —
      // but **the source alone is not the identity here**, because one casting
      // can grant two: Beacon of Hope's Wisdom saves and Death Saving Throws
      // are one sentence and two modifiers. See `rollModifierKey`.
      const key = rollModifierKey(event.modifier.source, event.modifier.modifier.selector);
      const rollModifiers = [
        ...creature.rollModifiers.filter(
          (held) => rollModifierKey(held.source, held.modifier.selector) !== key,
        ),
        event.modifier,
      ].sort((a, b) => {
        const left = rollModifierKey(a.source, a.modifier.selector);
        const right = rollModifierKey(b.source, b.modifier.selector);
        return left < right ? -1 : left > right ? 1 : 0;
      });
      return withCreature(next, event.id, { rollModifiers }, creature);
    }

    case 'damage-defense-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces it rather than stacking —
      // the rule `bonus-applied` and `armor-class-granted` follow, and the one
      // the SRD itself insists on here: "multiple instances of Resistance to
      // the same damage type count as only one", so there is nothing a second
      // copy could add.
      //
      // **The source alone is the identity**, unlike `roll-modifier-granted`.
      // Beacon of Hope needed a per-selector key because one casting grants two
      // modifiers in one sentence; no SRD sentence grants two *defences*, and a
      // per-kind key here would be the identity the `grants` timer deliberately
      // does not have.
      const grantedDefenses = [
        ...creature.grantedDefenses.filter((held) => held.source !== event.defense.source),
        {
          ...event.defense,
          // Lower-cased on the way in, so a fold compares byte for byte however
          // the type was spelled and the keys match the table `applyDamage`
          // sums into.
          damageTypes: [...event.defense.damageTypes.map((t) => t.toLowerCase())].sort(),
        },
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { grantedDefenses }, creature);
    }

    case 'bonus-removed': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { bonuses: creature.bonuses.filter((held) => held.source !== event.source) },
        creature,
      );
    }

    case 'spellcasting-declared': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(next, event.id, { spellcasting: event.spellcasting }, creature);
    }

    case 'creature-type-declared': {
      const creature = creatureOf(state, event, event.id);
      // A type is durable: a stat block prints it, a species grants it, a DM
      // declares it once. Restating it is harmless and changes nothing;
      // contradicting it is not a new fact but a rewrite of one that Hold
      // Person may already have been cast on the strength of. The command
      // layer refuses that, so a contradiction in the log means it was
      // bypassed — the corrupt-log case. A transformation that legitimately
      // changes a type (Wild Shape, Polymorph) will be its own event.
      if (creature.creatureType === event.creatureType) return next;
      if (creature.creatureType !== null) {
        throw new CorruptLogError(
          event,
          `${event.id} is already established as ${creature.creatureType}; a declaration cannot make them ${event.creatureType}`,
        );
      }
      return withCreature(next, event.id, { creatureType: event.creatureType }, creature);
    }

    case 'sight-declared':
      return {
        ...next,
        scene: must(event, declareSight(sceneOf(state, event), event.from, event.to, event.seen)),
      };

    case 'cover-declared':
      return {
        ...next,
        scene: must(event, declareCover(sceneOf(state, event), event.from, event.to, event.degree)),
      };

    // Mounting and dismounting move a creature to a space it was not in — SRD
    // charges half your Speed for the first — so both are authoritative
    // transitions and both can carry somebody into an area.
    case 'mounted':
      return raiseAfterMovement(
        {
          ...next,
          scene: must(
            event,
            mount(sceneOf(state, event), event.rider, event.mount, { willing: event.willing }),
          ),
        },
        state.scene,
      );

    case 'dismounted':
      return raiseAfterMovement(
        {
          ...next,
          scene: must(event, dismount(sceneOf(state, event), event.rider, event.placement)),
        },
        state.scene,
      );

    // A record, not a mutation: the consequences arrive as their own events.
    case 'roll-recorded':
      return next;

    case 'rolls-issued':
      return { ...next, rollsIssued: state.rollsIssued + event.count, rng: event.rng };
  }

  // **A corrupt log is loud**, and this is the case that was quiet. An event
  // the switch does not recognise used to fall out of it and return
  // `undefined`, which then failed several derived passes later with a
  // TypeError naming a function that had nothing to do with it.
  //
  // That is tolerable while every log is built in this process by these
  // commands. It stops being tolerable the moment logs come back from
  // Postgres as JSON, where a type is a string somebody wrote down last
  // season: a renamed or retired event silently becomes an undefined world.
  //
  // The `never` binding is the other half, and it is free: adding a variant to
  // `GameEvent` without a case here is a compile error rather than a runtime
  // surprise.
  const unhandled: never = event;
  throw new CorruptLogError(
    unhandled as GameEvent,
    'the reducer has no rule for this event type; the log and the code disagree',
  );
}

/** Fold a whole log into the state it describes. */
export function fold(seed: string, events: readonly GameEvent[]): GameState {
  return events.reduce(applyEvent, initialState(seed));
}

/**
 * Everything that has happened to one creature, in order.
 *
 * The point of keeping the log rather than only the state: "show me exactly why
 * the goblin died" is a filter, not an investigation.
 */
export function historyOf(
  events: readonly GameEvent[],
  id: CharacterId,
): readonly GameEvent[] {
  return events.filter((event) => {
    if ('id' in event) return event.id === id;
    if ('rider' in event) return event.rider === id || ('mount' in event && event.mount === id);
    if ('from' in event && 'to' in event) return event.from === id || event.to === id;
    if ('a' in event) return event.a === id || event.b === id;
    if (event.type === 'combat-started') return event.combatants.some((c) => c.id === id);
    return false;
  });
}
