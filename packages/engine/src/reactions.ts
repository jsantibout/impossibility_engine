import { type Ability, type CharacterId } from '@ie/shared';
import type { D20TestKind } from './checks.js';
import { abilityModifier } from './character.js';
import { isIncapacitated } from './conditions.js';
import { distanceBetween } from './positioning.js';
import { remaining } from './resources.js';
import { canSee } from './standing.js';
import type { GameState } from './events.js';
import type { FallMoment } from './state.js';

/**
 * The moments a Reaction can answer, named once for everything that answers
 * them.
 *
 * Spells had their own vocabulary — `SpellDefinition.trigger` — and class
 * features had none at all, which is how eight features spent eleven batches
 * saying *"needs an interrupt the engine does not have"* while the arithmetic
 * they needed (`reduceDamage`, `interveneAfterRoll`, `rerollTest`) sat written
 * and unreachable. The temptation at that point is a general trigger bus. The
 * SRD does not ask for one: it asks for a **small finite set of mechanically
 * real instants**, each of which is a point in a resolution the engine already
 * performs.
 *
 * So this is that set, and it is a set rather than a framework because every
 * member is here on the strength of concrete rules that name it:
 *
 * | Window | What is already true | What is not yet decided | Who names it |
 * |---|---|---|---|
 * | `hit-by-attack` | the attack roll hit | the damage roll | *Shield*; seven monsters' Parry; the Shield Guardian |
 * | `damage-rolled` | the damage roll, by type | the damage the target takes | Uncanny Dodge, Deflect Attacks, Cutting Words, the Stone Giant |
 * | `damaged-by-creature` | **everything** — the damage landed | nothing | *Hellish Rebuke*, Retaliation |
 * | `test-rolled` | the d20's total, and whether it beat the DC | the effects of that outcome | Indomitable, Dark One's Own Luck, Peerless Skill, Cutting Words, the Sphinx |
 * | `casting-a-spell` | the casting is declared and the action spent | the slot, the effects | *Counterspell* |
 * | `targeted-by-spell` | the casting is declared and its targets are fixed | its effects, on each of them | *Shield*'s second trigger |
 * | `creature-falling` | the table has said a creature is falling | how far, how long, and what it lands on | *Feather Fall*; the Monk's Slow Fall |
 *
 * **Six of the seven are points in a resolution; the last is a declaration.**
 * `creature-falling` is open because somebody at the table said so rather than
 * because the engine is in the middle of something, which is what it costs to
 * name an instant the engine has no other way to see — and the reason it is
 * still a *window* rather than a trigger bus is that it closes on the same two
 * facts as the rest and holds nothing open.
 *
 * **`damaged-by-creature` is in both columns**, and that overlap is the
 * evidence this vocabulary is shared rather than merely tidy: a spell
 * (*Hellish Rebuke*) and a class feature (Retaliation) answer the same instant
 * under the same rule, and there is exactly one place that decides whether the
 * instant is still open. `hit-by-attack` is the second such member and the
 * same evidence again — *Shield* answers it with a spell and seven stat blocks
 * answer it with Parry, which is the same sentence about the same number.
 *
 * **What this deliberately is not.** There is no predicate language, no
 * registry, no subscription and no ordering engine. A window is a named point
 * in a resolution path, and adding one means adding a point to a path — which
 * is why two of the seven arrived with the mechanics that needed them, three
 * were already there under other names, one arrived with a fact the table
 * declares, and the seventh is a stop in a path the engine already walks: a
 * casting that has been declared and not yet resolved.
 */
export type ReactionWindow =
  /** SRD *Shield*: "when you are hit by an attack roll". Damage is unrolled. */
  | 'hit-by-attack'
  /**
   * SRD Cutting Words: "when a creature ... **makes a damage roll**".
   *
   * The damage is rolled and typed and **nothing has been applied** — no hit
   * points have moved, no Concentration save has been asked for. That is the
   * only honest place for a rule that reduces "the attack's total damage
   * against you", because the total has to exist and must not yet have landed.
   */
  | 'damage-rolled'
  /**
   * SRD *Hellish Rebuke*: "in response to taking damage from a creature that
   * you can see"; SRD Retaliation: "When you take damage from a creature that
   * is within 5 feet of you".
   *
   * Everything is settled. A reaction here answers what happened and cannot
   * change it, which is exactly why it needs no pending state of any kind.
   */
  | 'damaged-by-creature'
  /**
   * SRD Dark One's Own Luck: "You can do so **after seeing the roll but before
   * any of the roll's effects occur**."
   *
   * The SRD writes this window out in a single clause, which is what makes it
   * a real instant rather than a convenient one. The total and the
   * success/failure are known; nothing has been done about them.
   */
  | 'test-rolled'
  /** SRD *Counterspell*: "a creature in the process of casting a spell". */
  | 'casting-a-spell'
  /**
   * SRD *Shield*: "Reaction, which you take when you are hit by an attack roll
   * **or targeted by the *Magic Missile* spell**."
   *
   * The seventh, and a point in a resolution like the first five rather than a
   * declaration like `creature-falling`: a casting that has been declared has
   * settled its targets and has not resolved its effects, which is exactly the
   * state `pendingCastings` already holds for *Counterspell*. The difference
   * between the two is who may answer — Counterspell answers *the caster*, and
   * this answers as one of *the targets* — and what the answer is allowed to
   * change.
   *
   * **It opens where the casting is declared and nowhere else.** A casting
   * resolved in one command has no seam between its targets and its effects —
   * SRD Magic Missile settles both in a breath — so what opens the window is
   * the same `hold` that opens Counterspell's, and a caller who wants the
   * defender to have their say asks for the declaration. That is stated rather
   * than worked around: an engine that held every casting open would make
   * every Fire Bolt a two-command negotiation, which is the rule
   * {@link offersForDamage} already keeps about a damage roll nobody can
   * answer.
   */
  | 'targeted-by-spell'
  /**
   * SRD *Feather Fall*: "when you or a creature you can see within 60 feet of
   * you **falls**"; SRD Slow Fall: "when you fall".
   *
   * **The first window opened by a declaration rather than by a resolution**,
   * and that is the whole of what is new about it. Every other member is a
   * point in something the engine is in the middle of doing — an attack it
   * rolled, damage it typed, a test it settled, a casting it is holding — and
   * the moment is open because the engine has not finished. Nothing in the
   * engine drops a creature off anything, so this one is open because somebody
   * at the table said a fall happened, exactly as they say where the cover is.
   *
   * It closes by the rule {@link damageWindowOpen} already writes and for the
   * same reason: "when you fall" means now, the finest grain the engine has
   * for now is the turn, and outside combat the clock stands in for it. A
   * creature nobody said fell is not falling — a fact the log does not hold is
   * false here, not unknown, which is what keeps a Reaction spell from being
   * unlocked by inventing its trigger.
   */
  | 'creature-falling';

/**
 * The windows a **spell** answers.
 *
 * A narrowing rather than the whole union, so `triggerRefusal` stays
 * exhaustive over exactly the moments SRD spells name. A case written for a
 * window no spell uses would be a rule nothing could reach.
 */
export type SpellReactionWindow = Extract<
  ReactionWindow,
  | 'hit-by-attack'
  | 'damaged-by-creature'
  | 'casting-a-spell'
  | 'creature-falling'
  | 'targeted-by-spell'
>;

/**
 * The windows a **feature** answers — a class's, or a stat block's.
 *
 * Also a narrowing, and the two lists overlap in two members on purpose — see
 * {@link ReactionWindow}. No SRD *class* feature answers `hit-by-attack`: the
 * two that look as though they might (Uncanny Dodge, Deflect Attacks) are
 * triggered by the hit and **act on the damage**, so they belong to
 * `damage-rolled`. A **stat block** answers it in as many words — SRD Parry
 * adds to an Armour Class against the triggering attack, which is *Shield*'s
 * own sentence worn by a creature, and SRD Reflexive Antennae answers the same
 * instant by using another line of its block. So the member is here because
 * the book writes it, and it arrived with the two effects that write it.
 *
 * `creature-falling` is absent, and deliberately: the Monk's Slow Fall names
 * that window in as many words and *does* something this engine cannot — it
 * reduces "any damage you take from the fall", and falling damage is a table
 * ruling with a height nobody holds. A window a feature could name and no
 * feature could answer would be an offer the command layer had to refuse.
 */
export type FeatureReactionWindow = Extract<
  ReactionWindow,
  'hit-by-attack' | 'damage-rolled' | 'damaged-by-creature' | 'test-rolled'
>;

/**
 * Something added to a reaction's die at the moment it is used.
 *
 * SRD Deflect Attacks: "1d10 plus your Dexterity modifier **and** Monk level"
 * — two addends on one feature, which is why this is a list where
 * {@link HealAmount} has a single `plus`. The ability case is resolved when the
 * die is thrown rather than at creation, on the same rule every conditional
 * benefit in `standing.ts` follows: a number written down at creation goes on
 * being the old one.
 */
export type ReactionAddend =
  | { readonly kind: 'ability'; readonly ability: Ability; readonly label: string }
  /** Resolved at creation, because it is a column of *that class's* table. */
  | { readonly kind: 'level'; readonly level: number; readonly label: string }
  /**
   * A number the sentence simply prints.
   *
   * SRD Sphinx of Wonder, Burst of Ingenuity: "The sphinx **adds 2** to the
   * roll." Neither of the two above it: nothing about the holder decides it,
   * so there is nothing to read off a sheet and nothing a class table could
   * have said. A stat block prints its numbers, which is the same argument
   * `StatedValues` makes about every other number on one.
   *
   * **Not `level` with the level renamed**, which would have worked and would
   * have been a lie the log repeated: a reader asking where a reaction's
   * arithmetic came from would be told a class level that no creature here
   * has.
   */
  | { readonly kind: 'flat'; readonly amount: number; readonly label: string };

/**
 * How much a reaction is worth.
 *
 * Two shapes, because the SRD writes two. Deflect Attacks and Cutting Words
 * roll something; Uncanny Dodge halves. `halve` is not a die of any size, so
 * it is its own field rather than a notation nobody could write.
 */
export interface ReactionAmount {
  /** "1d10", or the Bardic Inspiration die resolved off the class table. */
  readonly dice?: string;
  readonly plus?: readonly ReactionAddend[];
  /** SRD Uncanny Dodge: "halve the attack's damage against you (round down)." */
  readonly halve?: true;
}

/**
 * What a reaction actually does, once the engine has agreed it may happen.
 *
 * Five members for ten features, and each member exists because at least two
 * features write it. The fifth is `damage-back`, and its second writer is not a
 * feature at all: SRD Hellish Rebuke says the same sentence as a *spell* on the
 * same window, which is the evidence the rule asks for — a shape two
 * independent sentences reach for rather than one trait's quirk. A feature
 * whose effect fits none of them is `manual` with a note — the same answer
 * `FeatureGrant` gives, and the honest one far more often than a sixth member
 * would be.
 */
export type ReactionEffect =
  /**
   * Take damage off a roll that has been made and not yet applied.
   *
   * SRD Uncanny Dodge ("halve the attack's damage against you"), Deflect
   * Attacks ("reduce the attack's total damage against you") and Cutting Words
   * ("subtract the number rolled from the creature's roll, reducing the
   * damage").
   */
  | {
      readonly kind: 'reduce-damage';
      readonly amount: ReactionAmount;
      /**
       * SRD Deflect Attacks: "its damage **includes** Bludgeoning, Piercing,
       * or Slashing damage". Absent, the feature answers any damage — which is
       * literally what Deflect Energy does to this list.
       */
      readonly damageTypes?: readonly string[];
      /**
       * SRD: "When an attack roll hits you". Absent for Cutting Words, which
       * answers a damage roll however it arose.
       */
      readonly fromAttackOnly?: true;
    }
  /**
   * Push a D20 Test that has landed, in either direction.
   *
   * SRD Dark One's Own Luck adds, Cutting Words subtracts, and Peerless Skill
   * adds to your own — one mechanism with a sign, which is the argument
   * `interveneAfterRoll` already settled for itself.
   */
  | {
      readonly kind: 'intervene';
      readonly amount: ReactionAmount;
      readonly direction: 'bonus' | 'penalty';
      /** Which D20 Tests the feature's own sentence names. */
      readonly tests: readonly D20TestKind[];
      /** Whether it answers a failure, a success, or says nothing either way. */
      readonly outcome: 'failure' | 'success' | 'either';
      /**
       * SRD Peerless Skill: "On a failure, the Bardic Inspiration **isn't
       * expended**."
       *
       * The one feature whose cost depends on whether it worked, which is why
       * the spend happens after the new total is known rather than before it.
       */
      readonly refundedOnFailure?: true;
    }
  /**
   * Roll the test again and keep the new number.
   *
   * SRD Indomitable: "You **must use the new roll**." Every feature that writes
   * this answers a **failure** and nothing else, so there is no `outcome` field
   * — a field with one possible value is a field nothing reads. Heroic
   * Inspiration's "any die" is narrowed to that deliberately; `progression.ts`
   * says why.
   */
  | {
      readonly kind: 'reroll';
      readonly bonus?: ReactionAddend;
      /** The tests it answers; absent is a saving throw alone. */
      readonly tests?: readonly D20TestKind[];
    }
  /**
   * Swing back.
   *
   * SRD Retaliation: "you can take a Reaction to make one melee attack against
   * that creature, using a weapon or an Unarmed Strike." It changes nothing
   * about the damage that provoked it, which is the whole reason its window
   * needs no pending state.
   */
  | { readonly kind: 'melee-attack'; readonly withinFeet: number }
  /**
   * Throw dice back.
   *
   * SRD Storm's Thunder: "When you take damage from a creature within 60 feet
   * of you, you can take a Reaction to deal 1d8 Thunder damage to that
   * creature." Like {@link melee-attack} it changes nothing about the damage
   * that provoked it, which is why its window needs no pending state; unlike
   * it there is no attack roll, no weapon and no reach — the dice simply land,
   * through the funnel every other spell's damage goes through.
   *
   * SRD Hellish Rebuke is the same sentence as a spell on the same window,
   * which is the second writer this member's own rule asks for: a spell states
   * it through `trigger` and `save-damage`, and until now a feature could say
   * nothing of the kind.
   */
  | {
      readonly kind: 'damage-back';
      readonly dice: string;
      readonly damageType: string;
      /** SRD's "within 60 feet of you", measured to whoever dealt the damage. */
      readonly within: number;
    }
  /**
   * Raise the Armour Class against the attack that triggered this, and no
   * further.
   *
   * SRD Parry: "The knight adds 2 to its AC against that attack, possibly
   * causing it to miss." Seven stat blocks print it and it is *Shield*'s
   * sentence with the span taken off — the spell's +5 lasts until the start of
   * the caster's next turn and is therefore a standing bonus; this one is
   * spent by the blow it answered, so nothing is granted and nothing ends.
   *
   * That is why the number is here rather than a `StandingEffect`: a bonus
   * that exists for one comparison has nowhere to live but the comparison.
   * `reconsiderHeldAttack` is where it is made, against the Armour Class the
   * swing was actually measured against — cover and all — for the reason
   * `deflectTriggeringAttack` states about the same arithmetic.
   */
  | {
      readonly kind: 'raise-ac';
      readonly amount: number;
      /** SRD Parry: "hit by a **melee** attack roll". */
      readonly meleeOnly?: true;
      /** SRD Parry: "**while holding a weapon**". */
      readonly requiresWeapon?: true;
    }
  /**
   * Use a line the creature's own stat block prints, by its heading.
   *
   * SRD Rust Monster, Reflexive Antennae: "_Trigger:_ An attack roll hits the
   * rust monster. _Response:_ The rust monster uses Antennae." The trigger is
   * a window this engine holds and the response is *somewhere else on the
   * block*, which is what makes this a shape rather than an effect: what
   * happens is whatever that line turns out to be.
   *
   * **The second sentence that writes it is the Nalfeshnee's Pursuit** — "The
   * nalfeshnee uses Teleport" — at a window the engine does not hold and with
   * a clause about where the teleport may land, so the parser refuses that
   * line whole. One shape, two sentences, one of them readable today.
   *
   * **Nothing performs it yet, and the command says so.** The Reaction is
   * offered and spent and the response is handed to the table by name, which
   * is the honest half: the rust monster's Antennae is a save nothing has
   * read, and a response half-performed would be a creature doing something
   * nobody printed.
   */
  | { readonly kind: 'use-printed-line'; readonly line: string }
  /**
   * Take the failure back: the roll stands and the outcome is a success.
   *
   * SRD Legendary Resistance: "If the unicorn fails a saving throw, it can
   * choose to succeed instead."
   *
   * **The third answer at `test-rolled`, and the only one that produces no
   * number.** `intervene` adds or subtracts and `reroll` throws again; this
   * touches the die not at all — the roll stays in the log exactly as it fell
   * and `D20TestResult.autoSucceeded` names the rule, which is the field that
   * already means "why this succeeded regardless of the roll". So there is
   * nothing to carry: no amount, no dice, no sign.
   *
   * **It answers a failed saving throw and nothing else**, which is why it
   * needs neither a `tests` list nor an `outcome`: the sentence names one
   * family and one outcome, and a field with one possible value is a field
   * nothing reads — the reasoning {@link reroll} already records. And it
   * answers the roller's *own* save, so the feature's reach is `self`.
   *
   * **It costs no Reaction**, which is the feature's business rather than this
   * member's — see {@link ReactionFeature.costsReaction}. The book limits it
   * with a pool and says nothing about the action economy. (W7-B11)
   */
  | { readonly kind: 'succeed-instead' };

/**
 * Who gave a Reaction away, and under what source it will end.
 *
 * Both halves are read: the source is what `releaseGrants` matches when the
 * hour passes or the use spends it, and the giver is what a narrating layer
 * needs in order to say whose die this was without opening a catalogue.
 */
export interface GrantedMark {
  readonly source: string;
  readonly from: CharacterId;
}

/**
 * A Reaction hung on a creature by somebody else — the tenth sourced family.
 *
 * The shape the nine before it keep: a `source` at the top, which is the whole
 * of what an ending matches on, and the payload beneath it. The payload here
 * is a whole {@link ReactionFeature} with its numbers already resolved, pinned
 * at the moment of conferral — so an ally still holding a Bard's die when the
 * Bard levels up holds the die they were given.
 */
export interface GrantedReaction {
  readonly source: string;
  /** Whose feature it was. Not the holder. */
  readonly from: CharacterId;
  readonly reaction: ReactionFeature;
}

/**
 * What a feature confers, once creation has read its class table.
 *
 * `ConferredReactionGrant` resolved: the die is a die, the range and the hour
 * are numbers, and what is left is the command's whole input. It sits on the
 * sheet beside `reactions` because it is the same kind of fact — what this
 * character can do, read off the class table once — and is the twin of
 * `healingTouch`, which is `touchHeals` resolved the same way.
 */
export interface ConferrableReaction {
  readonly feature: string;
  readonly name: string;
  readonly action: 'action' | 'bonus-action';
  readonly range: number;
  readonly pool: string;
  readonly durationSeconds: number;
  readonly requiresSightOrHearing?: true;
  readonly excludesSelf?: true;
  /** What the recipient ends up holding, minus the source and the giver. */
  readonly confers: readonly ReactionFeature[];
}

/**
 * Every Reaction a creature may take right now: their sheet's, and everything
 * anybody has hung on them.
 *
 * **One reader, because there were three.** `featuresFor`, `reactionFeatureOf`
 * and `reactionOpportunities` each reached into `sheet.reactions` by hand, and
 * a granted Reaction visible to two of the three would be an offer that could
 * not be taken, or one taken that was never offered.
 *
 * Granted ones come last and in the order the fold keeps them — sorted by
 * source — so two readers of the same state agree about the order and the log
 * compares byte for byte.
 */
export function reactionsOf(creature: {
  readonly sheet: { readonly reactions?: readonly ReactionFeature[] };
  readonly grantedReactions: readonly GrantedReaction[];
}): readonly ReactionFeature[] {
  const own = creature.sheet.reactions ?? [];
  if (creature.grantedReactions.length === 0) return own;
  return [
    ...own,
    ...creature.grantedReactions.map((held) => ({
      ...held.reaction,
      granted: { source: held.source, from: held.from },
    })),
  ];
}

/** How far a reaction reaches from the creature taking it. */
export type ReactionReach =
  | { readonly kind: 'self' }
  /** SRD Cutting Words: "a creature that you can see within 60 feet". */
  | { readonly kind: 'within'; readonly feet: number }
  /**
   * SRD Sphinx of Wonder: "The sphinx **or** another creature within 30 feet".
   *
   * The union of the two above it, and a third member rather than a flag
   * because it is a third sentence the book actually writes: SRD *Feather
   * Fall* says "you or a creature you can see within 60 feet of you falls" in
   * the same shape. `within` alone excludes the roller — which is right for
   * Cutting Words, where the Bard is answering somebody else's roll and
   * "another creature" is the whole of what the clause says — and a feature
   * whose sentence names its holder first would silently lose the case the
   * SRD wrote it for.
   */
  | { readonly kind: 'self-or-within'; readonly feet: number };

/**
 * A Reaction a class feature offers, resolved at creation onto the sheet.
 *
 * On the sheet for the reason `standing` and `activated` are: what a feature
 * is worth is read off a class table, and re-deriving a class table on every
 * attack is not a thing to do in a reducer.
 *
 * **`costsReaction` is a real field and not a constant.** Four of the nine
 * features here are Reactions and five are not: Indomitable, Disciplined
 * Survivor, Dark One's Own Luck, Peerless Skill and the holder's own use of a
 * Bardic Inspiration die all sit in the `test-rolled` window and cost no
 * Reaction at all — they cost a pool use and nothing else. Treating the window
 * and the action-economy cost as one thing would have made every one of them
 * wrong, and it is the single most common mistake about this corner of the
 * rules.
 */
export interface ReactionFeature {
  readonly feature: string;
  readonly name: string;
  /**
   * Present exactly when this Reaction was **given** to its holder rather than
   * compiled onto their sheet.
   *
   * A sheet's Reactions are what the character *is*, re-read from the class
   * table on every look; a granted one is a thing somebody did to them, with a
   * source that ends it and a giver who is not the holder. Everything else
   * about the two is identical, which is why this is a mark on the shape
   * rather than a second shape: `canAfford`, `reaches`, `offerOf` and the
   * arithmetic all read it without knowing which kind they have.
   */
  readonly granted?: GrantedMark;
  readonly window: FeatureReactionWindow;
  /** Whether the SRD spends a Reaction on it. Often it does not — see above. */
  readonly costsReaction: boolean;
  /** The pool one use comes out of, or null where the feature is free. */
  readonly pool: string | null;
  readonly reach: ReactionReach;
  /**
   * SRD Uncanny Dodge: "an attacker **that you can see**"; Cutting Words: "a
   * creature **that you can see** within 60 feet".
   *
   * Who must see whom is uniform: the reactor must see the creature whose roll
   * they are answering. A feature whose sentence says nothing about sight
   * leaves this absent, and a declared-unseen creature is then no obstacle.
   */
  readonly requiresSight?: true;
  readonly does: ReactionEffect;
}

/**
 * One creature's standing opportunity to answer an open window.
 *
 * Kept **on the pending record in `GameState`**, so a reload rebuilds exactly
 * who still owes an answer — the same reason `pendingMove.provoked` holds its
 * list rather than recomputing it. What it does *not* hold is the feature's
 * arithmetic: that is read off the sheet when the reaction is actually taken,
 * so a cap or a die size that has moved is the current one.
 */
export interface ReactionOffer {
  readonly reactor: CharacterId;
  readonly feature: string;
  /** The feature's display name, so a narrating layer needs no lookup. */
  readonly name: string;
  readonly costsReaction: boolean;
  /** The pool a use would come from, or null. */
  readonly pool: string | null;
  /**
   * Present exactly when somebody gave this Reaction to its holder.
   *
   * On the offer as well as on the feature because two of them can be alike in
   * every other field — the same feature, given to the same ally, by two
   * different creatures — and an offer a caller cannot tell from another offer
   * is one they cannot report either. Only `takeTestReaction` takes a `from`
   * to say *which* one is being spent today; the other two windows' commands
   * take the first, which is the order the fold keeps.
   */
  readonly granted?: GrantedMark;
}

/** What the engine could not check when it worked out who may answer. */
export interface ReactionOffers {
  readonly offers: readonly ReactionOffer[];
  readonly unverified: readonly string[];
}

/**
 * What a reaction adds to its die, and what to call it in the log.
 *
 * The ability case is read from the sheet at the moment of use; the level case
 * was fixed when the character was built. Same split as `selfHealAddend`.
 */
export function reactionAddends(
  amount: ReactionAmount,
  abilities: Readonly<Record<Ability, number>>,
): { readonly total: number; readonly labels: readonly string[] } {
  let total = 0;
  const labels: string[] = [];
  for (const addend of amount.plus ?? []) {
    total +=
      addend.kind === 'level'
        ? addend.level
        : addend.kind === 'flat'
          ? addend.amount
          : abilityModifier(abilities[addend.ability]);
    labels.push(addend.label);
  }
  return { total, labels };
}

/**
 * Whether a creature could spend what this feature costs right now.
 *
 * Three things and no more: they are able to act at all, they still have the
 * Reaction if the feature needs one, and the pool has a use left. The Reaction
 * is only checked **in combat** — outside it there is no economy to spend, the
 * same reading `resolveCast`, `activateFeature` and `useSelfHeal` all take.
 */
function canAfford(state: GameState, reactor: CharacterId, feature: ReactionFeature): boolean {
  const creature = state.creatures[reactor];
  if (creature === undefined) return false;
  if (creature.vitals.dead) return false;
  // SRD Incapacitated: "You can't take any action, Bonus Action, or Reaction."
  // A feature that costs no Reaction is still the holder acting, and the
  // Monk's own text says so out loud on Evasion; nothing here is available to
  // a creature that cannot act.
  if (isIncapacitated(creature.conditions)) return false;

  if (feature.costsReaction && state.combat !== null) {
    const budget = state.combat.budgets[reactor];
    if (budget !== undefined && !budget.reaction) return false;
  }

  if (feature.pool !== null && remaining(creature.resources, feature.pool) < 1) return false;

  return true;
}

/**
 * Whether the reactor is close enough to the creature they are answering, and
 * can see them.
 *
 * Three-valued throughout, and the two unknowns are answered differently on
 * purpose — the same split `provokedBy` already makes:
 *
 * - **An unplaced creature is not offered a ranged reaction.** Where somebody
 *   is standing has no right answer until it is declared, and inventing one to
 *   hand out a Reaction is the wrong direction to guess in.
 * - **An undeclared sight line does not withhold the offer.** Absence from
 *   state is not evidence of blindness, and withholding a whole Reaction on
 *   that basis would be the engine deciding a fact nobody has established.
 *
 * Both are reported, because a Reaction the table was never told about is
 * exactly the sort of thing that vanishes silently.
 */
function reaches(
  state: GameState,
  reactor: CharacterId,
  feature: ReactionFeature,
  actor: CharacterId | null,
  unverified: string[],
): boolean {
  if (feature.reach.kind === 'self') {
    // "An attacker that you can see": the reactor's own sight of whoever acted.
    if (feature.requiresSight !== true || actor === null || actor === reactor) return true;
    return seen(state, reactor, actor, feature, unverified);
  }

  if (actor === null) return false;
  // **"The sphinx or another creature"**: the holder's own roll is one the
  // sentence names, and nothing about distance or sight is asked about a
  // creature answering itself — which is the reading the `self` arm above
  // already takes of the same fact.
  if (reactor === actor) return feature.reach.kind === 'self-or-within';
  if (state.scene === null) {
    unverified.push(
      `no scene is set, so ${reactor} was not offered ${feature.name} against ${actor}`,
    );
    return false;
  }

  const apart = distanceBetween(state.scene, reactor, actor);
  if (!apart.ok) {
    unverified.push(
      `nobody has said where ${reactor} and ${actor} are standing, so ${feature.name} was not offered`,
    );
    return false;
  }
  if (apart.value > feature.reach.feet) return false;

  return feature.requiresSight !== true || seen(state, reactor, actor, feature, unverified);
}

function seen(
  state: GameState,
  reactor: CharacterId,
  actor: CharacterId,
  feature: ReactionFeature,
  unverified: string[],
): boolean {
  // **The reactor's senses.** `ReactionFeature.requiresSight` says who must
  // see whom — "the reactor must see the creature whose roll they are
  // answering" — so the looker is the reactor, and the Bard's Darkvision is
  // what settles Cutting Words rather than the Ogre's.
  const line = canSee(state, reactor, actor);
  if (line === false) return false;
  if (line === null) {
    unverified.push(
      `nobody has said whether ${reactor} can see ${actor}, and ${feature.name} needs that; the offer was made rather than withheld`,
    );
  }
  return true;
}

/** Every reaction feature a creature has for one window, granted ones included. */
function featuresFor(
  state: GameState,
  who: CharacterId,
  window: FeatureReactionWindow,
): readonly ReactionFeature[] {
  const creature = state.creatures[who];
  if (creature === undefined) return [];
  return reactionsOf(creature).filter((r) => r.window === window);
}

/**
 * The order two features are offered in, which a fold compares byte for byte.
 *
 * The feature id first, as it always was, and the source second — because two
 * creatures may have given the same ally the same feature, and an order that
 * left those two to the sort's own stability would be an order that depended
 * on the order the grants arrived in.
 */
const byFeature = (a: ReactionFeature, b: ReactionFeature): number =>
  a.feature.localeCompare(b.feature) ||
  (a.granted?.source ?? '').localeCompare(b.granted?.source ?? '');

/** What the `damage-rolled` window is being asked about. */
export interface DamageContext {
  readonly target: CharacterId;
  /** Who dealt it, or null where nobody did — a trap has no attacker to see. */
  readonly by: CharacterId | null;
  /** An attack roll caused it, which two features require and one does not. */
  readonly fromAttack: boolean;
  /** The damage types present, for Deflect Attacks' clause. */
  readonly damageTypes: readonly string[];
}

/**
 * Who may answer a damage roll that has been made and not yet applied.
 *
 * **An empty list is the common case and the important one.** A window that
 * opens whenever damage is rolled would make every swing of every sword a
 * two-command negotiation; one that opens only when a creature actually has
 * something to spend leaves the ordinary attack exactly as atomic as it was.
 * That is not an optimisation — it is the rule `pendingMove` already follows,
 * where a move that provokes nobody simply happens.
 *
 * Sorted by reactor and then feature, so two readers of the same state agree
 * about the order, and so the fold compares byte for byte.
 */
export function offersForDamage(state: GameState, context: DamageContext): ReactionOffers {
  const offers: ReactionOffer[] = [];
  const unverified: string[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const reactor = key as CharacterId;
    for (const feature of [...featuresFor(state, reactor, 'damage-rolled')].sort(byFeature)) {
      if (feature.does.kind !== 'reduce-damage') continue;

      // SRD Uncanny Dodge and Deflect Attacks both begin "When an attack roll
      // hits you"; Cutting Words does not, and answers a damage roll from
      // anywhere the engine rolls one.
      if (feature.does.fromAttackOnly === true && !context.fromAttack) continue;

      // SRD Deflect Attacks: "its damage includes Bludgeoning, Piercing, or
      // Slashing damage" — *includes*, so one qualifying type is enough.
      const wanted = feature.does.damageTypes;
      if (wanted !== undefined && !context.damageTypes.some((t) => wanted.includes(t))) continue;

      // A self-reaching feature answers damage aimed at its own holder.
      // A reaching one answers somebody else's *roll* — Cutting Words is "a
      // creature that you can see within 60 feet ... makes a damage roll", so
      // the distance is to whoever rolled, and a Bard may well be the target
      // of the blow they are cutting. `reaches` below excludes the roller
      // themselves, which is the whole of "a creature that you can see".
      if (feature.reach.kind === 'self' && reactor !== context.target) continue;

      if (!canAfford(state, reactor, feature)) continue;
      if (!reaches(state, reactor, feature, context.by, unverified)) continue;

      offers.push(offerOf(reactor, feature));
    }
  }

  return { offers, unverified };
}

/** What the `hit-by-attack` window is being asked about. */
export interface AttackContext {
  readonly target: CharacterId;
  readonly attacker: CharacterId;
  /** Whether the swing was a melee one, which SRD Parry's trigger names. */
  readonly melee: boolean;
  /**
   * Whether the target has a weapon in hand — `null` where nobody has said.
   *
   * Three-valued for {@link reaches}' reason and answered the same way: a
   * stat block prints its gear and **nothing reads it**, so a knight nobody
   * has equipped is a knight whose hands are undeclared rather than one
   * standing there empty-handed. An undeclared fact does not withhold a whole
   * Reaction; a declared one that is false does.
   */
  readonly holdsAWeapon: boolean | null;
  /**
   * Whether the target can see the attacker — `null` where nobody has said.
   *
   * The same three values and the same reading {@link seen} takes for the
   * other windows: absence from state is not evidence of blindness. No SRD
   * line under this heading prints the clause, so it decides nothing today and
   * is here because a feature carrying `requiresSight` must not have the field
   * silently ignored.
   */
  readonly canSeeAttacker: boolean | null;
}

/**
 * Who may answer a hit that is known and whose damage is unrolled.
 *
 * {@link offersForDamage}'s sibling one instant earlier, and narrower in one
 * way that is the window's own: every sentence here is about *the creature
 * that was hit*, so the reach is `self` and nobody else is walked. SRD
 * *Shield* is the same instant answered by a spell, and `reactionOpportunities`
 * puts the two side by side.
 *
 * The clauses a printed trigger states are checked here rather than at the
 * command alone, so an offer that would be refused is never made — the rule
 * `affordable` already states about a stale offer.
 */
export function offersForAttack(state: GameState, context: AttackContext): ReactionOffers {
  const offers: ReactionOffer[] = [];
  const unverified: string[] = [];

  for (const feature of [...featuresFor(state, context.target, 'hit-by-attack')].sort(byFeature)) {
    if (attackReactionRefusal(feature, context) !== null) continue;
    if (!canAfford(state, context.target, feature)) continue;
    unverified.push(...undeclaredFacts(feature, context));
    offers.push(offerOf(context.target, feature));
  }

  return { offers, unverified };
}

/**
 * What this Reaction was offered without being able to check — one string per
 * fact nobody has declared.
 *
 * The other half of {@link attackReactionRefusal}'s three-valued reading, and
 * shared by the same two callers for the same reason: a fact that merely goes
 * unsaid does not withhold the Reaction, and a Reaction taken on an unsaid
 * fact has to *say so* — otherwise the engine has quietly decided something
 * nobody told it. The command puts these on its own `unverified`, which is
 * where every other command puts what it could not check.
 */
export function undeclaredFacts(
  feature: ReactionFeature,
  context: AttackContext,
): readonly string[] {
  const said: string[] = [];
  const does = feature.does;
  if (does.kind === 'raise-ac' && does.requiresWeapon === true && context.holdsAWeapon === null) {
    said.push(
      `nobody has said what ${context.target} is holding, and ${feature.name} is taken while holding a weapon; it was offered rather than withheld`,
    );
  }
  if (feature.requiresSight === true && context.canSeeAttacker === null) {
    said.push(
      `nobody has said whether ${context.target} can see ${context.attacker}, and ${feature.name} needs that; it was offered rather than withheld`,
    );
  }
  return said;
}

/**
 * Why this feature cannot answer this blow, or null where it can.
 *
 * **One rule, two callers**: the offer above and the command that takes it ask
 * the same question of the same facts, so a Reaction the engine offers is one
 * the engine will let a creature spend, and a Reaction it refuses is one it
 * never offered. That is why the reach and the sight are decided here as well
 * as the printed clauses: a check the offer made and the command did not would
 * be a Reaction takeable at a moment nobody was shown it at. An *undeclared*
 * fact is not a refusal — see {@link AttackContext.holdsAWeapon} — and
 * {@link undeclaredFacts} is what says so instead.
 */
export function attackReactionRefusal(
  feature: ReactionFeature,
  context: AttackContext,
): { readonly code: string; readonly reason: string } | null {
  const does = feature.does;
  if (does.kind !== 'raise-ac' && does.kind !== 'use-printed-line') {
    return {
      code: 'no_such_feature',
      reason: `${feature.name} does not answer a hit`,
    };
  }

  // **Every sentence at this window is about the creature that was hit.** SRD
  // Parry and SRD Reflexive Antennae both begin with their own holder, so the
  // reach is `self` and a feature reaching further would be answering somebody
  // else's blow — which is a rule this window does not hold and a shape no
  // printed line compiles. Refused rather than read past, on the discipline
  // the parser keeps about a sentence it only half recognises.
  if (feature.reach.kind !== 'self') {
    return {
      code: 'no_such_feature',
      reason: `${feature.name} answers a hit on somebody else, and this window reaches only the creature that was hit`,
    };
  }

  // "An attacker **that you can see**", where a feature prints the clause. No
  // SRD line under this heading does; an undeclared sight line is reported
  // rather than refused, which is the reading every other window takes.
  if (feature.requiresSight === true && context.canSeeAttacker === false) {
    return {
      code: 'cannot_see_target',
      reason: `${feature.name} answers an attacker ${context.target} can see, and they cannot see ${context.attacker}`,
    };
  }

  if (does.kind !== 'raise-ac') return null;

  if (does.meleeOnly === true && !context.melee) {
    return {
      code: 'melee_only',
      reason: `${feature.name} answers a melee attack roll, and this one was not`,
    };
  }
  if (does.requiresWeapon === true && context.holdsAWeapon === false) {
    return {
      code: 'no_weapon_in_hand',
      reason: `${feature.name} is taken while holding a weapon, and ${context.target} holds none`,
    };
  }
  return null;
}

/** What the `test-rolled` window is being asked about. */
export interface TestContext {
  readonly who: CharacterId;
  readonly kind: D20TestKind;
  readonly success: boolean;
}

/**
 * Who may push a D20 Test that has landed and not yet had its effects.
 *
 * The same empty-list rule as {@link offersForDamage}: a test nobody can
 * change resolves in one call and records one event.
 */
export function offersForTest(state: GameState, context: TestContext): ReactionOffers {
  const offers: ReactionOffer[] = [];
  const unverified: string[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const reactor = key as CharacterId;
    for (const feature of [...featuresFor(state, reactor, 'test-rolled')].sort(byFeature)) {
      const does = feature.does;
      if (
        does.kind !== 'intervene' &&
        does.kind !== 'reroll' &&
        does.kind !== 'succeed-instead'
      ) {
        continue;
      }

      // SRD Indomitable and Disciplined Survivor both say "If you fail a
      // saving throw", and neither says anything about an ability check; SRD
      // Heroic Inspiration says "any die", which a reroll declares. SRD
      // Legendary Resistance says "a saving throw" and carries no list,
      // because one family is all the sentence names. (W7-B11)
      const tests: readonly D20TestKind[] =
        does.kind === 'intervene'
          ? does.tests
          : does.kind === 'reroll'
            ? (does.tests ?? ['saving-throw'])
            : ['saving-throw'];
      if (!tests.includes(context.kind)) continue;

      const wants = does.kind === 'intervene' ? does.outcome : 'failure';
      if (wants === 'failure' && context.success) continue;
      if (wants === 'success' && !context.success) continue;

      // Indomitable is your own save; Cutting Words is somebody else's roll,
      // and `reaches` excludes the roller themselves.
      if (feature.reach.kind === 'self' && reactor !== context.who) continue;

      if (!canAfford(state, reactor, feature)) continue;
      if (!reaches(state, reactor, feature, context.who, unverified)) continue;

      offers.push(offerOf(reactor, feature));
    }
  }

  return { offers, unverified };
}

function offerOf(reactor: CharacterId, feature: ReactionFeature): ReactionOffer {
  return {
    reactor,
    feature: feature.feature,
    name: feature.name,
    costsReaction: feature.costsReaction,
    pool: feature.pool,
    ...(feature.granted === undefined ? {} : { granted: feature.granted }),
  };
}

/**
 * The feature a reactor named, if they have it and it answers this window.
 *
 * Read off the creature rather than off the offer, so a feature whose die or
 * cap has moved since the window opened is the current one.
 *
 * `from` narrows it to what one named creature gave, which is the only thing
 * that tells two granted Reactions of the same feature apart; naming nobody
 * takes the first in the order the offers were listed in.
 */
export function reactionFeatureOf(
  state: GameState,
  reactor: CharacterId,
  featureId: string,
  window: FeatureReactionWindow,
  from?: CharacterId,
): ReactionFeature | null {
  const creature = state.creatures[reactor];
  if (creature === undefined) return null;
  return (
    [...reactionsOf(creature)]
      .sort(byFeature)
      .find(
        (r) =>
          r.feature === featureId &&
          r.window === window &&
          (from === undefined || r.granted?.from === from),
      ) ?? null
  );
}

/**
 * Whether the moment a Reaction to *taking damage* answers is still open.
 *
 * SRD says "in response to", which means immediately, and the finest grain the
 * engine has for it is the turn — the same grain the one-slot-per-turn rule
 * and `pendingSaves` already use. Outside combat there are no turns, so the
 * clock closes it instead. Both facts are already in state; neither invents a
 * number of seconds, which is exactly the kind of number this engine exists
 * not to invent.
 *
 * Shared by *Hellish Rebuke*'s trigger and by Retaliation, which is the whole
 * point of the window vocabulary: one rule, one reading, two clients.
 */
export function damageWindowOpen(
  state: GameState,
  who: CharacterId,
): { readonly by: CharacterId; readonly turn: number | null; readonly elapsed: number } | null {
  const hurt = state.creatures[who]?.lastDamage ?? null;
  if (hurt === null) return null;
  if (hurt.turn !== (state.combat?.turnsTaken ?? null)) return null;
  if (hurt.elapsed !== state.elapsed) return null;
  return hurt;
}

/**
 * Whether the moment a Reaction to a *fall* answers is still open.
 *
 * {@link damageWindowOpen}'s twin, reading the other momentary fact on a
 * creature and reading it the same way. SRD writes the trigger as "when you
 * ... fall", which is the same "immediately" *Hellish Rebuke* gets, so it gets
 * the same two comparisons: the turn, which is the finest grain the engine has
 * for now, and the clock, which stands in where there are no turns.
 *
 * **Nothing here decides when a fall ends**, because nothing in the engine
 * knows. The declaration says a creature fell and this says the saying is
 * still current; how far the creature had to go and what it hit are the
 * table's, and a landing this function could recognise would need a height no
 * event carries.
 *
 * Two clients are already written into the SRD — *Feather Fall* answers it and
 * the Monk's Slow Fall answers it — which is the same evidence
 * `damaged-by-creature` offered that a window is vocabulary rather than one
 * spell's special case. Only the spell can reach it today; see
 * {@link FeatureReactionWindow} for what the feature is still waiting on.
 */
export function fallWindowOpen(state: GameState, who: CharacterId): FallMoment | null {
  const fell = state.creatures[who]?.falling ?? null;
  if (fell === null) return null;
  if (fell.turn !== (state.combat?.turnsTaken ?? null)) return null;
  if (fell.elapsed !== state.elapsed) return null;
  return fell;
}

/** Everybody the table has said is falling, right now, in a stable order. */
export function fallingNow(state: GameState): readonly CharacterId[] {
  return Object.keys(state.creatures)
    .sort()
    .map((key) => key as CharacterId)
    .filter((who) => fallWindowOpen(state, who) !== null);
}

/**
 * An opportunity a caller could take right now, whatever window it belongs to.
 *
 * This is the half Maestro needs and the engine had none of: the trigger
 * machinery could *refuse* a Reaction taken at the wrong moment, and nothing
 * could say that a moment was open. A model that has to guess whether a Shield
 * is available will either never cast one or will try constantly and be
 * refused.
 *
 * **It transfers no authority.** Every field is a fact the engine already
 * holds, and taking the opportunity still goes through the command that checks
 * every one of them again. What the query decides is nothing; what it does is
 * save a round trip of refusals.
 */
export interface ReactionOpportunity {
  readonly window: ReactionWindow;
  readonly reactor: CharacterId;
  /** A feature id, or a spell id for a Reaction spell. */
  readonly id: string;
  readonly name: string;
  readonly kind: 'feature' | 'spell';
  readonly costsReaction: boolean;
  /** The pool a use would come from, where one would. */
  readonly pool: string | null;
  /** What it answers: the creature that acted, or the casting that is open. */
  readonly against: CharacterId | null;
  /**
   * Which casting a `casting-a-spell` opportunity answers, by id.
   *
   * Several may be open at once and several may belong to one caster, so
   * `against` alone no longer names one — this is the id the caller sends back
   * as `CastSpellRequest.answers`, and without it a creature with two castings
   * open would produce two opportunities nothing could tell apart.
   */
  readonly casting?: string;
  /**
   * Who gave this Reaction to its reactor, where somebody did.
   *
   * The same field an offer carries and for the same reason: two dice from two
   * Bards are alike in every other field, and an opportunity that did not say
   * whose it was could not be narrated. It is not an argument to anything —
   * `TestReactionCommand.from` is where a caller names one.
   */
  readonly granted?: GrantedMark;
}
