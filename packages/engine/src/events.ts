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
import type { CharacterId, ConditionName } from '@ie/shared';
import type { Armor } from '@ie/srd';
import type { CharacterSheet, GrantedArmorClass } from './character.js';
import { type ActiveRollModifier } from './roll-modifiers.js';
import type { RngState } from './dice.js';
import { type PoolDeclaration, type Recovery } from './resources.js';
import type { CharacterRecord } from './creation.js';
import type { DamageDefenses, DamageReduction, GrantedDefense } from './attack.js';
import type { GrantedConditionImmunity } from './conditions.js';
import type { D20TestResult } from './checks.js';
import type { ReactionWindow } from './reactions.js';
import type { ActiveBonus } from './bonuses.js';
import { type SpellcastingState } from './spellcasting.js';
import type { RestBenefit, RestKind } from './rest.js';
import {
  type Deadline,
  type EffectEndCause,
  type EffectTarget,
  type GrantedPayout,
  type RepeatSave,
  type EffectCheck,
  type ScheduledDamage,
} from './duration.js';
import {
  type AreaMoment,
  type CastingTime,
  type ConcentrationEndReason,
  type OngoingEndReason,
  type SlotlessReason,
  type WrittenOngoing,
} from './spells.js';
import { type CombatantInput, type GrantedActionRule } from './combat.js';
import { type GrantedAttackRider, type GrantedSpeed, type StandingEffect } from './standing.js';
import { type CoverDegree, type Placement, type SceneExtent, type Point } from './positioning.js';

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
  PendingMove,
  PendingTest,
  ReadiedAction,
  ReadiedResponse,
} from './state.js';
export {
  initialState,
  itemInstanceFor,
  itemInstanceNumber,
  ITEM_INSTANCE_PREFIX,
} from './state.js';
export * from './fold/index.js';

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

