/**
 * The commands that answer a window, and the ones that close it.
 *
 * Four named windows, two of which are new here, and one shared idea beneath
 * them: **an outcome that is known and has not yet been applied, held open for
 * a finite list of creatures who may spend something to change it.**
 *
 * That shape is not invented. `pendingMove.provoked` has been exactly this
 * since Opportunity Attacks landed — a list of creatures who were offered a
 * Reaction, answered one at a time, with the thing they were holding up
 * happening when the last one answers. What was missing was the two moments
 * class features actually name: a damage roll that has not landed, and a D20
 * Test whose effects have not occurred.
 *
 * See `reactions.ts` for the vocabulary and why it is a table of six members
 * rather than a trigger language.
 */

import {
  type Ability,
  ABILITY_NAMES,
  type CharacterId,
  err,
  needsContext,
  ok,
  type Result,
  type RollMode,
  type Skill,
} from '@ie/shared';
import { applyDamage, type AttackDamage, type DamageReduction, reduceDamage } from '../attack.js';
import { type Bonus, type ModeSource } from '../bonuses.js';
import { modifierFor } from '../character.js';
import {
  type D20TestKind,
  type D20TestResult,
  interveneAfterRoll,
  rerollTest,
  rollAbilityCheck,
  rollSavingThrow,
} from '../checks.js';
import { type CheckContext, isIncapacitated } from '../conditions.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { distanceBetween } from '../positioning.js';
import {
  damageWindowOpen,
  fallingNow,
  offersForTest,
  reactionAddends,
  reactionFeatureOf,
  reactionsOf,
  type ReactionOffer,
  type ReactionOpportunity,
  type SpellReactionWindow,
} from '../reactions.js';
import { remaining } from '../resources.js';
import { type Content } from '../content.js';
import {
  defensesOf,
  effectiveConditions,
  rollModesFor,
  sheetAsItStands,
} from '../standing.js';
import { type AttackResolution, resolveAttack } from './attacks.js';
import {
  type ConcentrationConsequence,
  type Supply,
  resolveDamage,
} from './casting.js';
import { creatureOf, unknownCreature } from './command.js';
import {
  adjustmentsFor,
  heldDamageTotal,
  reactionContributions,
  rollsIssuedSince,
  spendReactionCost,
  standingReductionOf,
  statedFrom,
} from './damage.js';
import { applyHitRider } from './hit-riders.js';
import { completeIfSettled, pendingCastingsOf } from './holds.js';
import { reactionSwing } from './movement.js';
import {
  checkBonuses,
  mergedModes,
  recordD20Test,
  savingSupport,
  spentRollModifiers,
} from './rolls.js';

export interface DamageReactionCommand extends CommandIdentity {
  readonly feature: string;
}

/**
 * Passing on a window.
 *
 * An offer is a (reactor, feature) pair, so a creature holding two features
 * in one window may let one lapse and keep the other — a Fighter / Fiend
 * Warlock declining Indomitable still has Dark One's Own Luck to add. Naming
 * no feature passes on every offer this creature holds, which is what
 * ignoring the trigger altogether means.
 */
export interface DeclineReactionCommand extends CommandIdentity {
  readonly feature?: string;
}

export interface ReactionResolution {
  readonly events: readonly GameEvent[];
  /** What came off the damage, when something did. */
  readonly reduction?: DamageReduction;
  /** True when this command id had already been applied; `events` is empty. */
  readonly duplicate: boolean;
}

/**
 * Take a Reaction against a damage roll that has not landed.
 *
 * SRD Uncanny Dodge, Deflect Attacks and Cutting Words. The three differ in
 * every number and agree on the shape, which is what makes this one command:
 * spend what the feature costs, roll what it says, and take that off the
 * total — leaving the damage itself to {@link settleDamage}, so there is
 * exactly one place that decides what the target finally takes.
 *
 * **The amount comes off the total, never off a component.** A reduction is not
 * damage of any type, and subtracting it from the slashing half of a flaming
 * sword would give a fire-immune target the wrong answer — the same reasoning
 * that put `reductions` beside the components rather than inside them.
 */
export function takeDamageReaction(
  state: GameState,
  reactor: CharacterId,
  command: DamageReactionCommand,
  supply: Supply,
): Result<ReactionResolution> {
  // Before the offer is checked, exactly as `takeOpportunityAttack` does it: a
  // retry arrives at a window its own first run has already answered, and
  // reporting "you were not offered that" for a Reaction that in fact landed
  // is the confusion command ids exist to prevent.
  return once(state, `damage-reaction:${reactor}`, command, () => ({ events: [], duplicate: true }), (stamp) => {
    const pending = state.pendingDamage;
    if (pending === null) {
      return err('no_pending_damage', `no damage roll is waiting for ${reactor} to answer`);
    }
    if (!pending.offers.some((o) => o.reactor === reactor && o.feature === command.feature)) {
      return err('not_offered', `${reactor} was not offered ${command.feature} against this damage`);
    }

    const feature = reactionFeatureOf(state, reactor, command.feature, 'damage-rolled');
    if (feature === null || feature.does.kind !== 'reduce-damage') {
      return err('no_such_feature', `${reactor} has no damage Reaction called ${command.feature}`);
    }

    const creature = creatureOf(state, reactor);
    if (creature === null) return unknownCreature(reactor);

    // Nothing is rolled until every refusal has had its say, so a refused
    // reaction costs neither a use nor a turn of the generator.
    const spent = spendReactionCost(state, reactor, creature, feature);
    if (!spent.ok) return spent;
    const events: GameEvent[] = [...spent.value];

    const issuedBefore = supply.issuer.count;
    const held: AttackDamage = {
      components: pending.components,
      critical: pending.critical,
      reductions: pending.reductions,
      total: heldDamageTotal(pending),
    };
    const amount = feature.does.amount;
    // The scores as they stand: `ReactionAddend` says its ability case is
    // "resolved when the die is thrown rather than at creation", and an item
    // that *sets* a score is the same kind of fact as the class table it was
    // written to outlive.
    const abilities = (sheetAsItStands(state, reactor) ?? creature.sheet).abilities;
    const addends = reactionAddends(amount, abilities);
    // SRD Uncanny Dodge: "halve the attack's damage against you (**round
    // down**)". What is taken off is therefore the upper half, which is what
    // makes an odd total round the target's way.
    const halved = held.total - Math.floor(held.total / 2);
    const flat = amount.halve === true ? halved : addends.total;

    const reduced = reduceDamage(supply.issuer, supply.rng, held, {
      source: feature.name,
      flat,
      ...(amount.dice === undefined ? {} : { dice: amount.dice }),
    });
    if (!reduced.ok) return reduced;

    const applied = reduced.value.reductions[reduced.value.reductions.length - 1];
    if (applied === undefined) {
      throw new Error(`${feature.name} recorded no reduction; reduceDamage always records one`);
    }

    events.push({
      type: 'roll-recorded',
      who: reactor,
      label: feature.name,
      natural: applied.roll?.total ?? 0,
      total: applied.amount,
      contributions: reactionContributions(amount, abilities, applied.roll?.total ?? 0, halved),
      outcome: `${applied.amount} damage prevented`,
      // A reduction that rolled nothing — Uncanny Dodge's halving — has no
      // provenance to report, and one the engine threw reports none either.
      // See `StatedRoll` in `events.ts`.
      ...statedFrom(applied.roll?.provenance),
    });

    events.push({
      type: 'damage-reaction-answered',
      reactor,
      took: true,
      feature: feature.feature,
      reduction: applied,
      ...(stamp === null ? {} : { command: stamp }),
    });

    if (supply.issuer.count > issuedBefore) {
      events.push({
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      });
    }

    return ok({ events, reduction: applied, duplicate: false });
  });
}

/**
 * Pass on a Reaction that was offered against a damage roll.
 *
 * Costs nothing and keeps the Reaction — SRD is explicit that ignoring a
 * trigger is free — but the offer is spent, so it cannot be taken later.
 */
export function declineDamageReaction(
  state: GameState,
  reactor: CharacterId,
  command: DeclineReactionCommand = {},
): Result<GameEvent[]> {
  return once(state, `decline-damage-reaction:${reactor}`, command, () => [], (stamp) => {
    const pending = state.pendingDamage;
    if (pending === null) {
      return err('no_pending_damage', `no damage roll is waiting for ${reactor} to answer`);
    }
    const held = (o: ReactionOffer): boolean =>
      o.reactor === reactor && (command.feature === undefined || o.feature === command.feature);
    if (!pending.offers.some(held)) {
      return err(
        'not_offered',
        `${reactor} was not offered ${command.feature ?? 'a Reaction'} against this damage`,
      );
    }

    return ok([
      {
        type: 'damage-reaction-answered',
        reactor,
        took: false,
        ...(command.feature === undefined ? {} : { feature: command.feature }),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

export interface SettledDamage {
  readonly events: readonly GameEvent[];
  /** What the target actually took, after the reactions and their defences. */
  readonly amount: number;
  readonly concentration: ConcentrationConsequence;
  /**
   * Facts a rider this settlement resolved could not check.
   *
   * Empty for every settlement that had no rider to resolve, which is nearly
   * all of them — and reported here rather than at the swing because here is
   * where the rider happened. See {@link PendingDamage.rider}.
   */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Close the window and deal what is left.
 *
 * **This is what settles the debt, including when nobody reacts.** Any offer
 * still outstanding is recorded as passed — the engine does not wait forever
 * for a decision nobody is going to make, and it does not take the decision
 * either: whether an NPC wants to spend its Reaction is Maestro's call, and
 * calling this is how Maestro says "nobody is".
 *
 * Settlement is its own command rather than something the last answer does by
 * itself, which is the opposite choice from `pendingMove` and deliberate: the
 * damage is a *number* the reactions changed, so there is exactly one place
 * that computes it, one command id that guards it, and one refusal when the
 * turn tries to move on without it.
 */
export function settleDamage(
  state: GameState,
  supply: Supply,
  command: CommandIdentity = {},
): Result<SettledDamage> {
  return once(state, 'settle-damage', command, () => {
    return {
      events: [],
      amount: 0,
      concentration: { kind: 'none' },
      unverified: [],
      duplicate: true,
    };
  }, (stamp) => {
    const pending = state.pendingDamage;
    if (pending === null) return err('no_pending_damage', 'no damage roll is waiting to be dealt');

    // Everyone who never answered is recorded as having passed. Their Reaction
    // is untouched — ignoring a trigger costs nothing. One pass per **offer**,
    // each naming its feature: an offer is a (reactor, feature) pair, and a
    // creature holding two features in this window owes two answers.
    const events: GameEvent[] = pending.offers.map((offer) => ({
      type: 'damage-reaction-answered' as const,
      reactor: offer.reactor,
      took: false,
      feature: offer.feature,
    }));

    events.push({
      type: 'damage-settled',
      target: pending.target,
      // The stamp rides here because this event always happens — a settlement
      // that deals nothing still closes the window, where the damage event that
      // follows could in principle be a zero nobody notices.
      ...(stamp === null ? {} : { command: stamp }),
    });

    // **And the wards standing on the defender, beside the Reactions they
    // answered with.** A reduction a casting hung on this creature is not a
    // Reaction and nobody chose to spend it, so it is not in `reductions` —
    // but it comes off the same total at the same step, and it must come off
    // on *this* road too: a blow held open for a Reaction is exactly the blow
    // a warded creature is most likely to be holding one against, and a
    // reduction written only into `dealSpellDamage` would be skipped by every
    // one of them. `standingReductionOf` is the shared rule.
    const issuedBeforeWard = supply.issuer.count;
    const warded = standingReductionOf(state, pending.target, pending.components, supply);
    if (!warded.ok) return warded;
    events.push(...warded.value.events);
    // **And the generator moving is recorded here**, narrowly, because nothing
    // above this command counts for it: `dealSpellDamage`'s ward rides the one
    // `rolls-issued` the casting already emits for its whole effect loop, and
    // this road has no such loop — `resolveDamage` below counts only its own
    // Undead Fortitude save. A die thrown with no count beside it leaves
    // `rollsIssued` short and the next command reusing a roll id.
    events.push(...rollsIssuedSince(supply, issuedBeforeWard));

    const reduction =
      pending.reductions.reduce((sum, r) => sum + r.amount, 0) + warded.value.amount;
    const adjustments = adjustmentsFor(pending.components, reduction);
    const applied = applyDamage(pending.components, defensesOf(state, pending.target), adjustments);

    const dealt = resolveDamage(
      state,
      pending.target,
      {
        amount: applied.total,
        source: pending.source,
        // The kinds this blow was made of, for `DamageCommand.types`'s reason.
        // The held components are the same ones `dealSpellDamage` would have
        // handed over had no window opened, so a Radiant blow reads as Radiant
        // by either road.
        types: [...new Set(pending.components.map((component) => component.type))].sort(),
        ...(pending.critical ? { critical: true } : {}),
        ...(pending.by === null ? {} : { by: pending.by }),
      },
      supply,
    );
    if (!dealt.ok) return dealt;

    const all = [...events, ...dealt.value.events];

    // **What the funnel could not settle, on its way through.** SRD Dark One's
    // Blessing is paid inside `resolveDamage` now — this road used to ask for
    // itself, one call of three — and what it could not check comes back the
    // same way, beside an Undead Fortitude thrown against a blow with no type.
    const unverified: string[] = [...dealt.value.unverified];

    // **What the blow still owed, now that the defender has answered.** The
    // rider was held here rather than resolved at the swing precisely so that
    // a Stunning Strike could not close the window it had just opened — and it
    // resolves on the world the damage has already changed, which is where a
    // rider has always resolved.
    //
    // **And the rider may not refuse this command.** This is the only door out
    // of a held damage roll, and what the rider would refuse is somebody
    // else's purchase, already checked and already paid for at the swing: a
    // refusal here would wedge the fight for ever, and every retry would wedge
    // it again. So a rider that will not resolve is *reported* — the
    // settlement happens, the damage lands, and whoever is narrating is told
    // that what the hit bought did not.
    //
    // The refusal above it is a different thing and stays: `resolveDamage` is
    // the damage itself, and a settlement that could not deal the damage has
    // not settled anything to close the window over.
    const riderEvents: GameEvent[] = [];
    if (pending.rider !== undefined) {
      const bought = applyHitRider(
        all.reduce(applyEvent, state),
        supply,
        // What the target actually took, after its defences and after every
        // reduction a Reaction bought — which is what SRD Specter's "an amount
        // equal to the damage taken" reads, and the whole reason the defender
        // answers before the rider fires.
        {
          attacker: pending.rider.attacker,
          target: pending.target,
          dealt: applied.total,
          // And whether this blow was the one that emptied them — the other
          // fact a rider reads off the damage rather than off a sheet, and one
          // only a caller holding the world on both sides can answer. The
          // Reaction the defender just took is part of "this damage", which is
          // the whole reason it is asked here and not at the swing.
          droppedToZero:
            (state.creatures[pending.target]?.vitals.hp ?? 0) > 0 &&
            all.reduce(applyEvent, state).creatures[pending.target]?.vitals.hp === 0,
        },
        pending.rider.option,
      );
      if (bought.ok) {
        riderEvents.push(...bought.value.events);
        unverified.push(...bought.value.unverified);
      } else {
        unverified.push(
          `${pending.rider.option.featureName} rode on this hit and did not resolve: ${bought.reason}`,
        );
      }
    }

    // **And what the blow bought whoever was watching it is already in `all`.**
    // SRD Dark One's Blessing reads the outcome rather than the swing, and this
    // road used to ask for itself; it is asked at `resolveDamage` now, which is
    // the funnel a spell's damage and a DM's adjudicated amount share with this
    // one.
    //
    // **So the spoils arrive with the damage rather than after the rider, and
    // that is the more faithful reading rather than a consequence to live
    // with.** "Within 10 feet of you" is measured at the moment the enemy is
    // reduced to 0 Hit Points, and a rider can move somebody afterwards — a
    // hit's `shove` rider pushes a creature across the floor — so asking after
    // the rider was asking about a room the sentence had already finished
    // with. The question is now put at the instant the sentence names.
    const settled = [...all, ...riderEvents];

    return ok({
      // A move that was waiting on an Opportunity Attack whose damage was held
      // can go through now. Nothing else completes it: the command that answered
      // the Reaction left the damage open, and a mover must not arrive before
      // the blow aimed at them leaving has landed.
      events: [...settled, ...completeIfSettled(state, settled)],
      amount: applied.total,
      concentration: dealt.value.concentration,
      unverified,
      duplicate: false,
    });
  });
}

export interface TestCommand extends CommandIdentity {
  readonly kind: D20TestKind;
  readonly ability: Ability;
  readonly skill?: Skill;
  readonly dc: number;
  /** What the roll is for, in the caller's words: "vs the pit trap". */
  readonly label?: string;
  /** Advantage or Disadvantage the table knows about and the engine cannot see. */
  readonly modes?: readonly (RollMode | ModeSource)[];
  readonly bonuses?: readonly Bonus[];
  /**
   * Which senses this attempt leans on.
   *
   * A fact about the attempt, never a result — SRD Blinded "automatically
   * fails an ability check that requires sight", and only the table knows
   * whether this one does. The same field, for the same reason, as
   * {@link EffectCheckCommand.senses}.
   */
  readonly senses?: CheckContext;
}

export interface TestResolution {
  readonly events: readonly GameEvent[];
  /** The roll, or null when this command id had already been applied. */
  readonly test: D20TestResult | null;
  /**
   * Who may push it before its effects occur.
   *
   * Empty is the ordinary case, and then the test is final the moment it comes
   * back: no window was opened and nothing has to be settled.
   */
  readonly offers: readonly ReactionOffer[];
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Roll an ability check or a saving throw for a creature.
 *
 * `rollAbilityCheck` and `rollSavingThrow` have been complete and correct since
 * the day they were written and reachable from **no command at all** except
 * from inside a spell's own resolution — the ninth instance in this codebase of
 * a pure function nothing calls. A DM asks for a check or a save constantly,
 * and the engine had no way to be asked.
 *
 * Everything derivable is derived: the modifier, proficiency, Expertise, the
 * armour penalties, the roller's conditions and the automatic failures they
 * impose, the exhaustion penalty, and the bonuses a feature or a running spell
 * has put on this creature. What the caller says is what the engine cannot see
 * — a situational Advantage, a DC, and which senses the attempt uses.
 *
 * **It holds the result open when somebody can push it.** SRD Dark One's Own
 * Luck names the window in one clause — "after seeing the roll but before any
 * of the roll's effects occur" — and Indomitable, Peerless Skill and Cutting
 * Words all live in it. With nobody eligible the test is final on return and
 * no window exists, exactly as an unanswerable damage roll simply lands.
 *
 * **What settlement means here is nothing**, deliberately. A standalone test's
 * consequence belongs to whoever asked for it; the engine owns the number. So
 * closing the window changes no state, which is the same honest answer
 * `SpellCheck.onSuccess: 'none'` gives rather than a stub.
 */
export function resolveTest(
  state: GameState,
  who: CharacterId,
  command: TestCommand,
  supply: Supply,
): Result<TestResolution> {
  return once(state, `test:${who}`, command, () => {
    return { events: [], test: null, offers: [], unverified: [], duplicate: true };
  }, (stamp) => {
    const creature = creatureOf(state, who);
    if (creature === null) return unknownCreature(who);

    if (state.pendingTest !== null) {
      return err(
        'test_pending',
        `${state.pendingTest.who} has a D20 Test whose effects are still unsettled; settle it first`,
      );
    }

    if (!Number.isFinite(command.dc)) {
      return err('bad_dc', `${String(command.dc)} is not a Difficulty Class`);
    }

    const label =
      command.label ??
      `${ABILITY_NAMES[command.ability]} ${command.kind === 'saving-throw' ? 'save' : 'check'}`;

    const issuedBefore = supply.issuer.count;

    // Everything the caller said, on either kind of test: what the operation
    // carries and what this command was sent with.
    //
    // **One list, because the two branches used to build it two ways.** The
    // save merged by source and the check concatenated, so a `ModeSource`'s
    // `source` was an identity on one kind of D20 Test and a label on the
    // other — and `mergedModes` is where that is now decided once, for the
    // reason a vocabulary with two meanings is not one. The divergence had
    // already cost a bug (two rulings spelled alike collapsing on the save,
    // which then rolled at Disadvantage while reporting one ruling); it was
    // fixed at the caller, and this is the same fix at the seam.
    //
    // Both halves of each list, because both were being dropped — the save
    // read the supply and not the command until somebody noticed, and the
    // check read the command and not the supply. `Supply.modes` is
    // "modifiers on the rolls this operation makes", and a test is a roll it
    // makes.
    // The one query both halves of the check branch ask — what the roll reads
    // and what it spends — so `consumedRollModifiers` can never disagree with
    // `rollModesFor` about whether a grant applied.
    const checkQuery = {
      family: 'ability-check' as const,
      roller: who,
      ability: command.ability,
      ...(command.skill === undefined ? {} : { skill: command.skill }),
    };

    const saidModes = [...(supply.modes ?? []), ...(command.modes ?? [])];
    const saidBonuses = [...(supply.bonuses ?? []), ...(command.bonuses ?? [])];

    // Everything standing on this creature — a Paladin's aura, Bless, the
    // feature that grants Advantage on this very skill — read rather than
    // remembered, which is the rule every roll in this engine follows. The
    // *score* is read the same way: an item that sets a Strength is standing
    // on the creature too, and `checks.ts` takes a sheet, so the substitution
    // is made here rather than by teaching the roller about items.
    const sheet = sheetAsItStands(state, who) ?? creature.sheet;
    const rolled =
      command.kind === 'saving-throw'
        ? (() => {
            const support = savingSupport(state, who, creature, command.ability, {
              modes: saidModes,
              bonuses: saidBonuses,
            });
            return rollSavingThrow(supply.issuer, supply.rng, sheet, command.ability, {
              dc: command.dc,
              conditions: support.conditions,
              modes: support.modes,
              bonuses: support.bonuses,
            });
          })()
        : rollAbilityCheck(supply.issuer, supply.rng, sheet, command.ability, {
            dc: command.dc,
            ...(command.skill === undefined ? {} : { skill: command.skill }),
            conditions: effectiveConditions(state, who),
            modes: mergedModes(rollModesFor(state, checkQuery).modes, saidModes),
            ...(command.senses === undefined ? {} : { conditionContext: command.senses }),
            // The other half of "everything standing on this creature": the
            // saving-throw branch above gets it from `savingSupport`, and a
            // worn item's "+1 bonus to ability checks" reaches this one.
            //
            // **Two gatherers rather than one, and that difference stays.**
            // A saving throw has one command behind it and an ability check
            // four, so `checkBonuses` answers the narrower question the four
            // of them share; what the two branches must not disagree about is
            // the *identity rule*, and they do not — both merge by source and
            // let the caller's copy win.
            bonuses: checkBonuses(state, who, saidBonuses, command.skill),
          });
    if (!rolled.ok) return rolled;

    const events: GameEvent[] = [
      {
        ...recordD20Test(who, label, rolled.value, rolled.value.success ? 'success' : 'failure'),
        // On the roll, which happens whatever the outcome — the same reasoning
        // that stamps `resolveAttack` on the roll rather than on the damage a
        // miss never deals.
        ...(stamp === null ? {} : { command: stamp }),
      },
      { type: 'rolls-issued', count: supply.issuer.count - issuedBefore, rng: supply.rng.snapshot() },
      // **The one-shot grants an ability check spends.** SRD Help: "that ally
      // has Advantage on the next ability check they make with the chosen
      // skill" — the next one they *make*, so it is spent beside the roll and
      // whatever the number was, exactly as an attack spends Guiding Bolt's.
      // A saving throw still spends nothing: no save roller emits the event,
      // which is what `oneShotProblem` goes on refusing.
      ...(command.kind === 'saving-throw' ? [] : spentRollModifiers(state, checkQuery)),
    ];

    const possible = offersForTest(state, {
      who,
      kind: command.kind,
      success: rolled.value.success,
    });

    if (possible.offers.length > 0) {
      events.push({
        type: 'test-rolled',
        test: { who, label, result: rolled.value, offers: possible.offers },
      });
    }

    return ok({
      events,
      test: rolled.value,
      offers: possible.offers,
      unverified: possible.unverified,
      duplicate: false,
    });
  });
}

export interface TestReactionCommand extends CommandIdentity {
  readonly feature: string;
  /**
   * Whose granted Reaction is being spent, where the reactor holds more than
   * one of the same name.
   *
   * Two Bards may have inspired the same ally, and the two dice differ in
   * nothing a caller can see except who gave them. Naming nobody takes the
   * first in the order the offers were listed in, which is the order the fold
   * keeps them in — so a caller who does not care still gets a settled answer.
   */
  readonly from?: CharacterId;
}

export interface TestReactionResolution {
  readonly events: readonly GameEvent[];
  /** The test as it now stands, or null when this command id had landed. */
  readonly test: D20TestResult | null;
  readonly duplicate: boolean;
}

/**
 * Push a D20 Test that has landed and not yet had its effects.
 *
 * Two shapes, and they are two SRD sentences rather than two designs:
 *
 * - **Add or subtract.** Dark One's Own Luck adds 1d10, Cutting Words
 *   subtracts the Bardic Inspiration die, Peerless Skill adds it to your own.
 *   One mechanism with a sign — the argument `interveneAfterRoll` already
 *   settled for itself when Bend Luck showed it could push either way.
 * - **Reroll.** Indomitable: "You **must use the new roll**", which is not
 *   take-the-better-of-two. `rerollTest` keeps the superseded number on the
 *   result, so a log still shows what was given up.
 *
 * **Whether it cost a Reaction is the feature's business, not this window's.**
 * Four of the five features here spend none at all — the SRD grants them as
 * bare permissions limited by a pool — and treating the window and the
 * action-economy cost as one thing is the commonest mistake about this corner
 * of the rules.
 */
export function takeTestReaction(
  state: GameState,
  reactor: CharacterId,
  command: TestReactionCommand,
  supply: Supply,
): Result<TestReactionResolution> {
  return once(state, `test-reaction:${reactor}`, command, () => ({ events: [], test: null, duplicate: true }), (stamp) => {
    const pending = state.pendingTest;
    if (pending === null) {
      return err('no_pending_test', `no D20 Test is waiting for ${reactor} to answer`);
    }
    const offered = (o: ReactionOffer): boolean =>
      o.reactor === reactor &&
      o.feature === command.feature &&
      (command.from === undefined || o.granted?.from === command.from);
    if (!pending.offers.some(offered)) {
      return err('not_offered', `${reactor} was not offered ${command.feature} against this roll`);
    }

    const feature = reactionFeatureOf(
      state,
      reactor,
      command.feature,
      'test-rolled',
      command.from,
    );
    if (feature === null || (feature.does.kind !== 'intervene' && feature.does.kind !== 'reroll')) {
      return err('no_such_feature', `${reactor} has no D20 Test Reaction called ${command.feature}`);
    }

    const creature = creatureOf(state, reactor);
    if (creature === null) return unknownCreature(reactor);

    const spent = spendReactionCost(state, reactor, creature, feature);
    if (!spent.ok) return spent;
    const events: GameEvent[] = [...spent.value];

    const issuedBefore = supply.issuer.count;
    const does = feature.does;
    // As it stands, for the reason `takeDamageReaction` reads it that way: an
    // ability addend is resolved at the moment the die is thrown.
    const sheet = sheetAsItStands(state, reactor) ?? creature.sheet;

    let pushed: Result<D20TestResult>;
    if (does.kind === 'reroll') {
      const bonus = does.bonus;
      pushed = rerollTest(
        supply.issuer,
        supply.rng,
        pending.result,
        bonus === undefined
          ? undefined
          : {
              source: feature.name,
              flat: bonus.kind === 'level' ? bonus.level : modifierFor(sheet, bonus.ability),
            },
      );
    } else {
      const addends = reactionAddends(does.amount, sheet.abilities);
      pushed = interveneAfterRoll(supply.issuer, supply.rng, pending.result, {
        source: feature.name,
        direction: does.direction,
        ...(addends.total === 0 ? {} : { flat: addends.total }),
        ...(does.amount.dice === undefined ? {} : { dice: does.amount.dice }),
      });
    }
    if (!pushed.ok) return pushed;

    // SRD Peerless Skill: "On a failure, the Bardic Inspiration **isn't
    // expended**." The only feature here whose cost depends on whether it
    // worked, which is why the spend is decided after the new total is known.
    const refunded =
      does.kind === 'intervene' && does.refundedOnFailure === true && !pushed.value.success;
    const paid = refunded
      ? events.filter((e) => !(e.type === 'resource-spent' && e.key === feature.pool))
      : events;

    paid.push({
      ...recordD20Test(
        pending.who,
        `${pending.label} (${feature.name})`,
        pushed.value,
        pushed.value.success ? 'success' : 'failure',
      ),
    });

    paid.push({
      type: 'test-reaction-answered',
      reactor,
      took: true,
      feature: feature.feature,
      result: pushed.value,
      ...(stamp === null ? {} : { command: stamp }),
    });

    if (supply.issuer.count > issuedBefore) {
      paid.push({
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      });
    }

    return ok({ events: paid, test: pushed.value, duplicate: false });
  });
}

/** Pass on a Reaction offered against a D20 Test. Costs nothing. */
export function declineTestReaction(
  state: GameState,
  reactor: CharacterId,
  command: DeclineReactionCommand = {},
): Result<GameEvent[]> {
  return once(state, `decline-test-reaction:${reactor}`, command, () => [], (stamp) => {
    const pending = state.pendingTest;
    if (pending === null) {
      return err('no_pending_test', `no D20 Test is waiting for ${reactor} to answer`);
    }
    const held = (o: ReactionOffer): boolean =>
      o.reactor === reactor && (command.feature === undefined || o.feature === command.feature);
    if (!pending.offers.some(held)) {
      return err(
        'not_offered',
        `${reactor} was not offered ${command.feature ?? 'a Reaction'} against this roll`,
      );
    }

    return ok([
      {
        type: 'test-reaction-answered',
        reactor,
        took: false,
        ...(command.feature === undefined ? {} : { feature: command.feature }),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

export interface SettledTest {
  readonly events: readonly GameEvent[];
  /** The final number, which is what the caller asked for in the first place. */
  readonly test: D20TestResult | null;
  readonly duplicate: boolean;
}

/**
 * Close a D20 Test window; anything still outstanding is recorded as passed.
 *
 * **Nothing mechanical happens**, and that is the point rather than a gap: the
 * engine owned the number and the table owns what it means. The window existed
 * so the number could be pushed, and it closes so the turn can move on.
 */
export function settleTest(
  state: GameState,
  command: CommandIdentity = {},
): Result<SettledTest> {
  return once(state, 'settle-test', command, () => ({ events: [], test: null, duplicate: true }), (stamp) => {
    const pending = state.pendingTest;
    if (pending === null) return err('no_pending_test', 'no D20 Test is waiting to be settled');

    const events: GameEvent[] = pending.offers.map((offer) => ({
      type: 'test-reaction-answered' as const,
      reactor: offer.reactor,
      took: false,
      feature: offer.feature,
    }));

    events.push({
      type: 'test-settled',
      who: pending.who,
      ...(stamp === null ? {} : { command: stamp }),
    });

    return ok({ events, test: pending.result, duplicate: false });
  });
}

export interface DamageResponseCommand extends CommandIdentity {
  readonly feature: string;
  /** The weapon, by catalogue id, or null for an Unarmed Strike. */
  readonly weapon?: string | null;
  /**
   * An attack the reactor's own stat block prints, by its printed name.
   *
   * `OpportunityCommand.action`'s twin, because the two windows ask the same
   * question: SRD Retaliation is "one melee attack" and so is an Opportunity
   * Attack. Naming neither leaves the choice to {@link reactionSwing}.
   */
  readonly action?: string;
}

/**
 * Answer damage that has already landed.
 *
 * SRD Retaliation: "When you take damage from a creature that is within 5 feet
 * of you, you can take a Reaction to make one melee attack against that
 * creature." This is the third timing family and the one that proves the
 * architectural point in the other direction — **it needs no pending state at
 * all**. Everything is settled: the damage is applied, the hit points have
 * moved, and nothing the reactor does can change any of it. There is no
 * outcome being held open, so there is nothing to hold.
 *
 * What the window *is* here is two facts already in state — `lastDamage` and
 * the clock — read by the same helper that decides whether *Hellish Rebuke*
 * may be cast. One rule, one reading, a spell and a class feature.
 *
 * The attack goes through `resolveAttack` with `free: true`, so cover,
 * conditions, proficiency, reach and the target's defences all apply because
 * that command applies them — exactly as an Opportunity Attack does.
 */
export function takeDamageResponse(
  state: GameState,
  reactor: CharacterId,
  command: DamageResponseCommand,
  supply: Supply,
): Result<AttackResolution> {
  return once(state, `damage-response:${reactor}`, command, () => {
    return { events: [], attack: null, unverified: [], duplicate: true };
  }, (stamp) => {
    const feature = reactionFeatureOf(state, reactor, command.feature, 'damaged-by-creature');
    if (feature === null || feature.does.kind !== 'melee-attack') {
      return err('no_such_feature', `${reactor} has no Reaction called ${command.feature}`);
    }

    const creature = creatureOf(state, reactor);
    if (creature === null) return unknownCreature(reactor);

    // The same window *Hellish Rebuke* opens into, read by the same function.
    const hurt = damageWindowOpen(state, reactor);
    if (hurt === null) {
      return err(
        'no_trigger',
        `${feature.name} answers damage as it lands, and nothing has just damaged ${reactor}`,
      );
    }

    // SRD: "**that creature**". The target is forced by the trigger, exactly as
    // Hellish Rebuke's is — aiming it elsewhere is refused rather than quietly
    // redirected.
    const apart = state.scene === null ? null : distanceBetween(state.scene, reactor, hurt.by);
    const unverified: string[] = [];
    if (apart === null || !apart.ok) {
      return needsContext(
        'unplaced',
        `${feature.name} needs ${reactor} and ${hurt.by} to be standing somewhere before 5 feet means anything`,
        [
          {
            kind: 'position',
            subject: reactor,
            need: `where ${reactor} and ${hurt.by} are standing`,
            because: `${feature.name} answers a creature within ${feature.does.withinFeet} feet`,
            satisfyWith: `a placeCreatureInScene command for ${reactor} and ${hurt.by}`,
          },
        ],
      );
    }
    if (apart.value > feature.does.withinFeet) {
      return err(
        'out_of_range',
        `${hurt.by} is ${apart.value} feet away and ${feature.name} reaches ${feature.does.withinFeet}`,
      );
    }

    const spent = spendReactionCost(state, reactor, creature, feature);
    if (!spent.ok) return spent;
    const events: GameEvent[] = [...spent.value];

    const after = events.reduce(applyEvent, state);
    // No id of its own: this command owns the guard, and the same id
    // fingerprinted twice under two kinds would make the retry read as a reused
    // id. The same split `takeOpportunityAttack` and `releaseReady` make.
    const swing = resolveAttack(
      after,
      reactor,
      {
        target: hurt.by,
        // The same three answers an Opportunity Attack takes, for the same
        // Reaction: a creature that prints its own attacks swings one of them
        // rather than an Unarmed Strike nobody printed.
        ...reactionSwing(sheetAsItStands(after, reactor) ?? creature.sheet, command),
        free: true,
      },
      supply,
    );
    if (!swing.ok) return swing;

    return ok({
      ...swing.value,
      events: [
        ...events,
        ...swing.value.events,
        // A `reaction-taken` rather than a stamp on one of the attack's own
        // events, for two reasons. The swing may miss, and a missed Reaction
        // must not be retryable; and this window has no other record that a
        // Reaction happened at all — no hold opened, nothing was held back —
        // so without it the log shows an attack out of turn and no reason for
        // it.
        {
          type: 'reaction-taken',
          reactor,
          window: 'damaged-by-creature',
          feature: feature.feature,
          against: hurt.by,
          ...(stamp === null ? {} : { command: stamp }),
        },
      ],
      unverified: [...swing.value.unverified, ...unverified],
    });
  });
}

/**
 * Every Reaction a creature could legally take right now, across every open
 * window.
 *
 * This is the half Maestro needs and the engine had none of. The trigger
 * machinery could *refuse* a Reaction taken at the wrong moment; nothing could
 * say a moment was open. A model that has to guess whether a *Shield* is
 * available will either never cast one or will try constantly and be refused,
 * and neither is a DM.
 *
 * **It transfers no mechanical authority.** Every entry is a fact the engine
 * already holds, and taking the opportunity goes through the command that
 * checks all of it again — this decides nothing and spends nothing. What it
 * does is let Maestro make the *choice* the rules give a creature (does this
 * NPC want to spend its Reaction?) without inventing the *trigger* that would
 * make the choice legal.
 *
 * Six windows, five sources:
 *
 * | Window | Where the opportunity comes from |
 * |---|---|
 * | `hit-by-attack` | a Reaction spell the target can cast — *Shield* |
 * | `damage-rolled` | the offers the engine computed when it held the damage |
 * | `test-rolled` | the offers the engine computed when it held the test |
 * | `damaged-by-creature` | a feature or a Reaction spell, against `lastDamage` |
 * | `casting-a-spell` | a Reaction spell somebody else can cast — *Counterspell* |
 * | `creature-falling` | a Reaction spell anybody can cast, against a declared fall |
 *
 * Two of those read a list already in state and four derive one, and the
 * difference is exactly whether the window holds an outcome open. A window
 * that holds something had to know who could answer before it opened.
 *
 * **What it does not check**, and says so rather than over-reporting silently:
 * *Counterspell*'s 60 feet and line of sight, which `triggerRefusal` does not
 * check either because the engine has never modelled which castings a creature
 * perceives. A listed opportunity is legal as far as the engine can see.
 */
export function reactionOpportunities(state: GameState, content: Content): readonly ReactionOpportunity[] {
  const found: ReactionOpportunity[] = [];

  const canReact = (who: CharacterId): boolean => {
    const creature = state.creatures[who];
    if (creature === undefined || creature.vitals.dead) return false;
    if (isIncapacitated(creature.conditions)) return false;
    if (state.combat === null) return true;
    return state.combat.budgets[who]?.reaction !== false;
  };

  /** Reaction spells this creature could cast for a given window. */
  const spellsFor = (who: CharacterId, window: SpellReactionWindow): ReactionOpportunity[] => {
    const creature = state.creatures[who];
    if (creature === undefined) return [];
    const known = [
      ...creature.spellcasting.classes.flatMap((c) => [...c.cantrips, ...c.prepared]),
      ...creature.spellcasting.granted.map((g) => g.spellId),
    ];
    return [...new Set(known)].sort().flatMap((spellId): ReactionOpportunity[] => {
      const definition = content.spell(spellId);
      if (definition?.trigger !== window) return [];
      return [
        {
          window,
          reactor: who,
          id: spellId,
          name: definition.name,
          kind: 'spell',
          // SRD writes the casting time as "Reaction, which you take when…",
          // so the Reaction is always part of the cost.
          costsReaction: true,
          pool: null,
          against: null,
        },
      ];
    });
  };

  const attack = state.pendingAttack;
  if (attack !== null && canReact(attack.target)) {
    for (const chance of spellsFor(attack.target, 'hit-by-attack')) {
      found.push({ ...chance, against: attack.attacker });
    }
  }

  // **Every casting that is open, and each offer names which.** Several may be
  // open at once and several may belong to one caster, so `against` alone no
  // longer identifies one — two offers with the same reactor and the same
  // caster would be indistinguishable, and the ambiguity refusal would then
  // tell a caller to name an id they could not see.
  for (const casting of pendingCastingsOf(state)) {
    for (const key of Object.keys(state.creatures).sort()) {
      const who = key as CharacterId;
      if (who === casting.caster || !canReact(who)) continue;
      for (const chance of spellsFor(who, 'casting-a-spell')) {
        found.push({ ...chance, against: casting.caster, casting: casting.castingId });
      }
    }
  }

  // An offer in a pending record is who the engine asked when the window
  // opened. It can go stale — something else spent that creature's Reaction,
  // or drained the pool — and the commands re-check, so the query must too:
  // reporting an opportunity that would be refused is worse than reporting
  // none.
  const affordable = (offer: ReactionOffer): boolean => {
    if (!canReact(offer.reactor)) return false;
    if (offer.pool === null) return true;
    const creature = state.creatures[offer.reactor];
    return creature !== undefined && remaining(creature.resources, offer.pool) >= 1;
  };

  const damage = state.pendingDamage;
  if (damage !== null) {
    for (const offer of damage.offers.filter(affordable)) {
      found.push({
        window: 'damage-rolled',
        reactor: offer.reactor,
        id: offer.feature,
        name: offer.name,
        kind: 'feature',
        costsReaction: offer.costsReaction,
        pool: offer.pool,
        against: damage.by,
      });
    }
  }

  const test = state.pendingTest;
  if (test !== null) {
    for (const offer of test.offers.filter(affordable)) {
      found.push({
        window: 'test-rolled',
        reactor: offer.reactor,
        id: offer.feature,
        name: offer.name,
        kind: 'feature',
        costsReaction: offer.costsReaction,
        pool: offer.pool,
        against: test.who,
      });
    }
  }

  // The settled window. Nothing is held open, so the opportunity is derived
  // from `lastDamage` and the clock — the same two facts `damageWindowOpen`
  // reads for *Hellish Rebuke*.
  for (const key of Object.keys(state.creatures).sort()) {
    const who = key as CharacterId;
    const hurt = damageWindowOpen(state, who);
    if (hurt === null || !canReact(who)) continue;

    // Granted Reactions included, which is what `reactionsOf` is for: a
    // window a creature can answer with something somebody gave them is one
    // this query has to report, or the offer and the command disagree.
    for (const feature of reactionsOf(state.creatures[who]!)) {
      if (feature.window !== 'damaged-by-creature') continue;
      if (feature.pool !== null && remaining(state.creatures[who]!.resources, feature.pool) < 1) {
        continue;
      }
      found.push({
        window: 'damaged-by-creature',
        reactor: who,
        id: feature.feature,
        name: feature.name,
        kind: 'feature',
        costsReaction: feature.costsReaction,
        pool: feature.pool,
        against: hurt.by,
        ...(feature.granted === undefined ? {} : { granted: feature.granted }),
      });
    }

    for (const chance of spellsFor(who, 'damaged-by-creature')) {
      found.push({ ...chance, against: hurt.by });
    }
  }

  // The declared window. Nothing is held open here either, and the fact it
  // reads came from the table rather than from a resolution — see
  // `ReactionWindow`. **Every caster, including the one who is falling**: SRD
  // writes the trigger as "when *you or* a creature you can see ... falls", so
  // unlike `casting-a-spell` the subject is not excluded from answering.
  for (const faller of fallingNow(state)) {
    for (const key of Object.keys(state.creatures).sort()) {
      const who = key as CharacterId;
      if (!canReact(who)) continue;
      for (const chance of spellsFor(who, 'creature-falling')) {
        found.push({ ...chance, against: faller });
      }
    }
  }

  return found;
}

