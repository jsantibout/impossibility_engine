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
import type { CreatureSize } from '@ie/srd';

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
   * `end-casting` is SRD Ensnaring Strike's: "The target or a creature within
   * reach of it can take an action to make a Strength (Athletics) check
   * against your spell save DC. **On a success, the spell ends.**" The whole
   * casting goes — the vines, the Concentration, the die at the boundary —
   * which is the release a repeat save's `end-casting` already performs. It
   * stood refused while Maze, Phantasmal Force and Detect Thoughts were each
   * blocked on something else and nothing could be written with it.
   */
  readonly onSuccess: 'none' | 'end-on-target' | 'end-casting';
  /**
   * SRD Ensnaring Strike: "The target **or a creature within reach of it** can
   * take an action to make a Strength (Athletics) check".
   *
   * Who may attempt a check is derived from what the timer sits on — a
   * condition is its holder's to shake off — and this is the one clause in the
   * book that widens the derivation: an ally standing beside the snared
   * creature may spend its own action on the same check. Read by
   * `availableChecks` and `resolveEffectCheck`, which measure the reach off
   * the map. The only value is `true`; absent is every other check, which the
   * affected creature alone may attempt.
   */
  readonly byAnotherWithinReach?: true;
}

/**
 * A mode a saving throw takes because of the **size** of the creature making
 * it.
 *
 * SRD Ensnaring Strike: "A Large or larger creature has Advantage on this
 * save." An outcome shaped by a fact the engine holds — `effectiveSizeOf`
 * reads the size a feature prints, then the stated one, then the map's — and
 * no effect read it until this. `sizeAtLeast` is the floor the sentence names
 * and `mode` is what a creature at or above it rolls with; it reaches the roll
 * as a named `ModeSource` and never as a number, because Advantage cancels
 * rather than stacks — a Large creature that is also Restrained rolls a
 * normal save, and the log still says both were in play.
 */
export interface SizedSaveMode {
  readonly sizeAtLeast: CreatureSize;
  readonly mode: 'advantage' | 'disadvantage';
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
   * A second moment the save is raised at, and what that moment does to it —
   * see `RepeatSave.alsoWhenDamaged`, where the shape and its reader are
   * argued.
   *
   * SRD Hideous Laughter, and the one spell in the book that writes it: "At
   * the end of each of its turns **and each time it takes damage**, it makes
   * another Wisdom saving throw. The target has Advantage on the save if the
   * save is triggered by damage."
   */
  readonly alsoWhenDamaged?: { readonly mode: 'advantage' };
  /**
   * A fact that must hold at the boundary for the save to be owed at all.
   *
   * SRD Fear: "If the creature ends its turn in a space where it doesn't have
   * line of sight to you, the creature makes a Wisdom saving throw. On a
   * successful save, the spell ends on that creature." Every other repeat in
   * the book is owed at its moment unconditionally; this one is owed only
   * where the creature cannot see the caster, and a boundary that raised it
   * regardless would hand a cornered goblin a save the book withholds.
   *
   * **Read by the fold where the debt is raised, off the same pairwise sight
   * the rest of the engine reads** — `canSee(target, caster)` — and the
   * three-valued answer keeps its meaning: only a declared *no* raises the
   * save. Nobody having said is not the creature having lost sight of the
   * caster, and a boundary has nobody to ask; the table declares sight and
   * the next boundary reads it. The caster is the casting's, found through
   * the mark the condition carries, so a repeat under any other source is
   * never gated — there is no caster for the sentence to be about.
   *
   * A union of one member, for {@link alsoWhenDamaged}'s reason: the field
   * says what the gate *reads*, and a second sentence of this shape arrives
   * as a second member rather than as a boolean.
   */
  readonly onlyIf?: 'cannot-see-caster';
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
 * class features alike, and this is the narrowing to the ones a definition can
 * name *with a word*. The narrowing is what keeps `triggerRefusal` exhaustive
 * over exactly what exists; the sharing is what keeps *Hellish Rebuke* and the
 * Barbarian's Retaliation from growing two readings of one rule.
 *
 * **`targeted-by-spell` is excluded, and the exclusion is the point of the
 * field beside this one.** That window is real and a spell answers it — SRD
 * *Shield*'s second trigger — but a definition naming it would have said which
 * *spell*'s targeting it answers, and a member of a string union carries no
 * id. So it is `SpellDefinition.targetedBy`, which is a spell id, and this
 * union stays the set of moments a bare word describes.
 */
export type ReactionTrigger = Exclude<SpellReactionWindow, 'targeted-by-spell'>;

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
 * **There is no horizontal direction, and that is the finding rather than an
 * omission.**
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
 *
 * **Up is the one direction a bearing could never have named**, which is what
 * {@link ForcedMovement.kind} is for and why it is a member rather than an
 * angle: elevation is its own axis on this lattice, and SRD Levitate's "rises
 * **vertically** up to 20 feet" is a sentence no compass reading expresses.
 */
export interface ForcedMovement {
  /** SRD Thunderwave's "10 feet", straight away from the caster. */
  readonly feet: number;
  /**
   * Which way the outcome moves the creature. Absent is `push`.
   *
   * **Two members, because the book writes two sentences this rider can
   * perform** — and it is optional so that every definition written before it
   * means exactly what it always meant:
   *
   * | | |
   * |---|---|
   * | `push` | SRD Thunderwave, Gust of Wind: "pushed 10 feet **away from you**", along the bearing from the caster |
   * | `lift` | SRD Levitate: "**rises vertically** up to 20 feet and remains suspended there for the duration" |
   *
   * **A pull is still not here**, for the reason the paragraph above gives:
   * `pullToward` exists and a monster's attack rider reaches it, no spell in
   * reach writes one, and a member no definition asks for is mechanism built
   * ahead of its consumer.
   *
   * **A lift is the one movement the casting keeps.** A push is over the
   * instant it lands and the creature stands where the wave left it; a lift is
   * *held* — "remains suspended there for the duration" — so it hangs a
   * `GrantedLift` under the casting's own source, and SRD's "When the spell
   * ends, the target floats gently to the ground if it is still aloft" is the
   * fold handing the elevation back at release. That makes it the only rider
   * whose undoing is part of the sentence that imposed it, and the reason it
   * is refused on a host with no casting to keep it.
   */
  readonly kind?: 'push' | 'lift';
  /**
   * The largest creature this movement moves — SRD Repelling Blast: "When you
   * hit a **Large or smaller** creature".
   *
   * `HitOptionGrant.targetNoLargerThan` and SRD Push's own ceiling, on the
   * third host that prints the clause, and read exactly as those two are:
   * `effectiveSizeOf` answers, a creature nobody has sized is taken for what
   * the map assumes, and a creature too big simply stands where it was with
   * the reason on the casting's `unverified`. It is a gap rather than a
   * refusal because by the time a rider runs the slot is spent and the damage
   * has landed.
   *
   * Absent asks nothing, which is every rider written before it: SRD
   * Thunderwave pushes a Gargantuan creature exactly as it pushes a Gnome.
   */
  readonly targetNoLargerThan?: CreatureSize;
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
   * The condition ends the moment its holder is no longer in the area that
   * imposed it.
   *
   * SRD Web: "have the Restrained condition **while in the webs** or until it
   * breaks free." A lifetime that is neither a span, nor a moment in the turn
   * order, nor a save — it is a fact about where the creature is standing, and
   * `docs/design/space-and-areas.md` said in as many words that it had no
   * shape here.
   *
   * **Legal only on a rider an {@link AreaTrigger} hosts**, which is what
   * makes it answerable: the trigger is pinned whole onto the ongoing record
   * at the cast, so the fold reads the mark and the area together out of the
   * log and opens no catalogue. A rider on the spell's own `effects` has no
   * pinned area beside it — the record stores the area but not the effects —
   * so the validator refuses it there rather than letting a definition ask
   * for an ending nothing would ever perform.
   *
   * **Not {@link outlivesCasting}'s neighbour and not its opposite.** That one
   * severs the casting's ownership of the condition; this one keeps it and
   * adds a second way out, so a Web that ends takes its Restrained with it
   * exactly as before and a creature that walks out loses it sooner.
   */
  readonly endsWhenOutsideArea?: true;
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
  /**
   * Extra damage the same outcome hangs on the **caster's later blows**
   * against the creature it settled on.
   *
   * SRD Bestow Curse, the fourth of its four faces: "If you deal damage to the
   * target with an attack roll **or a spell**, the target takes an extra 1d8
   * Necrotic damage." One Wisdom save, one consequence, and the consequence
   * outlives the roll that bought it — which is the argument every member of
   * this union makes.
   *
   * **It is `later-blow` and not `attack-rider`, because a rider kind may
   * never be an effect kind**, the rule `bonus`, `mode`, `speed-change`,
   * `action` and `healing` all keep. What it grants *is* the `attack-rider`
   * grant: the same `attack-rider-granted` event, the same
   * {@link GrantedAttackRider} read by the same gatherer, so there is one
   * mechanism with two doors into it rather than two that could disagree.
   *
   * **The grant lands on the caster and is about the host's target**, which is
   * the one thing this rider does that no other member does. That is not an
   * exception invented here: it is what `resolveAttackRiderEffect` has always
   * done — SRD Hunter's Mark marks a quarry ninety feet away and the die is
   * the ranger's — and the marked creature is the creature the outcome settled
   * on, so `marksTarget` needs no field of its own here. The reason the effect
   * kind cannot be written in a branch is the reason this exists: an effect
   * appended after a save does not know how the save went.
   *
   * **It carries no `lasts`**, for the reason `bonus` carries none: the
   * sentence runs for the casting's own duration, and an Instantaneous host
   * would leave a die nothing could take back. `checkGrantLifetimes` refuses
   * that pairing.
   */
  | {
      readonly kind: 'later-blow';
      /** The extra dice the sentence prints, e.g. `1d8`. */
      readonly dice: string;
      /**
       * The type it prints: Bestow Curse's Necrotic.
       *
       * **Absent is the blow's own type.** SRD Enlarge/Reduce: "deal an extra
       * 1d4 damage on a hit" — damage with no type of its own, so it is the
       * weapon's, exactly as SRD Magic Weapon's plus is; `standingAttackDamage`
       * files an untyped rider beside the bonuses of the blow's own type and a
       * typed one beside the extra components, which is the same fork a
       * feature's `attack-damage` grant already takes.
       */
      readonly damageType?: string;
      /**
       * SRD Enlarge/Reduce: "The target's attacks with its enlarged **weapons
       * or Unarmed Strikes**". Every attack roll but a spell's — where SRD
       * Divine Favor's `weaponOnly` reaches weapons alone and SRD Hunter's Mark
       * reaches a Fire Bolt too. Read by `grantedAttackRiders` off the one
       * fact that tells the roads apart: the spell attack says it is one.
       */
      readonly weaponOrUnarmedOnly?: true;
      /**
       * SRD's "with an attack roll **or a spell**".
       *
       * Absent is the attack roll alone, which is what SRD Hunter's Mark and
       * SRD Hex print and what the effect kind's own writers mean. See
       * {@link GrantedAttackRider.alsoSpells}, which is where the difference
       * is read and where the two roads a blow can take are told apart.
       */
      readonly alsoSpells?: true;
      /**
       * Whose later blows carry the die.
       *
       * Absent is the **caster's**, which is what SRD Hunter's Mark, SRD Hex
       * and SRD Bestow Curse all print — "whenever **you** hit it" — and the
       * reason `resolveAttackRiderEffect` has always hung the die on the
       * caster and marked the target. SRD Enlarge/Reduce prints the other
       * sentence: "**The target's** attacks … deal an extra 1d4", so the
       * grant lands on the target and marks nobody. One field, because the
       * book prints exactly these two subjects.
       */
      readonly by?: 'target';
    }
  | {
      readonly kind: 'bonus';
      readonly bonus: Bonus;
      readonly applies: readonly BonusApplies[];
      readonly direction: 'add' | 'subtract';
      /**
       * Which of those rolls it reaches — see {@link BonusNarrowing}, and the
       * `buff` effect's own `only`, which is this field on the kind that rolls
       * a save of its own.
       *
       * SRD Slow: "it takes a −2 penalty to AC **and Dexterity saving
       * throws**". Two families off one printed penalty, and only one of them
       * is narrowed — an Armour Class is not a roll and is made with no
       * ability at all, which is why the same spell writes two riders rather
       * than one with a list. Absent is the unnarrowed sentence, which is
       * every other rider in the book.
       */
      readonly only?: BonusNarrowing;
    }
  /**
   * An amount the same roll makes its target take off the damage **it** deals.
   *
   * SRD Ray of Enfeeblement: "On a failed save, the target has Disadvantage on
   * Strength-based D20 Tests for the duration. During that time, it **also
   * subtracts 1d8 from all its damage rolls**." One Constitution save, two
   * consequences, which is the argument every member of this union makes —
   * and writing the second as an effect of its own would roll a second save
   * for one sentence.
   *
   * **It is not a `bonus` aimed at damage, and the refusal is older than this
   * rider.** {@link BonusApplies} has no damage member on purpose: a spell
   * that *adds* damage adds it at a moment, with a source and a type, so it is
   * a rider on the casting that deals it and `bonusesFor` has never needed a
   * damage reader. This sentence names no moment and no type. It is a standing
   * arrangement consulted by every damage roll its holder makes afterwards,
   * whatever made it — the lifetime `GrantedDamageReduction` already has on
   * the other side of a blow, and `GrantedDamagePenalty` is the mirror of it.
   *
   * **The subtraction is not damage of a type.** It comes off the blow's total
   * as an adjustment, before Resistance, which is SRD's own Order of
   * Application and is observable: 10 Fire less 7 against a fire-resistant
   * target is 1 in that order and 0 in the other.
   *
   * **It carries no `lasts`**, for the reason `bonus` carries none: both
   * sentences in reach run for the casting's own duration — Ray of
   * Enfeeblement's "for the duration", Enlarge/Reduce's reduced half — so
   * `checkGrantLifetimes` refuses the rider on an Instantaneous host rather
   * than offering a deadline nothing asks for. On **either** branch: the
   * success slot is walked by `grantOnASuccess`, so the refusal is not one a
   * definition can get round by writing the penalty on the other side.
   */
  | {
      readonly kind: 'damage-penalty';
      /** SRD Ray of Enfeeblement's "1d8", thrown at the blow and never at the cast. */
      readonly dice?: string;
      /** A printed number, where the sentence prints one instead of dice. */
      readonly flat?: number;
      /**
       * SRD Enlarge/Reduce: "this can't reduce the damage below 1."
       *
       * Absent is no floor, which is what Ray of Enfeeblement prints. Read
       * against the blow's **total**, because that is the number the
       * parenthesis is about.
       */
      readonly floor?: number;
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
   * An Immunity the same roll grants, and — where the sentence says so — the
   * silencing of a condition the creature already has.
   *
   * SRD Calm Emotions: "The creature has Immunity to the Charmed and
   * Frightened conditions until the spell ends. If the creature was already
   * Charmed or Frightened, those conditions are suppressed for the duration."
   * One Charisma save gates it, so it is a rider like the rest; the
   * `condition-immunity` effect it grants is the one SRD Mind Blank and SRD
   * Heroism write with nothing rolled.
   *
   * **`suppressesHeld` is the second sentence and is opt-in**, because the
   * book prints it once: an Immunity refuses a condition that has not landed,
   * and this says the one that already has goes quiet rather than being ended
   * — `suppressedConditions` reads the grant exactly as it reads SRD Aura of
   * Courage's standing one, and the condition is there again the moment the
   * casting ends, with nobody having to remember to put it back. Heroism's
   * Immunity prints no such sentence and leaves it off.
   *
   * It is `immunity` and not `condition-immunity`, because a rider kind may
   * never be an effect kind — `checkShape`'s denylist, and the reason `buff`'s
   * rider is `bonus`. It carries no `lasts`, for `bonus`'s reason.
   */
  | {
      readonly kind: 'immunity';
      /** The conditions the sentence names, never empty. */
      readonly conditions: readonly ConditionName[];
      /** SRD Calm Emotions' "those conditions are suppressed for the duration". */
      readonly suppressesHeld?: true;
    }
  /**
   * A size the same roll moves by a category.
   *
   * SRD Enlarge/Reduce: "The target's size increases by one category — from
   * Medium to Large, for example" and "decreases by one category". One
   * Constitution save gates four clauses on each branch, so this is a rider
   * like the modes and the die beside it, and writing the size as an effect of
   * its own would roll a second save for one sentence.
   *
   * **A step, not a size**, and a sourced grant rather than a write:
   * `GrantedSize` in `size.ts` is the Mask's twin over the other fact a
   * creature is, `effectiveSizeOf` reads it over whatever size otherwise
   * stood, and every door that ends a grant gives the size back. It carries no
   * `lasts`, for `bonus`'s reason: the one sentence in reach runs for the
   * casting's duration, and `checkGrantLifetimes` refuses it on an
   * Instantaneous host rather than offering a deadline nothing asks for.
   */
  | {
      readonly kind: 'size';
      /** `1` for Enlarge, `-1` for Reduce; the book prints one category either way. */
      readonly steps: 1 | -1;
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
      readonly change: Exclude<SpeedChange, 'match-walk' | 'only'>;
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
      /**
       * The denial holds against the **caster** and nobody else.
       *
       * SRD Mind Spike: "if it has the Invisible condition, it gains no
       * benefit from that condition **against you**." SRD Starry Wisp and SRD
       * Faerie Fire write the same clause with no such words, and absent is
       * that blanket denial.
       *
       * **`'caster'` is the only value, because it is the only role the
       * sentence can name.** `CounterpartRole`'s other member is the creature
       * the rider is hung on, and a benefit denied against *itself* is a
       * denial against nobody — so this is a one-member union rather than a
       * reuse of that type with a value the validator would have to refuse.
       *
       * A role rather than an id, for the reason `ModifierRider.counterpart`
       * carries one: the resolver binds it, because the fold opens no
       * catalogue and "you" is not a fact a book can hold.
       *
       * **What it does not reach is the point of it.** Invisible's Advantage
       * on Initiative is a roll against nobody, so a narrowed denial leaves it
       * standing — which is what the SRD sentence says and what a blanket one
       * would get wrong.
       */
      readonly against?: 'caster';
      /** A deadline of the rider's own, shorter than the casting's. */
      readonly lasts?: RiderDuration;
    }
  /**
   * Damage the same outcome makes the creature take at **every one of its own
   * turn boundaries**, for as long as the casting holds it.
   *
   * SRD Ensnaring Strike: "While Restrained, the target takes 1d6 Piercing
   * damage at the start of each of its turns." A `GrantedPayout` of damage —
   * the same standing arrangement SRD Heroism hangs for Temporary Hit Points
   * and the glossary's Burning derives — hung off a settled outcome rather
   * than off the casting's own list, because the book gates it on the failure:
   * a creature that saved takes nothing at its next turn. The boundary throws
   * the die (`settleBoundaryPayouts`), the damage meets the creature's own
   * defences, and the arrangement goes when the casting does or when the
   * casting is released on that creature — which is what "while Restrained"
   * means for a condition that is the casting's.
   *
   * **Scaled like the blow**, at the slot the casting paid: "The damage
   * increases by 1d6 for each spell slot level above 1" is one sentence about
   * both the die and its growth, so the notation the payout pins is worked out
   * once at the cast and the boundary reads a notation rather than a catalogue.
   *
   * `damage` only, because that is the sentence the book prints on an outcome;
   * a payout of healing or Temporary Hit Points off a failed save is a spell
   * nobody has written.
   */
  | {
      readonly kind: 'payout';
      readonly at: TurnMoment;
      readonly payout: 'damage';
      readonly damage: DiceScaling;
      readonly damageType: string;
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
 * **Which branch a rider rides is the host's, never the author's, and the
 * slot name is what says so.** This value is the *affirmative* outcome's — a
 * hit, a failed save — and there is nothing in it that could name a branch,
 * which is the invariant `applyRiders` rests on: it is handed a settled
 * outcome's riders and never asked which one.
 *
 * **A success has its own slot and not a member here**, which is the shape
 * that sentence was one consumer short of. SRD Ray of Enfeeblement: "On a
 * successful save, the target has Disadvantage on the next attack roll it
 * makes until the start of your next turn." {@link save.onSuccessRiders} is a
 * second value of this type, written under a name that says which branch it
 * rides, so the vocabulary is shared and the branch is still the host's.
 * There is still no *miss*-branch slot: a miss's only printed consequence is
 * damage, which `attack.onMiss` says already.
 */
/**
 * A thing taken out of a creature's hands against its will, and what happens
 * where it cannot be.
 *
 * > SRD Heat Metal: "the creature must succeed on a Constitution saving throw
 * > or **drop the object if it can**. **If it doesn't drop the object**, it
 * > has Disadvantage on attack rolls and ability checks until the start of
 * > your next turn."
 *
 * The half of `what-a-creature-is-holding` that was still missing.
 * `dropConjured` ends a conjured thing, which ceases to exist and refuses
 * everything else by name; this is the ordinary object, which has to land
 * somewhere, and the floor is a thing the engine keeps.
 *
 * **It names no object**, for the reason `dispel` names no numbers: which
 * thing is a decision the caster made at the casting, and it arrives as
 * `CastSpellRequest.object` — required by a definition that carries this rider
 * and refused by one that does not.
 *
 * **"If it can" is a count of hands.** A thing wielded in a hand can be let go
 * of; body armour is worn, takes none, and comes off with a doffing the spell
 * does not grant. `handsFor` is the one reader of that, so a homebrew item
 * that prints its own `hands` answers here without anything being added.
 *
 * ### `orElse`, and why the second sentence is inside the rider
 *
 * The SRD prints two sentences about one branch, and the second is conditional
 * on what the first did. Writing them as two riders side by side would make
 * the Disadvantage unconditional — the creature that *did* drop the mace would
 * take it too — and having the resolver quietly skip one rider when another
 * fired would be a rule hidden in the engine rather than written in the
 * definition. One rider with two clauses is the sentence as the book prints
 * it, and the branch is visible to a reader of the definition.
 *
 * **A creature that succeeded on the save keeps the object and takes
 * nothing**, which is this reading of the second sentence: the drop it refers
 * back to is the one the *failure* demanded, and a creature that was never
 * asked to drop anything has not failed to. The other reading — that anyone
 * still holding the thing is hindered — makes the saving throw buy nothing at
 * all, which is not a sentence the SRD writes anywhere else.
 */
export interface DropRider {
  /**
   * Everything the creature is holding, rather than the one thing the casting
   * named.
   *
   * > SRD Command, _Drop_: "The target drops **whatever it is holding** and
   * > then ends its turn."
   *
   * The paragraph above says the rider names no object because which thing is
   * the caster's decision; this is the sentence where there is no decision to
   * make, and so no `CastSpellRequest.object` to demand. The two are told
   * apart at the door rather than at the table: `namesAnObject` answers no for
   * a definition whose every drop is an `all`, so the caster is not asked for
   * an object they were never offered, and `object_required` still refuses a
   * Heat Metal that named none.
   *
   * **"Whatever it is holding" is the same count of hands the named drop
   * uses.** `handsFor` answers it item by item — a mace and a shield are let
   * go of, a breastplate is worn and stays on — so the two arms agree about
   * what holding means rather than each having an opinion.
   *
   * `orElse` is read per item and hangs once: a creature that let go of
   * everything it could takes nothing, and one that could let go of nothing
   * takes the clause the book prints after the drop.
   */
  readonly all?: true;
  /**
   * What the outcome does where the object cannot be let go of.
   *
   * {@link ModifierRider}s and not effects, because they are the same kind of
   * leaf every other rider is: they roll nothing, target nobody of their own
   * and spend nothing. The lifetime rules are the rider's own — SRD Heat
   * Metal's "until the start of your next turn" is a `lasts` — so an
   * Instantaneous host is caught by `checkGrantLifetimes` exactly as it is
   * anywhere else.
   *
   * **A list, because the SRD clause names two rolls**: "Disadvantage on
   * attack rolls **and** ability checks" is one sentence over two
   * {@link RollSelector}s, and a selector says one family. The same plurality
   * {@link OutcomeRiders.modifiers} has, for the same reason.
   */
  readonly orElse?: readonly ModifierRider[];
}

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
  /**
   * A thing the outcome takes out of the target's hands: see {@link DropRider}.
   *
   * Singular, because the SRD sentence is: Heat Metal heats **the** object and
   * the failure lets go of that one. A spell that emptied both hands would be
   * a different clause and prints no rider here.
   */
  readonly drops?: DropRider;
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

/**
 * A second resolution the first one is followed by, over an area the casting
 * never named.
 *
 * SRD Ice Knife, whole: "Make a ranged spell attack against the target. On a
 * hit, the target takes 1d10 Piercing damage. **Hit or miss, the shard then
 * explodes.** The target and each creature within 5 feet of it must succeed on
 * a Dexterity saving throw or take 2d6 Cold damage."
 *
 * **It is not a rider, and "Hit or miss" is the word that says so.**
 * {@link OutcomeRiders} rejected this by name — "a child that rolls is a
 * parent" — and the rejection stands: every rider hangs off a *settled
 * outcome* and rides the affirmative branch, and this hangs off no branch at
 * all. So it is a second parent rather than a sixth kind of leaf, and it says
 * so in the three ways a parent differs from a leaf: it rolls, it has an area,
 * and it picks its own targets.
 *
 * **One level, and the validator keeps it there.** A `then` inside a `then` is
 * the recursion the rider design exists to refuse, arriving one storey up;
 * `checkEffect` refuses it, so what a definition can express is a sequence of
 * two and never a program.
 *
 * **The point is derived and never stated.** "within 5 feet of **it**" is the
 * space the first roll reached, which is where the target is standing — so the
 * area's origin is that creature rather than a point the caster names, and a
 * casting that never placed anybody simply catches the target alone and says
 * so. `SpellArea`'s Sphere is reused rather than a radius being spelled out
 * again, so `creaturesInArea` reads it exactly as it reads a Fireball's.
 *
 * **A Sphere and nothing else**, because that is the only shape the SRD prints
 * in this position: a Cone or a Line would need a direction, and there is
 * nobody to state one — the shard is already in the air.
 */
export interface SequencedBurst {
  /** SRD Ice Knife's "within 5 feet of it", centred on the space it reached. */
  readonly area: Extract<SpellArea, { readonly kind: 'sphere' }>;
  /** What the burst does, to each creature it catches. */
  readonly effects: readonly SpellEffect[];
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
       * What happens next, **whatever the attack did**: see
       * {@link SequencedBurst}.
       *
       * SRD Ice Knife: "**Hit or miss**, the shard then explodes."
       */
      readonly then?: SequencedBurst;
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
      /**
       * SRD Chromatic Orb: the orb **leaps** off its own dice — see
       * {@link OrbLeaps}. Absent is every other attack in the book.
       */
      readonly leaps?: OrbLeaps;
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
   * A creature brought back from being dead.
   *
   * SRD Revivify: "You touch a creature that has died within the last minute.
   * That creature revives with 1 Hit Point."
   *
   * **Not `heal` with a small number in it**, which is the shape
   * `healing-that-raises-the-dead` was named for and the reason this is its
   * own kind. `healCreature` refuses a corpse in its first line and the
   * refusal costs no slot — `docs/design/spell-definitions.md` states it as
   * the rule this shape has to get past — because hit points do not lift
   * death. A kind that reached the same event would have made every Cure
   * Wounds a resurrection.
   *
   * **The window is the spell's and the clock is the engine's.** How long a
   * creature has been dead is subtraction over `Vitals.diedAt` and
   * `state.elapsed`, and the fact is derived by the fold from the only thing
   * that is reliably true — a creature that was alive and now is not — rather
   * than from any one of the four events that can kill somebody.
   *
   * What the spell leaves to the table is what it says it leaves: dying of old
   * age, and the body parts it does not restore. Neither is a fact the engine
   * holds, and neither would be settled by holding one.
   */
  | {
      readonly kind: 'revive';
      /**
       * How long after death the spell still reaches, in whole seconds.
       *
       * SRD Revivify's minute. A window rather than a boolean because the
       * higher-level resurrections print longer ones and this is the number
       * that differs between them; a spell with no window at all would be a
       * different sentence and prints none here.
       */
      readonly within: number;
      /**
       * What the creature comes back at — SRD Revivify's one Hit Point.
       *
       * A flat whole number rather than a {@link DiceScaling}, because every
       * SRD sentence of this shape prints a flat number and none of them
       * scales: what a bigger slot buys in this family is a longer window and
       * a wider spell, never more hit points.
       */
      readonly hitPoints: number;
    }
  /**
   * A dying creature stopped from dying — SRD Spare the Dying, whole: "Choose
   * a creature within range that has 0 Hit Points and isn't dead. The creature
   * becomes **Stable**."
   *
   * **Not `heal` with a zero in it and not {@link revive} with a smaller
   * window**: being Stable is neither hit points nor life restored. It is the
   * one fact `stabiliseCreature` writes and `Vitals.stable` holds — a creature
   * that stops making death saves and stays at 0 — and the event it emits is
   * the same `stabilised` a DM's declaration emits, so every reader of the
   * fact is reached by the route it always was.
   *
   * **It carries nothing**, which is the whole shape of the sentence: no
   * amount, no window, no scaling. Who it may be aimed at is the target rule
   * beside it ({@link TargetRule.mustBeDying}), because "has 0 Hit Points and
   * isn't dead" selects a target rather than describing an outcome — and the
   * refusal is therefore free, before an action is spent.
   */
  | { readonly kind: 'stabilise' }
  /**
   * A body the casting keeps, so the time it lies there does not count against
   * a resurrection's window.
   *
   * > SRD Gentle Repose: "The spell also effectively extends the time limit on
   * > raising the target from the dead, since **days spent under the influence
   * > of this spell don't count against the time limit** of spells such as
   * > _Raise Dead_."
   *
   * **The only sentence in the book where one casting changes another
   * casting's arithmetic.** {@link revive}'s window is subtraction over
   * `Vitals.diedAt` and `state.elapsed`, and this takes its own running span
   * back out of the difference — so a corpse that died a minute before the
   * repose began is still within Revivify's minute a week later.
   *
   * **It carries nothing and it writes nothing**, which is what makes it a
   * mark rather than a grant: the fact `revive` reads is *that this casting is
   * running on this body, and since when*, and both halves are on the ongoing
   * record the casting already leaves (`OngoingSpell.preserving`). A grant
   * would have needed a holder, a release and a reader, and there is nothing
   * about the creature to change — being preserved is a fact about the
   * casting.
   *
   * So it is refused on a definition that leaves no casting running: a spell
   * with no duration would mark a body for no time at all.
   */
  | { readonly kind: 'preserves' }
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
       * **One outcome here, because the book prints one here.** SRD Enthrall
       * keys the same fact to an automatic *success* — "Any creature you or
       * your companions are fighting automatically succeeds on this save" —
       * and that is {@link autoSucceedIf}'s `fought` member: the same stated
       * fact, read by the same per-target test, overriding the total the way
       * `autoSucceed` always has rather than moving the die.
       */
      readonly advantageIfFought?: true;
      /**
       * SRD Levitate: "An **unwilling** creature that succeeds on a
       * Constitution saving throw is unaffected."
       *
       * The save is offered to the creature that objects and to nobody else,
       * so a target the casting named in its `willing` list skips the roll and
       * is affected — the mirror of {@link advantageIfFought}, which reads the
       * same kind of stated fact and changes the roll rather than removing it.
       *
       * **And nothing is asked for here**, which is where it parts company
       * with the target rule that spells consent as a gate
       * ({@link TargetRule.willing}). Casting this at a creature that has not
       * consented is exactly what the sentence is about: the unwilling reading
       * is legal, the book hands the objector a die, and a casting that said
       * nothing has said "unwilling", which is the SRD's own default rather
       * than a fact the engine invented.
       *
       * The value is `true` and nothing else: absence is how a spell says it
       * does not print the clause, and `false` would be a second way to say
       * the same thing.
       */
      readonly unlessWilling?: true;
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
       * **Two members, because the book spares a creature two ways.** SRD
       * Animal Messenger: "(if the target's Challenge Rating isn't 0, it
       * automatically succeeds)" — a fact about what the creature *is*,
       * printed on its stat block and pinned at its arrival
       * (`CreatureState.cr`), rather than a defence it holds. The two are one
       * field because they are one sentence in the grammar of a save: the die
       * is thrown, recorded, and overridden. A creature whose rating nobody
       * has stated is **asked about** rather than read as a zero — a player
       * character has no Challenge Rating at all, and zero is the one answer
       * that would always pass.
       *
       * A member per sentence, so neither can be set with the other: a spell
       * that spared two ways would be two sentences and would say so.
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
      readonly autoSucceedIf?:
        | {
            /** SRD Sleep's "Immunity to the Exhaustion condition". */
            readonly immuneTo: ConditionName;
          }
        | {
            /**
             * SRD Animal Messenger's "if the target's Challenge Rating isn't
             * 0" — the rating the sentence spares everything above. Written as
             * a threshold rather than as the word *isn't* because a threshold
             * is what a rule can compare, and 0 is the only number the SRD
             * prints in this position.
             */
            readonly challengeRatingAbove: number;
          }
        | {
            /**
             * SRD Enthrall's "Any creature you or your companions are fighting
             * automatically succeeds on this save."
             *
             * **The third member, and the third kind of fact**: a defence the
             * target holds, a rating printed on its block, and now a fact only
             * the table can declare — the same one {@link advantageIfFought}
             * reads, stated once on `CastSpellRequest.fought` and refused
             * unstated by `declaredFacts`, which `statesFoughtFact` widens to
             * this member. Read per target, because "any creature you are
             * fighting" is about each of them.
             */
            readonly fought: true;
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
       * This save's **whole content is its verdict**.
       *
       * SRD Animal Messenger: "A Tiny Beast of your choice that you can see
       * within range **must succeed on a Charisma saving throw**, or it
       * attempts to deliver a message for you." The failure imposes no
       * condition, hangs no rider and moves nobody: what it decides is whether
       * the beast goes, which is an errand only the table can run.
       *
       * **The fourth thing a save may do, and the one that needs no record.**
       * {@link save.recordsOutcome} above keeps the answer on the running
       * casting, which is why it is refused in the casting's own list — that
       * list resolves before `spell-ongoing` is pushed, so the record it would
       * write onto does not exist yet, and a definition that validated clean
       * would take the campaign down on `CorruptLogError`. This mark wants no
       * record at all: the die is rolled, the answer is published through the
       * casting's result as `SpellTargetOutcome.save`, and it stands in the
       * log as the D20 Test it was. A casting that leaves nothing running
       * still answered its question.
       *
       * So it lifts `save_imposes_nothing` for the definition that claims it,
       * and it is **refused beside every rider and beside `recordsOutcome`**:
       * a save that also halved a Speed, pushed somebody or kept its answer on
       * a record is not a save whose whole content is its verdict, and two
       * ways to say one thing is how a rule comes to be applied twice.
       *
       * And it is refused where a record *does* exist — an `areaTrigger` or an
       * `activation` list fires off a casting the cast has already written, and
       * `recordsOutcome` is the field that keeps an answer there.
       */
      readonly verdictOnly?: true;
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
       * The movement the same failed save delivers: see
       * {@link OutcomeRiders.movement}.
       *
       * Spelled flat for the reason `condition`, `modifiers` and `light` are —
       * this host keeps its own layout — and read through
       * {@link outcomeRidersOf}, so `applyRiders` never learns which host it
       * is serving.
       *
       * **The third host, and the two spells that needed it deal no damage at
       * all.** SRD Gust of Wind: "Each creature in the Line must succeed on a
       * Strength saving throw **or be pushed 15 feet away from you**"; SRD
       * Levitate's lift is gated by a Constitution save with nothing else on
       * the other side of it. Both were unwritable while the slot hung only on
       * `attack` and `save-damage`, because a `save-damage` of no damage is
       * not a thing the format has and a second effect beside the save would
       * have rolled a second saving throw — which is the argument every rider
       * on this host already makes.
       */
      readonly movement?: ForcedMovement;
      /**
       * The same failed save takes the target's Concentration: see
       * {@link OutcomeRiders.breaksConcentration}.
       *
       * Flat for the reason the slot above it is, and SRD Sleet Storm is the
       * writer: "or have the Prone condition **and lose Concentration**".
       */
      readonly breaksConcentration?: true;
      /**
       * The same failed save takes the object out of the target's hands: see
       * {@link OutcomeRiders.drops}.
       *
       * Flat for the reason the two slots above it are, and SRD Heat Metal is
       * the writer: "must succeed on a Constitution saving throw **or drop the
       * object if it can**".
       */
      readonly drops?: DropRider;
      /**
       * What a **successful** save carries with it, where the sentence gives a
       * success a consequence.
       *
       * SRD Ray of Enfeeblement: "**On a successful save**, the target has
       * Disadvantage on the next attack roll it makes until the start of your
       * next turn." One Constitution save, and both branches cost the target
       * something — which is the sentence {@link OutcomeRiders} said it had
       * no slot for: "there is no miss-branch slot and no success-branch slot:
       * the affirmative outcome is the only one that carries riders."
       *
       * **The slot name is the branch, which is why this is a second slot
       * rather than a flag.** Everything the flat fields above and
       * {@link save.modifiers} hang rides the *failure*, because that is a
       * saving throw's affirmative outcome; this rides the other one, and a
       * reader of the definition can see which is which by the name they are
       * written under. `applyRiders` is handed one or the other and never
       * learns there were two, so the rider vocabulary is not forked.
       *
       * **It reuses {@link OutcomeRiders} whole and the validator narrows
       * it**, rather than a type of its own with four members copied out: a
       * success may hang a mode, impose a condition, move the creature or use
       * up a slot of its turn, and `checkSuccessRiders` refuses the rest. The
       * one refused on the book's authority rather than on the plumbing's is
       * `delayed` — **no printed success deals damage**, and a definition that
       * could say so would be a spell rewarding a save with a hit.
       *
       * **A success hangs nothing on the casting's record.** The creature is
       * still `affected: false` in the outcome, because it made its save;
       * what it is carrying is a grant the casting hung, which `spellOn`
       * reads off the world exactly as it reads a failure's.
       *
       * There is no `onSuccessRiders` on `save-damage`, for the reason there
       * is no `onSuccess` here: that host's `onSuccess` already says what a
       * success buys, no SRD sentence in reach hangs a rider on one, and a
       * member no definition can use is the guess this format's unused-member
       * sweep exists to catch.
       */
      readonly onSuccessRiders?: OutcomeRiders;
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
       * The save is made by **the creature the weapon just hit**.
       *
       * SRD Ensnaring Strike: "Casting Time: Bonus Action, which you take
       * immediately after hitting a creature with a weapon … As you hit the
       * target, grasping vines appear on it, and it makes a Strength saving
       * throw." The fourth spell to print the smites' casting time and the
       * first whose payload is a saving throw rather than dice on the blow:
       * "the target" is not a creature type and not a list the caller chose,
       * so the target rule says nobody (`count: 0`, Range Self) and this says
       * who — the creature `resolveAttackDamage` is settling a hit on.
       *
       * Read by `castOnHit` in `commands/attacks.ts`, which resolves the save
       * against that creature once the casting's record is written, and by
       * `castOnAHit`, which is how `resolveSpell` knows to refuse the spell
       * at its own door exactly as it refuses an `attack-damage`. The only
       * value is `true`; the validator holds it to the smite's shape.
       */
      readonly onTheHit?: true;
      /**
       * A mode the target's **size** gives the save — see {@link SizedSaveMode}.
       *
       * SRD Ensnaring Strike: "A Large or larger creature has Advantage on this
       * save." Absent is every other save in the book.
       */
      readonly saveModeIf?: SizedSaveMode;
      /**
       * A success **ends the casting**, where the sentence says so.
       *
       * SRD Ensnaring Strike: "On a successful save, the vines shrivel away,
       * and the spell ends." A casting whose one creature resisted it has
       * nothing left to run, and the book says so in as many words — so the
       * record and the Concentration go in the same batch as the save, and
       * the Ranger's Concentration is free for the next spell.
       *
       * **Only beside {@link save.onTheHit}**, and the reason is the record: a
       * spell cast on a hit writes its record *before* the save it resolves,
       * so there is a casting to end; a casting's own effect list writes its
       * record after its effects, and a success there is `repeats` on a later
       * boundary or a spell that never becomes ongoing. The only value is
       * `true`.
       */
      readonly endsCastingOnSuccess?: true;
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
      /**
       * The condition ends when its holder is no longer in the area.
       *
       * SRD Web's other half — "while in the webs" — and the flat spelling of
       * {@link ConditionRider.endsWhenOutsideArea}, which is where the rule is
       * written down. It is here rather than only on the rider list for the
       * reason `lasts`, `check` and `outlivesCasting` are: `save` keeps its
       * flat layout, and {@link conditionRiderOf} is the view that makes the
       * two one vocabulary.
       */
      readonly endsWhenOutsideArea?: true;
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
   * The target's Attunement to one object, broken.
   *
   * SRD Remove Curse: "If the object is a cursed magic item, its curse
   * remains, but **the spell breaks its owner's Attunement to the object** so
   * it can be removed or discarded."
   *
   * **A curse is fiction and the attunement is not.** `CreatureState.attuned`
   * is a relation the engine holds authoritatively — `attuneItem` writes it,
   * `attunement-ended` takes it away, and the fold ends one when the holder
   * dies or the item leaves — so this is the half of the sentence that is the
   * engine's, and which curses end stays the table's. That split is what
   * `what-ends-attunement-besides-a-command` names.
   *
   * **The effect carries no object**, for the reason `dispel` beside it
   * carries no numbers: which item is a decision the *caster* makes at the
   * casting, not a fact the definition can print. It arrives as
   * `CastSpellRequest.object`, required by a spell that carries this kind and
   * refused for one that does not, and the catalogue half — the item exists,
   * the target is attuned to it — is checked in `resolveSpell`'s pre-flight
   * before a slot is spent, exactly as the weapon a rider imbues is.
   *
   * **Nothing else moves.** SRD says the object may then "be removed or
   * discarded", which is somebody's later decision and two commands that
   * already exist; a spell that took the cloak off its owner would be
   * performing the sentence rather than adjudicating it.
   */
  | { readonly kind: 'end-attunement' }
  /**
   * A creature type put over the target's own, for what magic believes.
   *
   * SRD Arcanist's Magic Aura, _Mask (Creature)_: "Choose a creature type
   * other than the target's actual type. **Spells and other magical effects
   * treat the target as if it were a creature of the chosen type.**"
   *
   * **It does not write the fact and that is the whole design.**
   * `CreatureState.creatureType` is what the creature *is*, is the one fact in
   * the engine whose re-declaration is refused outright, and nothing gives it
   * back. This is the nineteenth sourced grant instead — hung on the creature,
   * released by `releaseCasting`, by a dispel, by a broken Concentration and
   * by a `grants` deadline — so the goblin is a goblin again when the day is
   * up, without anybody having had to remember to undo anything.
   *
   * **The readers are the sentence's own**, and `typeMagicSees` in
   * `creature-type.ts` is where the line is drawn and argued: a spell's target
   * rule, an area's filter and an outcome that varies by type all read the
   * mask; a creature reading a creature — SRD Ghoul's claw excepting "a
   * non-Undead creature" — reads the fact.
   *
   * **The type printed here is a default the casting replaces.**
   * `SpellDefinition.choiceStated` with `of: 'creature-type'` is how the
   * caster answers "choose a creature type", and `statedChoice` substitutes it
   * here exactly as it does into a `summon`. The definition still carries a
   * value so the shape is well formed and a reader of it alone sees a whole
   * spell.
   */
  | {
      readonly kind: 'creature-type-override';
      /** One of the SRD's fourteen; what the casting states replaces it. */
      readonly creatureType: string;
    }
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
      /**
       * The creature types the Immunity holds **against**, where the spell
       * qualifies it — see `GrantedConditionImmunity.fromTypes`, which is
       * where the rule and its silence are argued.
       *
       * SRD Protection from Evil and Good: "The target also can't be possessed
       * by or gain the Charmed or Frightened conditions **from them**", where
       * *them* is the six types the spell's first sentence names. Absent is
       * the unqualified sentence, which is SRD Heroes' Feast and SRD Mind
       * Blank and most of the book.
       */
      readonly fromTypes?: readonly string[];
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
   * The casting takes a **fall's** cost away from its target entirely — SRD
   * *Feather Fall*: "If a creature lands before the spell ends, the creature
   * takes no damage from the fall, and the spell ends for that creature."
   *
   * **No number, and that is the whole shape.** The Monk's Slow Fall prints
   * one — five times the Monk level — and is a feature's standing grant read
   * off the sheet; this sentence prints an outcome instead, so a magnitude
   * here would be `damage-reduction` written twice and would have had to name
   * Bludgeoning to be subtracted from anything, warding its holder against a
   * club along the way.
   *
   * Read by `resolveFall`, which throws no dice where a ward is held — "no
   * damage" is not a roll that came to nothing — and leaves the lander
   * standing, because SRD makes the Prone conditional on having paid. The
   * second half of the sentence is performed there too: the casting ends on
   * the creature that lands and runs on for the other four.
   */
  | { readonly kind: 'fall-ward' }
  /**
   * The casting buys its target a jump, and fixes what it costs — SRD *Jump*:
   * "Once on each of its turns until the spell ends, that creature can jump up
   * to 30 feet by spending 10 feet of movement."
   *
   * **Two numbers, because the sentence prints two and they are not the same
   * kind of thing.** {@link feet} is a bound on the jump, read where the
   * sheet's own Long Jump is read; {@link costsMovement} is the price, read
   * where a move is charged. A spell that only lengthened the jump would leave
   * a thirty-foot leap costing thirty feet of a creature's Speed, which is not
   * what this spell is worth.
   *
   * **Not a multiplier.** The 2014 wording tripled a jump distance and this
   * one does not: the book prints a flat thirty feet and a flat ten, so a
   * Strength 20 Barbarian's jump is bounded by the spell exactly as a Strength
   * 8 Wizard's is — and the spell is worth having to the second one.
   *
   * **The distance bounds a Long Jump.** SRD's "Jump" glossary names two
   * jumps, one measured along the ground and one measured upward, and this
   * sentence's thirty feet is a distance: a High Jump's own number is a
   * height, and reading one as the other would hand a level 1 spell thirty
   * feet of altitude. The spell says nothing about a High Jump and this
   * reading says nothing either.
   */
  | { readonly kind: 'jump-allowance'; readonly feet: number; readonly costsMovement: number }
  /**
   * A later action that moves a creature this casting is holding off the
   * ground, up or down, by a stated number of feet.
   *
   * SRD *Levitate*: "You can change the target's altitude by up to 20 feet in
   * either direction on your turn. … you can take a Magic action to move the
   * target, which must remain within the spell's range."
   *
   * **The one effect kind that is only ever an activation's**, and the
   * validator says so: it reads the feet off the *request* rather than off the
   * definition, so a casting's own effect list has no such request to read and
   * an area trigger firing a minute later has none either. What the definition
   * prints is the cap; the direction and the distance are the caster's, stated
   * now, and every other kind that takes a fact from the request takes it at
   * the casting.
   *
   * **Not `movement`, the rider.** A `ForcedMovement` of kind `lift` hangs off
   * a settled outcome, is performed once and is never declined; this is an
   * action a caster spends, at a distance they choose, on a creature the
   * casting is already holding — and it is refused rather than reported when
   * the room, the cap or the Range will not have it, because a refusal here
   * costs nothing and the action has not been spent.
   *
   * **Lowering to the ground is not the spell ending.** The lift stays granted
   * and the casting goes on running, so a later turn may take the creature
   * back up — which is the whole reason this moves a position rather than
   * releasing a grant.
   */
  | { readonly kind: 'change-altitude'; readonly upTo: number }
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
       * The rider rides the **Unarmed Strike** rather than a weapon.
       *
       * SRD Alter Self's Natural Weapons: "When you use your Unarmed Strike to
       * deal damage with that new growth, it deals 1d6 damage … and you use
       * your spellcasting ability modifier for the attack and damage rolls
       * rather than using Strength." A rider is keyed to one weapon's id and a
       * fist has none, so this says the casting names no weapon — the request
       * is refused one — and `weaponRidersFor` answers for a swing with no
       * weapon in it. Refused beside {@link weapons}, which names objects.
       */
      readonly unarmed?: true;
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
       * SRD Shillelagh: "The spell ends early if you cast it again or if you
       * let go of the weapon." The rider carries the clause and the fold's
       * `settleWeaponRiders` ends the casting when the weapon leaves the
       * holder's inventory; SRD Magic Weapon prints no such sentence and
       * leaves this off, so it is declared rather than assumed.
       */
      readonly endsWhenLetGo?: true;
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
       * The ability {@link castingAbility} names is **imposed** rather than
       * offered.
       *
       * SRD Alter Self: "you use your spellcasting ability modifier for the
       * attack and damage rolls **rather than** using Strength" — where SRD
       * Shillelagh says "you **can** use". The difference is whether the
       * attacker may decline, which `AttackOptions.imposedAbility` already
       * draws for SRD True Strike; this puts a casting's rider on that side of
       * it. Presupposes {@link castingAbility}.
       */
      readonly imposesAbility?: true;
      /**
       * A damage type the rider **imposes** on the blow, in place of its own.
       *
       * SRD Alter Self: "it deals 1d6 damage of the type in parentheses
       * instead of dealing the normal damage for your Unarmed Strike" — the
       * growth's type, chosen at the casting through `damageTypeStated` and
       * substituted here, so a claw is Slashing on every swing. Refused beside
       * {@link damageTypes}, which is the offer answered at the swing; one
       * rider says one of the two.
       */
      readonly damageType?: string;
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
   * The target leaves the scene for a named kind of nowhere, and comes back to
   * a space checked against the rule written here.
   *
   * SRD Blink: "Roll 1d6 at the end of each of your turns. On a roll of 4–6,
   * you vanish from your current plane of existence and appear in the Ethereal
   * Plane … At the start of your next turn and when the spell ends if you are
   * on the Ethereal Plane, you return to an unoccupied space of your choice
   * that you can see within 10 feet of the space you vanished from." SRD Rope
   * Trick: "Up to eight Medium or smaller creatures can climb into the
   * extradimensional space … Anything inside the space drops out when the
   * spell ends."
   *
   * **Three sentences, one kind, and the fields say which is which.** With
   * neither `at` nor `entry`, the target is sent the moment the effect
   * resolves. With `at`, nothing happens at the cast: the **boundary** reads
   * the casting at that moment of the target's turn, throws `chance`'s die
   * where one is printed, and sends the target on the printed faces — which is
   * Blink, and why the die is here rather than a `chance` effect: that kind
   * throws a d100 once for the casting, and this is a d6 thrown at every turn
   * boundary whose two halves put the caster in two places. With `entry`, the
   * casting opens a place creatures enter **by their own command**
   * (`enterElsewhere`), within reach of the casting's origin, up to a count and
   * a size — which is Rope Trick.
   *
   * **The way back is pinned into the record when the creature leaves**, so
   * the return opens no book: `returns` is copied onto `creature-sent-elsewhere`
   * and read from there. A casting that ends while somebody is away leaves them
   * stranded, which `resolveTurn` refuses and `returnFromElsewhere` settles —
   * the same debt a summons whose casting has ended is.
   *
   * Refused on an Instantaneous casting, because the ending is the casting's:
   * see `grantCarried`.
   */
  | {
      readonly kind: 'elsewhere';
      readonly where: 'ethereal' | 'extradimensional';
      /**
       * The moment of the **target's** turn the boundary reads this at, where
       * the sentence names one. Absent, the sending is the resolution's.
       */
      readonly at?: TurnMoment;
      /**
       * The die the boundary throws, and the faces that send the target.
       *
       * SRD Blink's "Roll 1d6 … On a roll of 4–6": the notation the book
       * prints and the lowest face that vanishes. Only beside `at`, because a
       * die thrown at the cast about whether the cast worked is `chance`.
       */
      readonly chance?: { readonly die: string; readonly onOrAbove: number };
      /**
       * A place creatures enter by their own command, rather than a sending.
       *
       * SRD Rope Trick: within `within` feet of the casting's origin (the
       * rope), up to `holds` of them, each no larger than `maxSize`.
       */
      readonly entry?: {
        readonly within: number;
        readonly holds: number;
        readonly maxSize: CreatureSize;
      };
      /** The rule the way back is checked against — see `ElsewhereReturn`. */
      readonly returns: {
        readonly within: number;
        readonly requiresSight?: true;
        /** The moment of the target's turn the boundary performs the return at. */
        readonly at?: TurnMoment;
      };
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
       *
       * Optional since {@link inline}: a summons names a block one way or the
       * other, and `checkSpellDefinition` refuses both and neither.
       */
      readonly monster?: SummonedForm;
      /**
       * A stat block the spell prints **inside itself**, in a sentence rather
       * than in a chapter — see {@link InlineStatBlock}. SRD Unseen Servant is
       * the one spell in the book that does.
       */
      readonly inline?: InlineStatBlock;
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
 * A stat block the spell prints in a sentence, for a creature that is in
 * neither chapter of the book.
 *
 * SRD Unseen Servant: "an Invisible, mindless, shapeless, Medium force … It
 * has AC 10, 1 Hit Point, and a Strength of 2, and it can't attack." The
 * owner's ruling of 2026-09-21 files a spell-internal block as a catalogue
 * entry, and the two the book prints as *blocks* — Find Steed's, Phantom
 * Steed's — are in the bestiary. This is the third case and the ruling's
 * limit: three numbers in one sentence, with no ability table, no Speed, no
 * senses and no type, which a bestiary entry could not transcribe without
 * inventing the rest. So the definition prints exactly what the book prints
 * and the resolver adapts it through the same road a block takes, so the
 * servant is a creature to every rule that asks — an Armour Class to hit, a
 * Hit Point to lose, a Strength to save with.
 *
 * **What is absent is absent.** An ability the sentence does not print is 10
 * (the modifier a rule reads is then 0, which is what a "mindless" force
 * ought to add to an Intelligence save); a Speed the sentence does not print
 * is 0 — the servant moves when commanded, through the DM's move command, and
 * the spell prints the allowance in the command rather than on the creature;
 * a creature type the sentence does not print is **none**, pinned as the
 * absence it is rather than as a guess, so a type-gated spell asks rather
 * than assumes. `conditions` are the ones the sentence gives the creature
 * itself — Unseen Servant's "Invisible" — applied at the arrival under the
 * casting's own source, so what ends the casting ends them.
 */
export interface InlineStatBlock {
  readonly name: string;
  readonly armorClass: number;
  readonly hitPoints: number;
  /** The scores the sentence prints; an ability it does not print is 10. */
  readonly abilities: Partial<Record<Ability, number>>;
  readonly size: CreatureSize;
  /** The creature type, where the sentence prints one. Absent is no type. */
  readonly type?: string;
  /** A walking Speed, where the sentence prints one. Absent is 0. */
  readonly walkingSpeed?: number;
  /** Conditions the sentence gives the creature itself, for as long as it stands. */
  readonly conditions?: readonly ConditionName[];
}

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
  /**
   * SRD Find Familiar: "As a Magic action, you can temporarily dismiss the
   * familiar to a pocket dimension. … As a Magic action while it is
   * temporarily dismissed, you can cause it to reappear in an unoccupied space
   * within 30 feet of you."
   *
   * Two doors on the bond — `dismissKeptSummons` and `recallKeptSummons` in
   * `commands/elsewhere.ts` — and this is the one number they read: how far
   * from the summoner the creature may reappear. Pinned onto the bond at the
   * arrival, so the recall opens no book. Absent for a kept creature the spell
   * offers no pocket to, which is SRD Find Steed's steed.
   */
  readonly pocket?: { readonly within: number };
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
  | {
      readonly kind: 'emanation';
      readonly distance: number;
      readonly origin: 'self';
      /**
       * SRD: a point of origin "isn't included in the area of effect **unless
       * its creator decides otherwise**", and two spells decide otherwise in
       * their own first sentence.
       *
       * SRD Pass without Trace: "You radiate a concealing aura in a 30-foot
       * Emanation … While in the aura, **you** and each creature you choose
       * have a +10 bonus." SRD Spirit Guardians writes the other half — "any
       * **other** creature's Speed is halved" — which is the default and says
       * so by omission.
       *
       * So it is the definition that decides, transcribed off the printed
       * sentence, rather than a rule the engine applies to emanations in
       * general. Absent is the glossary's own reading and is what every
       * definition written before this field says.
       */
      readonly includesOrigin?: true;
      /**
       * SRD Tiny Hut: "A 10-foot Emanation springs into existence around you
       * and **remains stationary** for the duration." SRD Speak with Plants:
       * "an **immobile** 30-foot Emanation".
       *
       * An Emanation is measured from a creature and moves with them — SRD
       * Spirit Guardians follows the cleric — and these are the two in the
       * book that do not. The casting pins the caster's square at the cast
       * as the record's point (`area.at`), and `originOfArea` measures from
       * it ever after, so the dome stays where it rose when the wizard steps
       * out of it — which is exactly the step that ends the spell — and the
       * ground a druid cleared stays cleared when the druid walks off. A
       * caster nobody has placed has no square to pin and is asked. Absent
       * is the glossary's reading and every other Emanation.
       */
      readonly stays?: true;
    }
  /**
   * SRD Wind Wall: "You can make the wall up to 50 feet long, 15 feet high,
   * and 1 foot thick. You can shape the wall in any way you choose so long as
   * it makes one continuous path along the ground."
   *
   * **The definition states the bounds and the caster draws the wall**, which
   * is the split every other member of this union does not need: a Sphere's
   * radius is the whole of its shape, and fifty feet of wall bent around a
   * corner is a decision somebody took space by space. So `length` is a
   * maximum rather than a size, checked against the stated path at the cast.
   *
   * **A wall answers at the cast and nothing later.** The path is the one
   * thing about a template that cannot be reconstructed from the book and a
   * point, and the ongoing record does not store it — so a definition may not
   * hang an `areaTrigger`, an `areaStanding`, terrain, light or obscurement on
   * a wall, and `checkSpellDefinition` refuses all five rather than letting
   * them read a shape that answers null. SRD Wind Wall asks once, when the
   * wall appears, which is exactly what this reaches.
   *
   * The thickness is not here for the reason it is not on `AreaShape`: the
   * lattice holds nothing narrower than a space.
   */
  | {
      readonly kind: 'wall';
      /** SRD's "up to 50 feet long": a maximum the stated path is held to. */
      readonly length: number;
      /** SRD's "15 feet high", measured up from the ground the path runs along. */
      readonly height: number;
      readonly origin: 'point';
    };

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
   * sentence the SRD does not print — with one exception, which is
   * {@link clears} and not a smaller number here. One of the two, never both.
   */
  readonly costPerFoot?: number;
  /**
   * SRD Speak with Plants: "turn Difficult Terrain caused by plant growth
   * (such as thickets and undergrowth) into ordinary terrain that lasts for
   * the duration."
   *
   * **The one sentence in the book that takes Difficult Terrain away**, and it
   * is not a rate: the lattice takes the dearest rate lying over a space, by
   * the book's own rule that Difficult Terrain is not cumulative, and a
   * cheaper patch would simply lose. So this is a patch that **overrides** —
   * `chargeAt` answers open floor for a space a clearing patch covers, whatever
   * else lies there, the Mouther's carried ground and a declared thicket alike
   * — and lapses with its casting as every patch does. That "caused by plant
   * growth" is what the cleared ground was is the table's, as which ground is
   * thicket always has been.
   */
  readonly clears?: true;
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
   * SRD Flaming Sphere: "If you move the sphere **into a creature's space**,
   * that creature makes the save against the sphere."
   *
   * {@link onAreaEntry}'s narrow twin and not a spelling of it. That clause is
   * about an *area* sweeping over somebody — Moonbeam's Cylinder is five feet
   * of radius and catches whoever it covers — and this one is about the
   * casting's **point** arriving in an occupied space, which is a different
   * set of creatures the moment the trigger reaches further than the point
   * does: a sphere rolled past a goblin ends up beside it, and the book says
   * the goblin saves only when the sphere is rolled *into* it.
   *
   * So the two are refused together. One spell prints one of these sentences,
   * and a definition carrying both would be asking two questions of one move
   * with no SRD sentence behind either answer.
   *
   * **The route matters here for {@link onAreaEntry}'s reason**, and
   * `relocateOrigin` asks for it under the same rule: a thirty-foot roll
   * crosses five spaces, and a creature standing in one of them was rolled
   * into whatever the endpoint says.
   */
  readonly onPointEntry?: true;
  /**
   * How far from the casting's **point** this trigger reaches, in feet.
   *
   * SRD Flaming Sphere: "Any creature that **ends its turn within 5 feet of
   * the sphere**." The clause is measured from a point the casting holds
   * rather than over the template the casting laid, and the two are genuinely
   * different questions for this spell: the sphere is one space of fire that
   * lights a room twenty feet across, so {@link SpellDefinition.area} is the
   * lit region — Dancing Lights' reading, where an area is what the light
   * fills — and the burning reaches five feet.
   *
   * Absent is every other persistent area in the book and means what it has
   * always meant: the clauses fire over the area itself. A radius here does
   * **not** shrink the area; it answers a different question about the same
   * point, and the light, the terrain and the standing effect all go on
   * reading the template.
   *
   * Only on a point-origin area, because a point is what it measures from: a
   * carried area's origin is a creature with a volume, and "within 5 feet of
   * the Emanation" is a sentence the SRD does not print.
   */
  readonly within?: number;
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
   * SRD *Animal Messenger*: "A **Tiny** Beast of your choice that you can see
   * within range."
   *
   * The first of the three facts `a-target-rule-the-format-cannot-state`
   * names — a size, a Challenge Rating and an ability score — and the only one
   * of them the engine holds. It is read through `effectiveSizeOf`, so the
   * answer is the one every other size rule gets: the size an active feature
   * prints, then the size somebody stated, then the map's.
   *
   * **It reads like {@link mustBeUnarmored} rather than like
   * {@link mustBeType}**, and the difference is what kind of silence each
   * fact can keep. A creature type is a thin record — nobody may ever have
   * said — so the cast comes back asking; a size is put on a creature by its
   * stat block, by its species and by the mere act of placing it on the map,
   * and the only creature with none is one standing nowhere that nothing has
   * described. That is a plain no with a reason naming what would settle it,
   * not a question, because inviting a caller to declare a size in order to
   * widen a spell is the door `mustBeFalling` already keeps shut.
   *
   * Checked where a caller **names** targets and where an area filters its
   * catch, which are the two places {@link mustBeType} is checked and for the
   * same reasons: a named target the spell cannot reach is a refusal, and a
   * creature an area simply does not catch is filtered.
   */
  readonly mustBeSize?: CreatureSize;
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
   * SRD *Spare the Dying*: "Choose a creature within range that **has 0 Hit
   * Points and isn't dead**."
   *
   * The fourth clause of this kind and the first that reads **vitals**, which
   * is the reading `a-target-rule-the-format-cannot-state` lost on its way
   * through the three facts it does name: this is neither a type, nor armour,
   * nor a size, nor a moment — it is the state a creature is in while it is on
   * the floor, and the engine holds it authoritatively in two fields.
   *
   * **Both halves, because the sentence has two and each alone is wrong.** A
   * creature above 0 Hit Points is not dying; a corpse is past being saved and
   * is Raise Dead's business, which is the rule `stabiliseCreature` and
   * `healCreature` both already state. {@link mustBeDead} is the twin with the
   * opposite reading.
   *
   * Like `mustBeUnarmored` and unlike `mustBeType`, a plain **no** rather than
   * a question: hit points and death are the engine's own to read, and there
   * is no declaration a caller could invent to widen the spell.
   */
  readonly mustBeDying?: true;
  /**
   * SRD *Gentle Repose*: "You touch a **corpse** or other remains."
   *
   * {@link mustBeDying}'s twin, and the one target clause that admits a
   * creature every other spell's targeting would walk past: `eligibleTargets`
   * drops the dead from every shortlist, because all but a handful of spells
   * are cast on somebody who can be affected by them. A spell whose whole
   * subject is a body says so here, and the shortlist then offers the bodies
   * and nobody else.
   *
   * "Or other remains" is the table's: the engine holds a dead creature and
   * holds no severed hand.
   *
   * A plain no rather than a question, for {@link mustBeDying}'s reason.
   */
  readonly mustBeDead?: true;
  /**
   * SRD *Mage Armor*: "You touch a **willing** creature who isn't wearing
   * armor." A good many definitions in reach print the word; `willing.test.ts`
   * reads the population out of the book rather than out of a sentence here.
   *
   * **A fact nobody but the table holds, so it is asked for rather than
   * assumed.** A target the casting has not named in `CastSpellRequest.willing`
   * comes back `needs-context` — never refused, and never waved through. The
   * engine holds no rule that an ally consents: `side` is a different question
   * (a Charmed ally is still on the party's side, and an enemy nobody has come
   * to blows with is not), and "of course the cleric's friend agreed" is a
   * table's assumption rather than a sentence in the book. Deriving it would
   * be the engine answering, the same way every time, a question the SRD put
   * to somebody else.
   *
   * **The caster is willing by being the caster**, which is the one consent
   * nothing has to state: a creature that chose to cast a spell on itself has
   * said so by casting it, and SRD writes "a willing creature you touch" of
   * spells whose own note says the caster may be the target.
   *
   * **A gate, not a die.** {@link SpellEffect} `save.unlessWilling` is the
   * other half of the book's vocabulary for the same fiction — Levitate hands
   * the objector a saving throw instead of refusing the casting — and the two
   * are read at different moments for that reason: this one before a slot is
   * spent, that one at the roll.
   *
   * Checked only where a caller **names** targets, for
   * {@link mustBeUnarmored}'s reason: an area filters rather than refuses, and
   * no spell prints this clause over an area's catch.
   */
  readonly willing?: true;
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

/**
 * One branch of a spell that prints several, of which a casting runs exactly
 * one — see {@link SpellDefinition.options}.
 *
 * Each of the three fields answers "what does this branch do", and a branch
 * that answers with none of them is refused (`option_says_nothing`): the whole
 * point of naming a branch is that a reader of the definition can see what
 * speaking that word gets you.
 */
export interface SpellOption {
  /** The book's own name for the branch: "Halt", "Booming Voice", "Enlarge". */
  readonly label: string;
  /**
   * The effects this branch runs, after the spell's own list.
   *
   * **A whole list rather than a patch on the common one.** SRD Command's five
   * words are five different consequences of one Wisdom saving throw, and the
   * saving throw is the thing that *gates* them — so the branch carries the
   * save with its own riders hung on it, which is what makes the gate real. A
   * common save with the consequences appended after it would run them whether
   * the target resisted or not, which is the confident wrong answer rather
   * than the missing one.
   *
   * **What a branch may not carry is what the casting settles before it runs.**
   * `resolveSpell` sizes the target list off the aimed rolls in
   * `SpellDefinition.effects`, measures a swing's reach off the same list, and
   * requires a stated weapon, object, destination or form off it too — all
   * before any effect resolves. A branch is read at resolution, so an effect
   * of one of those kinds here would be a roll nobody made room for; see
   * `PRESETTLED_EFFECT_KINDS` in `spell-schema.ts`, which refuses it at
   * authoring rather than dropping it at the table.
   */
  readonly effects?: readonly SpellEffect[];
  /**
   * What the area does to whoever stands in it **when this branch is the one
   * cast** — see {@link SpellDefinition.areaStanding}, which is the same field
   * one level up.
   *
   * SRD Magic Circle: "Each time you cast this spell, you can cause its magic
   * to operate in the reverse direction, preventing a creature of the
   * specified type from leaving the Cylinder and protecting targets outside
   * it." The two directions are two lists of the same three clauses turned
   * round, so each is a branch's and the common list holds nothing. Pinned on
   * the record beside the common list's clauses by `areaStandingFor`, which is
   * the one reader — an activation and a boundary read the record and never
   * ask which branch was spoken.
   */
  readonly areaStanding?: readonly AreaStanding[];
  /**
   * What this branch does to the ground under the spell's area, in place of
   * {@link SpellDefinition.areaTerrain}.
   *
   * SRD Speak with Plants prints two directions over one Emanation — "turn
   * Difficult Terrain … into ordinary terrain … Or … turn ordinary terrain …
   * into Difficult Terrain" — and which is the caster's word, so it is a
   * branch's field rather than the definition's. Read where the patch is
   * pinned, off the branch the casting ran; presupposes an `area` exactly as
   * the definition's field does.
   */
  readonly areaTerrain?: AreaTerrain;
  /**
   * Printed text this branch hands to whoever is running the table — see
   * {@link SpellDefinition.dmDecides}, which is the same field one level up
   * and travels the same way.
   *
   * SRD Command's _Approach_ and _Flee_ are the writers: "moves toward you by
   * the shortest and most direct route", "spends its turn moving away from you
   * by the fastest available means". Both are a whole turn played by somebody,
   * along a route nobody chose, which is the ruling Fear's compelled Dash
   * already took — the engine adjudicates legality and walks nobody anywhere.
   */
  readonly handsOver?: readonly string[];
  /**
   * Parts of this branch the engine does not execute — see
   * {@link SpellDefinition.unmodelled}, which is the same field one level up.
   *
   * A debt rather than a handover, and the distinction is the one that field
   * already draws: Enlarge/Reduce's size change is a shape somebody will build
   * and this line will then go, where Approach's route is a question no engine
   * answers.
   */
  readonly unmodelled?: readonly string[];
}

/**
 * One thing a casting leaves on a target at the moment it ends.
 *
 * SRD Haste prints the only sentence of this shape in the book — "the target
 * is Incapacitated and has a Speed of 0 until the end of its next turn" — and
 * the vocabulary is that sentence and no more: a list of conditions, a Speed
 * taken away, and a span they both run for.
 *
 * **Three narrow fields rather than the rider vocabulary.** {@link
 * ModifierRider} is applied by a command, with a caster, a save DC and a
 * casting to hang things on; this is performed by the **fold**, at a moment
 * nobody commanded, on a creature whose casting has just stopped existing. So
 * it is the smallest thing that carries the printed sentence, and a second
 * sentence of this shape is what would widen it.
 *
 * `speed` names the whole operation and carries no feet, for the reason
 * {@link SpeedChange}'s `zero` does.
 */
export interface CastingEndRider {
  /** The conditions the ending imposes — SRD Haste's Incapacitated. */
  readonly conditions?: readonly ConditionName[];
  /**
   * A Speed the ending takes away — SRD Haste's "has a Speed of 0".
   *
   * One member, because the book prints one: an ending that *gave* Speed would
   * be a reward for a spell running out, and nothing writes it.
   */
  readonly speed?: 'zero';
  /**
   * How long both last.
   *
   * One member, and it is the span SRD Haste prints: "until the end of its
   * next turn", measured on the **target's** own turn, which is whose turn the
   * sentence is about. A span in seconds would be a second vocabulary for a
   * moment `endOfNextTurn` already names, and an indefinite ending would be a
   * spell that punished its target for ever.
   *
   * **Where there is no turn order there is no such moment**, and the fold has
   * nobody to ask: a casting that ends outside combat lays nothing, because
   * calling that moment six seconds is the one mistake the two-type split
   * exists to prevent. Said here because the omission would otherwise be
   * invisible.
   */
  readonly lasts: 'end-of-next-turn';
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
  /**
   * How far the spell reaches at this **character level**, by band.
   *
   * > SRD Spare the Dying, _Cantrip Upgrade._: "The range doubles when you
   * > reach levels 5 (30 feet), 11 (60 feet), and 17 (120 feet)."
   *
   * The key is the lowest character level of the band and the value is the
   * whole reach in feet — not an increase — so `{ 5: 30, 11: 60, 17: 120 }` is
   * the sentence transcribed, and {@link range} is what a caster below every
   * band still gets. {@link rangeFeetAt} is the one reader, so the cast and
   * the shortlist a caller is shown cannot disagree about how far the spell
   * goes.
   *
   * **The caster's level, not the slot**, which is the fork
   * `docs/design/spell-definitions.md` keeps open on purpose: "Cantrips scale
   * by caster level and levelled spells by slot, and they are separate fields
   * rather than one overloaded number." Both the other two axes of that fork —
   * `DiceScaling.cantripUpgradesAt` and `AttackRollCount.cantripUpgradesAt` —
   * reach dice, and this is the one clause in the book that reaches *reach*.
   * A levelled spell is refused it, exactly as they refuse one.
   *
   * **A table rather than a doubling**, though the SRD's own word is "doubles"
   * and the printed numbers happen to double: what the engine must obey is the
   * three numbers in the parentheses, and a spell whose next printing rounds
   * one of them would be silently wrong under an arithmetic rule. This is
   * `durationAtSlot`'s argument at the other axis, and it is the same one.
   *
   * Refused on a Range that is not a distance: Touch, Self and a Range the DM
   * decides have no number for a band to replace.
   */
  readonly rangeAtLevel?: Readonly<Record<number, number>>;
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
   *
   * **A list, because SRD Silence writes three of these sentences about one
   * Sphere**: an Immunity, a condition and a casting the Sphere forbids. Each
   * member is read by the reader that understands it and by nobody else.
   */
  readonly areaStanding?: readonly AreaStanding[];
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
   * An effect list a **DM's decision** fires, once, over the spell's area.
   *
   * SRD Glyph of Warding: "You decide what triggers the glyph when you cast
   * the spell … When triggered, the glyph erupts with magical energy in a
   * 20-foot-radius Sphere centered on the glyph. Each creature in the area
   * makes a Dexterity saving throw … Once a glyph is triggered, this spell
   * ends." The trigger is fiction the caster invented — a footfall, a book
   * opened — and the engine holds nothing it could read it from, so whether it
   * occurred is a decision the rules leave open: `triggerGlyph`, on the DM's
   * door alone. Everything after the decision is the engine's.
   *
   * **Not an {@link AreaTrigger}**, whose clauses fire on moments the engine
   * sees — a turn boundary, an entry. And **not a {@link SpellActivation}**,
   * which the caster takes on a later turn and pays an action for; a glyph
   * fires for a caster who may be a mile away, and nobody spends anything.
   *
   * Pinned onto the record at the casting with the stated damage type
   * substituted, exactly as `areaTrigger` is, so the door opens no catalogue.
   * Presupposes an `area` to erupt over and a record to be fired from, and
   * the casting ends when it fires — "Once a glyph is triggered, this spell
   * ends" is the one sentence of that shape, and it is the rule rather than a
   * field.
   */
  readonly triggered?: TriggeredEffects;
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
   * SRD Pass without Trace: "you and **each creature you choose**".
   *
   * {@link designatesUnaffected} with the polarity turned over: that one names
   * the creatures an area lets alone and this one names the only creatures it
   * reaches. Two fields rather than one with a sign, because a definition that
   * meant the wrong one by the same list would invert a rule in silence, and
   * because nothing in the SRD prints both about one area.
   *
   * The caster is always on the list, added where the fact is normalised, so a
   * reader has the whole answer in one place.
   *
   * Absent means the spell offers no such choice and naming anybody is
   * refused, rather than quietly ignored — the reading its sibling takes.
   */
  readonly designatesChosen?: true;
  /**
   * This spell prints **no Verbal component**.
   *
   * SRD Silence: "Casting a spell that includes a Verbal component is
   * impossible there", which is the one rule in the book that asks the
   * question — so this is the whole of what the engine models of a spell's
   * components, and it is deliberately not the three-way list the parsed
   * catalogue carries. A field nothing reads is the failure the validator
   * exists to prevent.
   *
   * **Absent means the spell has one, which is the book's own default and not
   * a guess.** All but a handful of the SRD's spells print a Verbal component;
   * a positive marker would have left Silence inert for every definition
   * nobody had thought to annotate, which is a rule quietly switched off. So
   * the exception is what is written down, on the entries that are the
   * exception, and a definition that says nothing says what the book says
   * about almost everything.
   *
   * **The polarity is the reason it is guarded rather than trusted.** Either
   * marker set the wrong way is silent — one refuses a casting the book
   * allows, the other allows one the book refuses — so `@ie/content` checks
   * every definition's answer against the components `@ie/srd` parsed, in both
   * directions. See `spell-catalogue.test.ts`.
   *
   * **A spell cast from an item carries the spell's answer**, which is a
   * reading rather than an omission: SRD says an item's casting spends no slot
   * and says nothing about dropping the words, so a wand's Fireball still
   * includes a Verbal component and a Silence still stops it. An item that
   * means otherwise would say so, and there is no field for it because no SRD
   * item does.
   */
  readonly noVerbalComponent?: true;
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
   * that is already in the list. That is the second arm of this shape, and it
   * is {@link SpellDefinition.options} — built after this docstring had named
   * it absent for long enough that three spells were waiting on it. The two
   * fields are neighbours rather than alternatives: a definition may print
   * both, and one casting may state a branch *and* a value inside it.
   *
   * **Which branch was named decides whether the choice is asked for.** SRD
   * Bestow Curse prints "Choose one ability" inside the first of its four
   * bullets and asks nothing of the other three, so `declaredFacts` runs
   * {@link statedChoiceReaches} over the list *this* casting will run and
   * demands a value only where one would land. The validator asks the wider
   * question — does it land anywhere a casting could put it — which is the
   * pairing to know about before writing a definition whose choice reaches
   * one branch and whose route also *fixes* the value: `fixesChoice` is
   * answered on every branch and this asks for it on one, so the branches
   * that hold no slot would refuse the fixed value with `no_choice_clause`.
   * No content meets both halves today, and the day one does it is this
   * sentence that says where to look.
   */
  readonly choiceStated?: StatedChoice;
  /**
   * A choice of **one or more** creature types the caster states at the
   * casting.
   *
   * > SRD Magic Circle: "Choose one or more of the following types of
   * > creatures: Celestials, Elementals, Fey, Fiends, or Undead."
   *
   * Beside {@link choiceStated} rather than a widening of it, because that one
   * takes one value and substitutes it into one field of one effect, and this
   * takes a list and substitutes it into every clause of the area that says
   * `'stated'` — the barrier's `to`, the attack mode's `attackerType`, the
   * Immunity's `fromTypes`. One field widened to carry both would have made
   * every reader of the single value ask whether it held a list.
   *
   * **The casting names them, the engine names none.** `CastSpellRequest.types`
   * is the stated fact: required where the spell prints the clause
   * (`types_required`), refused where it prints none (`no_types_clause`),
   * refused off the list (`type_not_offered`), and never defaulted. Pinned onto
   * the record substituted, so the fold reads a list and never the word.
   */
  readonly typesStated?: { readonly options: readonly string[] };
  /**
   * The branches this spell prints, of which a casting runs exactly one.
   *
   * > SRD Command: "Choose the command from these options: _Approach. Drop.
   * > Flee. Grovel. Halt._"
   * > SRD Thaumaturgy: "You create one of the effects below within range."
   * > SRD Enlarge/Reduce: "the spell enlarges or reduces a creature or an
   * > object you can see within range (**see the chosen effect below**)."
   *
   * The second arm of `a-choice-made-at-the-casting`, and a different
   * mechanism from {@link choiceStated} rather than a wider version of it:
   * that one rewrites a *field* on an effect the list already holds, and this
   * one decides *which list runs at all*. A substitution could never have
   * expressed either — a definition carrying Booming Voice's mode would boom
   * the caster's voice every time they flickered a candle.
   *
   * **The casting names one, the engine names none.** `CastSpellRequest.option`
   * is the tenth stated fact and follows the discipline the other nine do:
   * required where the spell prints branches (`option_required`), refused
   * where it prints none (`no_option_clause`), refused off the list
   * (`unknown_option`), and **never defaulted** — picking the first branch
   * because it is printed first is the engine answering a question the book
   * asked the caster, and it would answer the same way for ever.
   *
   * **The common list runs too, and it runs first.** A spell whose every
   * branch shares an opening — a template, a grant on the caster — writes it
   * once in {@link effects}, and the branch's own list runs after it. Where
   * the shared thing is a *saving throw whose failure gates the branch*, the
   * save belongs to the branch and not to the common list: an effect appended
   * after a save does not know how the save went, so SRD Command writes the
   * Wisdom save inside each word that has a consequence, with the consequence
   * as a rider on it.
   *
   * **Pinned onto the casting**, beside the stated choice and for its reason:
   * the record is read again on a later turn, and a casting already made does
   * not change when the book does. `OngoingSpell.option` is where it lands and
   * an activation reads it from there.
   *
   * At least two branches, which the validator enforces: one branch is a spell
   * with no choice in it, written the long way round.
   */
  readonly options?: Readonly<Record<string, SpellOption>>;
  /**
   * The branch is chosen **for each creature** rather than once for the
   * casting.
   *
   * SRD Calm Emotions: "must succeed on a Charisma saving throw or be affected
   * by one of the following effects (**choose for each creature**)". Every
   * other spell that prints branches chooses once — Command speaks one word,
   * Enlarge/Reduce does one half — so `CastSpellRequest.option` is a word and
   * `optionEffects` runs one list for everybody. This says the word is per
   * creature: the request carries `optionByTarget`, one name per creature the
   * casting catches, refused where a caught creature is unnamed or a named
   * creature is uncaught, and each creature runs the common list and then its
   * own branch. Presupposes {@link options}, and refused without it.
   *
   * **A declaration cannot carry it.** A held casting pins one word; a map
   * keyed by creatures the area has not yet caught is a fact the settlement
   * would have to ask again, so a casting of this shape is resolved in one
   * breath or refused — the limit `options` already keeps for a readied one.
   */
  readonly optionPerTarget?: true;
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
   * **Seven definitions write it** — Hunter's Mark, Hex, the three Dominates,
   * Mass Suggestion and Bestow Curse. Hex's was the sixth table this docstring
   * named as unwritten, and it is written now; Bestow Curse's is the seventh
   * and prints the other half of the sentence beside it, which is
   * {@link concentrationEndsAtSlot}.
   *
   * What it deliberately does *not* express is SRD Major Image's "lasts
   * **until dispelled**, without requiring Concentration, if cast with a level
   * 4+ spell slot" — a table of seconds cannot say "until dispelled", which is
   * an ending rather than a length. The Concentration half of that sentence is
   * the neighbouring field.
   */
  readonly durationAtSlot?: Readonly<Record<number, number>>;
  /**
   * The slot from which the spell **stops requiring Concentration**.
   *
   * > SRD Bestow Curse: "If you use a level 5+ spell slot, the spell doesn't
   * > require Concentration, and the duration becomes 8 hours (level 5–6 slot)
   * > or 24 hours (level 7–8 slot)."
   *
   * The other half of the sentence {@link durationAtSlot} writes, and a
   * separate field because it says something a table of seconds cannot: how
   * long the spell runs and whether the caster has to hold it are two facts,
   * and the SRD moves them independently — a level 4 Bestow Curse is ten
   * minutes *of Concentration*, and a level 5 one is eight hours of none.
   *
   * **A band at this level or above**, which is how the SRD writes every clause
   * of this shape and how the table beside it is read: one number rather than a
   * per-slot record, because no spell in the book turns Concentration back on
   * at a higher slot. {@link concentrationAt} is the one reader.
   *
   * **Refused on a definition that does not require Concentration in the first
   * place** (`concentration_drop_without_concentration`) and on a band at or
   * below the spell's own level, for the reason the duration table refuses one:
   * the SRD prints both under "Using a Higher-Level Spell Slot".
   */
  readonly concentrationEndsAtSlot?: number;
  /**
   * The slot from which the casting **stops having a deadline at all**.
   *
   * > SRD Major Image: "The spell lasts **until dispelled**, without requiring
   * > Concentration, if cast with a level 4+ spell slot."
   *
   * The third field of the sentence {@link durationAtSlot} and
   * {@link concentrationEndsAtSlot} share, and the one that docstring named as
   * the thing a table of seconds deliberately cannot say: those two move *how
   * long* and *who holds it*, and this moves **what kind of ending the casting
   * has**. A span and its absence are not two numbers, so there was nothing to
   * put in the table.
   *
   * **A band at this level or above**, read by {@link untilDispelledAt}, which
   * is the reading its two neighbours already take of their own keys — and the
   * same three refusals: a whole slot level, strictly above the spell's own,
   * and not on a definition that already runs {@link untilDispelled} (there is
   * no deadline for a higher slot to take away) or Instantaneous (there is no
   * casting for it to leave running).
   *
   * **Written beside `concentrationEndsAtSlot` rather than instead of it.**
   * One SRD sentence prints both halves at one slot, and they are still two
   * facts: Bestow Curse drops the Concentration at level 5 and keeps a
   * deadline, so a field that meant both would have made that spell wrong.
   */
  readonly untilDispelledAtSlot?: number;
  /**
   * The spell offers its caster, **at the casting**, an ending the book
   * otherwise gives them none of.
   *
   * > SRD Magic Mouth: "When you cast this spell, you can have the spell end
   * > after it delivers its message, or it can remain and repeat its message
   * > whenever the trigger occurs."
   *
   * The free dismissal `endOngoingSpell` performs is printed for a **Time
   * Span** duration, and this spell lasts until dispelled — so without the
   * caster's word at the casting there is no way out of it at all, which is
   * the refusal `not_dismissible` states. This is the offer; the answer is
   * `CastSpellRequest.endsAfterTrigger`, and it is pinned on the ongoing
   * record because a definition corrected next month must not decide whether
   * a casting made today can be let go.
   *
   * **The trigger itself is the table's.** The engine holds no mouth and no
   * message, so nothing here fires: what the fact buys is the *permission*,
   * and the DM ends the casting when the mouth has spoken.
   *
   * Refused on a definition that leaves no casting running, which is the
   * reachability rule every other field of this shape keeps.
   */
  readonly offersEndAfterTrigger?: true;
  /**
   * Somebody other than the caster may end the casting, and pays for it.
   *
   * > SRD Gaseous Form: "The spell ends on the target if it drops to 0 Hit
   * > Points **or if it takes a Magic action to end the spell on itself**."
   *
   * Both exceptions to the general dismissal in one clause: the **target**
   * ends it rather than the caster, and the book charges a Magic action where
   * a dismissal costs none. `endOngoingSpellOnSelf` is the door, and it ends
   * the casting **on that target** rather than everywhere — which is the half
   * a higher slot makes visible, exactly as the `target-drops-to-0` trigger
   * beside it in the same sentence does.
   *
   * **A bare `'target'` rather than a record with a price in it**, because
   * both SRD spells that print the clause print the same price: Animal Shapes
   * and Gaseous Form each charge a Magic action. A spell that charged
   * something else would be a second field rather than a second value, for
   * the reason `concentrationEndsAtSlot` is not folded into `durationAtSlot`.
   *
   * Refused on a definition that leaves no casting running, and on one that is
   * cast at nobody: a target's ending needs a target.
   */
  readonly dismissibleBy?: 'target';
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
   * A **second** moment this Reaction answers: being targeted by one named
   * spell.
   *
   * SRD *Shield* is the only spell in the book that prints two triggers in one
   * casting time — "when you are hit by an attack roll **or targeted by the
   * *Magic Missile* spell**" — which is why this is a field beside
   * {@link trigger} rather than a member of it: a definition that could say
   * only one of the two would have to give up the other, and the attack half
   * has been executed since Shield landed.
   *
   * **A spell id, held by content and compared by the engine.** The window it
   * opens is `targeted-by-spell`, and what the engine does with this is ask
   * whether the casting being declared has the same id — it names nothing
   * itself, which is the rule `spell-schema.test.ts` sweeps for.
   */
  readonly targetedBy?: string;
  /**
   * SRD *Shield*: "**Until the start of your next turn**, you have a +5 bonus
   * to AC … **and you take no damage from *Magic Missile***."
   *
   * The benefit that hangs on {@link targetedBy}: the spell the trigger named
   * is pinned onto the record this casting leaves running, and a casting of
   * that spell deals the reactor nothing for as long as the record stands.
   * Both halves of the SRD's sentence are inside the duration, so a second
   * caster's volley in the same round is turned aside too.
   *
   * **It is not `damage-defense` and could not be.** That vocabulary names a
   * damage *type* and rightly refuses to name a spell; what happens here is
   * that a *casting* pins the id it read from its own trigger, which is the
   * rule every other pinned fact on an ongoing record follows, and the engine
   * compares two ids without knowing either.
   *
   * Legal only beside `targetedBy`, because there is otherwise no spell for it
   * to be about; `spell-schema.ts` refuses the pair apart.
   */
  readonly negatesTriggeringCasting?: true;
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
   * SRD Prestidigitation: "If you cast this spell multiple times, you can have
   * up to **three** of its non-instantaneous effects active at a time."
   *
   * {@link replacesPriorCasting} with a number in it, and applied the same
   * way. That field is a cap of exactly one and ends the prior casting; this
   * one is a cap of *n* and ends the oldest running castings until the new one
   * is the last that fits. `state.ongoing` is where they are counted, so
   * obeying the sentence is a lookup rather than a search through the log, and
   * the count is per **caster** — one wizard's three tricks say nothing about
   * another's.
   *
   * **Ending the oldest rather than refusing the fourth**, because that is
   * what the sentence prints: a caster "can have up to three … active" is a
   * statement about what is running, not a rule that the fourth casting fails.
   * Refusing one would make the cantrip unusable rather than capped, and would
   * be a rule the book does not write.
   *
   * Refused beside `replacesPriorCasting`, which is the same rule with a
   * different number, and refused on a definition that leaves nothing running,
   * which would be a cap on a population that is always empty.
   */
  readonly maxRunning?: number;
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
  /**
   * What the casting leaves on its targets **when it ends** — however it ends.
   *
   * > SRD Haste: "When the spell ends, the target is Incapacitated and has a
   * > Speed of 0 until the end of its next turn, as a wave of lethargy washes
   * > over it."
   *
   * The field above says what *stops* the casting; this says what the stopping
   * costs, and the two are opposite ends of one lifetime. Nothing hung a
   * consequence on the moment a casting ran out before this —
   * `docs/design/time-and-turns.md`: "**Expiry is derived, like Concentration
   * breaking** ... The log records the effect being scheduled, not expiring."
   *
   * **Every ending, which is what "when the spell ends" says.** The deadline
   * arriving, the Concentration breaking, a dismissal and a dispel all
   * converge on `releaseCasting`, and a release aimed at one creature
   * (`releaseOnTarget`) fires it on that creature alone. A spell that punished
   * only one of those four would be a rule the book does not write.
   *
   * **Under the spell's bare name, so it outlives the casting that caused
   * it.** The lethargy is a *consequence* of the ending rather than something
   * the ending takes away — a condition filed under the casting would be
   * lifted by the very release that laid it — which is the reading
   * `outlivesCasting` already takes of SRD Grease's Prone.
   *
   * **Pinned onto the ongoing record at the cast**, like every other fact the
   * fold reads: `releaseCasting` runs inside the fold, which opens no
   * catalogue, so a log written against last year's book keeps last year's
   * lethargy.
   */
  readonly onEnd?: readonly CastingEndRider[];
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
 * **`target-attacks` is every attack roll**, read off `roll-recorded.attackRoll`
 * — the one structured fact that event carries, written by the weapon attack
 * and the spell attack and by nothing else — beside `attack-made` for the
 * logs written before the mark. An Opportunity Attack that misses, a swing
 * outside any fight, a readied attack and Spiritual Weapon's later swing all
 * name their roller there, which is what "makes an attack roll" asks.
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
   * SRD Tiny Hut: "The spell ends early **if you leave the Emanation** or if
   * you cast it again."
   *
   * The one cause in the list that is about the **caster** and about a place:
   * read off `creature-moved` — a walk or a teleport, which write the same
   * event — for the casting's own caster, and fired when the space they now
   * stand in is outside the area the casting pinned. Derived in the fold off
   * the record's own geometry, so a dome that stays where it rose ends when
   * its wizard steps out and not when a guest does. `ends: 'casting'` is the
   * only scope that means anything for it: the caster holds nothing of the
   * casting for `target` to release.
   */
  | 'caster-leaves-the-area'
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
   * SRD Unseen Servant: "If it drops to 0 Hit Points, the spell ends."
   *
   * The creature the casting is sustaining, read the way `target-drops-to-0`
   * reads its target — the **drop**, not the damage — and found the way
   * `summon-takes-damage` finds its steed, through `summonedBy`. Its own member
   * because the two sentences differ on a servant with more than one Hit
   * Point: a Phantom Steed's spell ends on any blow, and a servant's only when
   * it falls. The same residue as `target-drops-to-0`: the total and not the
   * transition, so a creature already at 0 taking another blow pulls it too.
   */
  | 'summon-drops-to-0'
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
  /**
   * Whether this action re-aims the Line, Cone or Cube the casting is blowing
   * from its caster.
   *
   * SRD *Gust of Wind*: "As a Bonus Action on your later turns, you can change
   * the direction in which the Line blasts from you." The area's origin is the
   * caster, so nothing moves; what changes is the one fact about a persistent
   * area that cannot be reconstructed — where it was pointed — and the request
   * states the new bearing exactly as the casting stated the first.
   *
   * **Beside {@link movesArea} rather than inside it**, because the SRD writes
   * two different sentences: Moonbeam's action *carries* a Cylinder to a new
   * point and is measured in feet, and this one turns a shape that has not
   * moved. A field that meant both would have nothing honest to put in the
   * allowance.
   *
   * **And nothing is rolled by the turning**, which is what the printed text
   * says: Gust of Wind's opening save is asked at the casting and the only one
   * that recurs is "A creature that ends its turn in the Line must make the
   * same save". So the Bonus Action changes the bearing and the spell's own
   * `areaTrigger` catches whoever the new Line is over, at the moment the
   * sentence names.
   */
  readonly redirects?: true;
  /**
   * Whether this action **replaces the branch** the casting ran.
   *
   * SRD Alter Self: "you can take a Magic action to replace the option you
   * chose with a different one." The word is named on the activation's
   * request, refused where it is the one already running or one the spell
   * does not print; `spell-option-changed` releases everything the casting
   * hung on its caster and re-pins the word, and the new branch's effects
   * run off the record's own numbers, on the caster. Presupposes
   * `SpellDefinition.options`, carries an empty {@link effects} list — the
   * effects are the branch's — and reaches nobody, so it takes no range.
   */
  readonly reoptions?: true;
  /**
   * Whether this action moves what the casting **already granted** onto a new
   * creature.
   *
   * > SRD Hunter's Mark: "If the target drops to 0 Hit Points before this
   * > spell ends, you can take a Bonus Action to move the mark to a new
   * > creature you can see within range."
   * > SRD Hex: "If the target drops to 0 Hit Points before this spell ends,
   * > you can take a Bonus Action on a later turn to curse a new creature."
   *
   * **Beside {@link movesArea} and {@link redirects} rather than inside
   * either**, and the three are the SRD's own three sentences: Moonbeam
   * *carries* a Cylinder to a new point, Gust of Wind *turns* a Line that has
   * not moved, and this puts the same casting's grants on somebody else. An
   * area is not involved at all.
   *
   * **What it resolves is the definition's own effects**, which is why a
   * re-aiming activation carries an empty {@link effects} list and the
   * validator insists on one: the book prints no second sentence for the later
   * turn — Hunter's Mark moves *the mark* and Hex curses a new creature with
   * *the curse* — so a list here would be a second place for one sentence to
   * be got wrong, and a Foe Slayer's d10 would have to be re-derived rather
   * than replaced.
   *
   * **The mark is `attack-rider.marksTarget` and nothing else**, which is what
   * makes the legality readable without a spell id: the rider the casting hung
   * names the creature it is about, so the command reads that creature's
   * vitals for the printed condition and refuses `quarry_still_standing` while
   * they stand. `checkSpellDefinition` refuses the field on a definition that
   * marks nobody, because there would be nothing to move.
   */
  readonly reAims?: true;
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
    if (effect.kind === 'summon' && effect.monster !== undefined && typeof effect.monster !== 'string') {
      return effect.monster;
    }
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
 * Whether a casting of this spell at this slot requires Concentration.
 *
 * {@link durationSecondsAt}'s sibling and the one reader of
 * {@link SpellDefinition.concentrationEndsAtSlot}, so the place that writes the
 * casting's `concentration` and any later reader cannot come to disagree about
 * which band a slot falls in.
 *
 * SRD Bestow Curse: "If you use a level 5+ spell slot, the spell **doesn't
 * require Concentration**." So the answer is the definition's own flag until
 * the band is reached and false from there up — "at this level or above",
 * which is the reading the duration table takes of its own keys.
 *
 * Identity for every spell that prints no such clause, which is all but two of
 * them.
 */
export function concentrationAt(definition: SpellDefinition, castLevel: number): boolean {
  if (!definition.concentration) return false;
  const drops = definition.concentrationEndsAtSlot;
  return drops === undefined || castLevel < drops;
}

/**
 * Whether a casting of this spell at this slot runs **until dispelled**.
 *
 * The third of the family {@link durationSecondsAt} and {@link concentrationAt}
 * make, and the one reader of {@link SpellDefinition.untilDispelledAtSlot} —
 * so the place that decides whether to schedule a deadline and any later
 * reader of the same question cannot come to disagree about which band a slot
 * falls in.
 *
 * SRD Major Image: "The spell lasts until dispelled … if cast with a level 4+
 * spell slot." So the answer is the definition's own flag until the band is
 * reached and true from there up — "at this level or above", which is the
 * reading its two neighbours take of their own keys.
 *
 * Identity for every spell that prints no such clause, which is all but one of
 * them.
 */
export function untilDispelledAt(definition: SpellDefinition, castLevel: number): boolean {
  if (definition.untilDispelled === true) return true;
  const from = definition.untilDispelledAtSlot;
  return from !== undefined && castLevel >= from;
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
 * How far this spell reaches for a caster of this character level, in feet.
 *
 * The one reader of {@link SpellDefinition.rangeAtLevel}, so the two places a
 * distance is measured — the casting, where the options may then multiply it,
 * and the shortlist a caller is shown — cannot come to disagree about which
 * band a caster has reached. `bandAt` again, with the printed Range as the
 * base, which is what SRD Spare the Dying's fifteen feet is: the reach of a
 * caster who has reached none of the three levels.
 *
 * Null where the Range is not a distance at all, exactly as {@link ranged} is,
 * and identity for every spell that prints no such clause — which is all but
 * one of them.
 */
export const rangeFeetAt = (
  definition: SpellDefinition,
  casterLevel: number,
): number | null => {
  const printed = ranged(definition.range);
  return printed === null ? null : bandAt(definition.rangeAtLevel, casterLevel, printed);
};

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
      // SRD Arcanist's Magic Aura: "Choose a creature type other than the
      // target's actual type." The second host of the same choice, and the
      // reason the member is not a one-writer field: what the caster names
      // lands on the mask exactly as it lands on a summons.
      if (effect.kind === 'creature-type-override') {
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
    // **And the same selector where a settled outcome hangs it**, which is the
    // third host and the one SRD Bestow Curse writes: "Choose one ability. The
    // target has Disadvantage on ability checks **and saving throws** made with
    // that ability", off a Wisdom save the same sentence asks for. Written as
    // two `roll-mode` effects the modes would land on a creature that made the
    // save, so they are {@link ModifierRider}s on the save that gates them —
    // and a substitution that could not reach a rider would have left the
    // ability the caster named on the placeholder the definition prints.
    //
    // `modifiers` is one field name on the three hosts that carry it, which is
    // what lets this be one arm rather than three — see {@link
    // modifierRidersOf}, which reads the same three.
    //
    // **The `mode` rider and not the `bonus` one beside it**, because the
    // `bonus` rider carries no narrowing at all: the standalone `buff` has
    // `only` and the rider is the arithmetic without it, so there is no field
    // here for a skill or an ability to be substituted into.
    if (
      (effect.kind === 'save' || effect.kind === 'attack' || effect.kind === 'save-damage') &&
      effect.modifiers !== undefined
    ) {
      const riders = effect.modifiers.map((rider) =>
        rider.kind === 'mode' && rider.modifier.selector[key] !== undefined
          ? {
              ...rider,
              modifier: {
                ...rider.modifier,
                selector: { ...rider.modifier.selector, [key]: chosen },
              },
            }
          : rider,
      );
      if (riders.some((rider, i) => rider !== effect.modifiers![i])) {
        return { ...effect, modifiers: riders } as SpellEffect;
      }
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
  const pinned = (
    pair: { readonly ability?: string; readonly skill?: string } | undefined,
  ): boolean => pair !== undefined && pair[of] !== undefined && pair[sibling] !== undefined;
  return effects.some((effect) => {
    if (effect.kind === 'roll-mode') return pinned(effect.modifier.selector);
    if (effect.kind === 'buff') return pinned(effect.only);
    // The third host, for {@link statedChoice}'s reason: a rider carries the
    // same pair and the same rule about it.
    return modifierRidersOf(effect).some(
      (rider) => rider.kind === 'mode' && pinned(rider.modifier.selector),
    );
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
export function riderDurations(
  definition: SpellDefinition,
  /**
   * The branch this casting named, where the spell prints branches.
   *
   * **The list that is running, not every list that could.** SRD Command's
   * Halt hangs a rule that ends at the end of the target's next turn and its
   * four other words hang nothing, so asking about all five would demand a
   * turn order of a caster who spoke Grovel — and asking about none would let
   * Halt reach `schedule` after the Wisdom save had been rolled, which is the
   * failure the paragraph above records in the past tense. `optionEffects` is
   * the identity function for every spell that prints no branches.
   */
  option?: string,
): readonly RiderDuration[] {
  const found: RiderDuration[] = [];
  for (const effect of optionEffects(definition, option)) {
    // **And the slot a success fills**, which lands in the same breath as the
    // failure's and so is asked about at the same moment. SRD Ray of
    // Enfeeblement's Disadvantage ends "until the start of your next turn"; a
    // pre-flight that read only the failure would have let the beam be thrown
    // outside combat, the save made, and the deadline then fail to pin — the
    // refused operation that has already moved the world this function exists
    // to prevent, arriving down the one branch it was not looking at.
    for (const rider of effect.kind === 'save' ? (effect.onSuccessRiders?.modifiers ?? []) : []) {
      if (rider.kind === 'mode' && rider.lasts !== undefined) found.push(rider.lasts);
    }
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
/**
 * Whether this spell breaks an Attunement, and so must be told which object.
 *
 * The reader `declaredFacts` and the pre-flight both ask, for
 * {@link teleportOf}'s reason: the symmetry — required where the spell prints
 * the clause, refused where it does not — is checked in two places and must
 * have one answer.
 *
 * Only the casting's own list, because that is the only place the kind may be
 * written: the object is stated at the casting, Remove Curse is Instantaneous
 * and breaks the Attunement at the touch, and an area trigger or an activation
 * firing a minute later has no request to read it off. `checkObjectPlacement`
 * refuses it anywhere else, which is what makes reading one list here correct
 * rather than optimistic.
 */
export function breaksAttunement(definition: SpellDefinition): boolean {
  return definition.effects.some((effect) => effect.kind === 'end-attunement');
}

/**
 * Whether this spell has to be told which object it is aimed at.
 *
 * Two clauses ask, and they are different sentences about the same fact: SRD
 * Remove Curse breaks an Attunement to an object, and SRD Heat Metal heats one
 * and makes its holder drop it. Both name a thing out of what the target has,
 * neither can be picked by the engine, and both are refused before a slot is
 * spent when the caster names none.
 *
 * **The casting's own list and its activation**, because Heat Metal's Bonus
 * Action deals the damage again to the same object — the record pins it, so
 * the activation needs no fresh request and the question is still "does this
 * spell ever name one".
 */
export function namesAnObject(definition: SpellDefinition): boolean {
  return breaksAttunement(definition) || dropsAnObject(definition);
}

/**
 * Whether this spell makes its target let go of the object it names.
 *
 * {@link namesAnObject}'s other half, asked on its own by the pre-flight that
 * checks the relation the *drop* needs — the target is wearing or wielding the
 * thing — which is not the relation an Attunement needs.
 *
 * **The casting's own list and its activation.** SRD Heat Metal's Bonus Action
 * deals the same damage to the same object, so the record pins it and the
 * activation needs no fresh request; the question is still whether the spell
 * ever writes the clause.
 */
export function dropsAnObject(definition: SpellDefinition): boolean {
  const lists = [
    definition.effects,
    definition.activation?.effects ?? [],
    ...optionEffectLists(definition),
  ];
  return lists.some((effects) =>
    effects.some((effect) => {
      const drops = outcomeRidersOf(effect).drops;
      // SRD Command's _Drop_ names no object because there is none to name —
      // "whatever it is holding" — so it is a drop that does not make the
      // spell one the caster has to point at something.
      return drops !== undefined && drops.all !== true;
    }),
  );
}

/**
 * Every branch's effect list, for the readers that ask a question of the whole
 * definition rather than of the list one casting runs.
 *
 * {@link SpellDefinition.options} is a choice made at the casting, so "does
 * this spell ever write the clause" has to look inside the branches — exactly
 * as it already looks inside an activation. The order is the record's key
 * order, which `checkContent` sorts, so two readers of one definition agree.
 */
export function optionEffectLists(
  definition: SpellDefinition,
): readonly (readonly SpellEffect[])[] {
  const options = definition.options;
  if (options === undefined) return [];
  return Object.keys(options)
    .sort()
    .map((key) => options[key]?.effects ?? []);
}

/**
 * The effects a casting of this definition actually runs, given the branch it
 * named.
 *
 * The common list first and the branch's after it, which is the order
 * {@link SpellDefinition.options} states and the only one that reads: a
 * definition writes what every branch shares once, and the branch adds what is
 * its own. Identity for every spell that prints no branches, which is all but
 * three of them.
 *
 * **It does not validate.** `declaredFacts` has already refused a casting that
 * named no branch or a branch the spell does not print, so a name that reaches
 * here is one of the record's keys; an unknown one contributes nothing rather
 * than throwing, for the reason `statedChoice` is the identity function on a
 * spell that prints no choice.
 */
export function optionEffects(
  definition: SpellDefinition,
  option: string | undefined,
): readonly SpellEffect[] {
  if (definition.options === undefined || option === undefined) return definition.effects;
  return [...definition.effects, ...(definition.options[option]?.effects ?? [])];
}

/**
 * The clauses this casting's area pins, with the stated types filled in.
 *
 * {@link optionEffects}' sibling for {@link SpellDefinition.areaStanding}: the
 * common list and then the branch's, exactly as the effects are read — and
 * then every `'stated'` in them replaced by the list the caster gave, so the
 * record the fold reads carries creature types and never the word. Identity
 * for every spell that prints no branches and states no types, which is all
 * but one. Undefined where the result would be an empty list, so a record
 * written before the field folds to the same bytes.
 *
 * `types` absent with a clause still saying `'stated'` is a definition
 * `checkSpellDefinition` refuses and `declaredFacts` never lets through; the
 * readers treat the word as naming nobody in any case.
 */
export function areaStandingFor(
  definition: SpellDefinition,
  option: string | undefined,
  types: readonly string[] | undefined,
): readonly AreaStanding[] | undefined {
  const branch = option === undefined ? undefined : definition.options?.[option]?.areaStanding;
  const clauses = [...(definition.areaStanding ?? []), ...(branch ?? [])];
  if (clauses.length === 0) return undefined;
  if (types === undefined) return clauses;
  return clauses.map((clause) => {
    switch (clause.kind) {
      case 'bars-passage':
        return typeof clause.to === 'object' && 'types' in clause.to && clause.to.types === 'stated'
          ? { ...clause, to: { types } }
          : clause;
      case 'attack-mode':
        return clause.attackerType === 'stated' ? { ...clause, attackerType: types } : clause;
      case 'condition-immunity':
        return clause.fromTypes === 'stated' ? { ...clause, fromTypes: types } : clause;
      default:
        return clause;
    }
  });
}

/**
 * What a DM's decision sets off — see {@link SpellDefinition.triggered}.
 *
 * The same two fields an {@link AreaTrigger} carries for what it runs, and
 * nothing of when: the when is the decision.
 */
export interface TriggeredEffects {
  /** Run through the ordinary spell machinery at the level the casting was made with. */
  readonly effects: readonly SpellEffect[];
  /** How the roll reads in the log: "Glyph of Warding (the explosive rune)". */
  readonly label: string;
}

/**
 * The ground this casting changes, off the branch it ran or the definition.
 *
 * One reader for the three places that ask — whether a point must be pinned,
 * where the region is derived and where the patch is written — so a branch's
 * terrain reaches all three the day it is written. Null for the book's spells
 * that leave the ground alone, which is nearly all of them.
 */
export function areaTerrainOf(
  definition: SpellDefinition,
  option: string | undefined,
): AreaTerrain | null {
  const branch = option === undefined ? undefined : definition.options?.[option];
  return branch?.areaTerrain ?? definition.areaTerrain ?? null;
}

/** Whether any list this definition can run lays ground: the definition's or a branch's. */
export function laysTerrain(definition: SpellDefinition): boolean {
  return (
    definition.areaTerrain !== undefined ||
    Object.values(definition.options ?? {}).some((branch) => branch.areaTerrain !== undefined)
  );
}

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
                ...(effect.endsWhenOutsideArea === undefined
                  ? {}
                  : { endsWhenOutsideArea: effect.endsWhenOutsideArea }),
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
 * An attack that **leaps** to a further creature off the faces its own damage
 * dice showed.
 *
 * SRD Chromatic Orb: "If you roll the same number on two or more of the d8s,
 * the orb leaps to a different target of your choice within 30 feet of the
 * target. Make an attack roll against the new target, and make a new damage
 * roll. The orb can't leap again unless you cast the spell with a level 2+
 * spell slot … The orb can leap a maximum number of times equal to the level
 * of the slot expended, and a creature can be targeted only once by each
 * casting of this spell."
 *
 * Two readings the format could not make until this. **A predicate over the
 * whole roll**: {@link DieRule} judges one die at a time — `substitute` and
 * `bonusOn` are both `(rolled, sides)` — and a pair is a question about two
 * faces together, so `onPair` is asked of the spell's own counted dice once
 * they have all been thrown and every reroll has settled. **A roll aimed at a
 * creature the casting never named**: the leap is *elected* rather than
 * offered — the request states `leapTo` in order (`CastSpellRequest.leapTo`,
 * checked before anything is spent and pinned on a held casting), and when a
 * pair shows the orb goes to the next stated creature within `withinFeet` of
 * the one it just struck that this casting has not yet targeted, with a new
 * attack roll and a new damage roll, through the same resolver the first orb
 * went through. No window opens, and a leap with nobody stated does not
 * happen — which is what "of your choice" means for a caller who has said
 * nothing.
 *
 * `maximum` is named as a derivation rather than written as a number, for
 * {@link DieRuleCap}'s reason: "equal to the level of the slot expended" is a
 * fact about the casting, so the cap is read off `castLevel` — one leap at
 * level 1, which is what "can't leap **again** unless" means, and one more per
 * slot level above it. One member, because the book prints one sentence.
 *
 * A miss rolls no damage and so shows no pair; the orb stops there.
 */
export interface OrbLeaps {
  /** The trigger: two or more of the spell's own dice showing one face. */
  readonly onPair: true;
  /** How far from the creature just struck the next may stand. */
  readonly withinFeet: number;
  /** How many leaps one casting may make, as a derivation from the casting. */
  readonly maximum: 'slot-level';
}

/**
 * Whether this spell is cast **on a hit** — in the window a weapon attack that
 * has landed opens, rather than at the casting's own door.
 *
 * Two spellings and one answer. SRD Divine Smite and its siblings ride the
 * blow's own damage (`attack-damage`); SRD Ensnaring Strike raises a saving
 * throw against the creature the blow landed on (`save.onTheHit`). Either way
 * the attack is the thing the spell needs, so `resolveSpell` refuses the spell
 * (`cast_on_a_hit`) and `resolveAttackDamage` settles it — and both doors ask
 * this one question rather than each remembering half of it.
 */
export function castOnAHit(definition: SpellDefinition): boolean {
  return definition.effects.some(
    (effect) =>
      effect.kind === 'attack-damage' || (effect.kind === 'save' && effect.onTheHit === true),
  );
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
    // SRD Arcanist's Magic Aura: "Choose a creature type **other than the
    // target's actual type**." The clause is about the type the creature
    // already is, so resolving the mask has to know it — and a creature nobody
    // has typed is asked about rather than masked on a guess, which is the
    // same three-valued discipline the two hosts above keep.
    case 'creature-type-override':
      return [effect.creatureType];
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
  // **Every list a casting could resolve**, which for a spell that prints
  // branches includes each of them: the question is whether this spell ever
  // reads the ability, asked before the wand's charge goes, and a wielder
  // must hear about a word they have not yet spoken. `dropsAnObject` reads
  // the branches for the same reason.
  return [definition.effects, ...optionEffectLists(definition)].some((effects) =>
    effects.some(
      (effect) =>
        effect.kind === 'dispel' ||
        (effect.kind === 'weapon-rider' && effect.castingAbility === true),
    ),
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
    // And every branch, for the reason the three above are here: the question
    // is which numbers *resolving this spell* reads, and SRD Command rolls a
    // Wisdom save in three of its five words and in none of its own list. The
    // branch the casting will speak is not known when a wand is asked which
    // ability to bring, and erring towards `true` is the safe direction this
    // function's own note names.
    ...optionEffectLists(definition).flat(),
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
      // And the ward that takes a fall's cost away, which carries no number at
      // all: "no damage" is an outcome rather than an amount, so there is
      // nothing of the caster's for it to pin. The jump beside it carries two
      // and neither is the caster's: thirty feet and ten are the book's, and
      // are the same numbers in a Barbarian's hand.
      case 'fall-ward':
      case 'jump-allowance':
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
      // A revival reads nothing of the caster either: the window and the hit
      // points are the spell's own printed numbers, and whose spell it was
      // changes neither.
      case 'revive':
      // And a stabilising reads nothing at all: it carries no number, so there
      // is none of anybody's for it to pin.
      case 'stabilise':
      // Nor does a body kept: the span it takes back is the casting's own and
      // the clock's, and nothing about the caster decides any of it.
      case 'preserves':
      case 'turn-payout':
      case 'action-rule':
      case 'healing-rule':
      case 'hit-point-maximum':
      case 'dispel':
      // An attunement broken reads nothing of the caster either: which object
      // is the caster's own choice, stated at the casting, and no number about
      // them decides anything.
      case 'end-attunement':
      // A mask reads nothing of the caster either: which type is the caster's
      // own choice, stated at the casting, and no number about them decides it.
      case 'creature-type-override':
      case 'teleport':
      // And an altitude changed reads nothing of the caster: how far and which
      // way is the caster's own decision, stated at the activation, and no
      // number about them decides whether it happens.
      case 'change-altitude':
      case 'summon':
      // A creature sent elsewhere reads nothing of the caster either: the die
      // Blink throws is the book's, with no modifier, and where the creature
      // comes back to is a space somebody names.
      case 'elsewhere':
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
    (effect) =>
      effect.kind === 'save' &&
      // Two readers of one stated fact — SRD Charm Person's Advantage and SRD
      // Enthrall's automatic success — and one question at the door.
      (effect.advantageIfFought === true ||
        (effect.autoSucceedIf !== undefined && 'fought' in effect.autoSucceedIf)),
  );
}

/**
 * Does this spell offer a saving throw an **unwilling** creature makes?
 *
 * SRD Levitate's "An unwilling creature that succeeds on a Constitution saving
 * throw is unaffected", read off the definition for {@link statesFoughtFact}'s
 * reason: the fact is stated once, at the casting, and the clause therefore
 * belongs to the saving throw the casting itself calls for. A clause on an
 * area trigger's save or an activation's would fire off a record that carries
 * no such fact and would be silently unread; the validator refuses one there
 * rather than leaving that to be discovered.
 */
export function offersAnUnwillingSave(definition: SpellDefinition): boolean {
  // **The casting's own list and its branches**, for {@link dropsAnObject}'s
  // reason: a branch resolves at the casting with the request in hand, and
  // SRD Enlarge/Reduce prints one consent clause over two branches that each
  // carry the save it gates. An area trigger's or an activation's list is
  // still excluded, because those fire later off a record that holds no
  // such fact.
  return [definition.effects, ...optionEffectLists(definition)].some((effects) =>
    effects.some((effect) => effect.kind === 'save' && effect.unlessWilling === true),
  );
}

/**
 * Does this spell ask its caster who among its targets consents?
 *
 * The ninth stated fact's `statesFoughtFact`, and it reads **two** clauses
 * because the SRD writes consent two ways: a target rule that requires it
 * ({@link TargetRule.willing}, SRD Mage Armor) and a saving throw offered to
 * whoever does not ({@link offersAnUnwillingSave}, SRD Levitate). Either makes
 * `CastSpellRequest.willing` a fact this spell can be told; neither makes it
 * one the spell demands, which is the difference from the fought clause — a
 * Mage Armor on its own caster states nothing and is right to.
 *
 * One reader for one question, asked where the symmetry is checked: **refused**
 * for a spell that prints neither clause, exactly as `no_fought_clause` and
 * `no_object_clause` are.
 */
export function statesWillingFact(definition: SpellDefinition): boolean {
  return definition.targets.willing === true || offersAnUnwillingSave(definition);
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
  // **All three hosts**, and the third is the one SRD Gust of Wind and SRD
  // Levitate write: a saving throw whose failure moves the creature and does
  // nothing else. `save` keeps its flat spelling, so the slot is declared
  // there as well and read here in one place — the reading `light` already
  // takes, for its reason.
  const movement =
    effect.kind === 'attack' || effect.kind === 'save-damage' || effect.kind === 'save'
      ? effect.movement
      : undefined;
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
  // The same three hosts again, and for the same reason: SRD Heat Metal writes
  // the clause off a bare `save`, which keeps its flat spelling.
  const drops =
    effect.kind === 'attack' || effect.kind === 'save-damage' || effect.kind === 'save'
      ? effect.drops
      : undefined;
  return {
    ...(conditions.length === 0 ? {} : { conditions }),
    ...(modifiers.length === 0 ? {} : { modifiers }),
    ...(delayed === undefined ? {} : { delayed }),
    ...(movement === undefined ? {} : { movement }),
    ...(spends === undefined ? {} : { spends }),
    ...(light === undefined ? {} : { light }),
    ...(breaksConcentration === undefined ? {} : { breaksConcentration }),
    ...(drops === undefined ? {} : { drops }),
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
