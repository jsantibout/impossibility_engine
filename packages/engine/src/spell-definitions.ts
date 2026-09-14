import type { Ability, CharacterId, ConditionName, Skill } from '@ie/shared';
import { endOfNextTurn, forSeconds, startOfNextTurn, type Duration } from './duration.js';
import type { Bonus, BonusApplies } from './bonuses.js';
import type { RollModifier } from './roll-modifiers.js';
import type { PointAnchoring } from './positioning.js';
import type { CastingTime } from './spells.js';
import type { SpellReactionWindow } from './reactions.js';

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
  | { readonly kind: 'ranged'; readonly feet: number };

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
  /** The base roll, e.g. `1d10`. */
  readonly dice: string;
  /** A flat addend the spell prints alongside the dice: False Life's `+ 4`. */
  readonly flat?: number;
  /** A flat increase per slot level above the spell's own: False Life's `+5`. */
  readonly flatPerSlotLevelAbove?: number;
  /**
   * SRD Cantrip Upgrade: the character levels at which one more die is added.
   * Fire Bolt's are 5, 11 and 17.
   */
  readonly cantripUpgradesAt?: readonly number[];
  /** Extra dice for each slot level above the spell's own. */
  readonly perSlotLevelAbove?: string;
}

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
export type RiderDuration =
  | 'start-of-casters-next-turn'
  | 'end-of-casters-next-turn'
  | { readonly seconds: number };

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
 * `pendingCasting` holds one open between its declaration and its effects, and
 * the slot the SRD spares is simply not spent until it settles. Feather Fall
 * is the one left — it answers a fall, and nothing falls.
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
    readonly at: 'start-of-turn' | 'end-of-turn';
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
 * **A modifier rider carries no `lasts`.** `EffectTarget` ends a condition
 * instance, a casting or a feature, and nothing ends a *grant* before its
 * casting does — so a rider that lives for less than the casting is not
 * expressible and this does not pretend otherwise. Phantasmal Killer's "for
 * the duration" fits; a future "for 1 minute" on an Instantaneous host needs
 * a fourth `EffectTarget` member, which is the same gap CLAUDE.md already
 * names for Superior Hunter's Defense.
 */
export type ModifierRider =
  | {
      readonly kind: 'bonus';
      readonly bonus: Bonus;
      readonly applies: readonly BonusApplies[];
      readonly direction: 'add' | 'subtract';
    }
  | { readonly kind: 'mode'; readonly modifier: RollModifier };

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
        readonly at: 'start-of-turn' | 'end-of-turn';
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
  | {
      readonly kind: 'interrupt-casting';
      readonly ability: Ability;
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
  readonly at?: 'start-of-turn' | 'end-of-turn';
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

export interface SpellDefinition {
  /** The SRD slug, so a definition and its parsed record are the same spell. */
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly school: string;
  readonly castingTime: CastingTime;
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
   * SRD "you can designate creatures to be unaffected by it".
   *
   * Two spells print it — Spirit Guardians and Alarm — which is what makes it
   * a transcribed clause rather than a general area filter. The caster names
   * them at the casting; the engine validates that they exist and remembers
   * the choice for the spell's whole duration.
   *
   * Absent means the spell offers no such choice and naming anybody is
   * refused, rather than quietly ignored.
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
   * Not a *choice*: the SRD decides it, and this records who is entitled to
   * tell the engine what the SRD decided. One spell, transcribed; a second
   * would be the evidence that anything here should generalise.
   */
  readonly damageTypeStated?: readonly string[];
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
   * SRD Mage Hand: "The hand vanishes ... **if you cast this spell again**";
   * Minor Illusion: "The illusion ends if you cast this spell again."
   *
   * The same caster casting the same spell. Two spells write the sentence
   * identically, which is what makes it a rule rather than a quirk, and the
   * ongoing record is what makes obeying it a lookup instead of a search.
   */
  readonly replacesPriorCasting?: true;
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
 * A trigger's effects, dealing the damage type this casting was declared with.
 *
 * SRD Spirit Guardians prints two and picks between them on the caster's
 * alignment, which is stated at the casting and pinned there — see
 * `OngoingSpell.damageType`. The definition carries one of the two so the
 * shape is well-formed and `spell-catalogue.test.ts` can cast it; the pinned
 * answer is what actually lands, and it is pinned rather than re-read for the
 * same reason the save DC is.
 *
 * Absent for every other spell, where the printed type is the only type and
 * this is the identity function.
 */
export function statedDamageType(
  effects: readonly SpellEffect[],
  damageType: string | undefined,
): readonly SpellEffect[] {
  if (damageType === undefined) return effects;
  return effects.map((effect) =>
    'damageType' in effect && effect.damageType !== undefined ? { ...effect, damageType } : effect,
  );
}

/**
 * The deadline a rider clause names.
 *
 * Two of the three members are anchored to the caster's own turn; the third is
 * a span on the clock, and the whole reason it is a separate member is that
 * the two are not interchangeable — see {@link RiderDuration}.
 */
export function riderDuration(
  lasts: RiderDuration | undefined,
  casterId: CharacterId,
): Duration | undefined {
  if (lasts === undefined) return undefined;
  if (typeof lasts === 'object') return forSeconds(lasts.seconds);
  return lasts === 'end-of-casters-next-turn'
    ? endOfNextTurn(casterId)
    : startOfNextTurn(casterId);
}

/**
 * Every rider deadline a casting of this spell is going to need.
 *
 * Gathered so they can be checked before anything is spent. A turn-anchored
 * rider cannot be pinned outside combat, and finding that out at the moment
 * the condition lands is too late: the saving throw has already been rolled,
 * and the caller's generator has already moved for a cast that never happened.
 */
export function riderDurations(definition: SpellDefinition): readonly RiderDuration[] {
  const found: RiderDuration[] = [];
  for (const effect of definition.effects) {
    // Every rider on every host, because a plural `conditions` means the one
    // that cannot be pinned is not always the first.
    for (const rider of conditionRiderOf(effect)) {
      if (rider.lasts !== undefined) found.push(rider.lasts);
    }
  }
  return found;
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
  return {
    ...(conditions.length === 0 ? {} : { conditions }),
    ...(modifiers.length === 0 ? {} : { modifiers }),
    ...(delayed === undefined ? {} : { delayed }),
  };
}

/**
 * SRD Fire Bolt:
 *
 * > _Evocation Cantrip._ **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** Instantaneous.
 * > "Make a ranged spell attack against the target. On a hit, the target takes
 * > 1d10 Fire damage."
 * > _Cantrip Upgrade._ "The damage increases by 1d10 when you reach levels 5
 * > (2d10), 11 (3d10), and 17 (4d10)."
 */
export const FIRE_BOLT: SpellDefinition = {
  id: 'fire-bolt',
  name: 'Fire Bolt',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '1d10', cantripUpgradesAt: [5, 11, 17] },
      damageType: 'fire',
    },
  ],
};

/**
 * SRD Hold Person:
 *
 * > _Level 2 Enchantment._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Concentration, up to 1 minute.
 * > "Choose a Humanoid that you can see within range. The target must succeed
 * > on a Wisdom saving throw or have the Paralyzed condition for the duration.
 * > At the end of each of its turns, the target repeats the save, ending the
 * > spell on itself on a success."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional Humanoid
 * > for each spell slot level above 2."
 */
export const HOLD_PERSON: SpellDefinition = {
  id: 'hold-person',
  name: 'Hold Person',
  level: 2,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1, extraPerSlotLevelAbove: 1, mustBeType: 'Humanoid' },
  requiresSight: true,
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'paralyzed',
      repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
    },
  ],
  durationSeconds: 60,
};

/**
 * SRD Greater Invisibility:
 *
 * > _Level 4 Illusion (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Concentration, up to 1 minute.
 * > "A creature you touch has the Invisible condition until the spell ends."
 *
 * That sentence is the whole spell, and it offers no saving throw — which is
 * the shape this definition exists to prove. "A creature you touch" includes
 * yourself, and it prints no *Using a Higher-Level Spell Slot* line, so a
 * level 9 slot still reaches one creature.
 */
export const GREATER_INVISIBILITY: SpellDefinition = {
  id: 'greater-invisibility',
  name: 'Greater Invisibility',
  level: 4,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [{ kind: 'condition', condition: { name: 'invisible' } }],
  durationSeconds: 60,
};

/**
 * SRD Invisibility:
 *
 * > _Level 2 Illusion (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Concentration, up to 1 hour.
 * > "A creature you touch has the Invisible condition until the spell ends.
 * > The spell ends early immediately after the target makes an attack roll,
 * > deals damage, or casts a spell."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 2."
 *
 * Greater Invisibility's sentence plus one more, and that second sentence is
 * the whole of the difference between the two spells — which is why this one
 * is **partial** and its bigger sibling is not.
 */
export const INVISIBILITY: SpellDefinition = {
  id: 'invisibility',
  name: 'Invisibility',
  level: 2,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, extraPerSlotLevelAbove: 1, self: true },
  effects: [{ kind: 'condition', condition: { name: 'invisible' } }],
  durationSeconds: 3600,
  unmodelled: [
    'the spell ends early immediately after the target makes an attack roll, deals damage, or casts a spell: a casting cannot ask to be ended when its own target acts, so the invisibility runs its hour and the DM ends it',
  ],
};

/**
 * SRD Sacred Flame:
 *
 * > _Evocation Cantrip (Cleric)._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Instantaneous.
 * > "Flame-like radiance descends on a creature that you can see within range.
 * > The target must succeed on a Dexterity saving throw or take 1d8 Radiant
 * > damage. The target gains no benefit from Half Cover or Three-Quarters
 * > Cover for this save."
 * > _Cantrip Upgrade._ "The damage increases by 1d8 when you reach levels 5
 * > (2d8), 11 (3d8), and 17 (4d8)."
 *
 * A success takes *no* damage: the text says "or take", not "half as much".
 *
 * The cover clause is **not** modelled, and no field records it. Cover is not
 * applied to any spell saving throw yet — declared cover reaches Armour Class
 * and nothing else — so a field saying this spell ignores it would describe an
 * exception to a rule the engine does not have. When Dexterity saves start
 * reading cover, this spell is the first thing that needs a field.
 */
export const SACRED_FLAME: SpellDefinition = {
  id: 'sacred-flame',
  name: 'Sacred Flame',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '1d8', cantripUpgradesAt: [5, 11, 17] },
      damageType: 'radiant',
      onSuccess: 'none',
    },
  ],
};

/**
 * SRD Inflict Wounds:
 *
 * > _Level 1 Necromancy (Cleric)._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Instantaneous.
 * > "A creature you touch makes a Constitution saving throw, taking 2d10
 * > Necrotic damage on a failed save or half as much damage on a successful
 * > one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d10 for each
 * > spell slot level above 1."
 *
 * Note the asymmetry the scaling field exists for: the base is **2**d10 and
 * the increase is **1**d10.
 */
export const INFLICT_WOUNDS: SpellDefinition = {
  id: 'inflict-wounds',
  name: 'Inflict Wounds',
  level: 1,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '2d10', perSlotLevelAbove: '1d10' },
      damageType: 'necrotic',
      onSuccess: 'half',
    },
  ],
};

/**
 * SRD Acid Arrow:
 *
 * > _Level 2 Evocation (Wizard)._ **Casting Time:** Action. **Range:** 90
 * > feet. **Duration:** Instantaneous.
 * > "A shimmering green arrow streaks toward a target within range and bursts
 * > in a spray of acid. Make a ranged spell attack against the target. On a
 * > hit, the target takes 4d4 Acid damage and 2d4 Acid damage at the end of
 * > its next turn. On a miss, the arrow splashes the target with acid for half
 * > as much of the initial damage only."
 * > _Using a Higher-Level Spell Slot._ "The damage (both initial and later)
 * > increases by 1d4 for each spell slot level above 2."
 *
 * **The miss branch is not modelled and says so.** "Half as much of the
 * initial damage only" on a *miss* is a third outcome the attack shape has no
 * room for — an attack either hits or does nothing — and inventing a
 * half-damage-on-a-miss path for one spell would be a mechanism with one user.
 * So a miss deals nothing here and `unmodelled` names it, which is the honest
 * version of a gap.
 */
export const ACID_ARROW: SpellDefinition = {
  id: 'acid-arrow',
  name: 'Acid Arrow',
  level: 2,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '4d4', perSlotLevelAbove: '1d4' },
      damageType: 'acid',
      // "both initial and later" — so the later hit scales too, and by the
      // same 1d4. Its own field, because the other spell with this shape
      // scales the initial damage and not the later one.
      delayed: {
        damage: { dice: '2d4', perSlotLevelAbove: '1d4' },
        damageType: 'acid',
      },
      // "On a miss, the arrow splashes the target with acid for half as much
      // of the initial damage **only**." *Only* is the word that makes this a
      // branch on the host's own damage rather than a rider: the later 2d4 and
      // everything else a hit would carry are the hit's, and a miss owes none
      // of them.
      onMiss: 'half',
    },
  ],
};

/**
 * SRD Shield:
 *
 * > _Level 1 Abjuration (Sorcerer, Wizard)._ **Casting Time:** Reaction, which
 * > you take when you are hit by an attack roll or targeted by the _Magic
 * > Missile_ spell. **Range:** Self. **Duration:** 1 round.
 * > "An imperceptible barrier of magical force protects you. Until the start
 * > of your next turn, you have a +5 bonus to AC, including against the
 * > triggering attack, and you take no damage from _Magic Missile_."
 *
 * **"Including against the triggering attack" is the whole spell.** A Shield
 * that only helped against what came next would be a much weaker one, so the
 * casting re-measures the hit it answered: the attack is still held, the roll
 * that made it is written down, and whether it now falls short is arithmetic
 * rather than anybody's judgement.
 *
 * Two halves of the text are not modelled and say so. Magic Missile is not a
 * trigger the engine can see — the spell has no executable definition, so
 * there is nothing to be targeted by — and the immunity to its damage has
 * nothing to attach to.
 */
/**
 * SRD Counterspell:
 *
 * > _Level 3 Abjuration (Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Reaction, which you take when you see a creature within 60 feet of
 * > yourself casting a spell with Verbal, Somatic, or Material components.
 * > **Range:** 60 feet. **Components:** S. **Duration:** Instantaneous.
 * > "You attempt to interrupt a creature in the process of casting a spell.
 * > The creature makes a Constitution saving throw. On a failed save, the
 * > spell dissipates with no effect, and the action, Bonus Action, or Reaction
 * > used to cast it is wasted. If that spell was cast with a spell slot, the
 * > slot isn't expended."
 *
 * **2024 is not 2014 here, and the difference is the whole spell.** There is
 * no check against the countered spell's level, no automatic success below a
 * threshold, and — read the text again — **no "Using a Higher-Level Spell
 * Slot" clause at all**. Upcasting Counterspell buys nothing. Every one of
 * those is a 2014 memory, and a `DiceScaling` or an `onSuccess` written from
 * one would be inventing a rule.
 *
 * The save is made by **the creature being countered**, against the
 * counterspeller's spell save DC, which is why this is an effect aimed at a
 * target rather than a roll the caster makes.
 *
 * The one clause not modelled is the components qualifier, and it is worth
 * saying why rather than quietly checking nothing: **all 339 SRD 5.2.1 spells
 * have at least one of Verbal, Somatic or Material**, so the clause excludes
 * nothing the engine can currently be asked about, and a creature casting by
 * some means the engine has not been told the components of is an unknown
 * rather than a no. `counterspell.test.ts` pins that count, so the day the
 * data stops saying it, something goes red.
 */
export const COUNTERSPELL: SpellDefinition = {
  id: 'counterspell',
  name: 'Counterspell',
  level: 3,
  school: 'abjuration',
  castingTime: 'reaction',
  trigger: 'casting-a-spell',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  requiresSight: true,
  targets: { count: 1 },
  effects: [{ kind: 'interrupt-casting', ability: 'con' }],
  unmodelled: [
    'the trigger reads "casting a spell with Verbal, Somatic, or Material components"; every SRD 5.2.1 spell has one of the three, so the qualifier is not checked and excludes nothing',
  ],
};

export const SHIELD: SpellDefinition = {
  id: 'shield',
  name: 'Shield',
  level: 1,
  school: 'abjuration',
  castingTime: 'reaction',
  trigger: 'hit-by-attack',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'buff',
      bonus: { source: 'Shield', flat: 5 },
      applies: ['ac'],
      direction: 'add',
    },
  ],
  durationUntil: 'start-of-casters-next-turn',
  unmodelled: [
    'being targeted by Magic Missile is also a trigger, and taking no damage from it is also a benefit; neither is modelled, because Magic Missile is not executable here',
  ],
};

/**
 * SRD Shield of Faith:
 *
 * > _Level 1 Abjuration (Cleric, Paladin)._ **Casting Time:** Bonus Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 10 minutes.
 * > "A shimmering field surrounds a creature of your choice within range,
 * > granting it a +2 bonus to AC for the duration."
 *
 * No Reaction, no trigger, no window — and it needed exactly one of the three
 * things Shield needed: an Armour Class an effect can reach. Two spells
 * wanting the same missing piece and differing in every other way is what
 * makes `applies: ['ac']` a shape rather than a special case for Shield.
 */
export const SHIELD_OF_FAITH: SpellDefinition = {
  id: 'shield-of-faith',
  name: 'Shield of Faith',
  level: 1,
  school: 'abjuration',
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'buff',
      bonus: { source: 'Shield of Faith', flat: 2 },
      applies: ['ac'],
      direction: 'add',
    },
  ],
  durationSeconds: 600,
};

/**
 * SRD Hellish Rebuke:
 *
 * > _Level 1 Evocation (Warlock)._ **Casting Time:** Reaction, which you take
 * > in response to taking damage from a creature that you can see within 60
 * > feet of yourself. **Range:** 60 feet. **Duration:** Instantaneous.
 * > "The creature that damaged you is momentarily surrounded by green flames.
 * > It makes a Dexterity saving throw, taking 2d10 Fire damage on a failed
 * > save or half as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d10 for each
 * > spell slot level above 1."
 *
 * **The effect is an ordinary shape; the trigger is the whole difficulty.**
 * Once the target is settled this is `save-damage` with `onSuccess: 'half'`,
 * indistinguishable from Inflict Wounds. What it needed was for damage to name
 * the creature that dealt it — `source` has always been prose, and prose
 * cannot be set on fire.
 *
 * **"The creature that damaged you" is not "a creature of your choice".** The
 * target is forced, so aiming it elsewhere is refused rather than quietly
 * redirected — the same rule `eligibleTargets` states for every other spell.
 *
 * Sight and range are the spell's own to check and are checked by the ordinary
 * machinery: `requiresSight` makes an undeclared line of sight a request and a
 * declared *unseen* a refusal, and 60 feet is the range.
 */
export const HELLISH_REBUKE: SpellDefinition = {
  id: 'hellish-rebuke',
  name: 'Hellish Rebuke',
  level: 1,
  school: 'evocation',
  castingTime: 'reaction',
  trigger: 'damaged-by-creature',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '2d10', perSlotLevelAbove: '1d10' },
      damageType: 'fire',
      onSuccess: 'half',
    },
  ],
};

/**
 * SRD Cure Wounds:
 *
 * > _Level 1 Abjuration (Bard, Cleric, Druid, Paladin, Ranger)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** Instantaneous.
 * > "A creature you touch regains a number of Hit Points equal to 2d8 plus
 * > your spellcasting ability modifier."
 * > _Using a Higher-Level Spell Slot._ "The healing increases by 2d8 for each
 * > spell slot level above 1."
 *
 * "A creature you touch" includes yourself, so the caster is a legal target.
 */
export const CURE_WOUNDS: SpellDefinition = {
  id: 'cure-wounds',
  name: 'Cure Wounds',
  level: 1,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'heal',
      healing: { dice: '2d8', perSlotLevelAbove: '2d8' },
      addSpellcastingModifier: true,
    },
  ],
};

/**
 * SRD Healing Word:
 *
 * > _Level 1 Abjuration (Bard, Cleric, Druid)._ **Casting Time:** Bonus Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "A creature of your choice that you can see within range regains Hit
 * > Points equal to 2d4 plus your spellcasting ability modifier."
 * > _Using a Higher-Level Spell Slot._ "The healing increases by 2d4 for each
 * > spell slot level above 1."
 *
 * The Bonus Action is why this sits alongside Cure Wounds: the same effect at
 * a different cost, and the action economy has to charge the right one.
 */
export const HEALING_WORD: SpellDefinition = {
  id: 'healing-word',
  name: 'Healing Word',
  level: 1,
  school: 'abjuration',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1, self: true },
  requiresSight: true,
  effects: [
    {
      kind: 'heal',
      healing: { dice: '2d4', perSlotLevelAbove: '2d4' },
      addSpellcastingModifier: true,
    },
  ],
};

/**
 * SRD Mass Healing Word:
 *
 * > _Level 3 Abjuration (Bard, Cleric)._ **Casting Time:** Bonus Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "Up to six creatures of your choice that you can see within range regain
 * > Hit Points equal to 2d4 plus your spellcasting ability modifier."
 * > _Using a Higher-Level Spell Slot._ "The healing increases by 1d4 for each
 * > spell slot level above 3."
 *
 * Healing Word for six, and the upcast is the place to be careful: this one
 * grows by **1**d4 where Healing Word grows by 2d4, which is exactly the sort
 * of number that gets copied across from the neighbouring spell.
 */
export const MASS_HEALING_WORD: SpellDefinition = {
  id: 'mass-healing-word',
  name: 'Mass Healing Word',
  level: 3,
  school: 'abjuration',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 6, self: true },
  requiresSight: true,
  effects: [
    {
      kind: 'heal',
      healing: { dice: '2d4', perSlotLevelAbove: '1d4' },
      addSpellcastingModifier: true,
    },
  ],
};

/**
 * SRD Mass Cure Wounds:
 *
 * > _Level 5 Abjuration (Bard, Cleric, Druid)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "A wave of healing energy washes out from a point you can see within
 * > range. Choose up to six creatures in a 30-foot-radius Sphere centered on
 * > that point. Each target regains Hit Points equal to 5d8 plus your
 * > spellcasting ability modifier."
 * > _Using a Higher-Level Spell Slot._ "The healing increases by 1d8 for each
 * > spell slot level above 5."
 *
 * **A target list bounded by an area**, which is what `targetsWithin` exists
 * for. `area` picks its own targets from geometry — everyone inside it, which
 * is right for Fireball and wrong here, because the caster chooses *up to six*
 * of the creatures in the Sphere and would otherwise heal the enemies standing
 * in it. Choosing is the operative rule and the Sphere bounds what may be
 * chosen, so both halves are real: the point is held to the spell's range, and
 * every name is held to the Sphere.
 */
export const MASS_CURE_WOUNDS: SpellDefinition = {
  id: 'mass-cure-wounds',
  name: 'Mass Cure Wounds',
  level: 5,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 6, self: true },
  targetsWithin: { kind: 'sphere', radius: 30, origin: 'point' },
  effects: [
    {
      kind: 'heal',
      healing: { dice: '5d8', perSlotLevelAbove: '1d8' },
      addSpellcastingModifier: true,
    },
  ],
};

/**
 * SRD Burning Hands:
 *
 * > _Level 1 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "A thin sheet of flames shoots forth from you. Each creature in a 15-foot
 * > Cone makes a Dexterity saving throw, taking 3d6 Fire damage on a failed
 * > save or half as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 1."
 *
 * Range: Self, so the Cone starts at the caster and — being a Cone — does not
 * include them.
 */
export const BURNING_HANDS: SpellDefinition = {
  id: 'burning-hands',
  name: 'Burning Hands',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'cone', length: 15, origin: 'self' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '3d6', perSlotLevelAbove: '1d6' },
      damageType: 'fire',
      onSuccess: 'half',
    },
  ],
};

/**
 * SRD Thunderwave:
 *
 * > _Level 1 Evocation (Bard, Druid, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** Self. **Duration:** Instantaneous.
 * > "Each creature in a 15-foot Cube originating from you makes a Constitution
 * > saving throw. On a failed save, a creature takes 2d8 Thunder damage and is
 * > pushed 10 feet away from you. On a successful save, a creature takes half
 * > as much damage only."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 1."
 *
 * The **push is not modelled**: forced movement out of an area is its own
 * mechanic, `moveCreature` spends movement a shove does not, and a half-done
 * version that moved nobody would read as if it had. The damage is exact and
 * the push is a gap, which is the honest pair.
 */
export const THUNDERWAVE: SpellDefinition = {
  id: 'thunderwave',
  name: 'Thunderwave',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'cube', size: 15, origin: 'self' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '2d8', perSlotLevelAbove: '1d8' },
      damageType: 'thunder',
      onSuccess: 'half',
    },
  ],
  unmodelled: ['a creature that fails is pushed 10 feet away from you'],
};

/**
 * SRD Lightning Bolt:
 *
 * > _Level 3 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "A stroke of lightning forming a 100-foot-long, 5-foot-wide Line blasts
 * > out from you in a direction you choose. Each creature in the Line makes a
 * > Dexterity saving throw, taking 8d6 Lightning damage on a failed save or
 * > half as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 3."
 */
export const LIGHTNING_BOLT: SpellDefinition = {
  id: 'lightning-bolt',
  name: 'Lightning Bolt',
  level: 3,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'line', length: 100, width: 5, origin: 'self' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '8d6', perSlotLevelAbove: '1d6' },
      damageType: 'lightning',
      onSuccess: 'half',
    },
  ],
};

/**
 * SRD Fireball:
 *
 * > _Level 3 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Instantaneous.
 * > "A bright streak flashes from you to a point you choose within range and
 * > then blossoms with a low roar into a fiery explosion. Each creature in a
 * > 20-foot-radius Sphere centered on that point makes a Dexterity saving
 * > throw, taking 8d6 Fire damage on a failed save or half as much damage on a
 * > successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 3."
 *
 * A Sphere includes its point of origin, so a caster who drops one at their
 * own feet is in it. That is the rule, and it is not softened.
 */
export const FIREBALL: SpellDefinition = {
  id: 'fireball',
  name: 'Fireball',
  level: 3,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '8d6', perSlotLevelAbove: '1d6' },
      damageType: 'fire',
      onSuccess: 'half',
    },
  ],
};

/**
 * A ranged attack cantrip whose whole text is "hit, take dice".
 *
 * Five of these are the same spell with a different damage type and die, so
 * they are built from one function rather than copied five times — the copy is
 * where a d8 becomes a d10 and no test can see it. Every field still comes
 * from the SRD line quoted at the call site.
 */
function attackCantrip(args: {
  readonly id: string;
  readonly name: string;
  readonly school: string;
  readonly feet: number | 'touch';
  readonly dice: string;
  readonly damageType: string;
  readonly attack?: 'ranged' | 'melee';
  readonly unmodelled?: readonly string[];
}): SpellDefinition {
  return {
    id: args.id,
    name: args.name,
    level: 0,
    school: args.school,
    castingTime: 'action',
    concentration: false,
    range: args.feet === 'touch' ? { kind: 'touch' } : { kind: 'ranged', feet: args.feet },
    targets: { count: 1 },
    effects: [
      {
        kind: 'attack',
        attack: args.attack ?? 'ranged',
        // SRD Cantrip Upgrade is the same three levels for every cantrip.
        damage: { dice: args.dice, cantripUpgradesAt: [5, 11, 17] },
        damageType: args.damageType,
      },
    ],
    ...(args.unmodelled === undefined ? {} : { unmodelled: args.unmodelled }),
  };
}

/**
 * SRD Poison Spray:
 *
 * > _Necromancy Cantrip (Druid, Sorcerer, Warlock, Wizard)._ **Range:** 30 feet.
 * > "Make a ranged spell attack against the target. On a hit, the target takes
 * > 1d12 Poison damage."
 * > _Cantrip Upgrade._ "...increases by 1d12 when you reach levels 5 (2d12),
 * > 11 (3d12), and 17 (4d12)."
 *
 * The only one of these with nothing left over: its text is the mechanic.
 */
export const POISON_SPRAY = attackCantrip({
  id: 'poison-spray',
  name: 'Poison Spray',
  school: 'necromancy',
  feet: 30,
  dice: '1d12',
  damageType: 'poison',
});

/**
 * SRD Ray of Frost:
 *
 * > _Evocation Cantrip (Sorcerer, Wizard)._ **Range:** 60 feet.
 * > "On a hit, it takes 1d8 Cold damage, and its Speed is reduced by 10 feet
 * > until the start of your next turn."
 */
export const RAY_OF_FROST = attackCantrip({
  id: 'ray-of-frost',
  name: 'Ray of Frost',
  school: 'evocation',
  feet: 60,
  dice: '1d8',
  damageType: 'cold',
  unmodelled: ['the target\u2019s Speed is reduced by 10 feet until the start of your next turn'],
});

/**
 * SRD Shocking Grasp:
 *
 * > _Evocation Cantrip (Sorcerer, Wizard)._ **Range:** Touch.
 * > "Make a melee spell attack against the target. On a hit, the target takes
 * > 1d8 Lightning damage, and it can't make Opportunity Attacks until the
 * > start of its next turn."
 */
export const SHOCKING_GRASP = attackCantrip({
  id: 'shocking-grasp',
  name: 'Shocking Grasp',
  school: 'evocation',
  feet: 'touch',
  attack: 'melee',
  dice: '1d8',
  damageType: 'lightning',
  unmodelled: ['the target cannot make Opportunity Attacks until the start of its next turn'],
});

/**
 * SRD Chill Touch:
 *
 * > _Necromancy Cantrip (Sorcerer, Warlock, Wizard)._ **Range:** Touch.
 * > "Make a melee spell attack against a target within reach. On a hit, the
 * > target takes 1d10 Necrotic damage, and it can't regain Hit Points until
 * > the end of your next turn."
 */
export const CHILL_TOUCH = attackCantrip({
  id: 'chill-touch',
  name: 'Chill Touch',
  school: 'necromancy',
  feet: 'touch',
  attack: 'melee',
  dice: '1d10',
  damageType: 'necrotic',
  unmodelled: ['the target cannot regain Hit Points until the end of your next turn'],
});

/**
 * SRD Starry Wisp:
 *
 * > _Evocation Cantrip (Bard, Druid)._ **Casting Time:** Action. **Range:** 60
 * > feet. **Duration:** Instantaneous.
 * > "You launch a mote of light at one creature or object within range. Make a
 * > ranged spell attack against the target. On a hit, the target takes 1d8
 * > Radiant damage, and until the end of your next turn, it emits Dim Light in
 * > a 10-foot radius and can't benefit from the Invisible condition."
 * > _Cantrip Upgrade._ "The damage increases by 1d8 when you reach levels 5
 * > (2d8), 11 (3d8), and 17 (4d8)."
 *
 * The rider is not a condition: it is light, and the *loss* of a benefit the
 * target would otherwise have. `attack.condition` names a `ConditionName`, and
 * neither half of this is one.
 */
export const STARRY_WISP = attackCantrip({
  id: 'starry-wisp',
  name: 'Starry Wisp',
  school: 'evocation',
  feet: 60,
  dice: '1d8',
  damageType: 'radiant',
  unmodelled: [
    'until the end of your next turn the target emits Dim Light in a 10-foot radius and cannot benefit from the Invisible condition',
  ],
});

/**
 * SRD Eldritch Blast:
 *
 * > _Evocation Cantrip (Warlock)._ **Range:** 120 feet.
 * > "Make a ranged spell attack against one creature or object in range. On a
 * > hit, the target takes 1d10 Force damage."
 * > _Cantrip Upgrade._ "The spell creates two beams at level 5, three beams at
 * > level 11, and four beams at level 17."
 *
 * **Not the usual cantrip upgrade.** Every other attack cantrip adds dice to
 * one attack; this one adds *separate attack rolls*, each of which hits or
 * misses on its own and may be aimed at a different creature. So its scaling
 * is deliberately left flat rather than dressed up as extra dice, which would
 * make it hit-or-miss all at once and be worth a different amount.
 */
export const ELDRITCH_BLAST: SpellDefinition = {
  id: 'eldritch-blast',
  name: 'Eldritch Blast',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  effects: [
    { kind: 'attack', attack: 'ranged', damage: { dice: '1d10' }, damageType: 'force' },
  ],
  unmodelled: [
    'the extra beams at levels 5, 11 and 17 \u2014 each is a separate attack roll and may take a different target, which is a shape the engine does not have',
  ],
};

/**
 * SRD Guiding Bolt:
 *
 * > _Level 1 Evocation (Cleric)._ **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** 1 round.
 * > "Make a ranged spell attack against the target. On a hit, it takes 4d6
 * > Radiant damage, and the next attack roll made against it before the end of
 * > your next turn has Advantage."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 1."
 */
export const GUIDING_BOLT: SpellDefinition = {
  id: 'guiding-bolt',
  name: 'Guiding Bolt',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '4d6', perSlotLevelAbove: '1d6' },
      damageType: 'radiant',
    },
  ],
  unmodelled: [
    'the next attack roll against the target before the end of your next turn has Advantage',
  ],
};

/**
 * SRD Ray of Sickness:
 *
 * > _Level 1 Necromancy (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "Make a ranged spell attack against the target. On a hit, the target takes
 * > 2d8 Poison damage and has the Poisoned condition until the end of your
 * > next turn."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 1."
 *
 * The Poisoned condition is a rider on a *hit*, not on a failed save, and the
 * `attack` effect has nowhere to put one. It is named rather than dropped.
 */
export const RAY_OF_SICKNESS: SpellDefinition = {
  id: 'ray-of-sickness',
  name: 'Ray of Sickness',
  level: 1,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '2d8', perSlotLevelAbove: '1d8' },
      damageType: 'poison',
      conditions: [{ name: 'poisoned', lasts: 'end-of-casters-next-turn' }],
    },
  ],
};

/**
 * SRD Acid Splash:
 *
 * > _Evocation Cantrip (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "You create an acidic bubble at a point within range, where it explodes in
 * > a 5-foot-radius Sphere. Each creature in that Sphere must succeed on a
 * > Dexterity saving throw or take 1d6 Acid damage."
 * > _Cantrip Upgrade._ "...increases by 1d6 when you reach levels 5 (2d6), 11
 * > (3d6), and 17 (4d6)."
 *
 * An area cantrip: a Sphere placed at a point, and nothing on a success.
 */
export const ACID_SPLASH: SpellDefinition = {
  id: 'acid-splash',
  name: 'Acid Splash',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 5, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '1d6', cantripUpgradesAt: [5, 11, 17] },
      damageType: 'acid',
      onSuccess: 'none',
    },
  ],
};

// — saving throws that deal damage ————————————————————————————————————————————

/**
 * SRD Blight:
 *
 * > _Level 4 Necromancy (Druid, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Instantaneous.
 * > "A creature that you can see within range makes a Constitution saving
 * > throw, taking 8d8 Necrotic damage on a failed save or half as much damage
 * > on a successful one. A Plant creature automatically fails the save."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 4."
 */
export const BLIGHT: SpellDefinition = {
  id: 'blight',
  name: 'Blight',
  level: 4,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '8d8', perSlotLevelAbove: '1d8' },
      damageType: 'necrotic',
      onSuccess: 'half',
    },
  ],
  unmodelled: [
    'a Plant creature automatically fails the save',
    'the alternative target, a nonmagical plant that is not a creature',
  ],
};

/**
 * SRD Dissonant Whispers:
 *
 * > _Level 1 Enchantment (Bard)._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Instantaneous.
 * > "The target makes a Wisdom saving throw. On a failed save, it takes 3d6
 * > Psychic damage and must immediately use its Reaction, if available, to
 * > move as far away from you as it can, using the safest route. On a
 * > successful save, the target takes half as much damage only."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 1."
 */
export const DISSONANT_WHISPERS: SpellDefinition = {
  id: 'dissonant-whispers',
  name: 'Dissonant Whispers',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'wis',
      damage: { dice: '3d6', perSlotLevelAbove: '1d6' },
      damageType: 'psychic',
      onSuccess: 'half',
    },
  ],
  unmodelled: ['a creature that fails spends its Reaction fleeing as far as it can'],
};

/**
 * SRD Mind Spike:
 *
 * > _Level 2 Divination (Sorcerer, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 1 hour.
 * > "The target makes a Wisdom saving throw, taking 3d8 Psychic damage on a
 * > failed save or half as much damage on a successful one. On a failed save,
 * > you also always know the target's location until the spell ends..."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 2."
 */
export const MIND_SPIKE: SpellDefinition = {
  id: 'mind-spike',
  name: 'Mind Spike',
  level: 2,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'wis',
      damage: { dice: '3d8', perSlotLevelAbove: '1d8' },
      damageType: 'psychic',
      onSuccess: 'half',
    },
  ],
  durationSeconds: 3600,
  unmodelled: [
    'knowing the target\u2019s location for the duration, and its losing the benefit of being hidden or Invisible against you',
  ],
};

/**
 * SRD Harm:
 *
 * > _Level 6 Necromancy (Cleric)._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Instantaneous.
 * > "The target makes a Constitution saving throw. On a failed save, it takes
 * > 14d6 Necrotic damage, and its Hit Point maximum is reduced by an amount
 * > equal to the Necrotic damage it took. On a successful save, it takes half
 * > as much damage only."
 */
export const HARM: SpellDefinition = {
  id: 'harm',
  name: 'Harm',
  level: 6,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '14d6' },
      damageType: 'necrotic',
      onSuccess: 'half',
    },
  ],
  unmodelled: [
    'the Hit Point maximum reduction equal to the damage taken, which cannot take it below 1',
  ],
};

/**
 * SRD Shatter:
 *
 * > _Level 2 Evocation (Bard, Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** 60 feet. **Duration:** Instantaneous.
 * > "Each creature in a 10-foot-radius Sphere centered there makes a
 * > Constitution saving throw, taking 3d8 Thunder damage on a failed save or
 * > half as much damage on a successful one. A Construct has Disadvantage on
 * > the save."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 2."
 */
export const SHATTER: SpellDefinition = {
  id: 'shatter',
  name: 'Shatter',
  level: 2,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 10, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '3d8', perSlotLevelAbove: '1d8' },
      damageType: 'thunder',
      onSuccess: 'half',
    },
  ],
  unmodelled: ['a Construct has Disadvantage on the save'],
};

/**
 * SRD Cone of Cold:
 *
 * > _Level 5 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "Each creature in a 60-foot Cone originating from you makes a Constitution
 * > saving throw, taking 8d8 Cold damage on a failed save or half as much
 * > damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 5."
 */
export const CONE_OF_COLD: SpellDefinition = {
  id: 'cone-of-cold',
  name: 'Cone of Cold',
  level: 5,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'cone', length: 60, origin: 'self' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '8d8', perSlotLevelAbove: '1d8' },
      damageType: 'cold',
      onSuccess: 'half',
    },
  ],
  unmodelled: ['a creature killed by this spell becomes a frozen statue until it thaws'],
};

/**
 * SRD Circle of Death:
 *
 * > _Level 6 Necromancy (Sorcerer, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Instantaneous.
 * > "Negative energy ripples out in a 60-foot-radius Sphere from a point you
 * > choose within range. Each creature in that area makes a Constitution
 * > saving throw, taking 8d8 Necrotic damage on a failed save or half as much
 * > damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 2d8 for each
 * > spell slot level above 6."
 *
 * Note the **2**d8 per level, where most spells add one die. Reading the
 * increase off the base die count would give the wrong number here too.
 */
export const CIRCLE_OF_DEATH: SpellDefinition = {
  id: 'circle-of-death',
  name: 'Circle of Death',
  level: 6,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 60, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '8d8', perSlotLevelAbove: '2d8' },
      damageType: 'necrotic',
      onSuccess: 'half',
    },
  ],
};

/**
 * SRD Chain Lightning:
 *
 * > _Level 6 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Instantaneous.
 * > "You launch a lightning bolt toward a target you can see within range.
 * > Three bolts then leap from that target to as many as three other targets
 * > of your choice, each of which must be within 30 feet of the first target.
 * > A target can be a creature or an object and can be targeted by only one of
 * > the bolts. Each target makes a Dexterity saving throw, taking 10d8
 * > Lightning damage on a failed save or half as much damage on a successful
 * > one."
 * > _Using a Higher-Level Spell Slot._ "One additional bolt leaps from the
 * > first target to another target for each spell slot level above 6."
 *
 * Four named targets rather than an area: every one of them is the caster's
 * choice, which is what makes this a target list and not a Sphere. What the
 * list cannot carry is the geometry *between* the targets — the SRD measures
 * the three later bolts from the first target, and the engine measures every
 * target from the caster.
 */
export const CHAIN_LIGHTNING: SpellDefinition = {
  id: 'chain-lightning',
  name: 'Chain Lightning',
  level: 6,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 4, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '10d8' },
      damageType: 'lightning',
      onSuccess: 'half',
    },
  ],
  unmodelled: [
    'each later bolt must be within 30 feet of the first target: every target is checked against the spell\u2019s own range from the caster instead',
    'only the first target must be seen; sight is required of all four here',
  ],
};

/**
 * SRD Disintegrate:
 *
 * > _Level 6 Transmutation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "A creature targeted by this spell makes a Dexterity saving throw. On a
 * > failed save, the target takes 10d6 + 40 Force damage. If this damage
 * > reduces it to 0 Hit Points, it and everything nonmagical it is wearing and
 * > carrying are disintegrated into gray dust."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 3d6 for each
 * > spell slot level above 6."
 *
 * The flat 40 is why `DiceScaling` carries a `flat`, and the upcast is why it
 * carries the increase as a whole notation: 10d6 growing by **3**d6 is not the
 * base count, and reading the step off the base would more than triple it.

 *
 * `onSuccess: 'none'` is transcribed, not assumed. The SRD gives this spell no
 * success clause at all — unlike Inflict Wounds, which says "half as much" —
 * and defaulting either way rewrites one of the two spells.
 */
export const DISINTEGRATE: SpellDefinition = {
  id: 'disintegrate',
  name: 'Disintegrate',
  level: 6,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '10d6', flat: 40, perSlotLevelAbove: '3d6' },
      damageType: 'force',
      onSuccess: 'none',
    },
  ],
  unmodelled: [
    'a target the damage reduces to 0 Hit Points is disintegrated to dust with everything nonmagical it carries, and can then be revived only by True Resurrection or Wish',
    'the automatic disintegration of a Large or smaller nonmagical object or creation of magical force, and of a 10-foot-Cube portion of a larger one',
  ],
};

/**
 * SRD Befuddlement:
 *
 * > _Level 8 Enchantment (Bard, Druid, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** 150 feet. **Duration:** Instantaneous.
 * > "You blast the mind of a creature that you can see within range. The
 * > target makes an Intelligence saving throw. On a failed save, the target
 * > takes 10d12 Psychic damage and can't cast spells or take the Magic action.
 * > At the end of every 30 days, the target repeats the save, ending the
 * > effect on a success. On a successful save, the target takes half as much
 * > damage only."
 */
export const BEFUDDLEMENT: SpellDefinition = {
  id: 'befuddlement',
  name: 'Befuddlement',
  level: 8,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'int',
      damage: { dice: '10d12' },
      damageType: 'psychic',
      onSuccess: 'half',
    },
  ],
  unmodelled: [
    'the failed save also stops the target casting spells or taking the Magic action, which is not a condition the engine names',
    'the save the target repeats at the end of every 30 days, and the Greater Restoration, Heal or Wish that would end it sooner',
  ],
};

/**
 * SRD Contagion:
 *
 * > _Level 5 Necromancy (Cleric, Druid)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** 7 days.
 * > "The target must succeed on a Constitution saving throw or take 11d8
 * > Necrotic damage and have the Poisoned condition. Also, choose one ability
 * > when you cast the spell. While Poisoned, the target has Disadvantage on
 * > saving throws made with the chosen ability."
 *
 * Damage and a condition off one save, which is the shape `condition` exists
 * for. The seven days are the *failed* branch of a mechanic the engine cannot
 * run — three successes end it, three failures fix it — so the definition
 * takes the branch the SRD prints as the duration and says which one it took.
 */
export const CONTAGION: SpellDefinition = {
  id: 'contagion',
  name: 'Contagion',
  level: 5,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '11d8' },
      damageType: 'necrotic',
      onSuccess: 'none',
      conditions: [{ name: 'poisoned' }],
    },
  ],
  durationSeconds: 604800,
  unmodelled: [
    'the ability chosen at the cast, on which the Poisoned target then has Disadvantage on saving throws',
    'the save repeated at the end of each of the target\u2019s turns until three successes end the spell or three failures fix it for the 7 days assumed here',
    'the Constitution save the target makes before any effect can end the Poisoned condition on it',
  ],
};

/**
 * SRD Freezing Sphere:
 *
 * > _Level 6 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 300 feet. **Duration:** Instantaneous.
 * > "A frigid globe streaks from you to a point of your choice within range,
 * > where it explodes in a 60-foot-radius Sphere. Each creature in that area
 * > makes a Constitution saving throw, taking 10d6 Cold damage on failed save
 * > or half as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 6."
 */
export const FREEZING_SPHERE: SpellDefinition = {
  id: 'freezing-sphere',
  name: 'Freezing Sphere',
  level: 6,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 300 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 60, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '10d6', perSlotLevelAbove: '1d6' },
      damageType: 'cold',
      onSuccess: 'half',
    },
  ],
  unmodelled: [
    'freezing a body of water to a depth of 6 inches, and the Restrained condition on creatures swimming there',
    'holding the globe back rather than firing it, to be thrown or slung later or to explode on its own after 1 minute',
  ],
};

/**
 * SRD Sunburst:
 *
 * > _Level 8 Evocation (Cleric, Druid, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 150 feet. **Duration:** Instantaneous.
 * > "Brilliant sunlight flashes in a 60-foot-radius Sphere centered on a point
 * > you choose within range. Each creature in the Sphere makes a Constitution
 * > saving throw. On a failed save, a creature takes 12d6 Radiant damage and
 * > has the Blinded condition for 1 minute. On a successful save, it takes
 * > half as much damage only."
 *
 * > "A creature Blinded by this spell makes another Constitution saving throw
 * > at the end of each of its turns, ending the effect on itself on a
 * > success."
 *
 * **The rider outlives the casting and is still the casting's**, which is the
 * pair of facts that needed a third `RiderDuration` member. The spell is
 * Instantaneous, so there is no casting deadline to borrow and no ongoing
 * record for a Dispel Magic to find; the Blinded runs its minute on the clock,
 * alone. `durationSeconds: 60` on the definition was the tempting answer and
 * the wrong one — it would make a flash of light a dispellable ongoing spell.
 *
 * **And "another Constitution saving throw" is the one this spell already
 * asked for**, which is why `repeats` names no ability: the host rolled it,
 * and a rider restating it would be a second place to get one sentence wrong.
 * "Ending the effect **on itself**" is `end-on-target`: one creature blinks
 * the glare away and everybody else in the Sphere is still blind.
 */
export const SUNBURST: SpellDefinition = {
  id: 'sunburst',
  name: 'Sunburst',
  level: 8,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 60, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '12d6' },
      damageType: 'radiant',
      onSuccess: 'half',
      conditions: [
        {
          name: 'blinded',
          lasts: { seconds: 60 },
          repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
        },
      ],
    },
  ],
  unmodelled: ['dispelling magical Darkness in the area'],
};

/**
 * SRD Insect Plague:
 *
 * > _Level 5 Conjuration (Cleric, Druid, Sorcerer)._ **Casting Time:** Action.
 * > **Range:** 300 feet. **Duration:** Concentration, up to 10 minutes.
 * > "Swarming locusts fill a 20-foot-radius Sphere centered on a point you
 * > choose within range... When the swarm appears, each creature in it makes a
 * > Constitution saving throw, taking 4d10 Piercing damage on a failed save or
 * > half as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d10 for each
 * > spell slot level above 5."
 *
 * The save when the swarm *appears* is the half that resolves at the cast. The
 * rest of this spell is an area that keeps acting, which is the shape nothing
 * in the engine has yet.
 */
export const INSECT_PLAGUE: SpellDefinition = {
  id: 'insect-plague',
  name: 'Insect Plague',
  level: 5,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 300 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '4d10', perSlotLevelAbove: '1d10' },
      damageType: 'piercing',
      onSuccess: 'half',
    },
  ],
  durationSeconds: 600,
  // "A creature also makes this save when it enters the spell's area for the
  // first time on a turn or ends its turn there. A creature makes this save
  // only once per turn." The cap is on the *creature*, so entering and then
  // ending the turn in the swarm is one save, not two.
  areaTrigger: {
    at: 'end-of-turn',
    onEntry: 'first-per-turn',
    oncePerTurn: true,
    label: 'Insect Plague (the swarm)',
    effects: [
      {
        kind: 'save-damage',
        ability: 'con',
        damage: { dice: '4d10', perSlotLevelAbove: '1d10' },
        damageType: 'piercing',
        onSuccess: 'half',
      },
    ],
  },
  unmodelled: [
    'the Sphere remains for the duration, its area Lightly Obscured and Difficult Terrain',
  ],
};

/**
 * SRD Cloudkill:
 *
 * > _Level 5 Conjuration (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 10 minutes.
 * > "You create a 20-foot-radius Sphere of yellow-green fog centered on a
 * > point within range... Each creature in the Sphere makes a Constitution
 * > saving throw, taking 5d8 Poison damage on a failed save or half as much
 * > damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 5."
 *
 * Insect Plague's shape with a fog that walks: the cloud moves 10 feet away
 * from the caster every turn, which is an area whose *position* changes on a
 * later turn rather than one that merely persists.
 */
export const CLOUDKILL: SpellDefinition = {
  id: 'cloudkill',
  name: 'Cloudkill',
  level: 5,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '5d8', perSlotLevelAbove: '1d8' },
      damageType: 'poison',
      onSuccess: 'half',
    },
  ],
  durationSeconds: 600,
  unmodelled: [
    'the fog lasts for the duration and its area is Heavily Obscured',
    'the same save again when the Sphere moves into a creature\u2019s space, or when it enters the Sphere or ends its turn there, once per turn',
    'the Sphere moving 10 feet away from you at the start of each of your turns',
    'strong wind disperses the fog and ends the spell',
  ],
};

/**
 * SRD Incendiary Cloud:
 *
 * > _Level 8 Conjuration (Druid, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Concentration, up to 1 minute.
 * > "A swirling cloud of embers and smoke fills a 20-foot-radius Sphere
 * > centered on a point within range... When the cloud appears, each creature
 * > in it makes a Dexterity saving throw, taking 10d8 Fire damage on a failed
 * > save or half as much damage on a successful one."
 *
 * Cloudkill's shape at eight levels higher, down to the cloud that walks: the
 * save when it appears is the half that resolves at the cast, and an area
 * whose position changes on a later turn is the shape nothing here has yet.
 */
export const INCENDIARY_CLOUD: SpellDefinition = {
  id: 'incendiary-cloud',
  name: 'Incendiary Cloud',
  level: 8,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '10d8' },
      damageType: 'fire',
      onSuccess: 'half',
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the cloud lasts for the duration and its area is Heavily Obscured',
    'the same save again when the Sphere moves into a creature\u2019s space, or when it enters the Sphere or ends its turn there, once per turn',
    'the cloud moving 10 feet away from you, in a direction you choose, at the start of each of your turns',
    'a strong wind disperses the cloud and ends the spell',
  ],
};

/**
 * SRD Moonbeam:
 *
 * > _Level 2 Evocation (Druid)._ **Casting Time:** Action. **Range:** 120
 * > feet. **Duration:** Concentration, up to 1 minute.
 * > "A silvery beam of pale light shines down in a 5-foot-radius, 40-foot-high
 * > Cylinder centered on a point within range. Until the spell ends, Dim Light
 * > fills the Cylinder, and you can take a Magic action on later turns to move
 * > the Cylinder up to 60 feet."
 * > "When the Cylinder appears, each creature in it makes a Constitution
 * > saving throw. On a failed save, a creature takes 2d10 Radiant damage, and
 * > if the creature is shape-shifted ... it reverts to its true form and can't
 * > shape-shift until it leaves the Cylinder. On a successful save, a creature
 * > takes half as much damage only. A creature also makes this save **when the
 * > spell's area moves into its space** and when it enters the spell's area or
 * > ends its turn there. A creature makes this save only once per turn."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d10 for each
 * > spell slot level above 2."
 *
 * **The spell that proves an area can arrive at a creature standing still.**
 * Every other persistent area in the catalogue is conjured somewhere and stays
 * there, so membership changed only when a creature changed its position.
 * Moonbeam prints three trigger clauses in one sentence and the first of them
 * is the beam's own motion — see {@link AreaTrigger.onAreaEntry}.
 *
 * Four sentences, four fields, and none of them invented:
 *
 * | SRD | Where |
 * |---|---|
 * | "a 5-foot-radius, 40-foot-high Cylinder centered on a point" | `area` |
 * | "within range" — 120 feet, measured from the caster at the cast | `range` |
 * | "take a Magic action ... to move the Cylinder up to 60 feet" | `activation.movesArea` |
 * | "when the spell's area moves into its space" | `areaTrigger.onAreaEntry` |
 *
 * **The 120 feet is not the allowance.** Range governs where the beam may
 * first be put down; the 60 feet governs how far it travels afterwards, from
 * wherever it now is. A beam walked steadily away ends up further from its
 * caster than the spell's Range, which is what the two separate sentences say.
 *
 * `onEntry: 'every-entry'` is the text and not a shortcut: Moonbeam writes
 * "when it enters the spell's area" with no "for the first time on a turn",
 * unlike Insect Plague. The cap that makes the two behave alike is the
 * separate "only once per turn" sentence, which is a cap on the *creature*
 * across all three clauses.
 */
export const MOONBEAM: SpellDefinition = {
  id: 'moonbeam',
  name: 'Moonbeam',
  level: 2,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  area: { kind: 'cylinder', radius: 5, height: 40, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '2d10', perSlotLevelAbove: '1d10' },
      damageType: 'radiant',
      onSuccess: 'half',
    },
  ],
  durationSeconds: 60,
  // "A creature also makes this save when the spell's area moves into its
  // space and when it enters the spell's area or ends its turn there. A
  // creature makes this save only once per turn." Three clauses, one save, one
  // cap on the creature that spans all three.
  areaTrigger: {
    at: 'end-of-turn',
    onEntry: 'every-entry',
    onAreaEntry: true,
    oncePerTurn: true,
    label: 'Moonbeam (the beam)',
    effects: [
      {
        kind: 'save-damage',
        ability: 'con',
        damage: { dice: '2d10', perSlotLevelAbove: '1d10' },
        damageType: 'radiant',
        onSuccess: 'half',
      },
    ],
  },
  // "you can take a Magic action on later turns to move the Cylinder up to 60
  // feet." The action's entire content, which is why it carries no effects and
  // aims at nobody.
  activation: {
    action: 'action',
    movesArea: 60,
    label: 'Moonbeam (the beam moves)',
    effects: [],
  },
  unmodelled: [
    'the Dim Light that fills the Cylinder for the duration; light is not modelled',
    'a shape-shifted creature reverting to its true form on a failed save, and being unable to shape-shift until it leaves the Cylinder: shape-shifting is not modelled',
  ],
};

/**
 * SRD Black Tentacles:
 *
 * > _Level 4 Conjuration (Wizard)._ **Casting Time:** Action. **Range:** 90
 * > feet. **Duration:** Concentration, up to 1 minute.
 * > "Squirming, ebony tentacles fill a 20-foot square on ground that you can
 * > see within range... Each creature in that area makes a Strength saving
 * > throw. On a failed save, it takes 3d6 Bludgeoning damage, and it has the
 * > Restrained condition until the spell ends."
 *
 * A 20-foot square is modelled as a Cube, the same reading Grease's 10-foot
 * square already takes: the lattice has no 2D shape, and the SRD's squares on
 * the ground are the footprint of one.
 *
 * `onSuccess: 'none'` is the text, not a default — "On a failed save, it
 * takes..." gives a successful save nothing to take.
 */
export const BLACK_TENTACLES: SpellDefinition = {
  id: 'black-tentacles',
  name: 'Black Tentacles',
  level: 4,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 0 },
  area: { kind: 'cube', size: 20, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'str',
      damage: { dice: '3d6' },
      damageType: 'bludgeoning',
      onSuccess: 'none',
      conditions: [
        {
          name: 'restrained',
          // SRD: "A Restrained creature can take an action to make a Strength
          // (Athletics) check against your spell save DC, ending the condition
          // on itself on a success." On itself: the tentacles carry on for
          // everybody else standing in them, which is what `end-on-target`
          // means.
          check: { ability: 'str', skill: 'athletics', onSuccess: 'end-on-target' },
        },
      ],
    },
  ],
  durationSeconds: 60,
  // "A creature also makes that save if it enters the area or ends it turn
  // there. A creature makes that save only once per turn."
  areaTrigger: {
    at: 'end-of-turn',
    onEntry: 'every-entry',
    oncePerTurn: true,
    label: 'Black Tentacles (the tentacles)',
    effects: [
      {
        kind: 'save-damage',
        ability: 'str',
        damage: { dice: '3d6' },
        damageType: 'bludgeoning',
        onSuccess: 'none',
        conditions: [
          {
            name: 'restrained',
            check: { ability: 'str', skill: 'athletics', onSuccess: 'end-on-target' },
          },
        ],
      },
    ],
  },
  unmodelled: ['the area is Difficult Terrain for the duration'],
};

/**
 * SRD Phantasmal Killer:
 *
 * > _Level 4 Illusion (Bard, Wizard)._ **Casting Time:** Action. **Range:**
 * > 120 feet. **Duration:** Concentration, up to 1 minute.
 * > "The target makes a Wisdom saving throw. On a failed save, the target
 * > takes 4d10 Psychic damage and has Disadvantage on ability checks and
 * > attack rolls for the duration. On a successful save, the target takes half
 * > as much damage, and the spell ends."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d10 for each
 * > spell slot level above 4."
 *
 * The opening save is the half the engine resolves. The rest is an effect a
 * later turn acts *through* — a save each turn that deals the damage again —
 * which is the shape that blocks eighteen SRD spells and is not built.
 */
export const PHANTASMAL_KILLER: SpellDefinition = {
  id: 'phantasmal-killer',
  name: 'Phantasmal Killer',
  level: 4,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'wis',
      damage: { dice: '4d10', perSlotLevelAbove: '1d10' },
      damageType: 'psychic',
      onSuccess: 'half',
      // "On a failed save, the target takes 4d10 Psychic damage **and has
      // Disadvantage on ability checks and attack rolls** for the duration."
      // One save, two consequences — and two `roll-mode` effects beside the
      // damage would roll two saves for the same failure, so a target could
      // fail one and make the other, which is not the spell.
      //
      // **Two riders rather than one**, because they are two sentences of the
      // selector's vocabulary: a `RollModifier` names one family of roll, and
      // "ability checks and attack rolls" is two. Neither narrows by ability
      // or skill, which is what "ability checks" with nothing after it means.
      //
      // "For the duration" is the casting's, which is exactly and only what a
      // modifier rider can say: nothing ends a grant before its casting does.
      modifiers: [
        {
          kind: 'mode',
          modifier: {
            mode: 'disadvantage',
            selector: { roll: 'ability-check', relation: 'roller' },
          },
        },
        {
          kind: 'mode',
          modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } },
        },
      ],
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the Wisdom save at the end of each of the target\u2019s turns, which deals the Psychic damage again on a failure',
    'a successful save ends the spell, where the engine leaves the Concentration running',
  ],
};

// — saving throws that impose a condition ————————————————————————————————————

/**
 * SRD Hideous Laughter:
 *
 * > _Level 1 Enchantment (Bard, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Concentration, up to 1 minute.
 * > "One creature of your choice that you can see within range makes a Wisdom
 * > saving throw. On a failed save, it has the Prone and Incapacitated
 * > conditions for the duration."
 * > "At the end of each of its turns and each time it takes damage, it makes
 * > another Wisdom saving throw. The target has Advantage on the save if the
 * > save is triggered by damage. On a successful save, the spell ends."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 *
 * **The spell that makes `conditions` plural.** "The Prone **and**
 * Incapacitated conditions" is one Wisdom saving throw with two consequences,
 * and writing it as two `save` effects would roll two — a creature could then
 * fail one and make the other, which is not the spell. Exactly the argument
 * `plus` makes for a second damage type, on the second thing a failed save can
 * impose.
 *
 * **Both are the casting's, so neither `outlivesCasting`s.** SRD Grease's
 * Prone is the opposite case and is the reason that field exists: there it is
 * "or have the Prone condition", full stop, and Prone is the creature's own to
 * stand up from. Here it is "for the duration" and the spell goes further —
 * "it can't end the Prone condition on itself" — so the Laughter owns it, ends
 * it, and a Dispel Magic aimed at the target finds the spell that put them
 * there.
 *
 * The repeat save stays flat: SRD writes "it makes another Wisdom saving
 * throw" once, about the spell, not once per condition — and "the spell ends"
 * is `end-casting`, so the success lifts both without either rider naming the
 * other.
 */
export const HIDEOUS_LAUGHTER: SpellDefinition = {
  id: 'hideous-laughter',
  name: 'Hideous Laughter',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'prone',
      conditions: [{ name: 'incapacitated' }],
      repeats: { at: 'end-of-turn', onSuccess: 'end-casting' },
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the second Wisdom save each time the target takes damage, which is made with Advantage',
    'the target being unable to end the Prone condition on itself, so it may stand up while the spell runs',
    'laughing uncontrollably, and whether the creature is capable of laughter at all',
  ],
};

/**
 * SRD Hold Monster:
 *
 * > _Level 5 Enchantment (Bard, Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** 90 feet. **Duration:** Concentration, up to 1 minute.
 * > "Choose a creature that you can see within range. The target must succeed
 * > on a Wisdom saving throw or have the Paralyzed condition for the duration.
 * > At the end of each of its turns, the target repeats the save, ending the
 * > spell on itself on a success."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 5."
 *
 * Hold Person with the Humanoid restriction lifted, which is the whole
 * difference between the two spells and the reason the type check is data.
 */
export const HOLD_MONSTER: SpellDefinition = {
  id: 'hold-monster',
  name: 'Hold Monster',
  level: 5,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'paralyzed',
      repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
    },
  ],
  durationSeconds: 60,
};

/**
 * SRD Blindness/Deafness:
 *
 * > _Level 2 Transmutation (Bard, Cleric, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 120 feet. **Duration:** 1 minute.
 * > "One creature that you can see within range must succeed on a Constitution
 * > saving throw, or it has the Blinded or Deafened condition (your choice)
 * > for the duration. At the end of each of its turns, the target repeats the
 * > save, ending the spell on itself on a success."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 2."
 *
 * **One minute and no Concentration**, which is the point of having it here:
 * it exercises a duration that runs on the clock rather than on a caster's
 * attention. The caster's choice between the two conditions is not offered —
 * a per-casting choice needs somewhere to be recorded, and inventing a default
 * would silently pick Blinded every time. It picks Blinded and says so.
 */
export const BLINDNESS_DEAFNESS: SpellDefinition = {
  id: 'blindness-deafness',
  name: 'Blindness/Deafness',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save',
      ability: 'con',
      condition: 'blinded',
      repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
    },
  ],
  durationSeconds: 60,
  unmodelled: ['the caster\u2019s choice of Deafened instead of Blinded'],
};

/**
 * SRD Charm Person:
 *
 * > _Level 1 Enchantment (Bard, Druid, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 30 feet. **Duration:** 1 hour.
 * > "One Humanoid you can see within range makes a Wisdom saving throw. It
 * > does so with Advantage if you or your allies are fighting it. On a failed
 * > save, the target has the Charmed condition until the spell ends or until
 * > you or your allies damage it."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 */
export const CHARM_PERSON: SpellDefinition = {
  id: 'charm-person',
  name: 'Charm Person',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, extraPerSlotLevelAbove: 1, mustBeType: 'Humanoid' },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', condition: 'charmed' }],
  durationSeconds: 3600,
  unmodelled: [
    'the save has Advantage if you or your allies are fighting the target',
    'the spell ends early if you or your allies damage the target',
  ],
};

/**
 * SRD Fear:
 *
 * > _Level 3 Illusion (Bard, Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** Self. **Duration:** Concentration, up to 1 minute.
 * > "Each creature in a 30-foot Cone must succeed on a Wisdom saving throw or
 * > drop whatever it is holding and have the Frightened condition for the
 * > duration."
 */
export const FEAR: SpellDefinition = {
  id: 'fear',
  name: 'Fear',
  level: 3,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'cone', length: 30, origin: 'self' },
  effects: [{ kind: 'save', ability: 'wis', condition: 'frightened' }],
  durationSeconds: 60,
  unmodelled: [
    'a creature that fails drops whatever it is holding',
    'a Frightened creature Dashes away from you each turn, and saves again when it ends its turn out of your line of sight',
  ],
};

/**
 * SRD Hypnotic Pattern:
 *
 * > _Level 3 Illusion (Bard, Druid, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** Concentration, up to 1 minute.
 * > "Each creature in the area who can see the pattern must succeed on a
 * > Wisdom saving throw or have the Charmed condition for the duration. While
 * > Charmed, the creature has the Incapacitated condition and a Speed of 0."
 */
export const HYPNOTIC_PATTERN: SpellDefinition = {
  id: 'hypnotic-pattern',
  name: 'Hypnotic Pattern',
  level: 3,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  area: { kind: 'cube', size: 30, origin: 'point' },
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'charmed',
      // "While Charmed, the creature has the Incapacitated condition and a
      // Speed of 0." One Wisdom save, and the Incapacitated is not a second
      // roll — a second `save` effect would ask for one, and a creature could
      // then be Charmed and not Incapacitated, which the spell does not
      // permit. The Speed is a rule the engine does not hold at all and says
      // so below.
      conditions: [{ name: 'incapacitated' }],
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'only a creature that can see the pattern is affected',
    'the Speed of 0 that rides along with the Charm',
    'the spell ending for a creature that takes damage or is shaken out of it',
  ],
};

/**
 * SRD Banishment:
 *
 * > _Level 4 Abjuration (Cleric, Paladin, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 30 feet.
 * > **Duration:** Concentration, up to 1 minute.
 * > "One creature that you can see within range must succeed on a Charisma
 * > saving throw or be transported to a harmless demiplane for the duration.
 * > While there, the target has the Incapacitated condition."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 4."
 */
export const BANISHMENT: SpellDefinition = {
  id: 'banishment',
  name: 'Banishment',
  level: 4,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'cha', condition: 'incapacitated' }],
  durationSeconds: 60,
  unmodelled: [
    'the target leaving the battlefield for a demiplane, so it is Incapacitated where it stands rather than gone',
    'an Aberration, Celestial, Elemental, Fey or Fiend not returning if the spell runs its full minute',
  ],
};

/**
 * SRD Suggestion:
 *
 * > _Level 2 Enchantment (Bard, Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** 30 feet. **Duration:** Concentration, up to 8 hours.
 * > "You suggest a course of activity\u2014described in no more than 25 words\u2014to
 * > one creature you can see within range that can hear and understand you...
 * > The target must succeed on a Wisdom saving throw or have the Charmed
 * > condition for the duration or until you or your allies deal damage to the
 * > target. The Charmed target pursues the suggestion to the best of its
 * > ability."
 *
 * The save and the Charmed condition are arithmetic; the suggestion is not.
 * Whether "fetch the key and give it to me" is achievable, and whether it
 * obviously harms the target, is a judgement the SRD hands the table, so the
 * engine spends the slot, runs the eight hours, and says so.
 */
export const SUGGESTION: SpellDefinition = {
  id: 'suggestion',
  name: 'Suggestion',
  level: 2,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', condition: 'charmed' }],
  durationSeconds: 28800,
  unmodelled: [
    'the course of activity you suggest, whether it sounds achievable, and whether the target pursues or completes it',
    'the spell ends early when you or your allies deal damage to the target, or when the suggested activity is completed',
    'the target must be able to hear and understand you',
  ],
};

/**
 * A Dominate spell: a save, the Charmed condition, and a link to command them.
 *
 * SRD prints Dominate Beast and Dominate Person as the same paragraph with the
 * creature type and the slot levels changed, so they are built from one
 * function rather than transcribed twice. Every field still comes from the SRD
 * line quoted at the call site.
 *
 * What none of them can carry is the repeat: "whenever the target takes
 * damage, it repeats the save". `repeats` fires at a **turn boundary**, which
 * is when Hold Person's save comes round; damage is a trigger, and an effect
 * that hangs on one needs machinery the engine does not have.
 */
function dominate(args: {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /** Omitted by Dominate Monster, which takes anything at all. */
  readonly creatureType?: string;
  readonly durationSeconds: number;
  /** How the SRD lengthens the Concentration with a bigger slot, verbatim. */
  readonly longer: string;
}): SpellDefinition {
  return {
    id: args.id,
    name: args.name,
    level: args.level,
    school: 'enchantment',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'ranged', feet: 60 },
    targets: {
      count: 1,
      ...(args.creatureType === undefined ? {} : { mustBeType: args.creatureType }),
    },
    requiresSight: true,
    effects: [{ kind: 'save', ability: 'wis', condition: 'charmed' }],
    durationSeconds: args.durationSeconds,
    unmodelled: [
      'the save has Advantage if you or your allies are fighting the target',
      'the target repeats the save whenever it takes damage, which is a trigger rather than a turn boundary',
      'the telepathic link that issues commands, and spending your own Reaction to command one of the target\u2019s',
      `a higher-level slot lengthens the Concentration: ${args.longer}`,
    ],
  };
}

/**
 * SRD Dominate Beast:
 *
 * > _Level 4 Enchantment (Druid, Ranger, Sorcerer)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "One Beast you can see within range must succeed on a Wisdom saving throw
 * > or have the Charmed condition for the duration."
 * > _Using a Higher-Level Spell Slot._ "Your Concentration can last longer
 * > with a spell slot of level 5 (up to 10 minutes), 6 (up to 1 hour), or 7+
 * > (up to 8 hours)."
 */
export const DOMINATE_BEAST = dominate({
  id: 'dominate-beast',
  name: 'Dominate Beast',
  level: 4,
  creatureType: 'Beast',
  durationSeconds: 60,
  longer: '10 minutes at level 5, 1 hour at 6, 8 hours at 7 and above',
});

/**
 * SRD Dominate Person:
 *
 * > _Level 5 Enchantment (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "One Humanoid you can see within range must succeed on a Wisdom saving
 * > throw or have the Charmed condition for the duration."
 * > _Using a Higher-Level Spell Slot._ "Your Concentration can last longer
 * > with a spell slot of level 6 (up to 10 minutes), 7 (up to 1 hour), or 8+
 * > (up to 8 hours)."
 */
export const DOMINATE_PERSON = dominate({
  id: 'dominate-person',
  name: 'Dominate Person',
  level: 5,
  creatureType: 'Humanoid',
  durationSeconds: 60,
  longer: '10 minutes at level 6, 1 hour at 7, 8 hours at 8 and above',
});

/**
 * SRD Dominate Monster:
 *
 * > _Level 8 Enchantment (Bard, Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** 60 feet. **Duration:** Concentration, up to 1 hour.
 * > "One creature you can see within range must succeed on a Wisdom saving
 * > throw or have the Charmed condition for the duration."
 * > _Using a Higher-Level Spell Slot._ "Your Concentration can last longer
 * > with a level 9 spell slot (up to 8 hours)."
 *
 * The same paragraph again with the creature type lifted — the difference
 * between Hold Person and Hold Monster, made the same way and for the same
 * reason: the restriction is data, not a separate spell.
 */
export const DOMINATE_MONSTER = dominate({
  id: 'dominate-monster',
  name: 'Dominate Monster',
  level: 8,
  durationSeconds: 3600,
  longer: '8 hours with a level 9 slot',
});

/**
 * SRD Mass Suggestion:
 *
 * > _Level 6 Enchantment (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** 24 hours.
 * > "You suggest a course of activity\u2014described in no more than 25 words\u2014to
 * > twelve or fewer creatures you can see within range that can hear and
 * > understand you... Each target must succeed on a Wisdom saving throw or
 * > have the Charmed condition for the duration or until you or your allies
 * > deal damage to the target."
 * > _Using a Higher-Level Spell Slot._ "The duration is longer with a spell
 * > slot of level 7 (10 days), 8 (30 days), or 9 (366 days)."
 *
 * Suggestion for twelve, and **without Concentration** — a full day running
 * on the clock rather than on the caster's attention, which is the difference
 * a bigger slot buys and the reason the two are separate spells.
 */
export const MASS_SUGGESTION: SpellDefinition = {
  id: 'mass-suggestion',
  name: 'Mass Suggestion',
  level: 6,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 12 },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', condition: 'charmed' }],
  durationSeconds: 86400,
  unmodelled: [
    'the course of activity you suggest, whether it sounds achievable, and whether a target pursues or completes it',
    'the spell ends on a target when you or your allies deal it damage, or when it completes the suggested activity',
    'the targets must be able to hear and understand you',
    'a higher-level slot lengthens the duration: 10 days at level 7, 30 days at 8, 366 days at 9',
  ],
};

/**
 * SRD Compulsion:
 *
 * > _Level 4 Enchantment (Bard)._ **Casting Time:** Action. **Range:** 30
 * > feet. **Duration:** Concentration, up to 1 minute.
 * > "Each creature of your choice that you can see within range must succeed
 * > on a Wisdom saving throw or have the Charmed condition until the spell
 * > ends."
 *
 * The first spell here whose target list the SRD gives no number — see
 * `TargetRule.unlimited`. Range and sight are the bound, and both are checked
 * against every name the caller gives.
 */
export const COMPULSION: SpellDefinition = {
  id: 'compulsion',
  name: 'Compulsion',
  level: 4,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0, unlimited: true },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', condition: 'charmed' }],
  durationSeconds: 60,
  unmodelled: [
    'the Bonus Action that designates a direction, and the movement each Charmed target must spend going that way',
    'the save a target repeats after moving, which ends the spell on itself on a success',
  ],
};

/**
 * SRD Weird:
 *
 * > _Level 9 Illusion (Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Concentration, up to 1 minute.
 * > "Each creature of your choice in a 30-foot-radius Sphere centered on a
 * > point within range makes a Wisdom saving throw. On a failed save, a target
 * > takes 10d10 Psychic damage and has the Frightened condition for the
 * > duration. On a successful save, a target takes half as much damage only."
 *
 * Both of the new shapes at once, which is why it is worth having: the Sphere
 * bounds who may be chosen (`targetsWithin`) and the SRD names no number of
 * them (`unlimited`). Reading it as a plain area would terrify the caster's
 * own party, standing in the same Sphere.
 */
export const WEIRD: SpellDefinition = {
  id: 'weird',
  name: 'Weird',
  level: 9,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0, unlimited: true },
  targetsWithin: { kind: 'sphere', radius: 30, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'wis',
      damage: { dice: '10d10' },
      damageType: 'psychic',
      onSuccess: 'half',
      conditions: [{ name: 'frightened' }],
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the Wisdom save a Frightened target makes at the end of each of its turns, which deals 5d10 Psychic damage again on a failure and ends the spell on that target on a success',
  ],
};

// — bonuses that later rolls read, and Temporary Hit Points ———————————————————

/**
 * SRD Bless:
 *
 * > _Level 1 Enchantment (Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Concentration, up to 1 minute.
 * > "You bless up to three creatures within range. Whenever a target makes an
 * > attack roll or a saving throw before the spell ends, the target adds 1d4
 * > to the attack roll or save."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 *
 * No saving throw: you bless your friends and they do not resist.
 */
export const BLESS: SpellDefinition = {
  id: 'bless',
  name: 'Bless',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 3, extraPerSlotLevelAbove: 1, self: true },
  effects: [
    {
      kind: 'buff',
      bonus: { source: 'Bless', dice: '1d4' },
      applies: ['attack', 'save'],
      direction: 'add',
    },
  ],
  durationSeconds: 60,
};

/**
 * SRD Bane:
 *
 * > _Level 1 Enchantment (Bard, Cleric, Warlock)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Concentration, up to 1 minute.
 * > "Up to three creatures of your choice that you can see within range must
 * > each make a Charisma saving throw. Whenever a target that fails this save
 * > makes an attack roll or a saving throw before the spell ends, the target
 * > must subtract 1d4 from the attack roll or save."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 *
 * Bless with a minus sign and a save in front of it, which is exactly how the
 * effect type models it.
 */
export const BANE: SpellDefinition = {
  id: 'bane',
  name: 'Bane',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 3, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'buff',
      ability: 'cha',
      bonus: { source: 'Bane', dice: '1d4' },
      applies: ['attack', 'save'],
      direction: 'subtract',
    },
  ],
  durationSeconds: 60,
};

/**
 * SRD Guidance:
 *
 * > _Divination Cantrip (Cleric, Druid)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Concentration, up to 1 minute.
 * > "You touch a willing creature and choose a skill. Until the spell ends,
 * > the creature adds 1d4 to any ability check using the chosen skill."
 *
 * The 2024 wording narrowed this: it is one *chosen skill*, not any check.
 * Choosing which skill needs somewhere to record a per-casting choice, so the
 * bonus is hung on ability checks generally and the narrowing is declared
 * rather than silently applied to everything.
 */
export const GUIDANCE: SpellDefinition = {
  id: 'guidance',
  name: 'Guidance',
  level: 0,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'buff',
      bonus: { source: 'Guidance', dice: '1d4' },
      applies: ['ability-check'],
      direction: 'add',
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the bonus applies to any ability check rather than only the one chosen skill, because a per-casting choice has nowhere to be recorded',
  ],
};

/**
 * SRD False Life:
 *
 * > _Level 1 Necromancy (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "You gain 2d4 + 4 Temporary Hit Points."
 * > _Using a Higher-Level Spell Slot._ "You gain 5 additional Temporary Hit
 * > Points for each spell slot level above 1."
 *
 * The spell the flat half of `DiceScaling` exists for: a printed `+ 4`, and an
 * upcast that adds five flat and no dice at all.
 */
export const FALSE_LIFE: SpellDefinition = {
  id: 'false-life',
  name: 'False Life',
  level: 1,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'temp-hp',
      amount: { dice: '2d4', flat: 4, flatPerSlotLevelAbove: 5 },
      addSpellcastingModifier: false,
    },
  ],
};

/**
 * SRD Flame Strike:
 *
 * > _Level 5 Evocation (Cleric)._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Instantaneous.
 * > "Each creature in a 10-foot-radius, 40-foot-high Cylinder centered on a
 * > point within range makes a Dexterity saving throw, taking 5d6 Fire damage
 * > and 5d6 Radiant damage on a failed save or half as much damage on a
 * > successful one."
 * > _Using a Higher-Level Spell Slot._ "The Fire damage and the Radiant damage
 * > increase by 1d6 for each spell slot level above 5."
 *
 * **One save, two damage types** — the spell the `plus` field exists for. Two
 * separate effects would roll two saves and let a target fail one and make the
 * other, which is not this spell. Both halves scale, and a creature resistant
 * to Fire alone still takes the Radiant in full.
 */
export const FLAME_STRIKE: SpellDefinition = {
  id: 'flame-strike',
  name: 'Flame Strike',
  level: 5,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'cylinder', radius: 10, height: 40, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '5d6', perSlotLevelAbove: '1d6' },
      damageType: 'fire',
      onSuccess: 'half',
      plus: [{ damage: { dice: '5d6', perSlotLevelAbove: '1d6' }, damageType: 'radiant' }],
    },
  ],
};

/**
 * SRD Ice Storm:
 *
 * > _Level 4 Evocation (Druid, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 300 feet. **Duration:** Instantaneous.
 * > "Each creature in the Cylinder makes a Dexterity saving throw. A creature
 * > takes 2d10 Bludgeoning damage and 4d6 Cold damage on a failed save or half
 * > as much damage on a successful one."
 * > _Using a Higher-Level Spell Slot._ "The Bludgeoning damage increases by
 * > 1d10 for each spell slot level above 4."
 *
 * The other half of why the two types scale separately: here **only** the
 * Bludgeoning grows. A shared scaling field would quietly upcast the Cold too.
 */
export const ICE_STORM: SpellDefinition = {
  id: 'ice-storm',
  name: 'Ice Storm',
  level: 4,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 300 },
  targets: { count: 0 },
  area: { kind: 'cylinder', radius: 20, height: 40, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '2d10', perSlotLevelAbove: '1d10' },
      damageType: 'bludgeoning',
      onSuccess: 'half',
      plus: [{ damage: { dice: '4d6' }, damageType: 'cold' }],
    },
  ],
  unmodelled: ['the ground in the Cylinder becomes Difficult Terrain until the end of your next turn'],
};

/**
 * SRD Finger of Death:
 *
 * > _Level 7 Necromancy (Sorcerer, Warlock, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Instantaneous.
 * > "The target makes a Constitution saving throw, taking 7d8 + 30 Necrotic
 * > damage on a failed save or half as much damage on a successful one. A
 * > Humanoid killed by this spell rises at the start of your next turn as a
 * > **Zombie** that follows your verbal orders."
 *
 * The printed `+ 30` is why damage scaling carries a flat half as well as
 * dice; before that this spell could not be written down at all.
 */
export const FINGER_OF_DEATH: SpellDefinition = {
  id: 'finger-of-death',
  name: 'Finger of Death',
  level: 7,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  requiresSight: true,
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '7d8', flat: 30 },
      damageType: 'necrotic',
      onSuccess: 'half',
    },
  ],
  unmodelled: ['a Humanoid killed by this spell rises as a Zombie under your command'],
};

/**
 * SRD Vitriolic Sphere:
 *
 * > _Level 4 Evocation (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 150 feet. **Duration:** Instantaneous.
 * > "Each creature in that area makes a Dexterity saving throw. On a failed
 * > save, a creature takes 10d4 Acid damage and another 5d4 Acid damage at the
 * > end of its next turn."
 * > _Using a Higher-Level Spell Slot._ "The initial damage increases by 2d4 for
 * > each spell slot level above 4."
 */
export const VITRIOLIC_SPHERE: SpellDefinition = {
  id: 'vitriolic-sphere',
  name: 'Vitriolic Sphere',
  level: 4,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 150 },
  targets: { count: 0 },
  area: { kind: 'sphere', radius: 20, origin: 'point' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'dex',
      damage: { dice: '10d4', perSlotLevelAbove: '2d4' },
      damageType: 'acid',
      onSuccess: 'half',
      // "The **initial** damage increases by 2d4 for each spell slot level
      // above 4." That word is the whole difference between this spell and
      // Acid Arrow, whose text reads "both initial and later" — so the
      // later hit declares no growth, and carries its own scaling to say so.
      delayed: {
        damage: { dice: '5d4' },
        damageType: 'acid',
      },
    },
  ],
};

/**
 * SRD Vicious Mockery:
 *
 * > _Enchantment Cantrip (Bard)._ **Casting Time:** Action. **Range:** 60 feet.
 * > **Duration:** Instantaneous.
 * > "The target must succeed on a Wisdom saving throw or take 1d6 Psychic
 * > damage and have Disadvantage on the next attack roll it makes before the
 * > end of its next turn."
 * > _Cantrip Upgrade._ "...increases by 1d6 when you reach levels 5 (2d6), 11
 * > (3d6), and 17 (4d6)."
 */
export const VICIOUS_MOCKERY: SpellDefinition = {
  id: 'vicious-mockery',
  name: 'Vicious Mockery',
  level: 0,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save-damage',
      ability: 'wis',
      damage: { dice: '1d6', cantripUpgradesAt: [5, 11, 17] },
      damageType: 'psychic',
      onSuccess: 'none',
    },
  ],
  unmodelled: [
    'Disadvantage on the target\u2019s next attack roll before the end of its next turn',
  ],
};

/**
 * SRD Grease:
 *
 * > _Level 1 Conjuration (Wizard)._ **Casting Time:** Action. **Range:** 60
 * > feet. **Duration:** 1 minute.
 * > "Nonflammable grease covers the ground in a 10-foot square centered on a
 * > point within range and turns it into Difficult Terrain for the duration.
 * > When the grease appears, each creature standing in its area must succeed
 * > on a Dexterity saving throw or have the Prone condition."
 *
 * Prone is the documented exception that outlives its cause — SRD: "when this
 * condition ends, you remain Prone" — so the spell's duration does not lift it.
 */
export const GREASE: SpellDefinition = {
  id: 'grease',
  name: 'Grease',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'cube', size: 10, origin: 'point' },
  // SRD says "or have the Prone condition" and stops there. Prone ends when
  // the creature stands up, not when the grease does — so the casting caused
  // it and does not keep it.
  effects: [{ kind: 'save', ability: 'dex', condition: 'prone', outlivesCasting: true }],
  durationSeconds: 60,
  // "A creature that enters the area or ends its turn there must also succeed
  // on that save or fall Prone." No "first time", no "once per turn" — Grease
  // caps nothing, and a creature that slips in and out three times falls over
  // three times.
  areaTrigger: {
    at: 'end-of-turn',
    onEntry: 'every-entry',
    label: 'Grease (the slick)',
    effects: [{ kind: 'save', ability: 'dex', condition: 'prone', outlivesCasting: true }],
  },
  unmodelled: [
    'the area becoming Difficult Terrain for the duration',
  ],
};

/**
 * SRD Animal Friendship:
 *
 * > _Level 1 Enchantment (Bard, Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** 24 hours.
 * > "Target a Beast that you can see within range. The target must succeed on
 * > a Wisdom saving throw or have the Charmed condition for the duration. If
 * > you or one of your allies deals damage to the target, the spell ends."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional Beast for
 * > each spell slot level above 1."
 */
export const ANIMAL_FRIENDSHIP: SpellDefinition = {
  id: 'animal-friendship',
  name: 'Animal Friendship',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, extraPerSlotLevelAbove: 1, mustBeType: 'Beast' },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', condition: 'charmed' }],
  durationSeconds: 86400,
  unmodelled: ['the spell ending early if you or an ally damages the target'],
};

/**
 * SRD Charm Monster:
 *
 * > _Level 4 Enchantment (Bard, Druid, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 30 feet. **Duration:** 1 hour.
 * > "One creature you can see within range makes a Wisdom saving throw. It
 * > does so with Advantage if you or your allies are fighting it. On a failed
 * > save, the target has the Charmed condition until the spell ends or until
 * > you or your allies damage it."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 4."
 *
 * Charm Person with the Humanoid restriction lifted, exactly as Hold Monster
 * is to Hold Person — the pair that shows the type check is data.
 */
export const CHARM_MONSTER: SpellDefinition = {
  id: 'charm-monster',
  name: 'Charm Monster',
  level: 4,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  requiresSight: true,
  effects: [{ kind: 'save', ability: 'wis', condition: 'charmed' }],
  durationSeconds: 3600,
  unmodelled: [
    'the save has Advantage if you or your allies are fighting the target',
    'the spell ends early if you or your allies damage the target',
  ],
};


// — spells the engine tracks rather than executes ————————————————————————————
//
// Each of these is cast for real: the action goes, the slot goes, Concentration
// moves, the duration runs. What the spell *does* is narration, and every one
// says so. The SRD line each field came from is quoted, because a tracked
// spell's numbers are exactly as easy to get wrong as an executed one's — and
// nothing downstream would catch a wrong duration.

/**
 * SRD Detect Magic:
 *
 * > _Level 1 Divination (Ritual)._ **Casting Time:** Action or Ritual.
 * > **Range:** Self. **Duration:** Concentration, up to 10 minutes.
 * > "For the duration, you sense the presence of magical effects within 30
 * > feet of yourself."
 */
export const DETECT_MAGIC: SpellDefinition = {
  id: 'detect-magic',
  name: 'Detect Magic',
  level: 1,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'sensing magical effects within 30 feet, the Magic action to see an aura, and the school a spell belongs to, are all the DM’s to narrate',
    'the Ritual casting option is not modelled: a Ritual takes 10 minutes longer, and a casting time of a minute or more is refused until a casting-in-progress state machine exists',
    'the blocking rule — 1 foot of stone, dirt or wood, 1 inch of metal, a thin sheet of lead — is the DM’s',
  ],
};

/**
 * SRD Mage Armor:
 *
 * > _Level 1 Abjuration._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** 8 hours.
 * > "You touch a willing creature who isn't wearing armor. Until the spell
 * > ends, the target's base AC becomes 13 plus its Dexterity modifier. The
 * > spell ends early if the target dons armor."
 *
 * The first spell to **replace** an Armour Class calculation rather than add
 * to one — see the `armor-class` effect for why a `+3` bonus is the wrong
 * answer even though it is usually the same number.
 */
export const MAGE_ARMOR: SpellDefinition = {
  id: 'mage-armor',
  name: 'Mage Armor',
  level: 1,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true, mustBeUnarmored: true },
  effects: [
    // "13 plus its Dexterity modifier": Dexterity is already in the formula,
    // so the base is the whole of what the spell states. A Shield still helps
    // — it is not body armour, and "isn't wearing armor" is the body slot.
    { kind: 'armor-class', base: 13, plusAbility: null, shieldAllowed: true },
  ],
  durationSeconds: 28_800,
  unmodelled: [
    'the spell ends early if the target dons armor: the Armour Class is right either way, because the calculation is inert while armour is worn, but the casting goes on running and stays dispellable',
    'whether the target is willing is not modelled; willingness is fiction',
  ],
};

/**
 * SRD Mage Hand:
 *
 * > _Conjuration Cantrip._ **Casting Time:** Action. **Range:** 30 feet.
 * > **Duration:** 1 minute.
 * > "A spectral, floating hand appears at a point you choose within range."
 */
export const MAGE_HAND: SpellDefinition = {
  id: 'mage-hand',
  name: 'Mage Hand',
  level: 0,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  // SRD: "The hand vanishes ... if you cast this spell again."
  replacesPriorCasting: true,
  unmodelled: [
    'the hand itself is not a thing in the world: manipulating an object, opening a door, or moving the hand 30 feet on a later turn are the DM’s',
    'the hand vanishing when it is ever more than 30 feet from the caster is the DM’s: the hand has no position of its own',
    'the 10-pound carrying limit and the ban on attacking or activating magic items are the DM’s',
  ],
};

/**
 * SRD Light:
 *
 * > _Evocation Cantrip._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** 1 hour.
 * > "You touch one Large or smaller object that isn't being worn or carried by
 * > someone else. Until the spell ends, the object sheds Bright Light in a
 * > 20-foot radius and Dim Light for an additional 20 feet."
 */
export const LIGHT: SpellDefinition = {
  id: 'light',
  name: 'Light',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the spell targets an object, and objects are not modelled — which object was touched, and whether it is worn or carried by someone else, are the DM’s',
    'Bright Light in a 20-foot radius and Dim Light beyond it are not modelled; the engine has no lighting',
    'covering the object is the DM’s; a second casting ending the first is not the DM’s and is not done either — the engine holds every casting by caster and spell and nothing ends one on that basis',
  ],
};

/**
 * SRD Fly:
 *
 * > _Level 3 Transmutation._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "You touch a willing creature. For the duration, the target gains a Fly
 * > Speed of 60 feet and can hover."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 3."
 */
export const FLY: SpellDefinition = {
  id: 'fly',
  name: 'Fly',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'a Fly Speed of 60 feet and hovering are not applied; the engine tracks one Speed and no movement modes',
    'the fall when the spell ends on a creature still aloft is the DM’s',
  ],
};

/**
 * SRD Longstrider:
 *
 * > _Level 1 Transmutation._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** 1 hour.
 * > "You touch a creature. The target's Speed increases by 10 feet until the
 * > spell ends."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 */
export const LONGSTRIDER: SpellDefinition = {
  id: 'longstrider',
  name: 'Longstrider',
  level: 1,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the 10-foot Speed increase is not applied: Speed comes from the species and nothing modifies it yet',
  ],
};

/**
 * SRD Darkvision:
 *
 * > _Level 2 Transmutation._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** 8 hours.
 * > "For the duration, a willing creature you touch has Darkvision with a
 * > range of 150 feet."
 */
export const DARKVISION: SpellDefinition = {
  id: 'darkvision',
  name: 'Darkvision',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [],
  durationSeconds: 28_800,
  unmodelled: [
    'Darkvision is not modelled; sight is declared per pair of creatures rather than derived from light and senses',
  ],
};

/**
 * SRD Spider Climb:
 *
 * > _Level 2 Transmutation._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Concentration, up to 1 hour.
 * > "Until the spell ends, one willing creature you touch gains the ability to
 * > move up, down, and across vertical surfaces and along ceilings, while
 * > leaving its hands free. The target also gains a Climb Speed equal to its
 * > Speed."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 2."
 */
export const SPIDER_CLIMB: SpellDefinition = {
  id: 'spider-climb',
  name: 'Spider Climb',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'touch' },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'climbing walls and ceilings, and the Climb Speed, are not applied; the engine tracks one Speed and no movement modes',
  ],
};

/**
 * SRD Misty Step:
 *
 * > _Level 2 Conjuration._ **Casting Time:** Bonus Action. **Range:** Self.
 * > **Duration:** Instantaneous.
 * > "Briefly surrounded by silvery mist, you teleport up to 30 feet to an
 * > unoccupied space you can see."
 */
export const MISTY_STEP: SpellDefinition = {
  id: 'misty-step',
  name: 'Misty Step',
  level: 2,
  school: 'conjuration',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'the teleport is not performed, and that is a missing mechanism rather than a judgement: no command relocates a creature without charging movement — moveCreature spends a budget and placeCreature refuses a creature that already has a position — so the 30 feet, the unoccupied space and the line of sight go unchecked',
  ],
};

/**
 * SRD Disguise Self:
 *
 * > _Level 1 Illusion._ **Casting Time:** Action. **Range:** Self.
 * > **Duration:** 1 hour.
 * > "You make yourself—including your clothing, armor, weapons, and other
 * > belongings on your person—look different until the spell ends."
 */
export const DISGUISE_SELF: SpellDefinition = {
  id: 'disguise-self',
  name: 'Disguise Self',
  level: 1,
  school: 'illusion',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  // SRD: "To discern that you are disguised, a creature must take the Study
  // action to inspect your appearance and succeed on an Intelligence
  // (Investigation) check against your spell save DC." The table decides that
  // somebody looked closely; the engine owns the roll and the number it beats.
  check: { ability: 'int', skill: 'investigation', onSuccess: 'none' },
  unmodelled: [
    'what the caster looks like is the DM’s, and so is whether a creature thinks to inspect them',
    'the illusion failing physical inspection — objects passing through a hat that is not there — is the DM’s',
  ],
};

/**
 * SRD Comprehend Languages:
 *
 * > _Level 1 Divination (Ritual)._ **Casting Time:** Action or Ritual.
 * > **Range:** Self. **Duration:** 1 hour.
 * > "For the duration, you understand the literal meaning of any language that
 * > you hear or see signed."
 */
export const COMPREHEND_LANGUAGES: SpellDefinition = {
  id: 'comprehend-languages',
  name: 'Comprehend Languages',
  level: 1,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'understanding a language is the DM’s; the engine records which languages a character knows but nothing reads them in play',
    'the Ritual casting option is not modelled: a Ritual takes 10 minutes longer, and a casting time of a minute or more is refused until a casting-in-progress state machine exists',
  ],
};

/**
 * SRD Water Breathing:
 *
 * > _Level 3 Transmutation (Ritual)._ **Casting Time:** Action or Ritual.
 * > **Range:** 30 feet. **Duration:** 24 hours.
 * > "This spell grants up to ten willing creatures of your choice within range
 * > the ability to breathe underwater until the spell ends."
 */
/**
 * SRD Web:
 *
 * > _Level 2 Conjuration (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 hour.
 * > "You conjure a mass of sticky webbing at a point within range. The webs
 * > fill a 20-foot Cube there for the duration."
 * > "**The first time a creature enters the webs on a turn or starts its turn
 * > there**, it must succeed on a Dexterity saving throw or have the
 * > Restrained condition while in the webs or until it breaks free."
 * > "A creature Restrained by the webs can take an action to make a Strength
 * > (Athletics) check against your spell save DC. If it succeeds, it is no
 * > longer Restrained."
 *
 * **The casting does nothing at all**, and that is the point of it here: the
 * webs simply appear, and every save Web ever calls for comes from the
 * trigger. A creature already standing in the Cube when it is conjured is not
 * caught by it — nothing in the text says so — which is why `effects` is empty
 * and the record is on nobody.
 *
 * **The cap is on the entry and not on the creature.** "The first time a
 * creature enters the webs on a turn" bounds entering; starting your turn
 * there is the other half of the sentence and is not entering, so a creature
 * that begins its turn in the webs, tears out and walks back in saves twice.
 * Insect Plague's "only once per turn" is the other reading, and the pair is
 * the only place the difference is visible.
 */
export const WEB: SpellDefinition = {
  id: 'web',
  name: 'Web',
  level: 2,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  area: { kind: 'cube', size: 20, origin: 'point' },
  effects: [],
  areaTrigger: {
    at: 'start-of-turn',
    onEntry: 'first-per-turn',
    label: 'Web (the webbing)',
    effects: [
      {
        kind: 'save',
        ability: 'dex',
        condition: 'restrained',
        check: { ability: 'str', skill: 'athletics', onSuccess: 'end-on-target' },
      },
    ],
  },
  durationSeconds: 3600,
  unmodelled: [
    'Restrained by the webs lasts "while in the webs", and a condition that ends when its holder walks out of an area has no shape here: it runs until the casting ends or the creature breaks free',
    'the webs are Difficult Terrain and the area within them Lightly Obscured',
    'the webs collapsing when they are not anchored between two solid masses, which is a fact about the room',
    'the webs being flammable, and the 2d4 Fire damage a burning cube deals',
  ],
};

export const WATER_BREATHING: SpellDefinition = {
  id: 'water-breathing',
  name: 'Water Breathing',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 10 },
  effects: [],
  durationSeconds: 86_400,
  unmodelled: [
    'breathing underwater is the DM’s; suffocation is not modelled',
    'the Ritual casting option is not modelled: a Ritual takes 10 minutes longer, and a casting time of a minute or more is refused until a casting-in-progress state machine exists',
  ],
};

/**
 * SRD Speak with Animals:
 *
 * > _Level 1 Divination (Ritual)._ **Casting Time:** Action or Ritual.
 * > **Range:** Self. **Duration:** 10 minutes.
 * > "For the duration, you can comprehend and verbally communicate with
 * > Beasts, and you can use any of the Influence action's skill options with
 * > them."
 */
export const SPEAK_WITH_ANIMALS: SpellDefinition = {
  id: 'speak-with-animals',
  name: 'Speak with Animals',
  level: 1,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'what a Beast says is the DM’s',
    'the Influence action and its skill options are not modelled',
    'the Ritual casting option is not modelled: a Ritual takes 10 minutes longer, and a casting time of a minute or more is refused until a casting-in-progress state machine exists',
  ],
};

/**
 * SRD Jump:
 *
 * > _Level 1 Transmutation._ **Casting Time:** Bonus Action. **Range:** Touch.
 * > **Duration:** 1 minute.
 * > "You touch a willing creature. Once on each of its turns until the spell
 * > ends, that creature can jump up to 30 feet by spending 10 feet of
 * > movement."
 * > _Using a Higher-Level Spell Slot._ "You can target one additional creature
 * > for each spell slot level above 1."
 */
export const JUMP: SpellDefinition = {
  id: 'jump',
  name: 'Jump',
  level: 1,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, extraPerSlotLevelAbove: 1 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'the 30-foot jump for 10 feet of movement is not applied; jumping is not modelled, and the once-per-turn limit has nothing to count',
  ],
};

/**
 * SRD Prestidigitation:
 *
 * > _Transmutation Cantrip._ **Casting Time:** Action. **Range:** 10 feet.
 * > **Duration:** Up to 1 hour.
 * > "You create a magical effect within range."
 */
export const PRESTIDIGITATION: SpellDefinition = {
  id: 'prestidigitation',
  name: 'Prestidigitation',
  level: 0,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'every one of the listed effects — a sensory effect, lighting or snuffing a flame, cleaning or soiling an object, chilling or warming, a mark, a trinket — is the DM’s',
    'the limit of three effects at once, and dismissing one as an action, are not tracked',
  ],
};

// — the second tracked batch: the rest of the utility bucket that honestly fits —
//
// Audited one at a time against the SRD text rather than filed by shape. A
// spell lands here only when everything mechanically authoritative about it is
// already the engine's — the action, the slot, Concentration, the deadline,
// the range and the target count — and everything left over is fiction, an
// object, a place or a piece of information that the table owns and always
// will.
//
// The ones that did *not* land are the point of the audit. A spell carrying an
// ability check, a saving throw, damage, healing, an Armour Class, a Speed, a
// Resistance or a condition is **not** tracked, because putting those in
// `unmodelled` would be the engine calling a rule the DM's when it is really a
// shape nobody has built. `spell-tracking.test.ts` holds that line
// mechanically: it reads each tracked spell's own SRD prose and demands a
// written adjudication for every mechanical clause it finds there.

/**
 * SRD Arcane Lock:
 *
 * > _Level 2 Abjuration (Wizard)._ **Casting Time:** Action. **Range:** Touch.
 * > **Duration:** Until dispelled.
 * > "You touch a closed door, window, gate, container, or hatch and magically
 * > lock it for the duration. This lock can't be unlocked by any nonmagical
 * > means."
 */
export const ARCANE_LOCK: SpellDefinition = {
  id: 'arcane-lock',
  name: 'Arcane Lock',
  level: 2,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  untilDispelled: true,
  unmodelled: [
    'the spell locks an object, and objects are not modelled: which door was touched, who may open it despite the lock, and the password are the DM’s',
    'a duration of “Until dispelled” is no deadline at all, so no timer is scheduled and the casting simply runs; Dispel Magic executes, and cannot reach this one, because it ends an ongoing spell **on a target** and this casting is on a door',
  ],
};

/**
 * SRD Continual Flame:
 *
 * > _Level 2 Evocation (Cleric, Druid, Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Until dispelled.
 * > "A flame springs from an object that you touch. The effect casts Bright
 * > Light in a 20-foot radius and Dim Light for an additional 20 feet."
 */
export const CONTINUAL_FLAME: SpellDefinition = {
  id: 'continual-flame',
  name: 'Continual Flame',
  level: 2,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  untilDispelled: true,
  unmodelled: [
    'the flame springs from an object, and objects are not modelled: which object was touched is the DM’s',
    'Bright Light in a 20-foot radius and Dim Light beyond it are not applied; the engine has no lighting, exactly as it has none for Light',
    'a duration of “Until dispelled” is no deadline at all, so no timer is scheduled and the casting simply runs',
  ],
};

/**
 * SRD Create Food and Water:
 *
 * > _Level 3 Conjuration (Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** Instantaneous.
 * > "You create 45 pounds of food and 30 gallons of fresh water on the ground
 * > or in containers within range."
 */
export const CREATE_FOOD_AND_WATER: SpellDefinition = {
  id: 'create-food-and-water',
  name: 'Create Food and Water',
  level: 3,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'the food and the water are objects, and objects are not modelled; malnutrition, dehydration and the 24 hours after which the food spoils are the DM’s',
  ],
};

/**
 * SRD Demiplane:
 *
 * > _Level 8 Conjuration (Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** 60 feet. **Duration:** 1 hour.
 * > "You create a shadowy Medium door on a flat solid surface that you can see
 * > within range. This door can be opened and closed, and it leads to a
 * > demiplane that is an empty room 30 feet in each dimension."
 */
export const DEMIPLANE: SpellDefinition = {
  id: 'demiplane',
  name: 'Demiplane',
  level: 8,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the door and the room behind it are a second place, and the engine holds one scene: who is inside the demiplane, and what is in it, are the DM’s',
    'a creature that opts to be shunted out as the door vanishes lands Prone, and the DM applies that with applyConditionTo — nothing in state says who was inside',
    'connecting the door to a demiplane made by an earlier casting, or by somebody else, is the DM’s',
  ],
};

/**
 * SRD Detect Evil and Good:
 *
 * > _Level 1 Divination (Cleric, Paladin)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 10 minutes.
 * > "For the duration, you sense the location of any Aberration, Celestial,
 * > Elemental, Fey, Fiend, or Undead within 30 feet of yourself."
 *
 * Creature type *is* authoritative state, so the engine could in principle say
 * which of those are nearby — but what the caster is *told* is information
 * delivered into the fiction, and the blocking rule is a fact about walls the
 * engine deliberately does not model.
 */
export const DETECT_EVIL_AND_GOOD: SpellDefinition = {
  id: 'detect-evil-and-good',
  name: 'Detect Evil and Good',
  level: 1,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'what the caster senses is narration: the engine knows a creature’s type but reports nothing, and a creature nobody has typed has nothing to report',
    'sensing whether the Hallow spell is active is the DM’s',
    'the blocking rule — 1 foot of stone, dirt or wood, 1 inch of metal, a thin sheet of lead — is the DM’s, because walls are declared rather than modelled',
  ],
};

/**
 * SRD Detect Poison and Disease:
 *
 * > _Level 1 Divination (Ritual) (Cleric, Druid, Paladin, Ranger)._
 * > **Casting Time:** Action or Ritual. **Range:** Self.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "For the duration, you sense the location of poisons, poisonous or
 * > venomous creatures, and magical contagions within 30 feet of yourself."
 */
export const DETECT_POISON_AND_DISEASE: SpellDefinition = {
  id: 'detect-poison-and-disease',
  name: 'Detect Poison and Disease',
  level: 1,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'poisons, venomous creatures and magical contagions are not modelled, and what the caster senses is narration',
    'the Ritual casting option is not modelled: a Ritual takes 10 minutes longer, and a casting time of a minute or more is refused until a casting-in-progress state machine exists',
    'the blocking rule — 1 foot of stone, dirt or wood, 1 inch of metal, a thin sheet of lead — is the DM’s',
  ],
};

/**
 * SRD Find Traps:
 *
 * > _Level 2 Divination (Cleric, Druid, Ranger)._ **Casting Time:** Action.
 * > **Range:** 120 feet. **Duration:** Instantaneous.
 * > "You sense any trap within range that is within line of sight... This
 * > spell reveals that a trap is present but not its location."
 */
export const FIND_TRAPS: SpellDefinition = {
  id: 'find-traps',
  name: 'Find Traps',
  level: 2,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'traps are not modelled — neither a mechanism nor a Glyph of Warding is a thing in state — so whether one is in range, and the general nature of the danger, are the DM’s',
  ],
};

/**
 * SRD Floating Disk:
 *
 * > _Level 1 Conjuration (Ritual) (Wizard)._ **Casting Time:** Action or
 * > Ritual. **Range:** 30 feet. **Duration:** 1 hour.
 * > "This spell creates a circular, horizontal plane of force, 3 feet in
 * > diameter and 1 inch thick, that floats 3 feet above the ground in an
 * > unoccupied space of your choice that you can see within range."
 */
export const FLOATING_DISK: SpellDefinition = {
  id: 'floating-disk',
  name: 'Floating Disk',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the disk is an object and objects are not modelled: where it is, the 500 pounds it holds, and what is riding on it are the DM’s',
    'the disk following the caster within 20 feet, refusing an elevation change of 10 feet or more, and the spell ending beyond 100 feet are all the DM’s',
    'the Ritual casting option is not modelled: a Ritual takes 10 minutes longer, and a casting time of a minute or more is refused until a casting-in-progress state machine exists',
  ],
};

/**
 * SRD Gentle Repose:
 *
 * > _Level 2 Necromancy (Ritual) (Cleric, Paladin, Wizard)._
 * > **Casting Time:** Action or Ritual. **Range:** Touch.
 * > **Duration:** 10 days.
 * > "You touch a corpse or other remains. For the duration, the target is
 * > protected from decay and can't become Undead."
 *
 * Ten days is 864,000 seconds. The clock counts seconds precisely so that a
 * duration this long is subtraction rather than a special case.
 */
export const GENTLE_REPOSE: SpellDefinition = {
  id: 'gentle-repose',
  name: 'Gentle Repose',
  level: 2,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 864_000,
  unmodelled: [
    'the target is a corpse or other remains, which is an object rather than a creature in state: which remains were touched is the DM’s',
    'decay, becoming Undead, and the time limit this extends on raising the dead are the DM’s — no spell the engine executes raises anybody',
    'the Ritual casting option is not modelled: a Ritual takes 10 minutes longer, and a casting time of a minute or more is refused until a casting-in-progress state machine exists',
  ],
};

/**
 * SRD Knock:
 *
 * > _Level 2 Transmutation (Bard, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 60 feet. **Duration:** Instantaneous.
 * > "A target that is held shut by a mundane lock or that is stuck or barred
 * > becomes unlocked, unstuck, or unbarred."
 */
export const KNOCK: SpellDefinition = {
  id: 'knock',
  name: 'Knock',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'the spell opens an object, and objects are not modelled: which lock, whether it had several, and whether it was barred are the DM’s',
    'suppressing an Arcane Lock for 10 minutes is the DM’s — that casting is tracked rather than executed, so nothing reads it',
    'the loud knock audible 300 feet away is the DM’s',
  ],
};

/**
 * SRD Locate Animals or Plants:
 *
 * > _Level 2 Divination (Ritual) (Bard, Druid, Ranger)._ **Casting Time:**
 * > Action or Ritual. **Range:** Self. **Duration:** Instantaneous.
 * > "Describe or name a specific kind of Beast, Plant creature, or nonmagical
 * > plant. You learn the direction and distance to the closest creature or
 * > plant of that kind within 5 miles, if any are present."
 */
export const LOCATE_ANIMALS_OR_PLANTS: SpellDefinition = {
  id: 'locate-animals-or-plants',
  name: 'Locate Animals or Plants',
  level: 2,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'what is within 5 miles is the DM’s: the engine holds one scene, and a creature off it is not a creature at a distance',
    'the Ritual casting option is not modelled: a Ritual takes 10 minutes longer, and a casting time of a minute or more is refused until a casting-in-progress state machine exists',
  ],
};

/**
 * SRD Locate Creature:
 *
 * > _Level 4 Divination (Bard, Cleric, Druid, Paladin, Ranger, Wizard)._
 * > **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Concentration, up to 1 hour.
 * > "Describe or name a creature that is familiar to you. You sense the
 * > direction to the creature's location if that creature is within 1,000 feet
 * > of you."
 */
export const LOCATE_CREATURE: SpellDefinition = {
  id: 'locate-creature',
  name: 'Locate Creature',
  level: 4,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the spell names a creature in prose rather than taking an id, and what the caster senses is narration; once a creature is off the scene, whether it is within 1,000 feet is the DM’s',
    'the spell failing against a creature in a different form, and being blocked by any thickness of lead, are the DM’s',
  ],
};

/**
 * SRD Locate Object:
 *
 * > _Level 2 Divination (Bard, Cleric, Druid, Paladin, Ranger, Wizard)._
 * > **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "Describe or name an object that is familiar to you. You sense the
 * > direction to the object's location if that object is within 1,000 feet of
 * > you."
 */
export const LOCATE_OBJECT: SpellDefinition = {
  id: 'locate-object',
  name: 'Locate Object',
  level: 2,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'objects are not modelled and have no position, so where the object is — and whether it is moving — is the DM’s',
    'being blocked by any thickness of lead is the DM’s',
  ],
};

/**
 * SRD Message:
 *
 * > _Transmutation Cantrip (Bard, Druid, Sorcerer, Wizard)._
 * > **Casting Time:** Action. **Range:** 120 feet. **Duration:** 1 round.
 * > "You point toward a creature within range and whisper a message. The
 * > target (and only the target) hears the message and can reply in a whisper
 * > that only you can hear."
 *
 * A round is six seconds — SRD, "A round represents about 6 seconds" — and
 * that is a span of time rather than a moment in the turn order, so it is a
 * `durationSeconds` and not a `durationUntil`. The distinction matters
 * elsewhere and is free here: nothing hangs on the deadline but the casting.
 */
export const MESSAGE: SpellDefinition = {
  id: 'message',
  name: 'Message',
  level: 0,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  effects: [],
  durationSeconds: 6,
  unmodelled: [
    'what is said, and what is whispered back, are the DM’s',
    'SRD lets this one spell be cast through a solid object at a familiar target; the engine refuses a target behind Total Cover as it does for every spell, and the exception is not expressible',
    'magical silence, and the foot of stone, metal or wood or thin sheet of lead that blocks it, are the DM’s',
  ],
};

/**
 * SRD Move Earth:
 *
 * > _Level 6 Transmutation (Druid, Sorcerer, Wizard)._ **Casting Time:**
 * > Action. **Range:** 120 feet. **Duration:** Concentration, up to 2 hours.
 * > "Choose an area of terrain no larger than 40 feet on a side within range.
 * > You can reshape dirt, sand, or clay in the area in any manner you choose
 * > for the duration."
 */
export const MOVE_EARTH: SpellDefinition = {
  id: 'move-earth',
  name: 'Move Earth',
  level: 6,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 7200,
  unmodelled: [
    'terrain has no elevation in the engine: raising, lowering, trenching and walling the ground, and the 10 minutes the change takes, are all the DM’s',
    'choosing a new area every 10 minutes of Concentration is the DM’s',
    'whether a structure the reshaped ground undermines collapses is the DM’s',
  ],
};

/**
 * SRD Nondetection:
 *
 * > _Level 3 Abjuration (Bard, Ranger, Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** 8 hours.
 * > "For the duration, you hide a target that you touch from Divination
 * > spells... The target can't be targeted by any Divination spell or
 * > perceived through magical scrying sensors."
 *
 * The clause that would be a rule excludes nothing the engine can be asked
 * about: every Divination spell the engine has a definition for is cast at
 * Self or at no creature at all, so "can't be targeted by any Divination
 * spell" has no reachable case. Same reasoning as Counterspell's components
 * clause — a rule whose only answer is "not applicable" is documented rather
 * than modelled.
 */
export const NONDETECTION: SpellDefinition = {
  id: 'nondetection',
  name: 'Nondetection',
  level: 3,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 28_800,
  unmodelled: [
    'being hidden from Divination spells excludes nothing the engine can be asked about: every Divination spell it defines is cast at Self or at no creature, so the rule has no reachable case',
    'scrying sensors are not modelled, and a place or an object as the target is not a creature in state',
  ],
};

/**
 * SRD Passwall:
 *
 * > _Level 5 Transmutation (Wizard)._ **Casting Time:** Action.
 * > **Range:** 30 feet. **Duration:** 1 hour.
 * > "A passage appears at a point that you can see on a wooden, plaster, or
 * > stone surface (such as a wall, ceiling, or floor) within range and lasts
 * > for the duration."
 */
export const PASSWALL: SpellDefinition = {
  id: 'passwall',
  name: 'Passwall',
  level: 5,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'walls are declared rather than modelled — deliberately, because computing them is where a rules engine becomes a map editor — so the passage and its dimensions are the DM’s',
    'ejecting whatever is still in the passage when it closes is the DM’s',
  ],
};

/**
 * SRD Plane Shift:
 *
 * > _Level 7 Conjuration (Cleric, Druid, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** Instantaneous.
 * > "You and up to eight willing creatures who link hands in a circle are
 * > transported to a different plane of existence."
 *
 * Eight, not nine: the SRD counts the caster separately, so `self` stays off
 * and the target rule is the creatures who go with them.
 */
export const PLANE_SHIFT: SpellDefinition = {
  id: 'plane-shift',
  name: 'Plane Shift',
  level: 7,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 8 },
  effects: [],
  unmodelled: [
    'planes of existence are not modelled and the engine holds one scene, so nobody is moved: where the party arrives is the DM’s',
    'arriving at a teleportation circle from its sigil sequence is the DM’s',
  ],
};

/**
 * SRD Remove Curse:
 *
 * > _Level 3 Abjuration (Cleric, Paladin, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** Instantaneous.
 * > "At your touch, all curses affecting one creature or object end."
 */
export const REMOVE_CURSE: SpellDefinition = {
  id: 'remove-curse',
  name: 'Remove Curse',
  level: 3,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  unmodelled: [
    'a curse is not a thing in state — nothing the engine applies is one — so which curses end is the DM’s',
    'Attunement is not modelled, so breaking it to a cursed magic item is the DM’s',
  ],
};

/**
 * SRD Rope Trick:
 *
 * > _Level 2 Transmutation (Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** 1 hour.
 * > "You touch a rope... At the rope's upper end, an Invisible 3-foot-by-5-foot
 * > portal opens to an extradimensional space that lasts until the spell ends."
 */
export const ROPE_TRICK: SpellDefinition = {
  id: 'rope-trick',
  name: 'Rope Trick',
  level: 2,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'the rope is an object and the space above it is a second place; the engine holds one scene, so who has climbed in is the DM’s',
    'the eight Medium creatures it holds, and the rule that attacks and spells cannot cross the portal, are the DM’s',
  ],
};

/**
 * SRD See Invisibility:
 *
 * > _Level 2 Divination (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** 1 hour.
 * > "For the duration, you see creatures and objects that have the Invisible
 * > condition as if they were visible, and you can see into the Ethereal
 * > Plane."
 *
 * The one clause that touches a modelled rule is the one the engine already
 * answers the right way round. Sight is **declared pairwise** — `sight[from|to]`
 * — and the Invisible condition's effect is context-dependent on whether the
 * observer can see, so a table whose caster can now see an invisible creature
 * declares that sight and every roll downstream reads it. That is existing
 * machinery used at the table, not machinery that is missing.
 */
export const SEE_INVISIBILITY: SpellDefinition = {
  id: 'see-invisibility',
  name: 'See Invisibility',
  level: 2,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'seeing a creature with the Invisible condition is declared rather than derived: the table declares the caster’s sight of it, and the condition’s own effects read that declaration',
    'the Ethereal Plane is not modelled, so what appears ghostly there is the DM’s',
  ],
};

/**
 * SRD Speak with Dead:
 *
 * > _Level 3 Necromancy (Bard, Cleric, Wizard)._ **Casting Time:** Action.
 * > **Range:** 10 feet. **Duration:** 10 minutes.
 * > "You grant the semblance of life to a corpse of your choice within range,
 * > allowing it to answer questions you pose."
 */
export const SPEAK_WITH_DEAD: SpellDefinition = {
  id: 'speak-with-dead',
  name: 'Speak with Dead',
  level: 3,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the target is a corpse rather than a creature in state: whether it has a mouth, whether the deceased was Undead, and whether it was questioned within the past 10 days are the DM’s',
    'the five questions and what the corpse says are the DM’s, truthfulness included',
  ],
};

/**
 * SRD Stone Shape:
 *
 * > _Level 4 Transmutation (Cleric, Druid, Wizard)._ **Casting Time:** Action.
 * > **Range:** Touch. **Duration:** Instantaneous.
 * > "You touch a stone object of Medium size or smaller or a section of stone
 * > no more than 5 feet in any dimension and form it into any shape you like."
 */
/**
 * SRD Spirit Guardians:
 *
 * > _Level 3 Conjuration (Cleric)._ **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Concentration, up to 10 minutes.
 * > "Protective spirits flit around you in a 15-foot Emanation for the
 * > duration. ... When you cast this spell, you can designate creatures to be
 * > unaffected by it. Any other creature's Speed is halved in the Emanation,
 * > and **whenever the Emanation enters a creature's space** and whenever a
 * > creature enters the Emanation or ends its turn there, the creature must
 * > make a Wisdom saving throw. On a failed save, the creature takes 3d8
 * > Radiant damage (if you are good or neutral) or 3d8 Necrotic damage (if you
 * > are evil). On a successful save, the creature takes half as much damage. A
 * > creature makes this save only once per turn."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 3."
 *
 * **The spell that proves an area can be carried.** Moonbeam's Cylinder is a
 * point the casting keeps and a Magic action moves; this Emanation is centred
 * on the caster and moves because the caster does — which is not a Spirit
 * Guardians rule at all but the definition of the shape. SRD's glossary: "An
 * Emanation **moves with the creature or object that is its origin** unless it
 * is an instantaneous or a stationary effect."
 *
 * So nothing here records where the aura is. `area.origin: 'self'` plus the
 * casting's own `caster` is the whole of it, and membership is asked of the
 * caster's live position every time — see `creaturesInCastingArea`.
 *
 * **There is no initial-appearance clause, and that is the text rather than a
 * simplification.** Moonbeam prints "When the Cylinder appears, each creature
 * in it makes a Constitution saving throw" and Cloudkill "Each creature in the
 * Sphere makes a Constitution saving throw"; Spirit Guardians prints no such
 * sentence. Its three triggers are the Emanation entering a space, a creature
 * entering the Emanation, and a creature ending its turn there — so a creature
 * already standing beside the cleric when the spirits appear takes nothing
 * until one of those happens, which for a creature that stays put is the end
 * of its own turn. `effects: []` is that reading, and Web's precedent for it.
 *
 * `onEntry: 'every-entry'` is likewise the text: "whenever a creature enters
 * the Emanation", with no "first time on a turn". The cap that makes it behave
 * like Insect Plague's is the separate "only once per turn" sentence, which
 * caps the creature across all three clauses.
 *
 * What this definition does **not** do is stated in `unmodelled` and counted
 * against it: the halved Speed inside the Emanation is a standing spatial
 * effect rather than a trigger, and needs a primitive the engine has not
 * built.
 */
export const SPIRIT_GUARDIANS: SpellDefinition = {
  id: 'spirit-guardians',
  name: 'Spirit Guardians',
  level: 3,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'emanation', distance: 15, origin: 'self' },
  // "you can designate creatures to be unaffected by it"
  designatesUnaffected: true,
  // "3d8 Radiant damage (if you are good or neutral) or 3d8 Necrotic damage
  // (if you are evil)" — decided by the caster's alignment, which the engine
  // does not hold for every creature and will not guess.
  damageTypeStated: ['radiant', 'necrotic'],
  // The spirits appear and nothing happens yet; every save this spell ever
  // calls for comes from one of the three clauses below.
  effects: [],
  durationSeconds: 600,
  areaTrigger: {
    at: 'end-of-turn',
    onEntry: 'every-entry',
    onAreaEntry: true,
    oncePerTurn: true,
    label: 'Spirit Guardians (the spirits)',
    effects: [
      {
        kind: 'save-damage',
        ability: 'wis',
        damage: { dice: '3d8', perSlotLevelAbove: '1d8' },
        damageType: 'radiant',
        onSuccess: 'half',
      },
    ],
  },
  unmodelled: [
    'the halved Speed of every unaffected-list creature inside the Emanation: a standing spatial effect rather than a trigger, and the engine has no primitive that derives a Speed from where a creature is standing',
    'whether the spirits look angelic, fey or fiendish, which the SRD makes the caster’s choice and is narration',
  ],
};


/**
 * SRD Spiritual Weapon:
 *
 * > _Level 2 Evocation (Cleric)._ **Casting Time:** Bonus Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 1 minute.
 * > "You create a floating, spectral force that resembles a weapon of your
 * > choice and lasts for the duration. The force appears within range in a
 * > space of your choice, and you can immediately make one melee spell attack
 * > against one creature within 5 feet of the force. On a hit, the target takes
 * > Force damage equal to 1d8 plus your spellcasting ability modifier.
 * >
 * > As a Bonus Action on your later turns, you can move the force up to 20 feet
 * > and repeat the attack against a creature within 5 feet of it."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for every
 * > slot level above 2."
 *
 * **The spell that proves a casting can hold a point**, and the one worth
 * reading for what it does *not* say. Nothing here gives the force an Armour
 * Class, Hit Points, a space it occupies, an action of its own, or a name
 * anything else could address. Unseen Servant and Arcane Hand print every one
 * of those in the same book; this prints none, so the force is a coordinate on
 * the casting rather than a creature, an object or a world entity.
 *
 * Three numbers, three homes, and they are not interchangeable:
 *
 * | SRD | Here | Measured from |
 * |---|---|---|
 * | "within range in a space of your choice" | `range` | the caster |
 * | "one creature within 5 feet of the force" | `origin.reach` | the force |
 * | "move the force up to 20 feet" | `origin.movableBy` | the force, now |
 *
 * **2024 gives this spell Concentration**, which 2014 did not. The whole point
 * of quoting the text is that the difference is not recalled.
 */
export const SPIRITUAL_WEAPON: SpellDefinition = {
  id: 'spiritual-weapon',
  name: 'Spiritual Weapon',
  level: 2,
  school: 'evocation',
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  // "you **can** immediately make one melee spell attack": the force appears
  // whether or not there is anything standing next to it.
  targets: { count: 1, optional: true },
  origin: { reach: 5, movableBy: 20 },
  effects: [
    {
      kind: 'attack',
      attack: 'melee',
      damage: { dice: '1d8', perSlotLevelAbove: '1d8' },
      damageType: 'force',
      addSpellcastingModifier: true,
    },
  ],
  durationSeconds: 60,
  activation: {
    action: 'bonus-action',
    // No `range`: the five feet are measured from the force, and `origin.reach`
    // is where that number lives. Two fields saying five would be two places to
    // get one sentence wrong.
    label: 'Spiritual Weapon (again)',
    effects: [
      {
        kind: 'attack',
        attack: 'melee',
        damage: { dice: '1d8', perSlotLevelAbove: '1d8' },
        damageType: 'force',
        addSpellcastingModifier: true,
      },
    ],
  },
  unmodelled: [
    'what the force looks like — "a weapon of your choice" — is narration, and nothing mechanical reads it',
  ],
};

/**
 * SRD Arcane Sword:
 *
 * > _Level 7 Evocation (Bard, Wizard)._ **Casting Time:** Action.
 * > **Range:** 90 feet. **Duration:** Concentration, up to 1 minute.
 * > "You create a spectral sword that hovers within range. It lasts for the
 * > duration.
 * >
 * > When the sword appears, you make a melee spell attack against a target
 * > within 5 feet of the sword. On a hit, the target takes Force damage equal
 * > to 4d12 plus your spellcasting ability modifier.
 * >
 * > On your later turns, you can take a Bonus Action to move the sword up to
 * > 30 feet to a spot you can see and repeat the attack against the same
 * > target or a different one."
 *
 * **The second user of {@link CastingOrigin}**, and it needed nothing new,
 * which is what a second user is for. It prints the same three numbers in the
 * same three places Spiritual Weapon does — the Range that says where the
 * point may first be put, the reach the attack is measured by, and the
 * allowance a later turn may move it — and it prints them for a different
 * caster, a different action and a different die.
 *
 * Two differences from Spiritual Weapon are transcription rather than shape,
 * and both are the sort a neighbouring definition lends by habit:
 *
 * - **"you make", not "you can".** Spiritual Weapon's force appears whether or
 *   not anything is standing beside it, which is exactly what
 *   {@link TargetRule.optional} is for. This sentence names the attack without
 *   that word, so the casting takes a target like any other spell.
 * - **It does not scale.** The SRD prints no *Using a Higher-Level Spell Slot*
 *   line for this spell at all, so 4d12 cast from a level 9 slot is still
 *   4d12. A `perSlotLevelAbove` copied from the definition above would be a
 *   number the book never printed, and nothing but a test comparing two slot
 *   levels would ever have said so.
 */
export const ARCANE_SWORD: SpellDefinition = {
  id: 'arcane-sword',
  name: 'Arcane Sword',
  level: 7,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 90 },
  // "you **make** a melee spell attack": no `optional`, which is the word
  // Spiritual Weapon prints and this spell does not.
  targets: { count: 1 },
  // "within 5 feet of the sword"; "move the sword up to 30 feet".
  origin: { reach: 5, movableBy: 30 },
  effects: [
    {
      kind: 'attack',
      attack: 'melee',
      // "Force damage equal to 4d12 plus your spellcasting ability modifier",
      // and no higher-level line, so no `perSlotLevelAbove`.
      damage: { dice: '4d12' },
      damageType: 'force',
      addSpellcastingModifier: true,
    },
  ],
  durationSeconds: 60,
  activation: {
    // "you can take a Bonus Action to move the sword ... and repeat the
    // attack": one action that moves and strikes, which is `origin.movableBy`
    // rather than `activation.movesArea`.
    action: 'bonus-action',
    // No `range`: the five feet are measured from the sword, and `origin.reach`
    // is where that number lives.
    label: 'Arcane Sword (again)',
    effects: [
      {
        kind: 'attack',
        attack: 'melee',
        damage: { dice: '4d12' },
        damageType: 'force',
        addSpellcastingModifier: true,
      },
    ],
  },
  unmodelled: [
    'moving the sword "to a spot you can see" is not verified: sight is a declared fact between two creatures, a destination is a coordinate rather than a creature, and whether the caster can see the space is the DM’s',
  ],
};

export const STONE_SHAPE: SpellDefinition = {
  id: 'stone-shape',
  name: 'Stone Shape',
  level: 4,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 0 },
  effects: [],
  unmodelled: [
    'stone objects and stone surfaces are not modelled, so what is shaped, and what the new shape does, are the DM’s',
  ],
};

/**
 * SRD Telepathic Bond:
 *
 * > _Level 5 Divination (Ritual) (Bard, Wizard)._ **Casting Time:** Action or
 * > Ritual. **Range:** 30 feet. **Duration:** 1 hour.
 * > "You forge a telepathic link among up to eight willing creatures of your
 * > choice within range, psychically linking each creature to all the others
 * > for the duration."
 */
export const TELEPATHIC_BOND: SpellDefinition = {
  id: 'telepathic-bond',
  name: 'Telepathic Bond',
  level: 5,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 8, self: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'what is said through the bond is the DM’s, and the engine records which languages a character knows without reading them in play — so excluding a creature that speaks none is the DM’s too',
    'the Ritual casting option is not modelled: a Ritual takes 10 minutes longer, and a casting time of a minute or more is refused until a casting-in-progress state machine exists',
  ],
};

/**
 * SRD Tongues:
 *
 * > _Level 3 Divination (Bard, Cleric, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** 1 hour.
 * > "This spell grants the creature you touch the ability to understand any
 * > spoken or signed language that it hears or sees."
 */
export const TONGUES: SpellDefinition = {
  id: 'tongues',
  name: 'Tongues',
  level: 3,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'understanding and being understood are the DM’s; the engine records which languages a character knows but nothing reads them in play',
  ],
};

/**
 * SRD Transport via Plants:
 *
 * > _Level 6 Conjuration (Druid)._ **Casting Time:** Action. **Range:** 10
 * > feet. **Duration:** 1 minute.
 * > "This spell creates a magical link between a Large or larger inanimate
 * > plant within range and another plant, at any distance, on the same plane
 * > of existence."
 */
export const TRANSPORT_VIA_PLANTS: SpellDefinition = {
  id: 'transport-via-plants',
  name: 'Transport via Plants',
  level: 6,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 10 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  unmodelled: [
    'both plants are objects and the far one is at any distance — off the scene entirely — so the link, and who steps through it, are the DM’s',
    'the 5 feet of movement a creature spends to step through is charged by the DM: the engine has no destination to move anybody to',
  ],
};

/**
 * SRD True Seeing:
 *
 * > _Level 6 Divination (Bard, Cleric, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** Touch. **Duration:** 1 hour.
 * > "For the duration, the willing creature you touch has Truesight with a
 * > range of 120 feet."
 */
export const TRUE_SEEING: SpellDefinition = {
  id: 'true-seeing',
  name: 'True Seeing',
  level: 6,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'senses are not modelled: Truesight is not a thing a creature carries, and what it pierces — illusions, shapechangers, the Ethereal Plane — is the DM’s',
    'what the target can see is declared pairwise, so a table granting sight of something hidden declares it exactly as it would without this spell',
  ],
};

/**
 * SRD Wall of Force:
 *
 * > _Level 5 Evocation (Wizard)._ **Casting Time:** Action. **Range:** 120
 * > feet. **Duration:** Concentration, up to 10 minutes.
 * > "An Invisible wall of force springs into existence at a point you choose
 * > within range... Nothing can physically pass through the wall."
 *
 * Not an `area`: the shapes the engine knows are shapes a spell *catches
 * creatures in*, and this is a barrier with ten panels, an orientation and a
 * thickness. Cover and line of sight are declared rather than ray-cast for the
 * same reason, and that is a boundary the engine keeps on purpose.
 */
export const WALL_OF_FORCE: SpellDefinition = {
  id: 'wall-of-force',
  name: 'Wall of Force',
  level: 5,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  unmodelled: [
    'the wall is a barrier rather than an area that catches creatures, and barriers are not modelled: where it stands, and what it separates, are the DM’s',
    'nothing being able to pass through it is the DM’s — movement does not consult walls, which is the boundary that keeps this a rules engine rather than a map editor',
    'pushing a creature whose space the wall cuts through to one side of it is the DM’s',
  ],
};

/**
 * SRD Water Walk:
 *
 * > _Level 3 Transmutation (Ritual) (Cleric, Druid, Ranger, Sorcerer)._
 * > **Casting Time:** Action or Ritual. **Range:** 30 feet.
 * > **Duration:** 1 hour.
 * > "Up to ten willing creatures of your choice within range gain this
 * > ability for the duration."
 */
export const WATER_WALK: SpellDefinition = {
  id: 'water-walk',
  name: 'Water Walk',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 10, self: true },
  effects: [],
  durationSeconds: 3600,
  unmodelled: [
    'liquid surfaces are not modelled: whether there is water, acid, mud or lava under the party, and what the heat of lava does, are the DM’s',
    'the Bonus Action a target spends to drop through the surface is charged by the DM, because nothing in state says the target is standing on a liquid',
    'the Ritual casting option is not modelled: a Ritual takes 10 minutes longer, and a casting time of a minute or more is refused until a casting-in-progress state machine exists',
  ],
};

/**
 * SRD Word of Recall:
 *
 * > _Level 6 Conjuration (Cleric)._ **Casting Time:** Action. **Range:** 5
 * > feet. **Duration:** Instantaneous.
 * > "You and up to five willing creatures within 5 feet of you instantly
 * > teleport to a previously designated sanctuary."
 *
 * Range 5 feet, which the engine checks per target like any other: a
 * companion standing ten feet away is refused. Where they *go* is a second
 * place and there is one scene, so the arrival is the DM's.
 */
export const WORD_OF_RECALL: SpellDefinition = {
  id: 'word-of-recall',
  name: 'Word of Recall',
  level: 6,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 5 },
  targets: { count: 5 },
  effects: [],
  unmodelled: [
    'the sanctuary is a second place and the engine holds one scene, so nobody is moved: the arrival is the DM’s',
    'designating a sanctuary by an earlier casting is not recorded, so a casting with no sanctuary prepared is not refused',
  ],
};

/**
 * SRD Divine Smite:
 *
 * > _Level 1 Evocation._ **Casting Time:** Bonus Action, which you take
 * > immediately after hitting a target with a Melee weapon or an Unarmed
 * > Strike. **Range:** Self. **Duration:** Instantaneous.
 * > "The target takes an extra 2d8 Radiant damage from the attack. The damage
 * > increases by 1d8 if the target is a Fiend or an Undead."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d8 for each
 * > spell slot level above 1."
 */
export const DIVINE_SMITE: SpellDefinition = {
  id: 'divine-smite',
  name: 'Divine Smite',
  level: 1,
  school: 'evocation',
  // The SRD's printed casting time is a Bonus Action with a trigger attached.
  // The trigger is the hit `resolveAttackDamage` is settling, so it is the
  // command rather than the definition that enforces it.
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [
    {
      kind: 'attack-damage',
      damage: { dice: '2d8', perSlotLevelAbove: '1d8' },
      damageType: 'radiant',
    },
  ],
  unmodelled: [
    'the extra 1d8 against a Fiend or an Undead is not applied: the damage is added before the target is looked at, and nothing yet varies a spell’s damage by the creature type it lands on',
  ],
};

/**
 * SRD Color Spray:
 *
 * > _Level 1 Illusion (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Instantaneous.
 * > "You launch a dazzling array of flashing, colorful light. Each creature in
 * > a 15-foot Cone originating from you must succeed on a Constitution saving
 * > throw or have the Blinded condition until the end of your next turn."
 *
 * **Instantaneous, with an effect that lasts.** That combination is the whole
 * reason riders needed their own deadline: the casting is over the moment it
 * happens, so there is no casting timer for the Blinded to hang on, and before
 * `lasts` this spell could not be written down at all.
 *
 * Range: Self, so the Cone starts at the caster and — being a Cone — does not
 * include them.
 */
export const COLOR_SPRAY: SpellDefinition = {
  id: 'color-spray',
  name: 'Color Spray',
  level: 1,
  school: 'illusion',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'cone', length: 15, origin: 'self' },
  effects: [
    {
      kind: 'save',
      ability: 'con',
      condition: 'blinded',
      lasts: 'end-of-casters-next-turn',
    },
  ],
};

/**
 * SRD Sunbeam:
 *
 * > _Level 6 Evocation (Cleric, Druid, Sorcerer, Wizard)._
 * > **Casting Time:** Action. **Range:** Self.
 * > **Duration:** Concentration, up to 1 minute.
 * > "You launch a sunbeam in a 5-foot-wide, 60-foot-long Line. Each creature
 * > in the Line makes a Constitution saving throw. On a failed save, a
 * > creature takes 6d8 Radiant damage and has the Blinded condition until the
 * > start of your next turn. On a successful save, it takes half as much
 * > damage only."
 *
 * The opposite proof to Color Spray. Here there *is* a casting deadline and it
 * is the wrong one by a wide margin: hanging the Blinded on the spell would
 * blind the target for a minute rather than for the part of a round the text
 * gives it. One save carries both the damage and the condition, which is why
 * the condition sits inside the `save-damage` effect rather than beside it.
 *
 * No upcast entry: SRD prints no "Using a Higher-Level Spell Slot" line for
 * Sunbeam, so a level 7 slot buys nothing but the casting.
 */
export const SUNBEAM: SpellDefinition = {
  id: 'sunbeam',
  name: 'Sunbeam',
  level: 6,
  school: 'evocation',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  area: { kind: 'line', length: 60, width: 5, origin: 'self' },
  effects: [
    {
      kind: 'save-damage',
      ability: 'con',
      damage: { dice: '6d8' },
      damageType: 'radiant',
      onSuccess: 'half',
      conditions: [{ name: 'blinded', lasts: 'start-of-casters-next-turn' }],
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'the Magic action that creates a new Line on a later turn: an activation resolves an attack at a named target and moves an area along a stated route, and resolving a **fresh** area in a direction chosen now is the shape Call Lightning waits on too',
    'the mote of radiance that sheds sunlight for the duration',
  ],
};

/**
 * Every spell the engine can resolve, **sorted by id and asserted to be**.
 *
 * Sorted because this is the one line every new spell touches, and two branches
 * that each add one should append in different places rather than fight over
 * the same hunk. `coverage.test.ts` holds the guard, along with the two things
 * a bad conflict resolution actually produces: a duplicated entry, and a spell
 * still declared above but no longer registered here.
 *
 * The definitions themselves stay in the order they were written, grouped by
 * mechanical shape. Reordering three thousand lines of them would buy nothing
 * and would itself be an unmergeable change.
 */
/**
 * SRD Minor Illusion:
 *
 * > _Illusion Cantrip (Bard, Sorcerer, Warlock, Wizard)._
 * > **Casting Time:** Action. **Range:** 30 feet. **Duration:** 1 minute.
 * > "You create a sound or an image of an object within range that lasts for
 * > the duration."
 * > "If a creature takes a Study action to examine the sound or image, the
 * > creature can determine that it is an illusion with a successful
 * > Intelligence (Investigation) check against your spell save DC."
 *
 * The whole spell is fiction except one sentence, and that sentence is
 * arithmetic. So the casting is tracked — the action, the minute on the clock
 * — and the check the engine owns is offered against it. The cantrip is the
 * proof that the DC comes off the caster's sheet rather than off a slot: there
 * is no slot.
 */
export const MINOR_ILLUSION: SpellDefinition = {
  id: 'minor-illusion',
  name: 'Minor Illusion',
  level: 0,
  school: 'illusion',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 60,
  check: { ability: 'int', skill: 'investigation', onSuccess: 'none' },
  // SRD: "The illusion ends if you cast this spell again."
  replacesPriorCasting: true,
  unmodelled: [
    'what the sound or image is, and whether anybody thinks to examine it, are the DM’s',
    'the image becoming faint to a creature that saw through it is narration; the engine records the roll and nothing else changes',
    'physical interaction revealing the image, and the 5-foot Cube it fits in, are the DM’s — objects are not modelled',
  ],
};

/**
 * SRD Silent Image:
 *
 * > _Level 1 Illusion (Bard, Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** 60 feet. **Duration:** Concentration, up to 10 minutes.
 * > "You create the image of an object, a creature, or some other visible
 * > phenomenon that is no larger than a 15-foot Cube."
 * > "A creature that takes a Study action to examine the image can determine
 * > that it is an illusion with a successful Intelligence (Investigation)
 * > check against your spell save DC."
 *
 * Minor Illusion's Concentration cousin, and the one that proves a check
 * survives on a Concentration casting's timer: break the Concentration and the
 * image — and the check against it — are gone together, because both hang on
 * the same casting.
 */
export const SILENT_IMAGE: SpellDefinition = {
  id: 'silent-image',
  name: 'Silent Image',
  level: 1,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  check: { ability: 'int', skill: 'investigation', onSuccess: 'none' },
  unmodelled: [
    'what the image is, where it stands, and whether anybody thinks to examine it are the DM’s',
    'the Magic action that moves the image on a later turn needs an ongoing effect a turn can act through',
    'seeing through the image is narration; the engine records the roll and nothing else changes',
  ],
};

/**
 * SRD Dispel Magic:
 *
 * > _Level 3 Abjuration (Bard, Cleric, Druid, Paladin, Ranger, Sorcerer,
 * > Warlock, Wizard)._ **Casting Time:** Action. **Range:** 120 feet.
 * > **Duration:** Instantaneous.
 * > "Choose one creature, object, or magical effect within range. Any ongoing
 * > spell of level 3 or lower on the target ends. For each ongoing spell of
 * > level 4 or higher on the target, make an ability check using your
 * > spellcasting ability (DC 10 plus that spell's level). On a successful
 * > check, the spell ends."
 * > _Using a Higher-Level Spell Slot._ "You automatically end a spell on the
 * > target if the spell's level is equal to or less than the level of the
 * > spell slot you use."
 *
 * **The definition carries no numbers**, and that is the whole point of it.
 * The threshold is the level this casting was made at, the DC is ten plus the
 * level of whatever is being ended, and both of those are facts the engine
 * holds about castings that are still running. A definition that restated
 * either would be a second place to get Dispel Magic wrong.
 *
 * Note what 2024 changed: **there is no check at all** below the threshold.
 * The 2014 habit of rolling for everything is a different spell.
 */
export const DISPEL_MAGIC: SpellDefinition = {
  id: 'dispel-magic',
  name: 'Dispel Magic',
  level: 3,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 120 },
  targets: { count: 1 },
  effects: [{ kind: 'dispel' }],
  unmodelled: [
    '"one creature, object, or magical effect" — only a creature can be named, because only a creature has a record to hand the engine; a spell running on nobody (an illusion, a wall) is reachable by no target',
  ],
};

/**
 * SRD Vampiric Touch:
 *
 * > _Level 3 Necromancy (Sorcerer, Warlock, Wizard)._ **Casting Time:**
 * > Action. **Range:** Self. **Duration:** Concentration, up to 1 minute.
 * > "Make a melee spell attack against one creature within reach. On a hit,
 * > the target takes 3d6 Necrotic damage, and you regain Hit Points equal to
 * > half the amount of Necrotic damage dealt."
 * > "Until the spell ends, you can make the attack again on each of your turns
 * > as a Magic action, targeting the same creature or a different one."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 3."
 *
 * The first spell the engine can use on a turn after the one it was cast on.
 * Three things make that possible and all three are facts pinned when the
 * casting began: **the level** (so the dice do not grow when the caster does),
 * **the route** (so the attack modifier is the one it was cast with), and
 * **the caster** (so nobody else can swing it).
 *
 * Range: Self is the transcription, and it is also why the spell is *on* the
 * wizard rather than on whoever is being drained — which is what Dispel Magic
 * needs to know.
 */
export const VAMPIRIC_TOUCH: SpellDefinition = {
  id: 'vampiric-touch',
  name: 'Vampiric Touch',
  level: 3,
  school: 'necromancy',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'melee',
      damage: { dice: '3d6', perSlotLevelAbove: '1d6' },
      damageType: 'necrotic',
      healsCasterForHalf: true,
    },
  ],
  durationSeconds: 60,
  activation: {
    action: 'action',
    // "targeting the same creature or a different one", and the attack is a
    // melee one — so five feet, checked afresh every time.
    range: { kind: 'touch' },
    label: 'Vampiric Touch (again)',
    effects: [
      {
        kind: 'attack',
        attack: 'melee',
        damage: { dice: '3d6', perSlotLevelAbove: '1d6' },
        damageType: 'necrotic',
        healsCasterForHalf: true,
      },
    ],
  },
  unmodelled: [
    'the *initial* attack\u2019s "within reach" goes unchecked: the spell\u2019s printed Range is Self, which is the reach the targeting rules read, and the five feet belong to the attack rather than to the spell. Every later use checks it',
  ],
};

/**
 * SRD Flame Blade:
 *
 * > _Level 2 Evocation (Druid, Sorcerer)._ **Casting Time:** Bonus Action.
 * > **Range:** Self. **Duration:** Concentration, up to 10 minutes.
 * > "You evoke a fiery blade in your free hand... **As a Magic action**, you
 * > can make a melee spell attack with the fiery blade. On a hit, the target
 * > takes Fire damage equal to 3d6 plus your spellcasting ability modifier."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 2."
 *
 * The second member of the later-turn family, and the one that proves the
 * shape is a shape: **the casting itself does nothing at all.** Evoking the
 * blade is not an attack, so the spell's own effect list is empty and every
 * blow it ever strikes comes through the activation.
 *
 * The blade is in the caster's hand, which is why this belongs to the family
 * that works today rather than to the one that does not: nothing has a
 * position except the caster, who already has one.
 */
export const FLAME_BLADE: SpellDefinition = {
  id: 'flame-blade',
  name: 'Flame Blade',
  level: 2,
  school: 'evocation',
  castingTime: 'bonus-action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 0 },
  effects: [],
  durationSeconds: 600,
  activation: {
    action: 'action',
    range: { kind: 'touch' },
    label: 'Flame Blade',
    effects: [
      {
        kind: 'attack',
        attack: 'melee',
        damage: { dice: '3d6', perSlotLevelAbove: '1d6' },
        damageType: 'fire',
        addSpellcastingModifier: true,
      },
    ],
  },
  unmodelled: [
    'letting go of the blade and evoking it again as a Bonus Action is not modelled: what is in a creature\u2019s hands is not tracked',
    'the Bright Light in a 10-foot radius and the Dim Light beyond it are the DM\u2019s; light is not modelled',
  ],
};

/**
 * SRD Produce Flame:
 *
 * > _Conjuration Cantrip (Druid)._ **Casting Time:** Bonus Action.
 * > **Range:** Self. **Duration:** 10 minutes.
 * > "A flickering flame appears in your hand and remains there for the
 * > duration. While there, the flame emits no heat and ignites nothing, and it
 * > sheds Bright Light in a 20-foot radius and Dim Light for an additional 20
 * > feet. The spell ends if you cast it again.
 * >
 * > Until the spell ends, you can take a Magic action to hurl fire at a
 * > creature or an object within 60 feet of you. Make a ranged spell attack.
 * > On a hit, the target takes 1d8 Fire damage."
 * > _Cantrip Upgrade._ "The damage increases by 1d8 when you reach levels 5
 * > (2d8), 11 (3d8), and 17 (4d8)."
 *
 * Flame Blade's shape at cantrip level, and the third member of the family:
 * the casting itself resolves nothing \u2014 conjuring a flame is not an attack \u2014
 * and every bolt the spell ever throws comes through the activation.
 *
 * **The 60 feet are the activation's, not the spell's.** SRD prints
 * **Range: Self**, because what the casting reaches is the caster's own hand;
 * the distance belongs to the fire being hurled, which is checked afresh on
 * each later turn. Putting 60 feet in `range` would let the casting itself be
 * aimed at somebody, which is not a thing this spell does.
 *
 * **And the dice read the caster, never a slot.** A cantrip has no slot to
 * scale with, so the upgrade is `cantripUpgradesAt` \u2014 the exact confusion that
 * once had a level 3 Wizard throwing Fire Bolt for 2d10.
 *
 * "The spell ends if you cast it again" is the sentence Mage Hand and Minor
 * Illusion print word for word, which is what makes
 * {@link SpellDefinition.replacesPriorCasting} a rule rather than a quirk.
 */
export const PRODUCE_FLAME: SpellDefinition = {
  id: 'produce-flame',
  name: 'Produce Flame',
  level: 0,
  school: 'conjuration',
  castingTime: 'bonus-action',
  concentration: false,
  // "Range: Self" \u2014 the flame appears in the caster's hand.
  range: { kind: 'self' },
  targets: { count: 0 },
  // Conjuring the flame is not an attack; the spell's whole content is below.
  effects: [],
  // "Duration: 10 minutes."
  durationSeconds: 600,
  // "The spell ends if you cast it again."
  replacesPriorCasting: true,
  activation: {
    // "you can take a Magic action to hurl fire".
    action: 'action',
    // "at a creature or an object within 60 feet of you" \u2014 measured from the
    // caster, which is why it is the activation's range rather than an origin.
    range: { kind: 'ranged', feet: 60 },
    label: 'Produce Flame (hurl)',
    effects: [
      {
        kind: 'attack',
        attack: 'ranged',
        // "1d8 Fire damage", upgraded at character levels 5, 11 and 17.
        damage: { dice: '1d8', cantripUpgradesAt: [5, 11, 17] },
        damageType: 'fire',
      },
    ],
  },
  unmodelled: [
    'the Bright Light in a 20-foot radius and the Dim Light beyond it are the DM\u2019s; light is not modelled',
  ],
};

// — Advantage and Disadvantage a spell grants ————————————————————————————————

/**
 * SRD Blur:
 *
 * > _Level 2 Illusion (Sorcerer, Wizard)._ **Casting Time:** Action.
 * > **Range:** Self. **Duration:** Concentration, up to 1 minute.
 * > "Your body becomes blurred. For the duration, **any creature has
 * > Disadvantage on attack rolls against you**. An attacker is immune to this
 * > effect if it perceives you with Blindsight or Truesight."
 *
 * The spell the `against-holder` relation exists for, and the reason the
 * comparative audit named a roll-modification target key as what the standing
 * Advantage family needed first. Everything else Blur wants the engine has had
 * for a long time: a Concentration casting, a minute on the clock, a durable
 * effect linked to the casting, and one final rule that settles modes. What it
 * had no way to say is that the mode belongs to somebody **else's** roll.
 *
 * Note what is *not* here: no number, no target list, no per-attacker
 * bookkeeping. "Any creature" is every creature, which is what a selector with
 * no filter on the roller means.
 */
export const BLUR: SpellDefinition = {
  id: 'blur',
  name: 'Blur',
  level: 2,
  school: 'illusion',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [
    {
      kind: 'roll-mode',
      modifier: {
        mode: 'disadvantage',
        selector: { roll: 'attack', relation: 'against-holder' },
      },
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'an attacker that perceives the target with Blindsight or Truesight is immune to the effect; the engine models no senses beyond declared sight, so every attacker rolls at Disadvantage',
  ],
};

/**
 * SRD Beacon of Hope:
 *
 * > _Level 3 Abjuration (Cleric)._ **Casting Time:** Action. **Range:** 30
 * > feet. **Duration:** Concentration, up to 1 minute.
 * > "Choose any number of creatures within range. For the duration, each
 * > target has **Advantage on Wisdom saving throws and Death Saving Throws**
 * > and regains the maximum number of Hit Points possible from any healing."
 *
 * Two effects for one sentence, and the sentence is why: a Death Saving Throw
 * is not a Wisdom saving throw and is not a saving throw of any ability at all
 * — "Unlike other saving throws, this one isn't tied to an ability score." One
 * ability-keyed grant covering both would either miss the death save or, keyed
 * loosely enough to catch it, catch every save in the game.
 *
 * It is therefore the spell that proves `death-save` is its own roll family
 * rather than a tidiness, and the mirror of Enhance Ability on the other side:
 * Advantage on Wisdom **saves** touches no Wisdom **check**.
 *
 * "Choose any number of creatures" names no count, which is what
 * `unlimited` says — range still bounds it, as it does for Compulsion.
 */
export const BEACON_OF_HOPE: SpellDefinition = {
  id: 'beacon-of-hope',
  name: 'Beacon of Hope',
  level: 3,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 0, unlimited: true, self: true },
  effects: [
    {
      kind: 'roll-mode',
      modifier: {
        mode: 'advantage',
        selector: { roll: 'saving-throw', relation: 'roller', ability: 'wis' },
      },
    },
    {
      kind: 'roll-mode',
      modifier: { mode: 'advantage', selector: { roll: 'death-save', relation: 'roller' } },
    },
  ],
  durationSeconds: 60,
  unmodelled: [
    'each target regains the maximum number of Hit Points possible from any healing; healing rolls its dice and nothing reads a maximise instruction, so a Cure Wounds on a target of this spell heals its rolled amount',
  ],
};

export const SPELL_DEFINITIONS: readonly SpellDefinition[] = [
  ACID_ARROW,
  ACID_SPLASH,
  ANIMAL_FRIENDSHIP,
  ARCANE_LOCK,
  ARCANE_SWORD,
  BANE,
  BANISHMENT,
  BEACON_OF_HOPE,
  BEFUDDLEMENT,
  BLACK_TENTACLES,
  BLESS,
  BLIGHT,
  BLINDNESS_DEAFNESS,
  BLUR,
  BURNING_HANDS,
  CHAIN_LIGHTNING,
  CHARM_MONSTER,
  CHARM_PERSON,
  CHILL_TOUCH,
  CIRCLE_OF_DEATH,
  CLOUDKILL,
  COLOR_SPRAY,
  COMPREHEND_LANGUAGES,
  COMPULSION,
  CONE_OF_COLD,
  CONTAGION,
  CONTINUAL_FLAME,
  COUNTERSPELL,
  CREATE_FOOD_AND_WATER,
  CURE_WOUNDS,
  DARKVISION,
  DEMIPLANE,
  DETECT_EVIL_AND_GOOD,
  DETECT_MAGIC,
  DETECT_POISON_AND_DISEASE,
  DISGUISE_SELF,
  DISINTEGRATE,
  DISPEL_MAGIC,
  DISSONANT_WHISPERS,
  DIVINE_SMITE,
  DOMINATE_BEAST,
  DOMINATE_MONSTER,
  DOMINATE_PERSON,
  ELDRITCH_BLAST,
  FALSE_LIFE,
  FEAR,
  FIND_TRAPS,
  FINGER_OF_DEATH,
  FIRE_BOLT,
  FIREBALL,
  FLAME_BLADE,
  FLAME_STRIKE,
  FLOATING_DISK,
  FLY,
  FREEZING_SPHERE,
  GENTLE_REPOSE,
  GREASE,
  GREATER_INVISIBILITY,
  GUIDANCE,
  GUIDING_BOLT,
  HARM,
  HEALING_WORD,
  HELLISH_REBUKE,
  HIDEOUS_LAUGHTER,
  HOLD_MONSTER,
  HOLD_PERSON,
  HYPNOTIC_PATTERN,
  ICE_STORM,
  INCENDIARY_CLOUD,
  INFLICT_WOUNDS,
  INSECT_PLAGUE,
  INVISIBILITY,
  JUMP,
  KNOCK,
  LIGHT,
  LIGHTNING_BOLT,
  LOCATE_ANIMALS_OR_PLANTS,
  LOCATE_CREATURE,
  LOCATE_OBJECT,
  LONGSTRIDER,
  MAGE_ARMOR,
  MAGE_HAND,
  MASS_CURE_WOUNDS,
  MASS_HEALING_WORD,
  MASS_SUGGESTION,
  MESSAGE,
  MIND_SPIKE,
  MINOR_ILLUSION,
  MISTY_STEP,
  MOONBEAM,
  MOVE_EARTH,
  NONDETECTION,
  PASSWALL,
  PHANTASMAL_KILLER,
  PLANE_SHIFT,
  POISON_SPRAY,
  PRESTIDIGITATION,
  PRODUCE_FLAME,
  RAY_OF_FROST,
  RAY_OF_SICKNESS,
  REMOVE_CURSE,
  ROPE_TRICK,
  SACRED_FLAME,
  SEE_INVISIBILITY,
  SHATTER,
  SHIELD,
  SHIELD_OF_FAITH,
  SHOCKING_GRASP,
  SILENT_IMAGE,
  SPEAK_WITH_ANIMALS,
  SPEAK_WITH_DEAD,
  SPIDER_CLIMB,
  SPIRIT_GUARDIANS,
  SPIRITUAL_WEAPON,
  STARRY_WISP,
  STONE_SHAPE,
  SUGGESTION,
  SUNBEAM,
  SUNBURST,
  TELEPATHIC_BOND,
  THUNDERWAVE,
  TONGUES,
  TRANSPORT_VIA_PLANTS,
  TRUE_SEEING,
  VAMPIRIC_TOUCH,
  VICIOUS_MOCKERY,
  VITRIOLIC_SPHERE,
  WALL_OF_FORCE,
  WATER_BREATHING,
  WATER_WALK,
  WEB,
  WEIRD,
  WORD_OF_RECALL,
];

export const definitionFor = (spellId: string): SpellDefinition | null =>
  SPELL_DEFINITIONS.find((spell) => spell.id === spellId) ?? null;

/**
 * The dice a spell rolls, at this caster level and this slot level.
 *
 * A cantrip reads the caster's level and ignores the slot, because it has
 * none; a levelled spell reads the slot and ignores the level. Conflating the
 * two is how a level 3 Wizard ends up throwing a level 5 Fire Bolt.
 *
 * Damage and healing both come through here: the arithmetic is the same, and
 * the SRD writes both upcasts in the same sentence shape.
 */
export function scaledDiceFor(
  scaling: DiceScaling,
  spellLevel: number,
  casterLevel: number,
  slotLevel: number,
): string {
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
