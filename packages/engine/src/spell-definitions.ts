import type { Ability, CharacterId, ConditionName, Skill } from '@ie/shared';
import {
  endOfCurrentTurn,
  endOfNextTurn,
  forSeconds,
  startOfNextTurn,
  turnAnchored,
  type Duration,
  type TurnMoment,
} from './time.js';
import { type EffectEndCause, type PayoutKind } from './timers.js';
import type { DefenseKind } from './attack.js';
import type { Bonus, BonusApplies, BonusNarrowing } from './bonuses.js';
import type { RollModifier } from './roll-modifiers.js';
import type { PassiveDefense } from './passive-defenses.js';
import type { AreaStanding, SpeedChange } from './standing.js';
import type { MovementMode } from './character.js';
import type { ActionRule, ActionSlot } from './combat.js';
import type { LightLevel, ObscurementDegree, PointAnchoring, SenseName } from './positioning.js';
import type { CastingTime } from './spells.js';
import type { SpellReactionWindow } from './reactions.js';
import type { HealingRule } from './vitals.js';
import type { Recovery } from './resources.js';

/**
 * Spells the engine can actually execute.
 *
 * `@ie/srd` parses every spell's id, level, school, class list and prose. None
 * of that says what a spell *does*: the description is English. So a spell the
 * engine resolves needs a definition here, written from the SRD text and
 * checked against it.
 *
 * The structures are the reusable part — an attack that deals scaling damage,
 * a save that imposes a condition with a repeating escape, a save that deals
 * damage with a stated outcome on a success, and healing that adds the
 * caster's own modifier. A spell that fits one of those shapes is data, not
 * design; a spell that does not is a new shape and belongs in a milestone.
 *
 * **Everything here is data the resolution reads, never a number it hardcodes.**
 * The attack modifier, save DC, damage dice, duration and repeat-save hook are
 * derived from this definition and the caster's own sheet, which is the whole
 * point of moving them out of the scenario fixtures.
 */

/** How far a spell reaches. */
export type SpellRange =
  | { readonly kind: 'self' }
  | { readonly kind: 'touch' }
  | { readonly kind: 'ranged'; readonly feet: number }
  /**
   * The book printed something here that only the DM can answer.
   *
   * SRD prints three Ranges that are not a distance at all — `Special`,
   * `Sight` and `Unlimited` — and every one of them is a question about the
   * world rather than a number: how far the caster can see, whether the target
   * is on the same plane, what "special" means for this spell. The owner's
   * ruling is that **some text is the DM's alone**, and this is the Range half
   * of it: one arm that says *ask the table*, rather than a `sight` kind that
   * would need a sense the engine does not hold or a distance the book
   * declined to print.
   *
   * It carries no payload, because the printed words are
   * {@link SpellDefinition.dmDecides}' to carry and a second copy of them here
   * would be the second place to get one sentence wrong. `checkSpellDefinition`
   * refuses a definition that claims this Range and hands nothing over, so the
   * two halves cannot come apart.
   *
   * {@link ranged} answers null for it, which is what `self` already answers:
   * **no distance is measured**, and the casting refuses nothing on grounds of
   * how far away its target is. That is the whole of the engine's opinion.
   */
  | { readonly kind: 'dm' };

/**
 * The mark every handed-over sentence carries out of a casting.
 *
 * `unverified` is one list and it now carries two different claims, so the
 * difference has to be readable rather than inferred. An `unmodelled` line is
 * a **debt**: the engine does not do this part *yet*, and one day a shape will
 * be built and the line will go. A handover is not a debt and never will be —
 * it is the book asking a question the engine has no business answering — so
 * it goes out under a mark nothing else writes, and {@link dmDecisionsIn}
 * reads it back.
 *
 * A string rather than a second field for the reason CLAUDE.md's rule 5 gives:
 * what a command reads from content is pinned into the events it emits, and
 * `unverified` is already the field a declaration writes into the log. Two
 * lists would have meant a second field on a pending casting and a second
 * member of the event union to carry it.
 */
export const DM_DECIDES = '[the DM decides]';

/**
 * One handed-over sentence, as the table will read it.
 *
 * The spell's name first, exactly as an `unmodelled` line is written, so a
 * caster holding three castings can tell which spell is asking; then the mark;
 * then the book's own words, **unaltered**. Nothing here paraphrases, and
 * nothing here guesses a number for the sentence it is handing on.
 */
export const handedOver = (spellName: string, printed: string): string =>
  `${spellName}: ${DM_DECIDES} ${printed}`;

/**
 * The printed sentences a casting handed to the table, out of what it reported.
 *
 * The other half of {@link handedOver}, so a narrating layer does not have to
 * know the shape of the line: it gets the book's words back and nothing else.
 * A line that carries no mark is somebody else's — an `unmodelled` gap, a
 * range note an attack wrote — and is left alone.
 */
export const dmDecisionsIn = (unverified: readonly string[]): readonly string[] =>
  unverified
    .filter((line) => line.includes(DM_DECIDES))
    .map((line) => line.slice(line.indexOf(DM_DECIDES) + DM_DECIDES.length).trim());

/**
 * How a spell's dice grow.
 *
 * Cantrips scale with the caster's level; levelled spells scale with the slot.
 * They are different rules and a spell uses one or the other, so they are
 * separate fields rather than one overloaded number.
 *
 * Damage and healing use the same arithmetic — Cure Wounds reads "increases by
 * 2d8 for each spell slot level above 1" in the same shape a damage spell
 * does — so this is `DiceScaling` rather than anything about damage.
 *
 * The per-slot entry is a whole notation rather than a count, because a
 * spell's upcast die is not always its base die *count*: Inflict Wounds is
 * 2d10 and grows by **1**d10, and reading the increase off the base would
 * double it.
 */
export interface DiceScaling {
  /**
   * The base roll, e.g. `1d10`.
   *
   * **Optional, because an amount need not roll anything.** SRD Potion of
   * Heroism prints "you gain 10 Temporary Hit Points", and flat numbers are
   * common throughout the magic-item text; a required notation left them with
   * nowhere to be written, because `parseNotation` refuses one that rolls no
   * dice at all. An amount with no dice issues no roll and does not move the
   * generator.
   *
   * An amount carrying neither this nor {@link flat} is nothing at all, and
   * `checkSpellDefinition` refuses it (`amounts_to_nothing`).
   */
  readonly dice?: string;
  /** A flat addend the spell prints alongside the dice: False Life's `+ 4`. */
  readonly flat?: number;
  /** A flat increase per slot level above the spell's own: False Life's `+5`. */
  readonly flatPerSlotLevelAbove?: number;
  /**
   * SRD Cantrip Upgrade: the character levels at which one more die is added.
   * Fire Bolt's are 5, 11 and 17.
   *
   * Presupposes {@link dice}: it adds a die, and the die it adds is the base
   * notation's. Refused on an amount that rolls none — `scaling_without_dice`.
   */
  readonly cantripUpgradesAt?: readonly number[];
  /**
   * Extra dice for each slot level above the spell's own.
   *
   * Presupposes {@link dice} for the same reason {@link cantripUpgradesAt}
   * does. {@link flatPerSlotLevelAbove} is the one that does not, because
   * {@link scaledFlatFor} never looks at a notation.
   */
  readonly perSlotLevelAbove?: string;
}

/**
 * How many attack rolls one `attack` effect makes, and how that number grows.
 *
 * **The same two axes {@link DiceScaling} has, and for the same reason**: a
 * cantrip's extra beams are read off the caster's level and a levelled spell's
 * extra rays off the slot, so they are separate fields rather than one
 * overloaded number. `cantripUpgradesAt` even holds the same thing it holds
 * for dice — the character levels the SRD's Cantrip Upgrade names — because
 * Eldritch Blast's "two beams at level 5, three beams at level 11, and four
 * beams at level 17" *is* a Cantrip Upgrade, spent on rolls instead of dice.
 *
 * Deliberately not `DiceScaling` with a count on it: there is no notation
 * here, nothing flat to add, and a second reading of the damage amount is
 * exactly how two beams would quietly become 2d10.
 */
export interface AttackRollCount {
  /** The rolls the spell makes at its own level: Scorching Ray's three rays. */
  readonly count: number;
  /**
   * Rolls added for each spell slot level above the spell's own.
   *
   * SRD Scorching Ray: "You create one additional ray for each spell slot
   * level above 2." Spelled as a plain number, exactly as
   * {@link TargetRule.extraPerSlotLevelAbove} is — a roll has no notation to
   * grow, so the per-slot entry has nothing to be but a count.
   */
  readonly extraPerSlotLevelAbove?: number;
  /**
   * SRD Cantrip Upgrade: the character levels at which one more roll is added.
   * Eldritch Blast's are 5, 11 and 17.
   */
  readonly cantripUpgradesAt?: readonly number[];
}

/**
 * How many extra dice a {@link DieRule} may add, **named as a derivation
 * rather than written as a number**.
 *
 * SRD: "the maximum number of these d8s you can add to the spell's damage
 * equals your spellcasting ability modifier." That is a fact about whoever is
 * casting and not about the spell, so a definition carrying a literal would be
 * a catalogue stating a number only the sheet can answer for — the same
 * mistake `addSpellcastingModifier` exists to avoid on the addend beside it.
 * The engine derives it from the numbers the casting pinned.
 *
 * One member, because the SRD writes one sentence of this shape. A cap counted
 * off a class table, or off the slot, is a second member the day something
 * prints one.
 */
export type DieRuleCap = 'spellcasting-modifier';

/**
 * What a spell says about the **individual dice** of its own damage.
 *
 * `dice.ts` has addressed dice one at a time since it was written — every
 * `DieRoll` records what it showed, what it counts as and what became of it —
 * and until this field there was no way for a catalogue to ask for any of it.
 * A spell's damage went in as a notation and came back as a total, so SRD
 * Sorcerous Burst's "If you roll an 8 on a d8 for this spell, you can roll
 * another d8" was a sentence the format could not hold.
 *
 * **The scope is the spell's own dice.** "For this spell" is the SRD's phrase
 * and it is load-bearing: a casting's damage roll may carry dice that are not
 * this spell's at all — SRD Hunter's Mark hangs a d6 on the caster that rides
 * along with every attack roll they make — and a rule about a d8 this spell
 * threw has nothing to say about a Ranger's d6. So the rule reaches the
 * component the definition's own notation rolls, and every other component of
 * the same roll is left alone. A rule about *the attack*, rather than about
 * one spell — SRD Great Weapon Fighting's "any 1 or 2 on a damage die" — is
 * `AttackOptions.damageEffects`, which is the other scope and a different
 * sentence.
 *
 * **One arm, because the SRD prints one spell sentence of this shape.** The
 * substitution and the reroll `dice.ts` also builds are a fighting style's and
 * a Metamagic's, and neither has a definition that could write one; an arm
 * here for either would be shape ahead of a writer, which is what the format's
 * own unused-member sweep exists to refuse. It is a tagged union of one so the
 * second arrives beside the first rather than instead of it.
 */
export type DieRule = {
  /**
   * SRD Sorcerous Burst: a die showing its maximum face adds another die of
   * the same size, and an added die can do it again — which is what "if you
   * roll an 8 on a d8 for this spell" means for the dice the spell added.
   */
  readonly kind: 'bonus-die-on-max';
  readonly cap: DieRuleCap;
};

/** What a spell does to a target it reaches. */
/**
 * How long a rider lasts, when it ends at a moment in the turn order.
 *
 * SRD writes this on dozens of spells and it is **not** a span of seconds —
 * see the durations section of CLAUDE.md for why folding the two together is
 * wrong. Where "the start of your next turn" falls depends on the Initiative
 * order and on whose turn the rider began, and outside combat it has no
 * meaning at all.
 *
 * **The anchor is in the value, not in a separate field**, because the SRD
 * writes two different anchors — "until the end of **your** next turn" and
 * "until the end of **its** next turn" — and they are a full round apart. A
 * bare `'end-of-next-turn'` would read as whichever one the next person
 * assumed. Only the caster-anchored pair is here: every SRD spell the engine
 * can currently execute uses it, and the target-anchored riders all need
 * machinery this does not build — Sleep wants "each creature of your choice"
 * in an area and a save that escalates on a second failure, Haste's lethargy
 * fires when the spell *ends*, and the rest are summons or Reaction riders. A
 * value nothing can be written with would be a value nothing reads.
 */
/**
 * **A third member, and it is a span rather than a moment.**
 *
 * SRD Sunburst: "has the Blinded condition **for 1 minute**", on a spell whose
 * own Duration is Instantaneous. The casting is over the moment it happens, so
 * there is no casting deadline to borrow and no turn in the order to anchor
 * to — the rider runs on the clock, alone.
 *
 * The rejected alternative was `durationSeconds: 60` on the definition, which
 * would make an Instantaneous spell an ongoing, dispellable record: a Dispel
 * Magic could then end a flash of light that finished a minute ago.
 *
 * **One consumer, transcribed rather than generalised**, in the tradition of
 * `healsCasterForHalf` and `outlivesCasting` — and it is the member that
 * keeps the two kinds of "how long" apart rather than folding a minute into
 * whichever turn boundary happened to be nearest.
 */
/**
 * **A fourth member, and it is the one that names no anchor.**
 *
 * SRD Stinking Cloud: "have the Poisoned condition **until the end of the
 * current turn**". The two caster-anchored members above cannot say it and
 * neither can a target-anchored one, because the current turn is a moment in
 * the Initiative order rather than a fact about anybody: Stinking Cloud's
 * clause fires at a *start-of-turn* boundary, so the turn it ends at is the
 * poisoned creature's own, while Superior Hunter's Defense answers damage
 * taken on somebody else's turn and ends at theirs. One member, resolved
 * against whoever is taking the turn.
 *
 * `end-of-casters-next-turn` is a full round too long for it — `ended` does
 * not count the turn in progress, so "the end of your next turn" said on your
 * own turn is two turn-endings away. That off-by-a-round is why this is a
 * member of `Duration` rather than a spelling of one that was already there.
 */
/**
 * **A fifth member, and it is the first anchored to the creature the rider is
 * on.**
 *
 * SRD Vicious Mockery: "Disadvantage on the next attack roll it makes before
 * the end of **its** next turn". The two caster-anchored members are a full
 * turn out for that sentence and `end-of-current-turn` is a different moment
 * again, so the clause had no spelling at all — on an Instantaneous cantrip,
 * where a rider with no deadline is refused outright.
 *
 * **The moment already existed**, which is why this is a spelling rather than
 * a primitive: `delayedDuration` anchors SRD Acid Arrow's later hit to "the end
 * of **its** next turn" through the same `endOfNextTurn`, and that function
 * already encodes the asymmetry that makes it right. What was missing was a
 * word a rider could say it with.
 */
/**
 * **A sixth member, and it is the word the vocabulary was one short of.**
 *
 * SRD Shocking Grasp: "it can't make Opportunity Attacks **until the start of
 * its next turn**." Every other member is a moment that sentence does not
 * mean — the start of the *caster's* next turn is a round out when the caster
 * went first, the end of the target's is one turn-ending too late, and the
 * current turn's end is the caster's own. So the clause had no spelling at
 * all, on an Instantaneous cantrip where a rider with no deadline is refused
 * outright, and the spell sat filed as a missing *mechanism* for two batches
 * while the mechanism was already built: `ActionRule`'s `forbids` takes a
 * named action away and `NAMED_ACTIONS` has listed the Opportunity Attack
 * since IE-046.
 *
 * **The moment already existed**, which is why this is a spelling rather than
 * a primitive, exactly as the member above it was: `Duration`'s
 * `start-of-next-turn` names any creature, and `turnAnchored` is the
 * constructor a printed stat-block rider's span already reaches it through in
 * `hit-riders.ts`. Resolved through that same call rather than a second
 * `startOfNextTurn` written here, because two spellings of one deadline is how
 * this engine has twice grown a second answer to one question.
 */
export type RiderDuration =
  | 'start-of-casters-next-turn'
  | 'end-of-casters-next-turn'
  | 'start-of-targets-next-turn'
  | 'end-of-targets-next-turn'
  | 'end-of-current-turn'
  | { readonly seconds: number };

/**
 * The other participant a narrowed roll modifier pins, as a definition says it.
 *
 * `RollSelector.counterpart` is a `CharacterId`, because a match needs the
 * creature and not a description of it. A definition is written once and cast
 * at whoever is standing there, so it names the **role** and the resolver binds
 * it — the rule every number on a casting follows, and the reason the fold
 * never has to know what "you" meant.
 *
 * Two members because a rider's world has two creatures in it: the caster and
 * the target it is being hung on. SRD Bestow Curse names the first
 * ("Disadvantage on attack rolls **against you**") and the Vex property names
 * the second, on a weapon rather than a spell.
 */
export type CounterpartRole = 'caster' | 'target';

/**
 * An ability check a creature may attempt against what the spell is doing.
 *
 * SRD writes this twenty times and it is **not** the repeat save it resembles.
 * A repeat save is raised by the turn boundary and owed whether anybody
 * remembers it; this is attempted because the fiction says somebody tried, and
 * no turn waits for it. Both halves of the sentence matter:
 *
 * > "A creature Restrained by the webs **can take an action** to make a
 * > Strength (Athletics) check against your spell save DC."
 * > "To discern that you are disguised, a creature **must take the Study
 * > action** to inspect your appearance and succeed on an Intelligence
 * > (Investigation) check against your spell save DC."
 *
 * The table decides *that* somebody looked; the engine owns every number after
 * that. The check runs through `rollAbilityCheck` like any other, so
 * proficiency, Expertise, the armour penalties and the roller's conditions
 * apply because that function applies them rather than because this one
 * remembered to.
 *
 * **`dc` omitted means the caster's own spell save DC**, derived from their
 * sheet and the route that supplied the spell at the moment of casting. A
 * printed number — Maze's DC 20 — is stated instead. Either way it is written
 * down when the effect is created rather than derived when the check is
 * attempted: an hour later the caster may have levelled, changed route, or
 * left the game.
 */
export interface SpellCheck {
  readonly ability: Ability;
  /** The skill the SRD names: "Intelligence (Investigation)". */
  readonly skill?: Skill;
  /** A printed DC. Omitted, the caster's own spell save DC. */
  readonly dc?: number;
  /**
   * What a success does.
   *
   * `none` is the illusion case, and it is a real answer rather than a stub:
   * the examiner now knows, and nothing the engine holds has changed. The
   * number was still the engine's — their Investigation, their Expertise,
   * their conditions, against the DC the spell was cast at.
   *
   * `end-on-target` is Black Tentacles' "ending the condition on itself on a
   * success", which is the release the repeat save already performs.
   *
   * There is deliberately no `end-casting`. SRD writes it — Maze, Phantasmal
   * Force, Detect Thoughts — and every one of those spells is blocked on
   * something else, so it would be a value nothing could be written with.
   */
  readonly onSuccess: 'none' | 'end-on-target';
}

/**
 * A saving throw an effect retakes at a turn boundary, as a definition asks
 * for one.
 *
 * `RepeatSave` in `timers.ts` is the *record* — the ability, the DC, the label
 * and whose turns it is anchored to, all of them the host's and all of them
 * pinned when the effect landed. This is the half a **definition** writes, and
 * it was spelled out twice: once inline on {@link ConditionRider.repeats} and
 * once inline on the flat `save.repeats`, two identical object literals that
 * had to be widened in step and had no name for a reader to look up. One
 * exported type, two slots.
 *
 * **The ability and the DC are deliberately not here.** SRD writes "the target
 * repeats **the** save" — the one the host already rolled — so a definition
 * naming its own would be a second place for one sentence to be got wrong.
 */
export interface SpellRepeatSave {
  /** Which boundary it fires on, on the turns of whoever it landed on. */
  readonly at: TurnMoment;
  /**
   * The ability the repeat is made with, **where the host rolled no save of
   * its own**.
   *
   * The paragraph above says the ability is deliberately absent, and it is —
   * for every host that rolls a save, because SRD writes "the target repeats
   * **the** save" and a definition naming a second one would be a second place
   * for one sentence to be got wrong. The exception is the host that rolls no
   * save at all: SRD Searing Smite hangs its repeat on a **hit**, and "then
   * makes a Constitution saving throw" is the only place that ability is
   * printed.
   *
   * So it is required exactly where the host has none to repeat and refused
   * exactly where it has — `checkEffect` keeps both halves, which is what
   * stops this becoming the second answer the paragraph above warns about.
   *
   * The DC is still nobody's to write: it is the caster's own spell save DC,
   * pinned onto the timer at the casting like every other number a casting
   * leaves behind.
   */
  readonly ability?: Ability;
  /**
   * Damage the target takes **before** the save is rolled, where the sentence
   * deals some.
   *
   * SRD Searing Smite: "the target takes 1d6 Fire damage **and then** makes a
   * Constitution saving throw." One sentence, in that order, and the order is
   * the rule: the fire is dealt whether or not the save is made, so a spell
   * that ends on a success still burns on the turn it ends.
   *
   * **Its own amount, scaled like the hit's.** "All the damage increases by
   * 1d6 for each spell slot level above 1" is one sentence about both, and
   * they are still two amounts: a spell that grew one and not the other is a
   * sentence the book could print tomorrow, and a shared field could not say
   * it. What the casting pins is this amount at the slot it was cast with, so
   * the boundary reads a notation rather than a catalogue.
   *
   * **Only on a host with no condition of its own**, which is the same fork
   * {@link ability} takes: the payout is dealt to the creature whose boundary
   * raised the save, and a condition rider's repeat is raised from the
   * condition rather than from the casting. `checkConditionRider` refuses one
   * there rather than letting a definition promise damage nothing collects.
   */
  readonly beforeTheSave?: {
    readonly damage: DiceScaling;
    readonly damageType: string;
  };
  /**
   * What a success does — see `RepeatSave.onSuccess`, which is where the
   * difference between ending the casting and ending it on one target is
   * argued and where the three doors that refuse the first are named.
   */
  readonly onSuccess: 'end-on-target' | 'end-casting';
  /**
   * What a **failure** does, where the SRD writes a failure that acts.
   *
   * SRD Sleep: "at which point it must repeat the save. If the target fails
   * the second save, the target has the Unconscious condition for the
   * duration." The Cockatrice's bite writes it too — "_First Failure:_
   * Restrained and repeats the save at the end of its next turn. _Second
   * Failure:_ Petrified" — and neither of them repeats a third time.
   *
   * So one failure does two things and they are one sentence: **the deeper
   * condition is applied under the same source, and the timer that raised the
   * save ends with it.** The first condition goes when the deeper one lands,
   * which is what "deepens" means rather than two conditions held at once; and
   * with the timer gone the boundary owes nothing further, which is what
   * "repeats the save" once rather than for ever means.
   *
   * **The condition that carries this takes no `lasts` of its own.** It runs
   * for the casting's duration and the repeat is what changes it. A `lasts`
   * landing on the same moment as {@link at} would let `expireEffects` delete
   * the timer and `dropOrphanedSaves` drop the pending save before anybody
   * rolled it, so the sentence would quietly do nothing.
   *
   * Pure data, with no field naming a spell: the deeper condition is a
   * {@link ConditionName} like any other, sourced to whatever imposed the
   * first one and released with it.
   *
   * **This is the engine's `RepeatSave.onFailure` one field short, and the
   * missing one is deliberate.** A deepening may be ended by a span or by a
   * repeat of its own; a *definition* may say only the span. Two reasons, and
   * the second is the one that would bite: no SRD spell prints a deepening
   * that repeats — the sentence that does is a stat block's, SRD Silver Dragon
   * Wyrmling's "and it repeats the save at the end of each of its turns", and
   * it reaches the same record by the printed road rather than through a
   * definition. And this object is spread **straight into** a `RepeatSave` by
   * `castOnHit` in `commands/attacks.ts`, so every field here must be
   * assignable to the engine's: a span is (both are `{ seconds }`), and a
   * nested `SpellRepeatSave` is not, because it names neither the creature nor
   * the DC a record pins. A definition that needs one is a change to that
   * spread as well as to this type.
   */
  readonly onFailure?: {
    readonly condition: ConditionName;
    /**
     * How long the deeper condition lasts, where the sentence says.
     *
     * The paragraph above is about the condition that carries the *repeat*,
     * and this is the other one: the deeper condition is applied fresh and
     * scheduled fresh, at a moment that has already arrived, so a deadline on
     * it can race nothing. SRD's own spells say nothing here — Sleep's
     * Unconscious runs "for the duration" — and the sentence a stat block
     * prints is SRD Brass Dragon Wyrmling's "the Unconscious condition **for 1
     * minute**", which reaches the same `RepeatSave.onFailure` by the printed
     * road.
     *
     * **A span on the clock**, spelled as {@link RiderDuration}'s own object
     * member and narrowed to it: the five named moments are all anchored to a
     * turn, and the turn a deepening could name is the one whose boundary
     * raised the failed save — the same moment written as an ending, which is
     * what the paragraph above refuses.
     */
    readonly lasts?: { readonly seconds: number };
  };
}

/**
 * The moment a Reaction spell is cast in answer to.
 *
 * SRD writes a Reaction's casting time as a clause — "Reaction, which you take
 * **when you are hit by an attack roll**" — and until now the engine read the
 * "Reaction" and ignored the rest. It spent the Reaction correctly and let the
 * spell be cast at a moment the rules never offered.
 *
 * **A member arrives with the machinery that makes it checkable**, never
 * before. `hit-by-attack` could be written because a held attack was already
 * in state; `damaged-by-creature` could not, until damage started naming the
 * creature that dealt it rather than only describing it in prose.
 *
 * `casting-a-spell` could be written once a casting stopped being atomic:
 * `pendingCastings` holds each one open between its declaration and its
 * effects, by casting id, and the slot the SRD spares is simply not spent
 * until it settles. Several may stand at once — and several may belong to one
 * caster — so which one this Reaction answers is a casting id the request may
 * name rather than "the" open casting. Feather Fall is the one trigger left —
 * it answers a fall, and nothing falls.
 *
 * **These are not the spells' own vocabulary any more.** `ReactionWindow` in
 * `reactions.ts` names every moment a Reaction can answer, for spells and for
 * class features alike, and this is the narrowing to the three that SRD spells
 * use. The narrowing is what keeps `triggerRefusal` exhaustive over exactly
 * what exists; the sharing is what keeps *Hellish Rebuke* and the Barbarian's
 * Retaliation from growing two readings of one rule.
 */
export type ReactionTrigger = SpellReactionWindow;

/**
 * A second, smaller hit that arrives at a later moment.
 *
 * SRD Acid Arrow: "the target takes 4d4 Acid damage **and 2d4 Acid damage at
 * the end of its next turn**." Vitriolic Sphere writes the same sentence off a
 * failed save. It is not a condition and not an ongoing effect — nothing about
 * the target changes in between — so it rides on the effect that caused it,
 * exactly as `condition` does.
 *
 * **The scaling is its own**, and that is the detail a shared field would have
 * flattened. Acid Arrow: "The damage (both initial and later) increases by 1d4
 * for each spell slot level above 2." Vitriolic Sphere: "The **initial**
 * damage increases by 2d4" — its later hit never grows. Two spells, two rules,
 * one field each.
 *
 * **The moment is not a parameter.** Both spells say "at the end of its next
 * turn", target-anchored, and nothing in the SRD this engine can execute says
 * anything else. A field with one possible value is a field nothing reads —
 * the argument `RiderDuration` already makes in the other direction.
 */
export interface DelayedDamage {
  readonly damage: DiceScaling;
  readonly damageType: string;
}

/**
 * A shove the same roll delivers: forced movement a spell causes.
 *
 * SRD Thunderwave, whole clause: "On a failed save, a creature takes 2d8
 * Thunder damage **and is pushed 10 feet away from you**." One Constitution
 * saving throw, two consequences — the argument every member of {@link
 * OutcomeRiders} makes, and the one that decides this is a rider rather than
 * an effect: a `forced-movement` effect beside the `save-damage` would roll a
 * **second** save, and a creature could then take the damage and stand still.
 *
 * **It is a leaf like the rest.** `moveCreature` with `forced: true` spends no
 * Speed, charges no Difficult Terrain, provokes no Opportunity Attack and
 * opens no window — SRD gives one only against a creature leaving your reach
 * "using its action, its Bonus Action, its Reaction, or one of its speeds",
 * and being thrown by a Thunderwave is none of those. So it rolls nothing,
 * names nobody of its own, and spends nothing, which is exactly what a rider
 * slot may contain.
 *
 * **There is no direction, and that is the finding rather than an omission.**
 * Every sentence in the book that claims this shape and is in reach says the
 * same three words: Thunderwave's "pushed 10 feet **away from you**", Gust of
 * Wind's "pushed 15 feet away from you", the Forceful Hand's shove, Open Hand
 * Technique's Push, Forceful Blow's, and every monster line that pushes. A
 * pull — SRD Thorn Whip's "pull the creature up to 10 feet closer to you" — is
 * a second member, and it arrives with the definition that writes it rather
 * than ahead of one. The push is measured **from the caster**, along the
 * bearing from them to the creature they are shoving, which is what "straight
 * away from yourself" means on this lattice; `bearingBetween` is the one
 * reader of it, shared with the Shove and the Push mastery.
 */
export interface ForcedMovement {
  /** SRD Thunderwave's "10 feet", straight away from the caster. */
  readonly feet: number;
}

/**
 * A condition a spell imposes, and everything the SRD writes about how long it
 * lasts and how a creature gets out of it.
 *
 * **One rider, four consumers.** The union spelled this three separate ways
 * before the standalone kind arrived — on `attack` ("On a hit ... and has the
 * Poisoned condition"), on `save-damage` ("takes 6d8 Radiant damage **and**
 * has the Blinded condition") and, flat, on `save`. Three near-identical
 * blocks resolved them, each with its own idea of which fields it read: an
 * escape check reached the second and the third and not the first, and
 * `outlivesCasting` reached only the third. Those were accidents of the order
 * the spells were written in rather than rules, so this is one type read by
 * one option-building helper, and every field works wherever a rider does.
 *
 * `save` keeps its **flat** spelling — `condition`, `lasts`, `check` and
 * `outlivesCasting` beside its own `ability` and `repeats` — because changing
 * it would rewrite every definition that uses it for no rules gain.
 * {@link conditionRiderOf} is the view that lets it share the type anyway, so
 * there is one vocabulary even where there are two layouts.
 */
export interface ConditionRider {
  readonly name: ConditionName;
  /** Omitted, it lasts as long as the casting does. */
  readonly lasts?: RiderDuration;
  /**
   * A check the affected creature may attempt to shake it off.
   *
   * SRD Black Tentacles: "A Restrained creature can take an action to make a
   * Strength (Athletics) check against your spell save DC, **ending the
   * condition on itself** on a success." On the condition rather than on the
   * casting, because the condition is what ends — the tentacles carry on for
   * everybody else standing in them.
   */
  readonly check?: SpellCheck;
  /**
   * The condition outlives the casting that caused it.
   *
   * **Causing a condition and owning it are two different links**, and the
   * engine had only one. Web says its Restrained lasts "while in the webs";
   * Hold Person's Paralyzed lasts "for the duration". SRD Grease says none of
   * that — it says "or have the Prone condition", full stop, and Prone ends
   * when the creature stands up.
   *
   * Set, the condition is recorded with the spell's **name** and no casting
   * mark: the log still says what caused it, the casting's cleanup does not
   * claim it, and the record does not grow to include somebody the spell is
   * not on.
   */
  readonly outlivesCasting?: true;
  /**
   * A saving throw the condition repeats at a turn boundary, if it does.
   *
   * **Moved in from `save`, and it is legal only where the host rolled a
   * saving throw.** SRD writes "the target repeats the save", so a host that
   * asked for none has none to repeat — which is exactly the argument the
   * `condition` kind's docstring already made for having no `repeats` of its
   * own, now stated once for every host instead of once per kind.
   * `checkSpellDefinition` refuses it on a rider hosted by `attack` or
   * `condition`, because the type cannot: one {@link ConditionRider} is shared
   * by all four hosts, which is the whole point of it.
   *
   * **The ability and the DC are the host's**, and are deliberately not
   * fields here: SRD Sunburst says "another Constitution saving throw" and
   * the Constitution is the one the spell already asked for. A rider naming
   * its own would be a second place for one sentence to be got wrong.
   */
  readonly repeats?: SpellRepeatSave;
}

/**
 * A grant the same roll imposes, riding an outcome its host already settled.
 *
 * SRD Phantasmal Killer: "On a failed save, the target takes 4d10 Psychic
 * damage **and has Disadvantage on ability checks and attack rolls** for the
 * duration." One Wisdom save, two consequences — and writing the second as a
 * `roll-mode` effect of its own would roll a second save for the same failure,
 * which is not the spell. Exactly the argument `plus` and {@link
 * ConditionRider} already make, on the third thing a failed save can impose.
 *
 * **This is `buff` and `roll-mode` with their own saving throw taken out**,
 * because the host made it. Nothing else changes: the payloads are the ones
 * those two branches already emit, the source is the casting, and
 * `releaseCasting` ends them through the door every other grant uses.
 *
 * **A member carries `lasts` when its own consumer asks for it.**
 * `EffectTarget`'s fourth member — `grants`, every grant one source made on one
 * creature — made a deadline on a grant expressible when IE-017 built it for
 * SRD Superior Hunter's Defense, and for a while nothing asked. SRD Ray of
 * Frost did first: "until the start of your next turn", on a cantrip, so the
 * casting is over the instant it resolves and could never take the reduction
 * back. Shocking Grasp's forbidden Opportunity Attack is the same shape, and
 * Vicious Mockery's Disadvantage the third — an Instantaneous host every time,
 * which is the only position from which the field is not a guess. `bonus`
 * still carries none, because no SRD sentence there asks: Phantasmal Killer's
 * "for the duration" fits the casting exactly.
 */
export type ModifierRider =
  | {
      readonly kind: 'bonus';
      readonly bonus: Bonus;
      readonly applies: readonly BonusApplies[];
      readonly direction: 'add' | 'subtract';
    }
  /**
   * A mode the same roll grants, and — where the sentence says so — the moment
   * it ends at and the creature it is about.
   *
   * SRD Vicious Mockery: "take 1d6 Psychic damage **and** have Disadvantage on
   * the next attack roll it makes before the end of its next turn." One save,
   * two consequences, which is the argument every member of this union makes.
   *
   * **`lasts` is here for the reason `speed-change` has it**, arriving with
   * the second spell to need it: Vicious Mockery is a cantrip and
   * Instantaneous, so its casting is over the moment it resolves and could
   * never take the Disadvantage back. The clause names a moment of its own and
   * `EffectTarget.grants` is the deadline that holds it. Guiding Bolt writes
   * the same shape from the other end of the relation.
   *
   * The paragraph above {@link ModifierRider} said `mode` carried none because
   * no SRD sentence in its position asked; two do, and both of them are the
   * one-shot clause. `bonus` still carries none.
   *
   * **`counterpart` names the other participant** — see
   * `RollSelector.counterpart` for why this is not a third `RollRelation` — as
   * a *role*, which the resolver binds to an id. No SRD spell in the
   * catalogue writes one yet; Bestow Curse's "attack rolls against you" is the
   * sentence it is for, and the Vex property writes it on a weapon.
   */
  | {
      readonly kind: 'mode';
      readonly modifier: RollModifier;
      /**
       * A deadline of the rider's own, shorter than the casting's.
       *
       * Omitted, it ends with the casting — which a definition that never
       * becomes an ongoing casting may not say, and the validator refuses.
       */
      readonly lasts?: RiderDuration;
      /** Whose roll it is about, where the sentence narrows it to one creature. */
      readonly counterpart?: CounterpartRole;
    }
  /**
   * A Speed the same roll changes.
   *
   * SRD Ray of Frost: "On a hit, it takes 1d8 Cold damage, and its Speed is
   * reduced by 10 feet until the start of your next turn." SRD Hypnotic
   * Pattern: "While Charmed, the creature has the Incapacitated condition and
   * a Speed of 0." One roll, two consequences, and writing the Speed as a
   * `speed` effect of its own would roll a second attack or a second save for
   * the same outcome — the argument every other member of this union makes.
   *
   * **It is `speed-change` and not `speed`, because a rider kind may never be
   * an effect kind.** `checkShape`'s denylist refuses a nested `kind` that is
   * an effect kind, so a name shared between the two vocabularies would let
   * recursion in through a name collision — which is why `buff`'s rider is
   * `bonus` and `roll-mode`'s is `mode`, and `spell-schema.test.ts` asserts
   * the two sets are disjoint.
   *
   * **This is the one rider that carries `lasts`**, and the reason is
   * Instantaneous hosts. Every other grant a rider hangs ends when its casting
   * does, and a cantrip's casting is over the moment it resolves — so Ray of
   * Frost's reduction would have nothing that could ever take it off.
   * `EffectTarget.grants` is the deadline IE-017 built for exactly this and
   * nothing had ever created one; `checkGrantLifetimes` is what insists on it.
   */
  | {
      readonly kind: 'speed-change';
      /**
       * Narrowed for {@link AreaStanding}'s reason: a rider says "its Speed is
       * reduced by 10 feet" and holds no mode, so it has nowhere to give a
       * Speed in. `checkSpeedChange` refuses the member at the door too, for
       * untyped input.
       */
      readonly change: Exclude<SpeedChange, 'match-walk'>;
      /** Signed feet, required by `add` and refused by the other two. */
      readonly feet?: number;
      /**
       * A deadline of the rider's own, shorter than the casting's.
       *
       * Omitted, it ends with the casting — which a definition that never
       * becomes an ongoing casting may not say, and the validator refuses.
       */
      readonly lasts?: RiderDuration;
    }
  /**
   * A rule about the target's turn that the same roll imposes.
   *
   * SRD Stinking Cloud: "have the Poisoned condition … **While Poisoned in
   * this way, the creature can't take an action or a Bonus Action.**" One
   * Constitution save, a condition and a restriction — and a second effect
   * would roll a second save for one sentence, which is the argument every
   * member of this union makes.
   *
   * **It is `action` and not `action-rule`, because a rider kind may never be
   * an effect kind.** `checkShape`'s denylist refuses a nested `kind` that is
   * an effect kind, so a name shared between the two vocabularies would let
   * recursion in through a collision — the same reason `buff`'s rider is
   * `bonus`, `roll-mode`'s is `mode` and `speed`'s is `speed-change`.
   *
   * **The second rider that carries `lasts`**, and for exactly the reason the
   * first does. SRD Shocking Grasp: "the target can't make Opportunity
   * Attacks **until the start of its next turn**" — a cantrip, Instantaneous,
   * so the casting is over the moment it resolves and nothing it hung could
   * ever be lifted. `EffectTarget.grants` is that deadline and
   * `checkGrantLifetimes` is what insists on it.
   */
  | {
      readonly kind: 'action';
      readonly rule: ActionRule;
      /** A deadline of the rider's own, shorter than the casting's. */
      readonly lasts?: RiderDuration;
    }
  /**
   * A rule about regaining hit points that the same roll imposes.
   *
   * SRD Chill Touch: "On a hit, the target takes 1d10 Necrotic damage, **and
   * it can't regain Hit Points until the end of your next turn.**" One attack
   * roll, two consequences — and a second effect would roll a second attack
   * for one sentence, which is the argument every member of this union makes.
   *
   * **It is `healing` and not `healing-rule`, because a rider kind may never
   * be an effect kind.** `checkShape`'s denylist refuses a nested `kind` that
   * is an effect kind, so a name shared between the two vocabularies would let
   * recursion in through a collision — the same reason `buff`'s rider is
   * `bonus`, `roll-mode`'s is `mode`, `speed`'s is `speed-change` and
   * `action-rule`'s is `action`.
   *
   * **The fourth rider that carries `lasts`**, and for exactly the reason the
   * first three do: its only writer is a cantrip. Chill Touch is
   * Instantaneous, so the casting is over the moment it resolves and nothing
   * it hung could ever be lifted; `EffectTarget.grants` is the deadline and
   * `checkGrantLifetimes` is what insists on it.
   */
  | {
      readonly kind: 'healing';
      readonly rule: HealingRule;
      /** A deadline of the rider's own, shorter than the casting's. */
      readonly lasts?: RiderDuration;
    }
  /**
   * A condition the target keeps and stops getting anything out of.
   *
   * SRD Starry Wisp: "On a hit, the target takes 1d8 Radiant damage, and
   * until the end of your next turn, it … **can't benefit from the Invisible
   * condition**." SRD Faerie Fire and SRD Mind Spike write the same clause
   * off a failed saving throw. Every one of the three prints it as a
   * consequence of a **settled outcome**, which is what makes it a rider: an
   * effect at the top level would fire on a miss.
   *
   * **It denies a benefit and does not end a condition**, which is a third
   * thing beside the two the engine already had — see `DeniedBenefit`, where
   * ending, refusing and denying are told apart. Writing it as
   * `end-condition` would cure the creature of something a second effect may
   * be relying on and would be undone by nothing; writing it as
   * `condition-immunity` would refuse an arrival that has already happened.
   *
   * **It is `benefit` and not `denied-benefit`, and neither name is an effect
   * kind**, which is the rule every member of this union follows: `checkShape`
   * refuses a nested `kind` that is an effect kind, so a name shared between
   * the two vocabularies would let recursion in through a collision.
   * `spell-schema.test.ts` asserts the two sets are disjoint.
   *
   * **The fifth rider that carries `lasts`**, and for the reason the other
   * four do: its only writer is a cantrip. Starry Wisp is Instantaneous, so
   * the casting is over the moment it resolves and nothing it hung could ever
   * be lifted; `EffectTarget.grants` is the deadline and
   * `checkGrantLifetimes` is what insists on it.
   */
  | {
      readonly kind: 'benefit';
      /** The condition whose benefits the outcome withholds. */
      readonly denies: ConditionName;
      /** A deadline of the rider's own, shorter than the casting's. */
      readonly lasts?: RiderDuration;
    };

/**
 * Everything a settled outcome may carry with it, in fixed named slots.
 *
 * **There are no child effects in the SRD sentences this exists for.** What
 * the book writes after "On a failed save," or "On a hit," is a *conjunction
 * of consequences sharing one roll* — one target, one DC, one casting link,
 * one lifetime — and every consequence in that position is a **leaf**: it
 * rolls no d20, names no target of its own, opens no window, and spends
 * nothing. So the restricted child vocabulary the definition format needed is
 * not a vocabulary of effects at all; it is the set of rider leaves, hosted on
 * the three kinds that produce an outcome.
 *
 * `onFail: SpellEffect[]` was rejected on evidence rather than taste: no SRD
 * consumer needs a consequence that itself rolls, and the two that look as
 * though they do — Ice Knife's explosion and Chromatic Orb's leap — are
 * different mechanisms (a second sequenced roll with an area at a target, and
 * a chained attack on a dice-face trigger). A child that rolls is a parent,
 * and recursion enters the format the moment one is allowed.
 *
 * **Named slots rather than a `riders: Rider[]` union**, because the type
 * system can then say which host may carry which rider — `plus` and `delayed`
 * on a `save` are impossible rather than validated — and because the SRD
 * writes one slot per sentence shape. The cost is one `applyRiders` with three
 * loops, which is smaller than a dispatch.
 *
 * **Which branch a rider rides is the host's, never the author's.** There is
 * no miss-branch slot and no success-branch slot: the affirmative outcome is
 * the only one that carries riders, which is why the slot name *is* the
 * branch. A spell whose success clause does something — Flesh to Stone's
 * "its Speed is 0" — is one consumer and a different shape.
 */
export interface OutcomeRiders {
  /**
   * Conditions the outcome imposes, alongside whatever else it does.
   *
   * **Plural, because the SRD writes it plural**: Hideous Laughter's "the
   * Prone and Incapacitated conditions", Hypnotic Pattern's "While Charmed,
   * the creature has the Incapacitated condition". One save, several
   * conditions, one lifetime — and a second effect would roll a second save
   * for the same failure.
   */
  readonly conditions?: readonly ConditionRider[];
  /** Grants the outcome imposes: see {@link ModifierRider}. */
  readonly modifiers?: readonly ModifierRider[];
  /** A second, smaller hit at a later moment: see {@link DelayedDamage}. */
  readonly delayed?: DelayedDamage;
  /**
   * A shove the same roll delivers: see {@link ForcedMovement}.
   *
   * **Last of the four, because it is the only one that moves the creature.**
   * A condition, a grant and a scheduled hit all leave the target where it
   * stood, so the order they land in is invisible; a push changes what every
   * later reader of the scene measures. Applied after them, the conditions a
   * failed save imposed are on the creature the wave then throws — which is
   * the order the SRD sentence itself writes.
   */
  readonly movement?: ForcedMovement;
  /**
   * A slot of the target's **own** turn the outcome uses up: see
   * {@link SpentBudget}.
   *
   * Fifth of the five, and last for the reason `movement` is fourth — the
   * conditions and grants a failure imposes are what the spend is being made
   * *under*, so SRD Slow's "it can't take Reactions" landing in the same batch
   * has to be standing before this asks whether the Reaction is available.
   */
  readonly spends?: SpentBudget;
  /**
   * Light the same roll makes its target shed.
   *
   * SRD Faerie Fire: "Each creature in the Cube is also outlined if it fails a
   * Dexterity saving throw. For the duration, objects and **affected**
   * creatures shed Dim Light in a 10-foot radius." One save, a benefit taken
   * away and a glow, and the glow is on exactly the creatures the die
   * outlined — so a `light` effect beside the save would light the ones that
   * made it too, which is the argument every member of this interface makes.
   *
   * **The same landing as the `light` effect kind**, reached from the other
   * host: `lightShedOn` writes the patches, whose region has the creature for
   * its origin so the glow walks with them, and whose source is the casting so
   * it lapses when the casting does. It is a leaf like every other rider —
   * nothing is rolled and nobody new is targeted.
   *
   * **Sixth, and last, because it changes nothing any of the other five
   * reads.** Light is a fact about the scene rather than about the creature,
   * so the order it lands in relative to a condition or a grant is invisible;
   * it goes after the shove for the reason the shove goes after the grants,
   * which is that the shove moves the creature the patch is hung on.
   *
   * It carries no `lasts` of its own, for the reason the `light` effect
   * carries none: every SRD sentence in this position runs for the spell's own
   * duration, and `checkGrantLifetimes` refuses it on an Instantaneous host.
   */
  readonly light?: LightRider;
  /**
   * The outcome takes the target's Concentration away.
   *
   * SRD Sleet Storm: "it must succeed on a Dexterity saving throw or have the
   * Prone condition **and lose Concentration**." SRD Earthquake prints the
   * same pairing, word for word about a fissure.
   *
   * **A consequence of a settled outcome, so a rider** — and it is welded to
   * the condition beside it: one failed save costs both, and a second effect
   * would roll a second saving throw for one sentence. That is the argument
   * every slot here makes, and this is the one the sentence could not be
   * written without.
   *
   * **It ends a casting that is not this one**, which no other rider does, and
   * that is what makes it a flag rather than a value: there is nothing for a
   * definition to name. Which casting is the target's own, read off the
   * creature at the moment the outcome settles, and the event is the
   * `concentration-ended` every other ending already writes — so a Bless the
   * wizard was holding goes by the door a failed Constitution save, a second
   * casting and a dispel all go through.
   *
   * **A target holding no Concentration loses nothing and the rest of the
   * failure still lands**, which is the silence {@link SpentBudget} takes for
   * "if available" and for the same reason: a rider that could refuse the
   * outcome would be a Sleet Storm that left a creature on its feet.
   *
   * `true` is the only value, as it is for every other printed-or-not clause
   * in this format.
   */
  readonly breaksConcentration?: true;
}

/**
 * A glow a settled outcome hangs on its target — see {@link
 * OutcomeRiders.light}.
 *
 * Spelled out rather than shared with the `light` effect kind's own fields,
 * for the reason `SpellRepeatSave` was pulled out of two inline literals: one
 * exported type is what keeps two slots from being widened out of step. The
 * effect kind still spells its own, because rewriting three definitions would
 * change no rule.
 */
export interface LightRider {
  readonly level: LightLevel;
  readonly radius: number;
  /** SRD "Dim Light for an additional N feet": a dim sphere N wider. */
  readonly dimBeyond?: number;
}

/**
 * Slots of the target's own turn a settled outcome spends, and what the book
 * says they went on.
 *
 * SRD Dissonant Whispers: "On a failed save, it takes 3d6 Psychic damage and
 * **must immediately use its Reaction, if available**, to move as far away
 * from you as it can, using the safest route."
 *
 * **This is the arm of `an-action-a-spell-compels-or-forbids` the owner
 * unblocked on 2026-09-22**, and it is a different verb from every member of
 * {@link ActionRule}: those three say what a spend *may* be, and this makes
 * one. The doctrine survives it because the engine charges the economy and
 * performs nothing — see `ActionRule`'s own note in `combat.ts`, where the
 * line the ruling moved and the line it left alone are set side by side.
 *
 * **"If available" is the resolver's silence, not a refusal.** A slot already
 * gone, a creature not in the fight, a rule that had already taken the slot
 * away — each of them means nothing is emitted and the rest of the casting
 * lands untouched. A spell whose rider could refuse the whole outcome would be
 * a Dissonant Whispers that dealt no damage to a target who had already
 * reacted.
 */
export interface SpentBudget {
  /**
   * Which slots go, from the three a named action is ever taken out of.
   *
   * **Never `movement`**, which is the one member of `ActionSlot` this list
   * may not hold: movement is measured in feet and spent by the foot, and a
   * spell that takes it away changes a Speed. `checkBudgetSpend` refuses it at
   * authoring rather than leaving a rider that would spend nothing.
   */
  readonly slots: readonly ActionSlot[];
  /**
   * What the book says the slot went on, pinned into the event.
   *
   * **Required, and it is the whole of what makes this honest.** The engine
   * performs nothing, so without the phrase a log would say a Reaction
   * vanished and nothing would say why — and the table narrating from the log
   * would have nothing to narrate. It is prose rather than a vocabulary
   * because it is not adjudicated: "moving as far away from you as it can,
   * using the safest route" is a sentence for a person, and every attempt to
   * make the engine mean it would be the engine playing the creature.
   */
  readonly on: string;
}

/**
 * What changes when the target is one of the creature types a spell singles
 * out, on the saving throw the host is about to make.
 *
 * SRD writes three such sentences about a save and this carries two of them:
 *
 * > Blight: "A Plant creature **automatically fails** the save."
 * > Shatter: "A Construct has **Disadvantage** on the save."
 * > Flesh to Stone: "Constructs **automatically succeed** on the save."
 *
 * **It is not a rider**, and the distinction is the same one {@link
 * OutcomeRiders} draws from the other side: a rider hangs off an outcome that
 * has already settled, and this decides *how the roll comes out*. So it is
 * read before the die rather than after it, and the slot sits on the host
 * beside `ability` rather than inside the riders.
 *
 * **An automatic failure is `autoFailed`, which the engine already means by
 * the phrase.** A Stunned creature's Strength save works this way: the die is
 * thrown and recorded — other effects can care what it showed — and the total
 * is overridden, so no bonus applied afterwards rescues it. One mechanism for
 * one SRD phrase, rather than a second one that skips the roll and would then
 * have to explain why Shatter's Construct still rolls.
 *
 * **Two outcomes, and each of the two missing ones is missing for its own
 * reason.**
 *
 * An **automatic success** is a real SRD sentence and is deliberately not
 * carried, because its only writer cannot be written down. Flesh to Stone's
 * other clauses are a rider on the *success* branch ("its Speed is 0 until the
 * start of your next turn"), a repeat save counted to three of a kind, and a
 * Petrified that outlives the count — three shapes this format does not have,
 * every one of which `CLAUDE.md` already names. So a member added for it would
 * be one no definition could use, which is exactly what the format's own
 * unused-member sweep exists to catch. It arrives with the spell.
 *
 * **Advantage** is different: nothing in the book gives a *named type*
 * Advantage on a save at all. The spells that hand a save Advantage — Charm
 * Person, Charm Monster, the three Dominates — key it on "if you or your
 * allies are fighting it", which is a declared fact about the casting rather
 * than a property of the creature, and is a task of its own.
 */
export interface TypedSaveOutcome {
  /** The creature types the SRD sentence names, from {@link CREATURE_TYPES}. */
  readonly types: readonly string[];
  readonly outcome: 'automatic-failure' | 'disadvantage';
}

/**
 * Extra damage dice against the creature types a spell singles out.
 *
 * SRD Divine Smite: "The target takes an extra 2d8 Radiant damage from the
 * attack. **The damage increases by 1d8 if the target is a Fiend or an
 * Undead.**"
 *
 * **A bare notation rather than a {@link DiceScaling}**, because the extra die
 * does not scale with anything: the *base* grows per slot level and this
 * sentence does not, and a `perSlotLevelAbove` here would be a field no SRD
 * spell writes. One consumer, transcribed from one sentence, in the tradition
 * of `onMiss` and `healsCasterForHalf`.
 *
 * The type is the host's. "An extra 2d8 **Radiant** damage ... the damage
 * increases by 1d8" is one pool of damage of one type, so the extra meets the
 * target's Radiant defences exactly as the base does, and a Critical Hit
 * doubles both.
 */
export interface TypedExtraDamage {
  /** The creature types the SRD sentence names, from {@link CREATURE_TYPES}. */
  readonly types: readonly string[];
  /** SRD Divine Smite's "1d8". */
  readonly extraDice: string;
}

export type SpellEffect =
  /**
   * A spell attack roll; damage on a hit.
   *
   * **The hit is the affirmative outcome**, so it is the hit that carries the
   * riders: Ray of Sickness' "On a hit, the target takes 2d8 Poison damage
   * **and** has the Poisoned condition" is one attack roll with two
   * consequences, and there is nothing further to roll. See
   * {@link OutcomeRiders}.
   */
  | ({
      readonly kind: 'attack';
      readonly attack: 'ranged' | 'melee';
      readonly damage: DiceScaling;
      readonly damageType: string;
      /**
       * What a **miss** still deals, when the spell says a miss deals
       * something.
       *
       * SRD Acid Arrow: "On a miss, the arrow splashes the target with acid
       * for half as much of the initial damage **only**." Absent is every
       * other attack in the book: a miss leaves the target untouched.
       *
       * **This is the host's own damage and nothing else** — the riders do
       * not ride a miss, and there is no slot in which they could. "Only" is
       * the word that says so: the later hit and the condition are the hit's,
       * and a miss owes neither. One consumer, transcribed as the mirror of
       * `onSuccess` on a saving throw rather than generalised into a second
       * outcome axis.
       */
      readonly onMiss?: 'half';
      /**
       * SRD Flame Blade: "Fire damage equal to 3d6 **plus your spellcasting
       * ability modifier**."
       *
       * The same field `heal` and `temp-hp` already carry, on the third kind
       * of effect that adds it — and it is the *chosen route's* ability, so a
       * feat's version adds its own.
       */
      readonly addSpellcastingModifier?: boolean;
      /**
       * SRD Vampiric Touch: "you regain Hit Points equal to **half the amount
       * of Necrotic damage dealt**."
       *
       * Half of what actually landed, so a resistant target heals the caster
       * for less — which is why it is computed from the damage the target
       * took rather than from the dice. One spell writes this sentence, and it
       * is transcribed rather than generalised for exactly that reason.
       */
      readonly healsCasterForHalf?: true;
      /**
       * How far the swing itself reaches, where the spell's own Range does not
       * say — SRD Vampiric Touch: "Make a melee spell attack against one
       * creature **within reach**", on a spell whose printed Range is Self.
       *
       * **Two distances, and they are about different things.**
       * {@link SpellDefinition.range} is what the *spell* reaches, and for
       * this one it is Self: the casting sits on the caster, which is what
       * Dispel Magic reads and what `spellOn` answers. The five feet belong to
       * the arm, and a Range of Self says nothing whatever about them — so the
       * targeting rules, which read the Range, checked nothing at all and the
       * initial swing could be made across a room. Every later use went
       * through `SpellActivation.range` and was measured; this is that clause
       * on the effect that makes the first one.
       *
       * Checked with the targets settled and before the slot, the action or a
       * die, so a swing out of reach costs its caster nothing. Absent is every
       * other attack in the book, where the spell's Range is the whole of the
       * distance and a second number here would be a second place to get it
       * wrong.
       */
      readonly reach?: number;
      /**
       * SRD Scorching Ray: "You hurl three fiery rays ... **Make a ranged
       * spell attack for each ray.**"
       *
       * How many attack rolls this one effect makes. Absent is one, which is
       * every other attack in the book and the shape this member had before
       * the field existed.
       *
       * **A count of rolls rather than a count of dice**, and the two are not
       * interchangeable: SRD Eldritch Blast's upgrade adds *beams*, and a beam
       * hits or misses on its own, is aimed on its own, and carries its own
       * Critical Hit. Folding two beams into one 2d10 attack would make the
       * cantrip hit or miss as a whole — a different spell, worth a different
       * amount, and wrong in both directions at once.
       *
       * **Where the rolls go is the caster's, stated by the creatures they
       * name.** SRD says it twice — "You can hurl them at one target within
       * range or at several", "you can direct the beams at the same target or
       * at different ones" — so a caster who names creatures and says nothing
       * else has the rolls dealt over them in the order they were named, one
       * each and round again for the surplus ({@link rollsDealtTo}). Naming one
       * creature sends every roll at it and naming as many creatures as there
       * are rolls sends one each, which are the two cases the sentence prints.
       *
       * **The lopsided middle the sentence leaves open is said outright**, with
       * a count beside each creature — `CastSpellRequest.rollsAt`, checked by
       * `rollsAimedAt` and pinned onto a declaration. Three rays at the goblin
       * and one at the ogre is a thing the caster decides; the deal could only
       * ever produce two and two. The engine never picks the creatures, never
       * picks the split and never picks a face.
       *
       * The count is also what bounds the target list, because a roll is what
       * a creature is named *for*: a cantrip with one beam takes one creature
       * however many the {@link TargetRule} would allow, and a second beam is
       * what buys a second creature.
       */
      readonly rolls?: AttackRollCount;
    } & OutcomeRiders)
  /**
   * A saving throw that deals damage, with what a success buys stated.
   *
   * SRD writes both outcomes and they are not the same spell: Inflict Wounds
   * gives "half as much damage on a successful one", while Sacred Flame gives
   * nothing at all on a success. Defaulting either way silently rewrites one
   * of them.
   *
   * **`onSuccess` governs the host's own damage and nothing else.** The
   * riders ride the *failure*, because that is the affirmative outcome of a
   * saving throw: SRD Vitriolic Sphere ends the sentence "half the initial
   * damage **only**", and Sunbeam's Blinded is on the failure branch of a
   * sentence the damage only half-shares. See {@link OutcomeRiders}.
   */
  | ({
      readonly kind: 'save-damage';
      readonly ability: Ability;
      readonly damage: DiceScaling;
      readonly damageType: string;
      readonly onSuccess: 'half' | 'none';
      /**
       * SRD Divine Spark: "Roll 1d8 and add your Wisdom modifier ... the
       * creature takes Necrotic or Radiant damage (your choice) equal to that
       * total."
       *
       * The field `damage`, `heal` and `temp-hp` already carry, on the fourth
       * kind of effect that adds it — and it is the *chosen source's* ability,
       * which for a feature is the ability the granting class casts with.
       *
       * On the first damage component and no other, exactly as the same field
       * on an attack's damage is: SRD adds a modifier to "one damage roll".
       */
      readonly addSpellcastingModifier?: boolean;
      /**
       * What a named creature type changes about this save: see
       * {@link TypedSaveOutcome}.
       *
       * Two consumers, and they are the two shapes the SRD prints — Blight's
       * automatic failure and Shatter's Disadvantage. Absent is every other
       * saving throw in the book.
       */
      readonly againstType?: TypedSaveOutcome;
      /**
       * Further damage of other types, under the **same** saving throw.
       *
       * Flame Strike deals "5d6 Fire damage and 5d6 Radiant damage" on one
       * Dexterity save. Writing that as two effects would roll two saves, and
       * a target could fail one and make the other, which is not the spell.
       * Each type scales on its own, because they do not always scale
       * together: Ice Storm's Bludgeoning grows per slot level and its Cold
       * does not.
       */
      readonly plus?: readonly {
        readonly damage: DiceScaling;
        readonly damageType: string;
      }[];
    } & OutcomeRiders)
  /**
   * Damage that simply lands: no attack roll to make and no saving throw to
   * avoid, dealt as a pool of separate hits among the creatures the caster
   * named.
   *
   * SRD Magic Missile: "You create three glowing darts of magical force. Each
   * dart strikes a creature of your choice that you can see within range. **A
   * dart deals 1d4 + 1 Force damage to its target.** The darts all strike
   * simultaneously, and you can direct them to hit one creature or several."
   *
   * **Each hit rolls its own dice**, which is the singular "A dart deals" and
   * the same reading {@link AttackRollCount} takes of Eldritch Blast's beams.
   * Three darts are three 1d4+1 rather than one 3d4+3, and the two are not the
   * same spell: the flat +1 is printed per dart, and a target with Resistance
   * halves three small numbers rather than one large one. Folding them would
   * be wrong in both directions at once.
   *
   * **It carries no {@link OutcomeRiders}, and the absence is the rule rather
   * than an omission.** A rider hangs on a settled *outcome* — "on a hit", "on
   * a failed save" — and there is no outcome here: the damage is the whole of
   * what happens, and the branch a rider would ride does not exist. A rider
   * slot on this kind would mean "always", which is a different mechanism
   * wearing the same field. `outcomeRidersOf`, `conditionRiderOf` and
   * `modifierRidersOf` therefore need no arm for it; their defaults are the
   * right answer rather than a missed one.
   *
   * **The count and the split are the attack's, verbatim.** `rolls` is the
   * same {@link AttackRollCount}, because "The spell creates one more dart for
   * each spell slot level above 1" is Scorching Ray's additional ray in
   * different words; where the darts go is the caster's, stated with
   * `CastSpellRequest.rollsAt` and otherwise dealt by {@link rollsDealtTo}.
   * One field name on two hosts rather than two names for one count, so
   * {@link aimedRollsIn} and `attackRollsFor` read it without asking which
   * kind they have.
   */
  | {
      readonly kind: 'auto-damage';
      readonly damage: DiceScaling;
      readonly damageType: string;
      /**
       * How many separate hits this one effect deals.
       *
       * Absent is one, which is what a definition that says nothing about a
       * count means everywhere else the field appears.
       */
      readonly rolls?: AttackRollCount;
    }
  /**
   * Temporary Hit Points.
   *
   * Not healing, and the engine already knew the difference: they sit beside
   * hit points rather than in them, they do not stack, and a Long Rest clears
   * them. `grantTemporaryHpTo` has existed since vitals landed; this is the
   * effect type that finally reaches it.
   */
  | {
      readonly kind: 'temp-hp';
      readonly amount: DiceScaling;
      readonly addSpellcastingModifier: boolean;
    }
  /**
   * A named bonus that later rolls read.
   *
   * Bless and Bane are one mechanism with a sign — "adds 1d4 to the attack
   * roll or save" against "must subtract 1d4" — so they share an effect type
   * and differ by `direction`, the same argument that gave
   * `interveneAfterRoll` a direction rather than two functions.
   *
   * `ability` present means the target saves first and is only affected on a
   * failure, which is the other difference between the two: Bless asks nobody.
   */
  | {
      readonly kind: 'buff';
      readonly ability?: Ability;
      readonly bonus: Bonus;
      readonly applies: readonly BonusApplies[];
      readonly direction: 'add' | 'subtract';
      /**
       * Which of those rolls it reaches — see {@link BonusNarrowing}.
       *
       * SRD Pass without Trace bonuses "Dexterity (Stealth) checks" and
       * Guidance "any ability check using the chosen skill", where Bless
       * bonuses every attack roll there is. Absent is the second kind of
       * sentence, which is most of them.
       */
      readonly only?: BonusNarrowing;
    }
  /**
   * Advantage or Disadvantage on a kind of roll, for as long as the spell runs.
   *
   * The other half of what `buff` does, and **not** a `buff` with a flag on
   * it. A bonus is arithmetic that adds and stacks; a mode is presence that
   * cancels, so three sources of Advantage against one Disadvantage is a
   * normal roll and no amount of arithmetic says that. And a bonus is always
   * the holder's own, where a mode may belong to rolls made **against** them:
   * Blur is on the wizard and changes the goblin's attack roll, which
   * `BonusApplies` has no axis to express.
   *
   * What the modifier reaches is {@link RollModifier} — the same selector a
   * class feature's grant uses, matched by the same predicate, so Dodge and
   * Blur are one mechanic with two lifetimes rather than two mechanisms that
   * could disagree.
   */
  | {
      readonly kind: 'roll-mode';
      /**
       * **There is deliberately no saving throw here.**
       *
       * There was one — `save`, Bane's shape moved across from `buff` — and
       * it had zero users in the catalogue from the day it was written: Blur
       * and Beacon of Hope are the only `roll-mode` effects and neither spell
       * asks anybody to resist. It is what a speculative branch field looks
       * like, and the rider vocabulary made it redundant rather than merely
       * unused: a `modifiers` rider on a `save` host is the same sentence with
       * the roll *shared* instead of repeated, which is the shape the SRD
       * actually writes.
       *
       * `buff.ability` stays, because Bane uses it. Folding Bane into a
       * `save` plus a rider would need `save` to permit no condition at all,
       * which is a change with no rules gain.
       */
      readonly modifier: RollModifier;
    }
  /**
   * A defence that answers somebody else's attack, with nobody taking a
   * Reaction.
   *
   * Owner's ruling, 2026-09-22. SRD Mirror Image, Fire Shield and Sanctuary
   * all reach into an attack that another creature is making — and none of
   * them is a Reaction, which is the reading that kept this shape unbuilt:
   * `hit-by-attack` is a window somebody *steps into*, and every one of these
   * fires whether the defender is watching or asleep.
   *
   * It is also not a `roll-mode`. A mode changes a number on the d20; a
   * duplicate takes a blow that already hit, a shield burns the creature that
   * landed one, and a ward stops the roll being made at all.
   *
   * See `passive-defenses.ts`, where the three shapes are told apart and the
   * reason there are three rather than one is written down.
   */
  | {
      readonly kind: 'passive-defense';
      readonly defense: PassiveDefense;
      /**
       * The damage a retaliation deals, where it deals any.
       *
       * At the top of the effect rather than inside {@link defense} so that
       * {@link statedDamageType} rewrites it: SRD Fire Shield's type is the
       * caster's choice, and the substitution that carries a choice into an
       * effect looks for this field and this name. What the flames actually
       * deal may be the *other* member of a printed pair — see
       * `PassiveRetaliation.complementOf` — and that inversion is applied
       * after this field has been filled in, never instead of it.
       *
       * Absent on a ward and on a set of decoys, neither of which deals any.
       */
      readonly damageType?: string;
    }
  /**
   * Hit points restored, with the caster's spellcasting modifier where the
   * spell adds it.
   *
   * "2d8 plus your spellcasting ability modifier" is the common shape, and the
   * modifier is *not* universal — Prayer of Healing and Mass Cure Wounds do
   * not add it — so whether it applies is stated rather than assumed.
   */
  | {
      readonly kind: 'heal';
      readonly healing: DiceScaling;
      readonly addSpellcastingModifier: boolean;
    }
  /**
   * Something handed over at every one of the target's turn boundaries, for as
   * long as the casting runs.
   *
   * SRD Heroism: "Until the spell ends, the creature is immune to the Frightened
   * condition and **gains Temporary Hit Points equal to your spellcasting
   * ability modifier at the start of each of its turns**."
   *
   * **Not an area trigger, and that is the whole reason this kind exists.**
   * {@link AreaTrigger} is what a *place* does to whoever is standing in it,
   * and every clause it carries is answered by asking where a creature is.
   * This asks nobody anything: there is no save to raise, no geometry to be
   * inside of, and the recipient was chosen once, at the cast. What the two
   * share is the vocabulary for *when* — see {@link at}, which is the same
   * start-or-end the areas have distinguished since durations landed, because
   * where the two moments fall is a full round apart.
   *
   * **The recipient's own turn, never the caster's.** "each of **its** turns"
   * is what the SRD writes here, and a payout on the caster's turn is a
   * different sentence that no spell in the book prints on this shape.
   *
   * **A grant, so it ends through the doors every grant ends through.** The
   * casting is in the source, so a dispel, a broken Concentration, the deadline
   * and the caster leaving all take it away — see `GrantedPayout`.
   */
  | {
      readonly kind: 'turn-payout';
      /**
       * SRD "at the start of each of its turns" / "at the end of each of its
       * turns", in {@link AreaTrigger.at}'s own two words.
       */
      readonly at: TurnMoment;
      /** Which of the three the boundary hands over. */
      readonly payout: PayoutKind;
      /**
       * A notation the spell prints, rolled **at each boundary** rather than
       * once at the cast: a payout that repeats is a die thrown every time.
       *
       * Absent where the spell prints none, which is Heroism — and absent is
       * why this is a bare notation rather than a {@link DiceScaling}. Nothing
       * in the book scales a per-turn payout by the slot it was cast at; the
       * upcast sentences on this shape buy more *targets*, which
       * `TargetRule.extraPerSlotLevelAbove` already says.
       */
      readonly dice?: string;
      /** A printed number: Regenerate's "regains 1 Hit Point". */
      readonly flat?: number;
      /**
       * SRD Heroism: "equal to your **spellcasting ability modifier**".
       *
       * The same field `heal`, `temp-hp` and `attack` already carry, and the
       * modifier is the *chosen route's* — resolved at the cast and pinned, so
       * a bard who levels mid-minute pays what they promised.
       */
      readonly addSpellcastingModifier?: boolean;
      /** Required when {@link payout} is `damage`, and refused otherwise. */
      readonly damageType?: string;
    }
  /**
   * A rule the spell stands in front of healing with.
   *
   * SRD Beacon of Hope: each target "regains the **maximum** number of Hit
   * Points possible from any healing." SRD Chill Touch, on a hit: "it **can't
   * regain Hit Points** until the end of your next turn."
   *
   * **Not an amount, which is the whole reason this is its own kind.** `heal`
   * restores a number; this restores nothing and heals nobody. It is an
   * instruction to somebody *else's* healing, whenever it arrives — a Cure
   * Wounds a round later, a potion, a pool's use — so it is a grant that sits
   * on the creature and is read by the door healing goes through, exactly as
   * `roll-mode` is read by the door a d20 goes through.
   *
   * **One kind for two sentences**, because they are one question with two
   * answers: whether the arithmetic runs as printed. See `HealingRule` in
   * `vitals.ts`, where the pair is argued and where a creature carrying both
   * is settled.
   *
   * The standalone kind carries no deadline of its own, for the reason
   * `speed`, `attack-rider`, `condition-immunity` and `turn-payout` carry
   * none: every SRD sentence in this position runs for the spell's own
   * duration. Chill Touch's shorter one is a **rider**, which is where a
   * deadline lives — see {@link ModifierRider}'s `healing` member, and SRD Ray
   * of Frost, which made the same argument first.
   */
  | {
      readonly kind: 'healing-rule';
      readonly rule: HealingRule;
    }
  /**
   * A hit point maximum the spell holds up while it runs.
   *
   * SRD Aid: "Each target's Hit Point maximum **and current Hit Points**
   * increase by 5 for the duration." _Using a Higher-Level Spell Slot:_ "Each
   * target's Hit Points increase by 5 for each spell slot level above 2."
   *
   * **The one number a spell moves that the fold stores rather than derives.**
   * Everything else a casting hangs on a creature is consulted where it
   * matters and costs nothing when it goes; a maximum is read by the cap on
   * healing, by Massive Damage and by advancement's own arithmetic, and it is
   * already written down. So this grant is *reconciled* rather than merely
   * carried — `settleHitPointMaximum` runs in the fold's derived pass — which
   * is what lets a broken Concentration, a deadline and Dispel Magic give it
   * back through the doors they already use, and what keeps a level-up taken
   * mid-spell worth the whole of its level.
   *
   * **It raises and does not lower**, and the absence is deliberate rather
   * than an oversight. The SRD's reductions are all fastened to damage that
   * has already been taken — Harm's, and the one a Berserker Axe exacts — so
   * the sentence that lowers a maximum is never the whole of the rule, and the
   * half that is missing is the other half. One consumer, transcribed, in the
   * tradition of `healsCasterForHalf` and `onMiss`; the day a reduction is
   * written it arrives with the clause that makes it mean something.
   *
   * **A {@link DiceScaling} with no dice**, which is the shape `flat` and
   * `flatPerSlotLevelAbove` were widened for: Aid's five and its five per slot
   * level are exactly that pair, and the notation stays available for a
   * sentence that rolls one. The number is settled **once, at the cast**, and
   * pinned into the grant, so a maximum held up for eight hours does not move
   * when a catalogue does.
   */
  | {
      readonly kind: 'hit-point-maximum';
      readonly amount: DiceScaling;
    }
  /**
   * Extra damage on a weapon attack that has already hit.
   *
   * SRD 2024 Divine Smite, whose casting time is "Bonus Action, which you take
   * immediately after hitting a target with a Melee weapon or an Unarmed
   * Strike". It has no target of its own and rolls nothing against anybody:
   * the damage joins the attack's, which is what "from the attack" means and
   * why a critical doubles it.
   *
   * A spell with this effect is cast through `resolveAttackDamage` rather than
   * `resolveSpell`, because the attack is the thing it needs and `resolveSpell`
   * has no attack to hand it.
   */
  | {
      readonly kind: 'attack-damage';
      readonly damage: DiceScaling;
      readonly damageType: string;
      /**
       * Extra dice against a named creature type: see
       * {@link TypedExtraDamage}.
       *
       * The one host that varies its **damage** by the target's type rather
       * than its roll, because `attack-damage` is the one kind that rolls no
       * d20 of its own — the attack it joins has already hit.
       */
      readonly againstType?: TypedExtraDamage;
      /**
       * A save the **casting** retakes at a turn boundary, for as long as it
       * runs.
       *
       * SRD Searing Smite: "At the start of each of its turns until the spell
       * ends, the target takes 1d6 Fire damage and then makes a Constitution
       * saving throw. On a failed save, the spell continues. On a successful
       * save, the spell ends."
       *
       * **Hosted by the casting rather than by a condition**, which is what
       * makes this the one place a `repeats` sits directly on an effect. Every
       * other repeat in the book is filed on the condition instance a failed
       * save created, and this spell imposes no condition at all: what the
       * boundary is asking about is whether the *spell* is still burning, so
       * the hook rides on the casting's own timer and a success ends the
       * casting. `onSuccess: 'end-on-target'` would have nothing to release,
       * and `onFailure` would have no condition to deepen; the validator
       * refuses both here rather than letting a definition promise either.
       *
       * **It presupposes a duration**, for the reason a grant does: the timer
       * that carries the hook is the casting's own deadline, and an
       * Instantaneous casting has none — so the repeat would be raised by
       * nothing, for ever.
       */
      readonly repeats?: SpellRepeatSave;
    }
  /**
   * A condition the spell simply imposes, with **no saving throw**.
   *
   * SRD Greater Invisibility, whole: "A creature you touch has the Invisible
   * condition until the spell ends." There is nothing to roll, so nothing is
   * rolled — no die, no `roll-recorded`, and the generator does not move.
   *
   * **This is the `save` shape minus the roll**, which is why it carries the
   * same {@link ConditionRider} rather than a vocabulary of its own: the
   * condition is applied to every resolved target with the casting link, for
   * the casting's duration unless `lasts` says otherwise, and `check` and
   * `outlivesCasting` mean exactly what they mean there.
   *
   * **There is deliberately no `repeats`.** A repeat save is the SRD's "the
   * target repeats the save", and a spell that offered no save in the first
   * place has none to repeat — no candidate spell writes the sentence, and a
   * field with no user is a guess. `check` is the escape a spell of this shape
   * *does* sometimes offer, and it is already here.
   */
  | {
      readonly kind: 'condition';
      readonly condition: ConditionRider;
    }
  /**
   * Conditions the spell **takes away**.
   *
   * SRD Protection from Poison, first sentence: "You touch a creature and end
   * the Poisoned condition on it." SRD Lesser Restoration, whole: "You touch a
   * creature and end one condition on it: Blinded, Deafened, Paralyzed, or
   * Poisoned."
   *
   * **It names the condition and never a cause of it.** The arithmetic beneath
   * is `endConditionsOn`, which `useHealingTouch` already reached for Lay On
   * Hands, so a creature poisoned twice over is fully cured — by the same three
   * lines rather than by a second implementation that has to remember the same
   * sentence.
   *
   * **A list, because the SRD writes it plural** — Heal ends "the Blinded,
   * Deafened, and Poisoned conditions" in one sentence, and a spell that ends
   * one names a list of one. There is deliberately nothing here for a
   * *lifetime*: a removal grants nothing and leaves nothing standing, so
   * `grant_without_lifetime` has nothing to say about it — the same silence it
   * keeps for `heal` and `temp-hp`, and for the same reason.
   *
   * **Not the inverse of `condition`**, and folding the two together with a
   * sign would be wrong twice over: a condition imposed carries a rider — a
   * deadline, an escape check, a repeat save, a casting link — and every one of
   * those is a fact about something that is still running. A removal has no
   * duration to give, nothing to escape from, and nothing for the casting to
   * own. So it carries no {@link ConditionRider} and cannot host one, which is
   * what keeps it a leaf.
   *
   * **`Lesser Restoration`'s "one" is not executed** — the engine ends every
   * condition it names that the creature has, because a choice made at the
   * casting is a named missing shape rather than a field, and the definition's
   * own clause says so. See `spell-honesty.test.ts`.
   */
  | {
      readonly kind: 'end-condition';
      /** The conditions the SRD names, in the order it prints them. */
      readonly conditions: readonly ConditionName[];
    }
  /**
   * A saving throw, and what its failure imposes.
   *
   * **The one host that keeps its flat spelling.** `condition`, `lasts`,
   * `check`, `outlivesCasting` and `repeats` sit directly on the effect rather
   * than inside a {@link ConditionRider}, because rewriting the twenty-odd
   * definitions that use them would change no rule. {@link conditionRiderOf}
   * is the view that folds the flat fields into the shared vocabulary, so
   * there is one rider type even where there are two layouts — and
   * {@link OutcomeRiders.conditions} is reached through it: the flat fields
   * are the **first** rider, and {@link save.conditions} carries the rest.
   */
  | {
      readonly kind: 'save';
      readonly ability: Ability;
      /**
       * SRD: "It does so with Advantage if you or your allies are fighting it."
       *
       * Five spells print the sentence — Charm Person, Charm Monster and the
       * three Dominates — and the fact it turns on is one the engine does not
       * hold and cannot derive. `side` is not it: a bandit may be an enemy
       * nobody has come to blows with, a Charmed ally may be fought and still
       * be on the party's side, and allegiance may simply be undeclared. So
       * the casting **states** it and this records that the spell asks —
       * exactly the split {@link SpellDefinition.damageTypeStated} already
       * makes, where the definition prints the question and the request
       * answers it.
       *
       * It reaches the roll as a named `ModeSource` rather than as a number,
       * because Advantage cancels rather than stacks: a fought target who is
       * also Restrained rolls a normal save, and only a mode can say that.
       *
       * **One outcome, because the book prints one here.** SRD Enthrall keys
       * the same fact to an automatic *success* — "Any creature you or your
       * companions are fighting automatically succeeds on this save" — and
       * that is a second member with no definition able to write it:
       * `checks.ts` carries `autoFail` and no `autoSucceed`, and Enthrall is
       * blocked besides on a penalty narrowed to Wisdom (Perception) checks
       * and to Passive Perception, which `BonusApplies` cannot name. A member
       * arrives with its primitive and with the spell that writes it.
       */
      readonly advantageIfFought?: true;
      /**
       * A defence the target already has that makes the save for it.
       *
       * SRD Sleep: "Creatures that don't sleep, such as elves, or **that have
       * Immunity to the Exhaustion condition** automatically succeed on saves
       * against this spell."
       *
       * **`autoFail`'s mirror, read off the creature rather than stated.**
       * {@link TypedSaveOutcome} is the neighbour and is a different question:
       * that reads what the creature *is* — a Plant, a Construct — and this
       * reads what it already **has**, a defence something granted it or its
       * stat block printed. `conditionImmunitiesOf` is the one reader of that,
       * so a Zombie's printed Immunity and a Mind Blank's granted one answer
       * alike, and a creature that is somehow immune for six seconds is immune
       * for those six seconds.
       *
       * **One condition, because the sentence names one.** A list would have
       * to decide whether it meant any or all, and no SRD sentence of this
       * shape names two.
       *
       * **Only half of Sleep's sentence, and the half that is left is not a
       * missing field.** "Creatures that don't sleep, such as elves" is not a
       * fact this engine holds about anybody: the SRD prints it of no creature
       * type — the type list in the monster rules says nothing about sleeping
       * — and the 2024 Elf states it in a species sentence, Trance's "You
       * don't need to sleep, and magic can't put you to sleep", that no
       * `FeatureGrant` member carries. So the definition writes this half and
       * hands the table the other.
       */
      readonly autoSucceedIf?: {
        /** SRD Sleep's "Immunity to the Exhaustion condition". */
        readonly immuneTo: ConditionName;
      };
      /**
       * Write the verdict onto the casting, because the sentence says somebody
       * knows it.
       *
       * SRD Zone of Truth: "On a failed save, a creature can't speak a
       * deliberate lie while in the radius. **You know whether a creature
       * succeeds or fails on this save.**" Not being able to speak a
       * deliberate lie is not a condition, is not a grant, and is not any
       * other state this engine holds — the engine has no speech — so the
       * failure imposes nothing at all and the second sentence is the whole
       * of what the spell does that the rules can see.
       *
       * **This is the third thing a save may do**, beside imposing a
       * condition and hanging a rider, and it is what lifts
       * `save_imposes_nothing` for a definition that does neither. The gate
       * that ruled it put the condition plainly: the engine may hold a fact
       * only the table reads **when the fact is the recorded outcome of a
       * roll the engine made and a door publishes it**. Both halves are
       * load-bearing. A flag a definition set for its own reasons would be
       * the engine keeping a secret; this is a die `rolls.ts` stamped, filed
       * against the casting that threw it, and reported by `observe()`.
       *
       * **The record is the casting's and not the creature's.** A creature
       * that walks out of the Sphere and back in is asked again, and two
       * Zones over one room are two questions about one creature — so the
       * answer hangs on `OngoingSpell.saves`, keyed by who, replaced when the
       * same casting asks again. `casting-save-recorded` is the event; there
       * is no derived pass, because nobody decides this and the roll already
       * happened.
       *
       * **A casting and nothing else.** An item or a feature that confers an
       * effect list has no casting id to file a verdict against, so
       * `checkContent` refuses the field on both hosts — the same answer it
       * gives every other field on this effect that needs one.
       */
      readonly recordsOutcome?: true;
      /**
       * The condition the failure imposes, where it imposes one.
       *
       * **Optional, and the docstring it replaces said exactly why it could
       * not be.** "A `save` effect with no condition to impose would be a die
       * thrown for nothing" was true while a failure could carry nothing
       * *but* a condition. {@link ModifierRider} ended that, and the book
       * prints the consequence: SRD Slow's "An affected target's Speed is
       * halved, it takes a −2 penalty to AC ... and it can't take Reactions"
       * and SRD Faerie Fire's outlining are one saving throw whose failure
       * hands out **grants and nothing else**. {@link save.modifiers} has
       * documented Slow by name since it was written, in the field that could
       * not host it.
       *
       * Written as separate effects instead, a halved Speed and a penalty
       * would land on every target whether it saved or not — the confident
       * wrong answer rather than the missing one — and a second `save` effect
       * would roll a second saving throw for one sentence, which is the
       * argument every rider on this host already makes.
       *
       * **What the old requirement was standing in for is still enforced,
       * one field along**: `checkSpellDefinition` refuses a `save` that
       * imposes no condition, hangs no rider *and* records no outcome
       * (`save_imposes_nothing`), because that really is a die thrown for
       * nothing. {@link save.recordsOutcome} is the third of those three and
       * is what SRD Zone of Truth was waiting on.
       *
       * **{@link save.repeats} goes with it.** A repeat is filed on the
       * condition instance the failure created, so a failure that created
       * none has nothing to hang one on; `repeat_without_condition` refuses
       * the pair, which is why Slow's "repeats the save at the end of each of
       * its turns" is the one clause of that spell still unwritten.
       */
      readonly condition?: ConditionName;
      /**
       * Further conditions the **same** failed save imposes.
       *
       * SRD Hideous Laughter: "it has the **Prone and Incapacitated**
       * conditions for the duration." Hypnotic Pattern: "or have the Charmed
       * condition for the duration. **While Charmed, the creature has the
       * Incapacitated condition.**" One save, several conditions — and a
       * second `save` effect would roll a second saving throw, so a creature
       * could fail one and make the other, which is not the spell.
       *
       * **The flat fields above are the first rider and these are the rest**,
       * rather than a second spelling of the same one. That keeps every
       * existing definition meaning exactly what it meant while letting the
       * plural sentence be written; `conditionRiderOf` hands back the whole
       * list, so nothing downstream knows there were two layouts.
       *
       * The flat {@link save.repeats} belongs to the saving throw rather than
       * to any one condition, which is why it stays flat: SRD writes "the
       * target repeats the save", once, whatever the failure imposed.
       *
       * **The rest of what, is a question with an answer**, so this needs
       * {@link save.condition} beside it: a list with the flat slot left
       * empty would be a second spelling of "one condition", and one
       * vocabulary with two layouts is exactly what `conditionRiderOf` exists
       * to stop becoming two. `further_conditions_without_a_first` refuses
       * it.
       */
      readonly conditions?: readonly ConditionRider[];
      /**
       * Grants the same failed save imposes: see {@link ModifierRider}.
       *
       * SRD Slow: "the target ... takes a −2 penalty to AC and Dexterity
       * saving throws" — one Wisdom save, a condition-less penalty beside it.
       * The host made the roll; the rider is the arithmetic.
       */
      readonly modifiers?: readonly ModifierRider[];
      /**
       * Light the same failed save makes its target shed: see
       * {@link OutcomeRiders.light}.
       *
       * Spelled flat for the reason `condition` and `modifiers` are — this
       * host keeps its own layout — and read through {@link outcomeRidersOf},
       * so `applyRiders` never learns which host it is serving. SRD Faerie
       * Fire is the one writer, and it is the third of the three hosts to
       * carry the slot rather than a fourth spelling of it.
       */
      readonly light?: LightRider;
      /**
       * The same failed save takes the target's Concentration: see
       * {@link OutcomeRiders.breaksConcentration}.
       *
       * Flat for the reason the slot above it is, and SRD Sleet Storm is the
       * writer: "or have the Prone condition **and lose Concentration**".
       */
      readonly breaksConcentration?: true;
      /**
       * A saving throw the condition repeats at a turn boundary, if it does.
       * Feeds straight into the turn-hook machinery.
       */
      readonly repeats?: SpellRepeatSave;
      /**
       * When this condition ends, if it ends before the casting does.
       *
       * Omitted, the condition lasts as long as the casting — which is every
       * spell the engine executed before this existed, because the casting's
       * own deadline was the only one there was. Two SRD shapes need their
       * own: a rider on an **Instantaneous** spell, which has no casting
       * deadline to borrow (Color Spray), and a rider **shorter** than the
       * spell that made it (Sunbeam).
       */
      readonly lasts?: RiderDuration;
      /**
       * A check the affected creature may attempt to shake it off.
       *
       * SRD Web: "A creature Restrained by the webs can take an action to make
       * a Strength (Athletics) check against your spell save DC." The same
       * sentence Black Tentacles writes, on the effect kind that has no damage
       * beside it — which is the only reason it was not here already.
       */
      readonly check?: SpellCheck;
      /**
       * The condition outlives the casting that caused it.
       *
       * **Causing a condition and owning it are two different links**, and the
       * engine had only one. Web says its Restrained lasts "while in the webs";
       * Hold Person's Paralyzed lasts "for the duration"; Black Tentacles'
       * Restrained "until the spell ends". SRD Grease says none of that — it
       * says "or have the Prone condition", full stop, and Prone ends when the
       * creature stands up.
       *
       * So a casting that ends took Grease's Prone away with it, and a Dispel
       * Magic aimed at the greased creature stood them up. Set here, the
       * condition is recorded with the spell's **name** and no casting mark:
       * the log still says what caused it, the casting's cleanup does not
       * claim it, and the record does not grow to include somebody the spell is not
       * on.
       *
       * One user, and it is transcribed from one sentence rather than
       * generalised — but it is the sentence that distinguishes a spell that
       * *does* something from a spell that *keeps* doing it.
       */
      readonly outlivesCasting?: true;
    }
  /**
   * A saving throw that interrupts a casting already in progress.
   *
   * SRD Counterspell: "You attempt to interrupt a creature in the process of
   * casting a spell. The creature makes a Constitution saving throw. On a
   * failed save, the spell dissipates with no effect."
   *
   * The ability is data rather than hardcoded, but nothing else about this is
   * negotiable: **the save is made by the creature being countered**, against
   * the counterspeller's own spell save DC, and a success means the spell
   * simply proceeds. The SRD states no consequence for a success at all, which
   * is why there is no `onSuccess` here to state one — Sacred Flame and
   * Inflict Wounds needed that field because their texts differ, and these do
   * not.
   */
  /**
   * End the ongoing spells on a target.
   *
   * SRD Dispel Magic, whole: "Any ongoing spell of level 3 or lower on the
   * target ends. For each ongoing spell of level 4 or higher on the target,
   * make an ability check using your spellcasting ability (DC 10 plus that
   * spell's level). On a successful check, the spell ends." — and *Using a
   * Higher-Level Spell Slot*: "You automatically end a spell on the target if
   * the spell's level is equal to or less than the level of the spell slot you
   * use."
   *
   * **The effect carries no numbers at all**, and that is the point. The
   * threshold is the level this casting was made at; the DC is ten plus the
   * level of whatever is being ended; the ability is the caster's own
   * spellcasting ability by the route that supplied the spell. Every one of
   * those is a fact the engine holds, and a definition that restated any of
   * them would be a second place to get Dispel Magic wrong.
   */
  | { readonly kind: 'dispel' }
  /**
   * A **base** Armour Class the spell supplies, in place of the one the target
   * would otherwise calculate.
   *
   * SRD Mage Armor: "the target's **base AC becomes 13 plus its Dexterity
   * modifier**." That is not a bonus and modelling it as one is wrong twice
   * over, silently:
   *
   * - it would stack on a Barbarian's Unarmoured Defense, and SRD
   *   Multiclassing says "If you have multiple ways to calculate your Armor
   *   Class, you can benefit from only one at a time";
   * - it would stack on worn armour, which the spell's own sentence forbids.
   *
   * A flat `+3` is arithmetically identical for an ordinary unarmoured
   * creature, which is exactly why it is the tempting answer and exactly why
   * it is the dangerous one.
   *
   * **It is the shape Unarmoured Defense already is** — an alternative base
   * calculation competing with `10 + Dexterity`, the best applicable one
   * winning — so `armorClassCalculation` runs the same comparison over both
   * rather than growing a second mechanism. Two concrete mechanics asking for
   * one primitive is the evidence the generalization rule wants.
   *
   * The SRD's "while not wearing armour" needs no field: the comparison lives
   * in the unarmoured branch, so a grant is simply inert while armour is worn.
   * What a spell *does* need to say is that it may not be **cast** on an
   * armoured creature, and that is {@link TargetRule.mustBeUnarmored}.
   *
   * **Barkskin is the second arm below**, and it stayed out of this one for
   * as long as it did because it is genuinely a different rule: "an Armor
   * Class of 17 if its AC is lower than that" is a floor on the *total*, read
   * after everything, and written as a base it would be wrong in both
   * directions at once.
   */
  | {
      readonly kind: 'armor-class';
      /** The number Dexterity is added to: SRD Mage Armor's "13". */
      readonly base: number;
      /**
       * A **second** ability added alongside Dexterity, or null for none.
       *
       * Dexterity is in every base Armour Class calculation the SRD writes, so
       * "13 plus its Dexterity modifier" is `base: 13` and no second ability.
       * See {@link GrantedArmorClass.plusAbility}.
       */
      readonly plusAbility: Ability | null;
      /**
       * Whether a Shield still adds on top.
       *
       * True for Mage Armor: a Shield is not body armour, and the sheet has
       * held the two apart since equipment landed. The Monk's version of the
       * same shape says no, which is why this is stated rather than assumed.
       */
      readonly shieldAllowed: boolean;
      /** Absent, which is what tells the two arms apart. */
      readonly minimum?: undefined;
    }
  /**
   * A **floor** under the Armour Class the target arrives at by whatever means.
   *
   * SRD Barkskin, the whole rule: "the target has an Armor Class of 17 **if
   * its AC is lower than that**."
   *
   * **The same `kind` and a different arm**, because it is the same sentence
   * of the book — what a spell says your Armour Class is — asked at a
   * different point in the arithmetic. The arm above competes for the *base*,
   * before a Shield and before every flat bonus, and is consulted only while
   * the target is unarmoured; this one is read last, after the calculation,
   * after the bonuses and after whatever a worn item is granting, and is read
   * through plate as readily as through nothing. So `base` written as 17 would
   * beat a plate-armoured 18 down or be discarded under the armour depending
   * which way the comparison ran, and neither is the sentence.
   *
   * It carries no `shieldAllowed` and no `plusAbility` for the same reason: a
   * Shield's +2 is part of the total this is a floor *under*, so there is
   * nothing for it to permit, and a floor adds no ability to anything.
   *
   * See {@link GrantedArmorClass}, where the two arms are held apart on the
   * creature, and `armorClassOf`, which is the only reader of this one.
   */
  | {
      readonly kind: 'armor-class';
      /** SRD Barkskin's "17": the number the total may not fall below. */
      readonly minimum: number;
    }
  /**
   * Resistance, Immunity or Vulnerability the spell hands its target.
   *
   * SRD Stoneskin, whole: "Until the spell ends, one willing creature you touch
   * has **Resistance to Bludgeoning, Piercing, and Slashing damage**." SRD
   * Protection from Energy: "the willing creature you touch has Resistance to
   * one damage type of your choice: Acid, Cold, Fire, Lightning, or Thunder."
   *
   * **A list of types and a single answer**, because that is how the SRD
   * writes it: one sentence names however many types it names and says one
   * thing about all of them. No SRD spell grants Resistance to one type and
   * Immunity to another in one sentence, and a spell that did would be two
   * effects.
   *
   * **Not a `buff`.** A bonus is arithmetic that adds and stacks; Resistance
   * is a boolean the SRD refuses to let stack — "multiple instances of
   * Resistance to the same damage type count as only one" — and it is applied
   * in its own step of `applyDefenses`, after the adjustments and before
   * Vulnerability. Folding it into a number would put it in the wrong step and
   * let two castings quarter the damage.
   *
   * **Nothing is rolled and nothing is resisted.** Both spells touch a willing
   * creature and ask nobody to save; a spell that made a roll first would hang
   * this on the outcome, which is what a rider is for.
   *
   * The casting is in the source, so `releaseCasting`, a dispel, the deadline
   * and a broken Concentration all end it through the door every other grant
   * uses — and a `grants` timer can end it sooner, which is the deadline
   * `EffectTarget` gained for SRD Superior Hunter's Defense.
   */
  | {
      readonly kind: 'damage-defense';
      /**
       * The types the sentence names.
       *
       * For a spell that prints several and chooses one at the casting, this
       * is the placeholder the definition must carry to be well-formed, and
       * `damageTypeStated` is what actually lands — the same split Spirit
       * Guardians already uses for its damage.
       */
      readonly damageTypes: readonly string[];
      readonly defense: DefenseKind;
    }
  /**
   * Condition Immunities the spell hands its target.
   *
   * SRD Mind Blank: "Until the spell ends, one willing creature you touch has
   * Immunity to Psychic damage **and the Charmed condition**." SRD Heroism:
   * "Until the spell ends, the creature is immune to the Frightened condition."
   * SRD Heroes' Feast: "it has Immunity to the Frightened and Poisoned
   * conditions."
   *
   * **The other half of `damage-defense`'s sentence**, and its own kind for the
   * reason IE-017 gave when it declined to build this one: a stat block prints
   * damage types and conditions in one run and the engine treats them
   * completely differently. Mind Blank's single sentence is *two* effects here,
   * which is the honest reading — the damage half meets `applyDefenses` and the
   * condition half meets `applyConditionTo`, and nothing they share would be
   * served by one kind carrying both.
   *
   * **A list of names and one answer**, because that is how the SRD writes it:
   * one clause names however many conditions it names and says one thing about
   * all of them. There is no Vulnerability to a condition and no halfway house,
   * so unlike {@link DefenseKind} there is nothing beside the list to state.
   *
   * **Nothing is rolled and nothing is resisted.** Every SRD sentence of this
   * shape touches a willing creature or feeds it; a spell that made a roll
   * first would hang this on the outcome, which is what a rider is for — and
   * none does.
   *
   * **Unconditional by construction, which is the line this kind will not
   * cross.** SRD also writes the *narrowed* form — Protection from Evil and
   * Good's "can't ... gain the Charmed or Frightened conditions **from them**",
   * Freedom of Movement's "**spells and other magical effects** can neither ...
   * cause the target to have the Paralyzed or Restrained conditions" — and that
   * is a different sentence with a different reader: `conditionImmunitiesOf`
   * answers yes or no about a condition and knows nothing of what is causing
   * it, exactly as `CreatureState.conditionImmunities` holds only the
   * unconditional entries and `conditionApplicability` answers
   * `needs-adjudication` for the rest. Those spells stay blocked on
   * `a-condition-immunity-narrowed-to-its-source`.
   *
   * The casting is in the source, so `releaseCasting`, `releaseOnTarget`, a
   * dispel, a broken Concentration and the deadline all end it through the door
   * every other grant uses — and a `grants` timer can end it sooner, which is
   * the deadline `EffectTarget` already carries.
   */
  | {
      readonly kind: 'condition-immunity';
      /**
       * The conditions the sentence names.
       *
       * Never empty: a spell that makes a creature immune to nothing is a
       * sentence the SRD does not print, and `checkSpellDefinition` refuses it
       * rather than letting a definition resolve to a grant that does nothing.
       */
      readonly conditions: readonly ConditionName[];
    }
  /**
   * A Speed the spell changes, for as long as it runs.
   *
   * SRD Longstrider, whole: "You touch a creature. The target's Speed
   * increases by 10 feet until the spell ends." Nothing is rolled and nothing
   * is resisted — the same shape `armor-class` and `damage-defense` take, on
   * the third thing a spell can hand a creature that is not a roll.
   *
   * **Not a `buff`.** `BonusApplies` covers attacks, saves, ability checks and
   * an Armour Class, and a Speed is none of those: it is a number movement is
   * measured against rather than a roll. And most of the operations are not
   * arithmetic at all — SRD Slow halves, Hypnotic Pattern zeroes and Spider
   * Climb gives a whole Speed in a mode, and a bonus that added would make a
   * halving a negative number nobody printed.
   *
   * The casting is in the source, so `releaseCasting`, `releaseOnTarget`, a
   * dispel, a broken Concentration and the deadline all end it through the
   * door every other grant already uses. `speedOf` is the one reader, so the
   * feet reach the movement allowance, the Dash and the mounting cost together.
   */
  | {
      readonly kind: 'speed';
      readonly change: SpeedChange;
      /** Signed feet, required by `add` and refused by the other three. */
      readonly feet?: number;
      /**
       * Which of the five Speeds the sentence is about. Absent is walking.
       *
       * SRD Fly, "a Fly Speed of 60 feet"; SRD Spider Climb, "a Climb Speed
       * equal to its Speed". Legal beside the two operations that *give* a
       * Speed and refused beside the two that take one away, because the book
       * prints no sentence halving one mode and not another —
       * {@link SpeedChange} is where that ruling is written down and
       * `checkSpellDefinition` is where it is held.
       */
      readonly mode?: MovementMode;
      /**
       * SRD Fly's "and can hover".
       *
       * Only beside a granted Fly Speed, for the reason `OtherSpeeds.hover`
       * is only beside a printed one: a creature that cannot fly cannot hover
       * either, and the pair is what the fall reads.
       */
      readonly hover?: true;
    }
  /**
   * Light the casting sheds from a thing its target carries — SRD Light: "the
   * object sheds Bright Light in a 20-foot radius and Dim Light for an
   * additional 20 feet"; SRD Continual Flame the same, for ever.
   *
   * Carried by the **target creature**, because the engine holds no object to
   * hang it on and the SRD's object is in somebody's hand: the patches are
   * laid on a region whose origin is the creature, so they move when the
   * creature does and are stored nowhere but the log, exactly as a beetle's
   * own glow is. Magical, because a spell shed it, and sourced to the casting,
   * so it is gone when the casting is — which is why the definition has to
   * leave a record: a duration, Concentration, or "until dispelled". An
   * object nobody carries is a point the table lights with `declare_light`.
   */
  | {
      readonly kind: 'light';
      readonly level: LightLevel;
      readonly radius: number;
      /** SRD "Dim Light for an additional N feet": a dim sphere N wider. */
      readonly dimBeyond?: number;
    }
  /**
   * A sense the casting confers on its target for as long as it runs — SRD
   * Darkvision: "the target has Darkvision with a range of 150 feet".
   *
   * Read by `sensesOf` beside the senses a species or a stat block grants, at
   * the longest range held, and released with the casting as every other
   * sourced grant is.
   */
  | { readonly kind: 'sense'; readonly sense: SenseName; readonly feet: number }
  /**
   * An amount the spell takes off a hit **before** the target's defences meet
   * it — SRD Resistance: "When the creature takes damage of the chosen type
   * before the spell ends, the creature reduces the total damage taken by 1d4.
   * A creature can benefit from this spell only once per turn."
   *
   * **Not `damage-defense`, which is the neighbour it is easiest to mistake
   * for.** That kind names a damage type and grants Resistance, Immunity or
   * Vulnerability over it — a *multiplier*, and the second step of SRD's
   * "Order of Application". This is the **first** step, an adjustment, and the
   * difference is observable: a d4 off 10 Fire against a fire-resistant target
   * leaves 3, where halving first would leave 4 and round twice. The cantrip
   * and the defence share one word and are different arithmetic.
   *
   * **The die is a notation and is thrown at the blow.** A reduction rolled at
   * the cast would put the number in the log a minute before the hit that
   * produced it, which is the rule a scheduled hit and a turn payout already
   * follow.
   *
   * **The type is chosen at the casting through the mechanism that exists.**
   * `SpellDefinition.damageTypeStated` lists what a definition prints and
   * `statedDamageType` rewrites a `damageTypes` field to the one the caster
   * named — the same door SRD Protection from Energy's granted defence goes
   * through — so this field is plural to be reachable by that rewrite and SRD
   * Resistance leaves it holding exactly one. A casting that names none is
   * `damage_type_required` at the door, as it already is for the other two.
   *
   * **It carries no `lasts` of its own**, for the reason `sense`, `speed` and
   * `action-rule` carry none: the SRD sentence in this position runs for the
   * spell's own duration, and an Instantaneous casting would leave a reduction
   * nothing could ever lift. `checkGrantLifetimes` refuses that pairing.
   */
  | {
      readonly kind: 'damage-reduction';
      /** What comes off. A notation, thrown when a blow arrives. */
      readonly reduces: { readonly dice: string };
      /**
       * The kinds of damage the sentence is about — see `statedDamageType`.
       *
       * `readonly string[]`, as `damage-defense`'s list is and for the same
       * two reasons: the table `applyDamage` sums into is keyed by string, and
       * {@link statedDamageType} writes `[damageType]` into this field out of
       * a casting's stated choice, which is a string. The vocabulary is held
       * at the door instead — `checkSpellDefinition` refuses a type the SRD
       * does not print, exactly as it does for a granted defence.
       */
      readonly damageTypes: readonly string[];
      /**
       * SRD Resistance's "only once per turn".
       *
       * Required rather than optional, and `true` is its only value: every SRD
       * sentence of this shape prints the limit, and a definition that left it
       * out would be claiming a reduction off *every* blow — which is a much
       * bigger rule to grant by omission than by statement. The ledger that
       * enforces it is the engine's own `feature-used`, keyed on the casting,
       * so outside combat there are no turns and nothing restricts it.
       */
      readonly oncePerTurn: true;
    }
  /**
   * What the spell changes about how its target may spend a turn.
   *
   * SRD Wind Walk: "The only actions a target can take in this form are the
   * Dash action, the Hide action, and the Search action." SRD Conjure
   * Woodland Beings: "you can take the Disengage action as a Bonus Action for
   * the spell's duration." SRD Antimagic Field: "No one can cast spells, take
   * Magic actions". None of those asks anybody to roll, which is what makes
   * this a standalone kind and not only a rider — the shape `armor-class`,
   * `damage-defense` and `speed` already take, on the fifth thing a spell
   * hands out that is not a roll.
   *
   * {@link ActionRule} in `combat.ts` is the vocabulary, the three SRD
   * sentences it was derived from, and the argument that a compelled action
   * is a fact about legality rather than an instruction the engine executes.
   *
   * **It carries no `lasts` of its own**, for the reason `speed`,
   * `attack-rider`, `condition-immunity` and `turn-payout` carry none: every
   * SRD sentence in *this* position runs for the spell's own duration, and an
   * Instantaneous casting would leave a rule nothing could ever lift.
   * `checkGrantLifetimes` refuses that pairing. The shorter deadline lives on
   * the rider, because a rider is what Shocking Grasp writes.
   */
  | {
      readonly kind: 'action-rule';
      readonly rule: ActionRule;
    }
  /**
   * Extra damage the spell adds to the **caster's later attacks**.
   *
   * SRD Divine Favor, whole: "Until the spell ends, your attacks with weapons
   * deal an extra 1d4 Radiant damage on a hit." SRD Hunter's Mark: "you deal
   * an extra 1d6 Force damage to the target whenever you hit it with an attack
   * roll."
   *
   * **Not `attack-damage`**, which is the neighbouring kind and a different
   * mechanic: that one joins an attack that has *already hit*, is resolved
   * through `resolveAttackDamage`, and is over in the same breath — Divine
   * Smite's shape. This one is a **grant**, hung on the caster and read again
   * on every attack they make until the casting ends.
   *
   * **Not a `buff`.** `BonusApplies` covers attacks, saves, ability checks and
   * an Armour Class, and damage is none of them; and a bonus folds into the
   * weapon's own type, where the whole point is that the Radiant meets the
   * target's defences separately and doubles on a Critical Hit as its own
   * component.
   *
   * **The grant lands on the caster, whoever the effect was aimed at.** Divine
   * Favor is Range: Self, so the two are the same creature; Hunter's Mark is
   * cast ninety feet away and the die is still the ranger's.
   * {@link marksTarget} is what records the difference, and it is the SRD's own
   * distinction rather than a convenience: one sentence names the target and
   * the other names the weapon, and neither names both.
   */
  | {
      readonly kind: 'attack-rider';
      /**
       * The extra dice, e.g. `1d4`.
       *
       * A bare notation rather than a {@link DiceScaling}: no SRD sentence of
       * this shape grows its dice with the slot or with the caster's level —
       * Hunter's Mark's higher slot buys *duration* — so a scaling field here
       * would be a member no definition could write.
       */
      readonly dice: string;
      /** The type the sentence names: Divine Favor's Radiant, Hunter's Mark's Force. */
      readonly damageType: string;
      /** SRD Divine Favor's "your attacks **with weapons**". */
      readonly weaponOnly?: true;
      /**
       * SRD Hunter's Mark's "**to the target**": the rider fires only against
       * the creature this effect resolved on.
       *
       * Absent is Divine Favor, whose die rides every weapon swing whoever it
       * is aimed at.
       */
      readonly marksTarget?: true;
    }
  /**
   * What the spell does to **one particular weapon**, read again on every
   * later attack made with it.
   *
   * SRD Shillelagh: "A Club or Quarterstaff you are holding is imbued with
   * nature's power. For the duration, you can use your spellcasting ability
   * instead of Strength for the attack and damage rolls of melee attacks using
   * that weapon, and the weapon's damage die becomes a d8." SRD Magic Weapon:
   * "You touch a nonmagical weapon. Until the spell ends, that weapon becomes
   * a magic weapon with a +1 bonus to attack rolls and damage rolls."
   *
   * **Not `attack-rider`**, which is the neighbouring kind and the other half
   * of the same family. That one hangs a notation and a *damage type* on the
   * caster, and what it adds is a component of its own — Divine Favor's
   * Radiant meets the target's defences separately and doubles on a Critical
   * Hit. Neither sentence here adds a component to anything: one *replaces*
   * the weapon's die and the ability its rolls are made with, and the other
   * adds a flat plus of the weapon's **own** type to two rolls at once.
   *
   * **Not a `buff` either**, for the reason `attack-rider` is not: `BonusApplies`
   * covers attacks, saves, ability checks and an Armour Class, and a damage
   * roll is none of them — so Magic Weapon's sentence has no home in it at all.
   *
   * **The weapon is the casting's, and that is the whole point of the kind.**
   * `StandingGrant.onlyWithItem` narrows a benefit to the item that *granted*
   * it — a Weapon, +1 confining its own plus to itself — and there is no item
   * granting anything here. `WeaponNarrowing` describes a *kind* of weapon, so
   * a Shillelagh written with one would imbue every Quarterstaff in the pack.
   * What the SRD writes is "**that** weapon": one object, named by the caster
   * at the casting through `CastSpellRequest.weapon`, pinned into the
   * grant and matched against the record a later swing resolved.
   *
   * **It carries no `lasts` of its own**, for the reason `speed`,
   * `attack-rider`, `condition-immunity` and `turn-payout` carry none: both
   * SRD sentences run for the spell's own duration, and an Instantaneous
   * casting would leave a weapon enchanted with nothing able to lift it.
   * `checkGrantLifetimes` refuses that pairing.
   */
  | {
      readonly kind: 'weapon-rider';
      /**
       * The weapons the spell names, by catalogue id. Absent names any weapon.
       *
       * SRD Shillelagh prints "A **Club or Quarterstaff**", which is two
       * objects and not a description: a `WeaponSelector` over Simple Melee
       * and Light matches a Dagger, and one over Versatile matches a
       * Longsword, so no combination of the selector's three axes says what
       * the book said. SRD Magic Weapon prints "a weapon" and writes nothing
       * here.
       *
       * **Content naming content**, which is the door `expandPack` and a
       * fixed spell grant already use: `checkContent` refuses an id that
       * reaches no item and an item that is not a weapon. The engine still
       * learns nothing — rule 4 forbids an *engine file* naming a catalogue
       * id, and this is a field a definition fills in.
       */
      readonly weapons?: readonly string[];
      /** SRD Shillelagh's "the attack and damage rolls of **melee** attacks". */
      readonly meleeOnly?: true;
      /**
       * SRD Magic Weapon's "a +1 bonus to attack rolls and damage rolls".
       *
       * One number reaching both rolls, because the SRD writes one number
       * reaching both rolls. A definition that wanted them to differ would be
       * writing a sentence the book does not print.
       */
      readonly bonus?: number;
      /**
       * How the plus grows with the slot, by band.
       *
       * The key is the **lowest slot level of the band** and the value is the
       * whole bonus — the shape {@link SpellDefinition.durationAtSlot} already
       * takes, read the same way, so a level 4 slot falls in the band that
       * opened at 3. SRD Magic Weapon's "+2 with a level 3–5 spell slot … +3
       * with a level 6+ spell slot" is `{ 3: 2, 6: 3 }`, and {@link bonus} is
       * what a slot below every band still gets.
       *
       * Presupposes {@link bonus}, and refused without it: a band table with
       * no base is a spell that does nothing at its own level.
       */
      readonly bonusAtSlot?: Readonly<Record<number, number>>;
      /**
       * SRD Shillelagh's "the weapon's damage die becomes a d8".
       *
       * *Becomes*, not *besides* — this replaces the weapon's own notation,
       * which is what `StrikeStyleInPlay.die` already means and where
       * this is read. A Club under Shillelagh rolls a d8 and not a d4 and a
       * d8.
       */
      readonly die?: string;
      /**
       * SRD Shillelagh's Cantrip Upgrade: "The damage die changes when you
       * reach levels 5 (d10), 11 (d12), and 17 (2d6)."
       *
       * A band table keyed by the lowest **character** level of the band, read
       * exactly as {@link bonusAtSlot} is read off the slot. Not
       * `DiceScaling.cantripUpgradesAt`, which *adds* a die of the base
       * notation: this sentence changes the die's size, and at 17 changes how
       * many there are — no arithmetic over the base produces d8, d10, d12,
       * 2d6.
       *
       * Presupposes {@link die}, for the reason `bonusAtSlot` presupposes
       * `bonus`.
       */
      readonly dieAtLevel?: Readonly<Record<number, string>>;
      /**
       * SRD Shillelagh: "you **can** use your spellcasting ability instead of
       * Strength for the attack and damage rolls".
       *
       * An **offer**, which is the reading `attackAbility` already gives SRD
       * Finesse and the Monk's Dexterous Attacks: the better score is taken
       * when nobody says, and the attacker may decline it. Imposing it would
       * hand a Strength 18 Druid a worse staff than they started with.
       *
       * Which ability it is is the *caster's*, resolved at the casting and
       * pinned into the grant — so a replay throws the right modifier with no
       * idea whose spell list the casting came off.
       */
      readonly castingAbility?: true;
      /**
       * SRD Shillelagh: "If the attack deals damage, it can be **Force damage
       * or the weapon's normal damage type** (your choice)."
       *
       * The types the spell offers *instead of* the weapon's own, named at
       * each later swing rather than at the casting. An offer, like
       * {@link castingAbility} beside it: a swing that names none deals what
       * the weapon deals, which is the second half of the book's "or".
       *
       * **Not `SpellDefinition.damageTypeStated`**, which is the neighbouring
       * field and a different moment. That one is answered when the spell is
       * cast and pinned into everything the casting writes — Chromatic Orb's
       * orb is one colour from the word go. This is answered a turn later,
       * with the target's Resistances in front of the caster, and the same
       * casting may answer it differently on two swings. A casting cannot pin
       * what has not been decided.
       *
       * **It replaces rather than adds**, which is what keeps it out of
       * `attack-rider`: "it can be Force damage **or** the weapon's normal
       * damage type" is one type or the other, so a Force-immune target takes
       * nothing from a staff swung as Force rather than half of two
       * components.
       */
      readonly damageTypes?: readonly string[];
    }
  /**
   * The weapon attack the casting **itself** makes.
   *
   * SRD True Strike: "you make one attack with the weapon used in the spell's
   * casting. The attack uses your spellcasting ability for the attack and
   * damage rolls instead of using Strength or Dexterity. If the attack deals
   * damage, it can be Radiant damage or the weapon's normal damage type (your
   * choice)" — and a Cantrip Upgrade that adds Radiant dice at levels 5, 11
   * and 17.
   *
   * **The neighbour above is the shape this is most easily confused with, and
   * the difference is which command makes the swing.** A `weapon-rider` is
   * hung on a weapon at the casting and read again at every *later* attack
   * somebody makes with it; there is no later attack here. The casting and the
   * swing are one moment — one Action, one target, nothing granted and nothing
   * left standing — so an effect of this kind is resolved by the **attack**
   * command, which names the cantrip beside the weapon, and `resolveSpell`
   * refuses a definition carrying one outright: the door is wrong, and no fact
   * is missing that would make it right.
   *
   * **It is the mirror of `attack-damage`, one command earlier.** That kind is
   * a spell cast on a swing that has already hit and adds to its damage; this
   * one is a spell cast *as* the swing, and it changes how the swing is rolled.
   * Both are effects no `resolveSpell` can run, for the same reason — the
   * attack is the thing they need — which is why they are two members of this
   * union and not two commands.
   *
   * The validator holds it to the shape the sentence has: a cantrip, Range:
   * Self, and nothing else on the definition, because a spell that makes a
   * weapon attack and also does something to somebody else is a sentence the
   * book does not print and an effect list this resolver never runs.
   */
  | {
      readonly kind: 'weapon-attack';
      /**
       * Which ability the attack and damage rolls are made with instead of the
       * weapon's own.
       *
       * **Imposed rather than offered**, which is the whole difference from
       * `weapon-rider.castingAbility` beside it: SRD Shillelagh says "you
       * **can** use your spellcasting ability", and this says "the attack
       * **uses** your spellcasting ability ... instead of using Strength or
       * Dexterity". So nothing weighs it against the weapon's own modifier and
       * a caller cannot decline it.
       *
       * A union of one, for the reason {@link DieRule} is one: the SRD writes
       * this substitution once and names the caster's own ability every time.
       * A second spelling — a fixed ability, a choice of two — arrives beside
       * this one rather than instead of it.
       */
      readonly ability: 'spellcasting';
      /**
       * The types the spell offers **instead of** the weapon's own, chosen at
       * the swing.
       *
       * The same offer `weapon-rider.damageTypes` makes and the same reading:
       * one type or the other, so a Radiant-immune target takes nothing from a
       * mace swung as Radiant rather than half of two components, and naming
       * none is how the offer is declined.
       *
       * Answered on the attack command's own `cantrip` request rather than in
       * the map a standing rider's offer is answered through: that map is
       * keyed by name because several imbued weapons could be in hand at once
       * and the swing has to say which offer it is taking. This offer arrives
       * in the same breath as the spell that makes it, so it is answered in
       * the same object.
       */
      readonly damageTypes?: readonly string[];
      /**
       * SRD True Strike's Cantrip Upgrade: "the attack deals extra Radiant
       * damage when you reach levels 5 (1d6), 11 (2d6), and 17 (3d6)."
       *
       * **A band table keyed by the lowest character level of the band, with
       * no base**, which is `weapon-rider.dieAtLevel`'s shape read by the same
       * `bandAt` — and deliberately not `DiceScaling.cantripUpgradesAt`. That
       * field *adds* a die to a base notation, and this sentence has no base:
       * below level 5 the spell adds no dice at all, which a `DiceScaling`
       * could say only by writing a notation that rolls none — `0d6`, which
       * `parseNotation` refuses and which every reader of a notation would
       * then have to special-case. A table with no entry at or below the
       * caster's level is an honest nothing.
       */
      readonly extraDamage?: {
        readonly damageType: string;
        /** Keyed by the lowest character level of the band: `{ 5: '1d6', … }`. */
        readonly diceAtLevel: Readonly<Record<number, string>>;
      };
    }
  | {
      readonly kind: 'interrupt-casting';
      readonly ability: Ability;
    }
  /**
   * A printed percentage the casting may simply fail on, thrown on a d100.
   *
   * SRD Augury: "If you cast the spell more than once before finishing a Long
   * Rest, there is a **cumulative 25 percent chance for each casting after the
   * first** that you get no answer."
   *
   * **The die is not a d20 and nothing about it is a D20 Test.** There are no
   * modes, no bonuses, no ability and no DC — a percentage is a number the
   * book printed and the engine rolls against, which is the whole of the shape
   * `a-random-outcome-that-is-not-a-d20` named. `parseNotation` has read
   * `1d100` since dice landed; what was missing was an effect that asked for
   * one.
   *
   * **`percent` is one number or a rule for growing one**, and the flat form is
   * the general case: SRD Gust of Wind prints a flat 50 percent and Sending a
   * flat 5. Augury's form counts the castings that have gone before and
   * multiplies, which is {@link cumulativeChance} — the very function SRD Wind
   * Fan's "cumulative 20 percent chance of not working" already uses, pointed
   * at a casting instead of at an item. `countedBy` names the key the count is
   * kept under and the rest that empties it, because nothing declares a tally
   * and the tag has to arrive with the use.
   *
   * **The use is counted whether or not a die is thrown**, because the book
   * counts castings rather than failures — and the die is **not thrown at all
   * when the chance is zero**, which is the first casting. A die thrown for an
   * outcome that is already decided moves the generator for nothing, and that
   * is the quiet way a replay stops matching.
   *
   * **`onFailure` is a closed list of one, and it is a list because the value
   * is a *rule* rather than a label.** `'no-answer'` says: the casting
   * happened, the slot is gone, and the printed text the book left to the
   * table is withheld from **the resolution that reports it** — an omen
   * nobody received must not be handed to a DM to narrate. A second value
   * would be a second rule with a second resolver arm, which is why this is
   * not a boolean.
   *
   * **What it does not reach is the declaration**, and the reason is the
   * clock. A rite of a minute is declared, and the declaration hands its text
   * over there and then — into the caller's `unverified` and pinned onto
   * `spell-declared` — a minute before this die exists. So a reader of the
   * *log* sees the text on the declaration and the withdrawal in the
   * settlement's resolution, which is the chronology of what happened: the
   * caster set out to ask a question and got no answer. Suppressing the
   * declaration's copy would mean holding every handover in the book back
   * until every effect had run, which is one spell's rule moved into the
   * pipeline every spell goes through.
   */
  | {
      readonly kind: 'chance';
      readonly percent:
        | number
        | {
            /** SRD Augury's 25, added for each casting before this one. */
            readonly perPriorCasting: number;
            /** Where the count is kept, and what empties it. */
            readonly countedBy: {
              readonly key: string;
              readonly recovers: Recovery;
            };
          };
      readonly onFailure: 'no-answer';
    }
  /**
   * The target is somewhere else, and nothing was spent getting there.
   *
   * SRD Misty Step, whole: "Briefly surrounded by silvery mist, you teleport up
   * to 30 feet to an unoccupied space you can see." SRD Dimension Door: "You
   * teleport to a location within range. You arrive at exactly the spot
   * desired."
   *
   * **Not a `speed` change and not movement of any kind.** `relocateCreature`
   * is the command beneath it, and `commands/teleport.ts` records why that is
   * its own operation rather than a flag on a move: none of Speed, Difficult
   * Terrain, Opportunity Attacks, Disengage or Grappled applies, because the
   * SRD applies none of them to a teleport.
   *
   * **Where it goes is the caster's**, stated at the casting through
   * `CastSpellRequest.teleportTo` and pinned on a declaration exactly as the
   * damage type and the designation are — the engine validates the destination
   * and never chooses one. What the *definition* carries is the two numbers the
   * spell prints: how far, and whether the space has to be one the caster can
   * see.
   */
  | {
      readonly kind: 'teleport';
      /**
       * How far, in feet, measured from where the creature is standing now.
       *
       * Misty Step's "up to 30 feet"; Dimension Door's printed Range of 500,
       * which is the distance the teleport covers rather than a reach to a
       * target — the spell is on its caster, so `range` checking the target
       * would measure a creature against itself and answer nothing.
       */
      readonly feet: number;
      /**
       * SRD Misty Step's "an unoccupied space **you can see**".
       *
       * Absent is Dimension Door, which prints the opposite in as many words:
       * the destination "can be a place you can see, one you can visualize, or
       * one you can describe by stating distance and direction". A clause a
       * spell does not print is not one the engine may apply.
       */
      readonly requiresSight?: true;
    }
  /**
   * A creature the casting puts into the world, out of the bestiary.
   *
   * SRD Find Steed: "You summon an otherworldly being that appears as a loyal
   * steed in an unoccupied space of your choice within range. **This creature
   * uses the Otherworldly Steed stat block.**" SRD Phantom Steed: "The steed
   * uses the Riding Horse stat block (see "Monsters")."
   *
   * **A stat block by its id, and nothing else about the creature.** The
   * owner's ruling of 2026-09-21 is what settles the representation: a
   * spell-internal stat block is a *catalogue* entry like any other, rather
   * than a second kind of content that only a spell can hold. So this arm
   * names one, `summonCreature` reads it through `content.monsterById`, and
   * every number the creature has — the sheet, the printed Armour Class, the
   * average hit points, the creature type, both halves of the defence run and
   * the size — is pinned into `creature-added` at the moment of arrival. The
   * fold never opens a catalogue, so a log replayed next year raises the
   * creature this casting raised and not the one the book prints then.
   *
   * **It targets the caster**, which is the shape `teleport` already takes and
   * for the same reason: the spell is on the creature casting it and the thing
   * it affects is not a creature at all. SRD writes "**You** summon"; the
   * steed is the consequence.
   *
   * **The bond to the casting is derived rather than declared.** A casting
   * that leaves a record running holds its creature there and the creature
   * goes when it does (`strandedSummons`); one that leaves nothing running
   * binds nothing, which is SRD Animate Dead's skeleton standing next week. A
   * field would be a second way to say what `persists` already answers, and
   * one a definition could get wrong — a bond to a casting with no record is
   * a log the fold refuses. **The one thing a definition does declare is the
   * third case**: an Instantaneous casting whose creature the caster keeps —
   * SRD Find Steed's steed, SRD Find Familiar's familiar — is bound to its
   * *summoner* through {@link KeptSummons}, because "disappears if it drops to
   * 0 Hit Points or if you die" is a lifetime no record answers.
   *
   * **Where it appears and what it may do are two other commands**, exactly as
   * they are for any other creature walking through the door: `placeCreature`
   * puts it on the map at the size its block prints, and `declareSpellcasting`
   * says what it casts. `addCreature` documents that division and this changes
   * none of it.
   */
  | {
      readonly kind: 'summon';
      /**
       * Which stat block — by its id in content, as `addCreature` takes one,
       * or chosen at the casting out of a printed set. See {@link SummonedForm}.
       */
      readonly monster: SummonedForm;
      /**
       * The creature type the summons arrives with, where the spell prints
       * one over the block's own.
       *
       * SRD Find Familiar: "the familiar has the statistics of the chosen
       * form … though it is a Celestial, Fey, or Fiend (your choice) instead
       * of a Beast." SRD Find Steed: "choose the steed's creature type —
       * Celestial, Fey, or Fiend". Pinned into `creature-added` at the arrival
       * in place of the block's, so `mustBeType` and every type-gated rule
       * read what the spell says the creature is. A spell that prints the
       * choice offers it through {@link SpellDefinition.choiceStated} with
       * `of: 'creature-type'`, and the value written here is the one the
       * definition is written around, exactly as a stated condition is; a
       * feature that fixes the type — SRD Wild Companion's "the familiar is a
       * Fey" — writes it here and offers no choice. Absent is the block's own
       * type, untouched.
       */
      readonly creatureType?: string;
      /**
       * SRD Find Steed's "**AC** 10 + 1 per spell level".
       *
       * The one place a *spell* overrides a number its stat block prints, and
       * it is here rather than in the bestiary because the book prints the
       * formula in the spell's own entry. Absent is every summons whose block
       * is the whole truth — SRD Phantom Steed's Riding Horse — and then the
       * printed Armour Class stands untouched.
       */
      readonly armorClass?: SummonedNumber;
      /** SRD Find Steed's "**HP** 5 + 10 per spell level". */
      readonly hitPoints?: SummonedNumber;
      /**
       * SRD Find Steed: "In combat, **it shares your Initiative count**."
       *
       * Derived from the order as it stands rather than stated: the caster's
       * own rung is a fact the engine holds, and a total arriving from outside
       * would be a number a caller produced. **And the sentence after it is
       * delivered too** — "the steed takes its turn immediately after yours" —
       * by seating the creature immediately after the caster
       * (`CombatantInput.after`), on the caster's count and at the caster's
       * tiebreak, so a third creature the DM put on that exact count cannot
       * come between them. Absent is every summons that rolls for itself, and
       * then it seats nobody — `rollInitiativeFor` and `joinCombat` are the
       * two commands that give a rung, exactly as they are for a creature a DM
       * summons by hand. A fight that is not running seats nobody either way.
       */
      readonly sharesCastersInitiative?: true;
      /**
       * A creature the caster **keeps** — bound to its summoner rather than to
       * a casting. See {@link KeptSummons}.
       */
      readonly kept?: KeptSummons;
      /**
       * Speeds the spell prints over its block, each at the slot level it
       * appears from. See {@link PrintedSummonSpeeds}.
       */
      readonly speeds?: PrintedSummonSpeeds;
      /**
       * SRD Find Familiar: "A familiar can't attack, but it can take other
       * actions as normal."
       *
       * A stat block that prints attacks, raised by a spell that forbids them:
       * the block stays as printed and the creature arrives carrying an
       * `action-rule` that forbids the Attack action and the Opportunity
       * Attack, sourced to the summons rather than to a casting there is no
       * record of, for as long as it stands. The only value is `true`.
       */
      readonly cannotAttack?: true;
    };

/**
 * A number a spell prints as a formula over the level it was cast at.
 *
 * SRD Find Steed prints two, inside the stat block it contains: "AC 10 + 1 per
 * spell level" and "HP 5 + 10 per spell level". The value is
 * `base + perSpellLevel × castLevel`, worked out **once, at the cast**, and
 * what reaches the log is the answer — so an upcast steed is a fact about the
 * casting rather than a formula the fold would have to re-evaluate.
 *
 * Not a {@link DiceScaling}: nothing is rolled, and the book scales these from
 * the spell's *level* rather than from the levels above its own.
 */
export interface SummonedNumber {
  readonly base: number;
  readonly perSpellLevel: number;
}

/**
 * Which stat block a summons raises.
 *
 * A string is the block, fixed by the spell — SRD Find Steed's Otherworldly
 * Steed, SRD Phantom Steed's Riding Horse. The object is SRD Find Familiar's
 * sentence: "an animal form you choose: Bat, Cat, Frog, Hawk, Lizard,
 * Octopus, Owl, Rat, Raven, Spider, Weasel, **or another Beast that has a
 * Challenge Rating of 0**" — a printed list the caster picks from, widened by
 * a clause over two facts every stat block prints. The caster names the form
 * at the casting (`CastSpellRequest.form`) and the engine refuses one that is
 * neither listed nor admitted by the clause, exactly as it refuses a stated
 * choice off the list. What it never does is pick.
 */
export type SummonedForm =
  | string
  | {
      /** The forms the SRD prints, by their ids in content, in the order it prints them. */
      readonly among: readonly string[];
      /**
       * "or another Beast that has a Challenge Rating of 0": a creature type
       * and a rating, both read off the block the caster names.
       */
      readonly orAny?: { readonly type: string; readonly cr: number };
    };

/**
 * A creature the caster keeps: bound to its summoner rather than to a casting.
 *
 * SRD Find Familiar and Find Steed are Instantaneous, so no record holds the
 * creature and nothing would take it away — and the book takes it away:
 * "When the familiar drops to 0 Hit Points, it disappears"; "The steed
 * disappears if it drops to 0 Hit Points or if you die." The first sentence
 * is what `kept` means and every kept creature has it; the second is
 * {@link KeptSummons.untilSummonerDies}, which Find Steed prints and Find
 * Familiar does not. Both are asked by `strandedSummons` exactly as a
 * casting's ending is, and settled by the same sweep.
 *
 * **One at a time**: a second casting of the same spell by the same caster
 * replaces the creature it kept — SRD Find Steed's "the steed is replaced by
 * the new one", SRD Find Familiar's "you instead cause it to adopt a new
 * eligible form" — which is why the bond the log carries records the spell.
 *
 * Refused beside a duration or a Concentration (`kept_beside_a_duration`): a
 * creature with two lifetimes would go at whichever ended first, and the book
 * prints one.
 */
export interface KeptSummons {
  /** SRD Find Steed: "or if you die". */
  readonly untilSummonerDies?: true;
}

/**
 * A Speed the spell prints over its block, and the slot it appears from.
 *
 * SRD Find Steed's block: "**Speed** 60 ft., Fly 60 ft. (requires level 4+
 * spell)" — a third number the spell prints over its own block beside the
 * two {@link SummonedNumber} computes, and one that is withheld below the
 * level rather than given, because a limit enforced is never more permissive
 * than the book. `fromSpellLevel` absent is a Speed the creature always has.
 * A walking Speed replaces the block's; any other mode joins or replaces the
 * one the block prints.
 */
export interface PrintedSummonSpeeds {
  readonly walk?: PrintedSummonSpeed;
  readonly fly?: PrintedSummonSpeed;
  readonly climb?: PrintedSummonSpeed;
  readonly swim?: PrintedSummonSpeed;
  readonly burrow?: PrintedSummonSpeed;
}

export interface PrintedSummonSpeed {
  readonly feet: number;
  /** The lowest slot level the Speed appears from; absent is always. */
  readonly fromSpellLevel?: number;
}

/**
 * An area a spell fills, and where it starts.
 *
 * The *shape and its dimensions* belong to the spell — Fireball is always a
 * 20-foot-radius Sphere — while *where it goes* is the caster's decision every
 * time, so the point and the direction are supplied at the cast. Keeping those
 * apart is the same split as everywhere else: the rules are data, the
 * judgement is an argument.
 *
 * `origin` says which of the two the point comes from. `self` starts at the
 * caster, and SRD excludes them from a Cone, Cube, Line or Emanation they
 * cast; `point` is "a point you choose within range", which is checked against
 * the spell's range like any other target.
 */
export type SpellArea =
  | { readonly kind: 'sphere'; readonly radius: number; readonly origin: 'point' }
  | {
      readonly kind: 'cylinder';
      readonly radius: number;
      readonly height: number;
      readonly origin: 'point';
    }
  /** SRD: a Cone's width at any point equals that point's distance from the origin. */
  | { readonly kind: 'cone'; readonly length: number; readonly origin: 'self' | 'point' }
  | { readonly kind: 'cube'; readonly size: number; readonly origin: 'self' | 'point' }
  | {
      readonly kind: 'line';
      readonly length: number;
      readonly width: number;
      readonly origin: 'self';
    }
  | { readonly kind: 'emanation'; readonly distance: number; readonly origin: 'self' };

/**
 * Ground a casting's area is expensive to cross, for as long as the casting
 * lasts.
 *
 * **One field, because the book prints one number and it is not always the
 * glossary's.** Difficult Terrain costs two feet per foot; SRD Plant Growth
 * and Wall of Thorns each cost four, which no boolean can say and which a
 * boolean would have had to be widened into the first time either was
 * transcribed. `DifficultPatch` in `positioning.ts` has held the rate as a
 * number since it was written, for the same reason and out of the same
 * reading; this is the content-facing end of it.
 *
 * Deliberately not a member of {@link AreaStanding}. That one is what an area
 * does to a **creature** standing in it, derived per creature on every read;
 * this is a fact about the **ground**, asked per space by the ruler as a move
 * crosses it, and true of spaces nobody is standing in.
 */
export interface AreaTerrain {
  /**
   * Feet of movement spent per foot of ground; at least `DIFFICULT_TERRAIN`.
   *
   * The floor is the glossary's own rate and the validator holds the
   * definition to it, because a spell that made the ground *cheaper* is a
   * sentence the SRD does not print and a number below two would quietly
   * charge less than open floor.
   */
  readonly costPerFoot: number;
}

/**
 * What a casting's area does to the **light**, for as long as the casting
 * lasts.
 *
 * {@link AreaTerrain}'s sibling, and the second consumer of the same
 * mechanism: `docs/design/light-and-sight.md` puts light on the lattice
 * "exactly as Difficult Terrain is", so the region this casting resolved is
 * pinned into a `light-declared` event beside the cast and the patch lapses
 * when the casting does. Nothing is looked up afterwards.
 *
 * Set only alongside `area`, the rule `areaTerrain` and `areaStanding` follow
 * and for their reason: the patch lies on the region the area resolved, and a
 * second geometry for light would be a second place for a radius to be
 * measured from the wrong point.
 *
 * **The magic is not a field.** A patch a spell lays is magical by
 * construction and carries the spell's *printed* level, because that is the
 * number SRD Darkness and SRD Daylight compare — "an area of Bright Light or
 * Dim Light created by a spell of **level 2 or lower**" is a flat threshold
 * and not the slot that paid for it, so an upcast Darkness dispels exactly
 * what the printed one does.
 */
export interface AreaLight {
  /** The level over the area itself: SRD Darkness's darkness, Daylight's bright. */
  readonly level: LightLevel;
  /**
   * SRD Daylight: "and sheds Dim Light for an additional 60 feet." SRD Light
   * and SRD Continual Flame print the same shape at twenty.
   *
   * Feet **beyond** the area's own edge, laid as a second patch of Dim Light
   * with the same origin and a wider radius — so the bright core wins where
   * they overlap, which is what `lightAt` does with two patches anyway.
   *
   * Only on a Sphere, because that is the only shape whose edge is one
   * number; the validator says so rather than silently laying nothing.
   */
  readonly dimBeyond?: number;
  /**
   * SRD sunlight, on a light that is the sun rather than merely bright.
   *
   * Refused on anything but `bright`, by the same rule `declareLightPatch`
   * keeps: sunlight is Bright Light with a flag and not a fourth level.
   */
  readonly sunlight?: boolean;
}

/**
 * What a casting's area does to how far you can **see**, when that is not a
 * question about the light.
 *
 * SRD Fog Cloud: "The Sphere is Heavily Obscured", and the spell says nothing
 * whatever about how bright it is. That is the whole reason obscurement is a
 * record of its own beside light on `PositionState`, and it is the reason
 * this is a field of its own beside {@link AreaLight}.
 *
 * What a light level implies — Dim is Lightly Obscured, Darkness is Heavily —
 * is added by `obscurementAt` at read time, so a definition that writes
 * `areaLight` must not also write this to say the same thing twice.
 */
export interface AreaObscurement {
  readonly degree: ObscurementDegree;
  /**
   * SRD Fog Cloud: "The fog's radius increases by 20 feet for each spell slot
   * level above 1."
   *
   * **Expressible here and not on `area`**, which is the difference between a
   * template and a patch: an area is one fixed size because the fold reads
   * the pinned template at every later question, while this region is worked
   * out once, at the casting, against the slot that paid for it. So a level 5
   * Fog Cloud lays the hundred-foot bank the book prints rather than the
   * twenty-foot one.
   *
   * Only on a Sphere, for {@link AreaLight.dimBeyond}'s reason.
   */
  readonly radiusPerSlotLevelAbove?: number;
}

/** Shapes that need to be pointed somewhere as well as placed. */
export const DIRECTIONAL_AREAS: ReadonlySet<SpellArea['kind']> = new Set([
  'cone',
  'cube',
  'line',
]);

/**
 * What a persistent area does to a creature it catches after the casting.
 *
 * SRD writes this as two or three separate clauses and they are **not** one
 * rule. Five spells, five different combinations, and no two agree:
 *
 * | Spell | The boundary clause | The entry clause | The cap |
 * |---|---|---|---|
 * | Insect Plague | "or ends its turn there" | "enters ... for the first time on a turn" | "only once per turn" |
 * | Web | "or starts its turn there" | "The first time a creature enters the webs on a turn" | — |
 * | Grease | "or ends its turn there" | "A creature that enters the area" | — |
 * | Stinking Cloud | "that starts its turn in the Sphere" | *(none)* | — |
 * | Black Tentacles | "or ends it turn there" | "if it enters the area" | "only once per turn" |
 *
 * So each field is one transcribed clause rather than a frequency taxonomy
 * somebody invented, and the three behaviours the spells actually show fall
 * out of the combinations:
 *
 * - **Grease** caps nothing: every entry, and the boundary besides.
 * - **Web** caps the entry alone — a creature that *starts* its turn inside
 *   has not entered, so leaving and coming back is still that turn's first
 *   entry and saves again.
 * - **Insect Plague** caps the creature: one save a turn whichever clause
 *   reached it first.
 *
 * **`at` is start or end and never a vague "boundary".** Where the two fall is
 * a full round apart, and the engine has counted turns begun and turns ended
 * separately since durations landed precisely so that they cannot be confused.
 */
export interface AreaTrigger {
  /**
   * SRD "starts its turn there" / "ends its turn there".
   *
   * Absent means the spell names no boundary at all — which is a real state,
   * not an omission: a spell can trigger only on entry.
   */
  readonly at?: TurnMoment;
  /**
   * SRD "enters the area", and how often it may do so in one turn.
   *
   * Absent means entering does nothing, which is Stinking Cloud. A cloud next
   * door having an entry clause must not lend it one.
   */
  readonly onEntry?: 'every-entry' | 'first-per-turn';
  /**
   * SRD "when the spell's area moves into its space".
   *
   * The area arrives; the creature has not moved. Four spells print it —
   * Moonbeam, Cloudkill, Incendiary Cloud and Spirit Guardians — and every one
   * of them is a spell whose area the rules go on to move. **Absent is the
   * ordinary case and must stay that way**: Insect Plague, Web, Grease and
   * Black Tentacles print no such clause, their areas never move, and a
   * neighbouring spell's moving-area sentence lends a fixed area nothing.
   *
   * Deliberately not implied by {@link onEntry}. They are two clauses in one
   * SRD sentence, they can be capped differently, and conflating them is how
   * Web's entry cap would come to be spent by a beam sliding overhead.
   */
  readonly onAreaEntry?: true;
  /**
   * SRD "A creature makes this save only once per turn."
   *
   * Caps the *creature*, across every clause above, for one casting. Distinct
   * from `onEntry: 'first-per-turn'`, which caps only the entering — and the
   * difference is observable exactly once: a creature that starts its turn in
   * a Web and then re-enters it saves twice, where Insect Plague would have
   * caught it once.
   *
   * Moonbeam is the spell that proves the cap really does span every clause:
   * "A creature also makes this save when the spell's area moves into its
   * space and when it enters the spell's area or ends its turn there. A
   * creature makes this save **only once per turn**." One sentence names three
   * clauses and the next caps the creature across all of them.
   */
  readonly oncePerTurn?: true;
  /**
   * What the trigger does, in the same vocabulary the casting itself uses.
   *
   * Run through the ordinary spell machinery at the level and route the
   * casting was made with, so there is no second save calculator and no second
   * damage resolver. Usually a copy of the spell's own `effects`; Web's is the
   * only thing Web ever does, because its casting affects nobody.
   */
  readonly effects: readonly SpellEffect[];
  /** How the roll reads in the log: "Insect Plague (the swarm)". */
  readonly label: string;
}

/**
 * A point in the scene that the casting keeps, and measures from.
 *
 * SRD Spiritual Weapon: "The force appears within range **in a space of your
 * choice**, and you can immediately make one melee spell attack against one
 * creature **within 5 feet of the force**. ... As a Bonus Action on your later
 * turns, you can **move the force up to 20 feet** and repeat the attack
 * against a creature within 5 feet of it."
 *
 * Three numbers in that paragraph and only two are here. The **60 feet** is
 * the spell's printed Range and lives in `range`, because it governs where the
 * casting may reach to put the point down — the same 60 feet an area spell
 * reaches to centre a Sphere. The other two are about the point itself.
 *
 * **A point is a point until a mechanic proves it is more.** Nothing here is
 * an object, an entity or a record with properties: a casting either holds a
 * point or does not, and what that point *is* in the fiction — a spectral
 * mace, a storm cloud, a mass of webbing — is narration.
 *
 * The two SRD families this covers share the storage and not the commands:
 *
 * | | Spells | Field |
 * |---|---|---|
 * | Chosen once and kept | Call Lightning's cloud, Web's cube | `movableBy` absent |
 * | Steered on a later turn | Spiritual Weapon, Flaming Sphere, Arcane Eye | `movableBy` in feet |
 *
 * A fixed origin gets no move command rather than a move command it refuses,
 * which is why the allowance is the field and not a boolean beside one.
 */
export interface CastingOrigin {
  /**
   * How far from the point the spell's own targeting reaches, in feet.
   *
   * "one creature within 5 feet of the force" — measured from the force, both
   * on the casting turn and on every later one, which is the whole reason this
   * lives here rather than on the activation. `SpellActivation.range` is the
   * caster-measured version and a definition has one or the other.
   */
  readonly reach: number;
  /**
   * How far the caster may move it on a later activation, in feet.
   *
   * Absent for an origin the SRD never moves. Do not add a number because a
   * spell has a point: Web's 20-foot Cube stays exactly where it was conjured.
   */
  readonly movableBy?: number;
}

/**
 * The game's creature types, as SRD 5.2.1's glossary prints them.
 *
 * > "Every creature, including every player character, has a tag in the rules
 * > that identifies the type of creature it is. ... The types don't have rules
 * > themselves, but **some rules in the game affect creatures of certain types
 * > in different ways.**"
 *
 * A closed list because the SRD closes it, and it is what the validator holds
 * a definition against: a clause naming `Goblinoid` is naming a **subtype
 * tag**, which is a different thing and has no rules of its own.
 */
export const CREATURE_TYPES: readonly string[] = [
  'Aberration',
  'Beast',
  'Celestial',
  'Construct',
  'Dragon',
  'Elemental',
  'Fey',
  'Fiend',
  'Giant',
  'Humanoid',
  'Monstrosity',
  'Ooze',
  'Plant',
  'Undead',
];

/**
 * Whether a creature's declared type is the one a rule names.
 *
 * **The type, never a substring of it.** SRD 5.2.1 prints a Goblin Warrior as
 * "Small **Fey** (Goblinoid)": the type changed in 2024 and Goblinoid is a
 * subtype tag riding beside it, so a rule naming Humanoid must not reach a
 * goblin and a rule naming Goblinoid must not reach anything at all. Matching
 * by containment gets both of those wrong in opposite directions, and
 * `CLAUDE.md` records that every 2014 instinct about who is a Humanoid is
 * worth re-reading.
 *
 * Case-insensitive, because the fact arrives from three places — a species, a
 * stat block, a `creature-type-declared` — and only the last is a caller's
 * free-typed string.
 *
 * **Null is not a match, and it is not a refusal either.** A creature nobody
 * has typed is a thin record: the caller asks whoever knows and tries again,
 * which is why every reader of this checks for the absence *before* asking the
 * question rather than reading `false` as "no".
 */
export const isCreatureType = (declared: string | null | undefined, named: string): boolean =>
  declared !== null && declared !== undefined && declared.toLowerCase() === named.toLowerCase();

/** Who a spell may be aimed at, and how many. */
export interface TargetRule {
  readonly count: number;
  /** SRD upcasting: "one additional Humanoid for each spell slot level above 2." */
  readonly extraPerSlotLevelAbove?: number;
  /**
   * A creature type the target must be, when the spell says so.
   *
   * Checked against the target's own declared type. A creature whose type
   * nobody has stated is not waved through: the cast comes back asking for it,
   * because a silent pass would be the engine claiming to have checked
   * something it could not see.
   */
  readonly mustBeType?: string;
  /**
   * SRD Mage Armor: "You touch a willing creature **who isn't wearing armor**."
   *
   * A clause about who may be targeted, so it lives beside {@link mustBeType}
   * where the target rules are, rather than on the effect. Distinct from the
   * effect being inert while armour is worn — that is the Armour Class coming
   * out right; this is the casting being refused rather than spending a slot
   * on a creature the spell cannot touch.
   *
   * Checked only where a caller **names** targets, which is every spell that
   * prints the clause. An area filters rather than refuses and no area spell
   * says this, so there is no branch there: a guard nothing can reach is not a
   * rule.
   */
  readonly mustBeUnarmored?: true;
  /**
   * SRD *Feather Fall*: "Choose up to five **falling** creatures within range."
   *
   * The third clause of this kind, and it reads a fact of a third sort: a
   * creature's type is durable and declared once, armour is authoritative
   * state the engine keeps, and a fall is a **moment** — so this asks
   * `fallWindowOpen` rather than the field, and a creature who fell a minute
   * ago is no more a target than one who never fell.
   *
   * Like `mustBeUnarmored` and unlike `mustBeType`, an absent declaration is a
   * plain **no** rather than a question: the trigger has already established
   * that somebody is falling, and asking who else might be would be inviting a
   * caller to add a second faller to widen the spell.
   */
  readonly mustBeFalling?: true;
  /**
   * SRD *Entangle*: "Each creature (**other than you**) in the area".
   *
   * The first of three clauses that narrow what an **area** catches, and all
   * three are read where the catch is settled rather than where a target is
   * named: an area filters, it does not refuse, so none of them can ever make
   * a casting illegal. `checkSpellDefinition` holds each to a definition that
   * has an `area` at all, because a filter on a catch nothing catches is a
   * field a reader would look for and never find applied.
   *
   * Different from {@link self}, which says whether a caster may *name*
   * themselves: this is a caster standing in their own square and simply not
   * being in the catch. And different from `designatesUnaffected` — SRD Spirit
   * Guardians' list of ids the caster spares — which is a choice the caster
   * makes at the casting rather than a rule the spell prints.
   */
  readonly notTheCaster?: true;
  /**
   * SRD *Hypnotic Pattern*: "Each creature in the area **who can see the
   * pattern**".
   *
   * The pattern is at the casting's origin, so the question is a creature's
   * sight of a *point* — `canSeePoint` in `standing.ts`, which is `canSee`
   * asked of a place. Three-valued like every other sight question in this
   * engine, and the third value is caught rather than passed over: **where
   * nobody has said, the creature is affected and the outcome names the
   * question**, which is the ruling SRD Faerie Fire's "if the attacker can see
   * it" already takes. The alternative reads a silence as a no and quietly
   * shrinks the spell.
   *
   * And a **point carries no declaration**: sight and cover are declared
   * between two creatures, so unlike `canSee` there is no line for a table to
   * state. What can settle it is the lattice — a bank of fog or a dark room
   * over the pattern's own space — and a sight sense that reaches it.
   */
  readonly mustSeeTheOrigin?: true;
  /**
   * SRD *Sleep*: "Each creature **of your choice** in a 5-foot-radius Sphere".
   *
   * The area still decides who *could* be caught; this says the caster picks
   * from among them, which is the difference between a Fireball and a spell
   * that leaves the party standing. The pick arrives in the cast request's
   * `targets` — the one list of ids a casting has, so there is no second place
   * for the same decision to be written — and lands pinned on the casting
   * exactly as any other target list does.
   *
   * Distinct from `targetsWithin`, which is SRD Slow's "up to six creatures of
   * your choice in a 40-foot Cube": there the template *bounds* a list the
   * caller names and the count is printed, and a creature outside the bound is
   * a refusal. Here the spell prints no count at all and the area is still the
   * spell's own area — the patch it lays, the trigger it raises and the record
   * it keeps are all the area's, and only the catch is narrowed.
   */
  readonly chosenFromTheArea?: true;
  /** Whether the caster may pick themselves. */
  readonly self?: boolean;
  /**
   * SRD "each creature of your choice", which names no number at all.
   *
   * Compulsion, Weird and Divine Word are all written this way. There is no
   * count to transcribe, and the spell is not unbounded either — range and
   * sight bound it, and both are already checked against every target. So
   * `count` has nothing honest to hold, and picking a generous number would
   * be the engine answering a question the SRD did not ask.
   *
   * Set alongside `count: 0`, which then means "no number stated" rather than
   * "aims at nobody".
   */
  readonly unlimited?: boolean;
  /**
   * SRD "you **can** ... make one melee spell attack": naming nobody is legal.
   *
   * Spiritual Weapon's force appears whether or not there is anything beside
   * it to hit, and the same sentence governs every later turn. Without this
   * the engine refuses the opening move of the spell — putting the weapon up
   * before anyone is in reach — on a rule the SRD does not have.
   *
   * Different from `unlimited`, which says the *count* is unstated. This says
   * the target list may be empty.
   */
  readonly optional?: true;
}

/**
 * What kind of thing a spell asks its caster to choose.
 *
 * Four members, and each one has a reader: a condition substitutes into the
 * conditions an effect imposes or removes, an ability and a skill into the
 * narrowing on a granted mode or bonus, and a creature type into the type a
 * summons arrives with — SRD Find Familiar's "a Celestial, Fey, or Fiend (your
 * choice) instead of a Beast". A fifth would be a vocabulary member nothing
 * keeps — see {@link SpellDefinition.choiceStated}.
 */
export type StatedChoiceOf = 'condition' | 'ability' | 'skill' | 'creature-type';

/** The choice a spell prints: what kind, and which values. */
export interface StatedChoice {
  readonly of: StatedChoiceOf;
  /** The values the SRD prints, in the order it prints them. */
  readonly options: readonly string[];
}

export interface SpellDefinition {
  /** The SRD slug, so a definition and its parsed record are the same spell. */
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly school: string;
  readonly castingTime: CastingTime;
  /**
   * How long a casting time of a minute or more takes, in whole seconds.
   *
   * **Required when `castingTime` is `long` and refused otherwise**, because
   * `long` is not a duration — it is the SRD's own bucket, "minutes or even
   * hours", and the engine cannot defer a casting to a moment nobody named.
   * The oracle holds it against the printed casting time in both directions,
   * so a definition claiming ten minutes where the book says an hour fails at
   * authoring rather than at the table. Never invented: `srdCastingSeconds`
   * parses the printed string, and a wording the grammar does not cover is a
   * parser problem rather than a plausible default.
   *
   * A Ritual is a long casting whatever this says — see {@link ritual} — so
   * this is the *non-ritual* casting time and 600 is added on top of it.
   */
  readonly castingSeconds?: number;
  /**
   * SRD: the spell prints the Ritual tag, so it has a Ritual version.
   *
   * "The Ritual version of a spell takes 10 minutes longer to cast than
   * normal. It also doesn't expend a spell slot, which means the ritual
   * version of a spell can't be cast at a higher level." A casting asks for it
   * with `CastSpellRequest.ritual`, and a spell that does not carry the tag
   * refuses the request rather than quietly casting normally.
   *
   * Transcribed and oracled like every other printed field, rather than read
   * out of `SPELL_INDEX` at cast time: a definition is the engine's
   * authoritative answer about a spell, and the book is what checks it.
   */
  readonly ritual?: true;
  readonly concentration: boolean;
  readonly range: SpellRange;
  readonly targets: TargetRule;
  /**
   * The area it fills, for a spell that picks its own targets.
   *
   * A spell has an area *or* a target list, never both: "each creature in a
   * 20-foot-radius Sphere" is not a list of ids the caller chose, and letting
   * a caller pass ids alongside an area would let them pick who the Fireball
   * catches. `targets.count` is ignored when this is set.
   */
  readonly area?: SpellArea;
  /**
   * What the area goes on doing to creatures after the casting — see
   * {@link AreaTrigger}.
   *
   * Set only alongside `area`. An area that the rules later move prints "when
   * the area moves into its space" as its own clause and states it in
   * {@link AreaTrigger.onAreaEntry}; an area that stays where it was put
   * leaves that absent.
   */
  readonly areaTrigger?: AreaTrigger;
  /**
   * What the area does to a creature for as long as it stands in it — see
   * {@link AreaStanding}.
   *
   * Set only alongside `area`, and **not a trigger**: nothing fires, nothing
   * is rolled and no moment is named, because there is no moment. SRD Spirit
   * Guardians writes both sentences about one Emanation — "whenever a creature
   * enters the Emanation or ends its turn there, the creature must make a
   * Wisdom saving throw" is {@link areaTrigger}, and "Any other creature's
   * Speed is halved in the Emanation" is this.
   */
  readonly areaStanding?: AreaStanding;
  /**
   * What the area does to the **ground** — see {@link AreaTerrain}.
   *
   * Set only alongside `area`, and the third of the three fields above it
   * rather than a fourth kind of trigger: nothing fires, nothing is rolled,
   * and — unlike {@link areaStanding} — it is not about a creature at all.
   * SRD Web writes all three sentences about one Cube: "The first time a
   * creature enters the webs on a turn … it must succeed on a Dexterity
   * saving throw" is {@link areaTrigger}, and "The webs are Difficult
   * Terrain" is this.
   *
   * **A patch on the lattice, not a rule read off the catalogue.** The region
   * the casting resolved is pinned into a `difficult-terrain-declared` event
   * beside the cast, exactly as the area and the numbers are, so the fold
   * charges for the ground without opening a book. What keeps the patch
   * honest afterwards is the casting: it lapses the moment that casting
   * leaves `state.ongoing`, and a spell the book gives no ending — SRD Plant
   * Growth's Instantaneous overgrowth — leaves ground that simply stays
   * overgrown, which is what its paragraph says.
   */
  readonly areaTerrain?: AreaTerrain;
  /**
   * What the area does to the **light** — see {@link AreaLight}.
   *
   * The fourth of the four, on the same terms as the third: set only
   * alongside `area`, nothing fires, nothing is rolled, and it is not about a
   * creature at all. SRD Darkness writes one sentence about one Sphere and
   * this is the whole of it.
   */
  readonly areaLight?: AreaLight;
  /**
   * What the area does to **seeing through it**, where that is not the light
   * — see {@link AreaObscurement}.
   *
   * SRD Fog Cloud's "The Sphere is Heavily Obscured", which names no level of
   * light and could not have been written as one.
   */
  readonly areaObscurement?: AreaObscurement;
  /**
   * SRD "you can designate creatures to be unaffected by it".
   *
   * Two spells print it — Spirit Guardians and Alarm — which is what makes it
   * a transcribed clause rather than a general area filter. The caster names
   * them at the casting; the engine validates that they exist and remembers
   * the choice for the spell's whole duration.
   *
   * Absent means the spell offers no such choice and naming anybody is
   * refused, rather than quietly ignored.
   *
   * **{@link ALARM} is defined and does not carry it**, which is worth saying
   * here because this docstring named it before that definition existed. What
   * this field filters is which creatures an area's **effects** reach, and
   * Alarm's ward has no effects to reach anybody: what it does when it catches
   * somebody is tell the caster, which changes no authoritative state at all.
   * So the exemption is from a warning the DM gives and is the DM's along with
   * the warning — and the validator says the same thing from the other side,
   * refusing this field on a definition with no `area`.
   */
  readonly designatesUnaffected?: true;
  /**
   * The damage types this spell prints, where it prints more than one and
   * chooses between them on a fact about the caster.
   *
   * SRD Spirit Guardians: "3d8 Radiant damage (if you are good or neutral) or
   * 3d8 Necrotic damage (if you are evil)." The engine holds alignment only
   * for a character it built from choices, never for a monster or a declared
   * NPC, and inferring it from side, class or deity would be inventing the
   * fact rather than reading it. So the casting **states** which, the engine
   * refuses anything not on this list, and the answer is pinned on the
   * casting — the discipline declared cover and declared sight already follow.
   *
   * **The second user is what generalised it, and it states its type for the
   * opposite reason.** Spirit Guardians is not a choice — the SRD decides it
   * on a fact about the caster, and this records who is entitled to tell the
   * engine what the SRD decided. Protection from Energy *is* one: "Resistance
   * to one damage type of your choice: Acid, Cold, Fire, Lightning, or
   * Thunder". The mechanism is identical either way — a printed list, one
   * value named at the casting, anything off the list refused, the answer
   * pinned on the casting — so what generalises is the field and what stays
   * the spell's own is the reason. This docstring said a second user would be
   * that evidence; it is.
   */
  readonly damageTypeStated?: readonly string[];
  /**
   * The one thing this spell asks the caster to choose, and what it prints.
   *
   * SRD writes the sentence four ways over the spells this engine executes,
   * and every one of them is the same mechanism:
   *
   * > Blindness/Deafness: "it has the Blinded or Deafened condition (**your
   * > choice**)."
   * > Lesser Restoration: "end **one** condition on it: Blinded, Deafened,
   * > Paralyzed, or Poisoned."
   * > Enhance Ability: "**choose** Strength, Dexterity, Intelligence, Wisdom,
   * > or Charisma."
   * > Guidance: "You touch a willing creature and **choose a skill**."
   *
   * **`damageTypeStated` generalised, and along the axis that field's own
   * docstring predicted.** The mechanism there is a printed list, one value
   * named at the casting, anything off the list refused and the answer pinned;
   * what stayed the spell's own was the *reason* — Spirit Guardians reports a
   * fact the SRD decides, Protection from Energy makes a choice the caster is
   * offered. Here the reason is always the second one, and the only new fact
   * is **what kind of thing** is being chosen, which is why `of` exists and a
   * bare list would not have done. See {@link statedChoice} for where it lands.
   *
   * **The definition still carries a value** — Blindness/Deafness names
   * Blinded, Lesser Restoration names all four — so the shape is well-formed,
   * the sweep can cast it, and a reader of the definition alone sees a whole
   * spell. What the casting states is what actually lands, exactly as a stated
   * damage type is.
   *
   * **One choice per casting**, because the book prints one per spell. SRD
   * Enhance Ability's upcast asks for one *per target* — "You can choose a
   * different ability for each target" — and that is not a second field but a
   * casting whose effects differ across the creatures it caught, which is a
   * named missing shape of its own.
   *
   * **A value substituted into the effects, never a choice of which effects
   * run.** SRD Thaumaturgy's six wonders, Enlarge/Reduce's two halves and
   * Glyph of Warding's two glyphs are a choice *between effect lists*, and
   * nothing here can express one: `statedChoice` rewrites a field on an effect
   * that is already in the list. That is the second arm of this shape and it
   * is deliberately absent rather than half-built — an `of` member with no
   * reader is the promise the validator exists to stop the engine making.
   */
  readonly choiceStated?: StatedChoice;
  /**
   * How the individual dice of this spell's damage behave — see
   * {@link DieRule}.
   *
   * **On the definition rather than on an effect**, because the SRD's sentence
   * is about the spell: "If you roll an 8 on a d8 **for this spell**". A spell
   * whose damage arrives at two targets by two different branches — an attack
   * that hits, and the splash a miss still deals — prints the clause once, and
   * a field per effect would make a definition say it twice and let the two
   * copies disagree.
   *
   * Refused on a definition that rolls no damage of its own
   * (`die_rule_rolls_nothing`), for the reason every other reachability rule in
   * the validator exists: a rule about dice nothing throws is a line in the
   * book that quietly does nothing.
   *
   * **And refused on one that rolls its damage more than once**
   * (`die_rule_rolls_more_than_once`), which is the honest form of a limit
   * rather than a rule about spells. A cap is a budget for the whole casting
   * and the generator counts bonus dice against the roll it is in, so a spell
   * that throws its damage at three creatures would be allowed the cap three
   * times.
   *
   * What the guard checks is the routes `rollsDamageTwice` enumerates, and it
   * is a **list rather than a derivation** — so a route added to the resolution
   * layer is a clause that has to be added there too, and the bullets beside
   * that function are where the reading lives rather than here. The day
   * something carries one budget across the rolls of a casting — the shape
   * `CastingAlterations.addend` already has, for the same reason — the whole
   * refusal goes and an area may declare one.
   */
  readonly dieRule?: DieRule;
  /**
   * An area the targets the caller names must all be standing in.
   *
   * The third way an SRD spell finds its targets, and it is neither of the
   * other two. Mass Cure Wounds says "Choose up to six creatures in a
   * 30-foot-radius Sphere centered on [a point you can see within range]": an
   * `area` would pick its own targets and heal every enemy in the Sphere,
   * which is not the spell, while a plain target list would let the caster
   * heal anyone in range and ignore the Sphere altogether.
   *
   * So the caller still names who is affected and this bounds who may be
   * named. **The range then belongs to the point, not to each target** — the
   * SRD reaches 60 feet to place a 30-foot Sphere, so a creature 85 feet away
   * is a legal target, and measuring it from the caster would wrongly refuse
   * it.
   *
   * Set this or `area`, never both: one says the geometry chooses, the other
   * says the geometry bounds a choice.
   */
  readonly targetsWithin?: SpellArea;
  /**
   * Which convention this spell's template footprint is read under.
   *
   * A coordinate cannot say whether it names a 5-foot space or the lattice
   * intersection four spaces share — they are the same three numbers — so the
   * thing holding it says, and for an area of effect that thing is either the
   * casting or the spell. `CastSpellRequest.anchoring` is the casting's say;
   * this is the spell's, and the precedence is
   * **request, then definition, then `space`**. The caster keeps the last word
   * because that field exists precisely so a caster who wants the other can
   * ask for it; this replaces the hard-coded default underneath.
   *
   * Absent on both, nothing changes at all: `space` is still normalised away
   * when the ongoing record is built, so every log written before this folds
   * byte for byte.
   *
   * **No SRD spell declares one, and that is a decision rather than a gap.**
   * SRD 5.2.1 mandates no convention — its "Playing on a Grid" sidebar covers
   * squares, Speed, entering a square, corners and ranges and says nothing
   * whatever about areas of effect, and the intersection convention comes from
   * a 2014 optional rule. Declaring one per spell would be the engine choosing
   * a rule the book declined to give. The field exists so that a deliberate
   * geometry pass, or an author of content the SRD never printed, says it in
   * data instead of in runtime logic.
   *
   * Refused without a template, and refused for a template that starts at the
   * caster: a `self` origin is a creature's own space, and a creature does not
   * stand on an intersection.
   */
  readonly anchoring?: PointAnchoring;
  /**
   * A point in the scene this casting keeps — see {@link CastingOrigin}.
   *
   * The caller chooses the space (`at`), the engine checks it against `range`
   * and the scene, and everything the spell does afterwards is measured from
   * it rather than from the caster. A casting with an origin is therefore on
   * **nobody**: the force is not on the creature it hit, and a Dispel Magic
   * aimed at that creature must not put it out.
   */
  readonly origin?: CastingOrigin;
  /**
   * What the engine does when the spell resolves.
   *
   * **An empty list is a deliberate state, not a stub.** Ninety-one SRD spells
   * do something the engine has no business deciding — Disguise Self changes
   * how you look, Speak with Animals lets you talk to a badger — and those are
   * the DM's and always will be. What is *not* the DM's is the cost: a slot
   * spent, an action taken, a Concentration given up, a clock started. A spell
   * with no effects is **tracked**: the engine spends everything the casting
   * costs and runs its duration, and `unmodelled` says what happens at the
   * table. Refusing the cast instead meant the slot was never spent.
   */
  readonly effects: readonly SpellEffect[];
  /**
   * Whether the spell says the caster must *see* the target.
   *
   * Hold Person does — "Choose a Humanoid that you can see within range" — and
   * Fire Bolt does not, which is the difference between needing a fact
   * established and not caring.
   */
  readonly requiresSight?: boolean;
  /** How long it lasts, in seconds. Omitted for an instantaneous spell. */
  readonly durationSeconds?: number;
  /**
   * How much longer it lasts when cast with a higher slot, by band.
   *
   * The key is **the lowest slot level of the band** and the value is the
   * whole duration in seconds — not an increase — so a band is read by finding
   * the highest key at or below the level cast. {@link durationSecondsAt} is
   * the one reader, and `durationSeconds` is what a level below every band
   * still gets.
   *
   * **A table per definition rather than a formula, because the SRD prints a
   * different table for each spell.** The two that sit next to each other in
   * the book are the argument:
   *
   * | | SRD | Table |
   * |---|---|---|
   * | Hunter's Mark | "level 3–4 (up to 8 hours) or 5+ (up to 24 hours)" | `{ 3: 28800, 5: 86400 }` |
   * | Hex | "level 2 (up to 4 hours), 3–4 (up to 8 hours), or 5+ (24 hours)" | `{ 2: 14400, 3: 28800, 5: 86400 }` |
   *
   * Both are level 1 Concentration spells capped at an hour, and Hex has a
   * band at 2 that Hunter's Mark does not. One shared field — "double it per
   * level", "eight hours from level 3" — would have made one of the two wrong
   * silently, and there is no arithmetic that produces both.
   *
   * **Five definitions write it** — Hunter's Mark, the three Dominates and
   * Mass Suggestion — and SRD Hex prints a sixth table that this field would
   * take whole, which is what makes it a member rather than a guess. Hex has
   * no definition to write it in: it is blocked on the ability chosen at its
   * casting and on the Bonus Action that re-marks a dropped target.
   *
   * What it deliberately does *not* express is SRD Major Image's "lasts until
   * dispelled, **without requiring Concentration**, if cast with a level 4+
   * spell slot" — one spell in the whole book, and a different sentence: it
   * changes what kind of duration the spell has rather than how long it runs.
   */
  readonly durationAtSlot?: Readonly<Record<number, number>>;
  /**
   * Parts of the printed spell this definition does **not** do.
   *
   * Most SRD spells are one clean mechanic plus a rider — Ray of Frost slows
   * the target, Thunderwave shoves it, Guiding Bolt hands the next attacker
   * Advantage — and the riders need machinery the engine does not have yet.
   * The choice is between not executing the spell at all and executing the
   * part it can while saying plainly what it left out.
   *
   * Saying so in a docstring is not enough: nobody at the table reads the
   * source. These come back in `unverified` on every casting, so the layer
   * narrating the spell knows exactly which half of it the engine did, and can
   * hand the rest to the DM instead of quietly dropping it.
   *
   * A spell with an empty list does everything its text says, and a spell with
   * no `effects` must have a non-empty one — a definition that resolved to
   * nothing and said nothing would be worse than the refusal it replaced.
   */
  readonly unmodelled?: readonly string[];
  /**
   * Printed text this spell hands to whoever is running the table.
   *
   * The owner's ruling: "**Some text is the DM's alone.** Commune, Dream's
   * Range `Special`, Mirage Arcane's `Sight`: the casting hands the printed
   * text to whoever is running the table, human or model, marked explicitly as
   * a thing only the DM can decide. Not a format arm to invent, a handover to
   * make visible."
   *
   * **Not `unmodelled` under another name**, and the difference is the whole
   * reason it is a second field. `unmodelled` is a debt: a clause the engine
   * does not execute *yet*, whose shape somebody will build and whose line
   * will then go — `missing-shapes.ts` counts them and ranks what to build
   * next. A handover is not on that list and will never be: Commune asks a
   * question of a god, and there is no engine that answers it. Filed as a gap
   * it would inflate a backlog with work nobody may do; filed here it is
   * visible as what it is.
   *
   * Each entry is the book's own words — a printed field like `Range: Sight`,
   * or a sentence of the spell's prose — carried out of every casting through
   * {@link handedOver} and readable again through {@link dmDecisionsIn}. The
   * engine never paraphrases one, never guesses a number for one, and never
   * lets one stand in for a rule it could have adjudicated: the slot, the
   * action, the Concentration, the clock and the ongoing record all happen
   * around it exactly as they would for any other casting.
   *
   * A definition whose `range` is `{ kind: 'dm' }` must carry one, because a
   * Range the format cannot state is precisely the text the ruling is about
   * and a silent one would be the engine quietly not checking a distance.
   *
   * **Where it reaches, and which event carries it.** Every casting reports it
   * in `unverified`, so the layer narrating the spell always has it, and a
   * casting also pins it into the log — CLAUDE.md's rule 5, and how a handover
   * folds back with no catalogue open. Which event holds it is the one thing
   * that differs, and it is always exactly one of two: a casting of a minute
   * or more, or one held open for a Counterspell, writes it onto
   * `spell-declared`, where `PendingCasting.unverified` carries it under its
   * mark beside everything else that declaration read; an **atomic** casting
   * has no declaration, so `spell-cast.dmDecides` carries the printed text
   * itself. Never both.
   *
   * `unmodelled` beside it is pinned by neither, and that is the difference
   * between the two fields again: a debt is a fact about the engine that ran
   * the casting rather than about the casting, and a log that had frozen one
   * would go on reporting a gap this engine had since closed.
   *
   * **Every casting keeps it, including the two that once did not.** A spell
   * cast at a Ready (`holdSpell`, whose `spell-cast` is written a turn before
   * the spell takes effect) and a spell cast on a hit (`castOnHit`) each passed
   * their definition's text to the caller and dropped it from the log. No SRD
   * spell that prints a handover can reach either — a Ready takes a spell cast
   * with an action and all three take a minute or more, and a spell cast on a
   * hit must print `attack-damage` — so nothing in the catalogue was losing
   * text; a homebrew definition reaching both is what made it worth closing,
   * and `dm-handover.test.ts` drives both on homebrew loaded through
   * `loadContent`.
   */
  readonly dmDecides?: readonly string[];
  /**
   * What a Reaction spell is cast in answer to, checked before anything is
   * spent. A spell with no trigger is not a Reaction spell and is unaffected.
   */
  readonly trigger?: ReactionTrigger;
  /**
   * A casting that ends at a moment in the turn order rather than after a span
   * of seconds.
   *
   * Shield lasts "until the start of your next turn", which is not six seconds
   * and not one round — see the durations section of CLAUDE.md for why folding
   * the two together is wrong. Separate from `durationSeconds` because a
   * definition means one or the other, never both.
   */
  readonly durationUntil?: RiderDuration;
  /**
   * SRD "Duration: Until dispelled" — the **absence** of a deadline, not a
   * large one.
   *
   * Distinct from Instantaneous, which also carries no seconds: one spell is
   * over and the other is still running with nothing to end it. Before this
   * field the two were indistinguishable, so {@link persists} answered no for
   * Arcane Lock and Continual Flame and neither left an ongoing record — which
   * is the one thing that makes a casting findable by Dispel Magic, or by
   * anything else that asks what is running.
   *
   * It schedules no timer. Inventing a big number of seconds would be the
   * engine answering a question the book declined to ask, which is the whole
   * reason this is a flag rather than a `durationSeconds`.
   */
  readonly untilDispelled?: true;
  /**
   * A check a creature may attempt against the casting itself.
   *
   * The illusions: nothing is on anybody, so what is examined is the spell.
   * It rides on the casting's own timer, which means a spell with no duration
   * offers nothing to examine — correct, because there is nothing left
   * standing there to look at.
   */
  readonly check?: SpellCheck;
  /**
   * What the caster may do again, on a later turn, through a spell that is
   * still running.
   *
   * SRD Vampiric Touch: "Until the spell ends, you can make the attack again
   * on each of your turns **as a Magic action**"; Flame Blade: "**As a Magic
   * action**, you can make a melee spell attack with the fiery blade."
   *
   * **Only the caster, and only what the spell already does.** The effects run
   * with the level the casting was made at and the route that supplied it, so
   * a wizard who levels mid-fight does not upgrade a spell already in the air.
   *
   * One target, because every spell that writes this takes one — "targeting
   * the same creature or a different one", "repeat the attack against a
   * creature within 5 feet of it". A casting that holds an `origin` measures
   * that one target from the point rather than from the caster, and may also
   * move the point in the same action; nothing else about the shape changes.
   */
  readonly activation?: SpellActivation;
  /**
   * What this spell puts in its caster's hand — see {@link ConjuredItems}.
   *
   * Beside `activation` because the two are the same kind of field: a fact
   * about the spell that outlives the moment it was cast. A definition that
   * conjures something **resolves something**, so it needs no `unmodelled`
   * line to be honest with an empty effect list — the berries are the spell.
   */
  readonly conjures?: ConjuredItems;
  /**
   * SRD Mage Hand: "The hand vanishes ... **if you cast this spell again**";
   * Minor Illusion: "The illusion ends if you cast this spell again."
   *
   * The same caster casting the same spell. Two spells write the sentence
   * identically, which is what makes it a rule rather than a quirk, and the
   * ongoing record is what makes obeying it a lookup instead of a search.
   */
  readonly replacesPriorCasting?: true;
  /**
   * What stops this casting before its time is up.
   *
   * A casting has always ended four ways — its deadline, a broken
   * Concentration, a dispel, a recast — and every one of them is either a
   * moment on the clock or somebody's decision. The SRD writes a fifth: a
   * spell that stops because **something happened**, and nobody decided it.
   * Each member below is one such sentence transcribed rather than a category
   * somebody invented.
   *
   * Absent for every spell that prints no such sentence, which is almost all
   * of them — and deliberately absent from Greater Invisibility, whose whole
   * difference from Invisibility is that it prints the first sentence and not
   * the second.
   */
  readonly endsEarly?: readonly CastingEndTrigger[];
}

/**
 * What has to happen for a casting to stop early, as the book writes it.
 *
 * **A closed list, and what keeps it closed is that each member names a fact
 * the log already holds on an event that already has consequences.**
 * `target-deals-damage` is `damage-taken` naming its dealer — the field
 * Hellish Rebuke needed, because prose cannot be aimed at — and
 * `target-dons-armor` is `item-equipped` naming a piece of body armour. A
 * trigger whose fact the log does not hold is filed in `missing-shapes.ts`
 * instead: Sequester's caster-chosen condition, Faithful Hound's 300 feet,
 * Guardian of Faith's running total and Tiny Hut's caster stepping out of
 * their own dome are all still there.
 *
 * The first four are {@link EffectEndCause}, declared in `timers.ts` because a
 * timer an item filed reads them too; the rest are what a casting adds,
 * because only a casting has a caster for "you or one of your allies" to be
 * about and only a casting can be **sustaining** a creature.
 *
 * **Two axes, and the members are their cross section rather than their
 * product.** A cause says what happened *and* whom it happened to, because
 * those are the two things `fold/endings.ts` has to know and because the SRD
 * writes them together in one clause. Every member but the last names a
 * creature the casting is **on**, which `isOn` is the gate for; the last names
 * the creature the casting put in the world, which `isOn` answers no about —
 * a summon holds nothing of the casting, the casting holds the summon. A
 * member is written the day a definition writes it and not before, which is
 * why there is no `summon-drops-to-0`: SRD Unseen Servant prints it and its
 * stat block is a shape this engine does not have.
 *
 * **`target-attacks` is `attack-made`, which is the Attack action rather than
 * every attack roll.** The only thing that names the roller of an attack that
 * costs nothing — an Opportunity Attack, an attack outside combat — is
 * `roll-recorded`, and that event changes no state by rule, so nothing may
 * hang a consequence on it. What is reachable is recorded in Invisibility's
 * own `unmodelled`; a missed free swing is the whole of the residue, because
 * one that lands deals damage and `target-deals-damage` catches it.
 */
export type CastingEndCause =
  /**
   * The four that are a fact about one creature, declared in `timers.ts`.
   *
   * **The same four sentences, whether a casting or a potion is what ends.**
   * SRD prints "the target makes an attack roll, deals damage, or casts a
   * spell" on Invisibility *and* on the Potion of Invisibility, and "dons
   * armor" on Mage Armor; a timer an item filed reads them off the same events
   * through the same `EndingFact`. A second spelling here would be one
   * sentence written twice, so this is `EffectEndCause` and the member below
   * is what a casting adds to it.
   */
  | EffectEndCause
  /**
   * Animal Friendship: "If you or one of your allies deals damage to the
   * target, the spells ends." — transcribed as the raw file prints it.
   *
   * Charm Person and Charm Monster write the same rule as a bound on the
   * condition, "until you or your allies damage it"; Suggestion and Mass
   * Suggestion as "until you or your allies deal damage to the target".
   *
   * **"Ally" is declared allegiance, and an undeclared one is withheld rather
   * than invented** — the three-valued reading declared cover, declared sight
   * and Sneak Attack's flanking clause already take. The caster is never in
   * doubt, because the sentence names them. `withheldEndings` is the query
   * that says which castings this leaves unjudged, since a derived pass has no
   * `unverified` line to write one on.
   */
  | 'caster-or-ally-damages-target'
  /**
   * SRD Hypnotic Pattern: "The spell ends for an affected creature if it takes
   * any damage."
   *
   * **Any** damage, which is why this is not `target-deals-damage` read
   * backwards and not `caster-or-ally-damages-target` with the allegiance
   * dropped: both of those read the creature at the *other* end of the blow,
   * and a falling rock is at no end of it at all. `damage-taken` names its
   * victim on every blow it records, dealer or no dealer, so this is the
   * cheapest fact in the list and the one the four dealer-shaped causes walk
   * straight past.
   *
   * **Any damage is still damage and not a hit.** A blow a Resistance or an
   * Immunity took down to nothing writes a `damage-taken` for zero, and this
   * does not fire on it — the reading `breakLostConcentration` already takes
   * off the same event, because a Concentration save is not owed for a blow
   * that did nothing either.
   */
  | 'target-takes-damage'
  /**
   * SRD Gaseous Form: "The spell ends on the target if it drops to 0 Hit
   * Points."
   *
   * **The drop, not the damage** — one moment with two facts in it, and the
   * reason this is a second member rather than a scope on the one above. It is
   * read off a `damage-taken` that leaves the creature at 0, which is the same
   * "ask the state the event left behind" that `target-dons-armor` already
   * takes. What it reads is therefore the **total** and not the transition,
   * and two residues follow, said plainly rather than argued away. A Hit Point
   * maximum lowered onto 0 is no blow and reaches this nowhere. And a creature
   * already at 0 taking another blow pulls it, which costs nothing for the
   * spells in the book — their first drop ended them — but would end a casting
   * laid on a creature that was already down at the next blow rather than at a
   * fall. A blow that dealt nothing is not one of them: this fires only where
   * `target-takes-damage` does.
   */
  | 'target-drops-to-0'
  /**
   * SRD Phantom Steed: "the spell ends if the steed takes any damage."
   *
   * **The creature the casting is sustaining, which is neither a target nor an
   * ally.** `isOn` asks what a creature is *holding* of a casting and a steed
   * holds nothing — no condition, no bonus, no grant — so every other member
   * here would walk past it however the cause were spelled. What answers is
   * `CreatureState.summonedBy`, the link `strandedSummons` already reads, and
   * that link is the whole difference: this is a casting ending because
   * something happened to the thing it put in the world.
   */
  | 'summon-takes-damage'
  /**
   * SRD Sleep: "The spell ends on a target if it takes damage or **someone
   * within 5 feet of it takes an action to shake it out of the spell's
   * effect**." SRD Hypnotic Pattern writes the same clause as "if someone else
   * uses an action to shake the creature out of its stupor."
   *
   * **The one ending in the vocabulary that somebody else spends an action
   * on**, and the reason it is a cause rather than a check the sleeper makes:
   * every other member here is read off an event that happened *to* the
   * creature the casting is on, and this is read off an event a neighbour
   * wrote. `creature-woken` is that event, `wakeCreature` is the door, and the
   * five feet and the action are spent there — so what reaches this list is
   * the same shape everything else in it is: a fact the log already holds,
   * naming one creature.
   */
  | 'shaken-awake';

/**
 * One printed sentence: what happens, and what it ends.
 *
 * **The scope is transcribed, not defaulted**, because the SRD prints both and
 * means them differently. Animal Friendship and Mage Armor say "the spell
 * ends"; Charm Person bounds the Charmed condition "until the spell ends or
 * until you or your allies damage **it**", and Mass Suggestion spells the
 * difference out in the same paragraph — "the spell ends **for a target**".
 * Choosing one for both would make a level 3 Charm Person release two
 * creatures for one blow, or leave Animal Friendship running on a Beast the
 * party has just shot.
 */
export interface CastingEndTrigger {
  readonly on: CastingEndCause;
  /**
   * `casting` ends the whole thing, through `releaseCasting`; `target`
   * releases it on the creature the trigger names and leaves the casting
   * running for everyone else, through `releaseOnTarget`. Both doors already
   * existed — this is the field that says which one a sentence means.
   *
   * **`target` needs a creature the casting is on to release**, so it is
   * refused on `summon-takes-damage`: a summon holds nothing of the casting,
   * and `releaseOnTarget` asked about one would lift nothing and leave the
   * spell running. A sentence that could never fire compiles, which is why the
   * validator says so instead.
   */
  readonly ends: 'casting' | 'target';
}

/**
 * Something a spell puts in its caster's hand for as long as it lasts.
 *
 * SRD Goodberry: "Ten berries appear in your hand and are infused with magic
 * for the duration." SRD Flame Blade: "You evoke a fiery blade in your free
 * hand." Two spells, one sentence shape, and what it needs is what a creature
 * is **holding** — which is why this is a field on the definition rather than
 * a member of the effect union: the effects are what a spell does to its
 * targets, and every sentence of this shape in the book puts the thing in the
 * caster's own hand whoever else the spell is aimed at.
 *
 * **What appears is content.** The berry and the blade are catalogue items,
 * validated by the same door every other item goes through, so what eating one
 * does is the item's `confers` grant and what swinging one does is its weapon
 * record. The engine learns no berry's name: it reads an id off a definition
 * and hands the line to the inventory it already keeps.
 *
 * The lifetime is the casting's, derived rather than folded — see
 * {@link InventoryLine.casting}.
 */
export interface ConjuredItems {
  /** The catalogue id of the thing that appears. */
  readonly item: string;
  /** How many of it. Ten berries, one blade. */
  readonly count: number;
  /**
   * How many hands the whole handful takes up. Absent is one.
   *
   * Of the handful and not of each: ten berries appear in *a* hand, and the
   * count is what the spell prints rather than what the hand can hold. Zero is
   * a legitimate answer for a conjured thing that is worn or that follows the
   * caster around, and the reason this is a number rather than a flag.
   */
  readonly hands?: number;
  /**
   * The action that evokes it again once it has been let go of.
   *
   * SRD Flame Blade: "If you let go of the blade, it disappears, but you can
   * evoke the blade again as a Bonus Action." Absent for a spell that prints
   * no such clause — Goodberry's berries, once dropped, are dropped — and
   * `evokeConjured` refuses rather than inventing the sentence.
   */
  readonly retake?: 'action' | 'bonus-action';
}

/** What an ongoing spell lets its caster do again. */
export interface SpellActivation {
  /** SRD writes "a Magic action" or "a Bonus Action"; both appear. */
  readonly action: 'action' | 'bonus-action';
  /**
   * How far the **caster** reaches, checked afresh each time.
   *
   * Absent when the casting holds an origin: the reach is then measured from
   * that point and `CastingOrigin.reach` is the number. A definition has one or
   * the other and never both — two fields saying five feet would be two places
   * to get one sentence wrong, and `spell-catalogue.test.ts` pins it.
   */
  readonly range?: SpellRange;
  /**
   * How far this action may move the spell's own persistent area, in feet.
   *
   * SRD Moonbeam writes the action and the allowance as one clause — "you can
   * take a **Magic action** on later turns to **move the Cylinder up to 60
   * feet**" — and that clause is the entire content of the action. There is
   * no attack, no target and no effect of its own: what the move may cause is
   * the spell's own area-entry clause catching whoever the beam arrives on,
   * and that is {@link AreaTrigger.onAreaEntry}, not something listed here.
   *
   * **Not {@link CastingOrigin.movableBy}, and the SRD separates them.**
   * Spiritual Weapon's is a rider on an action that also strikes — "move the
   * force up to 20 feet **and** repeat the attack" — so the move is optional
   * and something else is the point of the Bonus Action. Here the move *is*
   * the action, so a caller who names no destination has spent a Magic action
   * on nothing and is refused. Two sentences, two fields; one field would have
   * made a movement-only action indistinguishable from a rider that was
   * declined.
   */
  readonly movesArea?: number;
  /** How the log reads: "Vampiric Touch (again)". */
  readonly label: string;
  /**
   * What it does, run with the level and route pinned at the casting.
   *
   * Empty for an activation whose whole content is moving the area — see
   * {@link movesArea}. That is not a stub: Moonbeam's later Magic action
   * resolves nothing directly, and every creature it catches is caught by the
   * spell's own trigger through the ordinary debt.
   */
  readonly effects: readonly SpellEffect[];
}

// — reading a definition ——————————————————————————————————————————————————————
//
// Seven questions about a definition, each answered by reading one field of
// it. They lived in `commands.ts` until the command layer was split by domain,
// where they were four regions apart and none of them was about a command:
// every one is a property of the spell as written, so it belongs beside the
// type that declares the field it reads.

/**
 * Whether a casting is on its own caster rather than on whom it was aimed at.
 *
 * The SRD keeps Range and target apart and so does this. A Range: Self spell
 * is on its caster however far its effects reach — Vampiric Touch attacks
 * somebody new every turn and is on the wizard the whole time. Dispel Magic
 * reads the result, so getting this backwards would let a fighter end the
 * wizard's Vampiric Touch by standing still and being punched.
 */
export function onCaster(definition: SpellDefinition): boolean {
  return definition.range.kind === 'self';
}

/**
 * Whether this casting leaves anything running.
 *
 * A duration, a Concentration, or "Until dispelled" — which is what "ongoing"
 * means in the SRD's own Duration line. Instantaneous spells leave nothing and
 * get no record: Fireball is history the moment it lands.
 *
 * **"Until dispelled" is the case this used to get wrong.** It asked for a
 * deadline, and a spell with none looked exactly like an Instantaneous one, so
 * Arcane Lock and Continual Flame left no record at all — running, by the
 * book, and invisible to everything that asks what is running. The record they
 * get carries no timer, because there is no moment to schedule.
 */
export function persists(definition: SpellDefinition): boolean {
  return (
    definition.concentration ||
    definition.durationSeconds !== undefined ||
    definition.durationUntil !== undefined ||
    definition.untilDispelled === true
  );
}

/**
 * The form a summoning spell leaves to its caster, or null where the spell
 * names its own stat block.
 *
 * At most one per definition, because `checkSummonTargets` already holds a
 * summons to one effect on one target and the request carries one `form`.
 */
export function statedFormOf(
  definition: SpellDefinition,
): Exclude<SummonedForm, string> | null {
  for (const effect of definition.effects) {
    if (effect.kind === 'summon' && typeof effect.monster !== 'string') return effect.monster;
  }
  return null;
}

/**
 * How long a casting of this spell at this slot level runs, in seconds.
 *
 * The one reader of {@link SpellDefinition.durationAtSlot}, so the two places
 * that schedule a casting's deadline — the ordinary resolution and the release
 * of a readied spell — cannot disagree about which band a slot falls in.
 *
 * **The band is "at this level or above"**, which is how the SRD writes it:
 * "level 3–4 (up to 8 hours) **or 5+** (up to 24 hours)" is two keys, 3 and 5,
 * and a level 4 slot falls in the first because 5 has not been reached. So the
 * answer is the highest key at or below `castLevel`, and `durationSeconds` is
 * what a slot below every band still gets.
 *
 * A cantrip has no slot to read, and `castLevel` is its own level there, which
 * falls below every band by construction — the validator refuses a band on a
 * cantrip rather than leaving that to arithmetic.
 */
export function durationSecondsAt(
  definition: SpellDefinition,
  castLevel: number,
): number | undefined {
  const bands = definition.durationAtSlot;
  if (bands === undefined) return definition.durationSeconds;

  let best: number | undefined;
  let bestLevel = -Infinity;
  // Sorted rather than trusting key order: numeric keys iterate in ascending
  // order today and this answer reaches a deadline in the log, which is not a
  // thing to leave resting on an engine's iteration rules.
  for (const key of Object.keys(bands).map(Number).sort((a, b) => a - b)) {
    if (key <= castLevel && key > bestLevel) {
      bestLevel = key;
      best = bands[key];
    }
  }
  return best ?? definition.durationSeconds;
}

/**
 * The value of the band this level falls in, or the base where it falls below
 * every band.
 *
 * `durationSecondsAt`'s arithmetic, lifted so the weapon rider's two tables
 * cannot come to read their keys differently from the duration's. "The band is
 * at this level or above" is the SRD's own phrasing — "level 3–5 … level 6+"
 * is two keys, 3 and 6, and a level 5 slot falls in the first because 6 has
 * not been reached.
 *
 * Sorted rather than trusting key order, for the reason `durationSecondsAt`
 * sorts: this answer reaches a grant in the log.
 */
const bandAt = <T,>(
  bands: Readonly<Record<number, T>> | undefined,
  level: number,
  base: T,
): T => {
  if (bands === undefined) return base;
  let best = base;
  let bestLevel = -Infinity;
  for (const key of Object.keys(bands).map(Number).sort((a, b) => a - b)) {
    if (key <= level && key > bestLevel) {
      bestLevel = key;
      best = bands[key] as T;
    }
  }
  return best;
};

/**
 * SRD Magic Weapon's plus at the slot it was cast with.
 *
 * The one reader of `bonusAtSlot`, so the resolver that pins the number and
 * any later reader of the same table cannot disagree about which band a slot
 * falls in — the discipline `durationSecondsAt` keeps for the duration.
 */
export const weaponRiderBonusAt = (
  effect: EffectOfWeaponRider,
  castLevel: number,
): number | undefined =>
  effect.bonus === undefined ? undefined : bandAt(effect.bonusAtSlot, castLevel, effect.bonus);

/**
 * SRD Shillelagh's die at the caster's own level.
 *
 * Off the **character's** level and not the slot's: a Cantrip Upgrade is a
 * band of the caster's career, which is the same split `DiceScaling` keeps
 * between `cantripUpgradesAt` and `perSlotLevelAbove`.
 */
export const weaponRiderDieAt = (
  effect: EffectOfWeaponRider,
  casterLevel: number,
): string | undefined =>
  effect.die === undefined ? undefined : bandAt(effect.dieAtLevel, casterLevel, effect.die);

/** The one arm of the effect union the two readers above are about. */
type EffectOfWeaponRider = Extract<SpellEffect, { kind: 'weapon-rider' }>;

/**
 * The extra dice a casting's own swing adds at the caster's level, or
 * undefined below every band.
 *
 * `bandAt` again, with **no base**: SRD True Strike's upgrade starts at level
 * 5 and a caster below it adds nothing. Undefined rather than a notation that
 * rolls no dice, for the reason the field's own docstring gives — `0d6` is not
 * notation this engine accepts anywhere else, and inventing it here would put
 * it in front of every reader of a damage component.
 */
export const swungExtraDiceAt = (
  bands: Readonly<Record<number, string>>,
  casterLevel: number,
): string | undefined => bandAt<string | undefined>(bands, casterLevel, undefined);

/** How far a range reaches in feet, or null where it is not a distance at all. */
export const ranged = (range: SpellRange): number | null =>
  range.kind === 'ranged' ? range.feet : range.kind === 'touch' ? 5 : null;

/**
 * The shortest reach any swing in this list states, or null where none does.
 *
 * SRD Vampiric Touch's "within reach" — see `attack.reach`, where the two
 * distances are told apart. The **shortest**, because a list whose swings
 * reached different distances would be asking for every one of them to be in
 * range of a creature the casting names once; no SRD spell writes two, and
 * taking the loosest of them would let one arm excuse another.
 *
 * Only the spell's own effects, never an activation's: an activation states
 * its reach in its own `range`, which `reachFromCaster` has always measured.
 */
export const swingReachIn = (effects: readonly SpellEffect[]): number | null => {
  let shortest: number | null = null;
  for (const effect of effects) {
    if (effect.kind !== 'attack' || effect.reach === undefined) continue;
    if (shortest === null || effect.reach < shortest) shortest = effect.reach;
  }
  return shortest;
};

/**
 * Whether resolving this effect needs dice thrown from the caster's own sheet.
 *
 * A saving throw does not: the DC is pinned on the casting and the roll is the
 * *target's*. Everything else does — an attack is the caster's roll, and every
 * die of damage, healing or Temporary Hit Points goes through the caster's
 * sheet even when the spell's own dice are all that survive the filter.
 *
 * The distinction exists for exactly one case: a non-Concentration area whose
 * caster has left. SRD Grease is the only registered spell in it and its
 * trigger is a bare save, so the other branch is unreachable through content
 * — which is asserted rather than assumed.
 */
export const needsCasterSheet = (effect: SpellEffect): boolean => effect.kind !== 'save';

/**
 * A spell's effects, using the damage type this casting was declared with.
 *
 * SRD Spirit Guardians prints two and picks between them on the caster's
 * alignment, which is stated at the casting and pinned there — see
 * `OngoingSpell.damageType`. The definition carries one of the two so the
 * shape is well-formed and `spell-catalogue.test.ts` can cast it; the pinned
 * answer is what actually lands, and it is pinned rather than re-read for the
 * same reason the save DC is.
 *
 * **Two spells now, and they state it for two different reasons.** Spirit
 * Guardians states a fact the *SRD* decides and the engine does not hold;
 * Protection from Energy states a *choice* the caster makes — "Resistance to
 * one damage type of your choice: Acid, Cold, Fire, Lightning, or Thunder".
 * The mechanism is identical either way: a list the definition prints, one
 * value named at the casting and refused if it is not on the list, pinned on
 * the casting for as long as the spell runs. `damageTypeStated` said that a
 * second user would be the evidence anything here should generalise, and this
 * is it — the field generalises, and the *reason* stays the spell's own.
 *
 * **Both spellings of the field, because the SRD writes both.** Damage names
 * one type and a granted defence names a list, so a spell that chooses at the
 * casting replaces whichever it has — for a list, with the one type chosen,
 * because "one damage type of your choice" is exactly one.
 *
 * Absent for every other spell, where the printed type is the only type and
 * this is the identity function.
 */
export function statedDamageType(
  effects: readonly SpellEffect[],
  damageType: string | undefined,
): readonly SpellEffect[] {
  if (damageType === undefined) return effects;
  return effects.map((effect) => {
    if ('damageType' in effect && effect.damageType !== undefined) {
      return { ...effect, damageType };
    }
    if ('damageTypes' in effect && effect.damageTypes !== undefined) {
      return { ...effect, damageTypes: [damageType] };
    }
    return effect;
  });
}

/**
 * A spell's effects, using the value this casting chose.
 *
 * {@link statedDamageType}'s sibling and written to the same rule: the
 * definition carries a value so the shape is well-formed, the casting carries
 * the answer, and the answer is what lands. Which effects it touches is a
 * question of `of` rather than of the spell, so a homebrew definition reaches
 * it through the same door the SRD's four do.
 *
 * | `of` | What it rewrites | The SRD sentence |
 * |---|---|---|
 * | `condition` | the condition a `save` or `condition` imposes; the whole list an `end-condition` removes | "the Blinded or Deafened condition (your choice)"; "end **one** condition on it" |
 * | `ability` | the ability on a granted mode's selector, and on a bonus's narrowing | "choose Strength, Dexterity, …" |
 * | `skill` | the skill on those same two | "choose a skill" |
 *
 * **A removal collapses to one and an imposition replaces one**, which is the
 * difference between the two sentences rather than a special case: Lesser
 * Restoration prints four and ends one of them, and Blindness/Deafness prints
 * two and imposes one. Both come out as the single value the caster named.
 *
 * **The definition declares the slot and the casting fills it.** A `save` with
 * no condition, a selector that names no skill, a bonus with no narrowing at
 * all: every one of them is returned untouched, so a choice never *creates* a
 * field. One half of that keeps the validator honest without further help — a
 * choice that would have landed nowhere is `stated_choice_reaches_nothing` at
 * authoring rather than a clause silently dropped.
 *
 * **The other half needs a rule, because a replaced value can disagree with a
 * neighbour that was not replaced.** A {@link RollSelector} may name an
 * ability *and* a skill and they must agree; so the definition that prints
 * `{ ability: 'wis', skill: 'insight' }` and offers a *skill* to choose would
 * validate, then produce `{ ability: 'wis', skill: 'stealth' }` at the table —
 * a selector describing a roll nobody makes, which matches nothing for ever
 * and says nothing about it. So the validator refuses a choice printed against
 * a pinned sibling (`stated_choice_collides`), and what is left really is
 * "one field of the same kind replaced by another".
 *
 * Absent for every spell that prints no choice, where this is the identity
 * function.
 */
export function statedChoice(
  effects: readonly SpellEffect[],
  of: StatedChoiceOf | undefined,
  chosen: string | undefined,
): readonly SpellEffect[] {
  if (of === undefined || chosen === undefined) return effects;
  return effects.map((effect) => {
    if (of === 'condition') {
      if (effect.kind === 'end-condition') {
        return { ...effect, conditions: [chosen as ConditionName] };
      }
      if (effect.kind === 'condition') {
        return { ...effect, condition: { ...effect.condition, name: chosen as ConditionName } };
      }
      if (effect.kind === 'save' && effect.condition !== undefined) {
        return { ...effect, condition: chosen as ConditionName };
      }
      return effect;
    }
    if (of === 'creature-type') {
      // SRD Find Familiar: "it is a Celestial, Fey, or Fiend (your choice)".
      // The type lands on the summons and nowhere else; a definition whose
      // summons prints no type for it to replace is refused at authoring.
      if (effect.kind === 'summon' && effect.creatureType !== undefined) {
        return { ...effect, creatureType: chosen };
      }
      return effect;
    }
    const key = of === 'ability' ? 'ability' : 'skill';
    if (effect.kind === 'roll-mode' && effect.modifier.selector[key] !== undefined) {
      return {
        ...effect,
        modifier: {
          ...effect.modifier,
          selector: { ...effect.modifier.selector, [key]: chosen },
        },
      } as SpellEffect;
    }
    if (effect.kind === 'buff' && effect.only?.[key] !== undefined) {
      return { ...effect, only: { ...effect.only, [key]: chosen } } as SpellEffect;
    }
    return effect;
  });
}

/**
 * A sibling field a substitution would leave disagreeing with what it wrote.
 *
 * An ability and a skill are a **pair** wherever either is written: a
 * {@link RollSelector} that names both must have them agree, and so must a
 * {@link BonusNarrowing}. {@link statedChoice} replaces one of the two and
 * leaves the other alone, so a definition that pins the sibling has printed a
 * value the casting is about to contradict — and the contradiction is exactly
 * the one the validator already refuses when an author writes it by hand.
 *
 * Asked of the effects rather than of the chosen value, because it is true or
 * false before anybody chooses anything: it is a property of the definition.
 *
 * Nothing to ask for `of: 'condition'`, which has no sibling — a condition
 * name stands alone wherever it is written.
 */
export function statedChoiceCollides(
  effects: readonly SpellEffect[],
  of: StatedChoiceOf,
): boolean {
  if (of === 'condition' || of === 'creature-type') return false;
  const sibling = of === 'ability' ? 'skill' : 'ability';
  return effects.some((effect) => {
    if (effect.kind === 'roll-mode') {
      const selector = effect.modifier.selector;
      return selector[of] !== undefined && selector[sibling] !== undefined;
    }
    if (effect.kind === 'buff' && effect.only !== undefined) {
      return effect.only[of] !== undefined && effect.only[sibling] !== undefined;
    }
    return false;
  });
}

/**
 * Whether a stated choice would land anywhere in an effect list.
 *
 * The validator's reachability rule and the runtime's substitution read one
 * answer, because a choice the definition accepts and the resolution then
 * drops is the silent failure the whole validator exists to convert into a
 * refusal at authoring. Written as "does the substitution change anything",
 * so a kind added to {@link statedChoice} is reachable here the same day.
 */
export function statedChoiceReaches(
  effects: readonly SpellEffect[],
  of: StatedChoiceOf,
  probe: string,
): boolean {
  const after = statedChoice(effects, of, probe);
  return after.some((effect, i) => effect !== effects[i]);
}

/**
 * Every kind of damage an effect list deals, sorted and without repeats.
 *
 * SRD Elemental Affinity asks it of a whole casting — "when you cast a spell
 * that deals damage of that type" — so the question is the list's rather than
 * any one effect's, and a spell printing two types answers for both. Read off
 * the list the casting is actually running, so a stated type reaches it: Spirit
 * Guardians deals Radiant *or* Necrotic and the casting already said which.
 *
 * `plus`, the second damage an area trigger's host may carry, is folded in for
 * the same reason a rider is not: it is damage this list deals, where a rider's
 * die is thrown on a later turn by an attack that has not happened.
 */
export function damageTypesDealt(effects: readonly SpellEffect[]): readonly string[] {
  const types = new Set<string>();
  for (const effect of effects) {
    if ('damageType' in effect && typeof effect.damageType === 'string') {
      types.add(effect.damageType);
    }
    if ('plus' in effect && effect.plus !== undefined) {
      for (const part of effect.plus) types.add(part.damageType);
    }
  }
  return [...types].sort();
}

/**
 * How a deadline finishes the sentence a refusal starts.
 *
 * "…until **the spell ends**", "…until **the start of the caster's next
 * turn**". Beside {@link riderDuration} below, which answers the same
 * question for the *timer*, because the two must never disagree about which
 * moment they mean: a refusal naming a moment the grant does not actually end
 * at is worse than one naming none. Absent is the casting's own deadline,
 * which is what a rider with no `lasts` borrows.
 *
 * Pinned onto {@link GrantedActionRule.until} at the cast, for the reason
 * every other number on a casting is pinned — the fold opens no catalogue,
 * and `combat.ts` sits beneath `GameState` and can reach neither.
 *
 * **A `switch` over a `never`, and it used to be a ternary.** The tail read
 * `lasts === 'end-of-casters-next-turn' ? … : "the start of the caster's next
 * turn"`, so a fifth member of {@link RiderDuration} would have compiled and
 * been *described* as the start of the caster's next turn — the wrong moment
 * printed in the sentence a refusal shows a player. `riderDuration` below had
 * the identical tail, so the two would have gone on agreeing about it.
 * `rider-duration-readers.test.ts` is the other half: the compiler refuses a
 * member nobody answered, and the sweep refuses a reader that answers one by
 * falling through to it.
 */
export function riderDurationPhrase(lasts: RiderDuration | undefined): string {
  if (lasts === undefined) return 'the spell ends';
  if (typeof lasts === 'object') return `${lasts.seconds} seconds have passed`;
  switch (lasts) {
    case 'end-of-current-turn':
      return 'the end of the current turn';
    case 'end-of-targets-next-turn':
      return "the end of the target's next turn";
    case 'start-of-targets-next-turn':
      return "the start of the target's next turn";
    case 'end-of-casters-next-turn':
      return "the end of the caster's next turn";
    case 'start-of-casters-next-turn':
      return "the start of the caster's next turn";
    default: {
      const unhandled: never = lasts;
      throw new Error(`no phrase for the deadline ${String(unhandled)}`);
    }
  }
}

/**
 * The deadline a rider clause names.
 *
 * Two of the six members are anchored to the caster's own turn; two to the
 * creature the rider is being hung on; one is a span on the clock; and one —
 * the turn in progress ending — is anchored to nobody, so it ignores both and
 * is resolved against whoever is taking the turn. The whole reason they are
 * separate members is that none of them is interchangeable with another — see
 * {@link RiderDuration}.
 *
 * **`targetId` is optional and the target-anchored members require it**, which
 * is not a contradiction: the two callers that pass none are the two that
 * cannot reach those members. The pre-flight asks the caster-anchored deadlines
 * once and the target-anchored ones per target, splitting on
 * {@link anchoredOnTarget}; and a definition's own `durationUntil` is one
 * casting's duration rather than one creature's, which the validator refuses
 * the member on. So the combination is programmer error and says so, rather
 * than falling back to the caster — a fallback there would be a *wrong
 * deadline* rather than a refusal, and a closed vocabulary exists to make that
 * impossible.
 *
 * Which is the argument for the `switch` over a `never` as well: the tail was
 * a ternary that answered `start-of-casters-next-turn` to anything it had not
 * been taught, so the one shape this docstring calls impossible — a wrong
 * deadline instead of a refusal — was a member away. See
 * {@link riderDurationPhrase}.
 */
export function riderDuration(
  lasts: RiderDuration | undefined,
  casterId: CharacterId,
  targetId?: CharacterId,
): Duration | undefined {
  if (lasts === undefined) return undefined;
  if (typeof lasts === 'object') return forSeconds(lasts.seconds);
  // **Asked once, of the one reader of which members anchor where**, rather
  // than written again inside each arm that needs it. A second target-anchored
  // member arriving without its own copy of the guard would bind to
  // `undefined` and pin a deadline onto nobody — the silent wrong answer the
  // paragraph above says is impossible here — and there is now a second such
  // member for it to happen to.
  if (anchoredOnTarget(lasts) && targetId === undefined) {
    throw new Error(
      'a deadline anchored on the target needs the target; ask it per target, as the pre-flight and the rider resolvers do',
    );
  }
  switch (lasts) {
    case 'end-of-current-turn':
      return endOfCurrentTurn;
    // Both through `turnAnchored`, which is the constructor `hit-riders.ts`
    // already resolves a printed rider's target-anchored span with: the two
    // moments differ by a word and by a `TurnAnchor`, and nothing else.
    case 'end-of-targets-next-turn':
      return turnAnchored('end-of-next-turn', targetId!);
    case 'start-of-targets-next-turn':
      return turnAnchored('start-of-next-turn', targetId!);
    case 'end-of-casters-next-turn':
      return endOfNextTurn(casterId);
    case 'start-of-casters-next-turn':
      return startOfNextTurn(casterId);
    default: {
      const unhandled: never = lasts;
      throw new Error(
        `no deadline for ${String(unhandled)}; the vocabulary and its reader disagree`,
      );
    }
  }
}

/**
 * Whether a rider's deadline is about the creature it lands on.
 *
 * The one reader of the distinction, so the pre-flight and the resolvers
 * cannot come to different views of which member anchors where. A caster's
 * deadline is the same moment for every target a casting catches and is asked
 * once; a target's is a different moment per target and is asked per target,
 * which is the rule {@link delayedDuration} already obeys and the reason it is
 * asked where the targets exist.
 *
 * **The three `false` arms are written out**, for the reason the two functions
 * above are: an equality test answers `false` to a member it has never heard
 * of, and `false` here means "ask this deadline once, for the caster" — so a
 * new target-anchored member would be asked in the wrong place and pinned to
 * the wrong creature, silently. A span is the one member that is genuinely not
 * a name, and it anchors on nobody.
 *
 * **And the exhaustive `switch` is what made the second target-anchored member
 * cheap**: SRD Shocking Grasp's "until the start of **its** next turn" was
 * three compiler errors before it was three edits, and one of the three was
 * here. {@link riderDuration} now asks this rather than repeating the list, so
 * a third such member cannot arrive with its guard missing.
 */
export function anchoredOnTarget(lasts: RiderDuration): boolean {
  if (typeof lasts === 'object') return false;
  switch (lasts) {
    case 'end-of-targets-next-turn':
    case 'start-of-targets-next-turn':
      return true;
    case 'end-of-current-turn':
    case 'end-of-casters-next-turn':
    case 'start-of-casters-next-turn':
      return false;
    default: {
      const unhandled: never = lasts;
      throw new Error(
        `no anchor rule for ${String(unhandled)}; the vocabulary and its reader disagree`,
      );
    }
  }
}

/**
 * When a `delayed` hit falls due: the end of the **target's** next turn.
 *
 * SRD Acid Arrow writes the moment as "at the end of **its** next turn", and
 * Vitriolic Sphere the same — anchored to the creature the damage is on rather
 * than to the caster, which is why this cannot reuse {@link riderDuration}'s
 * caster-anchored pair. `endOfNextTurn` already encodes the asymmetry that
 * makes it right: said on the target's own turn, the end of their *next* turn
 * is two turn-endings away, not one.
 *
 * **One reader, one question, asked in the two places that must agree** — the
 * pre-flight that asks whether the moment can exist at all, and the scheduler
 * that pins it. That is {@link teleportOf}'s pattern and it is here for the
 * same reason: the moment was spelled out inside the scheduler, so the
 * pre-flight could not see it, and a second spelling of one sentence is a
 * second place for it to be got wrong.
 *
 * A `DelayedDamage` carries no `lasts` because there is nothing to choose:
 * both spells that print this shape print the same moment, and a field the
 * book never varies is a field nothing would ever read.
 */
export function delayedDuration(target: CharacterId): Duration {
  return endOfNextTurn(target);
}

/**
 * Does a casting of this spell owe anybody a later hit?
 *
 * Asked of the definition rather than of one effect, for the same reason
 * {@link statesFoughtFact} is: the *pre-flight* has to know, before a slot or
 * a die, whether the moment {@link delayedDuration} names is one this world
 * can supply.
 *
 * **The casting's own effect list, and nothing nested**, which is
 * {@link teleportOf}'s rule for the same reason {@link statesFoughtFact} has
 * it: the fact is about *this* casting's targets. A delayed hit's moment
 * belongs to the target, and an area trigger's targets are whoever walks into
 * the cloud a minute later — creatures the casting has not met and cannot ask
 * about. No spell prints that combination, and the day one does, the moment
 * to ask about it is the moment the trigger fires.
 */
export function delaysDamage(definition: SpellDefinition): boolean {
  return definition.effects.some((effect) => outcomeRidersOf(effect).delayed !== undefined);
}

/**
 * Every rider deadline a casting of this spell is going to need.
 *
 * Gathered so they can be checked before anything is spent. A turn-anchored
 * rider cannot be pinned outside combat, and finding that out at the moment
 * the condition lands is too late: the saving throw has already been rolled,
 * and the caller's generator has already moved for a cast that never happened.
 *
 * **Both slots that can carry one**, because a `speed-change` rider carries
 * `lasts` too and Ray of Frost is the spell that needs the pre-flight most: it
 * is a cantrip, so its casting owns nothing, and the deadline is the only
 * thing that could ever take its reduction away. Reading only the conditions
 * would have let the ray be thrown outside combat, hit, deal its damage, and
 * then fail to schedule the slow — a refused operation that had already moved
 * the world.
 *
 * **The casting's own effect list, and nothing nested — recorded rather than
 * overlooked.** An area trigger's effects carry riders too, and gathering
 * those here was tried and rejected on what it costs. SRD Stinking Cloud's
 * Poisoned lasts "until the end of the current turn" and the casting itself
 * does nothing at all, so a pre-flight that read the trigger's list would
 * refuse the cloud to anyone who had not rolled Initiative — and the only way
 * to satisfy that request is to begin a fight. A gas trap laid before the door
 * opens is a legal casting the book nowhere forbids, and `area-triggers.test.ts`
 * conjures every area before Initiative for exactly that reason.
 *
 * **They are different moments, which is why one pre-flight cannot answer
 * both.** A rider on the casting's own effects lands *now*, so the casting is
 * the moment to ask about it; a rider on a trigger lands whenever the trigger
 * fires — a minute later, in a fight that has started since — so the casting's
 * answer would be about the wrong world. `creatureTypeNeeds` already draws
 * that distinction by asking twice: once here for the casting's own effects,
 * and once at resolution for whichever list is actually running.
 *
 * **And nothing in the book reaches the gap.** The one nested turn-anchored
 * rider is Stinking Cloud's, on a `start-of-turn` trigger, which cannot fire
 * without a turn to start — so the deadline always pins. What would end that
 * is an area trigger carrying an **entry** clause with a turn-anchored rider,
 * since an entry fires outside combat; and what happens then is not silence
 * but a late question, because `schedule` converts the refusal into the same
 * `turn-order` request mid-settlement, after the trigger's save has been
 * rolled. Honest, and one roll too late — which is the argument for asking
 * where the *running* list is known, and not here.
 */
export function riderDurations(definition: SpellDefinition): readonly RiderDuration[] {
  const found: RiderDuration[] = [];
  for (const effect of definition.effects) {
    // Every rider on every host, because a plural `conditions` means the one
    // that cannot be pinned is not always the first.
    for (const rider of conditionRiderOf(effect)) {
      if (rider.lasts !== undefined) found.push(rider.lasts);
    }
    for (const rider of modifierRidersOf(effect)) {
      // The five riders that may carry a deadline of their own — see
      // {@link ModifierRider}, where each is argued from an Instantaneous
      // host that could never lift what it hung.
      if (
        (rider.kind === 'speed-change' ||
          rider.kind === 'action' ||
          rider.kind === 'mode' ||
          rider.kind === 'healing' ||
          rider.kind === 'benefit') &&
        rider.lasts !== undefined
      ) {
        found.push(rider.lasts);
      }
    }
  }
  return found;
}

/**
 * The teleport a casting performs, or null for the rest of the book.
 *
 * One reader for one question, asked in three places that must agree: the
 * validator's *is a destination required*, the pre-flight's *may this casting
 * reach that space*, and the resolver's *how far and whether they must see
 * it*. Two spellings of it would be two places for one sentence to be got
 * wrong, which is the failure this file records about every duplicated rule.
 *
 * A definition's own effect list and nowhere else — `checkTeleportPlacement`
 * refuses a teleport in an area trigger's list or an activation's, because
 * neither carries the destination the caster stated.
 */
export function teleportOf(
  definition: SpellDefinition,
): Extract<SpellEffect, { kind: 'teleport' }> | null {
  return definition.effects.find((effect) => effect.kind === 'teleport') ?? null;
}

/**
 * The weapon rider a casting hangs, or null for the rest of the book.
 *
 * {@link teleportOf}'s sibling and the same discipline, for the same three
 * readers that must agree: the stated-fact check's *is a weapon required*, the
 * pre-flight's *may this casting be aimed at that one*, and the resolver's
 * *what does it do to it*.
 *
 * A definition's own effect list and nowhere else. An area trigger's list and
 * an activation's both resolve on a later turn against creatures the caster
 * never touched, and neither carries the weapon the caster named.
 */
export function weaponRiderOf(
  definition: SpellDefinition,
): Extract<SpellEffect, { kind: 'weapon-rider' }> | null {
  return definition.effects.find((effect) => effect.kind === 'weapon-rider') ?? null;
}

/**
 * The condition riders an effect carries, however it spells them.
 *
 * Four kinds impose a condition and one of them writes the first one's fields
 * flat, so this is the one place that knows the difference — the reason `save`
 * could keep its layout without the vocabulary forking. Every reader asks this
 * rather than switching on the kind, so a fifth consumer is one case here and
 * nothing anywhere else.
 *
 * **A list, because the SRD writes the sentence plural.** Hideous Laughter
 * imposes "the Prone and Incapacitated conditions" on one Wisdom save; Ray of
 * Sickness imposes one on a hit; Greater Invisibility imposes one with nothing
 * rolled at all. A caller that wants "the rider" is a caller that has assumed
 * a cardinality, which is what made the second half of two SRD sentences
 * inexpressible for as long as this returned a single value.
 *
 * `save`'s flat {@link save.repeats} is folded onto the **first** rider,
 * because it belongs to the saving throw the host made rather than to any one
 * condition: SRD writes "the target repeats the save" once, whatever the
 * failure imposed, and a copy on each rider would raise one debt per
 * condition at every turn boundary.
 *
 * **`condition` is the one kind whose list is non-empty, and `save` stopped
 * being the second the day its flat condition became optional.** SRD Slow and
 * SRD Faerie Fire roll a saving throw whose failure hands out grants and
 * imposes nothing, so the flat slot may simply be absent and the first
 * element is then `save.conditions`' first or nothing at all. Every caller
 * that reached for `[0]` on a `save` is a caller that has to ask whether
 * there was one — which is a compiler error at each of them rather than an
 * `undefined` condition name travelling into the fold.
 */
export function conditionRiderOf(
  effect: Extract<SpellEffect, { kind: 'condition' }>,
): readonly [ConditionRider, ...ConditionRider[]];
export function conditionRiderOf(effect: SpellEffect): readonly ConditionRider[];
export function conditionRiderOf(effect: SpellEffect): readonly ConditionRider[] {
  switch (effect.kind) {
    case 'condition':
      return [effect.condition];
    case 'attack':
    case 'save-damage':
      return effect.conditions ?? [];
    case 'save':
      return [
        // The flat fields are one rider and they are one rider **only when
        // the condition is there**: `lasts`, `check`, `outlivesCasting` and
        // `repeats` are all sentences about a condition, and the validator
        // refuses every one of them beside an absent `condition` rather than
        // letting this build a nameless rider for them to hang on.
        ...(effect.condition === undefined
          ? []
          : [
              {
                name: effect.condition,
                ...(effect.lasts === undefined ? {} : { lasts: effect.lasts }),
                ...(effect.check === undefined ? {} : { check: effect.check }),
                ...(effect.outlivesCasting === undefined
                  ? {}
                  : { outlivesCasting: effect.outlivesCasting }),
                ...(effect.repeats === undefined ? {} : { repeats: effect.repeats }),
              },
            ]),
        ...(effect.conditions ?? []),
      ];
    default:
      return [];
  }
}

/**
 * The grants an effect's outcome imposes, however its host spells them.
 *
 * The sibling of {@link conditionRiderOf}, and it needs no view: every host
 * carries {@link ModifierRider}s in the same named slot. It exists so that a
 * reader asks one question of an effect rather than switching on three kinds,
 * and so that a fourth host is one case here.
 */
export function modifierRidersOf(effect: SpellEffect): readonly ModifierRider[] {
  switch (effect.kind) {
    case 'attack':
    case 'save-damage':
    case 'save':
      return effect.modifiers ?? [];
    default:
      return [];
  }
}

/**
 * Whether resolving this effect has to know what the target **is**.
 *
 * The sibling of {@link modifierRidersOf}, asked of the other axis: two hosts
 * carry an `againstType` clause and the payloads differ, but both name the
 * types, so one question answers both and a third host is one case here.
 *
 * It exists so the *request* can be raised before anything is spent. A
 * creature nobody has typed is a thin record, and the whole three-valued
 * discipline turns on the difference between asking and quietly taking the
 * default branch — which is what an effect-by-effect check inside the
 * resolution would have had to do, with the slot already gone.
 */
export function creatureTypesRead(effect: SpellEffect): readonly string[] {
  switch (effect.kind) {
    case 'save-damage':
    case 'attack-damage':
      return effect.againstType?.types ?? [];
    default:
      return [];
  }
}

/**
 * Does resolving this spell roll a D20 Test with the **caster's own**
 * spellcasting ability?
 *
 * SRD Dispel Magic: "make an ability check using your spellcasting ability (DC
 * 10 plus that spell's level)". A modifier is not enough to answer it — the
 * ability decides the roll's modes and which conditions fail it outright — so
 * this is a question about which ability, not about which number, and it is
 * the one thing a casting's pinned {@link CastingNumbers} cannot stand in for.
 *
 * It exists for the same reason {@link creatureTypesRead} does: the answer has
 * to be had **before anything is spent**. A wand held by a creature with no
 * spellcasting ability at all can pay for a Fireball perfectly well and cannot
 * make this check, and finding that out inside the resolution would be a
 * refusal that had already taken the charge.
 *
 * **Two cases, and the compiler keeps them honest.** `CastingRoute`'s item arm
 * carries `ability: Ability | null`, so a third resolver that reaches for the
 * caster's ability fails to typecheck rather than silently reading a null.
 *
 * **The second is not a D20 Test of this casting's own**, and it belongs here
 * anyway. SRD Shillelagh: "you can use your **spellcasting ability** instead
 * of Strength for the attack and damage rolls" — the ability is pinned into a
 * grant now and read by every swing for the next minute, so a wielder who has
 * none has nothing to substitute and must hear so before the casting is spent
 * rather than a minute later at the first swing. The question the name asks is
 * "does this spell read the caster's own spellcasting ability", and both
 * answer yes; which roll eventually reads it is the difference between them.
 */
export function castersAbilityRead(definition: SpellDefinition): boolean {
  return definition.effects.some(
    (effect) =>
      effect.kind === 'dispel' ||
      (effect.kind === 'weapon-rider' && effect.castingAbility === true),
  );
}

/** Which of a casting's own {@link CastingNumbers} resolving this spell reads. */
export interface NumbersRead {
  readonly saveDc: boolean;
  readonly attackModifier: boolean;
  readonly spellcastingModifier: boolean;
}

/**
 * Which of the casting's pinned numbers this spell can actually read.
 *
 * The sibling of {@link castersAbilityRead}, and a different question with a
 * different answer. That one asks which *ability* a D20 Test is made with,
 * which "+0 for the item" cannot supply; this asks which *numbers* a
 * resolution will reach for, and every one of them has an answer for a wielder
 * with no spellcasting ability at all.
 *
 * It exists because SRD hands the item and the spell one clause each. "(save
 * DC 15)" is the *item's* sentence and settles that number outright; "plus
 * your spellcasting ability modifier" is the *spell's* and is never settled by
 * an item's line at all. So an item that prints one number and leaves another
 * to the wielder has deferred exactly the ones it did not print — and whether
 * the wielder must therefore be asked which of two abilities to bring is a
 * question about what this spell reads, not about how many numbers the item
 * happened to print. Without that, a wand printing a DC and casting a spell
 * attack rolled at a flat Proficiency Bonus for a two-classed wielder and at
 * their own modifier for a single-classed one, silently.
 *
 * **Every list a casting resolves**, not only the definition's own: an area
 * trigger and a later activation both run through `resolveEffects` with the
 * numbers this casting pinned, so a clause in either of them reads the same
 * fields a minute later.
 *
 * **One branch per kind and a `never` default**, which is the discipline
 * `resolveOneEffect` keeps for the same reason: a kind added to the union and
 * not classified here is a compile error rather than a number quietly read
 * from a source nobody chose. Erring towards `true` is the safe direction —
 * it costs a caller one refusal naming a choice the SRD says is theirs, where
 * erring towards `false` costs a wrong number nobody is told about.
 */
export function numbersRead(definition: SpellDefinition): NumbersRead {
  const running: readonly SpellEffect[] = [
    ...definition.effects,
    ...(definition.areaTrigger?.effects ?? []),
    ...(definition.activation?.effects ?? []),
  ];

  // SRD Minor Illusion offers a check "against your spell save DC" to anybody
  // who studies it, which is the casting's DC read by nothing in `effects`.
  let saveDc = definition.check !== undefined;
  let attackModifier = false;
  let spellcastingModifier = false;

  for (const effect of running) {
    if ((effect as { readonly addSpellcastingModifier?: boolean }).addSpellcastingModifier === true) {
      spellcastingModifier = true;
    }
    switch (effect.kind) {
      case 'attack':
        // The roll itself, and every rider it settles — a condition a hit
        // imposes may offer a repeat save against the casting's DC.
        attackModifier = true;
        saveDc = true;
        break;
      case 'attack-damage':
        // Divine Smite rides an attack somebody else already rolled, so it
        // reads no attack modifier of its own; its riders still read the DC.
        saveDc = true;
        break;
      case 'save':
      case 'save-damage':
      case 'condition':
      case 'end-condition':
      case 'interrupt-casting':
        saveDc = true;
        break;
      // **A ward reads it and the other two do not**, which is why this asks
      // the defence rather than the kind: SRD Sanctuary makes the *attacker*
      // save against the caster's own DC, and duplicates and a wreath of
      // flame ask nobody anything. Marking the whole kind would make a
      // Mirror Image wand demand a DC its spell never uses.
      case 'passive-defense':
        if (effect.defense.kind === 'ward') saveDc = true;
        break;
      // **The one kind whose answer is conditional**, and the condition is the
      // resolver's own: SRD Bane is a `buff` that a Charisma save resists, and
      // SRD Bless is a `buff` that nobody rolls against at all. `ability` is
      // what tells the two apart in `resolveBuffEffect`, so it is what tells
      // them apart here — marking the whole kind would ask a Bless wand's
      // wielder to choose an ability nothing would read.
      case 'buff':
        if (effect.ability !== undefined) saveDc = true;
        break;
      // The rest reach neither: they heal, grant, defend, move, dispel or
      // raise a creature, and a dispel's own check is against 10 plus the
      // spell's level rather than against anything this casting pinned. A
      // summons reads nothing of the caster's at all — every number it has is
      // the stat block's, and the two the spell may print over it are worked
      // out from the level the slot paid for.
      //
      // **A pool of hits is here and not above**, which is the whole of what
      // it is: nothing is rolled to decide whether a dart lands, so there is
      // no attack modifier, and it hangs nothing that could offer a save, so
      // there is no DC. Its dice are scaled off the slot, which is a number
      // the casting *paid*, not one it pinned.
      case 'auto-damage':
      // **And a printed percentage is not a number this casting pinned.** SRD
      // Augury's 25 is the book's, the count it multiplies is the caster's
      // tally, and the die has no modifier to read — so a wand that printed a
      // chance would need neither a DC nor an attack modifier from anybody.
      case 'chance':
      case 'temp-hp':
      case 'roll-mode':
      case 'armor-class':
      case 'damage-defense':
      case 'condition-immunity':
      case 'speed':
      // Light a creature carries and a sense it gains: two more grants that
      // read nothing of the caster's — a radius and a range are the book's.
      case 'light':
      case 'sense':
      // And a reduction the target takes off later damage: a notation and a
      // list of types, both the book's, with nothing of the caster's in
      // either — SRD Resistance's d4 is a d4 whoever cast it.
      case 'damage-reduction':
      case 'attack-rider':
      // The ability it may pin is not one of these three: it is an *ability*
      // and not a number, which is `castersAbilityRead`'s question and not
      // this one — the same split that keeps `EffectContext.ability` out of
      // `CastingNumbers`.
      case 'weapon-rider':
      // And the swing the casting makes itself pins nothing either, for a
      // sharper reason than the rider above it: there is no *later* moment for
      // a pinned number to be read at. The attack roll happens in the same
      // command as the casting, off the sheet as it stands, so an attack
      // modifier written down here would be a copy nobody would ever read.
      case 'weapon-attack':
      case 'heal':
      case 'turn-payout':
      case 'action-rule':
      case 'healing-rule':
      case 'hit-point-maximum':
      case 'dispel':
      case 'teleport':
      case 'summon':
        break;
      default: {
        const unhandled: never = effect;
        throw new Error(
          `no numbers rule for ${(unhandled as SpellEffect).kind}; ` +
            'the definition and the reader disagree',
        );
      }
    }
  }

  return { saveDc, attackModifier, spellcastingModifier };
}

/**
 * Does this spell ask its caster whether the target is being fought?
 *
 * The sibling of {@link creatureTypesRead}, and asked of the definition rather
 * than of one effect for the reason that one: the *request* has to be checked
 * before anything is spent, and "did the caster answer the question this spell
 * asks" is a question about the spell.
 *
 * **The casting's own effect list, and nothing nested.** The fact is stated
 * once, at the casting, and `CastSpellRequest.fought` is where it is stated —
 * so the clause belongs to the saving throw the casting itself calls for. A
 * clause on an area trigger's save would be read a minute later, off a record
 * that carries no such fact, and would be silently unread; the validator
 * refuses one there rather than leaving that to be discovered.
 */
export function statesFoughtFact(definition: SpellDefinition): boolean {
  return definition.effects.some(
    (effect) => effect.kind === 'save' && effect.advantageIfFought === true,
  );
}

/**
 * Everything an effect's settled outcome carries, in one value.
 *
 * `applyRiders` takes this rather than an effect, which is what keeps it from
 * knowing which host it is serving — the whole point of fixing the branch by
 * the host is that the riders themselves are the same wherever they hang.
 */
export function outcomeRidersOf(effect: SpellEffect): OutcomeRiders {
  const conditions = conditionRiderOf(effect);
  const modifiers = modifierRidersOf(effect);
  const delayed =
    effect.kind === 'attack' || effect.kind === 'save-damage' ? effect.delayed : undefined;
  // The two hosts that carry `& OutcomeRiders` whole, which are the two the
  // SRD writes a shove on: "On a hit" and "On a failed save". `save` keeps its
  // flat spelling and has never carried the last two slots.
  const movement =
    effect.kind === 'attack' || effect.kind === 'save-damage' ? effect.movement : undefined;
  // The same two hosts, and for the same reason: the SRD writes a spend "on a
  // hit" and "on a failed save" and nowhere else that a rider hangs.
  const spends =
    effect.kind === 'attack' || effect.kind === 'save-damage' ? effect.spends : undefined;
  // **All three hosts**, and the third is why this reads the field rather than
  // the interface: SRD Faerie Fire writes the glow off a bare `save`, which
  // keeps its flat spelling, so the slot is declared there as well and read
  // here in one place.
  const light =
    effect.kind === 'attack' || effect.kind === 'save-damage' || effect.kind === 'save'
      ? effect.light
      : undefined;
  // The same three hosts, for the same reason: SRD Sleet Storm writes the
  // clause off a bare `save`, which keeps its flat spelling.
  const breaksConcentration =
    effect.kind === 'attack' || effect.kind === 'save-damage' || effect.kind === 'save'
      ? effect.breaksConcentration
      : undefined;
  return {
    ...(conditions.length === 0 ? {} : { conditions }),
    ...(modifiers.length === 0 ? {} : { modifiers }),
    ...(delayed === undefined ? {} : { delayed }),
    ...(movement === undefined ? {} : { movement }),
    ...(spends === undefined ? {} : { spends }),
    ...(light === undefined ? {} : { light }),
    ...(breaksConcentration === undefined ? {} : { breaksConcentration }),
  };
}

/**
 * Does this outcome carry anything at all for `applyRiders` to hang?
 *
 * The question a host has to ask when its riders are **optional in a way the
 * casting is not**: every rider is welded to a casting — a condition instance
 * in the fold, a granted modifier's source, a `damage-scheduled`'s link — and
 * an item's conferral has no casting at all. `checkContent` refuses a rider
 * there, so this answering false is what lets a save-rolling effect resolve
 * from an item without reaching for a casting that does not exist.
 */
export function hasOutcomeRiders(riders: OutcomeRiders): boolean {
  return (
    riders.conditions !== undefined ||
    riders.modifiers !== undefined ||
    riders.delayed !== undefined ||
    riders.movement !== undefined ||
    riders.spends !== undefined ||
    riders.light !== undefined ||
    riders.breaksConcentration !== undefined
  );
}


/**
 * The dice a spell rolls, at this caster level and this slot level.
 *
 * A cantrip reads the caster's level and ignores the slot, because it has
 * none; a levelled spell reads the slot and ignores the level. Conflating the
 * two is how a level 3 Wizard ends up throwing a level 5 Fire Bolt.
 *
 * Damage and healing both come through here: the arithmetic is the same, and
 * the SRD writes both upcasts in the same sentence shape.
 *
 * **Absent when the amount rolls nothing**, which is a different answer from
 * `'0d6'`: a caller that gets it back throws no die and moves no generator.
 * Neither scaling field can apply to such an amount — both add dice to a base
 * notation there is none of, and `checkSpellDefinition` refuses the pair —
 * so there is nothing here to scale and nothing silently dropped.
 */
export function scaledDiceFor(
  scaling: DiceScaling,
  spellLevel: number,
  casterLevel: number,
  slotLevel: number,
): string | undefined {
  if (scaling.dice === undefined) return undefined;
  const [count, faces] = scaling.dice.split('d');
  const base = Number(count ?? '1');
  const sides = faces ?? '6';

  if (spellLevel === 0) {
    const upgrades = (scaling.cantripUpgradesAt ?? []).filter((at) => casterLevel >= at).length;
    return `${base + upgrades}d${sides}`;
  }

  if (scaling.perSlotLevelAbove === undefined) return scaling.dice;
  const [extraCount] = scaling.perSlotLevelAbove.split('d');
  const above = Math.max(0, slotLevel - spellLevel);
  return `${base + Number(extraCount ?? '0') * above}d${sides}`;
}

/**
 * The flat half of a scaled amount: False Life's "2d4 **+ 4**", growing by 5.
 *
 * Kept apart from the dice because they scale independently — False Life adds
 * five flat Temporary Hit Points per slot level and no extra dice at all, so
 * folding the two together would have to invent a die to carry the five.
 */
export function scaledFlatFor(
  scaling: DiceScaling,
  spellLevel: number,
  slotLevel: number,
): number {
  const above = Math.max(0, slotLevel - spellLevel);
  return (scaling.flat ?? 0) + (scaling.flatPerSlotLevelAbove ?? 0) * above;
}

/** How many targets a casting may take, given the slot it was cast with. */
export function targetCountFor(rule: TargetRule, spellLevel: number, slotLevel: number): number {
  const above = Math.max(0, slotLevel - spellLevel);
  return rule.count + (rule.extraPerSlotLevelAbove ?? 0) * above;
}

/**
 * How many attack rolls one `attack` effect makes, at this caster level and
 * this slot level.
 *
 * The twin of {@link scaledDiceFor} and the same fork: a cantrip reads the
 * caster's level and ignores the slot, a levelled spell reads the slot and
 * ignores the level. **Absent is one** — an effect that says nothing about a
 * count makes the single roll every attack in the book makes.
 */
export function attackRollsFor(
  rolls: AttackRollCount | undefined,
  spellLevel: number,
  casterLevel: number,
  slotLevel: number,
): number {
  if (rolls === undefined) return 1;
  if (spellLevel === 0) {
    return rolls.count + (rolls.cantripUpgradesAt ?? []).filter((at) => casterLevel >= at).length;
  }
  const above = Math.max(0, slotLevel - spellLevel);
  return rolls.count + (rolls.extraPerSlotLevelAbove ?? 0) * above;
}

/**
 * The most **aimed rolls** any one effect of this list will make.
 *
 * An aimed roll is one the caster points at a creature and the engine throws:
 * Scorching Ray's rays, Eldritch Blast's beams, Magic Missile's darts. Two
 * kinds make them and the difference between them is what decides the hit, not
 * how many there are — so the count, the per-slot growth and the split are one
 * question asked of both rather than two questions spelled alike.
 *
 * **The name says "aimed" rather than "attack" for exactly that reason.** A
 * dart is not an attack roll and never becomes one; a function called
 * `attackRollsIn` that counted darts would be a word doing a job it does not
 * mean, which is how a reader comes to believe Magic Missile can miss.
 *
 * What a caller may name creatures up to, because a creature is named *for* a
 * roll. The maximum rather than a sum: two such effects in one list are two
 * things that each happen to every target, not a pool of rolls to divide, and
 * the target list has to be long enough for the longest of them.
 *
 * **Zero for a list with neither in it**, which is the honest answer and not
 * the useful one: a Detect Magic aims nothing, and seeding at one so that the
 * number could be used as a bound unexamined would have this function saying
 * every spell in the book throws a roll at somebody. A caller wanting a floor
 * says so where it wants it.
 */
/**
 * Does this casting **aim an attack roll or damage at a creature it names**?
 *
 * SRD Sanctuary wards against "an attack roll **or a damaging spell**", and
 * the two halves of that sentence are the three ways a casting reaches a
 * creature to hurt it: a roll to hit (`attack`), a save that deals damage on a
 * failure (`save-damage`), and damage that neither decides (`auto-damage`). A
 * ward that read "any spell at all" would turn away a Cure Wounds aimed at the
 * creature it protects, which is the opposite of what it is for.
 *
 * **The third is the one that needs saying out loud**, because it is the only
 * member of the union with no roll in front of it. "A damaging spell" is the
 * whole of the SRD's second half and says nothing about how the damage is
 * decided, so a Magic Missile is exactly what Sanctuary turns away — and a
 * kind left out of this list would walk its darts straight through the one
 * spell written to stop them.
 *
 * **`attack-damage` is not here** and its absence is the rule rather than an
 * omission: SRD Divine Smite rides an attack roll somebody has already made,
 * so the ward answered that swing at the swing and has nothing left to answer.
 *
 * **Nor is an area.** This reads the targets a casting *names*; a Fireball
 * catches whoever is standing in it, and "This spell doesn't protect the
 * warded creature from areas of effect" is the book saying so.
 */
export function aimsHarmAtATarget(effects: readonly SpellEffect[]): boolean {
  return effects.some(
    (effect) =>
      effect.kind === 'attack' ||
      effect.kind === 'save-damage' ||
      effect.kind === 'auto-damage',
  );
}

export function aimedRollsIn(
  effects: readonly SpellEffect[],
  spellLevel: number,
  casterLevel: number,
  slotLevel: number,
): number {
  return effects.reduce(
    (most, effect) =>
      effect.kind === 'attack' || effect.kind === 'auto-damage'
        ? Math.max(most, attackRollsFor(effect.rolls, spellLevel, casterLevel, slotLevel))
        : most,
    0,
  );
}

/**
 * How many of a casting's rolls land on the creature named `index`th of
 * `targets`.
 *
 * One each in the order the caller named them, round again for the surplus.
 * SRD prints the two ends of it — "at one target within range or at several",
 * "at the same target or at different ones" — and leaves the middle to the
 * caster, who says it by how many creatures they name and in what order: three
 * rays at `[ogre]` all hit the ogre, at `[ogre, goblin]` go two and one, and
 * at `[ogre, goblin, boar]` go one each.
 *
 * **The engine deals rather than decides.** It never adds a creature, never
 * drops one, and never leaves a roll unthrown; what it does not do is invent a
 * lopsided split the caster did not ask for, which is why the odd roll goes to
 * the creature named first rather than anywhere cleverer.
 *
 * **What this is not is the only way a split can be said.** A caster who wants
 * three rays at one creature and one at another states it — `rollsAt` on the
 * request, checked by `rollsAimedAt` — and this deal is what a caster who said
 * nothing gets.
 */
export function rollsDealtTo(total: number, targets: number, index: number): number {
  if (targets <= 0) return 0;
  return Math.floor(total / targets) + (index < total % targets ? 1 : 0);
}
