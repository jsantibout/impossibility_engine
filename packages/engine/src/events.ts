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
 *
 * **This file is the schema and the barrel, and nothing else.** It held the
 * state types and the whole reducer until IE-039; what is left is the union —
 * which five test files read by this path — and the two re-exports below. The
 * fold is in `fold/`, the state types in `state.js`, and both import this one
 * `type`-only, so every edge back into this file is erased and the run-time
 * graph is the DAG `scripts/fold-graph.ts` reports.
 */
import type { CharacterId, ConditionName, RollId } from '@ie/shared';
import type { Armor, CreatureSize } from '@ie/srd';
import type { CharacterSheet, GrantedArmorClass } from './character.js';
import { type ActiveRollModifier } from './roll-modifiers.js';
import type { DieRoll, RngState } from './dice.js';
import { type PoolDeclaration, type Recovery } from './resources.js';
import type { CharacterRecord } from './creation.js';
import type { DamageDefenses, DamageReduction, GrantedDefense } from './attack.js';
import type { DeniedBenefit, GrantedConditionImmunity } from './conditions.js';
import type { D20TestResult } from './checks.js';
import type { GrantedReaction, ReactionWindow } from './reactions.js';
import type { ActiveBonus, ModeSource } from './bonuses.js';
import { type SpellcastingState } from './spellcasting.js';
import type { RestBenefit, RestKind } from './rest.js';
import { type Deadline } from './time.js';
import { type GrantedHealingRule, type GrantedHitPointMaximum } from './vitals.js';
import {
  type EffectEndCause,
  type EffectTarget,
  type GrantedPayout,
  type RepeatSave,
  type EffectCheck,
  type ScheduledDamage,
} from './timers.js';
import {
  type AreaMoment,
  type CastingTime,
  type ConcentrationEndReason,
  type OngoingEndReason,
  type SlotlessReason,
  type WrittenOngoing,
} from './spells.js';
import { type CombatantInput, type GrantedActionRule, type NamedAction } from './combat.js';
import { type GrantedAttackRider, type GrantedSpeed, type StandingEffect } from './standing.js';
import {
  type CoverDegree,
  type LightLevel,
  type ObscurementDegree,
  type Placement,
  type SceneExtent,
  type Point,
  type TerrainRegion,
} from './positioning.js';

// `CreatureState` is deliberately not imported: the union names it only in a
// `{@link}`, and the barrel below re-exports it, so the link resolves in this
// module without an import that ESLint reads as unused and `tsc` does not.
import type {
  CommandStamp,
  InventoryLine,
  PendingAttack,
  PendingCasting,
  PendingDamage,
  PendingMove,
  PendingTest,
  ReadiedAction,
} from './state.js';

/**
 * The barrel, and the reason it is this file rather than a new one.
 *
 * **Every** module that imported from this path still does, and `index.ts`
 * re-exports it wholesale, so the public surface stays exactly the twenty-five
 * names it has always been and not one importing module is touched. What moved
 * is where those names are *declared*, which is the only thing this split was
 * for. (No count: the figure depends on whether tests and the other packages
 * are in it, and a number in prose that nothing regenerates is the thing this
 * repository keeps finding wrong. The quantifier is what carries the sentence
 * and it is checkable — nothing outside `fold/` imports `./state.js` or
 * `./fold/*`.)
 *
 * The `./fold/*` half is now checked rather than claimed: the
 * `no-restricted-imports` zone in `eslint.config.js` refuses a fold import
 * from any module outside `packages/engine/src/fold/`, with the
 * `export *` below as the one carved-out exception, and
 * `fold-import-boundary.test.ts` runs ESLint to prove the zone bites and
 * where it stays quiet. Test files are exempt by design, so the sentence
 * above is a statement about the shipped import graph; the `./state.js` half
 * is still held by reading.
 *
 * Fourteen from `state.js`, ten from `fold/`, and the union below. Each of
 * those two publishes exactly what was public before and no more — a function
 * is `export`ed from its own module so a sibling seam may call it, and that is
 * not the same thing as being part of `@ie/engine`, which is the line
 * `commands.ts` already draws.
 *
 * **The asymmetry below is deliberate: `state.js` is enumerated here and
 * `fold/` is starred, because the fold has a barrel of its own and the state
 * types do not.** `fold/index.ts` is already the gate — a helper added to
 * `fold/release.ts` reaches a sibling seam and stops there — so starring it
 * re-exports exactly the ten names it chose to publish. `state.ts` has no such
 * gate, and every declaration in it being public today is what makes a star
 * look free: it is the *next* one that matters, a helper added to serve
 * `initialState` joining `@ie/engine` because nothing was asked. That is
 * precisely what "before the split, exported and public were the same word"
 * means, and the argument does not stop applying because the list currently
 * happens to agree.
 */
export type {
  AppliedCommand,
  CommandStamp,
  CreatureState,
  GameState,
  InventoryLine,
  LastDamage,
  PendingAttack,
  PendingCasting,
  PendingDamage,
  PendingHitRider,
  PendingMove,
  PendingTest,
  ReadiedAction,
  ReadiedResponse,
  SummonBond,
} from './state.js';
export {
  initialState,
  itemInstanceFor,
  itemInstanceNumber,
  ITEM_INSTANCE_PREFIX,
} from './state.js';
export * from './fold/index.js';

/**
 * A roll the engine did not throw, on the record of the roll.
 *
 * `RollSource` has three members and this shape can hold two of them: the
 * absence of this field **is** `engine`, and `'engine'` is not expressible
 * here at all. That is the point rather than a tidiness — an engine-rolled
 * site cannot fill it wrongly, because there is nothing correct it could put
 * in it, and a reader of an old log is not left wondering whether a missing
 * field means "the engine threw it" or "nobody said".
 *
 * **Absent is what every log ever written says**, which is what makes the
 * field additive: the two frozen fixtures fold unchanged because neither ever
 * carried a roll from anywhere else. `modes?` on `roll-recorded` is the
 * precedent and states the same argument in its own docstring.
 *
 * **It arrives ahead of its filler, deliberately.** Nothing produces a
 * non-engine roll through a command today — `recordExternalD20` and
 * `recordExternalDamage` are swept out of both AI-held surfaces and the door a
 * table of physical dice would reach them through is not built — so every
 * occurrence of this field in a driven log is absent, and
 * `damage-dice-in-the-log.test.ts` sweeps a whole one to say so. It is
 * declared now because it belongs to the same events the damage dice opened.
 *
 * **Declared everywhere it belongs, filled in two places.** It is on
 * `roll-recorded` and on every slice of `damage-dice-recorded`, and the sites
 * that fill it are the weapon attack and the damage Reaction — the two this
 * field's own branch owned. Which sites do not, and why that is safe until the
 * door lands, is recorded on `roll-recorded.stated` rather than left to be
 * inferred from this one.
 */
export interface StatedRoll {
  /** The id the issuer gave it, so the record joins the roll it describes. */
  readonly id: RollId;
  readonly source: 'physical-dice' | 'dm-override';
  /** Why a roll was overridden. Null for a roll that was simply read out. */
  readonly note: string | null;
}

/**
 * One typed slice of a damage roll, with every face it showed.
 *
 * The same cut `DamageComponent` makes, because it is the cut the rules make:
 * Resistance is per type, a Critical doubles the dice of the components that
 * came from the hit, and SRD Great Weapon Fighting rerolls the dice of *the
 * weapon's* damage and not of the Divine Smite beside it. So the faces are
 * grouped by the component that threw them rather than flattened into one
 * list — a flat list could not answer any of those three questions, and a
 * label a reader had to parse to answer them would be prose standing in for
 * structure.
 *
 * `dice` is `RollOutcome.dice` as it was thrown: **every die in the order it
 * was rolled, dropped and rerolled ones included**. That is what SRD Sorcerous
 * Burst's explosion and Chromatic Orb's matching faces are about, and what
 * makes a substitution visible — a Great Weapon Fighting die shows the 1 it
 * rolled and the 3 it counts as, side by side.
 *
 * A component that threw nothing carries an empty `dice` and its `flat`, which
 * is how an ability modifier appears: the record is a complete account of the
 * pre-defence total rather than a list of dice with a hole where the
 * arithmetic was.
 */
export interface RecordedDamageDice {
  /** Where the slice came from: the weapon, "Flame Tongue", "Dueling". */
  readonly source: string;
  readonly type: string;
  /** The id the engine issued for this slice's roll, or null where it threw none. */
  readonly roll: RollId | null;
  /** Every face, in the order thrown. Empty for a slice that is all modifier. */
  readonly dice: readonly DieRoll[];
  /** What was added without being rolled for. */
  readonly flat: number;
  /** The slice's own total, before the target's defences. */
  readonly total: number;
  readonly stated?: StatedRoll;
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
      /**
       * Conditions this creature's stat block says it cannot be given at all.
       *
       * The other half of the run a stat block prints in one line: a Zombie's
       * "Immunities Poison; Exhaustion, Poisoned" is one damage type and two
       * conditions, and the engine treats the two completely differently. The
       * damage half has reached `defenses` since defences landed; this half
       * reached nothing, so a Zombie was Poisoned by Ray of Sickness like
       * anybody.
       *
       * **Optional, and absent means none.** Every log written before this
       * carries no such field and means exactly what it always meant, which is
       * why both frozen fixtures fold unchanged and neither was regenerated.
       *
       * Unconditional entries only, exactly as `defenses` is. "Charmed (except
       * from its vampire master)" is a restriction no boolean captures, and
       * treating it as absolute makes the vampire unable to charm the one
       * creature the entry exists to let it charm — so it is withheld and
       * reported rather than written here.
       */
      readonly conditionImmunities?: readonly ConditionName[];
      /**
       * How much space this creature takes up, as its stat block prints it.
       *
       * Pinned here so that placing it is not a second reading of a fact the
       * book already answered. Before this, `creature-placed` was the only
       * carrier of a size and nothing supplied it but the caller — so a model
       * driving the engine ended up **stating** whether an ogre was Large,
       * which is a fact the SRD prints and therefore one the Engine owes the
       * caller rather than asks of it. `placeCreatureInScene` reads it when a
       * caller states none; a caller who states one still wins, because
       * shrinking a hound is a fact only the table has.
       *
       * **Optional, and absent means Medium** — what `placeCreature` has
       * always defaulted to and therefore exactly what every log written
       * before this field says. The reading `conditionImmunities` takes above,
       * and the reason both frozen fixtures fold unchanged and neither was
       * regenerated.
       */
      readonly size?: CreatureSize;
      /** Which side of the fight this creature is on. See {@link CreatureState.side}. */
      readonly side?: string;
      readonly command?: CommandStamp;
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
   * A roll has used up what a source granted this creature.
   *
   * SRD Guiding Bolt: "**the next attack roll** made against it ... has
   * Advantage." SRD Vicious Mockery: "Disadvantage on **the next attack roll
   * it makes**." A grant that a roll *spends* is the one ending the engine had
   * no door for: every other grant ends when the thing that made it ends, or
   * when a deadline arrives, and neither of those is a die being thrown.
   *
   * **An event rather than a second reader of the fold**, because a door in
   * the fold *is* an event plus a fold case: `GameState` is `fold(events)`, so
   * a release nothing in the log records is a state two replays of the same
   * log would disagree about.
   *
   * **Not a widening of `roll-recorded`.** That event is the audit trail of a
   * roll and only one of its eleven emitters fills in `modes` at all; a fold
   * that read the list would also be matching mixed provenance, because a
   * standing feature contributes its display *name* there and a granted
   * modifier its source string. Consumption is decided by
   * {@link consumedRollModifiers} from the same selector the roll matched on,
   * and says so in its own event.
   *
   * **The body is `releaseGrants`, which is the `grants` deadline's body.**
   * What ends is everything that source granted *this* creature, which is one
   * question however many families answer it — so a spell that hung a mode and
   * a bonus in one sentence loses both, exactly as it would have at the
   * deadline. The two endings are the same ending arriving two ways, and a
   * consumed grant simply leaves its timer standing over nothing.
   *
   * `source` is the bare source a grant carries, never a `rollModifierKey`:
   * see {@link releaseGrants}, which says why the identity that decides a
   * re-grant is not the identity that decides an ending.
   */
  | {
      readonly type: 'roll-modifier-consumed';
      readonly id: CharacterId;
      readonly source: string;
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
   * An ongoing effect changes a creature's Speed.
   *
   * Its own event rather than a `bonus-applied` carrying feet, because a Speed
   * is not a roll: `BonusApplies` covers attacks, saves, ability checks and an
   * Armour Class, and a Speed is none of those — and two of the three things
   * an effect can do to one are not arithmetic at all. SRD Slow halves and
   * Hypnotic Pattern zeroes, and presence does not add.
   *
   * Ended by the source it carries, exactly as the other four grants are, so
   * there is no removal event: `releaseCasting`, `releaseOnTarget` and the
   * `grants` timer are the doors.
   */
  | {
      readonly type: 'speed-modifier-granted';
      readonly id: CharacterId;
      readonly modifier: GrantedSpeed;
    }

  /**
   * An ongoing effect adds damage to a creature's later attacks.
   *
   * Its own event rather than a `bonus-applied`, because `BonusApplies` covers
   * attacks, saves, ability checks and an Armour Class — all of them *rolls*
   * or a number rolled against — and damage is none of them. And a bonus folds
   * into the weapon's own damage type, where the whole point of this is that
   * SRD Divine Favor's Radiant and Hunter's Mark's Force meet the target's
   * defences **separately**: a component of its own, doubled on a Critical Hit
   * like every other damage die.
   *
   * **`id` is the attacker**, not the creature the rider names. See
   * {@link GrantedAttackRider}.
   *
   * Ended by the source it carries, exactly as the other five grants are, so
   * there is no removal event: `releaseCasting`, `releaseOnTarget` and the
   * `grants` timer are the doors.
   */
  | {
      readonly type: 'attack-rider-granted';
      readonly id: CharacterId;
      readonly rider: GrantedAttackRider;
    }

  /**
   * An ongoing effect makes a creature immune to named conditions.
   *
   * The seventh sourced grant, and the half IE-017 left behind when it built
   * the damage one: a stat block prints damage types and conditions in one run
   * — a Zombie's "Immunities Poison; Exhaustion, Poisoned" — and the engine
   * treats them completely differently, so a granted Resistance reached
   * `defensesOf` and a granted Immunity to the Charmed condition had nowhere to
   * go. SRD Mind Blank: "Until the spell ends, one willing creature you touch
   * has Immunity to Psychic damage **and the Charmed condition**."
   *
   * Its own event rather than a write into `CreatureState.conditionImmunities`,
   * for the reason `damage-defense-granted` is its own: what a creature *is*
   * and what a spell has *done to it* are two facts with two lifetimes, and the
   * printed table carries no source to end a grant by.
   *
   * **Nothing here is a suppression.** SRD Aura of Courage lets the condition
   * land and stops it biting while the ally is in the aura, which is
   * `suppressedConditions` and a different rule; this refuses the condition
   * outright, which is what `conditionImmunitiesOf` answers.
   *
   * Ended by the source it carries, exactly as the other six grants are, so
   * there is no removal event: `releaseCasting`, `releaseOnTarget` and the
   * `grants` timer are the doors.
   */
  | {
      readonly type: 'condition-immunity-granted';
      readonly id: CharacterId;
      readonly immunity: GrantedConditionImmunity;
    }

  /**
   * A payout this creature now receives at each of its turn boundaries.
   *
   * SRD Heroism: "gains Temporary Hit Points equal to your spellcasting ability
   * modifier at the start of each of its turns." The eighth sourced grant, and
   * it is the arrangement rather than any of the payments: what lands each turn
   * is an ordinary `temporary-hp-granted`, `hit-points-healed` or
   * `damage-taken`, from the same functions every other spell reaches.
   *
   * **Every number the definition printed is on this event.** `flat` already
   * carries the caster's spellcasting modifier, resolved at the cast, and
   * `dice` is the notation the boundary will throw — so the boundary reads the
   * log rather than the catalogue, and a definition corrected next year does
   * not change what a casting made this year pays out.
   *
   * Ended by the source it carries, exactly as the other seven grants are, so
   * there is no removal event.
   */
  | {
      readonly type: 'turn-payout-granted';
      readonly id: CharacterId;
      readonly payout: GrantedPayout;
    }

  /**
   * A rule this creature's turn is now subject to — the ninth sourced grant.
   *
   * SRD Stinking Cloud: "can't take an action or a Bonus Action." SRD Wind
   * Walk: "The only actions a target can take in this form are …" SRD Conjure
   * Woodland Beings: "you can take the Disengage action as a Bonus Action."
   * Three sentences, one record; see {@link ActionRule} in `combat.ts` for the
   * vocabulary and for why a compulsion is a legality rather than an order.
   *
   * Ended by the source it carries, exactly as the other eight grants are, so
   * there is no removal event.
   */
  | {
      readonly type: 'action-rule-granted';
      readonly id: CharacterId;
      readonly rule: GrantedActionRule;
    }

  /**
   * What a running effect has said about this creature regaining hit points —
   * the eleventh sourced grant.
   *
   * SRD Beacon of Hope: each target "regains the maximum number of Hit Points
   * possible from any healing." SRD Chill Touch: on a hit "it can't regain Hit
   * Points until the end of your next turn." One record for two sentences, and
   * `HealingRule` is where the pair is argued.
   *
   * Ended by the source it carries, exactly as the other ten are, so there is
   * no removal event.
   */
  | {
      readonly type: 'healing-rule-granted';
      readonly id: CharacterId;
      readonly rule: GrantedHealingRule;
    }

  /**
   * A condition's **benefits** withheld from a creature that still has it —
   * the thirteenth sourced grant.
   *
   * SRD Starry Wisp: on a hit "until the end of your next turn, it … can't
   * benefit from the Invisible condition." Not the condition ending and not
   * an Immunity to it arriving; see {@link DeniedBenefit}, where the three
   * are told apart.
   *
   * Ended by the source it carries, exactly as the other twelve are, so there
   * is no removal event.
   */
  | {
      readonly type: 'benefit-denied';
      readonly id: CharacterId;
      readonly denial: DeniedBenefit;
    }

  /**
   * A hit point maximum a running effect is holding up — the twelfth sourced
   * grant, and the only one that moves a number the fold already stored.
   *
   * SRD Aid: "Each target's Hit Point maximum and current Hit Points increase
   * by 5 for the duration." The amount is **pinned at the cast** like every
   * other number a casting reads out of a definition, so a slot's worth of
   * extra hit points does not change when the book does.
   *
   * There is no event that takes it away, for the reason the other eleven have
   * none: the grant is ended by a source match, and `settleHitPointMaximum` in
   * the fold's derived pass is what brings `Vitals.hpMax` back down after it.
   * That is deliberately *not* {@link GameEvent} `hit-point-maximum-raised`,
   * which is advancement's and permanent and carries no source at all.
   */
  | {
      readonly type: 'hit-point-maximum-adjusted';
      readonly id: CharacterId;
      readonly adjustment: GrantedHitPointMaximum;
    }

  /**
   * A Reaction one creature has put in another's hands — the tenth sourced
   * grant.
   *
   * SRD Bardic Inspiration: "That creature gains one of your Bardic
   * Inspiration dice ... Once within the next hour when the creature fails a
   * D20 Test, the creature can roll the die and add the number rolled."
   *
   * **`id` is the recipient**, and `reaction.from` is whoever gave it — the
   * `attack-rider-granted` asymmetry the other way round. The whole Reaction
   * is pinned here, die size included, because it was read off the giver's
   * class table at the moment of conferral: an ally still holding it when the
   * giver levels up holds the die they were given, and the fold opens no
   * catalogue to find out which.
   *
   * Ended by the source it carries, exactly as the other nine grants are: the
   * hour is a `grants` deadline, and `reaction-grant-consumed` below is the
   * other door, for the ending a *use* is.
   */
  | {
      readonly type: 'reaction-granted';
      readonly id: CharacterId;
      readonly reaction: GrantedReaction;
    }

  /**
   * A granted Reaction has been used up by the creature holding it.
   *
   * SRD Bardic Inspiration: "A Bardic Inspiration die is expended **when it's
   * used**." `roll-modifier-consumed`'s twin, one family along and for the
   * same reason that one exists: every other ending is the thing that made a
   * grant ending, or a deadline arriving, and neither of those is somebody
   * spending what they were given.
   *
   * **The body is `releaseGrants`**, which is the `grants` deadline's body and
   * `roll-modifier-consumed`'s: everything that source granted this creature
   * ends, which is one question however many families answer it. The two
   * endings are the same ending arriving two ways, and a spent grant simply
   * leaves its timer standing over nothing.
   */
  | {
      readonly type: 'reaction-grant-consumed';
      readonly id: CharacterId;
      readonly source: string;
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
  /**
   * A creature already in the cast is one a casting is holding there.
   *
   * **Its own event rather than a field on `creature-added`**, for the reason
   * `damage-defense-granted` is its own rather than a second table write:
   * what a creature *is* and what a casting has *done* are two facts with two
   * lifetimes. The sheet, the printed hit points, the creature type and both
   * halves of the defence run are the stat block's and stand for as long as
   * the creature does; this one says the creature is here on a spell's
   * sufferance, and it is the only part a dismissal, a broken Concentration
   * or an arrived deadline takes away.
   *
   * **Nothing about the creature itself is on it**, which is the whole point:
   * the arrival pinned every number, so the fold raising a summoned creature
   * opens no catalogue, and this event adds a link between two things the log
   * already named.
   *
   * There is no matching "unsummoned" event, and none is needed: a summons
   * leaving is a creature leaving, which is `creature-removed` and the batch
   * `removeCreatureEverywhere` builds around it. What is *derived* is only
   * the noticing — `strandedSummons` reads this link against the ongoing
   * record, so it catches the four endings nobody commands — and
   * `dismissStrandedSummons` is what acts on the answer.
   */
  | {
      readonly type: 'creature-summoned';
      /** The creature, which `creature-added` has already put in the cast. */
      readonly id: CharacterId;
      /** The summoner. */
      readonly by: CharacterId;
      /** The casting whose ending takes the creature with it. */
      readonly castingId: string;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'creature-removed';
      readonly id: CharacterId;
      readonly command?: CommandStamp;
    }

  // — vitals ——————————————————————————————————————————————————
  /**
   * The amount is already rolled and already reduced by the target's defences.
   *
   * What the dice *showed* is the other half of the same moment and is a
   * different fact: `damage-dice-recorded` carries it, beside this event on
   * every unheld damage roll and on `damage-rolled` for a held one. This one
   * says what landed, and only that.
   */
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

  /**
   * Somebody at the table says this creature is falling.
   *
   * SRD Feather Fall: "Reaction, which you take when you or a creature you can
   * see within 60 feet of you **falls**"; SRD Slow Fall: "You can take a
   * Reaction **when you fall**." Both answer an instant, and the engine could
   * not say that instant had arrived — nothing drops, nothing is pushed off
   * anything, and no height is held anywhere. So the fall is a **declared
   * fact**, the answer cover, sight and a creature's type already get: fiction
   * supplies what the engine cannot see, and everything downstream is derived.
   *
   * **It carries no height, no rate and no "until when"**, and that is the
   * point rather than an omission. A landing declaration would be the engine
   * modelling a descent it holds no distance for; a duration would need a
   * height the SRD gives only as a rate ("60 feet per round"), which is a
   * number this engine exists not to invent. What the moment *is* worth is
   * settled by {@link fallWindowOpen}, on the two facts already in state —
   * the turn and the clock — exactly as `lastDamage` is.
   *
   * **Nobody's fall, twice, is two falls.** A creature knocked off a second
   * ledge a minute later declares again and gets a fresh moment, because the
   * event records when rather than whether: re-declaring simply overwrites,
   * which is what a momentary fact means.
   */
  | {
      readonly type: 'fall-declared';
      readonly id: CharacterId;
      readonly command?: CommandStamp;
    }

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
  /**
   * The Attack action spent on an Unarmed Strike that threw no attack roll.
   *
   * SRD Unarmed Strike prints three options under one heading and only the
   * first of them rolls: Damage "make an attack roll against the target",
   * while Grapple and Shove each impose a saving throw instead. All three are
   * the Attack action's one attack — Extra Attack puts a punch after a grapple
   * — so the budget has to move exactly as `attack-made` moves it.
   *
   * **And `attack-made` is the wrong event to move it with**, which is the
   * whole reason this one exists. Two SRD sentences are read off that event —
   * SRD Hide's "the condition ends … after you make an attack roll" and the
   * `target-attacks` ending SRD Invisibility and Potion of Invisibility print
   * in the same words — and `fold/endings.ts` already records that reading it
   * as the Attack action is an approximation. For a weapon swing the
   * approximation is right nearly always; for these two options it is wrong
   * *every* time, because neither ever throws a d20 at anybody's Armour Class.
   * So they spend the same attack through an event that makes no such claim,
   * and a hidden character who grabs somebody is still hidden.
   *
   * Reduced by the combat seam, beside `attack-made`, because what it changes
   * is the action budget and nothing else. It is filed here in the union for
   * the merge protocol of the batch it arrived in; its seam is combat's.
   */
  | {
      readonly type: 'unarmed-strike-made';
      readonly id: CharacterId;
      /** Which of the Unarmed Strike's other two options was taken. */
      readonly option: 'grapple' | 'shove';
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'condition-removed';
      readonly id: CharacterId;
      readonly condition: ConditionName;
      /** Lift only this cause. Omitted, every instance of the condition goes. */
      readonly source?: string;
      readonly command?: CommandStamp;
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
   *
   * A line that carries an `instance` is **one copy being given a record of
   * its own**, and this is the event that issues it: the command computed the
   * id from `itemsIssued` and the fold checks it is the next one. A line
   * without is the counted stack it has always been.
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
  /**
   * Something changing hands: one event, because the world has one fact.
   *
   * A loss and a gain written back to back would be two, and the second of
   * them would be **wrong**: a copy with a record carries its charges in a
   * pool keyed to itself, and a gain declares a pool full. A wand handed over
   * that way would arrive with three charges however spent it left. So the
   * reducer moves the line and its pool record whole, and the giver's
   * attunement ends through the pass that already ends one for a thief.
   *
   * `item` is the catalogue id and `instance` says which copy, exactly as
   * `item-equipped` splits them. `pools` names the pool records travelling
   * with the copy — the keys the giver holds, resolved by the command, because
   * a key's shape is the engine's own and the fold reads no catalogue.
   */
  | {
      readonly type: 'item-transferred';
      readonly from: CharacterId;
      readonly to: CharacterId;
      readonly item: string;
      readonly quantity: number;
      /** Which copy, where the copy has a record of its own. */
      readonly instance?: string;
      /** The pools moving with it, whole. Absent means none. */
      readonly pools?: readonly string[];
      readonly source: string;
      readonly command?: CommandStamp;
    }
  /** Money in or out, in copper. Negative spends. */
  | {
      readonly type: 'coins-changed';
      readonly id: CharacterId;
      readonly copper: number;
      readonly source: string;
      /**
       * Added when `changeCoins` arrived, because a coin command's whole batch
       * is this one event and there is no sibling to carry the stamp — a
       * purchase stamps its `items-gained` and lets the coin ride along
       * unstamped, which is why the field was not needed before.
       *
       * Additive rather than a migration: both frozen logs' unstamped
       * `coins-changed` events stay exactly as valid as they were.
       */
      readonly command?: CommandStamp;
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
      /**
       * The armour record this item is, pinned at the moment it was put on —
       * or null for an item that is not armour.
       *
       * The fold derives what a creature wears from what it has equipped, and
       * before this field it opened the item catalogue to do so: a corrected
       * transcription of Chain Mail would have changed how last week's log
       * folded. Pinned for the same reason a casting pins its area. Absent
       * only on a log written before the field existed, which the fold reads
       * through the legacy content it is handed — see `fold`.
       */
      readonly armor?: Armor | null;
      /**
       * What this item grants while it is worn, pinned the same way and for
       * the same reason: a magic item's benefit is written in the catalogue
       * and read once, here, so the fold never opens one.
       *
       * Absent means none. Unlike `armor` there is no legacy reading of it —
       * every log written before this field existed was written before an item
       * could grant anything, so "absent" and "nothing" are the same answer and
       * both frozen fixtures fold unchanged.
       */
      readonly grants?: readonly StandingEffect[];
      /**
       * Which copy went into the hand, where the copies have records.
       *
       * The `item` above stays the catalogue id — it is what every reader of
       * `equipped` asks — and this says which of them, so the charges spent
       * are the held wand's. Absent for an unlabelled copy, which is every
       * mundane item and every log written before a copy could be labelled.
       */
      readonly instance?: string;
      readonly command?: CommandStamp;
    }
  | {
      readonly type: 'item-unequipped';
      readonly id: CharacterId;
      readonly item: string;
      readonly command?: CommandStamp;
    }
  /**
   * SRD Magic Items: attuning to one, which takes a Short Rest focused on it.
   *
   * Keyed on the catalogue id, because that is all an inventory can say: two
   * copies of one item cannot be told apart — see {@link AttunedItem}.
   */
  | {
      readonly type: 'attuned';
      readonly id: CharacterId;
      readonly item: string;
      /** What the item grants, pinned as `item-equipped` pins it. */
      readonly grants?: readonly StandingEffect[];
      readonly command?: CommandStamp;
    }
  /**
   * Attunement given up on purpose.
   *
   * The *other* two ways out — dying, and losing the item — are derived in the
   * fold and emit nothing, because nobody decides either of them. This is the
   * one somebody decides.
   */
  | {
      readonly type: 'attunement-ended';
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
       * That this key names a **tally** rather than a pool, and what zeroes it.
       *
       * A tally is a count with no size — SRD Wind Fan's "each subsequent time
       * the fan is used before the next dawn", Augury's "more than once before
       * finishing a Long Rest" — and using one is this same event: something
       * was spent, and what it came out of has no ceiling to run into. See
       * `Tally` in `resources.ts`.
       *
       * **The tag rides the use because nothing declares a tally.** A pool's
       * recovery arrives on its `resource-pool-declared`; a tally has no size
       * to declare and so no declaration to carry one, which is exactly what
       * lets a *spell* have a tally — nothing could have declared one in
       * advance for every spell a caster might cast twice. So the count springs
       * into existence here, with what empties it written beside it, and the
       * fold needs no catalogue to know what a morning gives back.
       *
       * Absent is a pool, which is every other spend in the log.
       */
      readonly tally?: Recovery;
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
  /**
   * Everything a recovery tag gives this creature back.
   *
   * **Pools and tallies, and — on the two rest tags — the printed lines a
   * recharge took away.** SRD *Monsters* puts the rest in the same sentence as
   * the die: "the monster regains the use of that part, which also recharges
   * when the monster finishes a Short or Long Rest", and the book's other
   * notation is that clause with the die taken away. A rest *is* this event
   * with a rest's tag on it — `endRest` emits both tags for a Long Rest — so
   * the recharge rides the tag rather than waiting on a second event an
   * emitter could forget. `dawn` and `special` return no line: a morning is
   * not a rest. See {@link CreatureState.expendedLines}.
   */
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
  /**
   * A pool's **recovery tag** changing, which is what a later feature that
   * rewrites an earlier one's rule does to it.
   *
   * SRD writes the sentence on the second feature — "you regain all your
   * expended uses ... when you finish a Short Rest" — and the tag it moves was
   * pinned into `resource-pool-declared` when the first feature declared the
   * pool. So a character who reaches that level *in play* needs the move said
   * out loud: re-declaring the pool would hand back everything already spent,
   * and a resize says nothing at all when the maximum has not changed, which
   * is exactly the case here.
   *
   * What it does not touch is the maximum or what has been spent. A level is
   * not a rest.
   */
  | {
      readonly type: 'resource-pool-recovery-changed';
      readonly id: CharacterId;
      readonly key: string;
      readonly recovers: Recovery;
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
      /**
       * The printed text this casting handed to whoever is running the table.
       *
       * The book's own words, exactly as `SpellDefinition.dmDecides` stated
       * them: a Range of `Special`, a sentence that asks a question no engine
       * answers. CLAUDE.md's rule 5 — what a command reads from content
       * is pinned into the events it emits — and the one casting path that did
       * not keep it. A rite of a minute writes its handover onto
       * `spell-declared` with everything else it read; an **atomic** casting
       * has no declaration, so until this field its handover reached the
       * caller and nothing else, and a replay of the log lost the one sentence
       * the table still had to answer.
       *
       * **Written by an atomic casting and by no other.** A casting that was
       * declared already pinned it, and one sentence in two events of one log
       * is the second place to get it wrong.
       *
       * **The handover and not the debt.** An `unmodelled` line travels beside
       * it out of a casting and is deliberately *not* here: that one is a
       * clause somebody will build, after which the line goes, and a log that
       * had frozen it would keep reporting a gap this engine had closed. A
       * handover is never paid off, which is what makes it a fact about the
       * casting rather than about the engine that ran it.
       *
       * Absent where a spell hands nothing over, which is nearly every spell,
       * so every log written before this folds to exactly the state it did.
       */
      readonly dmDecides?: readonly string[];
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
   *
   * **The payload is `WrittenOngoing`, not `OngoingSpell`**: a log may be
   * older than this engine, and what the fold *holds* is what
   * `upgradeOngoing` made of what the log *said*.
   */
  | { readonly type: 'spell-ongoing'; readonly casting: WrittenOngoing }
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
   * The Magic action a casting of a minute or more costs on a later turn.
   *
   * SRD "Longer Casting Times": "While you cast a spell with a casting time of
   * 1 minute or more, you must take the Magic action on **each of your
   * turns**." The *failure* that follows from not taking it is derived — nobody
   * decides that a turn ended — but taking it is a decision, so it is an event,
   * which is the same split every other rule here obeys.
   *
   * It carries no turn number. The turn is `state.combat.turnsTaken` at the
   * moment this folds, and a number written down beside it would be a second
   * answer to one question — which is the failure the pending record itself was
   * designed against. The `action-spent` beside it is what the economy reads;
   * this is what the rite reads.
   */
  | {
      readonly type: 'casting-continued';
      readonly id: CharacterId;
      readonly castingId: string;
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
      /**
       * What ends this effect before its deadline — see {@link TimedEffect}.
       *
       * Optional, and the reducer spreads it conditionally, so a log written
       * before the field existed folds to a timer that has no such key.
       */
      readonly endsEarly?: readonly EffectEndCause[];
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
      /**
       * The one event a settlement always emits, whatever the rest earned, so
       * the stamp rides here rather than on a Hit Die a short rest happened to
       * spend.
       */
      readonly command?: CommandStamp;
    }



  // — combat ——————————————————————————————————————————————————
  | {
      readonly type: 'combat-started';
      readonly combatants: readonly CombatantInput[];
      readonly command?: CommandStamp;
    }
  /**
   * The fight is over.
   *
   * **`ending` is why, pinned by the command that closed it**, so a reader of
   * the log is told what the table decided rather than left to infer it from
   * the hit points of whoever happened to still be in the order. Three of
   * them, and they are the owner's ruling read as a union: no hostile
   * combatant remains, the hostiles surrendered, or they ran and the party
   * elected to let them go. The election is not recorded separately — a
   * `flight` that reached this event is one the party made.
   *
   * **Optional, because it predates the command that writes it.** The fold
   * wrote `combat-ended` for years without one — `removeCreatureEverywhere`
   * still does, when a removal takes the last combatant out of the order,
   * which is not any of the three endings a table elects — and
   * `golden-log-2.json` holds one of those. So an absent `ending` means "no
   * command concluded this", which is a fact rather than a gap.
   */
  | {
      readonly type: 'combat-ended';
      readonly ending?:
        | { readonly kind: 'defeated' }
        | { readonly kind: 'surrender'; readonly side: string }
        | { readonly kind: 'flight'; readonly side: string };
      readonly command?: CommandStamp;
    }
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
  /**
   * A swing, and whether it was an Unarmed Strike.
   *
   * The flag is what lets the reducer spend the same thing the command spent.
   * SRD Flurry of Blows buys attacks an Unarmed Strike may take and a weapon
   * may not, and the price of a swing therefore depends on which it was — a
   * fact only the command held until this field. Absent means no, which is
   * what every log written before it says and what every armed swing says
   * still.
   */
  | { readonly type: 'attack-made'; readonly id: CharacterId; readonly unarmed?: boolean }
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
  /**
   * One creature took a place in a fight already under way.
   *
   * **Not `combat-started` with a longer list.** Beginning a fight ranks
   * everybody at once and hands every combatant a fresh turn; this changes the
   * *length* of a running order, which is the one thing no other operation
   * does — `combatant-removed` shrinks it and `initiative-swapped` reorders
   * it, and both leave the number of turns in a round alone.
   *
   * It carries the whole `CombatantInput` for the same reason `combat-started`
   * carries a list of them: the Initiative total and the pinned Speed are the
   * caller's to have established, through `rollInitiativeFor` and the
   * creature's own sheet, and the ranking is the reducer's.
   */
  | {
      readonly type: 'combatant-joined';
      readonly combatant: CombatantInput;
      readonly command?: CommandStamp;
    }
  | { readonly type: 'combatant-removed'; readonly id: CharacterId }
  | {
      readonly type: 'initiative-swapped';
      readonly a: CharacterId;
      readonly b: CharacterId;
      readonly command?: CommandStamp;
    }
  /**
   * Something added to what this turn may be spent on.
   *
   * SRD Action Surge's "you can take one additional action" and SRD Flurry of
   * Blows' "two Unarmed Strikes as a Bonus Action" — one event, because they
   * are one fact about a turn arriving by two doors, and because the thing
   * they write is the same `TurnBudget` and nothing else may write it.
   *
   * **What the purchase cost is not here.** The Focus Point is the
   * `resource-spent` beside it and the Bonus Action is the
   * `bonus-action-spent`, both folded by this seam and by `fold/resources.ts`
   * exactly as every other spender's are. This event is what was *bought*.
   *
   * The numbers are pinned from the feature that sold it — the count, the
   * narrowing, the name — so the fold opens no catalogue and a log written
   * against last year's Monk still replays.
   */
  | {
      readonly type: 'turn-budget-granted';
      readonly id: CharacterId;
      /** What the log calls whatever bought it: SRD's "Action Surge". */
      readonly source: string;
      /** SRD Action Surge: "one additional action, except the Magic action". */
      readonly action?: { readonly except?: readonly NamedAction[] };
      /** SRD Flurry of Blows: "two Unarmed Strikes". */
      readonly attacks?: { readonly remaining: number; readonly unarmedOnly: boolean };
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
  | {
      readonly type: 'scene-set';
      readonly extent: SceneExtent;
      /**
       * How bright the room is where no patch says otherwise.
       *
       * **Absent is "nobody has said"**, never Bright Light — the owner's
       * second ruling, 2026-09-21. Every log written before light existed is
       * therefore a log with an undeclared ambient, which is exactly what it
       * was, and folds to the state it always folded to.
       */
      readonly light?: LightLevel;
      readonly command?: CommandStamp;
    }
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
   * How many heads a creature has.
   *
   * SRD Hydra's Multiattack: "The hydra makes as many Bite attacks as it has
   * heads." The count is a number the *table* holds — the block's Multiple
   * Heads trait has heads dying and growing back between turns — and a number
   * the engine invented would be the engine writing the stat block. So it is
   * declared, and the Attack action's size is derived from the declaration.
   *
   * **Its own event, and not "a number the table states about a creature".**
   * A kind with a provider is a table until something arrives that does not
   * fit it; one instance is not a framework. The day a second creature counts
   * something the same way, the general shape can be written with two
   * examples in front of it rather than one.
   *
   * Re-declarable, like a side and unlike a type: heads are written to change,
   * so the reducer overwrites rather than throwing.
   */
  | {
      readonly type: 'creature-heads-declared';
      readonly id: CharacterId;
      readonly heads: number;
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
   * A creature taking one of the lines its stat block prints under **Bonus
   * Actions**.
   *
   * The Bonus Action it costs is the `bonus-action-spent` beside it, exactly as
   * a Dash's cost is; this says *which line*, because that is a fact nothing
   * else in the log carries and because a Multiattack the book gates on one —
   * "three Slam attacks if it used Hasten this turn" — has no other way to ask.
   *
   * **What the line says is not on the event.** The name is, and the sentence
   * is already on the creature's sheet, which `creature-added` pinned; the fold
   * opens no catalogue to read either. So this is a name and a turn, and the
   * seam it belongs to is the one that owns the once-per-turn ledger.
   *
   * The engine applies nothing the line says. The sentence goes back to the
   * caller through the command's `unverified` clauses, where a DM applies it.
   */
  | {
      readonly type: 'stated-bonus-action-taken';
      readonly id: CharacterId;
      /** The heading the block prints the line under. */
      readonly line: string;
      /** The turn it was taken on, from the combat's own never-reused counter. */
      readonly turn: number;
      readonly command?: CommandStamp;
    }
  /**
   * A creature taking one of the lines its stat block prints under **Actions**
   * that the parser read nothing out of.
   *
   * The Action it costs is the `action-spent` beside it, exactly as a Dash's
   * cost is; this says *which line*, because that is a fact nothing else in the
   * log carries and a reader asking what a turn was spent on would otherwise
   * see an Action vanish with no account of it.
   *
   * **What the line says is not on the event**, which is what its Bonus Action
   * sibling above says of itself and for the same reason: the sentence is on
   * the creature's sheet, which `creature-added` pinned, and the fold opens no
   * catalogue to read either. So this is a name, and the engine applies no part
   * of what it names — the sentence goes back to the caller through the
   * command's `unverified` clauses, where a DM applies it.
   *
   * **No turn, and no ledger entry.** The Bonus Action event carries one
   * because a Multiattack the book gates on "if it used X this turn" reads it;
   * nothing in the book gates a branch on an Actions line, and the once-per-turn
   * rule this one needs is the Action economy's own. A namespace reserved for a
   * reader that does not exist is a guard that never fires.
   */
  | {
      readonly type: 'stated-action-taken';
      readonly id: CharacterId;
      /** The heading the block prints the line under. */
      readonly line: string;
      readonly command?: CommandStamp;
    }
  /**
   * A line a stat block prints a **recharge** on, used up.
   *
   * SRD *Monsters*: "a monster can use the stat block part once." What it cost
   * is the `action-spent`, `bonus-action-spent` or `attack-made` beside it,
   * exactly as a Dash's cost is its own event; this says the *line* is gone,
   * which is a fact that outlives the turn and the fight and so cannot be read
   * off any of them.
   *
   * **Its own event rather than a field on the use**, for the reason
   * `feature-used` is one: the swing happened, and separately the line it was
   * made with is now spent. It is emitted only where the block prints a
   * recharge, so a creature that takes an ordinary line writes nothing here —
   * which is what every log written before this existed says.
   *
   * **No stamp**, because no command that emits it is guaranteed to: a spend
   * rides the `stated-action-taken` or `stated-bonus-action-taken` its command
   * always writes, and a swing's rides its own. A stamp nothing sets is a guard
   * that never fires.
   */
  | {
      readonly type: 'printed-line-expended';
      readonly id: CharacterId;
      /** The heading the block prints the line under. */
      readonly line: string;
    }
  /**
   * The same line, back.
   *
   * Two things put it here and the log tells them apart by what stands beside
   * it: the `roll-recorded` of a turn-start d6 that came up inside the printed
   * range, or nothing at all, which is a rest — SRD "which also recharges when
   * the monster finishes a Short or Long Rest". The roll is not *on* this
   * event because a roll is its own record with its own provenance, and a die
   * that failed still belongs in the log while this event does not.
   *
   * A line that is not expended is never recharged, so a second one of these
   * is a corrupt log rather than a no-op.
   */
  | {
      readonly type: 'printed-line-recharged';
      readonly id: CharacterId;
      /** The heading the block prints the line under. */
      readonly line: string;
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
  /**
   * A patch of ground that costs more to cross, and what a foot of it costs.
   *
   * Declared, like cover and sight, and for the same reason: five of the
   * SRD's six environmental examples of Difficult Terrain are fiction the
   * engine holds no record of. `costPerFoot` rather than a flag because the
   * book prints two rates — the glossary's two feet per foot, and the four
   * that Plant Growth and Wall of Thorns each print. `source` names the
   * casting that made the ground expensive, and the patch stops charging when
   * that casting stops running.
   */
  | {
      readonly type: 'difficult-terrain-declared';
      /** The table's name for this patch, which a refusal quotes back. */
      readonly patch: string;
      readonly region: TerrainRegion;
      readonly costPerFoot: number;
      readonly source?: string;
      readonly command?: CommandStamp;
    }
  /**
   * How bright a patch of the room is.
   *
   * Declared on the lattice, like the ground and for the same reason:
   * deriving light needs walls and sources, and `docs/design/light-and-sight.md`
   * is where the owner ruled that out (2026-09-21, the first of five). The
   * fields past the level are the two the book distinguishes — `magical`
   * carries the spell level, because Darkness's "nonmagical light can't
   * illuminate it" and its mutual dispel with Daylight both read one, and
   * `sunlight` is the flag that makes Bright Light the sun rather than a
   * fourth level. `source` names the casting that made it, and the patch
   * stops lighting anything when that casting stops running.
   */
  | {
      readonly type: 'light-declared';
      /** The table's name for this patch, which a report quotes back. */
      readonly patch: string;
      readonly region: TerrainRegion;
      readonly level: LightLevel;
      readonly magical?: { readonly spellLevel: number };
      readonly sunlight?: boolean;
      readonly source?: string;
      readonly command?: CommandStamp;
    }
  /**
   * A patch of the room hard to see into for a reason that is not the light.
   *
   * Fog, foliage, smoke. Its own event beside the light because SRD Fog Cloud
   * makes its Sphere Heavily Obscured and says nothing whatever about how
   * bright it is, and a degree derived wholly from a level could not have
   * written that spell.
   */
  | {
      readonly type: 'obscurement-declared';
      readonly patch: string;
      readonly region: TerrainRegion;
      readonly degree: ObscurementDegree;
      readonly source?: string;
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
   * Without it the log cannot answer "why did the goblin die": a roll that
   * Bardic Inspiration lifted and Cutting Words then cut shows all three
   * contributions with their sources, rather than one unexplained total. Its
   * consequences arrive as their own events and `fold/rolls.ts` writes nothing
   * for it — with one exception, which belongs to the label rather than to the
   * event: `interruptedRests` in `fold/apply.ts` breaks a rest the roller was
   * taking when the label is `INITIATIVE_LABEL`, because SRD lists "Rolling
   * Initiative" first among the things that interrupt one and names the roll
   * rather than the fight.
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
      /**
       * Advantage and Disadvantage, with who said so — including sources that
       * cancelled each other out.
       *
       * **`contributions` are named *amounts*, and Advantage is not an
       * amount.** So without this a reader of the log alone could see that a
       * d20 came to 17 and not that two were thrown for it, and a DM's ruling
       * was invisible the moment the returned result was discarded: the only
       * trace of a granted Advantage was a total that happened to be higher,
       * which is indistinguishable from a good die. An audit trail that
       * cannot be read back from the log is not one.
       *
       * The same list the roll itself carried (`D20Roll.modeSources`), which
       * is why the cancelled sources are here too: a roll that came out
       * `normal` because the table ruled twice in opposite directions is a
       * different fact from a roll nobody ruled on, and only this tells them
       * apart.
       *
       * **Optional and absent when empty**, which is not tidiness: this event
       * has been written since the first log and the two frozen fixtures
       * carry it. An additive field nothing fills in for an unmodified roll
       * leaves every one of those bytes where it was.
       *
       * **Only `recordD20Test` fills it today, so absent means two things**,
       * and that is a gap being recorded rather than a shape being claimed.
       * Seven commands build this event directly — the weapon attack,
       * Initiative, a feature's die, a DM's stated roll, a scene roll and the
       * two spell-effect rollers — and none of them passes its modes, though
       * an attack roll and an Initiative roll can both carry Advantage. Every
       * one is a one-line change in a module this field did not own; until
       * they are made, a reader of the log can tell a ruled check or save
       * from an unruled one and cannot tell a ruled attack from one.
       */
      readonly modes?: readonly ModeSource[];
      /** How it came out, in the caller's own words. */
      readonly outcome?: string;
      /**
       * Where the roll came from, when it was not this engine.
       *
       * See {@link StatedRoll} for why `'engine'` is not expressible here and
       * why the field is declared before anything can fill it.
       *
       * **Two of the thirteen sites that build this event fill it today, so
       * absent means two things**, and that is a gap being recorded rather
       * than a shape being claimed — the same record `modes?` above keeps of
       * its own. The weapon attack (`commands/attacks.ts`) and the damage
       * Reaction (`commands/reactions.ts`) read the provenance off the roll
       * they just made; the other eleven — `recordD20Test` and the ten
       * commands that build the event directly — pass nothing, though every
       * one of them holds a `RecordedRoll` or a `RecordedD20` that carries
       * one. Each is a one-line `...statedFrom(…)` in a module this field did
       * not own.
       *
       * **Nothing can currently reach the other reading**, which is what makes
       * the gap safe rather than merely known: no command produces a roll
       * whose provenance is not `engine`, so every occurrence in every log
       * this engine has written is absent for the one true reason.
       * `damage-dice-in-the-log.test.ts` sweeps a whole driven log and asserts
       * zero. The line that closes the gap is `recordD20Test` in
       * `commands/rolls.ts`, which is where the D20 pipeline funnels and where
       * the door for a table's own dice is being built.
       */
      readonly stated?: StatedRoll;
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
  /**
   * What the dice showed, for a damage roll nobody was offered a chance to
   * answer.
   *
   * **The asymmetry this closes.** A damage roll somebody may react to is held
   * in `damage-rolled`, which carries the whole `PendingDamage` — and on each
   * of its components the `RecordedRoll` that threw it, faces and all. A
   * damage roll nobody can answer opened no window and reached no event: the
   * log kept `damage-taken`, which is a *post-defence total*, and the faces
   * went out with the value the command returned. So the same greatsword swing
   * was fully auditable against a Rogue with Uncanny Dodge and opaque against
   * a goblin, which is not a rule — it is an accident of who happened to be
   * standing there.
   *
   * **Owner, 2026-09-21:** "each individual damage dice needs to reach the
   * log, specifically for spells like sorcerous burst and chromatic orb, which
   * burst on certain numbers. it also creates transparency for things like the
   * great weapon fighting style feat." Two of those three are mechanics that
   * *read* a face — an 8 on Sorcerous Burst's d8 throws another, Chromatic
   * Orb's matching faces chain — and the third is a substitution a reader
   * cannot see in a total. None of them can be built on a number.
   *
   * **It is emitted from one place**, `dealSpellDamage`, which is the single
   * funnel every unheld damage roll already passed through: a weapon attack, a
   * spell, a scheduled hit, an Overchannel backlash and a DM's improvised dice
   * all record their faces by the same route and not one of them had to be
   * taught to. The held path does **not** emit it — `settleDamage` deals its
   * damage through `resolveDamage` directly — so the faces are reported
   * exactly once on each path, and neither loses them.
   *
   * **It is not a second account of what landed**, and the distinction is the
   * whole point of the ruling. This says what the dice showed; `damage-taken`
   * says what the target took once its Resistances, Vulnerabilities and
   * Immunities and any Reaction had their say. A Resistance halving 13 to 6
   * leaves `rolled: 13` here and `amount: 6` there, and a reader can see both.
   *
   * **Its seam is `fold/rolls.ts` and it writes no state at all**, exactly as
   * `roll-recorded` writes none: the damage beside it is what moves hit
   * points. That is what makes it additive — every log written before it
   * existed folds to precisely the state it always folded to, the two frozen
   * fixtures included, because a log without it is a log missing something
   * that changes nothing.
   *
   * It carries no `command` stamp: it is never the only event a command
   * writes, and the damage it sits beside is already stamped by whatever
   * emitted that.
   */
  | {
      readonly type: 'damage-dice-recorded';
      readonly target: CharacterId;
      /**
       * Who dealt it, where anybody did. A falling brazier has no dealer, the
       * same real answer `damage-taken.by` and `PendingDamage.by` record.
       */
      readonly by?: CharacterId;
      /** Prose for the audit trail — "Longsword", "Fire Bolt". */
      readonly source: string;
      /**
       * What the components come to **before** the target's defences.
       *
       * The number `damage-taken.amount` is to be read against, stated rather
       * than left to be summed, because it is the comparison the ruling asks
       * to be legible and a reader should not have to do arithmetic to make
       * one half of it.
       */
      readonly rolled: number;
      readonly components: readonly RecordedDamageDice[];
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

