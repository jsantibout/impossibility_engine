import type { Ability, CharacterId, ConditionName, Skill } from '@ie/shared';
import {
  endOfCurrentTurn,
  endOfNextTurn,
  forSeconds,
  startOfNextTurn,
  type Duration,
  type TurnMoment,
} from './time.js';
import { type EffectEndCause, type PayoutKind } from './timers.js';
import type { DefenseKind } from './attack.js';
import type { Bonus, BonusApplies, BonusNarrowing } from './bonuses.js';
import type { RollModifier } from './roll-modifiers.js';
import type { AreaStanding, SpeedChange } from './standing.js';
import type { MovementMode } from './character.js';
import type { ActionRule } from './combat.js';
import type { PointAnchoring } from './positioning.js';
import type { CastingTime } from './spells.js';
import type { SpellReactionWindow } from './reactions.js';
import type { HealingRule } from './vitals.js';

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
export type RiderDuration =
  | 'start-of-casters-next-turn'
  | 'end-of-casters-next-turn'
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
  readonly repeats?: {
    readonly at: TurnMoment;
    readonly onSuccess: 'end-on-target' | 'end-casting';
  };
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
      readonly change: SpeedChange;
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
       * at different ones" — so the rolls are dealt over the named targets in
       * the order they were named, one each and round again for the surplus
       * ({@link rollsDealtTo}). Naming one creature sends every roll at it and
       * naming as many creatures as there are rolls sends one each, which are
       * the two cases the sentence prints; an uneven split is said by naming
       * the creature that takes more of them first. The engine never picks the
       * creatures and never picks a face.
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
   * A saving throw; a condition on a failure.
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
      readonly condition: ConditionName;
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
       * A saving throw the condition repeats at a turn boundary, if it does.
       * Feeds straight into the turn-hook machinery.
       */
      readonly repeats?: {
        readonly at: TurnMoment;
        readonly onSuccess: 'end-on-target' | 'end-casting';
      };
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
   * Deliberately not Barkskin: "an Armor Class of 17 if its AC is lower than
   * that" is a floor on the *total*, a different rule, and one spell is not
   * evidence for building it.
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
   * measured against rather than a roll. And two of the three operations are
   * not arithmetic at all — SRD Slow halves and Hypnotic Pattern zeroes, and
   * a bonus that added would make a halving a negative number nobody printed.
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
  | {
      readonly kind: 'interrupt-casting';
      readonly ability: Ability;
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
    };

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
 * Three members, and each one has a reader: a condition substitutes into the
 * conditions an effect imposes or removes, an ability and a skill into the
 * narrowing on a granted mode or bonus. A fourth would be a vocabulary member
 * nothing keeps — see {@link SpellDefinition.choiceStated}.
 */
export type StatedChoiceOf = 'condition' | 'ability' | 'skill';

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
   * Five sentences across eight executed spells, and each member below is one
   * of them transcribed rather than a category somebody invented.
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
 * **A closed list of five, and what keeps it closed is that each member names
 * a fact the log already holds on an event that already has consequences.**
 * `target-deals-damage` is `damage-taken` naming its dealer — the field
 * Hellish Rebuke needed, because prose cannot be aimed at — and
 * `target-dons-armor` is `item-equipped` naming a piece of body armour. A
 * trigger whose fact the log does not hold is filed in `missing-shapes.ts`
 * instead: Sequester's caster-chosen condition, Faithful Hound's 300 feet,
 * Guardian of Faith's running total, and the several spells that end on
 * **any** damage rather than on the caster's, are all still there.
 *
 * Four of the five are {@link EffectEndCause}, declared in `timers.ts`
 * because a timer an item filed reads them too; the fifth is the one a casting
 * adds, because only a casting has a caster for "you or one of your allies" to
 * be about.
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
  | 'caster-or-ally-damages-target';

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

/** How far a range reaches in feet, or null where it is not a distance at all. */
export const ranged = (range: SpellRange): number | null =>
  range.kind === 'ranged' ? range.feet : range.kind === 'touch' ? 5 : null;

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
  if (of === 'condition') return false;
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
 * Two of the five members are anchored to the caster's own turn; one to the
 * creature the rider is being hung on; one is a span on the clock; and one —
 * the turn in progress ending — is anchored to nobody, so it ignores both and
 * is resolved against whoever is taking the turn. The whole reason they are
 * separate members is that none of them is interchangeable with another — see
 * {@link RiderDuration}.
 *
 * **`targetId` is optional and the target-anchored member requires it**, which
 * is not a contradiction: the two callers that pass none are the two that
 * cannot reach that member. The pre-flight asks the caster-anchored deadlines
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
  switch (lasts) {
    case 'end-of-current-turn':
      return endOfCurrentTurn;
    case 'end-of-targets-next-turn': {
      if (targetId === undefined) {
        throw new Error(
          'a deadline anchored on the target needs the target; ask it per target, as the pre-flight and the rider resolvers do',
        );
      }
      return endOfNextTurn(targetId);
    }
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
 */
export function anchoredOnTarget(lasts: RiderDuration): boolean {
  if (typeof lasts === 'object') return false;
  switch (lasts) {
    case 'end-of-targets-next-turn':
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
 */
export function conditionRiderOf(
  effect: Extract<SpellEffect, { kind: 'save' | 'condition' }>,
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
        {
          name: effect.condition,
          ...(effect.lasts === undefined ? {} : { lasts: effect.lasts }),
          ...(effect.check === undefined ? {} : { check: effect.check }),
          ...(effect.outlivesCasting === undefined
            ? {}
            : { outlivesCasting: effect.outlivesCasting }),
          ...(effect.repeats === undefined ? {} : { repeats: effect.repeats }),
        },
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
 * **One case, and the compiler keeps it honest.** `CastingRoute`'s item arm
 * carries `ability: Ability | null`, so a second resolver that reaches for the
 * caster's ability fails to typecheck rather than silently reading a null.
 */
export function castersAbilityRead(definition: SpellDefinition): boolean {
  return definition.effects.some((effect) => effect.kind === 'dispel');
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
      // **The one kind whose answer is conditional**, and the condition is the
      // resolver's own: SRD Bane is a `buff` that a Charisma save resists, and
      // SRD Bless is a `buff` that nobody rolls against at all. `ability` is
      // what tells the two apart in `resolveBuffEffect`, so it is what tells
      // them apart here — marking the whole kind would ask a Bless wand's
      // wielder to choose an ability nothing would read.
      case 'buff':
        if (effect.ability !== undefined) saveDc = true;
        break;
      // The rest reach neither: they heal, grant, defend, move or dispel, and
      // a dispel's own check is against 10 plus the spell's level rather than
      // against anything this casting pinned.
      case 'temp-hp':
      case 'roll-mode':
      case 'armor-class':
      case 'damage-defense':
      case 'condition-immunity':
      case 'speed':
      case 'attack-rider':
      case 'heal':
      case 'turn-payout':
      case 'action-rule':
      case 'healing-rule':
      case 'hit-point-maximum':
      case 'dispel':
      case 'teleport':
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
  return {
    ...(conditions.length === 0 ? {} : { conditions }),
    ...(modifiers.length === 0 ? {} : { modifiers }),
    ...(delayed === undefined ? {} : { delayed }),
    ...(movement === undefined ? {} : { movement }),
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
    riders.movement !== undefined
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
 * The most attack rolls any one effect of this list will make.
 *
 * What a caller may name creatures up to, because a creature is named *for* a
 * roll. The maximum rather than a sum: two attack effects in one list are two
 * things that each happen to every target, not a pool of rolls to divide, and
 * the target list has to be long enough for the longest of them.
 *
 * **Zero for a list with no attack in it**, which is the honest answer and not
 * the useful one: a Detect Magic makes no attack rolls, and seeding at one so
 * that the number could be used as a bound unexamined would have this function
 * saying every spell in the book throws an attack. A caller wanting a floor
 * says so where it wants it.
 */
export function attackRollsIn(
  effects: readonly SpellEffect[],
  spellLevel: number,
  casterLevel: number,
  slotLevel: number,
): number {
  return effects.reduce(
    (most, effect) =>
      effect.kind === 'attack'
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
 */
export function rollsDealtTo(total: number, targets: number, index: number): number {
  if (targets <= 0) return 0;
  return Math.floor(total / targets) + (index < total % targets ? 1 : 0);
}
