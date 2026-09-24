/**
 * What a deadline is hung on, and what a turn boundary owes.
 *
 * `time.ts` answers *when*: a span, a moment in the turn order, and the one
 * conversion between them. Nothing in it knows what an effect is. This file is
 * the other half — the things a {@link Deadline} can stand over, and the debts
 * a boundary raises on the way past:
 *
 * | | |
 * |---|---|
 * | {@link TimedEffect} | a deadline, and the condition, casting, feature, grant or pool it ends |
 * | {@link RepeatSave} | the save that effect retakes at a turn boundary |
 * | {@link EffectCheck} | the check somebody *may* attempt against it, which is not the same thing |
 * | {@link PendingSave} | a save the boundary raised and nobody has rolled yet |
 * | {@link ScheduledDamage} | a hit a spell promised and a later moment collects |
 * | {@link GrantedPayout} | what a running casting hands over at every one of a creature's boundaries |
 *
 * The split is the direction of the dependency: a timer needs a deadline and a
 * deadline needs nothing. Everything here is data the fold holds and the
 * boundary reads, so `fold/timers.ts` and `commands/turns.ts` are its readers
 * and neither of them has to know how a duration was pinned.
 */
import type { Ability, CharacterId, ConditionName, Skill } from '@ie/shared';
import type { Deadline, TurnMoment } from './time.js';

/**
 * The longest one activation of a feature may be maintained.
 *
 * SRD Rage: "You can maintain a Rage for up to 10 minutes." That is not a
 * duration — the Rage's duration is "until the end of your next turn", and it
 * is pushed out again every round — it is a **ceiling on how many times that
 * can be done**, and the two are different enough that folding one into the
 * other would either end the Rage a round in or never end it at all.
 *
 * So it is a second number beside the deadline, and both of its fields are
 * pinned at the moment the activation begins:
 *
 * - {@link seconds} is the span the feature was written with, read off the
 *   holder's own sheet, where creation pinned it. Kept as well as the clock
 *   reading so a refusal can say *ten minutes* rather than *second 600*.
 * - {@link until} is the clock reading it may not be maintained past, which is
 *   the span added to the clock at the activation.
 *
 * **Carried across an extension, never re-derived.** A ceiling recomputed
 * each time the feature is extended is pushed a further ten minutes away by
 * the very act of approaching it, which is not a bound at all. And it is read
 * back out of the timer rather than out of a catalogue, so a log written
 * against a book that said one minute is still bounded by one minute — the
 * fold opens no catalogue, and neither does the command that reads this.
 */
export interface MaintenanceCap {
  /** The pinned span. SRD Rage's 600, straight off the sheet. */
  readonly seconds: number;
  /** The clock reading the activation may not be maintained past. */
  readonly until: number;
}

/** What an expiring timer ends. */
export type EffectTarget =
  /** One condition instance on one creature, by its deterministic id. */
  | { readonly kind: 'condition'; readonly on: CharacterId; readonly instance: string }
  /** A whole casting, and everything it created. */
  | { readonly kind: 'casting'; readonly castingId: string }
  /**
   * A feature a creature turned on and is still in.
   *
   * SRD Rage: "The Rage lasts until the end of your next turn" — a deadline
   * like any other, on a thing that is neither a condition nor a casting.
   *
   * **The one member that carries something beside its identity**, and
   * {@link MaintenanceCap} says why: a feature's activation has no other
   * record anywhere in the state. `activeFeatures` is a list of strings and
   * the fold keeps no moment for any of them, so this timer *is* the engine's
   * handle on "this running Rage", and the ceiling that activation runs under
   * belongs on it. {@link timerKey} reads only {@link kind}, {@link on} and
   * {@link feature}, so a re-scheduled deadline still lands on the same key
   * and still replaces rather than joins.
   */
  | {
      readonly kind: 'feature';
      readonly on: CharacterId;
      readonly feature: string;
      /** The longest this activation may be maintained, or absent for no bound. */
      readonly cap?: MaintenanceCap;
    }
  /**
   * Every grant one source made on one creature.
   *
   * The operation already existed — `releaseOnTarget` performs it by casting —
   * and what was missing was a *deadline* on it. Nothing ended a grant before
   * the thing that made it ended, which is why `ModifierRider` carries no
   * `lasts` and why SRD Superior Hunter's Defense ("Resistance to that damage
   * ... until the end of the current turn") had nowhere to be written.
   *
   * **`source` rather than a casting id**, so a feature and a casting use the
   * same member. A casting's grants carry `Stoneskin#cast:3`; a feature's
   * carry the feature's own id, and neither needs a member of its own.
   *
   * **One member rather than one per grant kind.** A per-kind member would
   * need a per-kind identity here — `rollModifierKey` against a bare `source`,
   * which are not the same string — and would be four ways to write one
   * sentence. What ends is *what that source granted*, which is one question
   * however many of the four answers it.
   */
  | { readonly kind: 'grants'; readonly on: CharacterId; readonly source: string }
  /**
   * The Temporary Hit Points a creature is holding.
   *
   * SRD, and the owner's ruling of 2026-09-18 written the way the engine can
   * hold it: Temporary Hit Points with no stated duration last until they are
   * spent or until a Long Rest, and **an effect that states one overrides that
   * default** — the hour Potion of Heroism prints. The default needs no timer
   * (the rest clears the pool, and spending it is what damage already does);
   * the stated hour is a deadline like any other, and this is the thing it is
   * hung on.
   *
   * **No source, and that is the member rather than an omission.** Every other
   * target here identifies *one of many* — one condition instance, one
   * casting, one source's grants — because a creature can hold several at
   * once. A creature holds exactly **one** pool of Temporary Hit Points: SRD
   * is explicit that they do not stack, so a second grant replaces the first
   * rather than joining it. A `source` would let two deadlines stand over one
   * pool, and the older of them would end points it never granted. So the
   * creature is the whole identity, and {@link timerKey} keys it that way.
   *
   * **What expiry means here is a pool, not a fact.** A condition either holds
   * or it does not; Temporary Hit Points are a number that damage eats away
   * at, so the moment arrives to find however many are left — ten, four or
   * none. Removing none is as quiet as removing ten: nothing else about the
   * creature moves, and a deadline over an emptied pool is not a second
   * helping of damage. `fold/expiry.ts` says that in code.
   */
  | { readonly kind: 'temporary-hit-points'; readonly on: CharacterId };

/**
 * A saving throw an effect gets at a turn boundary.
 *
 * SRD Hold Person: "At the end of each of its turns, the target repeats the
 * save, ending the spell on itself on a success." Effects like that are
 * everywhere — held, restrained, charmed, dominated — and they all have the
 * same shape: a moment, a save, and something that happens when it lands.
 *
 * Everything the resolution needs lives here rather than in the caller's head,
 * because the point of the hook is that nobody has to remember it: the turn
 * knows what it owes.
 */
export interface RepeatSave {
  /** Which boundary it fires on. */
  readonly at: TurnMoment;
  /** Whose turn. Usually the held creature's own, but the SRD does vary it. */
  readonly of: CharacterId;
  readonly ability: Ability;
  readonly dc: number;
  /**
   * What a success does.
   *
   * `end-on-target` is Hold Person's "ending the spell **on itself**" — the
   * casting carries on for anyone else it caught. `end-casting` is for effects
   * that end outright when anyone shakes them off.
   *
   * **`end-casting` needs a casting**, and the source is what says whether
   * there is one. A repeat save hung on anything else — a poison in a bottle,
   * a source a caller supplied, a rider that disowned the casting that caused
   * it — may only be `end-on-target`, because what a success would end is the
   * condition and there is no spell behind it.
   *
   * **Three doors refuse the other spelling** rather than quietly treating it
   * as this one, and they are the three places a source is settled:
   * `checkSpellDefinition` for a rider that pairs it with `outlivesCasting`,
   * `checkContent` for a conferral, and `applyConditionTo` for a caller who
   * hands one over directly. The first two are at authoring, which is where a
   * defect in written content belongs; the last is the backstop, because a
   * caller writes no content to validate.
   */
  readonly onSuccess: 'end-on-target' | 'end-casting';
  /**
   * What a **failure** does, where the SRD writes a failure that acts.
   *
   * SRD Sleep: "at which point it must repeat the save. If the target fails
   * the second save, the target has the Unconscious condition for the
   * duration." The Cockatrice's bite is the same shape outside the spell book
   * — "_First Failure:_ Restrained and repeats the save at the end of its next
   * turn. _Second Failure:_ Petrified" — which is why nothing here names a
   * spell and the payload is a {@link ConditionName} like any other.
   *
   * **One failure, two consequences, and they are one sentence.** The deeper
   * condition is applied under the same source the first one carries, the
   * first condition goes, and the timer that raised the save goes with it —
   * so the boundary owes nothing further and the save is not repeated again.
   * `deepenedBy` in `commands/turns.ts` is where that is written, out of
   * `condition-removed` and `condition-applied`: the removal already drops the
   * deadline hung on the instance it lifts.
   *
   * **The condition that carries one takes no `lasts`.** It runs for the
   * casting's own duration, and the repeat is what changes it: a deadline
   * landing on the same moment as {@link at} would let `expireEffects` delete
   * this timer and `dropOrphanedSaves` drop the pending save before anybody
   * rolled it.
   *
   * **The condition it deepens *into* may carry either**, and the asymmetry is
   * the reason the two fields below exist. The deeper condition is applied
   * fresh and scheduled fresh, at a moment that has already arrived, so
   * nothing it is given can race a save nobody has rolled. SRD Brass Dragon
   * Wyrmling's Sleep Breath deepens into "the Unconscious condition **for 1
   * minute**" and SRD Silver Dragon Wyrmling's Paralyzing Breath into a
   * Paralyzed that "repeats the save at the end of each of its turns, ending
   * the effect on itself on a success" — one ended by the clock, one by a save
   * of its own, and a line may print both (the Silver Dragon's minute is the
   * cap after which its save succeeds automatically).
   */
  readonly onFailure?: {
    readonly condition: ConditionName;
    /**
     * How long the deeper condition lasts, where the sentence says.
     *
     * **A span on the clock and not a `Duration`**, which is the whole
     * vocabulary the book prints here: minutes and hours. A turn-anchored
     * deadline would be the moment the deepening *happened* — the boundary
     * that raised the failed save — said again as an ending, which is the race
     * the first rung is held away from wearing different words. Absent is the
     * ordinary answer: the deeper condition runs for whatever put it there,
     * exactly as the shallow one did.
     */
    readonly lasts?: { readonly seconds: number };
    /**
     * A save the deeper condition retakes, where the sentence gives it one.
     *
     * The same shape as the hook carrying it, because it is the same sentence
     * about a different condition — `deepenedBy` hangs it on the instance it
     * creates, so the boundary raises it from there and a success releases
     * that instance.
     *
     * **Without the failure branch, which is the type keeping the rule rather
     * than a comment claiming it.** The SRD prints no third rung at any tier,
     * and `RepeatSave` written plainly here would admit a stack of them —
     * `onFailure.repeats.onFailure.repeats` — that `deepenedBy` would go on
     * scheduling. `PrintedSaveEffectSchema` says the same thing on the printed
     * side by spreading its repeat's shape without the branch.
     */
    readonly repeats?: Omit<RepeatSave, 'onFailure'>;
    /**
     * The deeper condition ends the moment the creature takes damage.
     *
     * SRD Brass Dragon Wyrmling's Sleep Breath: "_Second Failure:_ The target
     * has the Unconscious condition for 1 minute. **This effect ends for the
     * target if it takes damage** or a creature within 5 feet of it takes an
     * action to wake it."
     *
     * **A flag rather than the list `condition-applied` carries**, because a
     * deepening is exactly one condition and there is nothing else here for a
     * name to pick out. `deepenedBy` widens it back to the name when it writes
     * the event, which is where the two vocabularies meet.
     */
    readonly endsOnDamage?: true;
    /** The other half of the same sentence — see `wakeCreature`. */
    readonly endsWhenWoken?: true;
  };
  /**
   * Damage the creature takes **before** the die is thrown.
   *
   * SRD Searing Smite: "the target takes 1d6 Fire damage **and then** makes a
   * Constitution saving throw." The order is the rule — the fire lands whether
   * or not the save is made — and it is dealt through the same funnel every
   * other spell's damage goes through, so Resistance, Temporary Hit Points,
   * the Concentration it puts at risk and the log's own dice all behave as
   * they always do.
   *
   * **A notation and not a total**, exactly as {@link ScheduledDamage.notation}
   * and {@link GrantedPayout.dice} are: a payout that repeats throws a new die
   * at each boundary, and rolling one at the cast would put the number in the
   * log before the moment that produced it. What *is* pinned is the amount at
   * the level the casting paid for — "all the damage increases by 1d6 for each
   * spell slot level above 1" is read once, at the cast, so the boundary opens
   * no catalogue.
   *
   * Absent for every repeat save in the book but one, which is every repeat
   * save this engine raised before it: a boundary that owes a save owes
   * nothing else.
   */
  readonly beforeTheSave?: {
    /** Rolled when the boundary arrives, never before. Absent when none is printed. */
    readonly dice?: string;
    /** The printed number, where the sentence prints one. */
    readonly flat?: number;
    readonly damageType: string;
  };
  /**
   * A **second** moment this save is raised at: the creature taking damage.
   *
   * SRD Hideous Laughter: "At the end of each of its turns **and each time it
   * takes damage**, it makes another Wisdom saving throw. The target has
   * Advantage on the save if the save is triggered by damage."
   *
   * **Beside {@link at} rather than instead of it**, because the book prints
   * both in one sentence and a creature struck on somebody else's turn owes
   * the save then *and* at the end of its own. What differs is the mode, which
   * is why the field carries one: the boundary's save is rolled plainly and
   * this one is not, and a flag would have left the Advantage nowhere.
   *
   * **Rolled where the blow lands rather than owed as a debt.** A turn
   * boundary owes its saves because nothing else in the world knows they are
   * due; a blow is a command with a generator in its hand, and the same funnel
   * already rolls the Concentration save a hit puts at risk. Owing it instead
   * would key on the turn — `pendingSaveKey` is `<effect>@<turn>` — so a
   * creature struck twice in one turn would owe one save, which is not what
   * "each time it takes damage" says. `repeatsRaisedByDamage` is the reader.
   *
   * Absent for every repeat save in the book but this one, which is every
   * repeat save this engine raised before it: a boundary is the only thing
   * that owes one.
   */
  readonly alsoWhenDamaged?: {
    /**
     * The mode the sentence prints, and the SRD prints one.
     *
     * A union of a single member rather than a boolean, for
     * {@link TypedSaveOutcome}'s reason on the other axis: the field says what
     * the trigger *does* to the roll, and a second word would arrive as a
     * second member rather than as a second field.
     */
    readonly mode: 'advantage';
  };
  /**
   * A fact that must hold at the boundary for the save to be owed at all —
   * see `SpellRepeatSave.onlyIf`, where the shape and its reader are argued.
   *
   * SRD Fear, the one writer: the save is made only by a creature that "ends
   * its turn in a space where it doesn't have line of sight to you". Pinned
   * onto the hook at the casting so the boundary reads the gate off the timer
   * and opens no catalogue; `raiseTurnSaves` is the one reader.
   */
  readonly onlyIf?: 'cannot-see-caster';
  /** How the roll reads in the log. */
  readonly label: string;
}

/**
 * An ability check a creature may attempt against an ongoing effect.
 *
 * The SRD writes this shape twenty times and it is **not** the repeat save
 * above it, however similar the words look. A repeat save is an *obligation*
 * the turn boundary raises whether anybody remembers it or not; this is an
 * *opportunity* somebody takes when the fiction says they did. Nothing raises
 * it, nothing owes it, and no turn is blocked waiting for it — which is
 * precisely why it needs no pending-debt machinery of its own.
 *
 * | | Repeat save | This |
 * |---|---|---|
 * | Who decides it happens | the turn boundary | the table |
 * | If forgotten | the turn refuses to advance | nothing; it was never owed |
 * | What it costs | nothing | the Action, in combat |
 *
 * **The DC is written down when the effect is created, not derived later.**
 * Same rule as {@link RepeatSave.dc}, and for a sharper reason here: the check
 * can be attempted an hour after the casting, by which time the caster may
 * have gained a level, changed which grant supplies the spell, or left the
 * game entirely. The number the spell was cast at is the number it is escaped
 * at.
 *
 * Who may attempt it is **derived from what the timer is on**, not stated: an
 * effect on a creature is that creature's to shake off, and a casting with no
 * victim — an illusion — is anybody's to see through. SRD Ensnaring Strike is
 * the one exception ("the target **or a creature within reach of it**"), and a
 * field with one user is a guess dressed as a structure; it waits for a
 * second.
 */
export interface EffectCheck {
  readonly ability: Ability;
  /** The skill applied, when the SRD names one: "Strength (Athletics)". */
  readonly skill?: Skill;
  readonly dc: number;
  /**
   * What a success does.
   *
   * `none` is the illusion case, and it is a real answer rather than a stub:
   * SRD Minor Illusion's successful Study "determines that it is an illusion"
   * and changes nothing the engine holds. The number is still the engine's —
   * the examiner's Investigation, their Expertise, their conditions, against
   * the caster's own save DC — and the knowledge is the table's.
   *
   * `end-on-target` is Black Tentacles' "ending the condition on itself on a
   * success", which is the same release the repeat save already performs.
   *
   * There is deliberately no `end-casting`: SRD writes it (Maze, Phantasmal
   * Force, Detect Thoughts) and every one of those spells is blocked on
   * something else, so it would be a value nothing could be written with.
   */
  readonly onSuccess: 'none' | 'end-on-target';
  /** How the roll reads in the log. */
  readonly label: string;
}

/**
 * What has to **happen** for a timed effect to stop before its deadline.
 *
 * The four causes that are a fact about *one creature* — they name who did it,
 * and nothing else — which is why they can be read by a timer that knows only
 * whom it sits on. SRD Potion of Invisibility prints three of them in one
 * sentence: "The effect ends early if you make an attack roll, deal damage, or
 * cast a spell."
 *
 * **Here rather than in `spell-definitions.ts`, and the import direction is
 * what decides it.** A timer is a duration's business and `timers.ts` is
 * beneath the definition vocabulary; `CastingEndCause` is this list plus the
 * one cause that needs a caster to be about ("you or one of your allies"), so
 * the definition side is expressed over this and not the other way round.
 *
 * `fold/endings.ts` reads the same facts off the same four events for both
 * readers — `EndingFact` already splits the who-shaped causes from the one
 * that names a victim and a dealer — so a condition an item confers and a
 * casting the SRD ends early are stopped by one reading of one log.
 *
 * As data as well as a type, because untyped content has to be checked against
 * the vocabulary: `checkContent` reads this, exactly as `checkSpellDefinition`
 * reads `END_TRIGGER_CAUSES`, and `item-condition.test.ts` holds the two lists
 * to their containment.
 */
export const EFFECT_END_CAUSES = [
  /** SRD: "if you make an attack roll" — `attack-made`, the Attack action. */
  'target-attacks',
  /** "... deal damage ..." — `damage-taken` naming its dealer. */
  'target-deals-damage',
  /** "... or cast a spell." A settled casting, never a declared one. */
  'target-casts',
  /** SRD Mage Armor: "ends early if the target dons armor." */
  'target-dons-armor',
] as const;

/** One of {@link EFFECT_END_CAUSES}. */
export type EffectEndCause = (typeof EFFECT_END_CAUSES)[number];

export interface TimedEffect {
  readonly target: EffectTarget;
  readonly deadline: Deadline;
  /** A save this effect takes at a turn boundary, if it takes one. */
  readonly repeatSave?: RepeatSave;
  /** A check a creature may attempt against it, if the spell offers one. */
  readonly check?: EffectCheck;
  /**
   * What ends this effect **before** its deadline, when something does.
   *
   * On a `condition` target and no other, because every cause is a fact about
   * a creature and that is the only member naming one. A casting's own early
   * endings are the casting's — they live on its `ongoing` record, where a
   * scope ("the casting" or "this target") can be written beside them — and
   * a `grants` or `feature` timer has no SRD sentence asking for one yet.
   * `endTriggeredEffects` therefore walks past anything that is not a
   * condition rather than the fold refusing it: a log cannot say this today,
   * because nothing that writes an `effect-scheduled` will put the field on
   * another target.
   */
  readonly endsEarly?: readonly EffectEndCause[];
}

/**
 * Who may attempt a check, derived from what the effect is on.
 *
 * An effect sitting on a creature is that creature's to shake off; a casting
 * with no victim — an illusion standing in a corridor — is anybody's to see
 * through. Derived rather than declared because every SRD spell the engine can
 * currently offer a check for reads this way, and a field with one exception
 * is a guess dressed as a structure.
 */
export const mayAttempt = (timer: TimedEffect, who: CharacterId): boolean =>
  timer.target.kind !== 'condition' || timer.target.on === who;

/**
 * A save a **moment** raised and nobody has rolled yet.
 *
 * Persisted in state rather than handed back in a return value, which is the
 * whole difference between this and the pending Concentration save that had to
 * be torn out: that one lived only in the caller's hands and vanished on a
 * reload. This is derived by the fold, so it survives anything the log
 * survives — and the engine refuses to advance another turn while one is
 * outstanding, so forgetting it stops the game rather than quietly losing a
 * rule.
 *
 * **Two kinds, and they differ in what a success ends rather than in how they
 * are owed.** A {@link RepeatPendingSave} is the SRD's "repeats the save at
 * the end of each of its turns": the turn boundary raises it, an effect the
 * engine is holding is what it is against, and a success ends that effect. A
 * {@link PrintedPendingSave} is a line on a stat block whose save a moment
 * forces — a Death Burst when the creature dies, an aura when somebody's turn
 * begins inside it — and nothing is being *held*, so there is nothing for a
 * success to end: what a failure costs is the line's own printed clauses,
 * landed through the same executor `forcePrintedSave` lands them through.
 *
 * Both are rolled by `resolvePendingSaves`, which is the point of the split
 * being here rather than in a second debt: **raising is derived and rolling is
 * commanded**, and a second machine for the second kind would have been a
 * second answer to what a boundary owes.
 */
interface PendingSaveCommon {
  /**
   * What this debt is filed under, which is also how it is keyed.
   *
   * A repeat save's is the timer it belongs to. A printed line's is
   * {@link printedSaveKey}, because there is no timer: what is owed is a
   * moment that has already happened.
   */
  readonly effectKey: string;
  readonly target: CharacterId;
  /**
   * What put the effect there — `Hold Person#cast:3`, or a bare `item:<id>`.
   *
   * **A source rather than a casting id**, which is the difference between
   * holding a rule and honouring it. This was `castingId`, and the boundary
   * that raised it asked `castingIdOf` for one and walked past every timer
   * that answered null: a repeat save on anything that was never cast — a
   * poison in a bottle, a source a caller supplied — was dropped without a
   * word. SRD writes "repeats the save at the end of each of its turns" on
   * plenty of things that are not spells, so the debt is about the effect and
   * not about the casting.
   *
   * `castingIdOf` still reads the casting out of one where there is a casting,
   * so `end-casting` and a casting's `end-on-target` are exactly what they
   * were. A source that answers null ends on its own timer instead —
   * {@link onSuccess} may only be `end-on-target` for one, which
   * `applyConditionTo` and `checkContent` both refuse at the door rather than
   * silently rewriting.
   */
  readonly source: string;
  readonly ability: Ability;
  readonly dc: number;
  readonly label: string;
  /** The turn it was raised on. Part of the key, so one turn raises it once. */
  readonly turn: number;
}

/** A save owed against an effect the engine is holding — SRD's "repeats the save". */
export interface RepeatPendingSave extends PendingSaveCommon {
  readonly onSuccess: 'end-on-target' | 'end-casting';
  /**
   * Absent, and declared so the union can be told apart by it.
   *
   * A `printed` debt is the other kind and carries a record here; this one
   * carries nothing, which is the whole difference a reader needs.
   */
  readonly printed?: undefined;
}

/**
 * Which line, on which creature, a printed debt is against.
 *
 * **Two strings and no numbers**, which is the rule `conditionEndedBy` already
 * keeps about a repeat save: a debt says what is *owed*, and what it is about
 * holds the answer. The DC and the dice were pinned onto the creature's sheet
 * when the block arrived, so `printedSaveOf` reads them back — and a reload a
 * week later reads exactly the same numbers, because it is the same pinned
 * sheet. A copy on the debt would be a second copy of the block.
 *
 * {@link by} may be **dead** by the time the save is rolled, which is not an
 * edge case but the ordinary one: a Death Burst is raised *because* the
 * creature died. The record stays in `creatures`, so the sheet is still there.
 */
export interface PrintedSaveDebt {
  /** Whose line it is: the creature the block belongs to. */
  readonly by: CharacterId;
  /** The printed heading — `Death Burst`, `Stench`. */
  readonly line: string;
}

/** A save a printed line's own moment forced — a death, a turn beginning in an aura. */
export interface PrintedPendingSave extends PendingSaveCommon {
  readonly printed: PrintedSaveDebt;
}

export type PendingSave = RepeatPendingSave | PrintedPendingSave;

/**
 * Damage a spell promised and a later moment collects.
 *
 * SRD Acid Arrow: "the target takes 4d4 Acid damage **and 2d4 Acid damage at
 * the end of its next turn**." Nothing about the target changes in between —
 * no condition, no bonus, nothing an effect could be hung on — so this is
 * neither a timer nor a repeat save. It is a debt with a due date.
 *
 * **The dice are a notation, not a number.** Rolling at cast time and storing
 * the total would put a number in the log before the moment that produced it,
 * and would let a player learn the second hit early. Randomness enters the log
 * once, at the point of the roll, and the roll is at the boundary.
 *
 * Deliberately *not* a {@link TimedEffect}: a timer's deadline says when
 * something **stops**, and `hasExpired` answers true for an anchor who has
 * left the fight precisely so that nothing runs forever. Reading that same
 * answer as "collect the damage" would fire the acid the instant the last
 * enemy dropped. Same deadline type, opposite policy at the edge — see
 * `isDue`.
 */
export interface ScheduledDamage {
  readonly target: CharacterId;
  /**
   * The caster who promised it.
   *
   * Acid Arrow's second hit is still the wizard's doing, arriving a turn late,
   * so it names its dealer like any other damage — and can be answered.
   */
  readonly by: CharacterId;
  /** When it falls due. Always the end of the target's next turn, so far. */
  readonly deadline: Deadline;
  /** Rolled when the moment arrives, never before. */
  readonly notation: string;
  readonly damageType: string;
  /** `Acid Arrow#cast:3` — the casting that promised it. */
  readonly source: string;
  /** How the roll reads in the log. */
  readonly label: string;
}

/**
 * The key a schedule is filed under.
 *
 * By casting and target, so two Acid Arrows at one goblin each keep their own
 * debt, and folding the same log twice produces one of each rather than two.
 */
export const scheduledDamageKey = (source: string, target: CharacterId): string =>
  `${source}|${target}`;

/**
 * What a payout at a turn boundary hands over.
 *
 * Three members, and the adjudication map's own evidence is why there are three
 * rather than one: Heroism pays Temporary Hit Points, Regenerate pays Hit
 * Points, and Phantasmal Force deals damage — all three at a turn boundary, all
 * three with no save and no area. The engine already had one route to each
 * (`grantTemporaryHpTo`, `healCreature`, `dealSpellDamage`) and no schedule to
 * reach them on, which is the gap rather than three missing mechanisms.
 *
 * Spelled out rather than borrowed from the effect kinds that share the words:
 * `temp-hp` and `heal` are *effects*, with their own scaling and their own
 * riders, and a payout reusing those names would read as one of them repeated.
 *
 * Declared here rather than in `spell-definitions.ts` because the *record* is
 * what the fold and the boundary read, and the definitions module already
 * depends on this one — the reverse edge would be a cycle that survives only
 * because a type is erased.
 */
export type PayoutKind = 'temporary-hit-points' | 'healing' | 'damage';

/**
 * What a running casting hands a creature at every one of its turn boundaries.
 *
 * SRD Heroism: "gains Temporary Hit Points equal to your spellcasting ability
 * modifier **at the start of each of its turns**." The neighbour above is the
 * shape this is most easily confused with, and the difference is the whole
 * reason it is a separate record:
 *
 * | | {@link ScheduledDamage} | This |
 * |---|---|---|
 * | How often | once, at one named moment | every turn, until the casting ends |
 * | Where it lives | `state.scheduledDamage`, keyed by casting and target | on the creature, as the eighth sourced grant |
 * | What ends it | collecting it | the casting ending, by any of its doors |
 * | What it can be | damage | damage, healing or Temporary Hit Points |
 *
 * So a debt with a due date is filed and discharged, and this is a standing
 * arrangement that is *read* at each boundary and never filed at all. That is
 * what keeps a payout out of the pending-debt machinery: nothing can be owed
 * between turns, because the arrangement is the fact and the boundary is the
 * only thing that reads it.
 *
 * **Every number here was pinned at the cast** — {@link flat} already carries
 * the caster's spellcasting modifier, resolved against the sheet they cast
 * with — for the reason `CastingNumbers` is pinned: a spell already cast does
 * not change when its caster does, and the fold opens no catalogue.
 *
 * **{@link dice} is a notation and not a total**, exactly as a scheduled hit's
 * is: a payout that repeats throws its die at each boundary, and rolling once
 * at the cast would put the number in the log before the moment that produced
 * it.
 */
export interface GrantedPayout {
  /** The casting (`Heroism#cast:3`) that promised it. */
  readonly source: string;
  /** The holder's own boundary, which is the only one anything reads. */
  readonly at: TurnMoment;
  /**
   * Who the payment lands on, where that is **not** the creature holding the
   * arrangement.
   *
   * SRD Stirge: "the target takes 5 (2d4) Necrotic damage at the start of each
   * of **the stirge's** turns." Two creatures and two roles — whose boundary
   * collects it, and who pays — and every spell that writes this sentence puts
   * them on one creature, which is why the field was not there.
   *
   * **The arrangement is held by whoever's turn it is**, and this names the
   * other end, rather than the reverse. A boundary reads the creature that is
   * starting or finishing a turn and nobody else; a payout held by its
   * *recipient* and anchored on a third party's turn would make every boundary
   * walk the whole roster to find out what it owed.
   *
   * Absent is the ordinary case: SRD Heroism's Temporary Hit Points, SRD
   * Regenerate's healing and SRD Animated Rug's bludgeoning all land on the
   * creature whose boundary collects them.
   */
  readonly to?: CharacterId;
  readonly payout: PayoutKind;
  /** Rolled when the boundary arrives, never before. Absent when none is printed. */
  readonly dice?: string;
  /** The printed number plus the spellcasting modifier, resolved at the cast. */
  readonly flat: number;
  /** Present exactly when {@link payout} is `damage`. */
  readonly damageType?: string;
}

/** One pending save can exist per effect per turn, and no more. */
export const pendingSaveKey = (effectKey: string, turn: number): string =>
  `${effectKey}@${turn}`;

/**
 * What a printed line's debt stands in place of a timer key.
 *
 * All three parts are needed and none is spare: the **creature** because two
 * Magmins exploding in one round owe two different bursts, the **line**
 * because a block may print more than one, and the **target** because a burst
 * catches everybody in its Emanation and each of them owes a save of their
 * own. `pendingSaveKey` then stamps the turn on it, so folding the same log
 * twice raises one debt apiece — the rule a repeat save already keeps.
 */
export const printedSaveKey = (by: CharacterId, line: string, target: CharacterId): string =>
  `printed|${by}|${line}|${target}`;

/**
 * The key a timer is filed under.
 *
 * Derived from the target rather than a counter, so re-applying the same
 * effect from the same source *replaces* its deadline instead of leaving a
 * stale one behind to end it early.
 */
export function timerKey(target: EffectTarget): string {
  switch (target.kind) {
    case 'condition':
      return `condition|${target.on}|${target.instance}`;
    case 'feature':
      return `feature|${target.on}|${target.feature}`;
    case 'grants':
      return `grants|${target.on}|${target.source}`;
    // The creature and nothing else: one creature holds one pool, so a second
    // grant that replaces it lands on this same key rather than beside it.
    case 'temporary-hit-points':
      return `temporary-hit-points|${target.on}`;
    default:
      return `casting|${target.castingId}`;
  }
}
