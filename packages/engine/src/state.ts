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
import type { Ability, CharacterId, ConditionName, RollMode } from '@ie/shared';
import type { Armor, CreatureSize, WeaponMastery } from '@ie/srd';
import type { CharacterSheet, GrantedArmorClass, GrantedLineImmunity } from './character.js';
import { type ActiveRollModifier } from './roll-modifiers.js';
import { type ActivePassiveDefense } from './passive-defenses.js';
import type { RngState } from './dice.js';
import {
  type ConditionState,
  type DeniedBenefit,
  type GrantedConditionImmunity,
} from './conditions.js';
import { type ResourceState } from './resources.js';
import type { CharacterRecord } from './creation.js';
import type {
  DamageComponent,
  DamageDefenses,
  DamageReduction,
  GrantedDamagePenalty,
  GrantedDefense,
} from './attack.js';
import type { D20TestResult } from './checks.js';
import type { GrantedCreatureType } from './creature-type.js';
import type { GrantedSize } from './size.js';
import type { GrantedDamageReduction } from './damage-reduction.js';
import type { GrantedReaction, ReactionOffer } from './reactions.js';
import type { ActiveBonus } from './bonuses.js';
import type { CreatureHazard } from './hazards.js';
import { type SpellcastingState } from './spellcasting.js';
import type { RestState } from './rest.js';
import type { HitOption, StandingEffect } from './standing.js';
import { type Deadline } from './time.js';
import type { Elsewhere } from './elsewhere.js';
import {
  type GrantedPayout,
  type PendingSave,
  type EffectCheck,
  type ScheduledDamage,
  type TimedEffect,
} from './timers.js';
import {
  type AreaTriggerStamp,
  type CastingNumbers,
  type CastingTime,
  type Concentration,
  type OngoingSpell,
  type OwedAreaEffect,
  type SlotlessReason,
} from './spells.js';
import { type CombatState, type GrantedActionRule } from './combat.js';
import {
  type GrantedAttackRider,
  type GrantedSense,
  type GrantedSpeed,
  type GrantedWeaponRider,
} from './standing.js';
import {
  type PointAnchoring,
  type Placement,
  type PositionState,
  type Point,
} from './positioning.js';
import {
  type GrantedHealingRule,
  type GrantedHitPointMaximum,
  type Vitals,
} from './vitals.js';

import type { GameEvent } from './events.js';

/**
 * Points taken off one ability score by one use of one effect.
 *
 * SRD Shadow's Draining Swipe. Sourced per use, so a second swipe lowers the
 * score again rather than restating the first; released by a rest through
 * `ability-score-restored`, and by any ending that names the source.
 */
export interface AbilityLowering {
  /** The use that did it — `<feature>:<roll position>` for a printed rider. */
  readonly source: string;
  readonly ability: Ability;
  /** How many points came off, which is the die the blow threw. */
  readonly amount: number;
  /** What the log calls it — the line's own heading. */
  readonly label: string;
}

/**
 * Something a creature has equipped, with the one record the fold reads.
 *
 * The id is what inventory tracks; the armour record is what `item-equipped`
 * pinned when it went on, so that what a creature wears is a fact of the log
 * and not of whichever item catalogue is loaded today. Null for anything that
 * is not armour — a held weapon is equipped and contributes nothing here.
 */
export interface EquippedItem {
  readonly id: string;
  readonly armor: Armor | null;
  /**
   * Which copy is in hand, where the copies are told apart.
   *
   * The id above stays the catalogue id, because that is what every reader of
   * `equipped` asks — Armour Class, a weapon's record, an item's standing
   * grants. This says *which one*, so a wand's charges are spent out of the
   * pool belonging to the wand being held and not out of the other one in the
   * pack. Absent for everything unlabelled, which is everything mundane and
   * every log written before a copy could have a record.
   */
  readonly instance?: string;
  /**
   * What this item grants while it is worn, pinned when it was put on.
   *
   * The same rule the armour record above follows: what a command read from
   * the catalogue travels with the event, so the fold never opens a catalogue
   * and a corrected transcription cannot change how last week's log folds.
   * Absent on everything mundane, and on every log written before items could
   * grant anything.
   */
  readonly grants?: readonly StandingEffect[];
  /**
   * Points of Armour Class acid has eaten out of **this copy** — SRD Black
   * Pudding's Dissolving Pseudopod: "Nonmagical armor worn by the target takes
   * a −1 penalty to the AC it offers."
   *
   * **On the equipped record because the record is the copy.** The catalogue
   * says what chain mail offers and is the same book in every campaign; this
   * says what has happened to the suit this creature is wearing, and the two
   * could not share a home — a penalty written into the armour record would be
   * a pudding corroding every coat of mail in the world.
   *
   * Cumulative, like `decoy-destroyed`'s count and unlike every sourced grant:
   * a second pseudopod eats a second point rather than restating the first.
   * Absent is no wear at all, which is what every log written before acid
   * could bite says — so both frozen fixtures fold unchanged.
   *
   * Read by `armorClassOf` alone. The armour is *destroyed* rather than
   * penalised once the penalty would take what it offers to 10, and that is
   * the command's arithmetic rather than a state this can hold: a destroyed
   * suit leaves the inventory through the door every lost item leaves by.
   */
  readonly penalty?: number;
}

/**
 * An item this creature has attuned to.
 *
 * Keyed by catalogue id, and **deliberately still so** now that a copy can
 * have a record: attunement is a yes or no per kind of item, and attuning to
 * the second of two identical wands grants exactly what the first one does.
 * What could not survive one key per kind was the *charges*, which are spent
 * from one wand and not from both — and those are keyed by the copy now
 * ({@link InventoryLine.instance}), which is where per-copy state belongs.
 *
 * So the refusals that stood in for the missing record are gone from both
 * doors: `equipItem` and creation put a second copy of a charged item in a
 * pack without complaint, because the two copies now have two pools. What
 * `equipItem` asks instead is *which* copy, where the answer is not obvious.
 */
export interface AttunedItem {
  readonly id: string;
  /**
   * What this item grants while it is attuned, pinned when it was attuned to.
   *
   * Pinned separately from the equipped copy rather than read across from it,
   * because the two have different lifetimes: taking a ring off does not break
   * the attunement, so the attunement has to carry what it is offering.
   */
  readonly grants?: readonly StandingEffect[];
}

/**
 * A creature and the casting that is holding it in the world.
 *
 * Two fields and no third. A deadline is not here because the casting already
 * has one; a side is not here because allegiance is declared and can change;
 * a stat block is not here because the sheet arrived pinned on
 * `creature-added` and this is a link rather than a second copy of the
 * creature.
 */
export interface SummonBond {
  /** Whose creature this is. */
  readonly by: CharacterId;
  /**
   * The casting whose ending takes it away — or null for a creature its
   * summoner **keeps**, whose lifetime is {@link kept}'s.
   */
  readonly castingId: string | null;
  /**
   * The terms a kept creature stands on, where no casting holds it.
   *
   * SRD Find Familiar and Find Steed are Instantaneous: no record, no
   * deadline, and the creature is the caster's until the book takes it away
   * — "When the familiar drops to 0 Hit Points, it disappears", which every
   * kept creature has; and "or if you die", which only the steed prints
   * (`untilSummonerDies`). The spell is recorded because the book allows one
   * such creature per spell — a second casting replaces the first — and the
   * resolver has to find the one this caster keeps from *this* spell.
   *
   * Present exactly when `castingId` is null. The fold refuses a bond naming
   * both or neither.
   */
  readonly kept?: KeptBond;
}

/** The terms of a kept summons, as the log carries them — see {@link SummonBond.kept}. */
export interface KeptBond {
  readonly spell: string;
  readonly untilSummonerDies: boolean;
  /**
   * SRD Wild Companion: "disappears when you finish a Long Rest" — the
   * summoner's, completed after `since`, which is the clock at the binding.
   * Absent on a bond the spell alone wrote, which is every other kept summons.
   */
  readonly untilSummonerLongRests?: true;
  /**
   * SRD Gnomish Lineage: "each falls apart 8 hours after its creation" — a
   * span measured from {@link since}, which is the clock at the binding.
   *
   * **On the bond rather than on a timer**, and the reason is the same one
   * that makes this a bond at all: what runs out here takes a *creature* away,
   * and a creature leaving is a batch of events rather than a line the fold
   * can delete. The four other ways a kept creature goes are already read by
   * `strandedSummons` and settled by `dismissStrandedSummons`; this is a
   * fifth, and it needed no new machinery on either side.
   */
  readonly lastsSeconds?: number;
  readonly since?: number;
  /**
   * SRD Find Familiar: "you can temporarily dismiss the familiar to a pocket
   * dimension … cause it to reappear in an unoccupied space within 30 feet of
   * you." The one number the two doors read, pinned from the spell at the
   * binding so the recall opens no book. Absent for a kept creature the spell
   * offers no pocket to.
   */
  readonly pocket?: { readonly within: number };
}

/**
 * What a thing a feature made **is**, beyond the sheet it arrived with — see
 * {@link CreatureState.device}.
 *
 * SRD Gnomish Lineage's clockwork device. Everything here was pinned at the
 * making, which is rule 5: the trait that made it, what the maker chose it to
 * do, and what touching it costs. Nothing is looked up again, so a device made
 * last year still does what its maker said it would.
 *
 * **The function is prose and stays prose.** "One effect from the
 * Prestidigitation spell" is a sentence the table narrates — the engine holds
 * no candle to light and no thimbleful of flavour — so what the Bonus Action
 * buys is the sentence handed back, which is the reading a stat block's
 * printed line already gets.
 */
export interface DeviceRecord {
  /** The feature that made it — SRD's Gnomish Lineage. */
  readonly feature: string;
  /** What that feature is called, for a refusal and for the log. */
  readonly featureName: string;
  /** The effect its maker chose, in the book's own words. */
  readonly function: string;
  /**
   * SRD: "If the chosen effect has options within it, you choose one of those
   * options for the device when you create it." Absent where the effect has
   * none, which is most of them.
   */
  readonly detail?: string;
  /** What activating it costs whoever touches it. */
  readonly activation: 'action' | 'bonus-action';
}

/**
 * A form a creature's own stat block offers it — see
 * {@link CreatureState.form}.
 *
 * {@link AssumedShape}'s smaller sibling, and the fields say how they differ:
 * there is no feature, because a printed line is not an activation and nothing
 * ends this but another use of the same line; and `original` holds only what a
 * form can move — the sheet, for the two blocks that print a Speed per form,
 * and the size every other printing names.
 *
 * `sceneSize` is the scene's own copy of the size at the moment of the change,
 * so the form's footprint can be taken back off the map as well as off the
 * creature; null where the creature stood in no scene.
 */
export interface WornForm {
  /** The form's own name, as the line prints it: `wolf`, `hybrid`, `object`. */
  readonly name: string;
  /** The heading it was taken off, so a refusal and a log can say which line. */
  readonly line: string;
  /**
   * What the creature was before it took **any** form.
   *
   * Kept from the first change rather than the last, for `AssumedShape`'s
   * reason: a werewolf going wolf-to-hybrid without passing through its own
   * skin must still have its own skin to go back to.
   */
  readonly original: {
    readonly sheet: CharacterSheet;
    readonly size: CreatureSize | null;
    readonly sceneSize: CreatureSize | null;
  };
}

/**
 * What a creature wearing another creature's statistics has set aside — see
 * {@link CreatureState.shape}.
 *
 * `sceneSize` is the scene's own copy of the size at the moment of the change,
 * so the shape's footprint can be taken back off the map as well as off the
 * creature; null where the creature stood in no scene.
 */
export interface AssumedShape {
  readonly feature: string;
  /** The stat block's id, for the record and for the sheet a caller reads. */
  readonly form: string;
  readonly original: {
    readonly sheet: CharacterSheet;
    readonly size: CreatureSize | null;
    readonly sceneSize: CreatureSize | null;
  };
}

/**
 * One creature fixed to another — see {@link CreatureState.attachments}.
 *
 * Everything here was pinned at the hit, which is rule 5: the line's own name,
 * so the log and a refusal can say which set of jaws this is, and the DC the
 * block prints on pulling it off. Nothing is looked up again afterwards.
 */
export interface Attachment {
  /** The creature this one is attached to. */
  readonly to: CharacterId;
  /** The stat-block line that made it — SRD's "Proboscis", "Crush". */
  readonly name: string;
  /**
   * SRD Darkmantle: "a successful DC 13 Strength (Athletics) check".
   *
   * **Absent is a rule rather than a default**: SRD Stirge's line says "can
   * detach the stirge as an action" and prints no roll at all, so an attach
   * with no DC comes off for the Action alone. Inventing one would be a check
   * nobody wrote down, which is the same reading `HitGrapple.escapeDc` takes
   * of a number the book does print.
   */
  readonly detachDc?: number;
}

/**
 * What an attach files everything under, named for **the other creature**.
 *
 * `grappleSource`'s twin, and symmetric where that one is not: a grapple lives
 * on the target alone, so naming the grappler is enough; an attach hangs
 * something at both ends — the Stirge's payment on the stirge, the
 * Darkmantle's Blinded on whoever it covered — and each end is filed under the
 * id of the one at the far end. So `attach:<x>` read off a creature means
 * "this is the attach between me and x", whichever of the two is reading, and
 * one ending releases both.
 *
 * Here rather than in `commands/unarmed.ts` beside its twin because the
 * **fold** needs it: `creature-detached` releases what the attach hung, and
 * nothing under `fold/` may reach a command.
 */
export const attachSource = (other: CharacterId): string => `attach:${other}`;

/** Who is at the far end of an attach, read back out of the source. Null for any other cause. */
export const attachedTo = (source: string): CharacterId | null =>
  source.startsWith('attach:') ? (source.slice('attach:'.length) as CharacterId) : null;

/**
 * What a condition **a thing holds** is filed under, named for the thing.
 *
 * SRD Giant Spider's Web: "The target has the Restrained condition until the
 * web is destroyed (AC 10; HP 5; …)." The lifetime is neither a clock nor
 * another condition: it is an object in the room with its own Hit Points, and
 * the Restrained ends the moment somebody burns it.
 *
 * **A source rather than a field on the instance**, which is how every other
 * hold in the engine says what ends it: `grapple:<who>`, `attach:<who>`, and
 * `holdStillStands` reading both back off the string at the moment the
 * boundary looks. So there is no new record, no migration, and nothing to
 * write down when the web burns — {@link heldByObject} is read where the rule
 * bites, and `liftWhatBrokenObjectsHeld` in `fold/expiry.ts` is the one reader.
 *
 * Here rather than beside the command for `attachSource`'s reason: the **fold**
 * needs it, and nothing under `fold/` may reach a command.
 */
export const heldByObjectSource = (object: CharacterId): string => `held-by:${object}`;

/** Which thing holds a condition, read back out of the source. Null for any other cause. */
export const heldByObject = (source: string): CharacterId | null =>
  source.startsWith('held-by:') ? (source.slice('held-by:'.length) as CharacterId) : null;

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
   * What the stat block prints beside the type — "Lawful Evil" — or null for
   * a creature whose block printed none and for every character, whose
   * alignment is a creation choice on {@link character} instead. Read by one
   * line: SRD Sprite's Heart Sight.
   */
  readonly alignment: string | null;
  /**
   * The damage type this creature's stat block declined to print, once the
   * table has ruled on it.
   *
   * SRD Half-Dragon's Draconic Origin names five types and says "(GM's
   * choice)", and two of its lines read their type off that trait. Null when
   * nobody has said, which is a real state and not a default: the lines that
   * want it ask for it — `needsContext('undeclared_damage_type', …)` — rather
   * than rolling something typeless or picking one.
   *
   * **One per creature**, because the trait is one sentence about the whole
   * block: the Claw and the Dragon's Breath both read "the type chosen for the
   * Draconic Origin trait", and two answers to one question is how they would
   * come to disagree.
   */
  readonly declaredDamageType: string | null;
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
   * Conditions this creature's stat block says it cannot be given at all.
   *
   * The other half of the run a stat block prints in one line — a Zombie's
   * "Immunities Poison; Exhaustion, Poisoned" is one damage type and two
   * conditions — and the half that reached nothing. `adaptMonster` has read it
   * since the adapter landed and `conditionApplicability` has answered three
   * ways about it, and every caller of either was a test: so a Zombie was
   * Poisoned by Ray of Sickness like anybody, silently, which is the class of
   * failure this repository calls its worst.
   *
   * **The creature's own, and it never grows**, exactly as {@link defenses} is
   * and for its reason: there is no source on it to end it by. A condition
   * immunity an *effect* grants is the seventh member of the sourced-grant
   * family and belongs beside {@link grantedDefenses}, not here.
   *
   * Unconditional entries only. A qualified one — "Charmed (except from its
   * vampire master)" — is withheld and reported, because applying it as
   * absolute makes the vampire unable to charm the one creature the entry
   * exists to let it charm.
   */
  readonly conditionImmunities: readonly ConditionName[];
  /**
   * How much space this creature takes up, as its stat block prints it.
   *
   * **Not the scene's copy.** `scene.sizes` says how big whoever is standing
   * on the map is, and it goes with the room; this is what the creature *is*,
   * and it survives a scene change like the sheet does. `placeCreatureInScene`
   * reads this when a caller states no size, so nobody above the engine has to
   * supply a fact the book prints.
   *
   * Null when nobody has said, which is a real state: every log written before
   * the field existed says the same, as does any creature added by something
   * that states no size. A character made through `createCharacter` pins one
   * from its species, so creation is no longer among them. `placeCreature` then
   * defaults to Medium exactly as it always has.
   */
  readonly size: CreatureSize | null;
  /**
   * The Challenge Rating this creature's stat block prints, 1/8 as `0.125`.
   *
   * **A fact about the creature and not a fact about the fight.** It is the
   * book's measure of how dangerous the thing is, and the SRD writes rules
   * that read it of a *target*: Animal Messenger's "if the target's Challenge
   * Rating isn't 0, it automatically succeeds" is the first one here. Pinned
   * at the arrival from the block, exactly as {@link size} and
   * {@link creatureType} are, so no rule that asks has to open a catalogue.
   *
   * Null when nobody has said, which is a real state rather than a zero: a
   * player character has no Challenge Rating at all, and every log written
   * before the field existed says the same. A rule that reads it asks for it —
   * calling an unstated rating zero would hand a spell the one answer that is
   * never checkable.
   */
  readonly cr: number | null;
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
   * How many heads this creature has, or null if nobody has said.
   *
   * SRD Hydra: "The hydra makes as many Bite attacks as it has heads", and
   * "Whenever the hydra takes 25 damage or more on a single turn, one of its
   * heads dies… the hydra grows two heads for each of its heads that died."
   * The count decides the size of an Attack action and nothing else reads it;
   * the engine derives the swings from the number rather than inventing one.
   *
   * **Beside `side` rather than inside a bag of declared facts.** A bag would
   * be a framework built for one instance: the three `*-declared` facts the
   * engine holds are a type (durable, contradiction refused), a side (fiction,
   * re-declarable) and this, and each is read by a different rule. Null is a
   * real state and the conservative one — an Attack action holds one swing,
   * which is what it held before anybody could say otherwise.
   */
  readonly heads: number | null;
  /**
   * The casting that is the reason this creature is standing here, or null.
   *
   * **Not a second lifetime.** A summons has exactly one — the casting's —
   * and this is the link to it rather than a deadline of its own: the ongoing
   * record already says whether the spell is still running, the timers
   * already say when a time span runs out, and a broken Concentration is
   * already found by a fold nobody commanded. What was missing was the
   * sentence "and the creature goes with it", which needs the creature and
   * the casting named in one place.
   *
   * Null is the ordinary state and the common one. A monster that walked
   * through the door is nobody's, and a creature a spell *created*
   * permanently — an Animate Dead Skeleton, raised by an Instantaneous
   * casting that is over before the Skeleton stands up — is bound to nothing
   * and outlives everything, which is exactly what null means here.
   *
   * `by` is the summoner, carried for the reason a casting's caster is: a
   * rule that asks whose creature this is has nowhere else to look.
   * Allegiance is **not** here — that is {@link CreatureState.side},
   * declared, because a summoned creature can turn.
   */
  readonly summonedBy: SummonBond | null;
  /**
   * What a feature made this thing to do, or null for everything that is not
   * such a thing — which is every creature in the book but one trait's.
   *
   * SRD Gnomish Lineage's clockwork device. Pinned into `creature-added` by
   * the making rather than carried on a second event, because it is part of
   * what the thing *is* in exactly the way its Armour Class and its size are.
   * See {@link DeviceRecord}.
   */
  readonly device: DeviceRecord | null;
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
   * The form this creature is wearing, or null in its own shape.
   *
   * SRD Wild Shape: "Your game statistics are replaced by the Beast's stat
   * block". While a form lasts, {@link sheet} *is* the merged sheet the
   * `shape-assumed` event pinned, and this holds what it replaced so the fold
   * can put it back — which it does the moment the shape's feature leaves
   * {@link activeFeatures}, by whichever of the endings took it. Nothing else
   * reads this: every rule that asks for a sheet reads `sheet` and finds the
   * form's, which is the whole point of the swap.
   */
  readonly shape: AssumedShape | null;
  /**
   * The form this creature's own stat block has it in, or null while it is in
   * the one its line returns to.
   *
   * SRD Shape-Shift. Null is **not** "no form": a creature that has never
   * shifted is in the form its line prints last, which is why `formWornBy`
   * answers with that rather than with this field. What this holds is the
   * change — the name three readers ask for, and the sheet and size the fold
   * puts back when the line is used to return.
   */
  readonly form: WornForm | null;
  /**
   * The lines this creature's stat block prints a **recharge** on that it has
   * used and not got back, by the heading the block prints them under.
   *
   * SRD *Monsters*: "Recharge X–Y. This notation means a monster can use the
   * stat block part once. At the start of each of the monster's turns, roll
   * 1d6 ... which also recharges when the monster finishes a Short or Long
   * Rest." A line used is spent until one of those two happens, and that is a
   * fact about the creature rather than about the turn — so it lives here and
   * not in the combat ledger beside `featureUsedOnTurn`, which is emptied
   * every turn and gone when the fight ends. A breath weapon does not come
   * back because everybody stopped fighting.
   *
   * **Names, because a line's identity is its heading.** That is what a caller
   * spends it by, what the log records, and what the sheet carries the
   * recharge on; nothing branches on one.
   *
   * Sorted, so state serialises identically however they were spent. Empty for
   * every character, for every creature whose block prints no recharge, and
   * for every log written before this existed — so both frozen fixtures fold
   * unchanged.
   */
  readonly expendedLines: readonly string[];
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
   * That this creature is falling, and when the table said so.
   *
   * Beside `lastDamage` rather than on the scene with cover and sight, and the
   * difference is the one that decides everything else about it. Cover and
   * sight are **standing** facts, three-valued and pairwise, that hold until
   * something changes them. A fall is **momentary** and about one creature, so
   * it lives where the other momentary per-creature fact lives and closes by
   * the same rule: see {@link FallMoment}.
   */
  readonly falling: FallMoment | null;
  /**
   * Where this creature is instead of in the scene, or null while it stands
   * in it.
   *
   * SRD Blink's Ethereal Plane, SRD Find Familiar's pocket dimension, SRD
   * Rope Trick's extradimensional space, SRD Swallow's gullet: a creature that
   * is **elsewhere** has no position, is caught by no area, holds whatever the
   * record hung on it under the record's `source`, and comes back only to a
   * space checked against the rule the record pinned when it left. See
   * {@link Elsewhere}. Null is what every log written before this existed
   * says, so both frozen fixtures fold unchanged.
   */
  readonly elsewhere: Elsewhere | null;
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
   * Senses a running effect has conferred — SRD Darkvision the spell. Read by
   * `sensesOf` beside the ones the sheet grants, at the longest range, and
   * released with the source exactly as the Speeds above are.
   */
  readonly senseModifiers: readonly GrantedSense[];
  /**
   * Amounts a running effect takes off a hit **before** the defences — SRD
   * Resistance the cantrip, which is not the defence of the same name.
   *
   * The seventh member of the family above, and the first whose reader is the
   * damage pipeline rather than a sheet: `defenses` and {@link grantedDefenses}
   * halve, double or refuse a total, and this subtracts a roll from one at the
   * step before. Linked by the source like every other grant, so
   * `releaseCasting`, `releaseOnTarget` and a `grants` deadline all end it
   * through the door that already existed.
   */
  readonly damageReductions: readonly GrantedDamageReduction[];
  /**
   * Amounts a running effect makes this creature take off the damage **it
   * deals** — SRD Ray of Enfeeblement's "it also subtracts 1d8 from all its
   * damage rolls".
   *
   * **{@link damageReductions}' mirror, and the axis is which side of the blow
   * the grant sits on.** That family is read where damage *lands* on this
   * creature; this one is read where the damage this creature *rolls* is
   * totalled, by `damagePenaltyOf` in `commands/damage.ts`. A single family
   * would have made a Ray of Enfeeblement on the ogre protect the ogre.
   *
   * Linked by the source like every other grant, so `releaseCasting`,
   * `releaseOnTarget` and a `grants` deadline all end it through the door that
   * already existed.
   */
  readonly damagePenalties: readonly GrantedDamagePenalty[];
  /**
   * Points a running effect has taken off one of this creature's ability
   * scores — SRD Shadow's Draining Swipe: "the target's Strength score
   * decreases by 1d4. The target dies if this reduces that score to 0."
   *
   * **A sourced grant and not an edit to the sheet**, for the reason every
   * other family here is: the sheet says what the creature *is*, and this says
   * what has been done to it and by what, so a rest can give it back without
   * having to remember the number. Read where the scores are derived
   * (`abilityScoresOf`) and so by every roller that asks `sheetAsItStands`;
   * released by either rest, which is the glossary's sentence about the
   * drain, and by whatever else ends a source.
   *
   * Absent means none, which is what every log written before a score could
   * be lowered says — so both frozen fixtures fold unchanged.
   */
  readonly abilityLowerings: readonly AbilityLowering[];
  /**
   * Running effects that take the cost of a **fall** away entirely.
   *
   * SRD *Feather Fall*: "If a creature lands before the spell ends, the
   * creature takes no damage from the fall, and the spell ends for that
   * creature."
   *
   * **Not {@link damageReductions}, and the difference is not a number.** That
   * family subtracts a roll from a hit of a stated type, wherever the hit came
   * from; this one is about *what happened* rather than about how much — a
   * warded creature takes nothing from a fall of any height, and the same
   * creature takes an ordinary Fire Bolt in the face. A reduction large enough
   * to reach zero would also have had to name Bludgeoning, which would have
   * warded it against a club.
   *
   * Read by `resolveFall`, which throws no dice at all where one is held: "no
   * damage" is not a roll that came to nothing, and a creature who avoided the
   * damage does not land Prone either — SRD ties the two together in one word
   * ("**unless** you avoid taking damage from the fall ... You **then** have
   * the Prone condition").
   *
   * Linked by the source like every other grant, so `releaseCasting`,
   * `releaseOnTarget` and a `grants` deadline all end it through the door that
   * already existed — and the landing itself ends it, because the book does.
   */
  readonly fallWards: readonly GrantedFallWard[];
  /**
   * The castings holding this creature off the ground — see {@link GrantedLift}.
   *
   * SRD *Levitate*: "rises vertically up to 20 feet and remains suspended
   * there for the duration."
   *
   * Linked by the source like every other grant, so `releaseCasting`,
   * `releaseOnTarget` and a `grants` deadline all end it through the door that
   * already existed — and ending it is not merely dropping the entry, because
   * this is the one grant whose removal the book gives a consequence to: "the
   * target floats gently to the ground if it is still aloft", which
   * `releaseCasting` performs on the lattice in the same derived pass.
   *
   * **A list, not a single hold**, because every grant family here is one and
   * two castings holding one creature up is not a contradiction: the ground is
   * where it goes when the **last** of them lets go.
   */
  readonly lifts: readonly GrantedLift[];
  /**
   * Jumps a running effect has bought this creature, and what each costs.
   *
   * SRD *Jump*: "Once on each of its turns until the spell ends, that creature
   * can jump up to 30 feet by spending 10 feet of movement."
   *
   * **Two numbers and a cap, because the sentence prints all three.** The
   * distance is a bound on the jump the way the sheet's own Long Jump is, and
   * the cost is a **price the spell fixes** rather than the feet the jump
   * covered — which is the whole of what the spell buys, and the reason this
   * is not a `speedModifiers` entry: nothing about the creature's Speed
   * changes, and thirty feet of ground still crosses thirty feet of ground.
   *
   * Read by `checkJump`, where the bound on a declared jump is decided, and by
   * `resolveMove`, where what a move costs is charged.
   *
   * Linked by the source like every other grant, so `releaseCasting`,
   * `releaseOnTarget` and a `grants` deadline all end it through the door that
   * already existed.
   */
  readonly jumpAllowances: readonly GrantedJump[];
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
   * Weapons a running effect has imbued, by the catalogue id of each.
   *
   * The fourteenth member of the family, and the other half of the sixth's
   * sentence: {@link attackRiders} adds a component of its own to a swing and
   * this changes the swing's own arithmetic — SRD Shillelagh's substituted
   * ability and replaced die, SRD Magic Weapon's flat plus to two rolls at
   * once.
   *
   * **It sits on whoever swings and names the object**, which is the pair
   * neither narrowing the engine already had could express: `onlyWithItem` is
   * keyed on the item that granted the benefit and there is no such item here,
   * and a `WeaponNarrowing` describes a kind of weapon rather than the one the
   * casting touched. See {@link GrantedWeaponRider} for what a catalogue id
   * can and cannot tell apart.
   *
   * Linked by the casting in its `source` exactly as the other thirteen are,
   * so `releaseCasting`, `releaseOnTarget`, a dispel, a broken Concentration
   * and the deadline all end it through the door that already existed.
   */
  readonly weaponRiders: readonly GrantedWeaponRider[];
  /**
   * Condition Immunities a running effect has hung on this creature.
   *
   * The seventh member of the family the six above form, and the half IE-017
   * deliberately left behind: it gave {@link defenses} a third input and
   * touched the condition table not at all, because a stat block "prints damage
   * types and conditions in one run ... which the engine treats completely
   * differently". SRD Mind Blank's "Immunity to Psychic damage **and the
   * Charmed condition**" is one sentence and both halves, and the second half
   * had nowhere to live — so a Charm Person aimed at a creature under Mind
   * Blank simply landed.
   *
   * Linked by the casting in its `source` exactly as the other six are, so
   * `releaseCasting`, `releaseOnTarget`, a dispel, a broken Concentration and a
   * `grants` deadline all end it through the door that already existed.
   *
   * **Not folded into {@link conditionImmunities}.** That table is the
   * creature's own, carries no source, and could never give a grant back again
   * — the same reading that keeps {@link grantedDefenses} out of
   * {@link defenses}, and the one that matters more here: the *qualified*
   * entries a stat block prints are deliberately in neither, and a merge would
   * flatten a distinction `conditionApplicability` exists to keep.
   */
  readonly grantedConditionImmunities: readonly GrantedConditionImmunity[];
  /**
   * The printed lines this creature has a day's grace from.
   *
   * SRD Ghost: "_Success:_ The target is immune to this ghost's Horrific
   * Visage for 24 hours." The eighteenth member of the family the seventeen
   * above form, and the one whose subject is not a condition, a number or a
   * roll but **one creature's one heading** — see {@link GrantedLineImmunity}
   * for why it is not folded into {@link grantedConditionImmunities}.
   *
   * Linked by the line in its `source` exactly as the others are, so the
   * `grants` deadline the success hung ends it through the door that already
   * existed.
   */
  readonly lineImmunities: readonly GrantedLineImmunity[];
  /**
   * A creature type one running effect has put over this creature's own.
   *
   * SRD Arcanist's Magic Aura, _Mask (Creature)_: "Spells and other magical
   * effects treat the target as if it were a creature of the chosen type."
   *
   * The nineteenth member of the family the eighteen above form, and the first
   * whose subject is a *fact about what a creature is*. Beside
   * {@link creatureType} and deliberately not merged into it: that field is
   * what the creature **is**, carries no source, and is the one fact in the
   * engine whose re-declaration is refused outright — so a mask written there
   * could never be given back, and would make Arcanist's Magic Aura a thing
   * that permanently rewrites a goblin. `typeMagicSees` in `creature-type.ts`
   * is the reader, and its docstring is where the line between a magical asker
   * and a mundane one is drawn.
   */
  readonly creatureTypeMasks: readonly GrantedCreatureType[];
  /**
   * How far running effects have moved this creature's size, in categories.
   *
   * The Mask's twin over the other fact a creature *is*: SRD Enlarge/Reduce's
   * "increases by one category" is a sourced grant here rather than a write to
   * `size`, which is stated once and given back to nobody. `effectiveSizeOf`
   * reads the sum over whatever size otherwise stood, the fold's `settleSizes`
   * moves the map by the same step for a creature whose size is stated, and
   * every door that ends a grant gives the size back. Empty is what every log
   * written before this field says, so both frozen fixtures fold unchanged.
   */
  readonly sizeOverrides: readonly GrantedSize[];
  /**
   * What a running casting hands this creature at each of its turn boundaries.
   *
   * The eighth member of the family the seven above form, and the first of them
   * that is *read by a moment* rather than by a roll: SRD Heroism's "gains
   * Temporary Hit Points equal to your spellcasting ability modifier at the
   * start of each of its turns" is a standing arrangement, and the turn
   * boundary is the only thing that ever looks at it.
   *
   * **It is a grant rather than a debt, and that is the design.** Nothing is
   * ever *owed* between turns: `resolveTurn` reads this as it passes the
   * boundary and pays it there, exactly as it reads a creature's vitals for the
   * Death Saving Throw it owes. A queue would be a second place for the same
   * fact to live, kept in step by remembering to file and to discharge — and a
   * payout that was filed and never settled would wedge the fight over a
   * sentence that hands out Temporary Hit Points.
   *
   * Linked by the casting in its `source` exactly as the other seven are, so
   * `releaseCasting`, `releaseOnTarget`, a dispel, a broken Concentration, the
   * deadline and a `grants` timer all end it through the door that already
   * existed.
   */
  readonly payouts: readonly GrantedPayout[];
  /**
   * What this creature has **fixed itself to** — SRD Stirge: "the stirge
   * attaches to the target"; SRD Darkmantle: "the darkmantle attaches to the
   * target."
   *
   * **A relation and not a grant**, which is why it is here rather than in the
   * family above it: every member of that family is an effect *hung on* a
   * creature and ended by a source match, and this is a fact about two
   * creatures at once. It is also not a grapple — a grapple gives the *target*
   * the Grappled condition and is derived off that instance's source, and the
   * creature held by an attach is the one that attached: the target may walk
   * off with a stirge on them. So `grapplesOn` correctly finds nothing.
   *
   * **On the attacher, because that is where the sentence is.** "The stirge
   * attaches to the target" is a thing the stirge did, and the two doors out
   * of it are both about the stirge — five feet of its own movement, or an
   * Action somebody spends pulling it off. What the attach hung on the
   * *target* is filed under `attach:<the attacher>` and ends with it.
   */
  readonly attachments: readonly Attachment[];
  /**
   * The glossary's **hazards** this creature is caught in — SRD *Burning*: "A
   * burning creature or object takes 1d4 Fire damage at the start of each of
   * its turns."
   *
   * **Beside {@link conditions} and not inside them**, which is the glossary's
   * own filing: the fifteen conditions are one closed list under one heading
   * and a hazard is under another, so a stat block's "Immunities … Exhaustion,
   * Poisoned" run reaches conditions and reaches nothing here. A creature
   * immune to every condition in the game still burns, which is what putting a
   * fire in the condition table would have quietly denied.
   *
   * **Not one of the sourced grants above either.** Every member of that
   * family is hung on a creature by an effect and ends by a source match — a
   * casting, a deadline, a dispel — and a fire ends by somebody rolling on the
   * ground. The Magmin that lit it may be dead; the fire is not its lifetime.
   *
   * Sorted by hazard, so state serialises identically however they were
   * caught, and keyed by hazard for the same reason a grapple is keyed by its
   * grappler: a creature is burning or it is not, and a second Burn re-lights
   * one fire rather than doubling the die.
   */
  readonly hazards: readonly CreatureHazard[];
  /**
   * What a running effect has changed about what this creature may spend a
   * turn on — the ninth member of the family the eight above form.
   *
   * See {@link ActionRule} in `combat.ts`, where the vocabulary, the three
   * SRD sentences behind it and the doctrine on compulsion all live. Linked
   * by its `source` exactly as the other eight are.
   */
  readonly actionRules: readonly GrantedActionRule[];
  /**
   * Reactions somebody else has put in this creature's hands — the tenth
   * member of the family the nine above form.
   *
   * SRD Bardic Inspiration: a die the Bard spends a use on and the *ally*
   * holds, for an hour, until they use it. What a creature may do is otherwise
   * read off their sheet and re-derived from the class table on every look;
   * this is the other lifetime, and it is the one every grant here already has
   * — stored, unconditional, ended by a source match. Linked by its `source`
   * exactly as the other nine are, so the deadline, a dispel and the use that
   * spends it all end it through the door that already existed.
   */
  readonly grantedReactions: readonly GrantedReaction[];
  /**
   * What a running effect has said about this creature regaining hit points —
   * the eleventh member of the family the ten above form.
   *
   * SRD Beacon of Hope maximises any healing for a minute; SRD Chill Touch
   * forbids all of it until the end of the caster's next turn. Both are rules
   * standing in front of arithmetic rather than amounts, and both belong to
   * whatever hung them: linked by `source` exactly as the other ten are, so a
   * dispel, a broken Concentration and a `grants` deadline all end them
   * through the door that already existed. See {@link HealingRule}.
   */
  readonly healingRules: readonly GrantedHealingRule[];
  /**
   * What a running effect has added to this creature's hit point maximum —
   * the twelfth member, and the only one the fold has to *reconcile* rather
   * than merely read.
   *
   * SRD Aid: "Each target's Hit Point maximum and current Hit Points increase
   * by 5 for the duration." The other eleven families are consulted where they
   * matter and cost nothing when they are taken away; this one moves a number
   * that is stored, so `settleHitPointMaximum` runs in the fold's derived pass
   * and brings `Vitals.hpMax` back in line with whatever is still here. That
   * is what buys the release path for free — nothing has to emit the
   * subtraction, because no ending emits anything at all.
   */
  readonly hitPointMaxima: readonly GrantedHitPointMaximum[];
  /**
   * Conditions this creature has and can no longer benefit from.
   *
   * The thirteenth member of the family the twelve above form. SRD Starry
   * Wisp: "until the end of your next turn, it … can't benefit from the
   * Invisible condition" — the condition is still on the creature and what it
   * buys has been taken away, which is a third thing beside ending a
   * condition and refusing one. See {@link DeniedBenefit}, where the three
   * are told apart, and `benefitsFrom`, which is what the readers ask.
   */
  readonly deniedBenefits: readonly DeniedBenefit[];
  /**
   * Defences a running casting has hung on this creature that the **attack
   * path** consults, with nobody taking a Reaction.
   *
   * The fourteenth member of the family the thirteen above form, and the one
   * the owner's ruling of 2026-09-22 called for: SRD Mirror Image, Sanctuary
   * and Fire Shield all intervene in an attack *another creature* is making,
   * and none of them is a Reaction, a mode or a number. See
   * `passive-defenses.ts`, where the three shapes are told apart.
   *
   * **The one family that holds a number which moves.** A decoy count goes
   * down by one per deflection, through `decoy-destroyed` — the only event in
   * the engine that edits a grant rather than adding or dropping one. It is
   * still a grant in every other respect: the `source` carries the casting, so
   * `releaseCasting` ends it with the spell and `grantsOf` picks it up with
   * the rest.
   */
  readonly passiveDefenses: readonly ActivePassiveDefense[];
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
  readonly equipped: readonly EquippedItem[];
  /**
   * The magic items this creature has attuned to, sorted by id.
   *
   * Beside `equipped` rather than inside it, because the two are different
   * relations to the same object: attunement survives taking the item off, and
   * wearing an item you never attuned to is the normal state of a cloak in a
   * shop. SRD caps this at three, which `attuneItem` enforces.
   */
  readonly attuned: readonly AttunedItem[];
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

/**
 * That this creature is falling, and the moment it was said.
 *
 * {@link LastDamage}'s shape with its one identifying field taken away, for
 * the reason that field is on the other: damage is dealt *by* somebody and a
 * Reaction to it burns them, while a fall is dealt by the world and Feather
 * Fall answers whoever is dropping. The two remaining fields are the whole of
 * the window — the turn it happened on in combat, the clock instant outside
 * one — because they are the two facts the engine already holds about "now".
 *
 * **There is no height, no rate and no landing here**, and a reader tempted to
 * add one should read {@link GameEvent} on `fall-declared` first: every one of
 * the three is a number the SRD makes the table's, and a fall that the engine
 * claimed to measure would be the engine inventing it.
 */
export interface FallMoment {
  readonly turn: number | null;
  readonly elapsed: number;
}

/**
 * A running effect that takes a fall's damage away, read only for what hung
 * it.
 *
 * One field, because SRD *Feather Fall* prints one outcome and no number:
 * "the creature takes **no** damage from the fall". A magnitude here would be
 * {@link GrantedDamageReduction} written a second time, and the Monk's Slow
 * Fall — which does print a number — is a feature's standing grant read from
 * the sheet, not this.
 *
 * Declared here beside {@link FallMoment} for its reason: falling is a fact
 * about a creature that the engine holds in exactly two places, the moment the
 * table declares and the ward a casting hung, and neither belongs to a sheet.
 */
export interface GrantedFallWard {
  /** The casting (`Feather Fall#cast:3`) that hung it. */
  readonly source: string;
}

/**
 * A casting holding a creature off the ground.
 *
 * SRD *Levitate*: "rises vertically up to 20 feet and **remains suspended
 * there for the duration** ... When the spell ends, the target floats gently
 * to the ground if it is still aloft."
 *
 * **One field, because the whole of what this records is that somebody's magic
 * is what is holding the creature up.** How high they are is not here and must
 * not be: the lattice already holds it, the caster may change it, and a second
 * copy of an altitude is a second answer to where the creature is. What the
 * grant buys is the *link* — whose casting, so that `releaseCasting` knows
 * whom to set down and `spellOn` can say the spell is on them.
 *
 * **It is the clause `flightLost` names and cannot read.** SRD's Flying rules
 * except a creature "being held aloft by magic" from falling when its Speed
 * drops to 0, and that docstring says in as many words that nothing records
 * the fact. This is the record; a creature with no Fly Speed was never in that
 * rule's way to begin with, which is why Levitate needs nothing else.
 *
 * Declared here beside {@link GrantedFallWard} and {@link GrantedJump} for
 * their reason: what holds a creature up, what it does about coming down and
 * what it may leap over are one family, held in this file and read in
 * `commands/movement.ts` and `fold/release.ts`, and none of the three is a
 * fact about a sheet.
 */
export interface GrantedLift {
  /** The casting (`Levitate#cast:3`) that is holding them there. */
  readonly source: string;
}

/**
 * A jump a running effect bought, the distance it covers and what it costs.
 *
 * SRD *Jump*, whole: "Once on each of its turns until the spell ends, that
 * creature can jump up to 30 feet by spending 10 feet of movement."
 *
 * Declared here beside {@link GrantedFallWard} for its reason: what a creature
 * can do about gravity is held in this file and read in `commands/movement.ts`,
 * and neither half is a fact about a sheet.
 */
export interface GrantedJump {
  /** The casting (`Jump#cast:2`) or other source that bought it. */
  readonly source: string;
  /** SRD: "can jump up to 30 feet" — a bound on the distance covered. */
  readonly feet: number;
  /**
   * SRD: "by spending 10 feet of movement."
   *
   * **A price rather than a discount**, which is why it is a number on the
   * grant instead of a subtraction somewhere: the jump costs this whatever it
   * covered, so thirty feet of ground is bought for ten and five feet of
   * ground is bought for ten as well. A creature that wanted the cheaper of
   * the two simply does not declare the jump.
   */
  readonly costsMovement: number;
  /**
   * The turn this allowance was last spent on, where there was one.
   *
   * SRD's "Once on each of its turns", held on the grant rather than on the
   * turn's budget: the cap belongs to the *sentence* that bought the jump, so
   * two sources that each print one would each be spendable once, and a
   * creature's own turn record would have had to name them.
   *
   * **Absent means it has not been spent since the last turn this creature
   * took**, and outside combat it is never written at all — there are no turns
   * to count, which is the reading every once-per-turn cap in this engine
   * already takes.
   */
  readonly takenOnTurn?: number;
}

export interface PendingAttack {
  readonly attacker: CharacterId;
  readonly target: CharacterId;
  /** Catalogue id, or null for an Unarmed Strike. */
  readonly weapon: string | null;
  /**
   * The heading of the line this creature's own stat block printed, where the
   * swing was one of those rather than a weapon's.
   *
   * **The line's identity, pinned exactly as `weapon` above pins a weapon's.**
   * A held swing has to be able to roll its damage a command later, and a
   * printed line's damage is on the line — so a hold that remembered only "no
   * weapon" would settle a Wolf's Bite as an Unarmed Strike, which is why a
   * printed attack refused the hold until the owner ruled on 2026-09-21 that a
   * monster's attack is holdable like anybody else's.
   *
   * The name and not the numbers, for the reason `weapon` is an id rather than
   * an armoury record: the line is read back off the creature's own sheet at
   * settlement, in the same breath as `sheetAsItStands` re-reads the rest of
   * it. No catalogue is opened either way — a stat block's attacks were pinned
   * into `creature-added` when the creature arrived.
   *
   * Absent for every swing made with a weapon, which is every character's, and
   * for every log written before a printed line could be held.
   */
  readonly action?: string;
  /**
   * The mastery property this swing is using, and what the attacker said about
   * it — absent where they are using none.
   *
   * **Pinned rather than re-derived**, because it is not a fact about the
   * weapon alone: a substitution the attacker chose for *this attack* is
   * Tactical Master's whole sentence, and a hold that re-read the weapon would
   * settle its damage under a property the swing was not made with. Absent
   * from every log written before mastery ran, which is why it is optional.
   */
  readonly mastery?: {
    readonly property: WeaponMastery;
    /** SRD Push: "up to 10 feet", where the attacker asked for less. */
    readonly feet?: number;
  };
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
  /**
   * What the hit bought, waiting for the damage to land.
   *
   * **The defender answers first**, which is the rule {@link PendingDamage}
   * already states — and a held swing is where it bites hardest: the window a
   * hold is open for is `hit-by-attack`, SRD Shield's own, and a target Stunned
   * by the attacker's rider can take no Reaction at all. So a held swing pins
   * what it bought here and `resolveAttackDamage` settles it, after the damage,
   * exactly where an ordinary swing settles its own.
   *
   * **Unconditional, where the ordinary pin is conditional.** A damage roll
   * pins its rider only when somebody was offered something; a hold is a window
   * standing open by construction, so there is no case to fire early in.
   *
   * The option is pinned whole rather than looked up again, for the reason
   * everything else on this record is: what it said was read at the swing, and
   * the settlement must not re-read a sheet that has moved. The attacker is not
   * pinned beside it because this record already names one.
   *
   * Absent for every swing that bought nothing, which is nearly all of them,
   * and for every log written before riders existed.
   */
  readonly rider?: HitOption;
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
   * How many of the casting's attack rolls each of `targets` takes, aligned to
   * that list by position.
   *
   * Beside the targets and for the same reason: settlement takes no fresh
   * request, so a Scorching Ray declared three rays at the goblin and one at
   * the ogre must not settle two and two. A vector rather than a second list
   * of ids, because the ids are already above and a casting may not name a
   * creature twice.
   *
   * Absent for every casting whose caster stated no split — which is every
   * spell but the two that throw several rolls, and is what makes a
   * declaration written before this fold to exactly the state it always did.
   */
  readonly rollsPerTarget?: readonly number[];
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
    /** The spaces a wall runs through, for the one template the caster draws. */
    readonly path?: readonly Point[];
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
   * The value the caster chose, where the spell prints a choice.
   *
   * Beside the damage type and for the same reason a second time: a
   * Blindness/Deafness declared Deafened must not settle Blinded, and a
   * settlement takes no fresh request to ask again. SRD writes the clause four
   * ways — "(your choice)", "choose a skill", "choose Strength, Dexterity,
   * …", "end **one** condition on it" — and the engine chooses none of them.
   *
   * Absent for every spell that prints no choice, which is what makes a
   * declaration written before this folds to exactly the state it always did.
   */
  readonly choice?: string;
  /**
   * The creature types the caster chose, where the spell prints a choice of
   * one or more — SRD Magic Circle's "Choose one or more of the following
   * types". Beside {@link choice} and for its reason: a circle declared against
   * Fiends must not settle against Undead, and a settlement takes no fresh
   * request to ask again. Absent for every spell that prints no such clause.
   */
  readonly types?: readonly string[];
  /**
   * Which of the spell's printed branches this casting runs.
   *
   * Beside the value the caster chose and for its reason: a Command declared
   * as Halt must not settle as Grovel, and a settlement takes no fresh request
   * to ask again. SRD Command's five words, Thaumaturgy's six wonders and
   * Enlarge/Reduce's two halves are the writers — see
   * `SpellDefinition.options`.
   *
   * Absent for every spell that prints no branches, which is what makes a
   * declaration written before this folds to exactly the state it always did.
   */
  readonly option?: string;
  /**
   * The ending the caster chose at the casting, kept for the settlement.
   *
   * Beside the branch above and for its reason: SRD Magic Mouth takes a minute
   * to cast, so the caster's "you can have the spell end after it delivers its
   * message" is said a minute before there is a casting to hang it on, and a
   * settlement takes no fresh request to ask again. See
   * `OngoingSpell.endsAfterTrigger`, which is where it lands.
   *
   * Absent for every spell that prints no such choice, which is what makes a
   * declaration written before this folds to exactly the state it always did.
   */
  readonly endsAfterTrigger?: true;
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
   * Where the orb leaps, in the caster's order — SRD Chromatic Orb, held open
   * for a Counterspell and settled with the list its caster stated. Absent for
   * every spell that does not leap, which is every spell but one, and for
   * every declaration written before the field existed.
   */
  readonly leapTo?: readonly CharacterId[];
  /**
   * Which of this casting's targets consent to it.
   *
   * SRD Mage Armor's "a **willing** creature" and SRD Levitate's save for one
   * that is not. The ninth fact a caster states at the casting, pinned here
   * for the third's reason — settlement takes no fresh request, so a Levitate
   * declared over a willing ally must not settle with the ally saving.
   *
   * A list, because the clause is about the target; sorted on the way in and
   * **absent when empty**, which is where it follows the designation rather
   * than the fought list: neither consent clause insists on an answer, so
   * "nobody was named" and "nobody consented" are one casting.
   */
  readonly willing?: readonly CharacterId[];
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
   * Creatures this casting's area reaches, for a spell that offers the choice.
   *
   * SRD Pass without Trace: "you and each creature you choose". The
   * designation above with the polarity turned over, normalised by `chosenFor`
   * — sorted, and with the caster on it, because the sentence names them first
   * and a reader that had to remember that would be a second place for the
   * rule to live.
   *
   * **Absent means the spell offers no such clause, and never that nobody was
   * named**, which is the one place this parts company with the designation it
   * otherwise copies. An empty designation and no designation are one casting;
   * an empty choice is not, because "you and each creature you choose" with
   * nobody chosen reaches the caster and nobody else, and a reader that saw
   * absence there would hand the aura to whoever the geometry caught.
   */
  readonly chosen?: readonly CharacterId[];
  /**
   * A mode on the saves this casting forces on a named creature, and what
   * bought it.
   *
   * SRD Heightened Spell: "give one target of the spell Disadvantage on saves
   * against the spell." Beside the designation above and pinned for its
   * reason: the caster named the creature at the casting and the settlement
   * takes no fresh request — and the source is pinned with it because it came
   * out of a catalogue, so a corrected option name next month does not rewrite
   * what a log already recorded.
   *
   * Absent for every casting that bought no such option, which is all but one
   * in the book, so a declaration written before this folds to exactly the
   * state it always did.
   */
  readonly saveModes?: Readonly<
    Record<string, { readonly mode: RollMode; readonly source: string }>
  >;
  /**
   * Whether this casting can be perceived being made.
   *
   * SRD Subtle Spell: cast "without any Verbal, Somatic, or Material
   * components", which a spell with no components cannot be identified or
   * Counterspelled through. So it is pinned on the record the Counterspell
   * window reads, and nothing is offered against it.
   *
   * **The only one of the six carried-through options that a declaration must
   * record**, and the reason is the option itself: a casting nobody held open
   * has no window to close, so this field *is* what Subtle Spell buys.
   *
   * Absent means an ordinary casting, which is every one written until now.
   */
  readonly subtle?: true;
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
  /**
   * The weapon a spell that imbues one was aimed at, by catalogue id.
   *
   * The fifth stated fact, beside the other four and for the same reason: a
   * Shillelagh declared at the Quarterstaff must not settle at the Club in the
   * same pack, and settlement takes no fresh request to ask again.
   *
   * Absent for every spell that imbues nothing, which is all but two of them,
   * so a declaration written before this folds to exactly the state it always
   * did.
   */
  readonly weapon?: string;
  /**
   * The object a spell aimed at a thing was pointed at, by catalogue id.
   *
   * The weapon's neighbour above and its reason: a Remove Curse declared at
   * the cloak must not settle at the amulet in the same pack, and settlement
   * takes no fresh request to ask again. Absent for every spell that touches
   * no object, which is all but one of them, so a declaration written before
   * this folds to exactly the state it always did.
   */
  readonly object?: string;
  /**
   * The stat block a summoning spell that leaves the form to its caster was
   * told to raise, by its id in content.
   *
   * The sixth stated fact, beside the other five and for the same reason: a
   * Find Familiar declared as a Cat must not settle as an Owl an hour later,
   * and settlement takes no fresh request to ask again. Absent for every
   * spell that names its own block, so a declaration written before this
   * folds to exactly the state it always did.
   */
  readonly form?: string;
  /**
   * The numbers the casting was made with, for a casting an item made.
   *
   * Every other field here is pinned because settlement takes no fresh
   * request; this one is pinned because settlement cannot ask the *item*. SRD
   * "Spells Cast from Items" makes a wand's spell an ordinary casting, and an
   * ordinary casting re-derives its route from the caster's sheet at
   * settlement — a fact nothing in between can have changed. A wand can be put
   * down, handed over or unattuned while the casting is held open, so the
   * route that made it may simply not exist by the time it settles, and the
   * numbers are the one thing that would be lost with it.
   *
   * **Absent for every casting a class or a feat supplied**, which is what
   * makes a declaration written before this fold to exactly the state it
   * always did.
   */
  readonly numbers?: CastingNumbers;
  /**
   * The spellcasting ability the casting rolls its own D20 Tests with.
   *
   * Beside {@link PendingCasting.numbers}, pinned for the same reason and kept
   * apart from it because an ability is not a number: SRD Dispel Magic rolls
   * "an ability check using your spellcasting ability", and which ability that
   * is decides the roll's modes and which conditions fail it outright. A
   * casting an item made cannot re-derive it — the wand may be in somebody
   * else's hand by the time the spell lands — and a wielder's *sheet* is not
   * the answer either, because a Fighter whose only spellcasting is a feat's
   * has a null one and an ability all the same.
   *
   * Absent for every casting a class or a feat supplied, and for a wielder who
   * casts nothing of their own; the spells that would read it refuse at the
   * route, before the charge goes.
   */
  readonly ability?: Ability;
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
   * The turn on which the caster last took the Magic action for this rite.
   *
   * SRD "Longer Casting Times": "you must take the Magic action on **each of
   * your turns**, and you must maintain Concentration while you do so. If your
   * Concentration is broken, the spell fails, but you don't expend a spell
   * slot." The Concentration half is `releaseCasting`'s and always was; this is
   * the other half, and it is one number because the question the turn boundary
   * asks is one question — *did this turn see it?*
   *
   * `state.combat.turnsTaken` at the declaration, and again at every
   * `casting-continued`. A turn ending compares it against the number of the
   * turn that ended, so the turn a rite was **declared** on needs no second
   * Magic action: the declaration was it.
   *
   * **Absent means no turn has**, which is what a rite declared outside combat
   * carries into a fight that starts around it — so the caster's first turn of
   * that fight is the first one it is owed on. It is absent for every casting
   * that is not a long one, and for every casting written before this existed,
   * which is the whole compatibility story.
   *
   * **Dropped when the fight ends**, because turn numbers restart with each
   * one: a marker from the last fight names a turn that has not happened, and
   * left standing it would silently credit turn 3 of the next fight with turn 3
   * of the last.
   */
  readonly sustainedOnTurn?: number;
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
   * and inside one `castSpellWith` refuses it `duration_not_a_span`, since a
   * moment in the turn order pinned a rite before the spell exists is the very
   * bug this field was built against. So a span is the only kind that can reach
   * here, and storing the narrower thing means settlement cannot fail. That is
   * the same validate-before-rolling rule {@link deadline} obeys, arriving at
   * the other end.
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
  /**
   * What the blow still owes, held until the defender has answered.
   *
   * **The defender answers first.** A feature's rider fires "when you hit a
   * creature" and so does the Reaction this window is offering — SRD Uncanny
   * Dodge is "when an attack roll hits you" — and a rider resolved first can
   * take the answer away: a target Stunned by a Stunning Strike may no longer
   * take the Reaction the same blow had just offered it. So a hit that opens a
   * window puts the rider *here*, and the settlement resolves it once the
   * damage has landed.
   *
   * Pinned whole rather than looked up again, for the reason everything else
   * on this record is: what the option said was read at the swing, and the
   * settlement must not re-read a sheet that has moved in between.
   *
   * Absent for every other damage roll, which is nearly all of them: a rider
   * on a swing nobody can answer resolves in the same command it always did.
   */
  readonly rider?: PendingHitRider;
}

/** A rider a held damage roll owes, and whose it is. */
export interface PendingHitRider {
  readonly attacker: CharacterId;
  /** The option the swing bought, exactly as the sheet stated it. */
  readonly option: HitOption;
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
       * The value the caster chose, where the spell prints a choice.
       *
       * The same fact {@link PendingCasting} carries, for the same reason: a
       * readied Blindness/Deafness declared Deafened must not let go Blinded,
       * and the release takes no fresh request about what the spell *is*.
       */
      readonly choice?: string;
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
      /**
       * Which of the casting's targets consent to it.
       *
       * SRD Mage Armor's "a **willing** creature", held for the fought list's
       * reason: the release restates nothing, so a spell whose target rule
       * gates on consent could not be let go at all without this. Absent when
       * nobody was named, because neither consent clause insists on an answer.
       */
      readonly willing?: readonly CharacterId[];
      /** Creatures the caster designated unaffected, for a spell that offers it. */
      readonly unaffected?: readonly CharacterId[];
      /** Creatures this casting's area reaches, for a spell that offers the choice. */
      readonly chosen?: readonly CharacterId[];
      /**
       * Where a teleporting spell puts its target.
       *
       * The fourth stated fact, and the one the release could not possibly
       * work out again — a Dimension Door readied against the far end of the
       * hall must not let go beside its caster.
       */
      readonly teleportTo?: Placement;
      /**
       * The weapon a spell that imbues one was aimed at, by catalogue id.
       *
       * The fifth stated fact, and the release could no more work it out than
       * it could the destination: a Shillelagh readied at the Quarterstaff
       * must not let go at the Club.
       */
      readonly weapon?: string;
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
  /**
   * Item copies given a record of their own, so the next one's id is known
   * before it is handed over.
   *
   * The counter `castingsBegun` is, for the same reason and by the same rule:
   * the command computes the next id and the fold **verifies** it, so an id is
   * a function of the log's own position rather than of a generator the engine
   * is not allowed to have. Only a copy with per-copy state is counted — today
   * that is a copy with charges — so a campaign whose characters carry nothing
   * but rope and arrows leaves this at zero forever.
   */
  readonly itemsIssued: number;
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
    itemsIssued: 0,
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

/** One kind of thing, and how many of it — or one copy, with a record. */
export interface InventoryLine {
  readonly id: string;
  readonly quantity: number;
  /**
   * This one copy's own id, where the copy has state of its own.
   *
   * **Absent is the ordinary line and exactly what it has always meant**: a
   * count of interchangeable things, twenty arrows on one line, merged with
   * the next twenty. Present, the line is a *single* copy — the fold refuses
   * any other quantity — and nothing ever merges it with another, because two
   * wands with three charges between them are not one wand with six.
   *
   * Issued by the command from {@link GameState.itemsIssued} and verified by
   * the fold, on the pattern a casting id already follows. **Only where the
   * catalogue record has per-copy state**: today that is a charge pool, whose
   * key is this id rather than the item's, so putting a wand down, picking it
   * up or handing it over finds the charges where they were left. What is in
   * this field is the command's pinned decision; the fold never opens a
   * catalogue to second-guess it.
   */
  readonly instance?: string;
  /**
   * The casting that conjured this line, where a spell put it in a hand.
   *
   * SRD Goodberry: "Ten berries appear in your hand and are infused with magic
   * **for the duration**"; Flame Blade: "You evoke a fiery blade in your free
   * hand." What such a line is, is a thing that exists because a casting does
   * — so its lifetime is **derived from the casting** rather than ended by an
   * event, on exactly the reading a patch of Difficult Terrain naming a
   * casting already takes: "derived at read time so there is no window in
   * which the webs are gone and the ground still costs double." A casting that
   * simply runs out of time writes nothing at all — expiry is derived
   * everywhere in this engine — so an event that took the berries away could
   * not have been written for the commonest way a spell ends.
   *
   * Absent on everything bought, found, awarded and carried, which is
   * everything the log held before a spell could conjure one. A conjured line
   * never merges with an ordinary one, and two castings never share a line:
   * two Goodberries are two handfuls with two lifetimes.
   */
  readonly casting?: string;
  /**
   * The **activation** that conjured this line, where a feature put it in a
   * hand.
   *
   * SRD Pact of the Blade: "you can conjure a pact weapon in your hand ... A
   * conjured weapon disappears when the bond ends." {@link casting} one field
   * up is the same sentence with a spell on the other end of it, and this is
   * here rather than folded into that one because the two are ended by
   * different things and read by different passes: a casting is looked up in
   * `state.ongoing`, and an activation in the holder's own `activeFeatures`.
   *
   * **Its lifetime is settled in the fold**, which is where it differs from
   * {@link casting} as well. A bond ends when its holder uses the Bonus Action
   * again, when they die, and when a condition takes the feature away — three
   * doors, not one of which knows a weapon was conjured, and two of which write
   * no event a removal could hang on. So `settleConjuredLines` drops the line
   * the moment the feature leaves `activeFeatures`, exactly as
   * `settleWeaponRiders` drops the rider beside it; a read-time filter like
   * `carrying`'s would keep a Glaive alive beside the Longsword that replaced
   * it, because an activation has no id and the second use of a feature wears
   * the same name as the first.
   *
   * Absent on everything bought, found, awarded, carried and conjured by a
   * spell, which is every line the log held before a feature could make one.
   */
  readonly feature?: string;
  /**
   * How many hands holding this line takes up, pinned where it was conjured.
   *
   * On the line rather than read off the item, because the sentence is about
   * the *handful* and not about the berry: ten berries appear in one hand and
   * a blade in another, and `handsFor` — which answers for a thing you can
   * pick up — would charge a hand for every berry. Rule 5: what the command
   * read from the definition travels with the event it emitted.
   *
   * Absent on an ordinary line, whose hands are the item's own and are read
   * off the catalogue by the command that asks.
   */
  readonly hands?: number;
}

/**
 * The three that say what a copy's own id is, re-exported from the leaf that
 * holds them.
 *
 * They moved out when `positioning.ts` came to key the floor by one: this
 * module's imports are loaded before it is, so a value edge from the geometry
 * to here pulled `standing.ts` in half-built. They are still *this* module's
 * vocabulary — see {@link InventoryLine.instance} — and every caller that had
 * them from here still has them from here. See `item-instance.ts`.
 */
export {
  ITEM_INSTANCE_PREFIX,
  itemInstanceFor,
  itemInstanceNumber,
} from './item-instance.js';

